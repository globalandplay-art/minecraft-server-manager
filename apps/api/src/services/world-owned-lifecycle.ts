import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../adapters/contract.js";
import { parseProperties, SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { inventoryRestoreTree, restoreFilesChecksum, safeRestorePath } from "./restore-files.js";
import { supportsVanillaWorldLayout } from "./world-compatibility.js";
import { parseWorldMetadata } from "./world-inventory-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import type { StoredOperation } from "./operation-store.js";
import type { WorldLifecycleLaunchSeal, WorldLifecycleStopSeal } from "./world-lifecycle-receipt.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha = /^[0-9a-f]{64}$/u;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Owned world lifecycle requires inspection", "world-lifecycle-unverified", true);

async function observeStoppedWorld(adapter: LocalMinecraftServerAdapter, root: string, levelName: string,
  expected: { rootIdentity: string; worldDirectoryIdentity: string }, assertCurrent: () => void) {
  if (!safeRestorePath(levelName) || levelName.includes("/") || levelName.startsWith(".")) throw fail();
  const directory = path.join(root, levelName);
  const verifyStopped = async () => {
    const status = await adapter.getStatus();
    if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired) throw fail();
    assertCurrent();
  };
  const verifyDirectories = async () => {
    if (await backupDirectoryIdentity(root) !== expected.rootIdentity ||
        await backupDirectoryIdentity(directory) !== expected.worldDirectoryIdentity) throw fail();
  };
  assertCurrent();
  await verifyStopped();
  await verifyDirectories();
  const propertiesPath = path.join(root, "server.properties");
  const properties = await readPrivatePropertiesFile(propertiesPath, SERVER_PROPERTIES_LIMIT);
  try {
    if ((parseProperties(properties.bytes.toString("utf8")).get("level-name") ?? "world") !== levelName) throw fail();
  } finally { properties.bytes.fill(0); }
  const levelPath = path.join(directory, "level.dat");
  const level = await readPrivatePropertiesFile(levelPath, 8 * 1024 * 1024);
  let metadata: ReturnType<typeof parseWorldMetadata>;
  try { metadata = parseWorldMetadata(level.bytes); } finally { level.bytes.fill(0); }
  const tree = await inventoryRestoreTree(directory);
  if (!supportsVanillaWorldLayout(tree, metadata) || tree.find(file => file.path === "level.dat")?.sha256 !== level.checksum) throw fail();
  const currentProperties = await readPrivatePropertiesFile(propertiesPath, SERVER_PROPERTIES_LIMIT);
  try {
    if (currentProperties.checksum !== properties.checksum || currentProperties.identity !== properties.identity) throw fail();
  } finally { currentProperties.bytes.fill(0); }
  const currentLevel = await readPrivatePropertiesFile(levelPath, 8 * 1024 * 1024);
  try {
    if (currentLevel.checksum !== level.checksum || currentLevel.identity !== level.identity) throw fail();
  } finally { currentLevel.bytes.fill(0); }
  await verifyDirectories();
  await verifyStopped();
  return { treeChecksum: restoreFilesChecksum(tree), propertiesChecksum: properties.checksum,
    propertiesIdentity: properties.identity, levelIdentity: level.identity };
}

/** Read-only restart verification. The returned snapshot confers no admission. */
export async function verifyStartupOwnedWorldRevision(registry: AdapterRegistry, operations: OperationService,
  serverId: string, levelName: string, authorize: OperationAdmission,
  verifyCatalog?: (target: { worldId: string; catalogRevision: string; registeredExecutionDigest: string; historicalGeneration: boolean }, assertCurrent: OperationAdmission) => Promise<void>,
  confirmStopOperationId?: string,
  recordVerified?: (evidence: NonNullable<Awaited<ReturnType<OperationService["readStartupWorldStopCandidate"]>>>,
    assertCurrent: OperationAdmission) => Promise<void>) {
  return operations.runStartupWorldStopInspection(serverId, authorize, async (assertCurrent, historicalGeneration, checkConfirmation) => {
    const evidence = await operations.readStartupWorldStopCandidate(serverId), receipt = evidence?.stop.worldLifecycle;
    const adapter = registry.getLocal(serverId);
    if (!evidence || receipt?.action !== "stop" || !adapter) throw fail();
    if (confirmStopOperationId !== undefined && (!verifyCatalog || confirmStopOperationId !== evidence.stop.operation.id)) throw fail();
    const root = adapter.plan.rootPath, runtime = adapter.getRuntime();
    const guard = () => {
      assertCurrent();
      const identity = adapter.getRegisteredExecutionIdentity?.();
      if (registry.getLocal(serverId) !== adapter || adapter.getRuntime() !== runtime || adapter.plan.rootPath !== root ||
          adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3" ||
          !identity || identity.rootIdentity !== receipt.rootIdentity || digest(identity) !== receipt.registeredExecutionDigest) throw fail();
    };
    guard();
    await adapter.revalidateBeforeStart();
    const target = Object.freeze({ worldId: receipt.worldId, catalogRevision: receipt.catalogRevision,
      registeredExecutionDigest: receipt.registeredExecutionDigest, historicalGeneration });
    const catalogGuard = (): undefined => { guard(); return undefined; };
    if (verifyCatalog) await verifyCatalog(target, catalogGuard);
    const { treeChecksum, propertiesChecksum, propertiesIdentity, levelIdentity } = evidence.revision;
    const expected = digest({ treeChecksum, propertiesChecksum, propertiesIdentity, levelIdentity });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (digest(await observeStoppedWorld(adapter, root, levelName, receipt, guard)) !== expected) throw fail();
    }
    if (verifyCatalog) await verifyCatalog(target, catalogGuard);
    const current = await operations.readStartupWorldStopCandidate(serverId);
    if (!current || digest(current) !== digest(evidence)) throw fail();
    guard();
    const confirmationRecorded = verifyCatalog
      ? await checkConfirmation(evidence, confirmStopOperationId !== undefined, recordVerified !== undefined) : false;
    if (recordVerified) {
      if (!confirmationRecorded || confirmStopOperationId !== evidence.stop.operation.id) throw fail();
      await recordVerified(structuredClone(evidence), catalogGuard);
      // A sidecar write is not success: close the physical and catalog fences
      // again under the same lease before returning to the dedicated issuer.
      if (digest(await observeStoppedWorld(adapter, root, levelName, receipt, guard)) !== expected) throw fail();
      if (verifyCatalog) await verifyCatalog(target, catalogGuard);
      if (!await checkConfirmation(evidence, false, true)) throw fail();
    }
    guard();
    return { inspectionOnly: true as const, worldId: receipt.worldId, serverId, stopOperationId: evidence.stop.operation.id,
      catalogRevision: receipt.catalogRevision, treeChecksum, confirmationRecorded };
  }, verifyCatalog !== undefined);
}

/** Internal launch composition. The caller verifies the selected world and
 * consumes the live witness under the lifecycle recovery gate. */
export async function requestOwnedWorldStart(
  registry: AdapterRegistry,
  operations: OperationService,
  input: StoredOperation,
  verifyWorld: () => Promise<void>,
  authorize: OperationAdmission,
  onLaunch: (proof: ReturnType<typeof captureOwnedWorldLifecycle>, seal: WorldLifecycleLaunchSeal) => Promise<void>
) {
  const record = structuredClone(input), receipt = record.worldLifecycle;
  if (receipt?.action !== "start") throw fail();
  const launch = prepareOwnedWorldLaunch(registry, operations, receipt, verifyWorld, authorize, onLaunch);
  return operations.persistOwnedWorldStartIntent(record, launch.checkStoppedWorld, launch.guard, launch.dispatch);
}

/** The runtime half of an owned launch. Receipt persistence and recovery
 * admission belong to the caller's operation lease. */
export function prepareOwnedWorldLaunch(
  registry: AdapterRegistry,
  operations: OperationService,
  receipt: Extract<NonNullable<StoredOperation["worldLifecycle"]>, { action: "start" }>,
  verifyWorld: () => Promise<void>,
  authorize: OperationAdmission,
  onLaunch: (proof: ReturnType<typeof captureOwnedWorldLifecycle>, seal: WorldLifecycleLaunchSeal) => Promise<void>
) {
  const { serverId, startOperationId, registeredExecutionDigest, rootIdentity } = receipt;
  const adapter = registry.getLocal(serverId);
  if (!adapter) throw fail();
  const runtime = adapter.getRuntime(), root = adapter.plan.rootPath;
  const assertBinding = (): undefined => {
    const identity = adapter.getRegisteredExecutionIdentity?.();
    if (registry.getLocal(serverId) !== adapter || adapter.getRuntime() !== runtime || adapter.plan.rootPath !== root ||
        adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3" ||
        runtime.supportsSpawnAdmission !== true || !runtime.getOwnedLaunchObservation ||
        !identity || identity.rootIdentity !== rootIdentity || digest(identity) !== registeredExecutionDigest) throw fail();
    return undefined;
  };
  const guard = (): undefined => {
    const authorization: unknown = authorize();
    if (authorization !== undefined) { void Promise.resolve(authorization).catch(() => undefined); throw fail(); }
    return assertBinding();
  };
  const assertStopped = async () => {
    const status = await adapter.getStatus();
    if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired) throw fail();
    guard();
  };
  const checkStoppedWorld = async () => {
    guard();
    await assertStopped();
    await verifyWorld();
    await assertStopped();
  };
  const dispatch: NonNullable<Parameters<OperationService["persistOwnedWorldStartIntent"]>[3]> = async context => {
    if (context.operationId !== startOperationId) throw fail();
    await adapter.revalidateBeforeStart();
    await checkStoppedWorld();
    const previousLaunchId = runtime.getOwnedLaunchObservation!()?.launchId ?? null;
    let admitted = false, verified = false;
    await adapter.start({ ...context, verifyBeforeSpawn: async () => {
      verified = false;
      await checkStoppedWorld();
      await context.verifyBeforeSpawn();
      verified = true;
    }, beforeSpawn: () => {
      if (!verified || admitted) throw fail();
      verified = false;
      guard();
      context.beforeSpawn();
      admitted = true;
      return undefined;
    }, onStep: async () => operations.get(startOperationId)! });
    if (!admitted) throw fail();
    guard();
    const proof = captureOwnedWorldLifecycle(registry, { serverId, startOperationId, registeredExecutionDigest, previousLaunchId }, assertBinding);
    const seal = await context.sealLaunch(proof.launchId, proof.assertRunning);
    guard();
    proof.assertRunning();
    await onLaunch(proof, seal);
  };
  return { checkStoppedWorld, guard, dispatch };
}

/** Stops only the launch held by the live start witness. */
export async function requestOwnedWorldStop(
  registry: AdapterRegistry,
  operations: OperationService,
  input: StoredOperation,
  levelName: string,
  proof: ReturnType<typeof captureOwnedWorldLifecycle>,
  authorize: OperationAdmission,
  onStopped: (result: ReturnType<typeof proof.assertStopped> & {
    worldId: string; treeChecksum: string; propertiesChecksum: string; propertiesIdentity: string;
    levelIdentity: string; recheck: () => Promise<void>;
  }, seal: WorldLifecycleStopSeal) => Promise<void>
) {
  const record = structuredClone(input), receipt = record.worldLifecycle;
  if (!safeRestorePath(levelName) || levelName.includes("/") || levelName.startsWith(".")) throw fail();
  if (receipt?.action !== "stop" || receipt.launchId !== proof.launchId || receipt.startOperationId !== proof.startOperationId ||
      receipt.serverId !== proof.serverId || receipt.registeredExecutionDigest !== proof.registeredExecutionDigest) throw fail();
  const adapter = registry.getLocal(receipt.serverId), runtime = adapter?.getRuntime();
  if (!adapter || runtime?.supportsStopAdmission !== true) throw fail();
  const root = adapter.plan.rootPath;
  const assertRunning = (): undefined => {
    if (registry.getLocal(receipt.serverId) !== adapter || adapter.getRuntime() !== runtime) throw fail();
    return proof.assertRunning();
  };
  return operations.persistOwnedWorldStopIntent(record, authorize, assertRunning, async context => {
    let verified = false, admitted = false;
    assertRunning();
    await adapter.stop({ ...context, verifyBeforeStop: async () => {
      verified = false;
      proof.assertStopping(context.operationId);
      await context.verifyBeforeStop();
      verified = true;
    }, beforeStop: () => {
      if (!verified || admitted) throw fail();
      verified = false;
      context.beforeStop();
      proof.assertStopping(context.operationId);
      admitted = true;
      return undefined;
    }, onStep: async () => operations.get(context.operationId)! });
    if (!admitted) throw fail();
    const deadline = performance.now() + 5000;
    while (runtime.getOwnedLaunchObservation?.()?.closed === false && performance.now() < deadline) {
      await delay(25, undefined, { signal: context.signal });
    }
    const observeRevision = async () => {
      const stopped = proof.assertStopped(context.operationId);
      const revision = await observeStoppedWorld(adapter, root, levelName, receipt, () => { proof.assertStopped(context.operationId); });
      return { ...stopped, worldId: receipt.worldId, ...revision };
    };
    const initial = await observeRevision();
    const expected = digest(initial);
    const recheck = async () => {
      if (digest(await observeRevision()) !== expected) throw fail();
      await context.verifyBeforeStop();
      context.beforeStop();
      proof.assertStopped(context.operationId);
    };
    const { treeChecksum, propertiesChecksum, propertiesIdentity, levelIdentity } = initial;
    const seal = await context.sealStoppedRevision({ treeChecksum, propertiesChecksum, propertiesIdentity, levelIdentity }, recheck, () => {
      proof.assertStopped(context.operationId);
      return undefined;
    });
    const recheckPublished = async () => {
      await recheck();
      await context.verifyStoppedSeal(seal);
      context.beforeStop();
      proof.assertStopped(context.operationId);
    };
    context.beforeStop();
    proof.assertStopped(context.operationId);
    await onStopped({ ...initial, recheck: recheckPublished }, structuredClone(seal));
  });
}

/** Ephemeral ordinary start(A)/stop(B) observation, under the caller's shared
 * instance exclusion. Only the registered runtime supplies observations.
 * This is NOT a file revision, durable receipt, restart recovery or readiness
 * proof. A future revision publisher must also verify world mapping/content,
 * immutable history and durable start/stop receipts. Never reconstruct this
 * closure from logs, a PID, stopped status or serialized fields. */
export function captureOwnedWorldLifecycle(registry: AdapterRegistry, expected: {
  serverId: string; startOperationId: string; registeredExecutionDigest: string; previousLaunchId: string | null;
}, authorize: () => undefined) {
  const binding = structuredClone(expected), adapter = registry.getLocal(binding.serverId);
  if (!adapter || !uuid.test(binding.startOperationId) || !sha.test(binding.registeredExecutionDigest) ||
      binding.previousLaunchId !== null && !uuid.test(binding.previousLaunchId)) throw fail();
  const runtime = adapter.getRuntime(), rootPath = adapter.plan.rootPath;
  const guard = () => {
    if (typeof authorize !== "function") throw fail();
    const result: unknown = authorize();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw fail(); }
    const identity = adapter.getRegisteredExecutionIdentity?.();
    if (registry.getLocal(binding.serverId) !== adapter || adapter.serverId !== binding.serverId || adapter.getRuntime() !== runtime ||
        adapter.plan.rootPath !== rootPath || adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3" ||
        !identity || digest(identity) !== binding.registeredExecutionDigest) throw fail();
  };
  guard();
  const initial = runtime.getOwnedLaunchObservation?.();
  if (!initial || !uuid.test(initial.launchId) || initial.launchId === binding.previousLaunchId || initial.serverId !== binding.serverId ||
      initial.ownerOperationId !== binding.startOperationId || !Number.isSafeInteger(initial.processId) || initial.processId! <= 0 ||
      initial.spawned !== true || initial.ready !== true || initial.stopRequested !== false || initial.stopOperationId !== null ||
      initial.stopCompleted !== false || initial.errorObserved !== false || initial.exited !== false || initial.closed !== false ||
      initial.exitCode !== null || initial.signal !== null) throw fail();
  const launchId = initial.launchId, processId = initial.processId;
  const runningDigest = digest(initial);
  guard();
  const assertRunning = (): undefined => {
    guard();
    const current = runtime.getOwnedLaunchObservation?.();
    if (!current || digest(current) !== runningDigest) throw fail();
    guard();
    return undefined;
  };
  const assertStopped = (stopOperationId: string) => {
    guard();
    if (!uuid.test(stopOperationId) || stopOperationId === binding.startOperationId) throw fail();
    const current = runtime.getOwnedLaunchObservation?.();
    if (!current || current.serverId !== binding.serverId || current.launchId !== launchId || current.processId !== processId ||
        current.ownerOperationId !== binding.startOperationId || current.spawned !== true || current.ready !== true ||
        current.stopRequested !== true || current.stopOperationId !== stopOperationId || current.stopCompleted !== true ||
        current.errorObserved !== false || current.exited !== true || current.closed !== true || current.exitCode !== 0 || current.signal !== null) throw fail();
    guard();
    return { phase: "owned-normal-lifecycle-only" as const, inspectionOnly: true as const, serverId: binding.serverId,
      launchId, startOperationId: binding.startOperationId, stopOperationId, registeredExecutionDigest: binding.registeredExecutionDigest,
      normallyExited: true as const };
  };
  const assertStopping = (stopOperationId: string) => {
    guard();
    const current = runtime.getOwnedLaunchObservation?.();
    if (!uuid.test(stopOperationId) || stopOperationId === binding.startOperationId || !current ||
        current.stopRequested !== true || current.stopOperationId !== stopOperationId ||
        digest({ ...current, stopRequested: false, stopOperationId: null }) !== runningDigest) throw fail();
    guard();
  };
  return { serverId: binding.serverId, startOperationId: binding.startOperationId, registeredExecutionDigest: binding.registeredExecutionDigest,
    launchId, assertRunning, assertStopping, assertStopped };
}
