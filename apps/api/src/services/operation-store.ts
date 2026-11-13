import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename } from "node:fs/promises";
import path from "node:path";

import { Value } from "@sinclair/typebox/value";
import { operationSchema, type Operation } from "@mcsm/contracts";
import { validGenerationExecutionReceipt, type WorldGenerationExecution } from "./world-generation-execution.js";
import { validWorldGenerationSettlement, type WorldGenerationSettlement } from "./world-generation-settlement.js";
import { matchesWorldLifecycleStop, validWorldLifecycleLaunchSeal, validWorldLifecycleReceipt, validWorldLifecycleStopSeal,
  validWorldLifecycleStopConfirmation, type WorldLifecycleStopConfirmation,
  type WorldLifecycleLaunchSeal, type WorldLifecycleReceipt, type WorldLifecycleStopSeal } from "./world-lifecycle-receipt.js";

export interface StoredOperation {
  readonly operation: Operation;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly expiresAt: string;
  readonly worldGenerationExecution?: WorldGenerationExecution;
  readonly worldLifecycle?: WorldLifecycleReceipt;
}

export interface OperationStore {
  create?(record: StoredOperation): Promise<void>;
  read?(operationId: string): Promise<StoredOperation>;
  createWorldLaunchSeal?(seal: WorldLifecycleLaunchSeal): Promise<void>;
  readWorldLaunchSeal?(operationId: string): Promise<WorldLifecycleLaunchSeal>;
  createWorldStopSeal?(seal: WorldLifecycleStopSeal): Promise<void>;
  readWorldStopSeal?(operationId: string): Promise<WorldLifecycleStopSeal>;
  createWorldStopConfirmation?(confirmation: WorldLifecycleStopConfirmation): Promise<void>;
  readWorldStopConfirmation?(operationId: string): Promise<WorldLifecycleStopConfirmation>;
  createWorldGenerationSettlement?(settlement: WorldGenerationSettlement): Promise<void>;
  readWorldGenerationSettlement?(operationId: string): Promise<WorldGenerationSettlement>;
  initialize(): Promise<void>;
  list(): Promise<StoredOperation[]>;
  save(record: StoredOperation): Promise<void>;
}

export async function readWorldLifecycleStopEvidence(store: Pick<OperationStore, "read" | "readWorldLaunchSeal" | "readWorldStopSeal">,
  startId: string, stopId: string) {
  if (!store.read || !store.readWorldLaunchSeal || !store.readWorldStopSeal) return undefined;
  try {
    const stop = await store.read(stopId), start = await store.read(startId);
    const launch = await store.readWorldLaunchSeal(startId), revision = await store.readWorldStopSeal(stopId);
    if (start.operation.id !== startId || stop.operation.id !== stopId || stop.operation.state !== "running" ||
        stop.operation.step !== "running" || stop.operation.result !== null || stop.operation.error !== null ||
        !matchesWorldLifecycleStop(start, stop, launch) || !validWorldLifecycleStopSeal(revision) ||
        revision.stopOperationId !== stopId || revision.stopIntentDigest !== createHash("sha256").update(JSON.stringify(stop)).digest("hex")) return undefined;
    return { start, stop, launch, revision };
  } catch { return undefined; }
}

/** Binds a completed inspection to all four immutable inputs. A matching
 * receipt still requires fresh physical verification before admission. */
export function worldStopConfirmation(evidence: NonNullable<Awaited<ReturnType<typeof readWorldLifecycleStopEvidence>>>,
  journalDigest?: string): WorldLifecycleStopConfirmation {
  const binding = { stopOperationId: evidence.stop.operation.id,
    evidenceDigest: createHash("sha256").update(JSON.stringify(evidence)).digest("hex") };
  return journalDigest === undefined ? { schemaVersion: 1, ...binding } : { schemaVersion: 2, ...binding, journalDigest };
}

function isStoredOperation(value: unknown): value is StoredOperation {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Value.Check(operationSchema, record.operation) &&
    typeof record.idempotencyKey === "string" &&
    typeof record.requestFingerprint === "string" &&
    typeof record.expiresAt === "string" &&
    (record.worldGenerationExecution === undefined || validGenerationExecutionReceipt(value as StoredOperation)) &&
    (record.worldLifecycle === undefined || validWorldLifecycleReceipt(value as StoredOperation))
  );
}

export class JsonOperationStore implements OperationStore {
  readonly #managerRoot: string;
  readonly #directory: string;

  constructor(managerRoot: string) {
    this.#managerRoot = path.resolve(managerRoot);
    this.#directory = path.join(this.#managerRoot, "operations");
  }

  async initialize(): Promise<void> {
    await mkdir(this.#managerRoot, { recursive: true, mode: 0o700 });
    await this.#plainDirectory(this.#managerRoot);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await this.#validateDirectories();
  }

  async list(): Promise<StoredOperation[]> {
    await this.#validateDirectories();
    const entries = (await readdir(this.#directory, { withFileTypes: true }))
      .filter((entry) => /^[0-9a-f-]{36}\.json$/u.test(entry.name));
    if (entries.length > 10_000) {
      throw new Error("Too many operation records; refusing unsafe startup truncation");
    }
    const records: StoredOperation[] = [];
    for (const entry of entries) records.push(await this.#readRecord(entry.name));
    return records;
  }

  async read(operationId: string): Promise<StoredOperation> {
    if (!/^[0-9a-f-]{36}$/u.test(operationId)) throw new Error("Invalid operation ID");
    await this.#validateDirectories();
    return this.#readRecord(operationId + ".json");
  }

  async #readRecord(name: string): Promise<StoredOperation> {
    const value = await this.#readJson(name);
    if (!isStoredOperation(value) || `${value.operation.id}.json` !== name) throw new Error("Invalid operation record");
    return value;
  }

  async #readJson(name: string): Promise<unknown> {
    const file = path.join(this.#directory, name);
    const info = await lstat(file, { bigint: true });
    const matches = (current: typeof info) => current.isFile() && current.nlink === 1n &&
      current.dev === info.dev && current.ino === info.ino && current.birthtimeNs === info.birthtimeNs &&
      current.size === info.size && current.mtimeNs === info.mtimeNs && current.ctimeNs === info.ctimeNs;
    if (!matches(info) || info.size > 65536n) throw new Error("Invalid operation record");
    const handle = await open(file, "r");
    let raw: string;
    try {
      if (!matches(await handle.stat({ bigint: true }))) throw new Error("Invalid operation record");
      const buffer = Buffer.alloc(Number(info.size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      await this.#validateDirectories();
      if (bytesRead !== buffer.length || !matches(await handle.stat({ bigint: true })) ||
          !matches(await lstat(file, { bigint: true }))) throw new Error("Invalid operation record");
      raw = buffer.toString("utf8");
    } finally { await handle.close(); }
    return JSON.parse(raw) as unknown;
  }

  async create(record: StoredOperation): Promise<void> {
    if (!isStoredOperation(record) || !/^[0-9a-f-]{36}$/u.test(record.operation.id)) throw new Error("Invalid operation record");
    await this.#createJson(`${record.operation.id}.json`, record);
  }

  async createWorldLaunchSeal(seal: WorldLifecycleLaunchSeal): Promise<void> {
    if (!validWorldLifecycleLaunchSeal(seal)) throw new Error("Invalid world launch seal");
    await this.#createJson(`${seal.startOperationId}.launch.json`, seal);
  }

  async readWorldLaunchSeal(operationId: string): Promise<WorldLifecycleLaunchSeal> {
    if (!/^[0-9a-f-]{36}$/u.test(operationId)) throw new Error("Invalid operation ID");
    await this.#validateDirectories();
    const seal = await this.#readJson(`${operationId}.launch.json`);
    if (!validWorldLifecycleLaunchSeal(seal) || seal.startOperationId !== operationId) throw new Error("Invalid world launch seal");
    return seal;
  }

  async createWorldStopSeal(seal: WorldLifecycleStopSeal): Promise<void> {
    if (!validWorldLifecycleStopSeal(seal)) throw new Error("Invalid world stop seal");
    await this.#createJson(`${seal.stopOperationId}.stop.json`, seal);
  }

  async readWorldStopSeal(operationId: string): Promise<WorldLifecycleStopSeal> {
    if (!/^[0-9a-f-]{36}$/u.test(operationId)) throw new Error("Invalid operation ID");
    await this.#validateDirectories();
    const seal = await this.#readJson(`${operationId}.stop.json`);
    if (!validWorldLifecycleStopSeal(seal) || seal.stopOperationId !== operationId) throw new Error("Invalid world stop seal");
    return seal;
  }

  async createWorldStopConfirmation(confirmation: WorldLifecycleStopConfirmation): Promise<void> {
    if (!validWorldLifecycleStopConfirmation(confirmation)) throw new Error("Invalid world stop confirmation");
    await this.#createJson(`${confirmation.stopOperationId}.stop-confirmation.json`, confirmation);
  }

  async createWorldGenerationSettlement(settlement: WorldGenerationSettlement): Promise<void> {
    if (!validWorldGenerationSettlement(settlement)) throw new Error("Invalid world generation settlement");
    await this.#createJson(`${settlement.stopOperationId}.generation-settlement.json`, settlement);
  }

  async readWorldGenerationSettlement(operationId: string): Promise<WorldGenerationSettlement> {
    if (!/^[0-9a-f-]{36}$/u.test(operationId)) throw new Error("Invalid operation ID");
    await this.#validateDirectories();
    const settlement = await this.#readJson(`${operationId}.generation-settlement.json`);
    if (!validWorldGenerationSettlement(settlement) || settlement.stopOperationId !== operationId) {
      throw new Error("Invalid world generation settlement");
    }
    return settlement;
  }

  async readWorldStopConfirmation(operationId: string): Promise<WorldLifecycleStopConfirmation> {
    if (!/^[0-9a-f-]{36}$/u.test(operationId)) throw new Error("Invalid operation ID");
    await this.#validateDirectories();
    const confirmation = await this.#readJson(`${operationId}.stop-confirmation.json`);
    if (!validWorldLifecycleStopConfirmation(confirmation) || confirmation.stopOperationId !== operationId) {
      throw new Error("Invalid world stop confirmation");
    }
    return confirmation;
  }

  async #createJson(name: string, value: unknown): Promise<void> {
    const payload = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(payload) > 64 * 1024) throw new Error("Invalid operation record");
    await this.#validateDirectories();
    const handle = await open(path.join(this.#directory, name), "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
  }
  async save(record: StoredOperation): Promise<void> {
    if (!isStoredOperation(record) || !/^[0-9a-f-]{36}$/u.test(record.operation.id)) throw new Error("Invalid operation record");
    await this.#validateDirectories();
    const target = path.join(this.#directory, `${record.operation.id}.json`);
    const temporary = path.join(this.#directory, `${record.operation.id}.${randomUUID()}.tmp`);
    const payload = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(payload, "utf8") > 64 * 1024) throw new Error("Invalid operation record");
    await this.#validateTarget(target);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.#validateDirectories();
    await this.#validateTarget(target);
    await rename(temporary, target);
  }

  async #plainDirectory(directory: string): Promise<void> {
    const info = await lstat(directory);
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (!info.isDirectory() || info.isSymbolicLink() || normalize(await realpath(directory)) !== normalize(directory)) {
      throw new Error("Unsafe operation store directory");
    }
  }

  async #validateDirectories(): Promise<void> {
    await this.#plainDirectory(this.#managerRoot);
    await this.#plainDirectory(this.#directory);
  }

  async #recordInfo(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 64 * 1024) {
      throw new Error("Invalid operation record");
    }
    return info;
  }

  async #validateTarget(file: string): Promise<void> {
    try { await this.#recordInfo(file); }
    catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}

export class MemoryOperationStore implements OperationStore {
  readonly #records = new Map<string, StoredOperation>();
  failWrites = false;

  async initialize(): Promise<void> {}

  async list(): Promise<StoredOperation[]> {
    return structuredClone([...this.#records.values()]);
  }

  async save(record: StoredOperation): Promise<void> {
    if (this.failWrites) throw new Error("operation-store-write-failed");
    this.#records.set(record.operation.id, structuredClone(record));
  }
}
