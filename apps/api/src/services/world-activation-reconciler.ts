import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AdapterRegistry } from "../adapters/registry.js";
import { updatePropertiesText } from "../config/properties.js";
import { worldIdentity, type ActiveWorldState } from "./active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { inventoryRestoreTree, plainRestoreDirectory, restoreFilesChecksum, verifyRestoreTree } from "./restore-files.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import { assessWorldCompatibility } from "./world-compatibility.js";
import type { WorldImportUploadService } from "./world-import-upload-service.js";
import { readWorldMetadata } from "./world-inventory-service.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import type { WorldImportSupersession } from "./world-library-import-service.js";
import { orderedActivationHistory } from "./world-activation-history.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Activation evidence requires inspection", "world-activation-proof-unverified", true);
const requiredSteps = ["activation-intent-persisted", "activation-guard-verified", "activation-guard-manifest-verified",
  "activation-before-copy-verified", "activation-approved-copy-verified", "activation-config-staged", "activation-switch-intent",
  "activation-config-installed", "activation-state-installed", "activation-final-verified"];

/** Read-only first-activation history verification. No automatic repair/replay,
 * rollback, deletion or recovery-cause clearing. Mounted only for observation. */
export class WorldActivationReconciler {
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly library: WorldLibraryStore,
    private readonly uploads: Pick<WorldImportUploadService, "withLease" | "validatedSource">,
    private readonly backups: Pick<BackupService, "exportSource">, private readonly managerRoot: string) {}

  private async verify(record: TransactionJournalRecord, source: TransactionJournalRecord) {
    const w = record.intent.worldActivation, imported = source.intent.worldLibraryImport;
    const serverId = record.intent.serverId, adapter = this.registry.getLocal(serverId);
    if (!w || !imported || !adapter || adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3" ||
        record.state !== "committed" || source.state !== "committed" || source.intent.serverId !== serverId ||
        w.sequence !== 1 || w.predecessorTransactionId !== null || w.sourceImportTransactionId !== source.transactionId ||
        w.worldId !== imported.worldId || w.nextName !== imported.targetName || w.sourceImportChecksum !== imported.importedChecksum ||
        w.targetContentChecksum !== imported.importedChecksum || w.rootIdentity !== imported.rootIdentity ||
        record.checkpoints.length !== requiredSteps.length || record.checkpoints.some((point, index) => point.name !== requiredSteps[index])) throw fail();
    const points = new Map(record.checkpoints.map(point => [point.name, point]));
    const details = (name: string) => {
      const value = points.get(name)?.details;
      if (!value || value.resourceId !== w.worldId) throw fail();
      return value;
    };
    if (details("activation-final-verified").checksumSha256 !== w.targetContentChecksum ||
        details("activation-config-installed").checksumSha256 !== w.propertiesAfter ||
        details("activation-config-staged").checksumSha256 !== w.propertiesAfter) throw fail();
    const root = adapter.plan.rootPath, binding = { serverId, rootPath: root };
    await plainRestoreDirectory(this.managerRoot);
    const stopped = async () => {
      const status = await adapter.getStatus();
      if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired || await backupDirectoryIdentity(root) !== w.rootIdentity) throw fail();
    };
    await stopped();
    const scan = await this.journal.scan();
    if (scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) ||
        scan.records.filter(item => item.intent.serverId === serverId && item.intent.worldActivation).length !== 1 ||
        scan.records.some(item => item.intent.serverId === serverId && item.intent.worldArchive) ||
        scan.records.some(item => item.intent.serverId === serverId && ["active", "recovery-required"].includes(item.state))) throw fail();
    const history = orderedActivationHistory(serverId, scan.records);
    // Structural validity alone never grants repeated-activation recovery.
    if (history.length !== 1 || history[0]!.transactionId !== record.transactionId) throw fail();
    await this.library.auditImportBindings(binding, scan.records);
    const activeFile = path.join(this.managerRoot, "active-worlds", `${serverId}.json`);
    await plainRestoreDirectory(path.dirname(activeFile));
    const readActive = async () => {
      const saved = await readPrivatePropertiesFile(activeFile, 16 * 1024);
      try {
        const parsed: unknown = JSON.parse(saved.bytes.toString("utf8"));
        const expected: ActiveWorldState = { schemaVersion: 1, serverId, state: "active", levelName: w.nextName, worldId: worldIdentity(serverId, w.nextName) };
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 5 ||
            Object.entries(expected).some(([key, value]) => (parsed as Record<string, unknown>)[key] !== value)) throw fail();
        return { state: expected, identity: saved.identity, checksum: saved.checksum };
      } finally { saved.bytes.fill(0); }
    };
    const active = await readActive();
    const list = await this.library.list(binding, active.state);
    if (list.state !== "ready" || !list.revision || list.activeWorldId !== w.worldId) throw fail();
    const current = await this.library.activationBinding(binding, w.previousWorldId, list.revision);
    const target = await this.library.activationBinding(binding, w.worldId, list.revision);
    if (current.catalogId !== w.catalogId || target.catalogId !== w.catalogId || current.levelName !== w.previousName || target.levelName !== w.nextName ||
        current.directoryIdentity !== w.currentDirectoryIdentity || target.directoryIdentity !== w.targetDirectoryIdentity || target.operationId !== source.intent.operationId) throw fail();
    const currentPath = path.join(root, w.previousName), targetPath = path.join(root, w.nextName);
    const staged = source.checkpoints.find(point => point.name === "independent-world-staged")?.details?.filesystemIdentity;
    if (!staged || source.checkpoints.find(point => point.name === "independent-world-installed")?.details?.filesystemIdentity !== staged ||
        await directoryObjectIdentity(targetPath) !== staged ||
        !source.checkpoints.some(point => point.name === "independent-identity-installed" && point.details?.resourceId === w.worldId && point.details.checksumSha256 === w.sourceImportChecksum)) throw fail();
    const workspace = path.join(root, w.workspaceName), workspaceId = details("activation-config-staged").filesystemIdentity;
    if (!workspaceId || await directoryObjectIdentity(workspace) !== workspaceId) throw fail();
    const readCopy = async (name: string, step: string, checksum: string) => {
      const proof = details(step), file = await readPrivatePropertiesFile(path.join(workspace, name));
      if (!proof.filesystemIdentity || file.identity !== proof.filesystemIdentity || file.checksum !== checksum || proof.checksumSha256 !== checksum) {
        file.bytes.fill(0); throw fail();
      }
      return file;
    };
    const before = await readCopy("properties.before", "activation-before-copy-verified", w.propertiesBefore);
    let approved: Awaited<ReturnType<typeof readPrivatePropertiesFile>> | undefined;
    try {
      approved = await readCopy("properties.approved", "activation-approved-copy-verified", w.propertiesAfter);
      const text = before.bytes.toString("utf8"), after = approved.bytes.toString("utf8");
      const entries = editablePropertyEntries(text).filter(([key]) => key === "level-name");
      if (!before.bytes.equals(Buffer.from(text, "utf8")) || !approved.bytes.equals(Buffer.from(after, "utf8")) || text.startsWith("\ufeff") || text.includes("\0") ||
          entries.length !== 1 || entries[0]![1] !== w.previousName || updatePropertiesText(text, { "level-name": w.nextName }) !== after) throw fail();
    } finally { before.bytes.fill(0); approved?.bytes.fill(0); }
    const guard = await this.backups.exportSource(serverId, w.guardBackupId), manifest = guard.manifest;
    const expectedGuardPath = path.join(this.managerRoot, "backups", serverId, w.guardBackupId);
    if (guard.directory !== expectedGuardPath || !manifest.pinned || manifest.scope !== "world-set" || manifest.serverType !== "vanilla" ||
        manifest.minecraftVersion !== "26.3" || manifest.includedRoots.length !== 1 || manifest.includedRoots[0] !== w.previousName ||
        manifest.checksumSha256 !== details("activation-guard-verified").checksumSha256 ||
        await backupDirectoryIdentity(expectedGuardPath) !== details("activation-guard-verified").filesystemIdentity) throw fail();
    const guardManifest = await readPrivatePropertiesFile(path.join(expectedGuardPath, "manifest.json"), 64 * 1024 ** 2);
    try { if (guardManifest.identity !== details("activation-guard-manifest-verified").filesystemIdentity ||
      guardManifest.checksum !== details("activation-guard-manifest-verified").checksumSha256) throw fail(); } finally { guardManifest.bytes.fill(0); }
    const guardFiles = manifest.files.map(file => {
      if (!file.path.startsWith(`${w.previousName}/`)) throw fail();
      return { ...file, path: file.path.slice(w.previousName.length + 1) };
    });
    if (restoreFilesChecksum(guardFiles) !== w.currentContentChecksum) throw fail();
    const payload = path.join(expectedGuardPath, "payload"); await plainRestoreDirectory(payload);
    const roots = await readdir(payload); if (roots.length !== 1 || roots[0] !== w.previousName) throw fail();
    await verifyRestoreTree(path.join(payload, w.previousName), guardFiles); await verifyRestoreTree(currentPath, guardFiles);
    const verifyProtection = async () => {
      for (const [name, step, checksum] of [["properties.before", "activation-before-copy-verified", w.propertiesBefore],
        ["properties.approved", "activation-approved-copy-verified", w.propertiesAfter]]) {
        const copy = await readCopy(name!, step!, checksum!); copy.bytes.fill(0);
      }
      if (await backupDirectoryIdentity(expectedGuardPath) !== details("activation-guard-verified").filesystemIdentity) throw fail();
      const fresh = await readPrivatePropertiesFile(path.join(expectedGuardPath, "manifest.json"), 64 * 1024 ** 2);
      try { if (fresh.identity !== guardManifest.identity || fresh.checksum !== guardManifest.checksum) throw fail(); }
      finally { fresh.bytes.fill(0); }
      await plainRestoreDirectory(payload);
      const children = await readdir(payload); if (children.length !== 1 || children[0] !== w.previousName) throw fail();
      await verifyRestoreTree(path.join(payload, w.previousName), guardFiles);
    };
    const oldRevision = await this.library.resolve(binding, w.previousWorldId, list.revision);
    if (oldRevision.worldRevision !== w.currentWorldRevision) throw fail();
    const targetFiles = await inventoryRestoreTree(targetPath);
    if (targetFiles.some(file => file.path.startsWith("dimensions/"))) throw fail();
    await this.uploads.withLease(async () => {
      const origin = await this.uploads.validatedSource(serverId, imported.uploadId, imported.uploadRevision, source.intent.operationId);
      if (origin.checksumSha256 !== imported.importedChecksum ||
          assessWorldCompatibility(await readWorldMetadata(targetPath), { serverType: "vanilla", version: "26.3",
            dataVersion: (await readWorldMetadata(path.join(origin.directory, "world"))).dataVersion }).status !== "compatible") throw fail();
    });
    const checkLive = async () => {
      const props = await readPrivatePropertiesFile(path.join(root, "server.properties"));
      try {
        const text = props.bytes.toString("utf8"), selected = editablePropertyEntries(text).filter(([key]) => key === "level-name");
        if (!props.bytes.equals(Buffer.from(text, "utf8")) || text.startsWith("\ufeff") || text.includes("\0") || selected.length !== 1 || selected[0]![1] !== w.nextName) throw fail();
        return { identity: props.identity, checksum: props.checksum };
      } finally { props.bytes.fill(0); }
    };
    const live = await checkLive(); await stopped(); await verifyRestoreTree(targetPath, targetFiles); await verifyRestoreTree(currentPath, guardFiles);
    await verifyProtection();
    const finalActive = await readActive();
    if (finalActive.identity !== active.identity || finalActive.checksum !== active.checksum || await directoryObjectIdentity(workspace) !== workspaceId ||
        await backupDirectoryIdentity(currentPath) !== w.currentDirectoryIdentity || await backupDirectoryIdentity(targetPath) !== w.targetDirectoryIdentity ||
        JSON.stringify(await this.journal.get(serverId, record.transactionId)) !== JSON.stringify(record) ||
        JSON.stringify(await this.journal.get(serverId, source.transactionId)) !== JSON.stringify(source)) throw fail();
    await this.library.activationBinding(binding, w.worldId, list.revision);
    if (JSON.stringify(await checkLive()) !== JSON.stringify(live)) throw fail();
    return { serverId, activationTransactionId: record.transactionId, activationOperationId: record.intent.operationId,
      activationJournalDigest: createHash("sha256").update(JSON.stringify(record)).digest("hex"), importTransactionId: source.transactionId,
      worldId: w.worldId, catalogId: w.catalogId, catalogRevision: list.revision, rootIdentity: w.rootIdentity, targetName: w.nextName,
      targetDirectoryIdentity: w.targetDirectoryIdentity, importedChecksum: w.sourceImportChecksum } satisfies WorldImportSupersession;
  }

  /** Optional importer hook. It must be called BEFORE taking the upload lease. */
  async verifiesSupersession(source: TransactionJournalRecord): Promise<WorldImportSupersession | null> {
    const scan = await this.journal.scan();
    const records = scan.records.filter(item => item.intent.serverId === source.intent.serverId && item.intent.worldActivation);
    if (!records.length) return null;
    if (records.length !== 1 || scan.issues.some(issue => !issue.serverId || issue.serverId === source.intent.serverId)) throw fail();
    if (records[0]!.intent.worldActivation!.worldId !== source.intent.worldLibraryImport?.worldId) return null;
    return this.verify(records[0]!, source);
  }

  async reconcileStartup(): Promise<void> {
    const scan = await this.journal.scan();
    for (const record of scan.records.filter(item => item.intent.worldActivation)) {
      try {
        const source = scan.records.find(item => item.transactionId === record.intent.worldActivation!.sourceImportTransactionId);
        if (!source) throw fail();
        await this.verify(record, source);
        // Final confirmation belongs to the importer after its last awaited
        // source validation and fresh exact proof consumption, never here.
      } catch { this.operations.requireTransactionRecovery(record.intent.serverId, record.intent.operationId); }
    }
  }
}
import { createHash } from "node:crypto";
