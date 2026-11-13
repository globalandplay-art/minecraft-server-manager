import { createHash } from "node:crypto";
import path from "node:path";
import type { AdapterRegistry } from "../adapters/registry.js";
import { worldIdentity } from "./active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { inventoryRestoreTree, restoreFilesChecksum, verifyRestoreTree } from "./restore-files.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import { assessWorldCompatibility, supportsVanillaWorldLayout } from "./world-compatibility.js";
import type { WorldActivationHistoryProtection } from "./world-activation-history-protection.js";
import type { WorldImportUploadService } from "./world-import-upload-service.js";
import { readWorldMetadata } from "./world-inventory-service.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import { orderedActivationHistory } from "./world-activation-history.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "World activation history requires physical inspection", "world-activation-live-history-unverified", true);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Read-only candidate. No operation confirmation, mutation, adoption or repair.
 * Must run before initialization that could create an active slot. Importer
 * proof consumption and startup coordination remain separate required Gates. */
export class WorldActivationLiveHistory {
  constructor(private readonly registry: AdapterRegistry, private readonly journal: TransactionJournalStore,
    private readonly library: WorldLibraryStore, private readonly protection: WorldActivationHistoryProtection,
    private readonly uploads: Pick<WorldImportUploadService, "withLease" | "validatedSource">, private readonly managerRoot: string,
    private readonly check: () => void = () => {}) {}

  async verify(serverId: string) {
    this.check();
    const protectedHistory = await this.protection.verify(serverId), history = protectedHistory.records;
    const head = history.at(-1)!, selected = head.intent.worldActivation!, adapter = this.registry.getLocal(serverId)!;
    const root = adapter.plan.rootPath, binding = { serverId, rootPath: root };
    const activePath = path.join(this.managerRoot, "active-worlds", `${serverId}.json`);
    const readActive = async () => {
      const file = await readPrivatePropertiesFile(activePath, 16 * 1024);
      try {
        const parsed = JSON.parse(file.bytes.toString("utf8"));
        const state = { schemaVersion: 1 as const, serverId, state: "active" as const, levelName: selected.nextName, worldId: worldIdentity(serverId, selected.nextName) };
        if (!parsed || Array.isArray(parsed) || Object.keys(parsed).length !== 5 ||
            Object.entries(state).some(([key, value]) => parsed[key] !== value)) throw fail();
        return { state, identity: file.identity, checksum: file.checksum };
      } finally { file.bytes.fill(0); }
    };
    const readConfig = async () => {
      const file = await readPrivatePropertiesFile(path.join(root, "server.properties"));
      try {
        const text = file.bytes.toString("utf8"), entries = editablePropertyEntries(text).filter(([key]) => key === "level-name");
        if (!file.bytes.equals(Buffer.from(text, "utf8")) || text.startsWith("\ufeff") || text.includes("\0") ||
            entries.length !== 1 || entries[0]![1] !== selected.nextName) throw fail();
        return { identity: file.identity, checksum: file.checksum };
      } finally { file.bytes.fill(0); }
    };
    const active = await readActive(), config = await readConfig(), list = await this.library.list(binding, active.state);
    if (list.state !== "ready" || !list.revision || list.activeWorldId !== selected.worldId) throw fail();
    const scan = await this.journal.scan();
    if (scan.issues.some(issue => !issue.serverId || issue.serverId === serverId)) throw fail();
    const records = scan.records.filter(record => record.intent.serverId === serverId), snapshot = digest(records);
    if (records.some(record => record.intent.worldArchive || ["active", "recovery-required"].includes(record.state)) ||
        digest(orderedActivationHistory(serverId, records)) !== digest(history)) throw fail();
    await this.library.auditImportBindings(binding, records);
    await this.library.auditActivationHead(binding, records);
    // Anchor the supported version to retained imported source bytes, not the
    // currently selected world's self-reported version alone.
    const imports = records.filter(record => record.intent.worldLibraryImport);
    if (!imports.length || imports.some(record => record.state !== "committed")) throw fail();
    let dataVersion: number | null = null;
    const verifySources = async () => this.uploads.withLease(async () => {
      for (const record of imports) {
        this.check();
        const imported = record.intent.worldLibraryImport!;
        if (imported.rootIdentity !== protectedHistory.rootIdentity) throw fail();
        const source = await this.uploads.validatedSource(serverId, imported.uploadId, imported.uploadRevision, record.intent.operationId);
        const version = await readWorldMetadata(path.join(source.directory, "world"));
        if (source.checksumSha256 !== imported.importedChecksum || !version.readable || version.version !== "26.3" ||
            !supportsVanillaWorldLayout(source.files, version) || version.dataVersion === null || (dataVersion !== null && dataVersion !== version.dataVersion)) throw fail();
        dataVersion = version.dataVersion;
        const target = path.join(root, imported.targetName), staged = record.checkpoints.find(point => point.name === "independent-world-staged")?.details?.filesystemIdentity;
        if (!staged || await directoryObjectIdentity(target) !== staged ||
            record.checkpoints.find(point => point.name === "independent-world-installed")?.details?.filesystemIdentity !== staged ||
            !record.checkpoints.some(point => point.name === "independent-identity-installed" && point.details?.resourceId === imported.worldId &&
              point.details.checksumSha256 === imported.importedChecksum)) throw fail();
      }
    });
    await verifySources();
    const observed = [];
    for (const entry of list.items.filter(item => item.state === "present")) {
      this.check();
      const physical = await this.library.activationBinding(binding, entry.worldId, list.revision);
      const world = path.join(root, entry.levelName), files = await inventoryRestoreTree(world), version = await readWorldMetadata(world);
      if (physical.catalogId !== selected.catalogId || !supportsVanillaWorldLayout(files, version) || dataVersion === null ||
          assessWorldCompatibility(version, { serverType: "vanilla", version: "26.3", dataVersion }).status !== "compatible") throw fail();
      const departure = [...history].reverse().find(record => record.intent.worldActivation!.previousWorldId === entry.worldId);
      const imported = imports.find(record => record.intent.worldLibraryImport!.worldId === entry.worldId);
      if (entry.worldId !== selected.worldId) {
        const checksum = departure?.intent.worldActivation!.currentContentChecksum ?? imported?.intent.worldLibraryImport!.importedChecksum;
        if (!checksum || restoreFilesChecksum(files) !== checksum) throw fail();
      }
      observed.push({ world, files, worldId: entry.worldId, directoryIdentity: physical.directoryIdentity });
    }
    const status = await adapter.getStatus();
    if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired) throw fail();
    const fresh = await this.journal.scan();
    if (fresh.issues.some(issue => !issue.serverId || issue.serverId === serverId) ||
        digest(fresh.records.filter(record => record.intent.serverId === serverId)) !== snapshot) throw fail();
    await this.library.auditActivationHead(binding, fresh.records);
    if (JSON.stringify(await readActive()) !== JSON.stringify(active) || JSON.stringify(await readConfig()) !== JSON.stringify(config)) throw fail();
    await verifySources();
    for (const item of observed) {
      this.check();
      await this.library.activationBinding(binding, item.worldId, list.revision);
      await verifyRestoreTree(item.world, item.files);
    }
    await protectedHistory.recheckProtection();
    if (await backupDirectoryIdentity(root) !== protectedHistory.rootIdentity) throw fail();
    const finalScan = await this.journal.scan();
    if (finalScan.issues.some(issue => !issue.serverId || issue.serverId === serverId) ||
        digest(finalScan.records.filter(record => record.intent.serverId === serverId)) !== snapshot) throw fail();
    this.check();
    return { serverId, worldId: selected.worldId, catalogRevision: list.revision, historyDigest: digest(history),
      transactionIds: history.map(record => record.transactionId),
      verifiedOperations: [...imports, ...history].map(record => ({ operationId: record.intent.operationId,
        transactionId: record.transactionId, journalDigest: digest(record) })) };
  }
}
