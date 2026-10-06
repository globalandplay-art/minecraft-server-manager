import { link, lstat, mkdir, open, readdir, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Operation } from "@mcsm/contracts";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import { ADDON_LIMITS, AddonInventory, addonOpaqueId, addonProfile } from "./addon-inventory.js";
import { captureAddonAdapterIdentity, type AddonAdapterIdentity } from "./addon-adapter-identity.js";
import type { OperationService } from "./operation-service.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import type { AddonUploadService } from "./addon-upload-service.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";

type InstallRequest = { uploadId: string; uploadRevision: string; inventoryRevision: string };
const unsafe = () => new DomainError(409, "ADDON_INSTALL_RECOVERY_REQUIRED", "扩展安装结果需要人工检查；备份和暂存证据已保留", "addon-install-recovery-required", true);
const conflict = () => new DomainError(409, "ADDON_REVISION_CONFLICT", "扩展清单已变化，请刷新后重新确认", "addon-inventory-revision-conflict");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hash = /^[0-9a-f]{64}$/u;
function isMissing(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function localPathEqual(left: string, right: string) {
  return (process.platform === "win32" ? path.resolve(left).toLowerCase() : path.resolve(left)) ===
    (process.platform === "win32" ? path.resolve(right).toLowerCase() : path.resolve(right));
}
async function plainDirectory(directory: string) {
  const info = await lstat(directory), canonical = await realpath(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !localPathEqual(canonical, directory)) throw unsafe();
}
function contained(parent: string, child: string) {
  const normalizedParent = process.platform === "win32" ? parent.toLowerCase() : parent;
  const normalizedChild = process.platform === "win32" ? child.toLowerCase() : child;
  const relative = path.relative(normalizedParent, normalizedChild);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
async function syncDirectory(directory: string) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (!(process.platform === "win32" && ["EACCES", "EISDIR", "EPERM"].includes(String(code)))) throw error;
  } finally { await handle.close(); }
}
async function exclusiveFile(file: string, bytes: Buffer) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

/** Single-writer addon installation transaction. No server start/stop or replacement is authorized. */
export class AddonInstallService {
  private readonly managerRoot: string;
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly backups: BackupService,
    private readonly uploads: AddonUploadService, private readonly inventory: AddonInventory,
    managerRoot: string, private readonly clock: Clock,
    private readonly inject?: (point: string) => Promise<void>,
    private readonly captureIdentity: typeof captureAddonAdapterIdentity = captureAddonAdapterIdentity) { this.managerRoot = path.resolve(managerRoot); }

  async install(serverId: string, body: InstallRequest, key: string): Promise<Operation> {
    if (!uuid.test(body.uploadId) || !hash.test(body.uploadRevision) || !hash.test(body.inventoryRevision) || !uuid.test(key)) {
      throw new DomainError(400, "VALIDATION_ERROR", "扩展安装确认信息无效", "invalid-addon-install-request");
    }
    let approvedIdentity: AddonAdapterIdentity | undefined;
    const request = { uploadId: body.uploadId, uploadRevision: body.uploadRevision, inventoryRevision: body.inventoryRevision };
    return this.operations.requestBackup(serverId, key, JSON.stringify(request), async (context) => {
      if (!approvedIdentity) throw conflict();
      await this.execute(serverId, request, approvedIdentity, context);
    }, async () => {
      const adapter = this.registry.getLocal(serverId);
      if (!adapter) throw new DomainError(501, "ADDON_UNSUPPORTED", "安装仅支持已识别的本地 Paper/Fabric", "addon-local-required");
      const profile = addonProfile(adapter.plan.serverInfo.type);
      if (!profile) throw new DomainError(501, "ADDON_UNSUPPORTED", "此服务端类型尚未开放扩展安装", "addon-profile-unsupported");
      await this.requireStopped(adapter);
      approvedIdentity = await this.captureIdentity(adapter);
      const stage = await this.uploads.validatedSource(serverId, body.uploadId, body.uploadRevision, profile.kind);
      if (JSON.stringify(stage.validated.adapterIdentity) !== JSON.stringify(approvedIdentity)) throw conflict();
      const listing = await this.inventory.read(serverId, adapter.plan.rootPath, adapter.plan.serverInfo.type);
      if (listing.revision !== body.inventoryRevision) throw conflict();
      this.requireCapacity(listing, stage.validated.sizeBytes, (await readdir(path.join(adapter.plan.rootPath, profile.enabled))).length);
      if (listing.items.some((item) => item.filename.normalize("NFC").toLowerCase() === stage.validated.filename.normalize("NFC").toLowerCase())) {
        throw new DomainError(409, "ADDON_TARGET_CONFLICT", "同名扩展已经存在；不会覆盖", "addon-target-conflict");
      }
      if (!approvedIdentity.addonRootIdentity) throw new DomainError(409, "ADDON_ROOT_UNAVAILABLE", "扩展目录不存在或身份无法核验", "addon-root-unavailable");
    }, "addon-change");
  }

  private async requireStopped(adapter: NonNullable<ReturnType<AdapterRegistry["getLocal"]>>, operationId?: string) {
    const status = await adapter.getStatus();
    const op = this.operations.getServerState(adapter.serverId);
    if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired || op.recoveryRequired ||
      (status.activeOperationId !== null && status.activeOperationId !== operationId) ||
      (op.activeOperationId !== null && op.activeOperationId !== operationId)) throw new DomainError(409, "SERVER_MUST_BE_STOPPED", "安装要求已停止且没有其他操作或恢复锁", "addon-install-not-admitted");
  }

  private async checkpoint(record: TransactionJournalRecord, name: string, checksumSha256?: string, resourceId?: string,
    filesystemIdentity?: string, inject = true) {
    await this.journal.appendCheckpoint(record.intent.serverId, record.transactionId, { name, recordedAt: this.clock.now().toISOString(),
      ...(checksumSha256 || resourceId || filesystemIdentity ? { details: { ...(checksumSha256 ? { checksumSha256 } : {}),
        ...(resourceId ? { resourceId } : {}), ...(filesystemIdentity ? { filesystemIdentity } : {}) } } : {}) });
    if (inject) await this.inject?.(name);
  }

  private async execute(serverId: string, body: InstallRequest, approved: AddonAdapterIdentity, ctx: RuntimeOperationContext) {
    let record: TransactionJournalRecord | undefined;
    let workspace: string | undefined;
    try {
      const adapter = this.registry.getLocal(serverId);
      if (!adapter) throw unsafe();
      const profile = addonProfile(adapter.plan.serverInfo.type);
      if (!profile) throw unsafe();
      await this.requireStopped(adapter, ctx.operationId);
      let identity = await this.captureIdentity(adapter);
      if (JSON.stringify(identity) !== JSON.stringify(approved) || !identity.addonRootIdentity) throw conflict();
      let source = await this.uploads.validatedSource(serverId, body.uploadId, body.uploadRevision, profile.kind);
      if (JSON.stringify(source.validated.adapterIdentity) !== JSON.stringify(identity)) throw conflict();
      let listing = await this.inventory.read(serverId, adapter.plan.rootPath, adapter.plan.serverInfo.type);
      if (listing.revision !== body.inventoryRevision) throw conflict();
      this.requireCapacity(listing, source.validated.sizeBytes, (await readdir(path.join(adapter.plan.rootPath, profile.enabled))).length);
      const filename = source.validated.filename;
      const existing = await readdir(path.join(adapter.plan.rootPath, profile.enabled));
      if (existing.some((name) => name.normalize("NFC").toLowerCase() === filename.normalize("NFC").toLowerCase())) {
        throw new DomainError(409, "ADDON_TARGET_CONFLICT", "同名扩展已经存在；不会覆盖", "addon-target-conflict");
      }

      await ctx.onStep("creating-protection-backup");
      const guard = await this.backups.createAddonProtectionSnapshot(ctx, serverId, adapter.plan.serverInfo.type as "paper" | "fabric");
      const guardManifest = await this.backups.privateSnapshot(serverId, guard.id);
      const serverEntriesBeforeGuard = (await readdir(adapter.plan.rootPath)).sort();
      const launcherRelative = path.relative(adapter.plan.rootPath, adapter.plan.jarPath).split(path.sep).join("/");
      if (!guardManifest.pinned || guardManifest.serverId !== serverId ||
        guardManifest.serverType !== adapter.plan.serverInfo.type ||
        guardManifest.minecraftVersion !== adapter.plan.serverInfo.minecraftVersion || guardManifest.checksumSha256 !== guard.checksumSha256 ||
        JSON.stringify([...guardManifest.includedRoots].sort()) !== JSON.stringify(serverEntriesBeforeGuard) ||
        ![profile.enabled, "server.properties", "eula.txt", launcherRelative].every((rootName) => guardManifest.includedRoots.includes(rootName))) throw unsafe();
      identity = await this.captureIdentity(adapter);
      source = await this.uploads.validatedSource(serverId, body.uploadId, body.uploadRevision, profile.kind);
      listing = await this.inventory.read(serverId, adapter.plan.rootPath, adapter.plan.serverInfo.type);
      this.requireCapacity(listing, source.validated.sizeBytes, (await readdir(path.join(adapter.plan.rootPath, profile.enabled))).length);
      if (JSON.stringify(identity) !== JSON.stringify(approved) || identity.addonRootIdentity !== approved.addonRootIdentity ||
        JSON.stringify(source.validated.adapterIdentity) !== JSON.stringify(approved) || listing.revision !== body.inventoryRevision) throw conflict();
      if ((await readdir(path.join(adapter.plan.rootPath, profile.enabled))).some((name) => name.normalize("NFC").toLowerCase() === filename.normalize("NFC").toLowerCase())) {
        throw new DomainError(409, "ADDON_TARGET_CONFLICT", "同名扩展已经存在；不会覆盖", "addon-target-conflict");
      }
      const root = path.resolve(adapter.plan.rootPath);
      const privateRoot = await realpath(this.managerRoot), serverRoot = await realpath(root);
      if (contained(privateRoot, serverRoot) || contained(serverRoot, privateRoot)) throw unsafe();
      const workspaceName = `.manager-addon-${ctx.operationId}`;
      const targetRelative = `${profile.enabled}/${filename}`;
      record = await this.journal.createIntent({ operationId: ctx.operationId, serverId, kind: "addon-install", scope: "server-snapshot",
        resourceId: body.uploadId, allowStop: false, originalState: "stopped", createdAt: this.clock.now().toISOString(),
        paths: [{ role: "source", namespace: "manager", relativePath: `addon-uploads/${body.uploadId}/payload.jar` },
          { role: "target", namespace: "server", relativePath: targetRelative },
          { role: "staging", namespace: "server", relativePath: `${workspaceName}/prepared.jar` },
          { role: "rollback", namespace: "manager", relativePath: `backups/${serverId}/${guard.id}` }],
        addonInstall: { rootIdentity: identity.rootIdentity, adapterIdentitySha256: identity.identitySha256,
          addonRootIdentity: identity.addonRootIdentity!, kind: profile.kind, filename, uploadId: body.uploadId,
          uploadRevision: source.validated.revision, uploadSha256: source.validated.checksumSha256,
          guardBackupId: guard.id, guardChecksum: guard.checksumSha256, workspaceName } });
      await this.checkpoint(record, "backup-created", guard.checksumSha256, guard.id);
      await this.checkpoint(record, "intent-written");
      workspace = path.join(root, workspaceName);
      try { await lstat(workspace); throw unsafe(); } catch (error) { if (!isMissing(error)) throw error; }
      await this.checkpoint(record, "before-install");
      await mkdir(workspace, { mode: 0o700 }); await plainDirectory(workspace); await syncDirectory(root);
      const workspaceIdentity = await backupDirectoryIdentity(workspace);
      const sourceBytes = await readPrivatePropertiesFile(source.filePath, 64 * 1024 * 1024);
      if (sourceBytes.identity !== (await readPrivatePropertiesFile(source.filePath, 64 * 1024 * 1024)).identity || sourceBytes.checksum !== source.validated.checksumSha256) throw unsafe();
      const prepared = path.join(workspace, "prepared.jar"); await exclusiveFile(prepared, sourceBytes.bytes); await syncDirectory(workspace);
      const preparedState = await readPrivatePropertiesFile(prepared, 64 * 1024 * 1024);
      if (preparedState.checksum !== source.validated.checksumSha256 || preparedState.bytes.length !== source.validated.sizeBytes ||
        await backupDirectoryIdentity(workspace) !== workspaceIdentity) throw unsafe();
      await this.checkpoint(record, "staging-validated", preparedState.checksum, undefined, preparedState.physicalIdentity);
      const rechecked = await this.uploads.validatedSource(serverId, body.uploadId, body.uploadRevision, profile.kind);
      const currentIdentity = await this.captureIdentity(adapter);
      const currentListing = await this.inventory.read(serverId, adapter.plan.rootPath, adapter.plan.serverInfo.type);
      await this.backups.privateSnapshot(serverId, guard.id);
      await this.requireStopped(adapter, ctx.operationId);
      if (rechecked.validated.checksumSha256 !== source.validated.checksumSha256 || JSON.stringify(currentIdentity) !== JSON.stringify(identity) ||
        currentIdentity.addonRootIdentity !== identity.addonRootIdentity || currentListing.revision !== body.inventoryRevision ||
        await backupDirectoryIdentity(workspace) !== workspaceIdentity || (await readdir(workspace)).sort().join("\0") !== "prepared.jar") throw unsafe();
      const target = path.join(root, profile.enabled, filename);
      try { await lstat(target); throw new DomainError(409, "ADDON_TARGET_CONFLICT", "同名扩展已经存在；不会覆盖", "addon-target-conflict"); }
      catch (error) { if (!isMissing(error)) throw error; }
      const lastPrepared = await readPrivatePropertiesFile(prepared, 64 * 1024 * 1024);
      if (lastPrepared.identity !== preparedState.identity || lastPrepared.checksum !== preparedState.checksum) throw unsafe();
      const finalListing = await this.inventory.read(serverId, adapter.plan.rootPath, adapter.plan.serverInfo.type);
      if (finalListing.revision !== body.inventoryRevision) throw conflict();
      this.requireCapacity(finalListing, source.validated.sizeBytes, (await readdir(path.join(adapter.plan.rootPath, profile.enabled))).length);
      const [preparedStat, targetParentStat] = await Promise.all([stat(prepared), stat(path.dirname(target))]);
      if (preparedStat.dev !== targetParentStat.dev) throw unsafe();
      // link() is an atomic same-volume, no-replace publication primitive: unlike
      // rename(), it cannot overwrite a target created by an external writer
      // between the preceding absence check and the publication step.
      await link(prepared, target);
      await unlink(prepared);
      await syncDirectory(path.dirname(target)); await syncDirectory(workspace);
      const linked = await readPrivatePropertiesFile(target, 64 * 1024 * 1024);
      if (linked.physicalIdentity !== lastPrepared.physicalIdentity || linked.checksum !== lastPrepared.checksum) throw unsafe();
      await this.checkpoint(record, "target-installed", lastPrepared.checksum);
      const installed = await readPrivatePropertiesFile(target, 64 * 1024 * 1024);
      const newIdentity = await this.captureIdentity(adapter);
      if (installed.physicalIdentity !== lastPrepared.physicalIdentity || installed.checksum !== source.validated.checksumSha256 ||
        newIdentity.rootIdentity !== identity.rootIdentity || newIdentity.addonRootIdentity !== identity.addonRootIdentity) throw unsafe();
      await this.checkpoint(record, "installed-verified", installed.checksum, undefined, installed.physicalIdentity);
      await this.checkpoint(record, "before-commit", installed.checksum, undefined, installed.physicalIdentity);
      const finalFile = await readPrivatePropertiesFile(target, 64 * 1024 * 1024);
      if (finalFile.physicalIdentity !== installed.physicalIdentity || finalFile.checksum !== installed.checksum) throw unsafe();
      await this.uploads.markConsumed(serverId, body.uploadId, body.uploadRevision, profile.kind, ctx.operationId);
      await this.checkpoint(record, "staging-consumed", source.validated.checksumSha256, body.uploadId);
      await this.checkpoint(record, "before-publication", finalFile.checksum, undefined, finalFile.physicalIdentity, false);
      await this.checkpoint(record, "committed", finalFile.checksum, undefined, finalFile.physicalIdentity, false);
      await this.journal.setState(serverId, record.transactionId, "committed", this.clock.now().toISOString());
      await this.inject?.("committed");
      await this.inject?.("before-publication");
      const afterCommit = await readPrivatePropertiesFile(target, 64 * 1024 * 1024);
      if (afterCommit.physicalIdentity !== installed.physicalIdentity || afterCommit.checksum !== installed.checksum ||
        !(await this.uploads.verifyConsumed(serverId, body.uploadId, body.uploadRevision, profile.kind, ctx.operationId))) throw unsafe();
      const addonId = addonOpaqueId(serverId, profile.kind, filename);
      await ctx.onResult?.({ resourceId: addonId, rollbackAvailable: false, restartRequired: true });
      // The empty per-operation workspace is private transaction residue. Preserve it as journal evidence until a later audited cleanup slice.
    } catch (error) {
      if (record && record.state === "active") {
        try { await this.journal.setState(serverId, record.transactionId, "recovery-required", this.clock.now().toISOString()); } catch {}
      }
      if (error instanceof DomainError && error.requiresRecovery) throw error;
      if (record) throw unsafe();
      throw error;
    }
  }

  private requireCapacity(listing: Awaited<ReturnType<AddonInventory["read"]>>, incomingBytes: number, enabledDirectoryEntries: number) {
    const totalBytes = listing.items.reduce((total, item) => total + item.sizeBytes, 0);
    if (listing.items.length + 1 > ADDON_LIMITS.files || enabledDirectoryEntries + 1 > ADDON_LIMITS.files ||
      totalBytes + incomingBytes > ADDON_LIMITS.totalBytes) {
      throw new DomainError(413, "ADDON_INVENTORY_LIMIT", "Install would exceed addon inventory limits", "addon-inventory-limit");
    }
  }

  async reconcileStartup(): Promise<void> {
    const scan = await this.journal.scan();
    const outcomes = new Map((await this.operations.storedOutcomes()).map((operation) => [operation.id, operation]));
    for (const record of scan.records) {
      const install = record.intent.addonInstall;
      if (!install || !["active", "recovery-required", "committed", "rolled-back"].includes(record.state) ||
        scan.issues.some((issue) => issue.serverId === record.intent.serverId)) continue;
      const priorOutcome = outcomes.get(record.intent.operationId);
      if ((record.state === "committed" && priorOutcome?.state === "succeeded") ||
        (record.state === "rolled-back" && priorOutcome?.state === "failed" && priorOutcome.error?.code === "ADDON_INSTALL_NOT_APPLIED")) continue;
      const preserveRollbackGate = () => {
        if (record.state === "rolled-back") this.operations.requireTransactionRecovery(record.intent.serverId, record.intent.operationId);
      };
      try {
        const adapter = this.registry.getLocal(record.intent.serverId);
        if (!adapter) { preserveRollbackGate(); continue; }
        await this.requireStopped(adapter);
        const identity = await this.captureIdentity(adapter);
        if (identity.rootIdentity !== install.rootIdentity || identity.identitySha256 !== install.adapterIdentitySha256 ||
          identity.addonRootIdentity !== install.addonRootIdentity) { preserveRollbackGate(); continue; }
        const target = path.join(adapter.plan.rootPath, install.kind === "mod" ? "mods" : "plugins", install.filename);
        const guard = await this.backups.privateSnapshot(record.intent.serverId, install.guardBackupId);
        if (!guard.pinned || guard.checksumSha256 !== install.guardChecksum) { preserveRollbackGate(); continue; }
        if (record.state === "committed") {
          const file = await readPrivatePropertiesFile(target, 64 * 1024 * 1024);
          const verified = [...record.checkpoints].reverse().find((point) => point.name === "before-publication")?.details;
          if (file.checksum !== install.uploadSha256 || !verified || verified.checksumSha256 !== file.checksum ||
            verified.filesystemIdentity !== file.physicalIdentity ||
            !(await this.uploads.verifyConsumed(record.intent.serverId, install.uploadId, install.uploadRevision, install.kind, record.intent.operationId))) {
            preserveRollbackGate(); continue;
          }
          this.operations.confirmPhysicalTransaction(record.intent.operationId);
          continue;
        }

        // A complete proof that the target was never published permits a safe
        // failed terminal outcome. Preserve the prepared workspace and all
        // private evidence; cleanup is a later audited lifecycle slice.
        const source = await this.uploads.validatedSource(record.intent.serverId, install.uploadId, install.uploadRevision, install.kind);
        if (source.validated.checksumSha256 !== install.uploadSha256) { preserveRollbackGate(); continue; }
        let targetExists = true;
        try { await lstat(target); } catch (error) { if (isMissing(error)) targetExists = false; else throw error; }
        if (targetExists) { preserveRollbackGate(); continue; }
        const workspace = path.join(adapter.plan.rootPath, install.workspaceName);
        const staged = record.checkpoints.find((point) => point.name === "staging-validated")?.details;
        if (staged) {
          await plainDirectory(workspace);
          if ((await readdir(workspace)).sort().join("\0") !== "prepared.jar") { preserveRollbackGate(); continue; }
          const prepared = await readPrivatePropertiesFile(path.join(workspace, "prepared.jar"), 64 * 1024 * 1024);
          if (prepared.checksum !== install.uploadSha256 || staged.checksumSha256 !== prepared.checksum ||
            staged.filesystemIdentity !== prepared.physicalIdentity) { preserveRollbackGate(); continue; }
        } else {
          try { await lstat(workspace); preserveRollbackGate(); continue; } catch (error) { if (!isMissing(error)) throw error; }
        }
        await this.journal.setState(record.intent.serverId, record.transactionId, "rolled-back", this.clock.now().toISOString());
        this.operations.confirmPhysicalTransaction(record.intent.operationId);
      } catch {
        preserveRollbackGate();
        // OperationService retains the unresolved transaction recovery gate.
      }
    }
  }
}
