import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rename } from "node:fs/promises";
import path from "node:path";
import type { Operation, WorldArchiveInfo, WorldArchiveRequest } from "@mcsm/contracts";
import { isLocalAdapter, type LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { parseProperties, readBoundedRegularFile, SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { worldIdentity, type ActiveWorldStateStore } from "./active-world-state-store.js";
import type { BackupManifest, BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { ServerNotFoundError } from "./server-service.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import { inspectVanillaWorld, readWorldRevision, readWorldVersion } from "./world-inventory-service.js";
import { copyRestoreTree, inventoryRestoreTree, makeRestoreDirectory, missingFile, plainRestoreDirectory,
  restoreCapacity, restoreFilesChecksum, syncRestoreDirectory, verifyRestoreTree, writeRestoreJson } from "./restore-files.js";

type WorldState = Pick<ActiveWorldStateStore, "snapshot" | "archiveCurrentWorld">;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const conflict = () => new DomainError(409,"WORLD_REVISION_CONFLICT","世界身份或配置已变化，请刷新后重新确认","world-archive-conflict");
const recovery = () => new DomainError(409,"RECOVERY_REQUIRED","归档结果需要人工检查；世界、归档和保护备份均保留","world-archive-incomplete",true);

/** One writer owns admission, the complete world-set rename and durable none state. */
export class WorldArchiveService {
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly backups: BackupService,
    private readonly managerRoot: string, private readonly states: WorldState, private readonly clock: Clock,
    private readonly inject?: (point: string) => Promise<void>) {}

  async archive(serverId: string, body: WorldArchiveRequest, key: string): Promise<Operation> {
    return this.operations.requestBackup(serverId,key,JSON.stringify(body),(ctx) => this.execute(serverId,body,ctx),
      async () => { await this.check(serverId,body); },"world-archive");
  }
  private adapter(serverId: string): LocalMinecraftServerAdapter {
    const adapter = this.registry.get(serverId);
    if (!adapter) throw new ServerNotFoundError();
    if (!isLocalAdapter(adapter) || adapter.plan.serverInfo.type !== "vanilla")
      throw new DomainError(501,"WORLD_LAYOUT_UNSUPPORTED","归档仅支持已验证的本地 Vanilla 世界集","unsupported-world-archive");
    return adapter;
  }
  private async directoryIdentity(directory: string, root = false): Promise<string> {
    await plainRestoreDirectory(directory);
    const canonical = await realpath(directory); const info = await lstat(canonical,{ bigint:true });
    const normalized = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    return hash(`world-archive-directory-v1\0${root ? normalized : ""}\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`);
  }
  private async properties(adapter: LocalMinecraftServerAdapter): Promise<string> {
    const file = path.join(adapter.plan.rootPath,"server.properties");
    if ((await lstat(file)).nlink !== 1) throw conflict();
    return readBoundedRegularFile(file,SERVER_PROPERTIES_LIMIT,"server.properties");
  }
  private async stopped(adapter: LocalMinecraftServerAdapter): Promise<void> {
    const state = await adapter.getStatus();
    if (state.state !== "stopped" || state.ownership !== "none" || state.recoveryRequired) throw recovery();
  }
  private async absent(candidate: string): Promise<void> {
    try { await lstat(candidate); } catch (error) { if (missingFile(error)) return; throw error; }
    throw recovery();
  }
  private async check(serverId: string, body: WorldArchiveRequest) {
    const adapter = this.adapter(serverId); const status = await adapter.getStatus();
    if (this.operations.getServerState(serverId).recoveryRequired || status.recoveryRequired) throw recovery();
    if (!((status.state === "stopped" && status.ownership === "none") || (status.state === "running" && status.ownership === "managed")))
      throw new DomainError(409,"SERVER_STATE_CONFLICT","归档需要已停止或由管理器运行的实例","unmanaged-or-unknown-state");
    if (body.intent !== "archive-world-set") throw conflict();
    await plainRestoreDirectory(adapter.plan.rootPath);
    const [world] = await inspectVanillaWorld(serverId,adapter.plan.rootPath,this.clock.now().toISOString());
    const current = this.states.snapshot(serverId);
    if (!world || current?.state !== "active" || world.worldId !== body.worldId || current.worldId !== body.worldId ||
      current.levelName !== body.confirmWorldName || world.name.value !== body.confirmWorldName || world.worldRevision !== body.worldRevision) throw conflict();
    const entries = await readdir(adapter.plan.rootPath);
    if (entries.some((name) => [`${body.confirmWorldName.toLowerCase()}_nether`,`${body.confirmWorldName.toLowerCase()}_the_end`].includes(name.toLowerCase())))
      throw new DomainError(409,"WORLD_LAYOUT_UNSUPPORTED","分离维度或插件多世界布局不支持归档","split-world-layout");
    if (world.minecraftVersion.status !== "available" || world.minecraftVersion.value !== (await adapter.getServerInfo()).minecraftVersion)
      throw new DomainError(409,"WORLD_VERSION_UNAVAILABLE","无法确认当前世界版本与服务端一致","world-version-mismatch");
    if (status.state === "running" && !body.allowStop)
      throw new DomainError(409,"SERVER_MUST_BE_STOPPED","运行中归档需要明确允许优雅停服","allow-stop-required");
    return { adapter, running:status.state === "running", rootIdentity:await this.directoryIdentity(adapter.plan.rootPath,true),
      worldDirectoryIdentity:await this.directoryIdentity(path.join(adapter.plan.rootPath,body.confirmWorldName)) };
  }
  private async checkpoint(record: TransactionJournalRecord, name: string, details?: { checksumSha256: string; resourceId?: string }): Promise<void> {
    await this.journal.appendCheckpoint(record.intent.serverId,record.transactionId,{ name,recordedAt:this.clock.now().toISOString(),...(details ? { details } : {}) });
    await this.inject?.(name);
  }
  private async guard(adapter: LocalMinecraftServerAdapter, record: TransactionJournalRecord): Promise<BackupManifest> {
    const w = record.intent.worldArchive!; await this.stopped(adapter);
    const world = path.join(adapter.plan.rootPath,w.levelName); const files = await inventoryRestoreTree(world);
    const bytes = files.reduce((sum,file) => sum + file.sizeBytes,0);
    await plainRestoreDirectory(this.managerRoot); await makeRestoreDirectory(path.join(this.managerRoot,"backups"));
    const root = path.join(this.managerRoot,"backups",adapter.serverId); await makeRestoreDirectory(root); await restoreCapacity(root,bytes);
    const staging = path.join(root,w.guardBackupId + ".staging"); await mkdir(staging,{ mode:0o700 });
    await makeRestoreDirectory(path.join(staging,"payload")); await copyRestoreTree(world,path.join(staging,"payload",w.levelName),files);
    const entries = files.map((file) => ({ ...file,path:w.levelName + "/" + file.path })); const version = await readWorldVersion(world);
    if (!version || version !== (await adapter.getServerInfo()).minecraftVersion) throw recovery();
    const manifest: BackupManifest = { schemaVersion:1,id:w.guardBackupId,serverId:adapter.serverId,scope:"world-set",kind:"snapshot",
      label:"Before World Archive",createdAt:this.clock.now().toISOString(),state:"complete",pinned:true,minecraftVersion:version,
      serverType:"vanilla",includedRoots:[w.levelName],fileCount:entries.length,sizeBytes:bytes,checksumSha256:restoreFilesChecksum(entries),files:entries,
      wasRunning:record.intent.originalState === "running",restarted:false,downtimeMs:null };
    await writeRestoreJson(path.join(staging,"manifest.json"),manifest);
    await this.stopped(adapter); await verifyRestoreTree(world,files);
    await rename(staging,path.join(root,w.guardBackupId)); await syncRestoreDirectory(root);
    await this.backups.exportSource(adapter.serverId,w.guardBackupId);
    return manifest;
  }
  private async source(record: TransactionJournalRecord) {
    const w = record.intent.worldArchive!; const { manifest,directory } = await this.backups.exportSource(record.intent.serverId,w.guardBackupId);
    const live = await this.journal.get(record.intent.serverId,record.transactionId);
    const checkpoint = live.checkpoints.find((c) => c.name === "guard-verified");
    if (!manifest.pinned || manifest.serverType !== "vanilla" || manifest.includedRoots.length !== 1 || manifest.includedRoots[0] !== w.levelName ||
      checkpoint?.details?.checksumSha256 !== manifest.checksumSha256 || checkpoint.details.resourceId !== w.guardBackupId) throw recovery();
    const files = manifest.files.map((file) => { if (!file.path.startsWith(w.levelName + "/")) throw recovery(); return { ...file,path:file.path.slice(w.levelName.length + 1) }; });
    await verifyRestoreTree(path.join(directory,"payload",w.levelName),files);
    return { manifest,files,live };
  }
  private async verifyArchive(adapter: LocalMinecraftServerAdapter, record: TransactionJournalRecord) {
    const w = record.intent.worldArchive!; const { manifest,files,live } = await this.source(record);
    if (await this.directoryIdentity(adapter.plan.rootPath,true) !== w.rootIdentity) throw recovery();
    const workspace = path.join(adapter.plan.rootPath,w.workspaceName);
    if (await this.directoryIdentity(workspace) !== live.checkpoints.find((c) => c.name === "archive-ready")?.details?.checksumSha256 ||
      await this.directoryIdentity(path.join(workspace,"world")) !== w.worldDirectoryIdentity) throw recovery();
    await verifyRestoreTree(path.join(workspace,"world"),files);
    const receipt = await readBoundedRegularFile(path.join(workspace,"archive.json"),16 * 1024,"归档记录");
    if (receipt !== `${JSON.stringify(this.info(record,manifest))}\n`) throw recovery();
    return manifest;
  }
  private info(record: TransactionJournalRecord, manifest: BackupManifest): WorldArchiveInfo {
    const w = record.intent.worldArchive!;
    return { id:w.archiveId,operationId:record.intent.operationId,worldId:w.worldId,name:w.levelName,createdAt:record.intent.createdAt,
      guardBackupId:w.guardBackupId,minecraftVersion:manifest.minecraftVersion!,fileCount:manifest.fileCount,sizeBytes:manifest.sizeBytes,checksumSha256:manifest.checksumSha256 };
  }
  private async verifyNone(adapter: LocalMinecraftServerAdapter, record: TransactionJournalRecord): Promise<void> {
    const w = record.intent.worldArchive!;
    await this.absent(path.join(adapter.plan.rootPath,w.levelName));
    if (hash(await this.properties(adapter)) !== w.propertiesChecksum) throw recovery();
    const state = JSON.parse(await readBoundedRegularFile(path.join(this.managerRoot,"active-worlds",`${adapter.serverId}.json`),16 * 1024,"活动世界状态"));
    if (state.schemaVersion !== 1 || state.serverId !== adapter.serverId || state.state !== "none" || state.worldId !== null ||
      state.levelName !== null || state.archiveTransactionId !== record.transactionId || Object.keys(state).some((k) => !["schemaVersion","serverId","state","worldId","levelName","archiveTransactionId"].includes(k))) throw recovery();
  }
  private async execute(serverId: string, body: WorldArchiveRequest, ctx: RuntimeOperationContext): Promise<void> {
    const checked = await this.check(serverId,body); const { adapter } = checked;
    const workspaceName = `.manager-world-archive-${ctx.operationId}`;
    const record = await this.journal.createIntent({ operationId:ctx.operationId,serverId,kind:"world-archive",scope:"world-set",resourceId:body.worldId,
      allowStop:body.allowStop,originalState:checked.running ? "running" : "stopped",createdAt:this.clock.now().toISOString(),
      paths:[{ role:"source",namespace:"server",relativePath:body.confirmWorldName },{ role:"archive",namespace:"server",relativePath:`${workspaceName}/world` }],
      worldArchive:{ rootIdentity:checked.rootIdentity,worldDirectoryIdentity:checked.worldDirectoryIdentity,levelName:body.confirmWorldName,worldId:body.worldId,
        approvedRevision:body.worldRevision,guardBackupId:randomUUID(),archiveId:randomUUID(),workspaceName,propertiesChecksum:hash(await this.properties(adapter)) } });
    const w = record.intent.worldArchive!; const source = path.join(adapter.plan.rootPath,w.levelName); const workspace = path.join(adapter.plan.rootPath,w.workspaceName);
    try {
      await this.inject?.("intent-created");
      if (checked.running) { await ctx.onStep("stopping"); await adapter.stop(ctx); }
      await this.stopped(adapter);
      if (await this.directoryIdentity(adapter.plan.rootPath,true) !== w.rootIdentity || await this.directoryIdentity(source) !== w.worldDirectoryIdentity ||
        hash(await this.properties(adapter)) !== w.propertiesChecksum || this.states.snapshot(serverId)?.worldId !== w.worldId) throw conflict();
      const stoppedRevision = await readWorldRevision(serverId,w.levelName,source);
      if (!checked.running && stoppedRevision !== w.approvedRevision) throw conflict();
      await this.checkpoint(record,"stop-confirmed",{ checksumSha256:stoppedRevision });
      await ctx.onStep("creating-pre-archive-guard"); const guard = await this.guard(adapter,record);
      await this.checkpoint(record,"guard-verified",{ checksumSha256:guard.checksumSha256,resourceId:guard.id });
      await ctx.onResult?.({ resourceId:w.archiveId,rollbackAvailable:false });
      await mkdir(workspace,{ mode:0o700 }); await syncRestoreDirectory(adapter.plan.rootPath);
      await writeRestoreJson(path.join(workspace,"archive.json"),this.info(record,guard));
      await this.checkpoint(record,"archive-ready",{ checksumSha256:await this.directoryIdentity(workspace) });
      const { files } = await this.source(record); await verifyRestoreTree(source,files); await this.stopped(adapter);
      if (await this.directoryIdentity(adapter.plan.rootPath,true) !== w.rootIdentity || await this.directoryIdentity(source) !== w.worldDirectoryIdentity ||
        hash(await this.properties(adapter)) !== w.propertiesChecksum || this.states.snapshot(serverId)?.worldId !== w.worldId) throw conflict();
      await plainRestoreDirectory(workspace); await this.absent(path.join(workspace,"world"));
      if ((await lstat(source)).dev !== (await lstat(workspace)).dev) throw recovery();
      await this.checkpoint(record,"archive-rename-intent"); await this.inject?.("before-rename");
      await this.stopped(adapter); await verifyRestoreTree(source,files); await this.absent(path.join(workspace,"world"));
      const latest = await this.journal.get(serverId,record.transactionId);
      if (await this.directoryIdentity(adapter.plan.rootPath,true) !== w.rootIdentity || await this.directoryIdentity(source) !== w.worldDirectoryIdentity ||
        await this.directoryIdentity(workspace) !== latest.checkpoints.find((c) => c.name === "archive-ready")?.details?.checksumSha256 ||
        hash(await this.properties(adapter)) !== w.propertiesChecksum || this.states.snapshot(serverId)?.worldId !== w.worldId) throw conflict();
      await ctx.onStep("archiving-world-set"); await rename(source,path.join(workspace,"world"));
      await this.inject?.("after-rename");
      await syncRestoreDirectory(adapter.plan.rootPath); await syncRestoreDirectory(workspace);
      await this.absent(source); await this.verifyArchive(adapter,record); await this.stopped(adapter);
      await this.checkpoint(record,"archive-renamed",{ checksumSha256:guard.checksumSha256 });
      await this.checkpoint(record,"active-none-intent");
      await this.states.archiveCurrentWorld(serverId,w.levelName,record.transactionId); await this.inject?.("after-none-write");
      await this.verifyNone(adapter,record); await this.verifyArchive(adapter,record); await this.stopped(adapter);
      await this.checkpoint(record,"active-none-installed"); await this.inject?.("before-commit");
      await this.journal.setState(serverId,record.transactionId,"committed",this.clock.now().toISOString()); await this.inject?.("after-commit");
    } catch {
      try { await this.journal.setState(serverId,record.transactionId,"recovery-required",this.clock.now().toISOString()); } catch { /* Preserve terminal or interrupted intent. */ }
      throw recovery();
    }
  }
  async list(serverId: string): Promise<WorldArchiveInfo[]> {
    const adapter = this.adapter(serverId); const scan = await this.journal.scan(); const result: WorldArchiveInfo[] = [];
    for (const record of scan.records.filter((r) => r.intent.serverId === serverId && r.intent.worldArchive && r.state === "committed")) {
      try { result.push(this.info(record,await this.verifyArchive(adapter,record))); }
      catch { this.operations.requireTransactionRecovery(serverId,record.intent.operationId); throw recovery(); }
    }
    return result.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Always check immutable archive/root evidence, including established successes. */
  async reconcileStartup(): Promise<ReadonlyMap<string,string>> {
    const scan = await this.journal.scan(); const outcomes = new Map((await this.operations.storedOutcomes()).map((op) => [op.id,op]));
    const none = new Map<string,string>();
    for (const record of scan.records.filter((r) => r.intent.worldArchive)) {
      const serverId = record.intent.serverId;
      try {
        const adapter = this.adapter(serverId);
        if (await this.directoryIdentity(adapter.plan.rootPath,true) !== record.intent.worldArchive!.rootIdentity || record.state !== "committed") throw recovery();
        await this.verifyArchive(adapter,record);
        const established = outcomes.get(record.intent.operationId)?.state === "succeeded";
        // A later durable successful activation may supersede none. It never
        // removes the obligation to verify this archive and its registered root.
        let laterActivation = false;
        if (established) {
          const successors = scan.records.filter((next) => next.intent.serverId === serverId && next.state === "committed" &&
            (next.intent.worldChange || next.intent.worldImport) && next.intent.createdAt > record.intent.createdAt && outcomes.get(next.intent.operationId)?.state === "succeeded")
            .sort((a,b) => b.intent.createdAt.localeCompare(a.intent.createdAt));
          const successor = successors[0];
          if (successor) {
            const change = successor.intent.worldChange ?? successor.intent.worldImport!;
            const canonical = await realpath(adapter.plan.rootPath); const info = await lstat(canonical,{ bigint:true });
            const rootHash = hash(`${successor.intent.worldChange ? "world-create" : "world-import"}-root-v1\0${process.platform === "win32" ? canonical.toLowerCase() : canonical}\0${info.dev}\0${info.ino}\0${info.birthtimeNs}`);
            const state = JSON.parse(await readBoundedRegularFile(path.join(this.managerRoot,"active-worlds",`${serverId}.json`),16 * 1024,"活动世界状态"));
            const props = parseProperties(await this.properties(adapter));
            if (rootHash !== change.rootIdentity || state.serverId !== serverId || !["active","pending-generation"].includes(state.state) ||
              state.levelName !== change.nextName || state.worldId !== worldIdentity(serverId,change.nextName) || (props.get("level-name") ?? "world") !== change.nextName) throw recovery();
            laterActivation = true;
          }
        }
        if (!laterActivation) { await this.verifyNone(adapter,record); none.set(serverId,record.transactionId); }
        if (!established) { await this.stopped(adapter); this.operations.confirmPhysicalTransaction(record.intent.operationId); }
      } catch { this.operations.requireTransactionRecovery(serverId,record.intent.operationId); }
    }
    return none;
  }
}
