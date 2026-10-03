import { lstat, open, opendir, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import type { WorldDimension, WorldFieldSource, WorldInfo } from "@mcsm/contracts";

import { isLocalAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import {
  SERVER_PROPERTIES_LIMIT,
  parseProperties,
  readBoundedRegularFile
} from "../config/properties.js";
import { DomainError } from "./domain-errors.js";
import { ServerNotFoundError } from "./server-service.js";
import { worldIdentity, type ActiveWorldStateStore } from "./active-world-state-store.js";

const LEVEL_DAT_COMPRESSED_LIMIT = 8 * 1024 * 1024;
const LEVEL_DAT_DECOMPRESSED_LIMIT = 32 * 1024 * 1024;
const NBT_MAX_DEPTH = 64;
const NBT_MAX_NODES = 100_000;
const NBT_MAX_STRING_BYTES = 64 * 1024;
const WORLD_MAX_ENTRIES = 250_000;
const WORLD_MAX_DEPTH = 64;
const DIMENSION_SCAN_MAX_DEPTH = 16;
const DIMENSION_SCAN_MAX_ENTRIES = 10_000;

type WorldMetric<T> =
  | { status: "available"; value: T; source: "filesystem"; sampledAt: string }
  | {
      status: "unavailable";
      value: null;
      source: null;
      sampledAt: null;
      reason: string;
    };

interface Selection {
  readonly [key: string]: true | Selection;
}

interface SelectedCompound {
  [key: string]: number | string | bigint | SelectedCompound;
}

const LEVEL_SELECTION: Selection = {
  Data: {
    RandomSeed: true,
    WorldGenSettings: { seed: true },
    Version: { Name: true },
    Difficulty: true,
    GameType: true,
    hardcore: true
  }
};

class NbtReadError extends Error {}

class NbtReader {
  #offset = 0;
  #nodes = 0;

  constructor(private readonly buffer: Buffer) {}

  parseSelectedRoot(selection: Selection = LEVEL_SELECTION): SelectedCompound {
    const rootType = this.u8();
    if (rootType !== 10) throw new NbtReadError("root-not-compound");
    this.string();
    return this.selectedCompound(1, selection);
  }

  private ensure(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.#offset + bytes > this.buffer.length) {
      throw new NbtReadError("truncated");
    }
  }

  private consumeNode(): void {
    this.#nodes += 1;
    if (this.#nodes > NBT_MAX_NODES) throw new NbtReadError("node-limit");
  }

  private depth(depth: number): void {
    if (depth > NBT_MAX_DEPTH) throw new NbtReadError("depth-limit");
  }

  private u8(): number {
    this.ensure(1);
    const value = this.buffer.readUInt8(this.#offset);
    this.#offset += 1;
    return value;
  }

  private i8(): number {
    this.ensure(1);
    const value = this.buffer.readInt8(this.#offset);
    this.#offset += 1;
    return value;
  }

  private i16(): number {
    this.ensure(2);
    const value = this.buffer.readInt16BE(this.#offset);
    this.#offset += 2;
    return value;
  }

  private u16(): number {
    this.ensure(2);
    const value = this.buffer.readUInt16BE(this.#offset);
    this.#offset += 2;
    return value;
  }

  private i32(): number {
    this.ensure(4);
    const value = this.buffer.readInt32BE(this.#offset);
    this.#offset += 4;
    return value;
  }

  private i64(): bigint {
    this.ensure(8);
    const value = this.buffer.readBigInt64BE(this.#offset);
    this.#offset += 8;
    return value;
  }

  private float(): number {
    this.ensure(4);
    const value = this.buffer.readFloatBE(this.#offset);
    this.#offset += 4;
    return value;
  }

  private double(): number {
    this.ensure(8);
    const value = this.buffer.readDoubleBE(this.#offset);
    this.#offset += 8;
    return value;
  }

  private string(): string {
    const length = this.u16();
    if (length > NBT_MAX_STRING_BYTES) throw new NbtReadError("string-limit");
    this.ensure(length);
    const value = this.buffer.toString("utf8", this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  private skip(bytes: number): void {
    this.ensure(bytes);
    this.#offset += bytes;
  }

  private length(byteWidth: number): number {
    const length = this.i32();
    if (length < 0 || length > NBT_MAX_NODES) throw new NbtReadError("length-limit");
    const bytes = length * byteWidth;
    if (!Number.isSafeInteger(bytes) || bytes > LEVEL_DAT_DECOMPRESSED_LIMIT) {
      throw new NbtReadError("allocation-limit");
    }
    return length;
  }

  private selectedCompound(depth: number, selection: Selection): SelectedCompound {
    this.depth(depth);
    const result: SelectedCompound = Object.create(null) as SelectedCompound;
    while (true) {
      const type = this.u8();
      if (type === 0) return result;
      if (type < 1 || type > 12) throw new NbtReadError("unknown-tag");
      this.consumeNode();
      const name = this.string();
      const selected = selection[name];
      if (selected === undefined) {
        this.skipValue(type, depth + 1);
        continue;
      }
      if (selected !== true) {
        if (type === 10) result[name] = this.selectedCompound(depth + 1, selected);
        else this.skipValue(type, depth + 1);
        continue;
      }
      const primitive = this.primitive(type);
      if (primitive === undefined) this.skipValue(type, depth + 1);
      else result[name] = primitive;
    }
  }

  private primitive(type: number): number | string | bigint | undefined {
    if (type === 1) return this.i8();
    if (type === 2) return this.i16();
    if (type === 3) return this.i32();
    if (type === 4) return this.i64();
    if (type === 5) return this.float();
    if (type === 6) return this.double();
    if (type === 8) return this.string();
    return undefined;
  }

  private skipValue(type: number, depth: number): void {
    this.depth(depth);
    if (type === 1) this.skip(1);
    else if (type === 2) this.skip(2);
    else if (type === 3 || type === 5) this.skip(4);
    else if (type === 4 || type === 6) this.skip(8);
    else if (type === 7) this.skip(this.length(1));
    else if (type === 8) void this.string();
    else if (type === 9) {
      const itemType = this.u8();
      const length = this.length(0);
      if ((length > 0 && itemType < 1) || itemType > 12) {
        throw new NbtReadError("unknown-list-tag");
      }
      for (let index = 0; index < length; index += 1) {
        this.consumeNode();
        this.skipValue(itemType, depth + 1);
      }
    } else if (type === 10) {
      while (true) {
        const childType = this.u8();
        if (childType === 0) break;
        if (childType < 1 || childType > 12) throw new NbtReadError("unknown-tag");
        this.consumeNode();
        void this.string();
        this.skipValue(childType, depth + 1);
      }
    } else if (type === 11) this.skip(this.length(4) * 4);
    else if (type === 12) this.skip(this.length(8) * 8);
    else throw new NbtReadError("unknown-tag");
  }
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function unavailable<T>(reason: string): WorldMetric<T> {
  return { status: "unavailable", value: null, source: null, sampledAt: null, reason };
}

function available<T>(value: T, sampledAt: string): WorldMetric<T> {
  return { status: "available", value, source: "filesystem", sampledAt };
}

function unsafeWorld(reason: string): DomainError {
  return new DomainError(409, "WORLD_LAYOUT_UNSAFE", "世界目录布局不安全", reason);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function validateLevelName(value: string): string {
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
  if (
    value.length < 1 ||
    value.length > 128 ||
    value === "." ||
    value === ".." ||
    path.isAbsolute(value) ||
    path.basename(value) !== value ||
    /[\\/:\u0000-\u001f\u007f]/u.test(value) ||
    /[. ]$/u.test(value) ||
    windowsReserved.test(value)
  ) {
    throw unsafeWorld("invalid-level-name");
  }
  return value;
}

async function canonicalDirectory(directoryPath: string, allowMissing = false): Promise<string | null> {
  let metadata;
  try {
    metadata = await lstat(directoryPath);
  } catch (error) {
    if (allowMissing && isMissing(error)) return null;
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw unsafeWorld("linked-directory");
  const canonical = await realpath(directoryPath);
  if (!samePath(canonical, directoryPath)) throw unsafeWorld("linked-directory");
  return canonical;
}

async function readBoundedBuffer(filePath: string, maximumBytes: number): Promise<Buffer> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw unsafeWorld("linked-level-dat");
  if (metadata.size > maximumBytes) throw unsafeWorld("level-dat-too-large");
  const canonical = await realpath(filePath);
  if (!samePath(canonical, filePath)) throw unsafeWorld("linked-level-dat");

  const handle = await open(filePath, "r");
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size > maximumBytes || current.size !== metadata.size) {
      throw unsafeWorld("level-dat-changed");
    }
    const buffer = Buffer.alloc(current.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) throw unsafeWorld("level-dat-changed");
      offset += bytesRead;
    }
    const afterRead = await handle.stat();
    if (!afterRead.isFile() || afterRead.size !== current.size) throw unsafeWorld("level-dat-changed");
    return buffer;
  } finally {
    await handle.close();
  }
}

async function readLevelData(worldRoot: string, relativeFile = "level.dat", selection = LEVEL_SELECTION): Promise<SelectedCompound | null> {
  try {
    const compressed = await readBoundedBuffer(
      path.join(worldRoot, relativeFile),
      LEVEL_DAT_COMPRESSED_LIMIT
    );
    if (compressed.length < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) return null;
    const decompressed = gunzipSync(compressed, { maxOutputLength: LEVEL_DAT_DECOMPRESSED_LIMIT });
    return new NbtReader(decompressed).parseSelectedRoot(selection);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return null;
  }
}

async function worldSize(directory: string): Promise<number> {
  let entries = 0;
  let total = 0;
  const visit = async (current: string, depth: number): Promise<void> => {
    if (depth > WORLD_MAX_DEPTH) throw unsafeWorld("world-depth-limit");
    await canonicalDirectory(current);
    const directoryHandle = await opendir(current);
    for await (const child of directoryHandle) {
      entries += 1;
      if (entries > WORLD_MAX_ENTRIES) throw unsafeWorld("world-entry-limit");
      const candidate = path.join(current, child.name);
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink()) throw unsafeWorld("linked-world-entry");
      if (metadata.isDirectory()) await visit(candidate, depth + 1);
      else if (metadata.isFile()) {
        total += metadata.size;
        if (!Number.isSafeInteger(total)) throw unsafeWorld("world-size-limit");
      } else {
        throw unsafeWorld("special-world-entry");
      }
    }
  };
  await visit(directory, 0);
  return total;
}

async function directoryExistsSafe(candidate: string): Promise<boolean> {
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) throw unsafeWorld("linked-dimension");
    if (!metadata.isDirectory()) throw unsafeWorld("invalid-dimension");
    const canonical = await realpath(candidate);
    if (!samePath(canonical, candidate)) throw unsafeWorld("linked-dimension");
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function customDimensions(worldRoot: string): Promise<WorldDimension[]> {
  const base = path.join(worldRoot, "dimensions");
  if (!(await directoryExistsSafe(base))) return [];
  const result = new Map<string, WorldDimension>();
  let scannedEntries = 0;

  const visit = async (current: string, parts: string[], depth: number): Promise<void> => {
    if (depth > DIMENSION_SCAN_MAX_DEPTH) throw unsafeWorld("dimension-depth-limit");
    await canonicalDirectory(current);
    const children = await readdir(current, { withFileTypes: true });
    scannedEntries += children.length;
    if (scannedEntries > DIMENSION_SCAN_MAX_ENTRIES) {
      throw unsafeWorld("dimension-entry-limit");
    }
    const childNames = new Set(children.map((child) => child.name));
    if (
      parts.length >= 2 &&
      ["region", "entities", "poi", "data"].some((name) => childNames.has(name))
    ) {
      const [namespace, ...dimensionParts] = parts;
      const dimensionPath = dimensionParts.join("/");
      if (
        namespace !== undefined &&
        /^[a-z0-9_.-]+$/u.test(namespace) &&
        /^[a-z0-9_./-]+$/u.test(dimensionPath)
      ) {
        const id = `${namespace}:${dimensionPath}`;
        const kind =
          id === "minecraft:the_nether"
            ? "nether"
            : id === "minecraft:the_end"
              ? "end"
              : id === "minecraft:overworld"
                ? "overworld"
                : "custom";
        result.set(id, { id, kind });
      }
      return;
    }
    for (const child of children) {
      const candidate = path.join(current, child.name);
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink()) throw unsafeWorld("linked-dimension");
      if (metadata.isDirectory()) await visit(candidate, [...parts, child.name], depth + 1);
      else if (!metadata.isFile()) throw unsafeWorld("special-world-entry");
    }
  };
  await visit(base, [], 0);
  return [...result.values()];
}

async function dimensions(worldRoot: string): Promise<WorldDimension[]> {
  const result = new Map<string, WorldDimension>([
    ["minecraft:overworld", { id: "minecraft:overworld", kind: "overworld" }]
  ]);
  if (await directoryExistsSafe(path.join(worldRoot, "DIM-1"))) {
    result.set("minecraft:the_nether", { id: "minecraft:the_nether", kind: "nether" });
  }
  if (await directoryExistsSafe(path.join(worldRoot, "DIM1"))) {
    result.set("minecraft:the_end", { id: "minecraft:the_end", kind: "end" });
  }
  for (const dimension of await customDimensions(worldRoot)) result.set(dimension.id, dimension);
  if (result.size > 256) throw unsafeWorld("dimension-count-limit");
  return [...result.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function compound(value: unknown): SelectedCompound | undefined {
  return typeof value === "object" && value !== null ? (value as SelectedCompound) : undefined;
}

function safeVersion(value: unknown): string | null {
  return typeof value === "string" && /^[0-9A-Za-z ._+\-]{1,64}$/u.test(value) ? value : null;
}

function propertyBoolean(value: string | undefined): boolean | null {
  if (value?.toLowerCase() === "true") return true;
  if (value?.toLowerCase() === "false") return false;
  return null;
}

function propertyInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function inspectVanillaWorld(
  serverId: string,
  serverRoot: string,
  sampledAt: string
): Promise<WorldInfo[]> {
  const propertiesText = await readBoundedRegularFile(
    path.join(serverRoot, "server.properties"),
    SERVER_PROPERTIES_LIMIT,
    "server.properties"
  );
  const properties = parseProperties(propertiesText);
  const configuredLevelName = properties.get("level-name");
  const levelName = validateLevelName(configuredLevelName ?? "world");
  const worldCandidate = path.resolve(serverRoot, levelName);
  const relative = path.relative(serverRoot, worldCandidate);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw unsafeWorld("world-outside-root");
  }
  const worldRoot = await canonicalDirectory(worldCandidate, true);
  if (worldRoot === null) return [];

  const [levelData, sizeBytes, worldDimensions] = await Promise.all([
    readLevelData(worldRoot),
    worldSize(worldRoot),
    dimensions(worldRoot)
  ]);
  const data = compound(levelData?.Data);
  const worldGenSettings = compound(data?.WorldGenSettings);
  const versionData = compound(data?.Version);
  const legacySeed = worldGenSettings?.seed ?? data?.RandomSeed;
  // 26.3 stores generation settings in a separate saved-data compound.
  // Read the generated world data, never substitute its configured seed.
  let rawSeed = legacySeed;
  if (typeof rawSeed !== "bigint") {
    const savedData = path.join(worldRoot, "data");
    if (await canonicalDirectory(savedData, true) && await canonicalDirectory(path.join(savedData, "minecraft"), true)) {
      rawSeed = compound((await readLevelData(worldRoot, "data/minecraft/world_gen_settings.dat", { data: { seed: true } }))?.data)?.seed;
    }
  }
  const version = safeVersion(versionData?.Name);
  const difficultyNames = ["peaceful", "easy", "normal", "hard"] as const;
  const gameModeNames = ["survival", "creative", "adventure", "spectator"] as const;
  const difficulty =
    typeof data?.Difficulty === "number" ? difficultyNames[data.Difficulty] : undefined;
  const gameMode = typeof data?.GameType === "number" ? gameModeNames[data.GameType] : undefined;
  const hardcore = typeof data?.hardcore === "number" && [0, 1].includes(data.hardcore)
    ? data.hardcore === 1
    : null;
  const pvp = propertyBoolean(properties.get("pvp"));
  const viewDistance = propertyInteger(properties.get("view-distance"));
  const simulationDistance = propertyInteger(properties.get("simulation-distance"));
  const fieldSources: Record<keyof WorldInfo["fieldSources"], WorldFieldSource> = {
    name: configuredLevelName === undefined ? null : "server-properties",
    seed: typeof rawSeed === "bigint" ? typeof legacySeed === "bigint" ? "level-dat" : "world-data" : null,
    minecraftVersion: version === null ? null : "level-dat",
    sizeBytes: "filesystem",
    difficulty: difficulty === undefined ? null : "level-dat",
    gameMode: gameMode === undefined ? null : "level-dat",
    hardcore: hardcore === null ? null : "level-dat",
    pvp: pvp === null ? null : "server-properties",
    viewDistance: viewDistance === null ? null : "server-properties",
    simulationDistance: simulationDistance === null ? null : "server-properties"
  };

  const worldId = worldIdentity(serverId, levelName);
  return [{
    worldId,
    worldRevision: await readWorldRevision(serverId, levelName, worldRoot).catch(() => null),
    active: true,
    dimensions: worldDimensions,
    name: available(levelName, sampledAt),
    seed: typeof rawSeed === "bigint"
      ? available(rawSeed.toString(10), sampledAt)
      : unavailable("level-dat-field-unavailable"),
    minecraftVersion: version === null
      ? unavailable("level-dat-field-unavailable")
      : available(version, sampledAt),
    sizeBytes: available(sizeBytes, sampledAt),
    difficulty: difficulty === undefined
      ? unavailable("level-dat-field-unavailable")
      : available(difficulty, sampledAt),
    gameMode: gameMode === undefined
      ? unavailable("level-dat-field-unavailable")
      : available(gameMode, sampledAt),
    hardcore: hardcore === null
      ? unavailable("level-dat-field-unavailable")
      : available(hardcore, sampledAt),
    pvp: pvp === null ? unavailable("property-unavailable") : available(pvp, sampledAt),
    viewDistance: viewDistance === null
      ? unavailable("property-unavailable")
      : available(viewDistance, sampledAt),
    simulationDistance: simulationDistance === null
      ? unavailable("property-unavailable")
      : available(simulationDistance, sampledAt),
    fieldSources
  }];
}

export async function readWorldRevision(serverId: string, levelName: string, worldRoot: string): Promise<string> {
  const file = path.join(worldRoot, "level.dat");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > LEVEL_DAT_COMPRESSED_LIMIT) throw unsafeWorld("invalid-level-data");
  const handle = await open(file, "r");
  let bytes: Buffer;
  try {
    bytes = Buffer.alloc(LEVEL_DAT_COMPRESSED_LIMIT + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset > LEVEL_DAT_COMPRESSED_LIMIT) throw unsafeWorld("invalid-level-data");
    bytes = bytes.subarray(0, offset);
  } finally { await handle.close(); }
  return createHash("sha256").update("world-revision-v1\0").update(worldIdentity(serverId, levelName))
    .update("\0").update(levelName).update("\0").update(bytes).digest("hex");
}

export async function readWorldVersion(worldRoot: string): Promise<string | null> {
  const data = compound((await readLevelData(worldRoot))?.Data);
  return safeVersion(compound(data?.Version)?.Name);
}

export class WorldInventoryService {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly clock: Clock,
    private readonly activeWorldState?: Pick<ActiveWorldStateStore, "isActive">
  ) {}

  async list(serverId: string): Promise<WorldInfo[]> {
    const adapter = this.registry.get(serverId);
    if (adapter === undefined) throw new ServerNotFoundError();
    if (!isLocalAdapter(adapter)) {
      throw new DomainError(501, "FEATURE_NOT_IMPLEMENTED", "Mock 模式不提供世界盘点", "mock-mode");
    }
    if (adapter.plan.serverInfo.type !== "vanilla") {
      throw new DomainError(
        501,
        "WORLD_LAYOUT_UNSUPPORTED",
        "当前服务端类型的世界布局尚未支持",
        "unsupported-server-layout"
      );
    }
    const items = await inspectVanillaWorld(serverId, adapter.plan.rootPath, this.clock.now().toISOString());
    if (this.activeWorldState === undefined) return items;
    return items.map((item) => ({
      ...item,
      active: this.activeWorldState!.isActive(serverId, item.worldId)
    }));
  }
}
