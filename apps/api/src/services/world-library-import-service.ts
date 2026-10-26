import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readdir, rename } from "node:fs/promises";
import type { Operation, WorldLibraryImportRequest } from "@mcsm/contracts";
import type { AdapterRegistry } from "../adapters/registry.js";
import { isLocalAdapter, type LocalMinecraftServerAdapter } from "../adapters/contract.js";
import type { Clock } from "../clock.js";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import { parseProperties } from "../config/properties.js";
import type { ActiveWorldStateStore } from "./active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { copyRestoreTree, inventoryRestoreTree, restoreCapacity, syncRestoreDirectory, verifyRestoreTree } from "./restore-files.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import { assessWorldCompatibility } from "./world-compatibility.js";
import { WorldCreatePlanService } from "./world-create-plan-service.js";
import type { WorldImportUploadService } from "./world-import-upload-service.js";
import { readWorldMetadata } from "./world-inventory-service.js";
import { allocateWorldIdentity, type WorldLibraryStore } from "./world-library-store.js";

export type InactiveWorldImportRequest = WorldLibraryImportRequest;
export type WorldImportSupersession = {
  serverId: string; activationTransactionId: string; activationOperationId: string; activationJournalDigest: string;
  importTransactionId: string; worldId: string; catalogId: string; catalogRevision: string;
  rootIdentity: string; targetName: string; targetDirectoryIdentity: string; importedChecksum: string;
};
const conflict = () => new DomainError(409, "WORLD_REVISION_CONFLICT", "World import plan has changed", "world-library-plan-changed");
const recovery = () => new DomainError(409, "RECOVERY_REQUIRED", "World installation requires inspection", "world-library-import-incomplete", true);
type Uploads = Pick<WorldImportUploadService, "withLease" | "validatedSource" | "claim">;

/** Installs a distinct inactive world only. No configuration/active-pointer writer,
 * stop/start/RCON method or legacy backup writer is used by this controller.
 */
export class WorldLibraryImportService {
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly library: WorldLibraryStore,
    private readonly uploads: Uploads, private readonly states: Pick<ActiveWorldStateStore, "snapshot">,
    private readonly clock: Clock, private readonly inject?: (point: string) => Promise<void>,
    private readonly supersession?: (record: TransactionJournalRecord) => Promise<WorldImportSupersession | null>) {}

  async available(serverId: string): Promise<boolean> {
    const adapter = this.registry.getLocal(serverId);
    if (!adapter || adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3") return false;
    const operation = this.operations.getServerState(serverId);
    if (operation.recoveryRequired || operation.activeOperationId) return false;
    const active = this.states.snapshot(serverId);
    if (active?.state !== "active") return false;
    const status = await adapter.getStatus();
    if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired) return false;
    return (await this.library.list({ serverId, rootPath: adapter.plan.rootPath }, active)).state === "ready";
  }

  private async stopped(adapter: LocalMinecraftServerAdapter): Promise<void> {
    const status = await adapter.getStatus();
    if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired) {
      throw new DomainError(409, "SERVER_MUST_BE_STOPPED", "Stop the managed server before importing an independent world", "stopped-import-required");
    }
  }

  private async properties(adapter: LocalMinecraftServerAdapter) {
    const file = await readPrivatePropertiesFile(path.join(adapter.plan.rootPath, "server.properties"));
    try { return { checksum: file.checksum, levelName: parseProperties(file.bytes.toString("utf8")).get("level-name") ?? "world" }; }
    finally { file.bytes.fill(0); }
  }

  private async absent(adapter: LocalMinecraftServerAdapter, name: string): Promise<void> {
    if ((await readdir(adapter.plan.rootPath)).some(item => item.normalize("NFC").toLowerCase() === name.normalize("NFC").toLowerCase())) throw conflict();
  }

  private async check(serverId: string, request: { name: string; uploadId: string }, operationId?: string) {
    if (request.name.normalize("NFC") !== request.name) throw conflict();
    const planned = await new WorldCreatePlanService(this.registry, this.operations).plan(serverId, { name: request.name, seed: "" });
    const adapter = this.registry.getLocal(serverId)!;
    if (planned.minecraftVersion !== "26.3") throw new DomainError(409, "WORLD_VERSION_UNAVAILABLE", "This import profile only supports Vanilla 26.3", "world-profile-unverified");
    await this.stopped(adapter);
    const binding = { serverId, rootPath: adapter.plan.rootPath };
    const active = this.states.snapshot(serverId);
    const observed = await this.library.list(binding, active);
    if (active?.state !== "active" || observed.state !== "ready" || !observed.revision || !observed.activeWorldId) throw recovery();
    const current = await this.library.resolve(binding, observed.activeWorldId, observed.revision);
    const props = await this.properties(adapter);
    if (props.levelName !== active.levelName || current.levelName !== active.levelName) throw conflict();
    const source = await this.uploads.validatedSource(serverId, request.uploadId, undefined, operationId);
    const currentMetadata = await readWorldMetadata(path.join(adapter.plan.rootPath, current.levelName));
    if (!currentMetadata.readable || currentMetadata.version !== planned.minecraftVersion) {
      throw new DomainError(409, "WORLD_COMPATIBILITY_UNVERIFIED", "Target world version evidence is incomplete", "world-reference-version-unverified");
    }
    const compatibility = assessWorldCompatibility(await readWorldMetadata(path.join(source.directory, "world")), {
      serverType: "vanilla", version: planned.minecraftVersion,
      dataVersion: currentMetadata.dataVersion
    });
    if (compatibility.status !== "compatible" || source.files.some(file => file.path.startsWith("dimensions/"))) {
      throw new DomainError(409, "WORLD_COMPATIBILITY_UNVERIFIED", "World compatibility needs inspection", "world-import-profile-unverified");
    }
    return { adapter, binding, active, current, source, propertiesChecksum: props.checksum,
      libraryRevision: observed.revision, rootIdentity: await backupDirectoryIdentity(adapter.plan.rootPath) };
  }

  async plan(serverId: string, request: { name: string; uploadId: string }): Promise<InactiveWorldImportRequest> {
    return this.operations.runReadAdmission(serverId, () => this.uploads.withLease(async () => {
      const checked = await this.check(serverId, request);
      return { ...request, mode: "independent", uploadRevision: checked.source.revision, libraryRevision: checked.libraryRevision,
        currentWorldId: checked.current.worldId, currentWorldRevision: checked.current.worldRevision };
    }));
  }

  private approved(body: InactiveWorldImportRequest, checked: Awaited<ReturnType<WorldLibraryImportService["check"]>>): void {
    if (body.uploadRevision !== checked.source.revision || body.libraryRevision !== checked.libraryRevision ||
        body.currentWorldId !== checked.current.worldId || body.currentWorldRevision !== checked.current.worldRevision) throw conflict();
  }

  async importIndependent(serverId: string, body: InactiveWorldImportRequest, key: string, admission?: OperationAdmission): Promise<Operation> {
    if (body.mode !== "independent") throw new DomainError(400, "VALIDATION_ERROR", "Only independent import is supported by this endpoint", "invalid-world-import-mode");
    return this.operations.requestBackup(serverId, key, JSON.stringify(body), context => this.uploads.withLease(() => this.execute(serverId, body, context)),
      () => this.uploads.withLease(async () => this.approved(body, await this.check(serverId, body))), "world-library-import", undefined, admission);
  }

  private async checkpoint(record: TransactionJournalRecord, name: string, checksumSha256?: string, filesystemIdentity?: string): Promise<void> {
    await this.journal.appendCheckpoint(record.intent.serverId, record.transactionId, { name, recordedAt: this.clock.now().toISOString(),
      ...(checksumSha256 || filesystemIdentity ? { details: { ...(checksumSha256 ? { checksumSha256 } : {}),
        ...(filesystemIdentity ? { filesystemIdentity } : {}), resourceId: record.intent.resourceId! } } : {}) });
    await this.inject?.(name);
  }

  private async execute(serverId: string, body: InactiveWorldImportRequest, context: RuntimeOperationContext): Promise<void> {
    const checked = await this.check(serverId, body); this.approved(body, checked);
    const worldId = allocateWorldIdentity(), workspaceName = `.manager-world-library-${context.operationId}`;
    const { adapter, binding, source } = checked;
    const record = await this.journal.createIntent({ operationId: context.operationId, serverId, kind: "world-library-import",
      scope: "world-set", resourceId: worldId, allowStop: false, originalState: "stopped", createdAt: this.clock.now().toISOString(),
      paths: [{ role: "source", namespace: "manager", relativePath: `world-imports/${body.uploadId}/world` },
        { role: "target", namespace: "server", relativePath: body.name }, { role: "staging", namespace: "server", relativePath: workspaceName }],
      worldLibraryImport: { rootIdentity: checked.rootIdentity, worldId, targetName: body.name,
        currentWorldId: body.currentWorldId, currentWorldRevision: body.currentWorldRevision, libraryRevision: body.libraryRevision,
        propertiesChecksum: checked.propertiesChecksum, uploadId: body.uploadId, uploadRevision: body.uploadRevision,
        importedChecksum: source.checksumSha256, minecraftVersion: source.minecraftVersion, workspaceName } });
    try {
      await this.checkpoint(record, "identity-intent-persisted");
      await this.uploads.claim(serverId, body.uploadId, body.uploadRevision, context.operationId);
      const oldTree = await inventoryRestoreTree(path.join(adapter.plan.rootPath, checked.current.levelName));
      let expectedLibraryRevision = body.libraryRevision;
      const unchanged = async () => {
        if (context.signal.aborted) throw recovery();
        await this.stopped(adapter);
        if (await backupDirectoryIdentity(adapter.plan.rootPath) !== checked.rootIdentity ||
            (await this.properties(adapter)).checksum !== checked.propertiesChecksum ||
            JSON.stringify(this.states.snapshot(serverId)) !== JSON.stringify(checked.active)) throw recovery();
        const current = await this.library.resolve(binding, body.currentWorldId, expectedLibraryRevision);
        if (current.worldRevision !== body.currentWorldRevision || current.levelName !== checked.current.levelName) throw recovery();
        await verifyRestoreTree(path.join(adapter.plan.rootPath, checked.current.levelName), oldTree);
      };
      await unchanged(); await this.absent(adapter, body.name);
      await restoreCapacity(adapter.plan.rootPath, source.sizeBytes);
      await unchanged();
      const workspace = path.join(adapter.plan.rootPath, workspaceName);
      await mkdir(workspace, { mode: 0o700 }); await syncRestoreDirectory(adapter.plan.rootPath);
      const workspaceIdentity = await directoryObjectIdentity(workspace);
      await this.checkpoint(record, "independent-workspace-created", undefined, workspaceIdentity);
      if (await directoryObjectIdentity(workspace) !== workspaceIdentity) throw recovery();
      await context.onStep("staging-independent-world");
      const rechecked = await this.uploads.validatedSource(serverId, body.uploadId, body.uploadRevision, context.operationId);
      if (rechecked.checksumSha256 !== source.checksumSha256) throw recovery();
      if (await directoryObjectIdentity(workspace) !== workspaceIdentity) throw recovery();
      await copyRestoreTree(path.join(source.directory, "world"), path.join(workspace, "world"), source.files);
      const stagedIdentity = await directoryObjectIdentity(path.join(workspace, "world"));
      const ownedStage = async () => {
        if (await directoryObjectIdentity(workspace) !== workspaceIdentity ||
            await directoryObjectIdentity(path.join(workspace, "world")) !== stagedIdentity) throw recovery();
      };
      await this.checkpoint(record, "independent-world-staged", source.checksumSha256, stagedIdentity);
      await unchanged(); await this.absent(adapter, body.name);
      await ownedStage();
      await verifyRestoreTree(path.join(workspace, "world"), source.files);
      await this.checkpoint(record, "independent-world-install-intent");
      await unchanged(); await this.absent(adapter, body.name);
      await ownedStage();
      await verifyRestoreTree(path.join(workspace, "world"), source.files);
      await rename(path.join(workspace, "world"), path.join(adapter.plan.rootPath, body.name));
      await syncRestoreDirectory(adapter.plan.rootPath); await syncRestoreDirectory(workspace);
      const ownedTarget = async () => {
        if (await directoryObjectIdentity(workspace) !== workspaceIdentity ||
            await directoryObjectIdentity(path.join(adapter.plan.rootPath, body.name)) !== stagedIdentity) throw recovery();
      };
      await ownedTarget();
      await this.checkpoint(record, "independent-world-installed", source.checksumSha256, stagedIdentity);
      await unchanged(); await ownedTarget(); await verifyRestoreTree(path.join(adapter.plan.rootPath, body.name), source.files);
      await this.library.recordInstalled(binding, { worldId, levelName: body.name, operationId: context.operationId, expectedRevision: body.libraryRevision });
      const installedCatalog = await this.library.list(binding, checked.active);
      if (installedCatalog.state !== "ready" || !installedCatalog.revision) throw recovery();
      expectedLibraryRevision = installedCatalog.revision;
      await this.checkpoint(record, "independent-identity-installed", source.checksumSha256);
      await unchanged(); await ownedTarget(); await verifyRestoreTree(path.join(adapter.plan.rootPath, body.name), source.files);
      await this.journal.setState(serverId, record.transactionId, "committed", this.clock.now().toISOString());
      await context.onResult?.({ resourceId: worldId, rollbackAvailable: false });
      await this.inject?.("independent-after-commit");
    } catch {
      try { await this.journal.setState(serverId, record.transactionId, "recovery-required", this.clock.now().toISOString()); } catch { /* Preserve active evidence. */ }
      throw recovery();
    }
  }

  /** Shared read-only evidence check; does not grant or clear recovery authority. */
  private async verifyCommitted(record: TransactionJournalRecord, records: readonly TransactionJournalRecord[]): Promise<WorldImportSupersession | null> {
    const adapter = this.registry.getLocal(record.intent.serverId), intent = record.intent.worldLibraryImport;
    if (!adapter || !intent || record.state !== "committed") throw recovery();
    const staged = record.checkpoints.find(point => point.name === "independent-world-staged")?.details?.filesystemIdentity;
    const installed = record.checkpoints.find(point => point.name === "independent-world-installed")?.details?.filesystemIdentity;
    if (await backupDirectoryIdentity(adapter.plan.rootPath) !== intent.rootIdentity ||
        !staged || installed !== staged || await directoryObjectIdentity(path.join(adapter.plan.rootPath, intent.targetName)) !== staged ||
        !record.checkpoints.some(point => point.name === "independent-identity-installed" &&
          point.details?.resourceId === intent.worldId && point.details.checksumSha256 === intent.importedChecksum)) throw recovery();
    await this.library.auditImportBindings({ serverId: adapter.serverId, rootPath: adapter.plan.rootPath }, records);
    const superseded = await this.supersession?.(record) ?? null;
    const consumeProof = async (proof: WorldImportSupersession) => {
      if (proof.serverId !== record.intent.serverId || proof.importTransactionId !== record.transactionId || proof.worldId !== intent.worldId ||
          proof.rootIdentity !== intent.rootIdentity || proof.targetName !== intent.targetName || proof.importedChecksum !== intent.importedChecksum ||
          proof.targetDirectoryIdentity !== await backupDirectoryIdentity(path.join(adapter.plan.rootPath, intent.targetName))) throw recovery();
      const bound = await this.library.activationBinding({ serverId: adapter.serverId, rootPath: adapter.plan.rootPath }, intent.worldId, proof.catalogRevision);
      const activation = await this.journal.get(record.intent.serverId, proof.activationTransactionId), w = activation.intent.worldActivation;
      if (bound.catalogId !== proof.catalogId || bound.operationId !== record.intent.operationId ||
          activation.state !== "committed" || activation.intent.serverId !== proof.serverId || activation.intent.operationId !== proof.activationOperationId ||
          !w || w.catalogId !== proof.catalogId || w.worldId !== proof.worldId || w.sourceImportTransactionId !== record.transactionId ||
          w.rootIdentity !== proof.rootIdentity || w.nextName !== proof.targetName || w.targetDirectoryIdentity !== proof.targetDirectoryIdentity ||
          w.sourceImportChecksum !== proof.importedChecksum ||
          createHash("sha256").update(JSON.stringify(activation)).digest("hex") !== proof.activationJournalDigest) throw recovery();
    };
    if (superseded) await consumeProof(superseded);
    await this.uploads.withLease(async () => {
      const source = await this.uploads.validatedSource(adapter.serverId, intent.uploadId, intent.uploadRevision, record.intent.operationId);
      if (source.checksumSha256 !== intent.importedChecksum) throw recovery();
      if (!superseded) await verifyRestoreTree(path.join(adapter.plan.rootPath, intent.targetName), source.files);
    });
    if (superseded) {
      const fresh = await this.supersession?.(record);
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(superseded)) throw recovery();
      await consumeProof(fresh);
    }
    if (await backupDirectoryIdentity(adapter.plan.rootPath) !== intent.rootIdentity ||
        await directoryObjectIdentity(path.join(adapter.plan.rootPath, intent.targetName)) !== staged ||
        JSON.stringify(await this.journal.get(record.intent.serverId, record.transactionId)) !== JSON.stringify(record)) throw recovery();
    return superseded;
  }

  /** Caller holds the instance read-admission lease. Never mutates terminal state. */
  async verifyInactiveForActivation(serverId: string, worldId: string): Promise<void> {
    const scan = await this.journal.scan();
    const records = scan.records.filter(record => record.intent.worldLibraryImport);
    const owners = records.filter(record => record.intent.serverId === serverId && record.intent.worldLibraryImport!.worldId === worldId);
    if (owners.length !== 1 || scan.issues.some(issue => !issue.serverId || issue.serverId === serverId)) throw recovery();
    await this.verifyCommitted(owners[0]!, records);
  }

  /** Read-only validation only. Never completes interrupted installs or repeats writes. */
  async reconcileStartup(): Promise<void> {
    const scan = await this.journal.scan();
    const records = scan.records.filter(record => record.intent.worldLibraryImport);
    const invalidCatalogs = new Set<string>();
    for (const adapter of this.registry.list()) {
      if (!isLocalAdapter(adapter) || adapter.plan.serverInfo.type !== "vanilla") continue;
      try {
        await this.library.auditImportBindings({ serverId: adapter.serverId, rootPath: adapter.plan.rootPath }, records, true);
      } catch { invalidCatalogs.add(adapter.serverId); this.operations.requireRecovery([adapter.serverId]); }
    }
    for (const record of records) {
      const adapter = this.registry.getLocal(record.intent.serverId);
      if (!adapter || invalidCatalogs.has(record.intent.serverId) || record.state !== "committed" || scan.issues.some(issue => !issue.serverId || issue.serverId === record.intent.serverId)) {
        this.operations.requireTransactionRecovery(record.intent.serverId, record.intent.operationId); continue;
      }
      try {
        const proof = await this.verifyCommitted(record, records);
        if (proof) this.operations.confirmPhysicalTransaction(proof.activationOperationId);
        this.operations.confirmPhysicalTransaction(record.intent.operationId);
      } catch { this.operations.requireTransactionRecovery(record.intent.serverId, record.intent.operationId); }
    }
  }
}
