import path from "node:path";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { AdapterRegistry } from "../adapters/registry.js";
import { parseProperties, SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import { worldIdentity } from "./active-world-state-store.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { verifyRestoreTree } from "./restore-files.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import type { OperationStore } from "./operation-store.js";
import type { WorldGenerationExecution } from "./world-generation-execution.js";
import { assertGenerationProperties, captureGenerationProperties, type GenerationPropertiesProof } from "./world-generation-properties.js";
import { parseWorldMetadata, worldRevisionFromBytes } from "./world-inventory-service.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "World generation preparation requires inspection", "world-generation-preparation-unverified", true);
export type GenerationPreparationLibrary = Pick<WorldLibraryStore,
  "readPublishedGenerationPreparation" | "readSealedGenerationPreparation" | "readPreparedGeneration">;

/** Read-only prepared-state proof under the caller's instance lease. No launch,
 * birth, publication, retry or recovery-release authority. Initial reservation
 * readback still rejects committed records; this is a separate exact boundary. */
export async function verifyWorldGenerationPreparation(registry: AdapterRegistry, managerRoot: string,
  library: GenerationPreparationLibrary, journal: TransactionJournalStore, backups: Pick<BackupService, "exportSource">, serverId: string,
  sealed?: { execution: WorldGenerationExecution; receipts: Pick<OperationStore, "list">; afterStop?: GenerationPropertiesProof; published?: boolean; currentProperties?: GenerationPropertiesProof; requireRunning?: boolean }) {
  const adapter = registry.getLocal(serverId); if (!adapter || adapter.plan.serverInfo.type !== "vanilla") throw fail();
  const binding = { serverId, rootPath: adapter.plan.rootPath };
  if (sealed?.published && !sealed.afterStop && !sealed.currentProperties || sealed?.currentProperties && !sealed.published) throw fail();
  const postRun = Boolean(sealed?.afterStop || sealed?.currentProperties);
  const load = () => sealed?.published ? library.readPublishedGenerationPreparation(binding, journal, sealed.receipts) :
    sealed ? library.readSealedGenerationPreparation(binding, journal, sealed.receipts, sealed.execution, sealed.requireRunning) : library.readPreparedGeneration(binding, journal);
  const observe = async () => {
    const prepared = await load(), g = prepared.reservation;
    if (sealed && (prepared.recordDigest !== sealed.execution.preparedRecordDigest || g.worldId !== sealed.execution.worldId || g.operationId !== sealed.execution.preparationOperationId)) throw fail();
    const stopped = async () => {
      const state = await adapter.getStatus(), profile = await adapter.getServerInfo();
      if (state.state !== "stopped" || state.ownership !== "none" || state.recoveryRequired ||
          profile.type !== "vanilla" || profile.minecraftVersion !== "26.3") throw fail();
    };
    await stopped();
    if (await backupDirectoryIdentity(binding.rootPath) !== g.rootIdentity ||
        await backupDirectoryIdentity(path.join(binding.rootPath, g.previousName)) !== prepared.previousDirectoryIdentity ||
        (!postRun && (await readdir(binding.rootPath)).some(name => name.toLowerCase() === g.nextName.toLowerCase()))) throw fail();
    const controls: { checksum: string; identity: string }[] = [];
    const properties = await readPrivatePropertiesFile(path.join(binding.rootPath, "server.properties"));
    const propertiesProof = captureGenerationProperties(properties);
    try {
      if (sealed?.currentProperties) {
        if (properties.checksum !== sealed.currentProperties.checksum || properties.identity !== sealed.currentProperties.identity) throw fail();
      } else assertGenerationProperties(properties, g.propertiesAfter, sealed?.afterStop);
      if (parseProperties(properties.bytes.toString("utf8")).get("level-name") !== g.nextName) throw fail();
      controls.push({ checksum: properties.checksum, identity: properties.identity });
    } finally { properties.bytes.fill(0); }
    const active = await readPrivatePropertiesFile(path.join(managerRoot, "active-worlds", `${serverId}.json`), 16 * 1024);
    let activeProof: { state: "pending-generation" | "active"; checksum: string; identity: string };
    try {
      const text = active.bytes.toString("utf8"), state = JSON.parse(text);
      if (!state || typeof state !== "object" || Array.isArray(state) || Object.keys(state).length !== 5 ||
          Object.keys(state).some(key => !["schemaVersion", "serverId", "state", "levelName", "worldId"].includes(key)) ||
          !active.bytes.equals(Buffer.from(text, "utf8")) || (text !== JSON.stringify(state) && text !== JSON.stringify(state) + "\n") ||
          state.schemaVersion !== 1 || state.serverId !== serverId ||
          (state.state !== "pending-generation" && !(sealed?.currentProperties && state.state === "active")) ||
          state.levelName !== g.nextName || state.worldId !== worldIdentity(serverId, g.nextName)) throw fail();
      controls.push({ checksum: active.checksum, identity: active.identity });
      activeProof = { state: state.state as "pending-generation" | "active", checksum: active.checksum, identity: active.identity };
    } finally { active.bytes.fill(0); }
    const workspace = path.join(binding.rootPath, prepared.record.intent.worldChange!.workspaceName);
    const workspaceIdentity = await backupDirectoryIdentity(workspace);
    if (JSON.stringify(await readdir(workspace)) !== JSON.stringify(["properties.before"])) throw fail();
    const before = await readPrivatePropertiesFile(path.join(workspace, "properties.before"));
    try { if (before.checksum !== g.propertiesBefore) throw fail(); controls.push({ checksum: before.checksum, identity: before.identity }); }
    finally { before.bytes.fill(0); }
    const level = await readPrivatePropertiesFile(path.join(binding.rootPath, g.previousName, "level.dat"), 8 * 1024 * 1024);
    try {
      const metadata = parseWorldMetadata(level.bytes);
      if (!metadata.readable || metadata.version !== "26.3" || metadata.dataVersion !== 5023 ||
          worldRevisionFromBytes(serverId, g.previousName, level.bytes) !== prepared.record.intent.worldChange!.approvedRevision) throw fail();
      controls.push({ checksum: level.checksum, identity: level.identity });
    } finally { level.bytes.fill(0); }
    const guard = await backups.exportSource(serverId, g.guardBackupId), checkpoint = prepared.record.checkpoints[2]!;
    if (!guard.manifest.pinned || guard.manifest.kind !== "snapshot" || guard.manifest.state !== "complete" ||
        guard.manifest.serverType !== "vanilla" || guard.manifest.minecraftVersion !== "26.3" ||
        guard.manifest.id !== g.guardBackupId || guard.manifest.serverId !== serverId ||
        guard.manifest.scope !== "world-set" || JSON.stringify(guard.manifest.includedRoots) !== JSON.stringify([g.previousName]) ||
        guard.manifest.checksumSha256 !== checkpoint.details?.checksumSha256) throw fail();
    const files = guard.manifest.files.map(file => {
      if (!file.path.startsWith(g.previousName + "/")) throw fail();
      return { ...file, path: file.path.slice(g.previousName.length + 1) };
    });
    await verifyRestoreTree(path.join(guard.directory, "payload", g.previousName), files);
    await verifyRestoreTree(path.join(binding.rootPath, g.previousName), files);
    const controlPaths = [path.join(binding.rootPath, "server.properties"), path.join(managerRoot, "active-worlds", `${serverId}.json`),
      path.join(workspace, "properties.before"), path.join(binding.rootPath, g.previousName, "level.dat")];
    const limits = [SERVER_PROPERTIES_LIMIT, 16 * 1024, SERVER_PROPERTIES_LIMIT, 8 * 1024 * 1024];
    for (const [index, file] of controlPaths.entries()) {
      const value = await readPrivatePropertiesFile(file, limits[index]!);
      try { if (value.checksum !== controls[index]!.checksum || value.identity !== controls[index]!.identity) throw fail(); }
      finally { value.bytes.fill(0); }
    }
    await stopped();
    const final = await load();
    if (hash(final) !== hash(prepared) || await backupDirectoryIdentity(workspace) !== workspaceIdentity ||
        JSON.stringify(await readdir(workspace)) !== JSON.stringify(["properties.before"]) ||
        await backupDirectoryIdentity(binding.rootPath) !== g.rootIdentity ||
        await backupDirectoryIdentity(path.join(binding.rootPath, g.previousName)) !== prepared.previousDirectoryIdentity ||
        (!postRun && (await readdir(binding.rootPath)).some(name => name.toLowerCase() === g.nextName.toLowerCase()))) throw fail();
    const stableControls = controls.map((control, index) => index === 0 ? { ...control, checksum: g.propertiesAfter } : control);
    return { prepared, controlsDigest: hash({ controls: stableControls, workspaceIdentity, guardChecksum: guard.manifest.checksumSha256 }),
      nonSlotControlsDigest: hash({ controls: stableControls.filter((_, index) => index !== 1), workspaceIdentity, guardChecksum: guard.manifest.checksumSha256 }),
      propertiesProof, activeProof, workspaceIdentity, guardChecksum: guard.manifest.checksumSha256 };
  };
  try {
    const initial = await observe();
    const recheck = async () => {
      try { if (hash(await observe()) !== hash(initial)) throw fail(); } catch { throw fail(); }
    };
    return { reservation: structuredClone(initial.prepared.reservation), catalogRevision: initial.prepared.catalogRevision,
      recordDigest: initial.prepared.recordDigest, controlsDigest: initial.controlsDigest, propertiesProof: structuredClone(initial.propertiesProof),
      nonSlotControlsDigest: initial.nonSlotControlsDigest,
      activeProof: structuredClone(initial.activeProof), recheck };
  } catch { throw fail(); }
}
