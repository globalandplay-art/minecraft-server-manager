import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { WorldReplacementApproval } from "@mcsm/contracts";
import type { Clock } from "../clock.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import type { BackupManifest, BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { copyRestoreTree, makeRestoreDirectory, plainRestoreDirectory, restoreCapacity, restoreFilesChecksum,
  syncRestoreDirectory, verifyRestoreTree, writeRestoreJson } from "./restore-files.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import type { WorldImportUploadService } from "./world-import-upload-service.js";
import type { WorldLibraryImportService } from "./world-library-import-service.js";
import { allocateWorldIdentity, type WorldLibraryStore } from "./world-library-store.js";
import { verifyReplacementAdmissionFiles, verifyReplacementApprovalSnapshots } from "./world-replacement-approval.js";
import { verifyReplacementJournalAndInstalledFiles } from "./world-replacement-journal-proof.js";
import { orderedWorldTransitionRecords } from "./world-transition-records.js";

/** First-transition executor. Production enablement requires separate acceptance.
 * First transition only until mixed live-state admission/recovery is integrated.
 * The original world is preserved; failures never replay or delete evidence. */
export type { WorldReplacementApproval } from "@mcsm/contracts";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const recovery = () => new DomainError(409, "RECOVERY_REQUIRED", "World replacement requires inspection; evidence retained", "world-replacement-incomplete", true);
const conflict = () => new DomainError(409, "WORLD_REVISION_CONFLICT", "World replacement approval has changed", "world-replacement-approval-changed");

export class WorldReplacementService {
  #closing = false;
  readonly #owners = new Set<Promise<void>>();
  constructor(private readonly operations: OperationService, private readonly journal: TransactionJournalStore,
    private readonly library: WorldLibraryStore, private readonly imports: WorldLibraryImportService,
    private readonly uploads: Pick<WorldImportUploadService, "withLease" | "validatedSource" | "claim">,
    private readonly backups: Pick<BackupService, "exportSource">, private readonly managerRoot: string,
    private readonly clock: Clock, private readonly inject?: (point: string) => Promise<void>) {}

  private own() {
    if (this.#closing) throw new DomainError(503, "ACTION_UNAVAILABLE", "Manager is closing", "manager-closing");
    let release!: () => void;
    const owner = new Promise<void>(resolve => { release = resolve; }); this.#owners.add(owner);
    return () => { this.#owners.delete(owner); release(); return undefined; };
  }

  private async inspect(serverId: string, request: { uploadId: string }, operationId?: string, approval?: WorldReplacementApproval) {
    const checked = await this.imports.prepareReplacementUnderLease(serverId, request, operationId);
    const plan = checked.plan;
    if (approval) {
      for (const field of ["uploadId", "uploadRevision", "libraryRevision", "currentWorldId", "currentWorldRevision", "currentContentRevision", "propertiesRevision"] as const) {
        if (approval[field] !== plan[field]) throw conflict();
      }
      if (approval.confirmWorldName !== plan.currentWorldName) throw conflict();
    }
    const scan = await this.journal.scan();
    if (scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || scan.recoveryServerIds.has(serverId)) throw recovery();
    if (orderedWorldTransitionRecords(serverId, scan.records).length) {
      throw new DomainError(409, "ACTION_UNAVAILABLE", "Replacement with transition history requires live-history admission", "replacement-live-history-pending");
    }
    // Existing import birth checks remain required; do not let an arbitrary
    // catalog entry grant permission to replace a different logical world.
    await this.library.auditImportBindings(checked.binding, scan.records);
    await this.library.projectTransitionHistory(checked.binding, scan.records);
    return { ...checked, originalRecords: scan.records.filter(item => item.intent.serverId === serverId) };
  }

  async plan(serverId: string, request: { uploadId: string }) {
    const release = this.own();
    try { return await this.operations.runReadAdmission(serverId, () => this.uploads.withLease(async () => {
      if (this.#closing) throw new DomainError(503, "ACTION_UNAVAILABLE", "Manager is closing", "manager-closing");
      const checked = await this.inspect(serverId, request);
      if (this.#closing) throw new DomainError(503, "ACTION_UNAVAILABLE", "Manager is closing", "manager-closing");
      return checked.plan;
    })); } finally { release(); }
  }

  async replace(serverId: string, original: WorldReplacementApproval, key: string, admission?: OperationAdmission) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) throw conflict();
    const body = structuredClone(original);
    const admit = () => {
      if (this.#closing) throw new DomainError(503, "ACTION_UNAVAILABLE", "Manager is closing", "manager-closing");
      admission?.(); return undefined;
    };
    return this.operations.requestBackup(serverId, key, JSON.stringify(body), context => this.uploads.withLease(() => this.execute(serverId, body, context)),
      () => this.uploads.withLease(async () => { await this.inspect(serverId, body, undefined, body); }), "world-replace", undefined, admit, () => {
        admit(); return this.own();
      });
  }

  /** Stop new admission, cooperatively interrupt at the next checked phase and
   * drain owners including admitted-but-not-started jobs. An independent cleanup
   * deadline never changes a test/helper timeout, kills processes or frees leases
   * whose work is still outstanding. Caller must preserve resources on failure. */
  async close(): Promise<void> {
    this.#closing = true;
    if (!this.#owners.size) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all([...this.#owners]), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DomainError(409, "CLEANUP_BLOCKED", "Replacement cleanup is not confirmed", "replacement-close-deadline", true)), 5000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private async snapshot(file: string, bytes: Buffer) {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await syncRestoreDirectory(path.dirname(file));
  }

  private async execute(serverId: string, body: WorldReplacementApproval, context: RuntimeOperationContext) {
    const checked = await this.inspect(serverId, body, context.operationId, body);
    const { adapter, binding, current, source } = checked, root = binding.rootPath, target = path.join(root, current.levelName);
    const worldId = allocateWorldIdentity(), guardId = randomUUID(), workspaceName = `.manager-world-replace-${context.operationId}`;
    const workspace = path.join(root, workspaceName), stage = path.join(workspace, "world"), preserved = path.join(workspace, "previous-world");
    const originals: Array<Awaited<ReturnType<typeof readPrivatePropertiesFile>>> = [];
    let record: TransactionJournalRecord | undefined, committed: TransactionJournalRecord | undefined, headRevision: string | undefined;
    const check = () => { if (context.signal.aborted || this.#closing) throw recovery(); };
    try {
      check();
      for (const [file, limit] of [[path.join(root, "server.properties"), 1024 * 1024],
        [path.join(this.managerRoot, "active-worlds", `${serverId}.json`), 16 * 1024],
        [path.join(this.managerRoot, "world-library", serverId, "state.json"), 1024 * 1024]] as const) originals.push(await readPrivatePropertiesFile(file, limit));
      const [properties, active, catalog] = originals as [typeof originals[number], typeof originals[number], typeof originals[number]];
      if (hash(`${properties.identity}\0${properties.checksum}`) !== body.propertiesRevision || catalog.checksum !== body.libraryRevision) throw conflict();
      const currentObjectIdentity = await directoryObjectIdentity(target), currentDirectoryIdentity = await backupDirectoryIdentity(target);
      const savedCatalog = JSON.parse(catalog.bytes.toString("utf8")) as { catalogId: string };
      record = await this.journal.createIntent({ operationId: context.operationId, serverId, kind: "world-replace", scope: "world-set", resourceId: worldId,
        originalState: "stopped", allowStop: false, createdAt: this.clock.now().toISOString(), paths: [
          { role: "source", namespace: "server", relativePath: current.levelName }, { role: "target", namespace: "server", relativePath: current.levelName },
          { role: "staging", namespace: "server", relativePath: workspaceName }, { role: "archive", namespace: "server", relativePath: `${workspaceName}/previous-world` },
          { role: "rollback", namespace: "manager", relativePath: `backups/${serverId}/${guardId}` } ], worldReplacement: {
          rootIdentity: checked.rootIdentity, catalogId: savedCatalog.catalogId, worldId, previousWorldId: body.currentWorldId,
          levelName: current.levelName, confirmationName: body.confirmWorldName, libraryRevision: body.libraryRevision,
          currentWorldRevision: body.currentWorldRevision, currentContentChecksum: body.currentContentRevision, currentDirectoryIdentity, currentObjectIdentity,
          propertiesRevision: body.propertiesRevision, propertiesChecksum: properties.checksum, uploadId: body.uploadId, uploadRevision: body.uploadRevision,
          importedChecksum: source.checksumSha256, minecraftVersion: "26.3", guardBackupId: guardId, sequence: 1, predecessorTransactionId: null, workspaceName,
          approval: { schemaVersion: 1, propertiesIdentity: properties.identity, activeStateIdentity: active.identity,
            activeStateChecksum: active.checksum, catalogFileIdentity: catalog.identity } } });
      this.operations.retainReplacementInspection(serverId, context.operationId);
      const mark = async (name: string, checksumSha256?: string, filesystemIdentity?: string) => {
        check(); record = await this.journal.appendCheckpoint(serverId, record!.transactionId, { name, recordedAt: this.clock.now().toISOString(),
          details: { resourceId: worldId, ...(checksumSha256 ? { checksumSha256 } : {}), ...(filesystemIdentity ? { filesystemIdentity } : {}) } });
        await this.inject?.(name); check();
      };
      const controls = async () => {
        check(); const status = await adapter.getStatus();
        if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired || await backupDirectoryIdentity(root) !== checked.rootIdentity) throw recovery();
        for (const [index, file] of [path.join(root, "server.properties"), path.join(this.managerRoot, "active-worlds", `${serverId}.json`)].entries()) {
          const actual = await readPrivatePropertiesFile(file, index ? 16 * 1024 : 1024 * 1024);
          try { if (actual.identity !== originals[index]!.identity || actual.checksum !== originals[index]!.checksum) throw recovery(); }
          finally { actual.bytes.fill(0); }
        }
        if (JSON.stringify(await this.journal.get(serverId, record!.transactionId)) !== JSON.stringify(record)) throw recovery();
        const actual = await this.journal.scan();
        if (actual.issues.some(issue => !issue.serverId || issue.serverId === serverId) ||
            actual.records.some(item => item.intent.serverId === serverId && item.transactionId !== record!.transactionId && ["active", "recovery-required"].includes(item.state)) ||
            JSON.stringify(actual.records.filter(item => item.intent.serverId === serverId && item.transactionId !== record!.transactionId)) !== JSON.stringify(checked.originalRecords)) throw recovery();
        check();
      };
      const oldWorld = async () => {
        await controls();
        if (await directoryObjectIdentity(target) !== currentObjectIdentity || await backupDirectoryIdentity(target) !== currentDirectoryIdentity) throw recovery();
        await verifyRestoreTree(target, checked.currentFiles);
        await this.library.resolve(binding, current.worldId, headRevision ?? body.libraryRevision);
      };
      await mark("replacement-intent-persisted"); await oldWorld();
      await mkdir(workspace, { mode: 0o700 }); await syncRestoreDirectory(root);
      const workspaceIdentity = await directoryObjectIdentity(workspace);
      await mark("replacement-workspace-created", undefined, workspaceIdentity);
      for (const [index, file] of ["properties.before", "active.before", "catalog.before"].entries()) await this.snapshot(path.join(workspace, file), originals[index]!.bytes);
      for (const [file, step] of [["properties.before", "replacement-properties-before-verified"], ["catalog.before", "replacement-catalog-before-verified"], ["active.before", "replacement-active-before-verified"]]) {
        const copy = await readPrivatePropertiesFile(path.join(workspace, file!));
        try { await mark(step!, copy.checksum, copy.identity); } finally { copy.bytes.fill(0); }
      }
      await oldWorld();
      const admission = await verifyReplacementAdmissionFiles(record!, root, this.managerRoot, [], check);
      headRevision = await this.library.reserveReplacement(binding, body.libraryRevision, record!, checked.originalRecords, admission);
      await mark("replacement-head-reserved"); await oldWorld();
      await this.uploads.claim(serverId, body.uploadId, body.uploadRevision, context.operationId);
      await mark("replacement-upload-claimed", source.checksumSha256);
      await plainRestoreDirectory(this.managerRoot); await makeRestoreDirectory(path.join(this.managerRoot, "backups"));
      const backupRoot = path.join(this.managerRoot, "backups", serverId); await makeRestoreDirectory(backupRoot);
      const guardStage = path.join(backupRoot, `${guardId}.staging`), guard = path.join(backupRoot, guardId);
      await restoreCapacity(backupRoot, checked.currentFiles.reduce((n, file) => n + file.sizeBytes, 0));
      await mkdir(guardStage, { mode: 0o700 }); await makeRestoreDirectory(path.join(guardStage, "payload"));
      await copyRestoreTree(target, path.join(guardStage, "payload", current.levelName), checked.currentFiles);
      const files = checked.currentFiles.map(file => ({ ...file, path: `${current.levelName}/${file.path}` }));
      const manifest: BackupManifest = { schemaVersion: 1, id: guardId, serverId, scope: "world-set", kind: "snapshot", label: "Before World Replacement",
        state: "complete", pinned: true, createdAt: this.clock.now().toISOString(), minecraftVersion: "26.3", serverType: "vanilla", includedRoots: [current.levelName],
        fileCount: files.length, sizeBytes: files.reduce((n, file) => n + file.sizeBytes, 0), checksumSha256: restoreFilesChecksum(files), files,
        wasRunning: false, restarted: false, downtimeMs: null };
      await writeRestoreJson(path.join(guardStage, "manifest.json"), manifest); await oldWorld();
      if ((await readdir(backupRoot)).some(name => name.toLowerCase() === guardId)) throw recovery();
      check(); await rename(guardStage, guard); await syncRestoreDirectory(backupRoot);
      const guardIdentity = await backupDirectoryIdentity(guard), guardManifest = await readPrivatePropertiesFile(path.join(guard, "manifest.json"), 64 * 1024 ** 2);
      guardManifest.bytes.fill(0);
      const verifyGuard = async () => {
        const actual = await this.backups.exportSource(serverId, guardId);
        if (actual.directory !== guard || actual.manifest.checksumSha256 !== manifest.checksumSha256 || !actual.manifest.pinned || actual.manifest.state !== "complete" ||
            await backupDirectoryIdentity(guard) !== guardIdentity) throw recovery();
        const file = await readPrivatePropertiesFile(path.join(guard, "manifest.json"), 64 * 1024 ** 2);
        try { if (file.identity !== guardManifest.identity || file.checksum !== guardManifest.checksum) throw recovery(); } finally { file.bytes.fill(0); }
        if ((await readdir(path.join(guard, "payload"))).join() !== current.levelName) throw recovery();
        await verifyRestoreTree(path.join(guard, "payload", current.levelName), checked.currentFiles); check();
      };
      await verifyGuard(); await mark("replacement-guard-verified", manifest.checksumSha256, guardIdentity);
      await mark("replacement-guard-manifest-verified", guardManifest.checksum, guardManifest.identity);
      await restoreCapacity(root, source.sizeBytes); await oldWorld();
      const sourceNow = await this.uploads.validatedSource(serverId, body.uploadId, body.uploadRevision, context.operationId);
      if (sourceNow.checksumSha256 !== source.checksumSha256 || await directoryObjectIdentity(workspace) !== workspaceIdentity) throw recovery();
      await copyRestoreTree(path.join(sourceNow.directory, "world"), stage, sourceNow.files);
      const stagedIdentity = await directoryObjectIdentity(stage);
      await mark("replacement-world-staged", source.checksumSha256, stagedIdentity);
      const stageOwned = async () => {
        if (await directoryObjectIdentity(workspace) !== workspaceIdentity || await directoryObjectIdentity(stage) !== stagedIdentity) throw recovery();
        await verifyRestoreTree(stage, source.files); check();
      };
      const snapshots = await verifyReplacementApprovalSnapshots(record!, root, [], check);
      await mark("replacement-displace-intent"); await oldWorld(); await stageOwned(); await verifyGuard(); await snapshots.recheck();
      const sourceOwned = async () => {
        const actual = await this.uploads.validatedSource(serverId, body.uploadId, body.uploadRevision, context.operationId);
        if (actual.directory !== source.directory || actual.checksumSha256 !== source.checksumSha256) throw recovery(); check();
      };
      await sourceOwned(); await oldWorld(); await stageOwned();
      if (await directoryObjectIdentity(target) !== currentObjectIdentity || await directoryObjectIdentity(workspace) !== workspaceIdentity) throw recovery();
      if ((await readdir(workspace)).some(name => name.toLowerCase() === "previous-world")) throw recovery();
      await this.inject?.("replacement-before-displace-rename"); check();
      await rename(target, preserved); await syncRestoreDirectory(root); await syncRestoreDirectory(workspace);
      await this.inject?.("replacement-old-world-renamed"); check();
      await verifyRestoreTree(preserved, checked.currentFiles);
      if (await directoryObjectIdentity(preserved) !== currentObjectIdentity) throw recovery();
      await mark("replacement-old-world-preserved", body.currentContentRevision, currentObjectIdentity);
      await mark("replacement-install-intent"); await controls(); await stageOwned(); await verifyGuard(); await snapshots.recheck();
      await sourceOwned(); await controls(); await stageOwned(); await verifyRestoreTree(preserved, checked.currentFiles);
      if ((await readdir(root)).some(name => name.toLowerCase() === current.levelName.toLowerCase()) ||
          await directoryObjectIdentity(preserved) !== currentObjectIdentity) throw recovery();
      await this.inject?.("replacement-before-install-rename"); check();
      await rename(stage, target); await syncRestoreDirectory(root); await syncRestoreDirectory(workspace);
      await this.inject?.("replacement-new-world-renamed"); check();
      if (await directoryObjectIdentity(target) !== stagedIdentity) throw recovery();
      await verifyRestoreTree(target, source.files);
      await mark("replacement-world-installed", source.checksumSha256, stagedIdentity);
      await mark("replacement-identity-installed", source.checksumSha256, await backupDirectoryIdentity(target));
      await controls(); await verifyGuard(); await snapshots.recheck();
      committed = await this.journal.setState(serverId, record!.transactionId, "committed", this.clock.now().toISOString()); record = committed;
      await this.inject?.("replacement-commit-persisted"); check();
      const proof = await verifyReplacementJournalAndInstalledFiles(committed, [], adapter, this.managerRoot, this.backups, this.uploads, this.journal, check);
      headRevision = await this.library.completeReplacement(binding, headRevision, [...checked.originalRecords, committed], proof);
      await this.inject?.("replacement-head-completed"); await proof.recheck();
      await this.library.projectTransitionHistory(binding, [...checked.originalRecords, committed]);
      await context.onResult?.({ resourceId: worldId, rollbackAvailable: false });
      await this.inject?.("replacement-after-commit"); check();
    } catch (error) {
      if (!record) throw error;
      if (committed && headRevision) {
        try { await this.library.invalidateReplacement(binding, headRevision, [...checked.originalRecords, committed]); } catch { /* Preserve an unknown/newer head. */ }
      }
      if (!committed) {
        try { await this.journal.setState(serverId, record.transactionId, "recovery-required", this.clock.now().toISOString()); } catch { /* Retain original evidence. */ }
      }
      throw recovery();
    } finally { for (const file of originals) file.bytes.fill(0); }
  }
}
