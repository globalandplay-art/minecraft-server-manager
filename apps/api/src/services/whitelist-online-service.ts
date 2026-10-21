import path from "node:path";
import { createHash } from "node:crypto";
import type { WhitelistResponse, WhitelistMutationResponse, WhitelistCandidatesResponse } from "@mcsm/contracts";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { Clock } from "../clock.js";
import type { WhitelistRconSession } from "../infra/runtime-contract.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import type { WhitelistService } from "./whitelist-service.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { PropertiesReader } from "./properties-reader.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { readStoredWhitelist, WHITELIST_BYTES } from "./whitelist-reader.js";
import { compareWhitelistMemberEvidence, parseWhitelistMemberIntent, whitelistMemberRevision, type WhitelistMemberSnapshot } from "./whitelist-member-policy.js";
import { discoverWhitelistCandidates } from "./whitelist-candidates.js";
import { openWhitelistLogWindow } from "./whitelist-log-window.js";

type Result = WhitelistMutationResponse["data"];
const unavailable = () => new DomainError(409, "WHITELIST_UNAVAILABLE", "需要当前实例的受管 Vanilla 26.3 进程及可用 RCON；不会自动开启 RCON");
/** Strict English Vanilla response grammar; unsupported output is UNKNOWN, never success. */
export function parseWhitelistList(output: string): string[] {
  if (output.trim() === "There are no whitelisted players") return [];
  const match = /^There are (\d{1,4}) whitelisted player\(s\):(?: ([A-Za-z0-9_, ]+))?$/u.exec(output.trim());
  if (!match) throw unavailable();
  const names = match[2] ? match[2].split(", ") : [];
  if (names.length !== Number(match[1]) || names.length > 1000 || names.some(name => !/^[A-Za-z0-9_]{3,16}$/u.test(name)) ||
    new Set(names.map(name => name.toLowerCase())).size !== names.length) throw unavailable();
  return names;
}
const sameNames = (names: readonly string[], snapshot: WhitelistMemberSnapshot) => names.length === snapshot.members.length &&
  snapshot.members.every(row => names.some(name => name.toLowerCase() === row.name.toLowerCase()));

/** Local single-send workflow. Reuses instance exclusion and owned RCON; no native
 * CommandStore/GuardStore, background execution, retries or startup replay. */
export class WhitelistOnlineService {
  private readonly reader = new PropertiesReader();
  private readonly requests = new Map<string, { hash: string; done: boolean; promise: Promise<Result> }>();
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly saved: WhitelistService, private readonly clock: Clock) {}

  private adapter(serverId: string): LocalMinecraftServerAdapter {
    if (!this.registry.get(serverId)) throw new DomainError(404, "SERVER_NOT_FOUND", "未找到服务器实例");
    const adapter = this.registry.getLocal(serverId);
    if (!adapter || adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3") throw unavailable();
    return adapter;
  }
  private async root(adapter: LocalMinecraftServerAdapter): Promise<string> {
    const identity = adapter.getRegisteredExecutionIdentity?.().rootIdentity;
    if (!identity || await backupDirectoryIdentity(adapter.plan.rootPath) !== identity) throw unavailable();
    return identity;
  }
  private async healthy(adapter: LocalMinecraftServerAdapter): Promise<void> {
    const status = await adapter.getStatus();
    if (status.state !== "running" || status.ownership !== "managed" || status.recoveryRequired || status.activeOperationId) throw unavailable();
  }
  private async open(adapter: LocalMinecraftServerAdapter): Promise<WhitelistRconSession> {
    await this.root(adapter); await this.healthy(adapter);
    const runtime = adapter.getRuntime();
    if (!runtime.openWhitelistSession) throw unavailable();
    try { return await runtime.openWhitelistSession(); } catch { throw unavailable(); }
  }
  private async capture(adapter: LocalMinecraftServerAdapter, session: WhitelistRconSession): Promise<WhitelistMemberSnapshot> {
    const rootIdentity = await this.root(adapter);
    const config = await this.reader.read(adapter.serverId, adapter.plan.rootPath);
    const members = await readStoredWhitelist(adapter.plan.rootPath);
    const file = await readPrivatePropertiesFile(path.join(adapter.plan.rootPath, "whitelist.json"), WHITELIST_BYTES);
    try {
      const rows: unknown = JSON.parse(file.bytes.toString("utf8"));
      if (!Array.isArray(rows) || rows.length !== members.length || rows.some((row, index) => !row ||
        Object.keys(row).sort().join(",") !== "name,uuid" || row.name !== members[index]!.name ||
        typeof row.uuid !== "string" || row.uuid.toLowerCase() !== members[index]!.uuid) ||
        (await this.reader.read(adapter.serverId, adapter.plan.rootPath)).revision !== config.revision || await this.root(adapter) !== rootIdentity) throw unavailable();
      return { serverId: adapter.serverId, rootIdentity, configRevision: config.revision, runtimeId: session.runtimeId,
        fileIdentity: file.identity, fileSha256: file.checksum, members };
    } finally { file.bytes.fill(0); }
  }
  async read(serverId: string): Promise<WhitelistResponse["data"]> {
    const saved = await this.saved.read(serverId);
    const fallback: WhitelistResponse["data"] = { ...saved, executionMode: "direct-rcon", membershipWritable: false,
      writeReason: "MEMBER_RULE_UNAVAILABLE", writeUnavailableReason: "managed-rcon-unavailable",
      runtime: { available: false, reason: "managed-rcon-unavailable", names: [], consistent: null } };
    try {
      return await this.operations.runExclusive(serverId, async () => {
        const adapter = this.adapter(serverId), session = await this.open(adapter);
        try {
          const before = await this.capture(adapter, session), names = parseWhitelistList(await session.list());
          const after = await this.capture(adapter, session); await this.healthy(adapter);
          if (whitelistMemberRevision(before) !== whitelistMemberRevision(after)) throw unavailable();
          if (!sameNames(names, after)) return { ...fallback, items: [...after.members], writeUnavailableReason: "runtime-saved-mismatch",
            runtime: { available: true, reason: null, names, consistent: false } };
          return { ...saved, executionMode: "direct-rcon", membershipWritable: true, writeReason: null,
            items: [...after.members], revision: whitelistMemberRevision(after), sampledAt: this.clock.now().toISOString(),
            runtime: { available: true, reason: null, names, consistent: true } };
        } finally { session.close(); }
      });
    } catch { return fallback; }
  }
  async candidates(serverId: string): Promise<WhitelistCandidatesResponse["data"]> {
    const sampledAt = this.clock.now().toISOString();
    try { return await this.operations.runExclusive(serverId, async () => {
      const adapter = this.adapter(serverId);
      return discoverWhitelistCandidates(adapter.plan.rootPath, await this.root(adapter), sampledAt);
    }); } catch { return { availability: "unavailable", reason: "candidate-read-unavailable", sampledAt, items: [] }; }
  }
  async mutate(serverId: string, raw: unknown, key: string, authorize: OperationAdmission): Promise<Result> {
    const request = parseWhitelistMemberIntent(raw); authorize(); this.adapter(serverId);
    const scope = `${serverId}:${key}`, hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const previous = this.requests.get(scope);
    if (previous) {
      if (previous.hash !== hash) throw new DomainError(409, "OPERATION_CONFLICT", "本次请求标识已用于其他操作");
      return previous.promise;
    }
    // Bounded process-local duplicate protection only. No promise of cross-restart exactly-once.
    if (this.requests.size >= 256) {
      const completed = [...this.requests].find(([, row]) => row.done);
      if (!completed) throw new DomainError(503, "WHITELIST_BUSY", "白名单请求繁忙，请稍后刷新");
      this.requests.delete(completed[0]);
    }
    const entry = { hash, done: false, promise: undefined as unknown as Promise<Result> };
    entry.promise = this.operations.runExclusive(serverId, async () => {
      authorize(); const adapter = this.adapter(serverId), session = await this.open(adapter);
      let attempted = false;
      let logWindow: Awaited<ReturnType<typeof openWhitelistLogWindow>> | undefined;
      const result = (outcome: Result["outcome"], code: string, message: string, relatedErrorObserved: boolean | null = null): Result =>
        ({ serverId, action: request.action, name: request.name, outcome, code, message, relatedErrorObserved });
      try {
        const before = await this.capture(adapter, session), live = parseWhitelistList(await session.list());
        if (!sameNames(live, before)) return result("failed", "WHITELIST_MISMATCH", "运行时与保存名单不一致，请先检查并刷新");
        const exists = before.members.some(row => row.name.toLowerCase() === request.name.toLowerCase());
        if (request.action === "add" && exists) return result("failed", "ALREADY_WHITELISTED", "该玩家已在白名单中");
        if (request.action === "remove" && !exists) return result("failed", "NOT_WHITELISTED", "该玩家不在白名单中");
        if (request.action === "add" && before.members.length >= 1000) return result("failed", "WHITELIST_CAPACITY", "名单已达到受控读取上限");
        if (request.revision !== whitelistMemberRevision(before)) return result("failed", "WHITELIST_REVISION_CONFLICT", "名单已变化，请刷新后重新确认");
        try { logWindow = await openWhitelistLogWindow(adapter.plan.rootPath, before.rootIdentity); }
        catch { throw new DomainError(409, "WHITELIST_LOG_UNAVAILABLE", "本次操作无法建立可信日志观察窗口，请检查当前实例日志后刷新"); }
        const fresh = await this.capture(adapter, session); await this.healthy(adapter); authorize();
        if (whitelistMemberRevision(fresh) !== whitelistMemberRevision(before)) return result("failed", "WHITELIST_REVISION_CONFLICT", "名单已变化，请刷新后重新确认");
        attempted = true;
        const output = (await session[request.action](request.name, authorize)).trim();
        await this.healthy(adapter);
        const after = await this.capture(adapter, session), afterNames = parseWhitelistList(await session.list());
        const confirmed = await this.capture(adapter, session); await this.healthy(adapter);
        const relatedError = await logWindow.finish();
        if (relatedError || whitelistMemberRevision(after) !== whitelistMemberRevision(confirmed) || !sameNames(afterNames, confirmed))
          return result("unknown", "WHITELIST_RESULT_UNKNOWN", "结果未知：运行日志或保存名单未能完整确认；不会自动重发", relatedError);
        const unchanged = before.fileSha256 === confirmed.fileSha256;
        if (unchanged && output === "That player does not exist") return result("failed", "PLAYER_NOT_FOUND", "Minecraft 未能解析该玩家账号", false);
        if (unchanged && output === "Player is already whitelisted") return result("failed", "ALREADY_WHITELISTED", "Minecraft 返回该玩家已在白名单中", false);
        if (unchanged && output === "Player is not whitelisted") return result("failed", "NOT_WHITELISTED", "Minecraft 返回该玩家不在白名单中", false);
        const reply = /^(Added|Removed) ([A-Za-z0-9_]{3,16}) (to|from) the whitelist$/u.exec(output);
        if (!reply || reply[1] !== (request.action === "add" ? "Added" : "Removed") || reply[3] !== (request.action === "add" ? "to" : "from") ||
          reply[2]!.toLowerCase() !== request.name.toLowerCase() || compareWhitelistMemberEvidence(request, before, confirmed, afterNames) !== "consistent-change")
          return result("unknown", "WHITELIST_RESULT_UNKNOWN", "结果未知：Minecraft 响应与保存结果未能一致确认；不会自动重发", false);
        return result("succeeded", "WHITELIST_UPDATED", request.action === "add" ? "玩家已添加到白名单" : "玩家已从白名单删除", false);
      } catch (error) {
        if (!attempted && error instanceof DomainError) return result("failed", error.code, error.safeMessage);
        return result(attempted ? "unknown" : "failed", attempted ? "WHITELIST_RESULT_UNKNOWN" : "WHITELIST_UNAVAILABLE",
          attempted ? "结果未知：命令响应丢失、运行状态或保存结果无法确认；不会自动重发" : "白名单操作不可用；请检查实例、文件及 RCON 状态");
      } finally { try { await logWindow?.close(); } finally { session.close(); } }
    }).finally(() => { entry.done = true; });
    this.requests.set(scope, entry); return entry.promise;
  }
}
