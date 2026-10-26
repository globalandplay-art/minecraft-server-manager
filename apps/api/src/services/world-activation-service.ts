import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { updatePropertiesText } from "../config/properties.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import type { ActiveWorldStateStore } from "./active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import type { BackupManifest, BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { copyRestoreTree, inventoryRestoreTree, makeRestoreDirectory, plainRestoreDirectory, restoreCapacity,
  restoreFilesChecksum, syncRestoreDirectory, verifyRestoreTree, writeRestoreJson } from "./restore-files.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import type { WorldActivationPlanService } from "./world-activation-plan-service.js";
import type { WorldLibraryStore } from "./world-library-store.js";

type Plan = Awaited<ReturnType<WorldActivationPlanService["plan"]>>;
export type WorldActivationApproval = Pick<Plan, "worldId" | "libraryRevision" | "currentWorldId" | "currentWorldRevision" |
  "targetWorldRevision" | "currentContentRevision" | "targetContentRevision" | "propertiesRevision"> & { confirmWorldName: string };
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const conflict = () => new DomainError(409, "WORLD_REVISION_CONFLICT", "Activation approval has changed", "world-activation-approval-changed");
const recovery = () => new DomainError(409, "RECOVERY_REQUIRED", "Activation requires inspection; protection evidence retained", "world-activation-interrupted", true);

/** First-activation execution candidate only. NOT mounted in production: complete
 * committed-history/supersession reconciliation must be reviewed before exposure. */
export class WorldActivationService {
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly library: WorldLibraryStore,
    private readonly plans: WorldActivationPlanService, private readonly states: Pick<ActiveWorldStateStore, "snapshot" | "installImportedWorld">,
    private readonly backups: Pick<BackupService, "exportSource">, private readonly managerRoot: string,
    private readonly clock: Clock, private readonly inject?: (point: string) => Promise<void>) {}

  async activate(serverId: string, body: WorldActivationApproval, key: string, admission?: OperationAdmission) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) throw conflict();
    const request = structuredClone(body);
    return this.operations.requestBackup(serverId, key, JSON.stringify(request), context => this.execute(serverId, request, context),
      async () => { await this.check(serverId, request); }, "world-activate", undefined, admission);
  }

  private async check(serverId: string, body: WorldActivationApproval) {
    const plan = await this.plans.inspectUnderLease(serverId, body.worldId);
    for (const key of ["worldId", "libraryRevision", "currentWorldId", "currentWorldRevision", "targetWorldRevision",
      "currentContentRevision", "targetContentRevision", "propertiesRevision"] as const) if (plan[key] !== body[key]) throw conflict();
    if (body.confirmWorldName !== plan.levelName) throw conflict();
    const scan = await this.journal.scan();
    if (scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || scan.records.some(record => record.intent.serverId === serverId && record.intent.worldActivation)) {
      throw new DomainError(409, "ACTION_UNAVAILABLE", "Subsequent activation history is not implemented", "world-activation-history-pending");
    }
    if (scan.records.some(record => record.intent.serverId === serverId && record.intent.worldArchive)) {
      throw new DomainError(409, "ACTION_UNAVAILABLE", "Activation with archive history is not implemented", "world-activation-archive-history-pending");
    }
    const adapter = this.registry.getLocal(serverId)!, binding = { serverId, rootPath: adapter.plan.rootPath };
    const current = await this.library.activationBinding(binding, body.currentWorldId, body.libraryRevision);
    const target = await this.library.activationBinding(binding, body.worldId, body.libraryRevision);
    const owners = scan.records.filter(record => record.intent.serverId === serverId && record.intent.operationId === target.operationId && record.intent.worldLibraryImport);
    if (owners.length !== 1 || owners[0]!.state !== "committed" || owners[0]!.intent.worldLibraryImport!.worldId !== body.worldId ||
        owners[0]!.intent.worldLibraryImport!.importedChecksum !== body.targetContentRevision || current.catalogId !== target.catalogId) throw recovery();
    return { plan, adapter, binding, current, target, source: owners[0]! };
  }

  private async snapshot(file: string, bytes: Buffer) {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await syncRestoreDirectory(path.dirname(file));
  }

  private async checkpoint(record: TransactionJournalRecord, name: string, checksumSha256?: string, filesystemIdentity?: string) {
    await this.journal.appendCheckpoint(record.intent.serverId, record.transactionId, { name, recordedAt: this.clock.now().toISOString(),
      ...(checksumSha256 || filesystemIdentity ? { details: { resourceId: record.intent.resourceId!,
        ...(checksumSha256 ? { checksumSha256 } : {}), ...(filesystemIdentity ? { filesystemIdentity } : {}) } } : {}) });
    await this.inject?.(name);
  }

  private async execute(serverId: string, body: WorldActivationApproval, context: RuntimeOperationContext) {
    const checked = await this.check(serverId, body);
    const { adapter, current, target } = checked;
    const root = adapter.plan.rootPath, currentPath = path.join(root, current.levelName), targetPath = path.join(root, target.levelName);
    const rootIdentity = await backupDirectoryIdentity(root), before = await readPrivatePropertiesFile(path.join(root, "server.properties"));
    let after: Buffer;
    try {
      const text = before.bytes.toString("utf8");
      if (!before.bytes.equals(Buffer.from(text, "utf8")) || text.startsWith("\ufeff") || text.includes("\0") ||
          editablePropertyEntries(text).filter(([key]) => key === "level-name").length !== 1 ||
          hash(`${before.identity}\0${before.checksum}`) !== body.propertiesRevision) throw conflict();
      after = Buffer.from(updatePropertiesText(text, { "level-name": target.levelName }), "utf8");
    } catch (error) { before.bytes.fill(0); throw error; }
    const guardBackupId = randomUUID(), workspaceName = `.manager-world-activate-${context.operationId}`;
    let record: TransactionJournalRecord;
    try {
      record = await this.journal.createIntent({ operationId: context.operationId, serverId, kind: "world-activate", scope: "world-set",
        resourceId: body.worldId, allowStop: false, originalState: "stopped", createdAt: this.clock.now().toISOString(),
        paths: [{ role: "source", namespace: "server", relativePath: current.levelName }, { role: "target", namespace: "server", relativePath: target.levelName },
          { role: "staging", namespace: "server", relativePath: workspaceName }, { role: "rollback", namespace: "manager", relativePath: `backups/${serverId}/${guardBackupId}` }],
        worldActivation: { rootIdentity, catalogId: target.catalogId, worldId: body.worldId, previousWorldId: body.currentWorldId,
          previousName: current.levelName, nextName: target.levelName, libraryRevision: body.libraryRevision, currentWorldRevision: body.currentWorldRevision,
          targetWorldRevision: body.targetWorldRevision, currentContentChecksum: body.currentContentRevision, targetContentChecksum: body.targetContentRevision,
          currentDirectoryIdentity: current.directoryIdentity, targetDirectoryIdentity: target.directoryIdentity, sourceImportTransactionId: checked.source.transactionId,
          sourceImportChecksum: checked.source.intent.worldLibraryImport!.importedChecksum, predecessorTransactionId: null, sequence: 1,
          guardBackupId, propertiesBefore: before.checksum, propertiesAfter: hash(after), workspaceName } });
    } catch (error) { before.bytes.fill(0); after.fill(0); throw error; }
    try {
      const originalState = this.states.snapshot(serverId);
      const currentFiles = await inventoryRestoreTree(currentPath), targetFiles = await inventoryRestoreTree(targetPath);
      if (restoreFilesChecksum(currentFiles) !== body.currentContentRevision || restoreFilesChecksum(targetFiles) !== body.targetContentRevision) throw conflict();
      const stopped = async () => {
        const status = await adapter.getStatus();
        if (context.signal.aborted || status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired ||
          await backupDirectoryIdentity(root) !== rootIdentity || await backupDirectoryIdentity(currentPath) !== current.directoryIdentity ||
          await backupDirectoryIdentity(targetPath) !== target.directoryIdentity ||
          JSON.stringify((await this.journal.get(serverId, record.transactionId)).intent) !== JSON.stringify(record.intent) ||
          JSON.stringify(await this.journal.get(serverId, checked.source.transactionId)) !== JSON.stringify(checked.source)) throw recovery();
      };
      const unchanged = async () => {
        await stopped();
        const props = await readPrivatePropertiesFile(path.join(root, "server.properties"));
        try { if (props.identity !== before.identity || props.checksum !== before.checksum ||
          JSON.stringify(this.states.snapshot(serverId)) !== JSON.stringify(originalState)) throw recovery(); } finally { props.bytes.fill(0); }
        await verifyRestoreTree(currentPath, currentFiles); await verifyRestoreTree(targetPath, targetFiles);
        await this.library.resolve(checked.binding, body.worldId, body.libraryRevision);
      };
      await this.checkpoint(record, "activation-intent-persisted"); await unchanged();
      await plainRestoreDirectory(this.managerRoot); await makeRestoreDirectory(path.join(this.managerRoot, "backups"));
      const backupRoot = path.join(this.managerRoot, "backups", serverId); await makeRestoreDirectory(backupRoot);
      await restoreCapacity(backupRoot, currentFiles.reduce((sum, file) => sum + file.sizeBytes, 0));
      const staging = path.join(backupRoot, `${guardBackupId}.staging`); await mkdir(staging, { mode: 0o700 });
      await makeRestoreDirectory(path.join(staging, "payload"));
      await copyRestoreTree(currentPath, path.join(staging, "payload", current.levelName), currentFiles);
      const guardFiles = currentFiles.map(file => ({ ...file, path: `${current.levelName}/${file.path}` }));
      const manifest: BackupManifest = { schemaVersion: 1, id: guardBackupId, serverId, scope: "world-set", kind: "snapshot", label: "Before World Activation",
        createdAt: this.clock.now().toISOString(), state: "complete", pinned: true, minecraftVersion: "26.3", serverType: "vanilla", includedRoots: [current.levelName],
        fileCount: guardFiles.length, sizeBytes: guardFiles.reduce((sum, file) => sum + file.sizeBytes, 0), checksumSha256: restoreFilesChecksum(guardFiles), files: guardFiles,
        wasRunning: false, restarted: false, downtimeMs: null };
      await writeRestoreJson(path.join(staging, "manifest.json"), manifest); await unchanged();
      await rename(staging, path.join(backupRoot, guardBackupId)); await syncRestoreDirectory(backupRoot);
      const guardDirectoryIdentity = await backupDirectoryIdentity(path.join(backupRoot, guardBackupId));
      const guardManifestProof = await readPrivatePropertiesFile(path.join(backupRoot, guardBackupId, "manifest.json"), 64 * 1024 ** 2);
      guardManifestProof.bytes.fill(0);
      const verifyGuard = async () => {
        const saved = (await this.backups.exportSource(serverId, guardBackupId)).manifest;
        if (!saved.pinned || saved.id !== manifest.id || saved.checksumSha256 !== manifest.checksumSha256 ||
            saved.includedRoots.length !== 1 || saved.includedRoots[0] !== current.levelName ||
            await backupDirectoryIdentity(path.join(backupRoot, guardBackupId)) !== guardDirectoryIdentity) throw recovery();
        const physicalManifest = await readPrivatePropertiesFile(path.join(backupRoot, guardBackupId, "manifest.json"), 64 * 1024 ** 2);
        try { if (physicalManifest.identity !== guardManifestProof.identity || physicalManifest.checksum !== guardManifestProof.checksum) throw recovery(); }
        finally { physicalManifest.bytes.fill(0); }
        const payload = path.join(backupRoot, guardBackupId, "payload");
        await plainRestoreDirectory(payload);
        const roots = await readdir(payload);
        if (roots.length !== 1 || roots[0] !== current.levelName) throw recovery();
        await verifyRestoreTree(path.join(payload, current.levelName), currentFiles);
      };
      await verifyGuard();
      await this.checkpoint(record, "activation-guard-verified", manifest.checksumSha256, guardDirectoryIdentity);
      await this.checkpoint(record, "activation-guard-manifest-verified", guardManifestProof.checksum, guardManifestProof.identity);
      const workspace = path.join(root, workspaceName); await mkdir(workspace, { mode: 0o700 }); await syncRestoreDirectory(root);
      const workspaceIdentity = await directoryObjectIdentity(workspace);
      await this.snapshot(path.join(workspace, "properties.before"), before.bytes);
      await this.snapshot(path.join(workspace, "properties.approved"), after);
      await this.snapshot(path.join(workspace, "properties.after"), after);
      const protectedCopies: Array<{ name: string; checksum: string; identity: string }> = [];
      for (const [name, expected] of [["properties.before", before.checksum], ["properties.approved", hash(after)]]) {
        const copy = await readPrivatePropertiesFile(path.join(workspace, name!));
        try {
          if (copy.checksum !== expected) throw recovery();
          protectedCopies.push({ name: name!, checksum: copy.checksum, identity: copy.identity });
        } finally { copy.bytes.fill(0); }
      }
      const verifyCopies = async () => {
        if (await directoryObjectIdentity(workspace) !== workspaceIdentity) throw recovery();
        for (const expected of protectedCopies) {
          const copy = await readPrivatePropertiesFile(path.join(workspace, expected.name));
          try { if (copy.identity !== expected.identity || copy.checksum !== expected.checksum) throw recovery(); }
          finally { copy.bytes.fill(0); }
        }
      };
      for (const [index, copy] of protectedCopies.entries()) {
        await this.checkpoint(record, index === 0 ? "activation-before-copy-verified" : "activation-approved-copy-verified", copy.checksum, copy.identity);
      }
      await this.checkpoint(record, "activation-config-staged", hash(after), workspaceIdentity);
      await unchanged();
      await verifyCopies();
      if (await directoryObjectIdentity(workspace) !== workspaceIdentity) throw recovery();
      const staged = await readPrivatePropertiesFile(path.join(workspace, "properties.after"));
      try { if (staged.checksum !== hash(after)) throw recovery(); } finally { staged.bytes.fill(0); }
      await verifyGuard();
      await this.checkpoint(record, "activation-switch-intent");
      await unchanged();
      await verifyGuard();
      await verifyCopies();
      if (await directoryObjectIdentity(workspace) !== workspaceIdentity) throw recovery();
      const finalStage = await readPrivatePropertiesFile(path.join(workspace, "properties.after"));
      try { if (finalStage.identity !== staged.identity || finalStage.checksum !== staged.checksum) throw recovery(); } finally { finalStage.bytes.fill(0); }
      await rename(path.join(workspace, "properties.after"), path.join(root, "server.properties"));
      await syncRestoreDirectory(root); await syncRestoreDirectory(workspace);
      await this.checkpoint(record, "activation-config-installed", hash(after));
      const verifyInstalled = async () => {
        if (await directoryObjectIdentity(workspace) !== workspaceIdentity) throw recovery();
        const final = await readPrivatePropertiesFile(path.join(root, "server.properties"));
        try { if (final.checksum !== staged.checksum || final.identity !== staged.identity) throw recovery(); } finally { final.bytes.fill(0); }
        await verifyCopies();
      };
      await verifyInstalled();
      await stopped(); await verifyRestoreTree(currentPath, currentFiles); await verifyRestoreTree(targetPath, targetFiles);
      await this.states.installImportedWorld(serverId, target.levelName);
      await this.checkpoint(record, "activation-state-installed");
      await stopped(); await verifyGuard(); await verifyInstalled();
      await verifyRestoreTree(currentPath, currentFiles); await verifyRestoreTree(targetPath, targetFiles);
      if ((await this.library.list(checked.binding, this.states.snapshot(serverId))).activeWorldId !== body.worldId) throw recovery();
      await this.checkpoint(record, "activation-final-verified", body.targetContentRevision);
      await stopped(); await verifyInstalled(); await verifyGuard();
      await verifyRestoreTree(currentPath, currentFiles); await verifyRestoreTree(targetPath, targetFiles);
      const finalLibrary = await this.library.list(checked.binding, this.states.snapshot(serverId));
      if (this.states.snapshot(serverId)?.levelName !== target.levelName || finalLibrary.activeWorldId !== body.worldId ||
          finalLibrary.revision !== body.libraryRevision) throw recovery();
      await this.journal.setState(serverId, record.transactionId, "committed", this.clock.now().toISOString());
      await this.inject?.("activation-commit-persisted");
      await context.onResult?.({ resourceId: body.worldId, rollbackAvailable: false });
      await this.inject?.("activation-after-commit");
    } catch {
      try { await this.journal.setState(serverId, record.transactionId, "recovery-required", this.clock.now().toISOString()); } catch { /* Retain original evidence. */ }
      throw recovery();
    } finally { before.bytes.fill(0); after.fill(0); }
  }
}
