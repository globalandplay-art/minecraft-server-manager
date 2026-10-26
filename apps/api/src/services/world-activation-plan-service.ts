import { createHash } from "node:crypto";
import path from "node:path";
import type { AdapterRegistry } from "../adapters/registry.js";
import { parseProperties } from "../config/properties.js";
import type { ActiveWorldStateStore } from "./active-world-state-store.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { inventoryRestoreTree, restoreFilesChecksum, verifyRestoreTree } from "./restore-files.js";
import { assessWorldCompatibility } from "./world-compatibility.js";
import { readWorldMetadata } from "./world-inventory-service.js";
import type { WorldLibraryStore } from "./world-library-store.js";

const conflict = () => new DomainError(409, "WORLD_REVISION_CONFLICT", "World activation observations changed", "world-activation-plan-changed");

/** Read-only preparation. A plan never authorizes a configuration write by itself. */
export class WorldActivationPlanService {
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly library: WorldLibraryStore, private readonly states: Pick<ActiveWorldStateStore, "snapshot">,
    private readonly verifyInactive: (serverId: string, worldId: string) => Promise<void>) {}

  async plan(serverId: string, worldId: string) {
    return this.operations.runReadAdmission(serverId, () => this.inspectUnderLease(serverId, worldId));
  }

  /** Internal operation preflight/executor only; caller owns instance admission. */
  async inspectUnderLease(serverId: string, worldId: string) {
    if (typeof worldId !== "string" || !/^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(worldId)) {
      throw new DomainError(400, "VALIDATION_ERROR", "Invalid world identity", "world-activation-invalid-id");
    }
      const adapter = this.registry.getLocal(serverId);
      if (!adapter || adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3") {
        throw new DomainError(409, "WORLD_COMPATIBILITY_UNVERIFIED", "Activation profile is unverified", "world-activation-profile-unverified");
      }
      const stopped = async () => {
        const status = await adapter.getStatus();
        if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired) {
          throw new DomainError(409, "SERVER_MUST_BE_STOPPED", "Stop the managed server before preparing activation", "world-activation-stopped-required");
        }
      };
      await stopped();
      const binding = { serverId, rootPath: adapter.plan.rootPath };
      const rootIdentity = await backupDirectoryIdentity(binding.rootPath);
      const active = this.states.snapshot(serverId), list = await this.library.list(binding, active);
      if (active?.state !== "active" || list.state !== "ready" || !list.revision || !list.activeWorldId) throw conflict();
      if (worldId === list.activeWorldId) throw new DomainError(409, "ACTION_UNAVAILABLE", "This world is already active", "world-already-active");
      const current = await this.library.resolve(binding, list.activeWorldId, list.revision);
      const target = await this.library.resolve(binding, worldId, list.revision);
      if (current.levelName !== active.levelName) throw conflict();
      // Imported content must still match the committed installation before any
      // later activation transaction may grant it a mutable-world lifecycle.
      await this.verifyInactive(serverId, worldId);
      const props = await readPrivatePropertiesFile(path.join(binding.rootPath, "server.properties"));
      const propertyRevision = createHash("sha256").update(props.identity).update("\0").update(props.checksum).digest("hex");
      try { if ((parseProperties(props.bytes.toString("utf8")).get("level-name") ?? "world") !== current.levelName) throw conflict(); }
      finally { props.bytes.fill(0); }
      const currentPath = path.join(binding.rootPath, current.levelName), targetPath = path.join(binding.rootPath, target.levelName);
      const currentFiles = await inventoryRestoreTree(currentPath), targetFiles = await inventoryRestoreTree(targetPath);
      const currentVersion = await readWorldMetadata(currentPath), targetVersion = await readWorldMetadata(targetPath);
      if (!currentVersion.readable || currentVersion.version !== "26.3" ||
          assessWorldCompatibility(targetVersion, { serverType: "vanilla", version: "26.3", dataVersion: currentVersion.dataVersion }).status !== "compatible" ||
          targetFiles.some(file => file.path.startsWith("dimensions/"))) {
        throw new DomainError(409, "WORLD_COMPATIBILITY_UNVERIFIED", "World compatibility needs inspection", "world-activation-version-unverified");
      }
      await verifyRestoreTree(currentPath, currentFiles); await verifyRestoreTree(targetPath, targetFiles);
      await this.verifyInactive(serverId, worldId);
      await verifyRestoreTree(currentPath, currentFiles); await verifyRestoreTree(targetPath, targetFiles);
      await stopped();
      const finalProps = await readPrivatePropertiesFile(path.join(binding.rootPath, "server.properties"));
      try {
        const finalRevision = createHash("sha256").update(finalProps.identity).update("\0").update(finalProps.checksum).digest("hex");
        if (finalRevision !== propertyRevision || await backupDirectoryIdentity(binding.rootPath) !== rootIdentity ||
            JSON.stringify(this.states.snapshot(serverId)) !== JSON.stringify(active) ||
            JSON.stringify(await this.library.resolve(binding, current.worldId, list.revision)) !== JSON.stringify(current) ||
            JSON.stringify(await this.library.resolve(binding, target.worldId, list.revision)) !== JSON.stringify(target)) throw conflict();
      } finally { finalProps.bytes.fill(0); }
      return { serverId, worldId, levelName: target.levelName, libraryRevision: list.revision,
        currentWorldId: current.worldId, currentWorldRevision: current.worldRevision, targetWorldRevision: target.worldRevision,
        currentContentRevision: restoreFilesChecksum(currentFiles), targetContentRevision: restoreFilesChecksum(targetFiles),
        propertiesRevision: propertyRevision, serverMustBeStopped: true as const, loadVerified: false as const,
        executionAvailable: false as const, unavailableReason: "ACTIVATION_TRANSACTION_PENDING" as const };
  }
}
