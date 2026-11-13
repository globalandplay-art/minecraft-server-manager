import path from "node:path";
import type { AdapterRegistry } from "../adapters/registry.js";
import { parseProperties, SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { readWorldGenerationReservation } from "./world-generation-reservation.js";
import { parseWorldMetadata } from "./world-inventory-service.js";
import { readGenerationExecution } from "./world-generation-execution.js";
import { assertGenerationProperties, type GenerationPropertiesProof } from "./world-generation-properties.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Generated world candidate requires inspection", "world-generation-observation-unverified", true);

/** Ephemeral, in-process child binding. Never reconstruct this from PID, logs,
 * stopped status or a serialized observation. It does not stop a process, clear
 * recovery or prove a world's birth; callers must separately seal and verify
 * preparation before launch and retain ownership until actual cleanup. */
export function captureGenerationOwnedLaunch(registry: AdapterRegistry, serverId: string, value: unknown, previousLaunchId: string | null) {
  const execution = readGenerationExecution(value), adapter = registry.getLocal(serverId);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  if (!adapter || execution.serverId !== serverId || adapter.serverId !== serverId || adapter.plan.serverInfo.type !== "vanilla" ||
      adapter.plan.serverInfo.minecraftVersion !== "26.3" || (previousLaunchId !== null && !uuid.test(previousLaunchId))) throw fail();
  const runtime = adapter.getRuntime(), initial = runtime.getOwnedLaunchObservation?.();
  if (!initial || !uuid.test(initial.launchId) || initial.launchId === previousLaunchId || initial.serverId !== serverId ||
      initial.ownerOperationId !== execution.executionOperationId || !Number.isSafeInteger(initial.processId) || initial.processId! <= 0 ||
      initial.spawned !== true || initial.ready !== true || initial.errorObserved !== false || initial.stopRequested !== false ||
      initial.stopOperationId !== null || initial.stopCompleted !== false || initial.exited !== false || initial.closed !== false ||
      initial.exitCode !== null || initial.signal !== null) throw fail();
  const launchId = initial.launchId, processId = initial.processId;
  const assertStopped = () => {
    const current = runtime.getOwnedLaunchObservation?.();
    if (registry.getLocal(serverId) !== adapter || adapter.getRuntime() !== runtime || !current || current.serverId !== serverId ||
        current.launchId !== launchId || current.processId !== processId || current.ownerOperationId !== execution.executionOperationId ||
        current.spawned !== true || current.ready !== true || current.errorObserved !== false || current.stopRequested !== true ||
        current.stopOperationId !== execution.executionOperationId || current.stopCompleted !== true || current.exited !== true ||
        current.closed !== true || current.exitCode !== 0 || current.signal !== null) throw fail();
    return { launchId, executionOperationId: execution.executionOperationId, normallyExited: true as const };
  };
  return { launchId, assertStopped };
}

/** Read-only candidate observation under the caller's instance lease. A stable
 * directory is NOT evidence of its creation by an owned Minecraft process.
 * No caller may use this metadata alone to publish a world or release recovery.
 * Only the registered adapter supplies the root; no arbitrary path is accepted. */
export async function observeWorldGenerationCandidate(registry: AdapterRegistry, serverId: string, value: unknown, afterStop?: GenerationPropertiesProof) {
  const g = readWorldGenerationReservation(value), adapter = registry.getLocal(serverId);
  if (!adapter || adapter.serverId !== g.serverId || serverId !== g.serverId || adapter.plan.serverInfo.type !== "vanilla") throw fail();
  const stopped = async () => {
    const state = await adapter.getStatus();
    if (state.state !== "stopped" || state.ownership !== "none" || state.recoveryRequired) throw fail();
  };
  const root = adapter.plan.rootPath, target = path.join(root, g.nextName);
  const properties = async () => {
    const file = await readPrivatePropertiesFile(path.join(root, "server.properties"), SERVER_PROPERTIES_LIMIT);
    try {
      assertGenerationProperties(file, g.propertiesAfter, afterStop);
      if (parseProperties(file.bytes.toString("utf8")).get("level-name") !== g.nextName) throw fail();
      return { checksum: file.checksum, identity: file.identity };
    } finally { file.bytes.fill(0); }
  };
  try {
    await stopped();
    const profile = await adapter.getServerInfo();
    if (profile.type !== "vanilla" || profile.minecraftVersion !== "26.3" || await backupDirectoryIdentity(root) !== g.rootIdentity) throw fail();
    const initialProperties = await properties();
    const directoryIdentity = await backupDirectoryIdentity(target), objectIdentity = await directoryObjectIdentity(target);
    const level = await readPrivatePropertiesFile(path.join(target, "level.dat"), 8 * 1024 * 1024);
    const checksumSha256 = level.checksum, levelIdentity = level.identity;
    let metadata: ReturnType<typeof parseWorldMetadata>;
    try { metadata = parseWorldMetadata(level.bytes); } finally { level.bytes.fill(0); }
    if (!metadata.readable || metadata.version !== "26.3" || metadata.dataVersion !== 5023) throw fail();
    await stopped(); const finalProperties = await properties();
    if (initialProperties.checksum !== finalProperties.checksum || initialProperties.identity !== finalProperties.identity) throw fail();
    const finalLevel = await readPrivatePropertiesFile(path.join(target, "level.dat"), 8 * 1024 * 1024);
    try { if (finalLevel.identity !== levelIdentity || finalLevel.checksum !== checksumSha256) throw fail(); }
    finally { finalLevel.bytes.fill(0); }
    if (await backupDirectoryIdentity(root) !== g.rootIdentity || await backupDirectoryIdentity(target) !== directoryIdentity ||
        await directoryObjectIdentity(target) !== objectIdentity) throw fail();
    return { phase: "candidate-only" as const, serverId, worldId: g.worldId, transactionId: g.transactionId,
      directoryIdentity, objectIdentity, levelIdentity, checksumSha256, version: "26.3" as const, dataVersion: 5023 as const,
      birthVerified: false as const, loadVerified: false as const };
  } catch { throw fail(); }
}
