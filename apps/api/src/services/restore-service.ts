import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import path from "node:path";
import type { Operation, RestorePlanResponse, RestoreRequest, RollbackRequest, RestoreHistoryResponse } from "@mcsm/contracts";
import { isLocalAdapter, type LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { parseProperties, readBoundedRegularFile, SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { worldIdentity } from "./active-world-state-store.js";
import type { BackupManifest, BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { ServerNotFoundError } from "./server-service.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import { readWorldRevision, readWorldVersion } from "./world-inventory-service.js";
import {
  copyRestoreTree, failLayout, inventoryRestoreTree, makeRestoreDirectory, missingFile,
  plainRestoreDirectory, restoreCapacity, restoreFilesChecksum, safeRestorePath,
  syncRestoreDirectory, verifyRestoreTree, writeRestoreJson, type RestoreFile
} from "./restore-files.js";

type Plan = RestorePlanResponse["data"];
const revisionConflict = () => new DomainError(409, "WORLD_REVISION_CONFLICT", "世界已发生变化，请刷新确认信息", "stale-world-revision");
const recovery = () => new DomainError(409, "RECOVERY_REQUIRED", "恢复未完整结束；文件已保留，请检查并显式回滚", "restore-incomplete", true);

/** One writer owns reservation, guard, swap, launch and explicit recovery. */
export class RestoreService {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly operations: OperationService,
    private readonly backups: BackupService,
    private readonly journal: TransactionJournalStore,
    private readonly managerRoot: string,
    private readonly clock: Clock,
    private readonly inject?: (point: string) => Promise<void>
  ) {}

  async reconcileStartup(): Promise<void> {
    const scan = await this.journal.scan();
    const outcomes = new Map((await this.operations.storedOutcomes()).map((op) => [op.id, op]));
    const verified = new Set<string>(); const invalidRoots = new Set<string>();
    for (const record of scan.records.filter((r) => r.intent.restore)) {
      try { await this.#binding(this.#adapter(record.intent.serverId), record); }
      catch { invalidRoots.add(record.intent.operationId); }
    }
    for (const record of scan.records.filter((r) => r.intent.restore)) {
      const serverId = record.intent.serverId;
      if (invalidRoots.has(record.intent.operationId)) { this.operations.requireTransactionRecovery(serverId, record.intent.operationId); continue; }
      if (!["committed", "rolled-back"].includes(record.state) || verified.has(record.intent.operationId)) continue;
      const outcome = outcomes.get(record.intent.operationId);
      const established = outcome?.state === "succeeded" || (outcome?.state === "failed" && outcome.step === "rolled-back" && !outcome.error);
      const parent = record.intent.kind === "restore" ? record : scan.records.find((r) => r.transactionId === record.intent.restore!.parentTransactionId);
      const siblingsPending = parent && scan.records.some((r) => r.intent.restore?.parentTransactionId === parent.transactionId && ["active", "recovery-required"].includes(r.state));
      // Established outcomes may legitimately have changed during later play.
      // Only uncertain completion and unfinished parent/siblings require hashes.
      if (established && !siblingsPending && (record.intent.kind === "restore" || parent?.state === "rolled-back")) continue;
      try {
        if (scan.issues.some((i) => i.serverId === serverId)) throw recovery();
        const adapter = this.#adapter(serverId);
        await this.#stopped(adapter);
        if (!parent || invalidRoots.has(parent.intent.operationId)) throw recovery();
        const r = parent.intent.restore;
        if (!r || parent.intent.kind !== "restore" || parent.intent.serverId !== serverId || await this.#worldName(adapter) !== r.levelName) throw failLayout();
        const guard = await this.#source(serverId, r.guardBackupId, r.levelName);
        const checkpoint = parent.checkpoints.find((c) => c.name === "guard-verified");
        if (!guard.manifest.pinned || checkpoint?.details?.checksumSha256 !== guard.manifest.checksumSha256 ||
          checkpoint.details.resourceId !== guard.manifest.id) throw recovery();
        const committedChild = scan.records.find((item) => item.state === "committed" && item.intent.restore?.parentTransactionId === parent.transactionId);
        if (record.intent.kind === "restore" && record.state === "committed" && !committedChild) {
          const source = await this.#source(serverId, r.backupId, r.levelName);
          if (source.manifest.checksumSha256 !== r.backupChecksum || !record.checkpoints.some((c) => c.name === "installed-verified")) throw recovery();
          await verifyRestoreTree(path.join(adapter.plan.rootPath, r.workspaceName, "previous"), guard.files);
          await verifyRestoreTree(path.join(adapter.plan.rootPath, r.levelName), source.files);
          this.operations.confirmPhysicalTransaction(record.intent.operationId); verified.add(record.intent.operationId);
        } else {
          const child = record.intent.kind === "rollback" && record.state === "committed" ? record : committedChild;
          if (!child || child.state !== "committed" || invalidRoots.has(child.intent.operationId) || child.intent.restore?.backupChecksum !== guard.manifest.checksumSha256) throw recovery();
          await verifyRestoreTree(path.join(adapter.plan.rootPath, r.levelName), guard.files);
          await this.journal.finalizeRollback(serverId, parent.transactionId, child.transactionId, this.clock.now().toISOString(), this.inject);
          for (const related of scan.records.filter((item) => item.transactionId === parent.transactionId || item.intent.restore?.parentTransactionId === parent.transactionId)) {
            this.operations.confirmPhysicalTransaction(related.intent.operationId); verified.add(related.intent.operationId);
          }
        }
      } catch {
        // Durable journal completion cannot prove a Windows directory rename
        // survived power loss. Retain a transaction-owned recovery cause when
        // physical files/process are not exactly verifiable; never move files.
        this.operations.requireTransactionRecovery(serverId, record.intent.operationId);
      }
    }
  }

  async #rootIdentity(adapter: LocalMinecraftServerAdapter): Promise<string> {
    await plainRestoreDirectory(adapter.plan.rootPath);
    const canonical = await realpath(adapter.plan.rootPath);
    const info = await lstat(canonical, { bigint: true });
    const normalized = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    return createHash("sha256").update(`restore-root-v1\0${normalized}\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`).digest("hex");
  }

  async #binding(adapter: LocalMinecraftServerAdapter, record: TransactionJournalRecord): Promise<void> {
    if (!record.intent.restore?.rootIdentity || record.intent.restore.rootIdentity !== await this.#rootIdentity(adapter)) {
      this.operations.requireTransactionRecovery(adapter.serverId, record.intent.operationId);
      throw recovery();
    }
  }

  #adapter(serverId: string): LocalMinecraftServerAdapter {
    const adapter = this.registry.get(serverId);
    if (!adapter) throw new ServerNotFoundError();
    if (!isLocalAdapter(adapter) || adapter.plan.serverInfo.type !== "vanilla") {
      throw new DomainError(501, "CAPABILITY_UNSUPPORTED", "仅支持本地 Vanilla 世界集恢复", "unsupported-restore-layout");
    }
    return adapter;
  }

  async #worldName(adapter: LocalMinecraftServerAdapter): Promise<string> {
    await plainRestoreDirectory(adapter.plan.rootPath);
    const props = parseProperties(await readBoundedRegularFile(path.join(adapter.plan.rootPath, "server.properties"), SERVER_PROPERTIES_LIMIT, "server.properties"));
    const name = props.get("level-name") ?? "world";
    if (name.length > 128 || name.includes("/") || !safeRestorePath(name)) throw failLayout();
    return name;
  }

  async #source(serverId: string, backupId: string, name: string) {
    const source = await this.backups.exportSource(serverId, backupId);
    const m = source.manifest;
    if (m.serverType !== "vanilla" || m.includedRoots.length !== 1 || m.includedRoots[0] !== name ||
      m.files.length > 100_000 || m.sizeBytes > 250 * 1024 ** 3) throw failLayout();
    const files = m.files.map((f) => {
      if (!f.path.startsWith(name + "/")) throw failLayout();
      return { ...f, path: f.path.slice(name.length + 1) };
    });
    if (new Set(files.map((f) => f.path.toLowerCase())).size !== files.length || !files.every((f) => safeRestorePath(f.path))) throw failLayout();
    const root = path.join(source.directory, "payload", name);
    await plainRestoreDirectory(path.join(source.directory, "payload"));
    await verifyRestoreTree(root, files);
    const actualVersion = await readWorldVersion(root);
    if (actualVersion === null || actualVersion !== m.minecraftVersion) throw new DomainError(409, "VERSION_INCOMPATIBLE", "备份版本无法可靠确认", "backup-version-unavailable");
    return { ...source, root, files };
  }

  #version(adapter: LocalMinecraftServerAdapter, version: string | null): void {
    // No implicit upgrade/downgrade or snapshot compatibility promises in P3.2.
    if (version === null || !/^\d+(?:\.\d+){1,2}$/u.test(version) || version !== adapter.plan.serverInfo.minecraftVersion) {
      throw new DomainError(409, "VERSION_INCOMPATIBLE", "仅支持与已识别服务端版本完全一致的世界", "exact-version-required");
    }
  }

  async plan(serverId: string, backupId: string): Promise<Plan> {
    const adapter = this.#adapter(serverId);
    const name = await this.#worldName(adapter);
    const source = await this.#source(serverId, backupId, name);
    this.#version(adapter, source.manifest.minecraftVersion);
    this.#version(adapter, await readWorldVersion(path.join(adapter.plan.rootPath, name)));
    return { worldName: name, worldRevision: await readWorldRevision(serverId, name, path.join(adapter.plan.rootPath, name)),
      backupId, minecraftVersion: source.manifest.minecraftVersion!, sizeBytes: source.manifest.sizeBytes, rollbackAvailable: false };
  }

  async #checkConfirmation(adapter: LocalMinecraftServerAdapter, plan: Plan, name: string, revision: string): Promise<void> {
    if (plan.worldName !== name || plan.worldRevision !== revision) throw revisionConflict();
    const status = await adapter.getStatus();
    const safe = (status.state === "stopped" && status.ownership === "none") || (status.state === "running" && status.ownership === "managed");
    if (!safe || status.recoveryRequired) throw new DomainError(409, "ACTION_UNAVAILABLE", "实例状态不能安全切换世界", "unsafe-restore-state");
  }

  async restore(serverId: string, backupId: string, body: RestoreRequest, key: string): Promise<Operation> {
    const adapter = this.#adapter(serverId);
    return this.operations.requestBackup(serverId, key, JSON.stringify({ backupId, ...body }),
      (ctx) => this.#restore(ctx, adapter, backupId, body),
      async () => { await this.#checkConfirmation(adapter, await this.plan(serverId, backupId), body.confirmWorldName, body.worldRevision); }, "restore");
  }

  async #checkpoint(record: TransactionJournalRecord, name: string, details?: { resourceId?: string; checksumSha256?: string }): Promise<void> {
    await this.inject?.("before:" + name);
    await this.journal.appendCheckpoint(record.intent.serverId, record.transactionId, {
      name, recordedAt: this.clock.now().toISOString(), ...(details ? { details } : {})
    });
    await this.inject?.("after:" + name);
  }

  async #stopped(adapter: LocalMinecraftServerAdapter): Promise<void> {
    const state = await adapter.getStatus();
    if (state.state !== "stopped" || state.ownership !== "none" || state.recoveryRequired) throw recovery();
  }

  async #stop(adapter: LocalMinecraftServerAdapter, ctx: RuntimeOperationContext, owner?: string): Promise<void> {
    const state = await adapter.getStatus();
    if (state.state === "stopped" && state.ownership === "none" && !state.recoveryRequired) return;
    if (owner && state.recoveryRequired && state.ownership === "managed" && adapter.stopOwnedForRecovery) {
      await adapter.stopOwnedForRecovery(ctx, owner);
    } else if (state.state === "running" && state.ownership === "managed" && !state.recoveryRequired) {
      await ctx.onStep("stopping"); await adapter.stop(ctx);
    } else throw recovery();
    await this.#stopped(adapter);
  }

  async #guard(adapter: LocalMinecraftServerAdapter, record: TransactionJournalRecord): Promise<BackupManifest> {
    await this.#binding(adapter, record);
    const r = record.intent.restore!;
    await this.#stopped(adapter);
    const world = path.join(adapter.plan.rootPath, r.levelName);
    const files = await inventoryRestoreTree(world);
    const bytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    await plainRestoreDirectory(this.managerRoot);
    await makeRestoreDirectory(path.join(this.managerRoot, "backups"));
    const root = path.join(this.managerRoot, "backups", adapter.serverId);
    await makeRestoreDirectory(root);
    await restoreCapacity(root, bytes);
    const staging = path.join(root, r.guardBackupId + ".staging");
    await mkdir(staging, { mode: 0o700 });
    await makeRestoreDirectory(path.join(staging, "payload"));
    await copyRestoreTree(world, path.join(staging, "payload", r.levelName), files);
    const entries = files.map((f) => ({ ...f, path: r.levelName + "/" + f.path }));
    const manifest: BackupManifest = {
      schemaVersion: 1, id: r.guardBackupId, serverId: adapter.serverId, scope: "world-set", kind: "snapshot",
      label: "Before Restore", state: "complete", pinned: true, createdAt: this.clock.now().toISOString(),
      minecraftVersion: await readWorldVersion(world), serverType: "vanilla", includedRoots: [r.levelName],
      fileCount: entries.length, sizeBytes: bytes, checksumSha256: restoreFilesChecksum(entries),
      wasRunning: record.intent.originalState === "running", restarted: false, downtimeMs: null, files: entries
    };
    this.#version(adapter, manifest.minecraftVersion);
    await writeRestoreJson(path.join(staging, "manifest.json"), manifest);
    await this.#stopped(adapter);
    await verifyRestoreTree(world, files);
    await rename(staging, path.join(root, r.guardBackupId));
    await syncRestoreDirectory(root);
    await this.#source(adapter.serverId, r.guardBackupId, r.levelName);
    return manifest;
  }

  async #swap(adapter: LocalMinecraftServerAdapter, record: TransactionJournalRecord, files: readonly RestoreFile[]): Promise<void> {
    await this.#binding(adapter, record);
    const r = record.intent.restore!;
    const workspace = path.join(adapter.plan.rootPath, r.workspaceName);
    const world = path.join(adapter.plan.rootPath, r.levelName);
    await this.#stopped(adapter);
    await plainRestoreDirectory(workspace);
    await plainRestoreDirectory(adapter.plan.rootPath);
    let worldExists = true;
    try { await lstat(world); } catch (error) { if (!missingFile(error)) throw error; worldExists = false; }
    if (worldExists) {
      await plainRestoreDirectory(world);
      await this.#checkpoint(record, "move-old-intent");
      await this.inject?.("before:rename-old");
      await rename(world, path.join(workspace, "previous"));
      await syncRestoreDirectory(adapter.plan.rootPath); await syncRestoreDirectory(workspace);
      await this.inject?.("after:rename-old");
      await this.#checkpoint(record, "old-moved");
    } else if (record.intent.kind !== "rollback") throw recovery();
    await this.#stopped(adapter);
    if (await this.#worldName(adapter) !== r.levelName) throw revisionConflict();
    await this.#checkpoint(record, "install-new-intent");
    await this.inject?.("before:rename-new");
    await rename(path.join(workspace, "incoming"), world);
    await syncRestoreDirectory(adapter.plan.rootPath); await syncRestoreDirectory(workspace);
    await this.inject?.("after:rename-new");
    await verifyRestoreTree(world, files);
    await this.#checkpoint(record, "new-installed");
  }

  async #start(adapter: LocalMinecraftServerAdapter, ctx: RuntimeOperationContext, record: TransactionJournalRecord, files: readonly RestoreFile[]): Promise<void> {
    await this.#stopped(adapter);
    if (!record.intent.restore!.startAfter) return;
    await this.#checkpoint(record, "start-intent");
    await adapter.revalidateBeforeStart();
    await ctx.onStep("starting-restored-world");
    // Drain existing log lines before subscribing: an old ERROR must not be
    // attributed to this launch. Keep only a boolean, not an unbounded log list.
    await adapter.getLogs(undefined, 1);
    let launchError = false;
    const unsubscribe = adapter.subscribe((event) => {
      if (event.type === "log" && (event.entry.level === "error" ||
        /Encountered an unexpected exception|Exception in server tick loop|This crash report has been saved|A fatal error has been detected/iu.test(event.entry.text))) launchError = true;
    });
    try {
      await this.#binding(adapter, record);
      const r = record.intent.restore!;
      await this.#stopped(adapter);
      if (await this.#worldName(adapter) !== r.levelName || worldIdentity(adapter.serverId, r.levelName) !== r.worldId) throw revisionConflict();
      await verifyRestoreTree(path.join(adapter.plan.rootPath, r.levelName), files);
      await adapter.start(ctx);
      // Bounded one-second post-readiness window also flushes the log tailer.
      // Runtime.start already supplies the bounded launch/readiness deadline.
      const deadline = Date.now() + 1000;
      while (true) {
        await adapter.getLogs(undefined, 1);
        const state = await adapter.getStatus();
        if (launchError || ctx.signal.aborted || state.state !== "running" || state.ownership !== "managed" || state.recoveryRequired) throw recovery();
        if (Date.now() >= deadline) break;
        const delayMs = Math.min(100, deadline - Date.now());
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    } finally { unsubscribe(); }
    await this.#checkpoint(record, "start-verified");
  }

  async #failed(adapter: LocalMinecraftServerAdapter, ctx: RuntimeOperationContext, record: TransactionJournalRecord): Promise<never> {
    try {
      const status = await adapter.getStatus();
      if (status.ownership === "managed" && adapter.stopOwnedForRecovery) await adapter.stopOwnedForRecovery(ctx, ctx.operationId);
    } catch { /* Unconfirmed process means no further filesystem writes. */ }
    try { await this.journal.setState(adapter.serverId, record.transactionId, "recovery-required", this.clock.now().toISOString()); }
    catch { /* The operation layer also fail-closes on persistence errors. */ }
    throw recovery();
  }

  async #restore(ctx: RuntimeOperationContext, adapter: LocalMinecraftServerAdapter, backupId: string, body: RestoreRequest): Promise<void> {
    const plan = await this.plan(adapter.serverId, backupId);
    await this.#checkConfirmation(adapter, plan, body.confirmWorldName, body.worldRevision);
    const source = await this.#source(adapter.serverId, backupId, plan.worldName);
    await restoreCapacity(adapter.plan.rootPath, source.manifest.sizeBytes);
    const original = await adapter.getStatus();
    const guardBackupId = randomUUID();
    const workspaceName = ".manager-restore-" + randomUUID();
    const record = await this.journal.createIntent({
      operationId: ctx.operationId, serverId: adapter.serverId, kind: "restore", scope: "world-set", resourceId: backupId,
      originalState: original.state === "running" ? "running" : "stopped", allowStop: body.allowStop, createdAt: this.clock.now().toISOString(),
      paths: [
        { role: "source", namespace: "manager", relativePath: `backups/${adapter.serverId}/${backupId}` },
        { role: "target", namespace: "server", relativePath: plan.worldName },
        { role: "staging", namespace: "server", relativePath: workspaceName },
        { role: "rollback", namespace: "manager", relativePath: `backups/${adapter.serverId}/${guardBackupId}` }
      ],
      restore: { rootIdentity: await this.#rootIdentity(adapter), backupId, guardBackupId, levelName: plan.worldName, worldId: worldIdentity(adapter.serverId, plan.worldName),
        approvedRevision: plan.worldRevision, backupChecksum: source.manifest.checksumSha256, parentTransactionId: null,
        startAfter: body.startAfterRestore, workspaceName }
    });
    try {
      await this.#checkpoint(record, "stop-intent");
      await this.#stop(adapter, ctx);
      if (await this.#worldName(adapter) !== plan.worldName) throw revisionConflict();
      const stoppedRevision = await readWorldRevision(adapter.serverId, plan.worldName, path.join(adapter.plan.rootPath, plan.worldName));
      await this.#checkpoint(record, "stop-confirmed", { checksumSha256: stoppedRevision });
      await ctx.onStep("creating-pre-restore-guard");
      const guard = await this.#guard(adapter, record);
      await this.#checkpoint(record, "guard-verified", { resourceId: guard.id, checksumSha256: guard.checksumSha256 });
      await ctx.onResult?.({ resourceId: guard.id, rollbackAvailable: true });
      await restoreCapacity(adapter.plan.rootPath, source.manifest.sizeBytes);
      const workspace = path.join(adapter.plan.rootPath, workspaceName);
      await mkdir(workspace, { mode: 0o700 }); await syncRestoreDirectory(adapter.plan.rootPath);
      await ctx.onStep("staging-world");
      await copyRestoreTree(source.root, path.join(workspace, "incoming"), source.files);
      await this.#checkpoint(record, "staging-verified", { checksumSha256: source.manifest.checksumSha256 });
      const guardSource = await this.#source(adapter.serverId, guard.id, plan.worldName);
      await verifyRestoreTree(path.join(adapter.plan.rootPath, plan.worldName), guardSource.files);
      await ctx.onStep("switching-world");
      await this.#swap(adapter, record, source.files);
      await this.#checkpoint(record, "installed-verified");
      await this.#start(adapter, ctx, record, source.files);
      await this.inject?.("before:commit");
      await this.journal.setState(adapter.serverId, record.transactionId, "committed", this.clock.now().toISOString());
    } catch { return this.#failed(adapter, ctx, record); }
  }

  async #parent(serverId: string, operationId: string): Promise<TransactionJournalRecord> {
    await this.operations.assertRecoveryOwner(serverId, operationId);
    const scan = await this.journal.scan();
    const record = scan.records.find((r) => r.intent.serverId === serverId && r.intent.operationId === operationId && r.intent.kind === "restore" && r.intent.restore);
    if (!record || record.state === "rolled-back") throw recovery();
    await this.#binding(this.#adapter(serverId), record);
    const r = record.intent.restore!;
    if (r.worldId !== worldIdentity(serverId, r.levelName) || r.parentTransactionId !== null) throw failLayout();
    const expectedPaths = [
      ["source", "manager", `backups/${serverId}/${r.backupId}`], ["target", "server", r.levelName],
      ["staging", "server", r.workspaceName], ["rollback", "manager", `backups/${serverId}/${r.guardBackupId}`]
    ];
    if (record.intent.paths.length !== 4 || !expectedPaths.every(([role, namespace, relativePath]) => record.intent.paths.some((p) => p.role === role && p.namespace === namespace && p.relativePath === relativePath))) throw failLayout();
    const guard = await this.#source(serverId, r.guardBackupId, r.levelName);
    const checkpoint = record.checkpoints.find((c) => c.name === "guard-verified");
    if (!guard.manifest.pinned || checkpoint?.details?.resourceId !== r.guardBackupId || checkpoint.details.checksumSha256 !== guard.manifest.checksumSha256) throw recovery();
    // A missing active directory is safe to recover only when the retained old
    // directory physically matches the pinned guard. No inference from a step.
    const adapter = this.#adapter(serverId);
    const old = path.join(adapter.plan.rootPath, r.workspaceName, "previous");
    try { await lstat(old); await verifyRestoreTree(old, guard.files); }
    catch (error) {
      if (!missingFile(error)) throw error;
      try { await plainRestoreDirectory(path.join(adapter.plan.rootPath, r.levelName)); } catch { throw recovery(); }
    }
    return record;
  }

  async #rollbackRevision(adapter: LocalMinecraftServerAdapter, parent: TransactionJournalRecord): Promise<string> {
    const r = parent.intent.restore!;
    if (await this.#worldName(adapter) !== r.levelName) throw revisionConflict();
    try { return await readWorldRevision(adapter.serverId, r.levelName, path.join(adapter.plan.rootPath, r.levelName)); }
    catch (error) {
      if (!missingFile(error)) throw error;
      const guard = await this.#source(adapter.serverId, r.guardBackupId, r.levelName);
      await verifyRestoreTree(path.join(adapter.plan.rootPath, r.workspaceName, "previous"), guard.files);
      return createHash("sha256").update(`missing-world-v1\0${parent.transactionId}\0${guard.manifest.checksumSha256}`).digest("hex");
    }
  }

  async rollbackPlan(serverId: string, operationId: string): Promise<Plan> {
    const adapter = this.#adapter(serverId);
    const parent = await this.#parent(serverId, operationId);
    const r = parent.intent.restore!;
    const guard = await this.#source(serverId, r.guardBackupId, r.levelName);
    this.#version(adapter, guard.manifest.minecraftVersion);
    return { worldName: r.levelName, worldRevision: await this.#rollbackRevision(adapter, parent), backupId: guard.manifest.id,
      minecraftVersion: guard.manifest.minecraftVersion!, sizeBytes: guard.manifest.sizeBytes, rollbackAvailable: true };
  }

  async history(serverId: string): Promise<RestoreHistoryResponse["data"]> {
    this.#adapter(serverId);
    const scan = await this.journal.scan();
    const items = [];
    for (const record of scan.records.filter((r) => r.intent.serverId === serverId && r.intent.kind === "restore" && r.intent.restore).slice(-1000)) {
      let rollbackAvailable = false;
      try { if (record.state !== "rolled-back") { await this.#parent(serverId, record.intent.operationId); rollbackAvailable = true; } }
      catch { /* Unsafe history remains visible without a recovery action. */ }
      items.push({ operationId: record.intent.operationId, backupId: record.intent.restore!.backupId, state: record.state, rollbackAvailable });
    }
    return { items };
  }

  async rollback(serverId: string, parentOperationId: string, body: RollbackRequest, key: string): Promise<Operation> {
    const adapter = this.#adapter(serverId);
    const check = async () => {
      const plan = await this.rollbackPlan(serverId, parentOperationId);
      if (body.confirmWorldName !== plan.worldName || body.worldRevision !== plan.worldRevision) throw revisionConflict();
    };
    return this.operations.requestBackup(serverId, key, JSON.stringify({ parentOperationId, ...body }),
      (ctx) => this.#rollback(ctx, adapter, parentOperationId, body), check, "rollback", parentOperationId);
  }

  async #rollback(ctx: RuntimeOperationContext, adapter: LocalMinecraftServerAdapter, parentOperationId: string, body: RollbackRequest): Promise<void> {
    const parent = await this.#parent(adapter.serverId, parentOperationId);
    const r = parent.intent.restore!;
    if (body.confirmWorldName !== r.levelName || body.worldRevision !== await this.#rollbackRevision(adapter, parent)) throw revisionConflict();
    const guard = await this.#source(adapter.serverId, r.guardBackupId, r.levelName);
    this.#version(adapter, guard.manifest.minecraftVersion);
    const record = await this.journal.createIntent({
      operationId: ctx.operationId, serverId: adapter.serverId, kind: "rollback", scope: "world-set", resourceId: r.guardBackupId,
      originalState: "unknown", allowStop: true, createdAt: this.clock.now().toISOString(),
      paths: [{ role: "source", namespace: "manager", relativePath: `backups/${adapter.serverId}/${r.guardBackupId}` },
        { role: "target", namespace: "server", relativePath: r.levelName },
        { role: "staging", namespace: "server", relativePath: ".manager-restore-" + ctx.operationId }],
      restore: { ...r, backupId: r.guardBackupId, backupChecksum: guard.manifest.checksumSha256, approvedRevision: body.worldRevision,
        parentTransactionId: parent.transactionId, startAfter: body.startAfterRollback, workspaceName: ".manager-restore-" + ctx.operationId }
    });
    try {
      await ctx.onResult?.({ resourceId: r.guardBackupId, rollbackAvailable: true });
      await this.#checkpoint(record, "stop-intent");
      await this.#stop(adapter, ctx, parentOperationId);
      await this.#checkpoint(record, "stop-confirmed");
      await restoreCapacity(adapter.plan.rootPath, guard.manifest.sizeBytes);
      const workspace = path.join(adapter.plan.rootPath, record.intent.restore!.workspaceName);
      await mkdir(workspace, { mode: 0o700 }); await syncRestoreDirectory(adapter.plan.rootPath);
      await copyRestoreTree(guard.root, path.join(workspace, "incoming"), guard.files);
      await this.#checkpoint(record, "staging-verified", { checksumSha256: guard.manifest.checksumSha256 });
      await this.#swap(adapter, record, guard.files);
      await this.#checkpoint(record, "installed-verified");
      await this.#start(adapter, ctx, record, guard.files);
      await this.inject?.("before:commit");
      await this.journal.setState(adapter.serverId, record.transactionId, "committed", this.clock.now().toISOString());
      await this.inject?.("after:rollback-commit");
      await this.journal.finalizeRollback(adapter.serverId, parent.transactionId, record.transactionId, this.clock.now().toISOString(), this.inject);
      const scan = await this.journal.scan();
      const related = scan.records.filter((item) => item.transactionId === parent.transactionId || item.intent.restore?.parentTransactionId === parent.transactionId);
      await this.operations.resolveOwnedRecovery(adapter.serverId, related.map((item) => item.intent.operationId));
      await ctx.onResult?.({ resourceId: r.guardBackupId, rollbackAvailable: false });
    } catch { return this.#failed(adapter, ctx, record); }
  }
}
