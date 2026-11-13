import { createHash } from "node:crypto";
import path from "node:path";
import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import { worldIdentity } from "./active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { inventoryRestoreTree, verifyRestoreTree } from "./restore-files.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import { assessWorldCompatibility, supportsVanillaWorldLayout } from "./world-compatibility.js";
import type { WorldImportUploadService } from "./world-import-upload-service.js";
import { readWorldMetadata } from "./world-inventory-service.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import { verifyReplacementApprovalSnapshots } from "./world-replacement-approval.js";
import { readReplacementSource, readRetainedWorldSource } from "./world-replacement-installed.js";
import { verifyReplacementProtection } from "./world-replacement-protection.js";
import { orderedWorldTransitionRecords, replacementTransitionEvent } from "./world-transition-records.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Replacement current state requires inspection", "world-replacement-live-unverified", true);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** First committed replacement ONLY. Read-only current-state observation under
 * caller-owned instance/upload leases. Normal active-world saves may differ from
 * import bytes; all observed current files remain stable through this proof.
 * No catalog repair, replay, initialization, operation settlement or gate clear.
 */
export async function verifyReplacementCurrentState(adapter: LocalMinecraftServerAdapter, managerRoot: string,
  journal: Pick<TransactionJournalStore, "scan">, library: WorldLibraryStore, backups: Pick<BackupService, "exportSource">,
  uploads: Pick<WorldImportUploadService, "validatedSource">, check: () => void = () => {}) {
  try {
    check(); const serverId = adapter.serverId, root = adapter.plan.rootPath, binding = { serverId, rootPath: root };
    const scan = await journal.scan(), scoped = scan.records.filter(record => record.intent.serverId === serverId);
    if (scan.issues.some(issue => !issue.serverId || issue.serverId === serverId) || scan.recoveryServerIds.has(serverId)) throw fail();
    const history = orderedWorldTransitionRecords(serverId, scoped), record = history[0], value = record?.intent.worldReplacement;
    if (history.length !== 1 || record?.schemaVersion !== 13 || !value ||
        scoped.some(item => !["world-replace", "world-library-import", "backup", "backup-export", "properties-write"].includes(item.intent.kind))) throw fail();
    const event = replacementTransitionEvent(record), journalDigest = hash(scoped);
    const protection = await verifyReplacementProtection(record, adapter, managerRoot, backups, check);
    const approvals = await verifyReplacementApprovalSnapshots(record, root, [], check);
    const retained = await readReplacementSource(record, managerRoot, uploads);
    const sourceVersion = await readWorldMetadata(path.join(retained.source.directory, "world"));
    if (!sourceVersion.readable || sourceVersion.version !== "26.3" || sourceVersion.dataVersion === null || !supportsVanillaWorldLayout(retained.source.files, sourceVersion)) throw fail();
    const readControls = async () => {
      const props = await readPrivatePropertiesFile(path.join(root, "server.properties"));
      let active: Awaited<ReturnType<typeof readPrivatePropertiesFile>> | undefined;
      try {
        active = await readPrivatePropertiesFile(path.join(managerRoot, "active-worlds", `${serverId}.json`), 16 * 1024);
        const text = props.bytes.toString("utf8"), names = editablePropertyEntries(text).filter(([key]) => key === "level-name");
        const activeText = active.bytes.toString("utf8"), state = JSON.parse(activeText);
        if (!props.bytes.equals(Buffer.from(text, "utf8")) || text.startsWith("\ufeff") || text.includes("\0") || names.length !== 1 || names[0]![1] !== value.levelName ||
            !active.bytes.equals(Buffer.from(activeText, "utf8")) || !state || typeof state !== "object" || Array.isArray(state) ||
            (activeText !== JSON.stringify(state) && activeText !== JSON.stringify(state) + "\n") || Object.keys(state).length !== 5 ||
            state.schemaVersion !== 1 || state.serverId !== serverId || state.state !== "active" || state.levelName !== value.levelName ||
            state.worldId !== worldIdentity(serverId, value.levelName)) throw fail();
        return { state, propertiesIdentity: props.identity, propertiesChecksum: props.checksum, activeIdentity: active.identity, activeChecksum: active.checksum };
      } finally { props.bytes.fill(0); active?.bytes.fill(0); }
    };
    const controls = await readControls();
    await library.projectTransitionHistory(binding, scoped);
    const list = await library.list(binding, controls.state);
    if (list.state !== "ready" || !list.revision || list.activeWorldId !== value.worldId) throw fail();
    const catalogPath = path.join(managerRoot, "world-library", serverId, "state.json");
    const catalogFile = await readPrivatePropertiesFile(catalogPath, 1024 * 1024); catalogFile.bytes.fill(0);
    if (catalogFile.checksum !== list.revision) throw fail();
    const birthClaims = new Map<string, { identity: string; checksum: string; sourceDigest: string }>();
    const verifyImportBirths = async () => {
      const births = await library.auditReplacementImportBindings(binding, scoped, record);
      for (const owner of births) {
        check(); const imported = owner.intent.worldLibraryImport!;
        const claim = await readRetainedWorldSource(owner, managerRoot, uploads), origin = claim.source;
        const original = birthClaims.get(owner.transactionId), observed = { identity: claim.claimIdentity, checksum: claim.claimChecksum, sourceDigest: hash(origin) };
        if (original && JSON.stringify(original) !== JSON.stringify(observed)) throw fail();
        birthClaims.set(owner.transactionId, observed);
        const metadata = await readWorldMetadata(path.join(origin.directory, "world"));
        if (origin.checksumSha256 !== imported.importedChecksum || origin.minecraftVersion !== "26.3" || !metadata.readable ||
            !supportsVanillaWorldLayout(origin.files, metadata) || metadata.dataVersion === null ||
            assessWorldCompatibility(metadata, { serverType: "vanilla", version: "26.3", dataVersion: sourceVersion.dataVersion }).status !== "compatible") throw fail();
        await claim.recheckClaim();
      }
      return births.map(owner => ({ operationId: owner.intent.operationId, transactionId: owner.transactionId,
        worldId: owner.intent.worldLibraryImport!.worldId, recordDigest: hash(owner) }));
    };
    const verifiedImports = await verifyImportBirths();
    for (const owner of scoped.filter(item => item.intent.worldLibraryImport)) {
      const imported = owner.intent.worldLibraryImport!, entry = list.items.find(item => item.worldId === imported.worldId);
      if (owner.state !== "committed" || !entry || entry.levelName !== imported.targetName ||
          (entry.state !== "present" && entry.worldId !== value.previousWorldId)) throw fail();
    }
    const observed: Array<{ worldId: string; directory: string; objectIdentity: string; files: Awaited<ReturnType<typeof inventoryRestoreTree>> }> = [];
    for (const entry of list.items.filter(item => item.state === "present")) {
      check(); const bound = await library.activationBinding(binding, entry.worldId, list.revision), directory = path.join(root, entry.levelName);
      const files = await inventoryRestoreTree(directory), metadata = await readWorldMetadata(directory);
      if (bound.catalogId !== value.catalogId || !supportsVanillaWorldLayout(files, metadata) ||
          assessWorldCompatibility(metadata, { serverType: "vanilla", version: "26.3", dataVersion: sourceVersion.dataVersion }).status !== "compatible") throw fail();
      const objectIdentity = await directoryObjectIdentity(directory);
      if (entry.worldId === value.worldId) {
        if (bound.directoryIdentity !== event.next.directoryIdentity || objectIdentity !== record.checkpoints.find(point => point.name === "replacement-world-installed")!.details!.filesystemIdentity) throw fail();
      } else {
        const owners = scoped.filter(item => item.intent.worldLibraryImport?.worldId === entry.worldId);
        if (owners.length !== 1 || owners[0]!.state !== "committed") throw fail();
        const owner = owners[0]!, imported = owner.intent.worldLibraryImport!;
        const source = await uploads.validatedSource(serverId, imported.uploadId, imported.uploadRevision, owner.intent.operationId);
        if (bound.operationId !== owner.intent.operationId || source.checksumSha256 !== imported.importedChecksum || imported.targetName !== entry.levelName ||
            objectIdentity !== owner.checkpoints.find(point => point.name === "independent-world-staged")?.details?.filesystemIdentity ||
            objectIdentity !== owner.checkpoints.find(point => point.name === "independent-world-installed")?.details?.filesystemIdentity) throw fail();
        await verifyRestoreTree(directory, source.files);
      }
      observed.push({ worldId: entry.worldId, directory, objectIdentity, files });
    }
    const verifyObserved = async () => {
      check(); const status = await adapter.getStatus();
      if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired || await backupDirectoryIdentity(root) !== value.rootIdentity ||
          JSON.stringify(await readControls()) !== JSON.stringify(controls)) throw fail();
      await library.projectTransitionHistory(binding, scoped);
      const current = await library.list(binding, controls.state);
      if (current.revision !== list.revision || current.activeWorldId !== value.worldId || current.state !== "ready") throw fail();
      const catalog = await readPrivatePropertiesFile(catalogPath, 1024 * 1024);
      try { if (catalog.identity !== catalogFile.identity || catalog.checksum !== catalogFile.checksum) throw fail(); } finally { catalog.bytes.fill(0); }
      for (const item of observed) {
        check(); await library.activationBinding(binding, item.worldId, list.revision!);
        if (await directoryObjectIdentity(item.directory) !== item.objectIdentity) throw fail();
        await verifyRestoreTree(item.directory, item.files);
      }
      if (JSON.stringify(await readControls()) !== JSON.stringify(controls)) throw fail(); check();
    };
    const verifyJournal = async () => {
      check(); const current = await journal.scan();
      if (current.issues.some(issue => !issue.serverId || issue.serverId === serverId) || current.recoveryServerIds.has(serverId) ||
          hash(current.records.filter(item => item.intent.serverId === serverId)) !== journalDigest) throw fail();
    };
    const recheck = async () => {
      try {
        await verifyJournal(); await protection.recheck(); await approvals.recheck(); await verifyImportBirths();
        const freshSource = await readReplacementSource(record, managerRoot, uploads);
        if (freshSource.claimIdentity !== retained.claimIdentity || freshSource.claimChecksum !== retained.claimChecksum ||
            JSON.stringify(freshSource.source) !== JSON.stringify(retained.source)) throw fail();
        await verifyObserved(); await protection.recheck(); await approvals.recheck();
        const finalSource = await readReplacementSource(record, managerRoot, uploads);
        if (finalSource.claimIdentity !== retained.claimIdentity || finalSource.claimChecksum !== retained.claimChecksum ||
            JSON.stringify(finalSource.source) !== JSON.stringify(retained.source)) throw fail();
        await retained.recheckClaim(); await verifyImportBirths(); await verifyObserved(); await verifyJournal(); check();
      } catch { throw fail(); }
    };
    await recheck();
    return { serverId, operationId: record.intent.operationId, worldId: value.worldId, transactionId: record.transactionId,
      journalDigest, recordDigest: hash(record), catalogRevision: list.revision, verifiedImports, phase: "current-state" as const, recheck };
  } catch { throw fail(); }
}
