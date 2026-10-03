import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { WorldCreatePlanRequest, WorldCreatePlanResponse } from "@mcsm/contracts";
import { isLocalAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import { parseProperties, readBoundedRegularFile, SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { ServerNotFoundError } from "./server-service.js";
import { readWorldRevision } from "./world-inventory-service.js";

const reserved = new Set(["mods", "plugins", "libraries", "logs", "versions", "cache", "config", "runtime", "servers", "trash", "disabled-mods", "disabled-plugins", "backups"]);
export function validNewWorldName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && name.trim() === name && !name.startsWith(".") && !/[\\/:<>"|?*\u0000-\u001f\u007f]/u.test(name) &&
    !/[. ]$/u.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name) &&
    !reserved.has(name.toLowerCase());
}
const unsafe = () => new DomainError(409, "WORLD_LAYOUT_UNSAFE", "世界目录或配置未通过安全检查", "unsafe-world-plan");
const missing = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
async function plainDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || normalized(await realpath(directory)) !== normalized(path.resolve(directory))) throw unsafe();
}

/** Read-only preview; actual creation must revalidate under the instance lock. */
export class WorldCreatePlanService {
  constructor(private readonly registry: AdapterRegistry, private readonly operations: Pick<OperationService, "getServerState">,
    private readonly executionAvailable = false) {}

  async plan(serverId: string, input: WorldCreatePlanRequest): Promise<WorldCreatePlanResponse["data"]> {
    if (!validNewWorldName(input.name) || input.seed.length > 20 || !/^(?:|-?(?:0|[1-9][0-9]*))$/u.test(input.seed)) {
      throw new DomainError(400, "VALIDATION_ERROR", "世界名或 Seed 格式无效", "invalid-world-plan");
    }
    const seed = input.seed === "" ? null : BigInt(input.seed);
    if (seed !== null && (seed < -(1n << 63n) || seed > (1n << 63n) - 1n)) {
      throw new DomainError(400, "VALIDATION_ERROR", "Seed 必须在有符号 64 位整数范围内", "seed-out-of-range");
    }
    const adapter = this.registry.get(serverId);
    if (!adapter) throw new ServerNotFoundError();
    if (!isLocalAdapter(adapter) || adapter.plan.serverInfo.type !== "vanilla") {
      throw new DomainError(501, "CAPABILITY_UNSUPPORTED", "新世界计划目前只支持本地 Vanilla", "unsupported-world-create");
    }
    const status = await adapter.getStatus();
    if (this.operations.getServerState(serverId).recoveryRequired || status.recoveryRequired) {
      throw new DomainError(409, "RECOVERY_REQUIRED", "实例需要先完成恢复检查", "recovery-required");
    }
    if (!((status.state === "stopped" && status.ownership === "none") || (status.state === "running" && status.ownership === "managed"))) {
      throw new DomainError(409, "SERVER_STATE_CONFLICT", "当前服务器状态不允许规划世界切换", "unmanaged-or-unknown-state");
    }
    const info = await adapter.getServerInfo();
    if (!info.minecraftVersion) throw new DomainError(409, "WORLD_VERSION_UNAVAILABLE", "无法确认新世界目标版本", "unknown-target-version");
    const root = adapter.plan.rootPath;
    await plainDirectory(root);
    // Check all names case-insensitively, including files and junctions.
    if ((await readdir(root)).some((name) => name.toLowerCase() === input.name.toLowerCase())) {
      throw new DomainError(409, "WORLD_NAME_CONFLICT", "目标名称已被使用，请选择新的世界名", "target-exists");
    }
    const properties = parseProperties(await readBoundedRegularFile(path.join(root, "server.properties"), SERVER_PROPERTIES_LIMIT, "server.properties"));
    const current = properties.get("level-name") ?? "world";
    if (path.basename(current) !== current || !current || current.length > 128 || /[\\/:<>"|?*\u0000-\u001f\u007f]/u.test(current) || [".", ".."].includes(current) || /[. ]$/u.test(current)) throw unsafe();
    const currentRoot = path.join(root, current);
    let revision: string | null = null;
    try {
      await plainDirectory(currentRoot);
      revision = await readWorldRevision(serverId, current, currentRoot);
    } catch (error) { if (!missing(error)) throw error; }
    return { serverId, name: input.name, seed: seed === null ? null : seed.toString(), minecraftVersion: info.minecraftVersion,
      currentWorldName: current, worldRevision: revision, requiresStop: status.state === "running",
      generation: "on-explicit-start", executionAvailable: this.executionAvailable && revision !== null };
  }
}
