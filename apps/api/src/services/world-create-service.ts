import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, realpath } from "node:fs/promises";
import path from "node:path";
import type { Operation, WorldCreateRequest } from "@mcsm/contracts";
import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { parseProperties, readBoundedRegularFile, SERVER_PROPERTIES_LIMIT, updatePropertiesText } from "../config/properties.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { worldIdentity, type ActiveWorldStateStore } from "./active-world-state-store.js";
import type { BackupManifest, BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import { WorldCreatePlanService } from "./world-create-plan-service.js";
import { readWorldRevision, readWorldVersion } from "./world-inventory-service.js";
import { copyRestoreTree, inventoryRestoreTree, makeRestoreDirectory, plainRestoreDirectory, restoreCapacity,
  restoreFilesChecksum, syncRestoreDirectory, verifyRestoreTree, writeRestoreJson } from "./restore-files.js";

type WorldState = Pick<ActiveWorldStateStore, "snapshot" | "prepareGeneration">;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const conflict = () => new DomainError(409, "WORLD_REVISION_CONFLICT", "世界或配置已变化，请重新生成计划", "world-create-conflict");
const recovery = () => new DomainError(409, "RECOVERY_REQUIRED", "新世界切换未完整结束；保护备份和旧世界已保留，请人工检查", "world-create-incomplete", true);
export class WorldCreateService {
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly backups: BackupService,
    private readonly managerRoot: string, private readonly states: WorldState, private readonly clock: Clock,
    private readonly inject?: (point: string) => Promise<void>) {}

  async create(serverId: string, body: WorldCreateRequest, key: string): Promise<Operation> {
    return this.operations.requestBackup(serverId, key, JSON.stringify(body), (ctx) => this.execute(serverId, body, ctx),
      async () => { await this.check(serverId, body); }, "world-create");
  }
  private async rootIdentity(adapter: LocalMinecraftServerAdapter): Promise<string> {
    await plainRestoreDirectory(adapter.plan.rootPath);
    const canonical = await realpath(adapter.plan.rootPath); const info = await lstat(canonical, { bigint: true });
    return hash(`world-create-root-v1\0${process.platform === "win32" ? canonical.toLowerCase() : canonical}\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`);
  }
  private async stopped(adapter: LocalMinecraftServerAdapter): Promise<void> {
    const state = await adapter.getStatus();
    if (state.state !== "stopped" || state.ownership !== "none" || state.recoveryRequired) throw recovery();
  }
  private async properties(adapter: LocalMinecraftServerAdapter): Promise<string> {
    const file = path.join(adapter.plan.rootPath, "server.properties");
    if ((await lstat(file)).nlink !== 1) throw conflict();
    return readBoundedRegularFile(file, SERVER_PROPERTIES_LIMIT, "server.properties");
  }
  private async check(serverId: string, body: WorldCreateRequest) {
    const plan = await new WorldCreatePlanService(this.registry, this.operations).plan(serverId, body);
    const adapter = this.registry.getLocal(serverId)!;
    if (!plan.worldRevision || plan.worldRevision !== body.worldRevision || plan.currentWorldName !== body.confirmWorldName) throw conflict();
    const current = this.states.snapshot(serverId);
    if (current?.state !== "active" || current.levelName !== plan.currentWorldName || current.worldId !== worldIdentity(serverId, plan.currentWorldName)) throw conflict();
    if (plan.requiresStop && !body.allowStop) throw new DomainError(409, "SERVER_MUST_BE_STOPPED", "需要明确允许停服", "allow-stop-required");
    return { adapter, plan };
  }
  private async checkpoint(record: TransactionJournalRecord, name: string, details?: { checksumSha256: string; resourceId?: string }): Promise<void> {
    await this.journal.appendCheckpoint(record.intent.serverId, record.transactionId,
      { name, recordedAt: this.clock.now().toISOString(), ...(details ? { details } : {}) });
    await this.inject?.(name);
  }
  private async guard(adapter: LocalMinecraftServerAdapter, record: TransactionJournalRecord): Promise<BackupManifest> {
    const change = record.intent.worldChange!; await this.stopped(adapter);
    const world = path.join(adapter.plan.rootPath, change.previousName);
    const files = await inventoryRestoreTree(world); const bytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    await plainRestoreDirectory(this.managerRoot);
    await makeRestoreDirectory(path.join(this.managerRoot, "backups"));
    const root = path.join(this.managerRoot, "backups", adapter.serverId); await makeRestoreDirectory(root); await restoreCapacity(root, bytes);
    const staging = path.join(root, change.guardBackupId + ".staging"); await mkdir(staging, { mode: 0o700 });
    await makeRestoreDirectory(path.join(staging, "payload"));
    await copyRestoreTree(world, path.join(staging, "payload", change.previousName), files);
    const entries = files.map((file) => ({ ...file, path: change.previousName + "/" + file.path }));
    const version = await readWorldVersion(world);
    if (!version || version !== (await adapter.getServerInfo()).minecraftVersion) throw new DomainError(409, "WORLD_VERSION_UNAVAILABLE", "当前世界版本无法确认或与服务端不一致", "world-version-mismatch");
    const manifest: BackupManifest = { schemaVersion: 1, id: change.guardBackupId, serverId: adapter.serverId,
      scope: "world-set", kind: "snapshot", label: "Before World Create", createdAt: this.clock.now().toISOString(),
      state: "complete", pinned: true, minecraftVersion: version, serverType: "vanilla", includedRoots: [change.previousName],
      fileCount: entries.length, sizeBytes: bytes, checksumSha256: restoreFilesChecksum(entries), files: entries,
      wasRunning: record.intent.originalState === "running", restarted: false, downtimeMs: null };
    await writeRestoreJson(path.join(staging, "manifest.json"), manifest);
    await this.stopped(adapter); await verifyRestoreTree(world, files);
    await rename(staging, path.join(root, change.guardBackupId)); await syncRestoreDirectory(root);
    await this.backups.exportSource(adapter.serverId, change.guardBackupId);
    return manifest;
  }
  private async writeSnapshot(file: string, text: string): Promise<void> {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await syncRestoreDirectory(path.dirname(file));
  }
  private async execute(serverId: string, body: WorldCreateRequest, ctx: RuntimeOperationContext): Promise<void> {
    const { adapter, plan } = await this.check(serverId, body);
    const before = await this.properties(adapter);
    const after = updatePropertiesText(before, { "level-name": body.name, "level-seed": body.seed });
    const workspaceName = `.manager-world-create-${ctx.operationId}`;
    const record = await this.journal.createIntent({ operationId: ctx.operationId, serverId, kind: "world-create", scope: "world-set",
      resourceId: worldIdentity(serverId, body.name), allowStop: body.allowStop, originalState: plan.requiresStop ? "running" : "stopped",
      createdAt: this.clock.now().toISOString(), paths: [
        { role: "source", namespace: "server", relativePath: plan.currentWorldName },
        { role: "target", namespace: "server", relativePath: body.name },
        { role: "staging", namespace: "server", relativePath: workspaceName }
      ], worldChange: { rootIdentity: await this.rootIdentity(adapter), previousName: plan.currentWorldName, nextName: body.name,
        approvedRevision: body.worldRevision, guardBackupId: randomUUID(), propertiesBefore: hash(before), propertiesAfter: hash(after), workspaceName } });
    try {
      await this.inject?.("intent-created");
      if (plan.requiresStop) { await ctx.onStep("stopping"); await adapter.stop(ctx); }
      await this.stopped(adapter);
      if (hash(await this.properties(adapter)) !== hash(before)) throw conflict();
      if (await this.rootIdentity(adapter) !== record.intent.worldChange!.rootIdentity) throw recovery();
      await this.checkTarget(adapter, body.name);
      if ((parseProperties(before).get("level-name") ?? "world") !== plan.currentWorldName) throw conflict();
      await this.checkpoint(record, "stop-confirmed", { checksumSha256: await readWorldRevision(serverId, plan.currentWorldName, path.join(adapter.plan.rootPath, plan.currentWorldName)) });
      await ctx.onStep("creating-pre-create-guard"); const guard = await this.guard(adapter, record);
      await this.checkpoint(record, "guard-verified", { checksumSha256: guard.checksumSha256, resourceId: guard.id });
      await ctx.onResult?.({ resourceId: guard.id, rollbackAvailable: false });
      const workspace = path.join(adapter.plan.rootPath, workspaceName); await mkdir(workspace, { mode: 0o700 });
      await syncRestoreDirectory(adapter.plan.rootPath);
      await this.writeSnapshot(path.join(workspace, "properties.before"), before);
      await this.writeSnapshot(path.join(workspace, "properties.after"), after);
      await this.checkpoint(record, "config-ready");
      await this.stopped(adapter); await this.checkTarget(adapter, body.name);
      if (hash(await this.properties(adapter)) !== hash(before) || await this.rootIdentity(adapter) !== record.intent.worldChange!.rootIdentity) throw conflict();
      await this.verifyGuard(adapter, record);
      await this.checkpoint(record, "config-switch-intent");
      await ctx.onStep("switching-world-config");
      await rename(path.join(workspace, "properties.after"), path.join(adapter.plan.rootPath, "server.properties"));
      await syncRestoreDirectory(adapter.plan.rootPath); await syncRestoreDirectory(workspace);
      await this.checkpoint(record, "config-installed");
      if (hash(await this.properties(adapter)) !== hash(after)) throw recovery();
      await this.stopped(adapter); await this.checkTarget(adapter, body.name);
      await this.states.prepareGeneration(serverId, plan.currentWorldName, body.name);
      await this.checkpoint(record, "active-state-installed");
      await this.stopped(adapter);
      if (hash(await this.properties(adapter)) !== hash(after) || await this.rootIdentity(adapter) !== record.intent.worldChange!.rootIdentity) throw recovery();
      await this.verifyGuard(adapter, record);
      await this.inject?.("before-commit");
      await this.journal.setState(serverId, record.transactionId, "committed", this.clock.now().toISOString());
      await this.inject?.("after-commit");
    } catch {
      try { await this.journal.setState(serverId, record.transactionId, "recovery-required", this.clock.now().toISOString()); } catch { /* Active journal is retained. */ }
      throw recovery();
    }
  }
  private async checkTarget(adapter: LocalMinecraftServerAdapter, name: string): Promise<void> {
    const { readdir } = await import("node:fs/promises");
    if ((await readdir(adapter.plan.rootPath)).some((entry) => entry.toLowerCase() === name.toLowerCase())) throw conflict();
  }
  private async verifyGuard(adapter: LocalMinecraftServerAdapter, record: TransactionJournalRecord): Promise<void> {
    const w = record.intent.worldChange!;
    const { manifest, directory } = await this.backups.exportSource(adapter.serverId, w.guardBackupId);
    const checkpoint = record.checkpoints.find((c) => c.name === "guard-verified") ?? (await this.journal.get(adapter.serverId, record.transactionId)).checkpoints.find((c) => c.name === "guard-verified");
    if (!manifest.pinned || manifest.includedRoots.length !== 1 || manifest.includedRoots[0] !== w.previousName || checkpoint?.details?.checksumSha256 !== manifest.checksumSha256 || checkpoint.details.resourceId !== manifest.id) throw recovery();
    const files = manifest.files.map((file) => {
      if (!file.path.startsWith(w.previousName + "/")) throw recovery();
      return { ...file, path: file.path.slice(w.previousName.length + 1) };
    });
    await verifyRestoreTree(path.join(directory, "payload", w.previousName), files);
    await verifyRestoreTree(path.join(adapter.plan.rootPath, w.previousName), files);
  }
  async reconcileStartup(): Promise<void> {
    const scan = await this.journal.scan(); const outcomes = new Map((await this.operations.storedOutcomes()).map((op) => [op.id, op]));
    for (const record of scan.records.filter((r) => r.intent.worldChange)) {
      const serverId = record.intent.serverId; const w = record.intent.worldChange!;
      try {
        const adapter = this.registry.getLocal(serverId); if (!adapter || await this.rootIdentity(adapter) !== w.rootIdentity) throw recovery();
        if (record.state !== "committed") throw recovery();
        if (outcomes.get(record.intent.operationId)?.state === "succeeded") continue;
        await this.stopped(adapter); await this.checkTarget(adapter, w.nextName);
        if (hash(await this.properties(adapter)) !== w.propertiesAfter) throw recovery();
        const state = JSON.parse(await readBoundedRegularFile(path.join(this.managerRoot, "active-worlds", `${serverId}.json`), 16 * 1024, "活动世界状态"));
        if (state.state !== "pending-generation" || state.serverId !== serverId || state.levelName !== w.nextName || state.worldId !== worldIdentity(serverId, w.nextName)) throw recovery();
        const saved = await readBoundedRegularFile(path.join(adapter.plan.rootPath, w.workspaceName, "properties.before"), SERVER_PROPERTIES_LIMIT, "配置保护副本");
        if (hash(saved) !== w.propertiesBefore) throw recovery();
        await this.verifyGuard(adapter, record);
        this.operations.confirmPhysicalTransaction(record.intent.operationId);
      } catch { this.operations.requireTransactionRecovery(serverId, record.intent.operationId); }
    }
  }
}
