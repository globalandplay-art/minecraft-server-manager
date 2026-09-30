import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import path from "node:path";

import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import { parseProperties, readBoundedRegularFile, SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import { DomainError } from "./domain-errors.js";

export type ActiveWorldState = {
  schemaVersion: 1;
  serverId: string;
  state: "active" | "pending-generation" | "none";
  worldId: string | null;
  levelName: string | null;
};

export function worldIdentity(serverId: string, levelName: string): string {
  return `world-${createHash("sha256").update(serverId).update("\0").update(levelName).digest("hex").slice(0, 24)}`;
}

export class ActiveWorldStateStore {
  readonly #directory: string;
  readonly #adapters: readonly LocalMinecraftServerAdapter[];
  readonly #states = new Map<string, ActiveWorldState>();
  readonly #recovery = new Set<string>();

  constructor(managerRoot: string, adapters: readonly LocalMinecraftServerAdapter[]) {
    this.#directory = path.join(path.resolve(managerRoot), "active-worlds");
    this.#adapters = adapters;
  }

  async initialize(): Promise<ReadonlySet<string>> {
    const managerRoot = path.dirname(this.#directory);
    await mkdir(managerRoot, { recursive: true, mode: 0o700 });
    const managerInfo = await lstat(managerRoot);
    if (!managerInfo.isDirectory() || managerInfo.isSymbolicLink()) {
      throw new Error("Active world manager root must be a real directory");
    }
    const managerReal = await realpath(managerRoot);
    const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalized(managerReal) !== normalized(managerRoot)) throw new Error("Active world manager root must be canonical");
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.#directory);
    const canonical = await realpath(this.#directory);
    if (!info.isDirectory() || info.isSymbolicLink() || normalized(canonical) !== normalized(this.#directory)) {
      throw new Error("Active world state directory must be a real directory");
    }

    for (const adapter of this.#adapters) {
      if (adapter.plan.serverInfo.type !== "vanilla") continue;
      try {
        const props = parseProperties(await readBoundedRegularFile(
          path.join(adapter.plan.rootPath, "server.properties"), SERVER_PROPERTIES_LIMIT, "server.properties"
        ));
        const levelName = props.get("level-name") ?? "world";
        if (levelName.length < 1 || levelName.length > 128 || path.basename(levelName) !== levelName ||
            /[\\/:\u0000-\u001f\u007f]/u.test(levelName) || levelName === "." || levelName === ".." || /[. ]$/u.test(levelName)) {
          throw new Error("Invalid active world name");
        }
        const expected: ActiveWorldState = {
          schemaVersion: 1,
          serverId: adapter.serverId,
          state: (await this.#worldExists(adapter.plan.rootPath, levelName)) ? "active" : "pending-generation",
          worldId: worldIdentity(adapter.serverId, levelName),
          levelName
        };
        const file = path.join(this.#directory, `${adapter.serverId}.json`);
        let existing: ActiveWorldState | null = null;
        try {
          const fileInfo = await lstat(file);
          const fileReal = await realpath(file);
          if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size > 16 * 1024 ||
              normalized(fileReal) !== normalized(file)) throw new Error("Unsafe active world state file");
          const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
          if (!this.#isState(parsed) || parsed.serverId !== adapter.serverId) throw new Error("Invalid active world state");
          existing = parsed;
        } catch (error) {
          if (!this.#isMissing(error)) throw error;
        }
        if (existing === null) {
          await this.#write(file, expected);
          existing = expected;
        } else if (existing.state === "none") {
          throw new Error("No active world is configured");
        } else if (existing.levelName !== expected.levelName || existing.worldId !== expected.worldId ||
          (existing.state === "active" && expected.state !== "active")) {
          throw new Error("Active world identity does not match server configuration");
        } else if (existing.state === "pending-generation" && expected.state === "active") {
          await this.#write(file, expected);
          existing = expected;
        }
        this.#states.set(adapter.serverId, existing);
      } catch {
        this.#recovery.add(adapter.serverId);
      }
    }
    return new Set(this.#recovery);
  }

  isActive(serverId: string, worldId: string): boolean {
    if (this.#recovery.has(serverId)) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "recovery-required");
    }
    const state = this.#states.get(serverId);
    return state?.state === "active" && state.worldId === worldId;
  }

  async reconcileAfterStart(serverId: string): Promise<void> {
    if (this.#recovery.has(serverId)) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "recovery-required");
    }
    const current = this.#states.get(serverId);
    if (current?.state !== "pending-generation") return;
    try {
      const adapter = this.#adapters.find((candidate) => candidate.serverId === serverId);
      if (adapter === undefined) throw new Error("Active world adapter missing");
      const properties = parseProperties(await readBoundedRegularFile(
        path.join(adapter.plan.rootPath, "server.properties"), SERVER_PROPERTIES_LIMIT, "server.properties"
      ));
      const levelName = properties.get("level-name") ?? "world";
      if (current.levelName !== levelName || current.worldId !== worldIdentity(serverId, levelName)) {
        throw new Error("Active world identity changed");
      }
      if (await this.#worldExists(adapter.plan.rootPath, levelName)) {
        const next: ActiveWorldState = { ...current, state: "active" };
        await this.#write(path.join(this.#directory, `${serverId}.json`), next);
        this.#states.set(serverId, next);
      }
    } catch {
      this.#recovery.add(serverId);
      throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要人工恢复检查", "active-world-commit-failed", true);
    }
  }

  #isState(value: unknown): value is ActiveWorldState {
    if (typeof value !== "object" || value === null) return false;
    const state = value as Partial<ActiveWorldState>;
    return Object.keys(value).every((key) => ["schemaVersion", "serverId", "state", "worldId", "levelName"].includes(key)) &&
      state.schemaVersion === 1 && typeof state.serverId === "string" &&
      ["active", "pending-generation", "none"].includes(state.state ?? "") &&
      (state.worldId === null || typeof state.worldId === "string") &&
      (state.levelName === null || typeof state.levelName === "string");
  }

  async #worldExists(root: string, name: string): Promise<boolean> {
    const target = path.join(root, name);
    try {
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe world directory");
      const levelData = path.join(target, "level.dat");
      try {
        const levelInfo = await lstat(levelData);
        if (!levelInfo.isFile() || levelInfo.isSymbolicLink()) throw new Error("Unsafe world level data");
        return true;
      } catch (error) {
        if (this.#isMissing(error)) return false;
        throw error;
      }
    } catch (error) {
      if (this.#isMissing(error)) return false;
      throw error;
    }
  }

  #isMissing(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
  }

  async #write(file: string, state: ActiveWorldState): Promise<void> {
    const temporary = path.join(this.#directory, `${state.serverId}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
  }
}
