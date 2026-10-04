import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { Operation } from "@mcsm/contracts";
import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { createRedactor, isSensitiveKey } from "../infra/runtime/redactor.js";
import { worldIdentity, type ActiveWorldStateStore } from "./active-world-state-store.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { editablePropertyEntries, parseEditableProperties } from "./properties-grammar.js";
import { PropertiesGuardStore } from "./properties-guard.js";
import { patchPropertiesExact } from "./properties-patch.js";
import { PropertiesReader, PROPERTY_KEYS } from "./properties-reader.js";
import { propertiesChecksum, readPrivatePropertiesFile } from "./properties-private-file.js";
import { establishedPropertiesOutcome, propertiesCheckpointIdentity, verifyCommittedProperties } from "./properties-reconciliation.js";
import { missingFile, safeRestorePath, syncRestoreDirectory } from "./restore-files.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import { readWorldRevision } from "./world-inventory-service.js";

type Request = { changes: Readonly<Record<string, string>>; revision: string; confirmOfflineIdentity: boolean };
type WorldBinding = { worldId: string; worldRevision: string; levelName: string };
const conflict = () => new DomainError(409, "PROPERTIES_REVISION_CONFLICT", "配置或世界状态已变化，请刷新后重新确认", "properties-conflict");
const recovery = () => new DomainError(409, "RECOVERY_REQUIRED", "配置切换未完整确认；旧配置与保护备份保留，请人工核验", "properties-write-interrupted", true);

/** Coupled write core behind the properties API. All mutations use durable admission; no implicit restart. */
export class PropertiesWriteService {
  readonly reader = new PropertiesReader();
  constructor(readonly registry: AdapterRegistry, readonly operations: OperationService,
    readonly journal: TransactionJournalStore, readonly managerRoot: string,
    readonly states: Pick<ActiveWorldStateStore, "snapshot">, readonly clock: Clock,
    readonly inject?: (point: string) => Promise<void>) {}

  async read(serverId: string) {
    return this.operations.runExclusive(serverId, async () => {
      const adapter = this.local(serverId);
      return this.reader.read(serverId, adapter.plan.rootPath);
    });
  }

  fieldRules(serverId: string) {
    const known = this.local(serverId).plan.serverInfo.minecraftVersion === "26.3";
    return Object.fromEntries(PROPERTY_KEYS.map((key) => {
      const editable = known && key !== "view-distance" && key !== "simulation-distance";
      return [key, { editable, restartRequired: true, reason: editable ? null : "VERSION_RULE_UNAVAILABLE" }];
    }));
  }

  async save(serverId: string, body: Request, key: string): Promise<Operation> {
    this.validate(body, key);
    const request: Request = { revision: body.revision, confirmOfflineIdentity: body.confirmOfflineIdentity,
      changes: Object.fromEntries(Object.entries(body.changes).sort(([a], [b]) => a.localeCompare(b))) };
    let binding: WorldBinding | undefined;
    return this.operations.requestBackup(serverId, key, JSON.stringify(request), async (ctx) => {
      if (!binding) throw conflict();
      await this.execute(serverId, request, binding, ctx);
    }, async () => { binding = (await this.check(serverId, request)).binding; }, "properties-write");
  }

  private validate(body: Request, key: string): void {
    const invalid = () => new DomainError(400, "VALIDATION_ERROR", "配置修改字段或确认无效", "invalid-properties-write");
    if (!body || typeof body !== "object" || Object.keys(body).some((name) => !["changes", "revision", "confirmOfflineIdentity"].includes(name)) ||
      typeof body.revision !== "string" || !/^[0-9a-f]{64}$/u.test(body.revision) || typeof body.confirmOfflineIdentity !== "boolean" ||
      typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key) ||
      !body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) throw invalid();
    const entries = Object.entries(body.changes);
    if (!entries.length || entries.length > 6) throw invalid();
    for (const [name, value] of entries) {
      if (["view-distance", "simulation-distance"].includes(name)) throw new DomainError(409, "VERSION_RULE_UNAVAILABLE", "距离字段尚无已验证版本规则，当前只读", "version-rule-unavailable");
      if (typeof value !== "string" || Buffer.from(value, "utf8").toString("utf8") !== value || /[\u0000-\u001f\u007f]/u.test(value)) throw invalid();
      if (name === "max-players") { if (!/^[1-9]\d{0,4}$/u.test(value) || Number(value) > 10000) throw invalid(); }
      else if (name === "difficulty") { if (!["peaceful", "easy", "normal", "hard"].includes(value)) throw invalid(); }
      else if (name === "gamemode") { if (!["survival", "creative", "adventure", "spectator"].includes(value)) throw invalid(); }
      else if (name === "pvp" || name === "online-mode") { if (!["true", "false"].includes(value)) throw invalid(); }
      else if (name === "motd") { if (Buffer.byteLength(value, "utf8") > 1024) throw invalid(); }
      else throw invalid();
    }
    if (body.changes["online-mode"] === "false" && !body.confirmOfflineIdentity) throw invalid();
  }

  private local(serverId: string): LocalMinecraftServerAdapter {
    const adapter = this.registry.getLocal(serverId);
    if (!adapter) throw new DomainError(this.registry.get(serverId) ? 501 : 404, "ACTION_UNAVAILABLE", "需要已注册的本地 Vanilla 实例", "properties-local-unavailable");
    if (adapter.plan.serverInfo.type !== "vanilla") throw new DomainError(409, "VERSION_INCOMPATIBLE", "配置保存当前仅支持 Vanilla", "unsupported-server-type");
    return adapter;
  }

  private async gate(adapter: LocalMinecraftServerAdapter, operationId?: string): Promise<WorldBinding> {
    const state = await adapter.getStatus();
    const operation = this.operations.getServerState(adapter.serverId);
    if (state.state !== "stopped" || state.ownership !== "none" || state.recoveryRequired || operation.recoveryRequired ||
      (state.activeOperationId !== null && state.activeOperationId !== operationId) ||
      (operation.activeOperationId !== null && operation.activeOperationId !== operationId)) {
      throw new DomainError(409, "SERVER_MUST_BE_STOPPED", "需要已确认停止且无其他操作或恢复锁的实例", "properties-write-not-admitted");
    }
    const active = this.states.snapshot(adapter.serverId);
    if (active?.state !== "active" || !active.levelName || active.worldId !== worldIdentity(adapter.serverId, active.levelName) ||
      !safeRestorePath(active.levelName) || active.levelName.includes("/")) throw new DomainError(409, "NO_ACTIVE_WORLD", "实例没有已确认的活动世界", "properties-active-world-unavailable");
    const world = path.join(adapter.plan.rootPath, active.levelName);
    await backupDirectoryIdentity(world);
    return { worldId: active.worldId, levelName: active.levelName,
      worldRevision: await readWorldRevision(adapter.serverId, active.levelName, world) };
  }

  private async check(serverId: string, body: Request, operationId?: string) {
    const adapter = this.local(serverId);
    if (adapter.plan.serverInfo.minecraftVersion !== "26.3") {
      throw new DomainError(409, "VERSION_RULE_UNAVAILABLE", "当前版本尚无确认的配置修改规则，只允许读取", "properties-version-read-only");
    }
    const binding = await this.gate(adapter, operationId);
    const snapshot = await this.reader.snapshot(serverId, adapter.plan.rootPath);
    if (snapshot.revision !== body.revision || (parseEditableProperties(snapshot.bytes.toString("utf8")).get("level-name") ?? "world") !== binding.levelName) throw conflict();
    const secrets = editablePropertyEntries(snapshot.bytes.toString("utf8")).filter(([name]) => isSensitiveKey(name)).map(([, value]) => value);
    const redactor = createRedactor({ secrets: () => secrets });
    if (Object.values(body.changes).some((value) => redactor.redactText(value) !== value)) throw new DomainError(400, "VALIDATION_ERROR", "修改内容不能包含敏感信息", "sensitive-property-value");
    return { adapter, binding, snapshot };
  }

  private async checkpoint(record: TransactionJournalRecord, name: string, checksumSha256?: string) {
    await this.journal.appendCheckpoint(record.intent.serverId, record.transactionId, {
      name, recordedAt: this.clock.now().toISOString(), ...(checksumSha256 ? { details: { checksumSha256 } } : {})
    });
    await this.inject?.(name);
  }

  private async execute(serverId: string, body: Request, approved: WorldBinding, ctx: RuntimeOperationContext) {
    const { adapter, binding, snapshot } = await this.check(serverId, body, ctx.operationId);
    if (JSON.stringify(binding) !== JSON.stringify(approved)) throw conflict();
    const root = adapter.plan.rootPath;
    const after = Buffer.from(patchPropertiesExact(snapshot.bytes.toString("utf8"), body.changes), "utf8");
    const guardId = randomUUID(); const workspaceName = `.manager-properties-${ctx.operationId}`;
    const record = await this.journal.createIntent({ operationId: ctx.operationId, serverId, kind: "properties-write", scope: null,
      resourceId: guardId, allowStop: false, originalState: "stopped", createdAt: this.clock.now().toISOString(),
      paths: [{ role: "target", namespace: "server", relativePath: "server.properties" },
        { role: "staging", namespace: "server", relativePath: workspaceName },
        { role: "rollback", namespace: "manager", relativePath: `properties-backups/${serverId}/${guardId}` }],
      propertiesWrite: { rootIdentity: snapshot.rootIdentity, worldId: binding.worldId, worldRevision: binding.worldRevision,
        originalFileIdentity: snapshot.fileIdentity, originalChecksum: snapshot.checksum, preparedChecksum: propertiesChecksum(after), guardId, workspaceName } });
    try {
      await this.inject?.("properties-intent-created");
      const guards = new PropertiesGuardStore(this.managerRoot, this.journal);
      await guards.create(serverId, record.transactionId, root);
      await this.inject?.("properties-guard-complete");
      const workspace = path.join(root, workspaceName);
      const target = path.join(root, "server.properties"); const prepared = path.join(workspace, "prepared.properties");
      const old = path.join(workspace, "old.properties");
      await this.checkpoint(record, "properties-workspace-intent");
      await this.assertOriginal(adapter, body, binding, snapshot, ctx.operationId);
      if ((await readdir(root)).some((entry) => entry.toLowerCase() === workspaceName.toLowerCase())) throw conflict();
      await mkdir(workspace, { mode: 0o700 }); await syncRestoreDirectory(root);
      const workspaceIdentity = await backupDirectoryIdentity(workspace);
      await this.checkpoint(record, "properties-workspace-verified", workspaceIdentity);
      await this.assertOriginal(adapter, body, binding, snapshot, ctx.operationId);
      await this.checkpoint(record, "properties-prepare-intent");
      await this.assertOriginal(adapter, body, binding, snapshot, ctx.operationId);
      if (await backupDirectoryIdentity(workspace) !== workspaceIdentity || (await readdir(workspace)).length !== 0) throw recovery();
      const output = await open(prepared, "wx", 0o600);
      try { await output.writeFile(after); await output.sync(); } finally { await output.close(); }
      await syncRestoreDirectory(workspace);
      const newFile = await readPrivatePropertiesFile(prepared);
      if (newFile.checksum !== record.intent.propertiesWrite!.preparedChecksum || !newFile.bytes.equals(after)) throw recovery();
      await this.checkpoint(record, "properties-prepared-verified", newFile.identity);
      const checkLayout = async (entries: string[]) => {
        if (await backupDirectoryIdentity(root) !== snapshot.rootIdentity || await backupDirectoryIdentity(workspace) !== workspaceIdentity ||
          (await readdir(workspace)).sort().join("\0") !== entries.sort().join("\0")) throw recovery();
        await guards.verify(record, root);
        if (JSON.stringify(await this.gate(adapter, ctx.operationId)) !== JSON.stringify(binding)) throw recovery();
      };
      await this.checkpoint(record, "properties-old-move-intent");
      await this.assertOriginal(adapter, body, binding, snapshot, ctx.operationId);
      await checkLayout(["prepared.properties"]);
      if ((await readPrivatePropertiesFile(prepared)).identity !== newFile.identity || (await readPrivatePropertiesFile(prepared)).checksum !== newFile.checksum) throw recovery();
      await rename(target, old); await syncRestoreDirectory(root); await syncRestoreDirectory(workspace);
      const moved = await readPrivatePropertiesFile(old);
      if (moved.identity !== snapshot.fileIdentity || moved.checksum !== snapshot.checksum) throw recovery();
      await this.checkpoint(record, "properties-old-moved");
      await this.checkpoint(record, "properties-install-intent");
      await checkLayout(["old.properties", "prepared.properties"]);
      const currentOld = await readPrivatePropertiesFile(old); const currentPrepared = await readPrivatePropertiesFile(prepared);
      if (currentOld.identity !== snapshot.fileIdentity || currentOld.checksum !== snapshot.checksum ||
        currentPrepared.identity !== newFile.identity || currentPrepared.checksum !== newFile.checksum) throw recovery();
      try { await lstat(target); throw recovery(); } catch (error) { if (!missingFile(error)) throw error; }
      await rename(prepared, target); await syncRestoreDirectory(root); await syncRestoreDirectory(workspace);
      await this.checkpoint(record, "properties-installed");
      await checkLayout(["old.properties"]);
      const installed = await readPrivatePropertiesFile(target);
      // NTFS name tunnelling may change creation time when a replacement adopts a recently vacated name.
      // Require the actual prepared inode and bytes, then persist its post-rename full identity.
      if (installed.physicalIdentity !== newFile.physicalIdentity || installed.checksum !== newFile.checksum) throw recovery();
      await this.checkpoint(record, "properties-installed-file-verified", installed.identity);
      await this.checkpoint(record, "properties-installed-verified", installed.checksum);
      await checkLayout(["old.properties"]);
      if ((await readPrivatePropertiesFile(target)).checksum !== newFile.checksum) throw recovery();
      await ctx.onResult?.({ resourceId: guardId, rollbackAvailable: false });
      await this.inject?.("properties-before-commit");
      await checkLayout(["old.properties"]);
      const finalTarget = await readPrivatePropertiesFile(target);
      const finalOld = await readPrivatePropertiesFile(old);
      if (ctx.signal.aborted || finalTarget.identity !== installed.identity || finalTarget.checksum !== newFile.checksum ||
        finalOld.identity !== snapshot.fileIdentity || finalOld.checksum !== snapshot.checksum) throw recovery();
      await this.journal.setState(serverId, record.transactionId, "committed", this.clock.now().toISOString());
      await this.inject?.("properties-after-commit");
      await checkLayout(["old.properties"]);
      const publishedTarget = await readPrivatePropertiesFile(target);
      const publishedOld = await readPrivatePropertiesFile(old);
      if (ctx.signal.aborted || publishedTarget.identity !== installed.identity || publishedTarget.checksum !== newFile.checksum ||
        publishedOld.identity !== snapshot.fileIdentity || publishedOld.checksum !== snapshot.checksum) throw recovery();
    } catch {
      try { await this.journal.setState(serverId, record.transactionId, "recovery-required", this.clock.now().toISOString()); } catch { /* Keep active/terminal evidence; never delete or auto-rollback. */ }
      throw recovery();
    }
  }

  private async assertOriginal(adapter: LocalMinecraftServerAdapter, body: Request, binding: WorldBinding,
    snapshot: Awaited<ReturnType<PropertiesReader["snapshot"]>>, operationId: string) {
    const current = await this.check(adapter.serverId, body, operationId);
    if (current.snapshot.rootIdentity !== snapshot.rootIdentity || current.snapshot.fileIdentity !== snapshot.fileIdentity ||
      current.snapshot.checksum !== snapshot.checksum || JSON.stringify(current.binding) !== JSON.stringify(binding)) throw conflict();
  }

  async reconcileStartup(): Promise<void> {
    const scan = await this.journal.scan(); const outcomes = await this.operations.storedOutcomes();
    for (const record of scan.records.filter((item) => item.intent.propertiesWrite)) {
      const adapter = this.registry.getLocal(record.intent.serverId);
      try {
        if (!adapter) throw recovery();
        const established = establishedPropertiesOutcome(record, outcomes);
        await verifyCommittedProperties(this.managerRoot, this.journal, record, adapter.plan.rootPath, established);
        if (!established) {
          const status = await adapter.getStatus();
          if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired) throw recovery();
          const currentTarget = await readPrivatePropertiesFile(path.join(adapter.plan.rootPath, "server.properties"));
          if (currentTarget.identity !== propertiesCheckpointIdentity(record, "properties-installed-file-verified") ||
            currentTarget.checksum !== record.intent.propertiesWrite!.preparedChecksum) throw recovery();
          const name = parseEditableProperties(currentTarget.bytes.toString("utf8")).get("level-name") ?? "world";
          if (!safeRestorePath(name) || name.includes("/") || worldIdentity(adapter.serverId, name) !== record.intent.propertiesWrite!.worldId ||
            await readWorldRevision(adapter.serverId, name, path.join(adapter.plan.rootPath, name)) !== record.intent.propertiesWrite!.worldRevision) throw recovery();
          await verifyCommittedProperties(this.managerRoot, this.journal, record, adapter.plan.rootPath, false);
        }
        this.operations.confirmPhysicalTransaction(record.intent.operationId);
      } catch { this.operations.requireTransactionRecovery(record.intent.serverId, record.intent.operationId); }
    }
  }
}
