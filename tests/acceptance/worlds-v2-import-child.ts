import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { AdapterRegistry } from "../../apps/api/src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../../apps/api/src/adapters/contract.js";
import { ActiveWorldStateStore, worldIdentity } from "../../apps/api/src/services/active-world-state-store.js";
import { OperationService } from "../../apps/api/src/services/operation-service.js";
import { JsonOperationStore } from "../../apps/api/src/services/operation-store.js";
import { TransactionJournalStore } from "../../apps/api/src/services/transaction-journal.js";
import { WorldImportUploadService } from "../../apps/api/src/services/world-import-upload-service.js";
import { WorldLibraryStore } from "../../apps/api/src/services/world-library-store.js";
import { WorldLibraryImportService, type InactiveWorldImportRequest } from "../../apps/api/src/services/world-library-import-service.js";
import { plainRestoreDirectory, writeRestoreJson } from "../../apps/api/src/services/restore-files.js";
import { readPrivatePropertiesFile } from "../../apps/api/src/services/properties-private-file.js";
import { testWorldLevel, testWorldZip } from "../../apps/api/test/fixtures/world-library-content.js";
import { WorldActivationPlanService } from "../../apps/api/src/services/world-activation-plan-service.js";
import { WorldActivationService, type WorldActivationApproval } from "../../apps/api/src/services/world-activation-service.js";
import { BackupService } from "../../apps/api/src/services/backup-service.js";
import { verifyRestoreTree } from "../../apps/api/src/services/restore-files.js";
import { WorldActivationReconciler } from "../../apps/api/src/services/world-activation-reconciler.js";
import { WorldActivationHistoryProtection } from "../../apps/api/src/services/world-activation-history-protection.js";
import { WorldActivationLiveHistory } from "../../apps/api/src/services/world-activation-live-history.js";
import { WorldReplacementService, type WorldReplacementApproval } from "../../apps/api/src/services/world-replacement-service.js";
import { verifyReplacementCurrentState } from "../../apps/api/src/services/world-replacement-live.js";
import { WorldCreateService } from "../../apps/api/src/services/world-create-service.js";
import { WorldCreatePlanService } from "../../apps/api/src/services/world-create-plan-service.js";

const [rootArgument, mode, boundary, nonce, flavor = "import"] = process.argv.slice(2);
assert.ok(rootArgument && nonce && ["run", "probe"].includes(mode ?? ""));
assert.ok(["import", "activation", "repeated", "replacement", "replacement-recovery", "replacement-import-recovery", "generation"].includes(flavor));
// Keep the owned IPC channel alive while paused at a crash boundary.
process.on("message", () => {});
const root = path.resolve(rootArgument), manager = path.join(root, "manager"), server = path.join(root, "server");
await plainRestoreDirectory(root);
const owner = await readPrivatePropertiesFile(path.join(root, "test-owner.json"), 4096);
assert.deepEqual(JSON.parse(owner.bytes.toString("utf8")), { kind: "lt-worlds-v2-owned-fixture", nonce }); owner.bytes.fill(0);
const clock = { now: () => new Date("2026-10-25T12:00:00.000Z") };
const properties = "# isolated process fixture\nlevel-name=world\nmax-players=20\n";
if (mode === "run") {
  await mkdir(manager); await mkdir(server); await mkdir(path.join(server, "world"));
  await writeFile(path.join(server, "server.properties"), properties);
  await writeFile(path.join(server, "world", "level.dat"), flavor === "generation" ? testWorldLevel("original", true, 5023) : testWorldLevel("original"));
}
const adapter = { mode: "local", serverId: "v2-process-test", plan: { rootPath: server, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
  getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }),
  getServerInfo: async () => ({ type: "vanilla", minecraftVersion: "26.3" }),
  getCapabilities: async () => ({ worlds: true, backup: true }),
  start: async () => { throw new Error("TEST_MUST_NOT_START_JAVA"); }, stop: async () => { throw new Error("TEST_MUST_NOT_STOP_JAVA"); }
} as unknown as LocalMinecraftServerAdapter;
const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(manager);
await journal.initialize();
const store = new JsonOperationStore(manager); await store.initialize();
const operations = new OperationService(store, clock, journal), states = new ActiveWorldStateStore(manager, [adapter]);
if (mode === "run" || flavor === "import") await states.initialize();
const library = new WorldLibraryStore(manager, clock), uploads = new WorldImportUploadService(registry, operations, manager, undefined, journal, clock);
async function send(value: object) {
  assert.ok(process.send);
  await new Promise<void>((resolve, reject) => process.send!(value, error => error ? reject(error) : resolve()));
}
async function serverDigest(): Promise<string> {
  const hash = createHash("sha256"); let count = 0;
  async function visit(directory: string, prefix: string) {
    await plainRestoreDirectory(directory);
    for (const name of (await readdir(directory)).sort()) {
      assert.ok(++count <= 128);
      const file = path.join(directory, name), info = await lstat(file), relative = prefix + name;
      assert.equal(info.isSymbolicLink(), false); hash.update(relative + "\0");
      if (info.isDirectory()) await visit(file, relative + "/");
      else { const value = await readPrivatePropertiesFile(file, 1024 * 1024); hash.update(value.checksum); value.bytes.fill(0); }
    }
  }
  await visit(server, ""); return hash.digest("hex");
}
const service = new WorldLibraryImportService(registry, operations, journal, library, uploads, states, clock,
  mode === "run" && flavor === "import" ? async point => {
    if (point !== boundary) return;
    const record = (await journal.scan()).records.find(item => item.intent.worldLibraryImport)!;
    await send({ kind: "boundary", point, operationId: record.intent.operationId, worldId: record.intent.worldLibraryImport!.worldId });
    // The parent terminates only this exact owned process at a completed checkpoint.
    await new Promise<void>(() => {});
  } : undefined, mode === "probe" && flavor === "activation" ? record => activationReconciler.verifiesSupersession(record) : undefined);
const activationPlans = new WorldActivationPlanService(registry, operations, library, states,
  (serverId, worldId) => service.verifyInactiveForActivation(serverId, worldId));
const backups = new BackupService(registry, operations, journal, manager, clock);
const activationReconciler = new WorldActivationReconciler(registry, operations, journal, library, uploads, backups, manager);
const activation = new WorldActivationService(registry, operations, journal, library, activationPlans, states, backups, manager, clock,
  mode === "run" && flavor === "activation" ? async point => {
    if (point !== boundary) return;
    const record = (await journal.scan()).records.find(item => item.intent.worldActivation)!;
    if (point === "activation-after-commit") await writeFile(path.join(server, "Independent", "new-chunk.dat"), "simulated subsequent world save");
    await send({ kind: "boundary", point, operationId: record.intent.operationId, worldId: record.intent.worldActivation!.worldId });
    await new Promise<void>(() => {});
  } : undefined);
if (flavor === "generation") {
  const creator = new WorldCreateService(registry, operations, journal, backups, manager, states, clock,
    mode === "run" ? async point => {
      if (point !== boundary) return;
      const g = (await journal.scan()).records[0]!.intent.worldChange!.generation!;
      await send({ kind: "boundary", point, operationId: g.operationId, worldId: g.worldId });
      await new Promise<void>(() => {});
    } : undefined, { library });
  if (mode === "run") {
    await operations.initialize(); await library.migrateLegacy({ serverId: adapter.serverId, rootPath: server }, states.snapshot(adapter.serverId)!);
    const plan = await new WorldCreatePlanService(registry, operations).plan(adapter.serverId, { name: "Generated", seed: "17" });
    const body = { name: "Generated", seed: "17", allowStop: false, worldRevision: plan.worldRevision!, confirmWorldName: plan.currentWorldName };
    const key = randomUUID(); await writeRestoreJson(path.join(root, "generation-case.json"), { body, key });
    await creator.create(adapter.serverId, body, key);
  } else {
    const before = await serverDigest(), scan = await journal.scan();
    assert.equal(scan.issues.length, 0); assert.equal(scan.records.length, 1);
    const record = scan.records[0]!, g = record.intent.worldChange!.generation!;
    const activeFile = path.join(manager, "active-worlds", `${adapter.serverId}.json`);
    const active = await readPrivatePropertiesFile(activeFile), activeHash = active.checksum;
    const parsedActive = JSON.parse(active.bytes.toString("utf8")); active.bytes.fill(0);
    const late = boundary !== "generation-reserved";
    assert.deepEqual(parsedActive, { schemaVersion: 1, serverId: adapter.serverId, state: late ? "pending-generation" : "active",
      levelName: late ? "Generated" : "world", worldId: worldIdentity(adapter.serverId, late ? "Generated" : "world") });
    const configured = await readPrivatePropertiesFile(path.join(server, "server.properties"));
    assert.equal(configured.checksum, late ? g.propertiesAfter : g.propertiesBefore); configured.bytes.fill(0);
    assert.deepEqual(record.checkpoints.map(point => point.name), late ? ["generation-reserved", "stop-confirmed", "guard-verified", "config-ready",
      "config-switch-intent", "config-installed", "active-state-installed"] : ["generation-reserved"]);
    await assert.rejects(lstat(path.join(server, "Generated")), error => !!error && typeof error === "object" && "code" in error && error.code === "ENOENT");
    const catalogFile = path.join(manager, "world-library", adapter.serverId, "state.json");
    const beforeCatalog = await readPrivatePropertiesFile(catalogFile), catalogHash = beforeCatalog.checksum; beforeCatalog.bytes.fill(0);
    await creator.reconcileStartup(); await operations.initialize();
    operations.requireRecovery(await states.initialize(new Map(), new Map(), new Map(), new Set(), () => {}, new Set([adapter.serverId])));
    const after = await readPrivatePropertiesFile(activeFile); assert.equal(after.checksum, activeHash); after.bytes.fill(0);
    const saved = await readPrivatePropertiesFile(path.join(root, "generation-case.json"));
    const approved = JSON.parse(saved.bytes.toString("utf8")); saved.bytes.fill(0);
    const replayed = await creator.create(adapter.serverId, approved.body, approved.key);
    assert.equal(replayed.id, g.operationId); assert.equal(replayed.state, "interrupted");
    assert.equal(operations.getServerState(adapter.serverId).recoveryRequired, true);
    const original = await readPrivatePropertiesFile(path.join(server, "world", "level.dat"));
    assert.deepEqual(original.bytes, testWorldLevel("original", true, 5023)); original.bytes.fill(0);
    const catalog = await readPrivatePropertiesFile(catalogFile); assert.equal(catalog.checksum, catalogHash);
    const value = JSON.parse(catalog.bytes.toString("utf8")); catalog.bytes.fill(0);
    assert.equal(value.schemaVersion, 4); assert.deepEqual(value.generation.reservation, g);
    assert.equal(value.entries.length, 1); assert.equal(value.entries[0].worldId, g.previousWorldId);
    if (late) {
      const checkpoint = record.checkpoints.find(point => point.name === "guard-verified")!;
      const guard = await backups.exportSource(adapter.serverId, g.guardBackupId);
      assert.equal(guard.manifest.pinned, true); assert.equal(guard.manifest.id, g.guardBackupId);
      assert.equal(guard.manifest.serverId, adapter.serverId); assert.equal(guard.manifest.scope, "world-set"); assert.deepEqual(guard.manifest.includedRoots, ["world"]);
      assert.equal(checkpoint.details?.resourceId, g.guardBackupId); assert.equal(checkpoint.details?.checksumSha256, guard.manifest.checksumSha256);
      await verifyRestoreTree(path.join(guard.directory, "payload", "world"), guard.manifest.files.map(file => ({ ...file, path: file.path.slice("world/".length) })));
    }
    assert.deepEqual((await journal.scan()).records, scan.records); await creator.close();
    await send({ kind: "probe", operationId: g.operationId, worldId: g.worldId, operationState: replayed.state,
      recoveryRequired: true, replaySameOperation: true, serverBytesUnchanged: before === await serverDigest(),
      transactionCount: 1, javaStarts: 0, activeStateUnchanged: true, journalState: record.state });
    process.disconnect?.();
  }
} else if (flavor === "replacement" || flavor === "replacement-recovery" || flavor === "replacement-import-recovery") {
  const replacement = new WorldReplacementService(operations, journal, library, service, uploads, backups, manager, clock,
    mode === "run" ? async point => {
      if (point !== boundary) return;
      const record = (await journal.scan()).records.find(item => item.intent.worldReplacement)!;
      const birth = (await journal.scan()).records.find(item => item.intent.worldLibraryImport);
      await send({ kind: "boundary", point, operationId: record.intent.operationId, worldId: record.intent.worldReplacement!.worldId,
        importOperationId: birth?.intent.operationId ?? null, importWorldId: birth?.intent.worldLibraryImport?.worldId ?? null });
      await new Promise<void>(() => {});
    } : undefined);
  if (mode === "run") {
    await operations.initialize(); await library.migrateLegacy({ serverId: adapter.serverId, rootPath: server }, states.snapshot(adapter.serverId)!);
    if (flavor === "replacement-import-recovery") {
      const inactive = await uploads.upload(adapter.serverId, "inactive.zip", Readable.from([testWorldZip(testWorldLevel("inactive"))]));
      const imported = await service.importIndependent(adapter.serverId,
        await service.plan(adapter.serverId, { name: "Independent", uploadId: inactive.id }), randomUUID());
      const deadline = performance.now() + 5000;
      while (operations.get(imported.id)?.state !== "succeeded" || operations.getServerState(adapter.serverId).activeOperationId) {
        assert.ok(performance.now() < deadline, "IMPORT_SETUP_DEADLINE");
        assert.notEqual(operations.get(imported.id)?.state, "failed");
        assert.notEqual(operations.get(imported.id)?.state, "interrupted");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const upload = await uploads.upload(adapter.serverId, "replacement.zip", Readable.from([testWorldZip(testWorldLevel("replacement"))]));
    const plan = await service.planReplacement(adapter.serverId, { uploadId: upload.id });
    const body: WorldReplacementApproval = { uploadId: plan.uploadId, uploadRevision: plan.uploadRevision, libraryRevision: plan.libraryRevision,
      currentWorldId: plan.currentWorldId, currentWorldRevision: plan.currentWorldRevision, currentContentRevision: plan.currentContentRevision,
      propertiesRevision: plan.propertiesRevision, confirmWorldName: plan.currentWorldName };
    const key = randomUUID(); await writeRestoreJson(path.join(root, "replacement-case.json"), { body, key });
    await replacement.replace(adapter.serverId, body, key);
  } else {
    const before = await serverDigest(), scan = await journal.scan();
    assert.equal(scan.issues.length, 0); assert.equal(scan.records.length, flavor === "replacement-import-recovery" ? 2 : 1);
    const record = scan.records.find(item => item.intent.worldReplacement)!, value = record.intent.worldReplacement!;
    const saved = await readPrivatePropertiesFile(path.join(root, "replacement-case.json"), 4096);
    const approved = JSON.parse(saved.bytes.toString("utf8")) as { body: WorldReplacementApproval; key: string }; saved.bytes.fill(0);
    const moved = ["replacement-old-world-renamed", "replacement-new-world-renamed", "replacement-commit-persisted", "replacement-head-completed"].includes(boundary!);
    const original = await readPrivatePropertiesFile(path.join(server, ...(moved ? [value.workspaceName, "previous-world"] : ["world"]), "level.dat"));
    assert.deepEqual(original.bytes, testWorldLevel("original")); original.bytes.fill(0);
    if (moved) {
      const guard = await backups.exportSource(adapter.serverId, value.guardBackupId); assert.equal(guard.manifest.pinned, true);
      await verifyRestoreTree(path.join(guard.directory, "payload", "world"), guard.manifest.files.map(file => ({ ...file, path: file.path.slice("world/".length) })));
    }
    if (["replacement-new-world-renamed", "replacement-commit-persisted", "replacement-head-completed"].includes(boundary!)) {
      const target = await readPrivatePropertiesFile(path.join(server, "world", "level.dat")); assert.deepEqual(target.bytes, testWorldLevel("replacement")); target.bytes.fill(0);
    }
    const props = await readPrivatePropertiesFile(path.join(server, "server.properties")); assert.equal(props.bytes.toString("utf8"), properties); props.bytes.fill(0);
    await operations.initialize();
    const birth = scan.records.find(item => item.intent.worldLibraryImport);
    if (birth) {
      assert.equal(operations.getServerState(adapter.serverId).recoveryRequired, true);
      assert.equal(operations.get(record.intent.operationId)?.state, "interrupted");
      assert.equal(operations.get(birth.intent.operationId)?.state, "interrupted");
    }
    let physicalRecoveryAccepted = false;
    const journalBefore = JSON.stringify(await journal.get(adapter.serverId, record.transactionId));
    if (flavor === "replacement-recovery" || flavor === "replacement-import-recovery") {
      try {
        await operations.verifyReplacementOutcome(adapter.serverId, record.intent.operationId, consume => uploads.withLease(async () => {
          await consume(await verifyReplacementCurrentState(adapter, manager, journal, library, backups, uploads));
        }), () => undefined, true);
        physicalRecoveryAccepted = true;
      } catch { /* Partial/pending evidence stays closed, never repaired or replayed. */ }
    }
    const replayed = await replacement.replace(adapter.serverId, approved.body, approved.key);
    if (birth) {
      const inactive = await readPrivatePropertiesFile(path.join(server, "Independent", "level.dat"));
      assert.deepEqual(inactive.bytes, testWorldLevel("inactive")); inactive.bytes.fill(0);
      assert.equal(operations.get(birth.intent.operationId)?.state, physicalRecoveryAccepted ? "succeeded" : "interrupted");
      if (physicalRecoveryAccepted) {
        assert.equal(operations.get(birth.intent.operationId)?.result?.resourceId, birth.intent.worldLibraryImport!.worldId);
        assert.equal(replayed.result?.resourceId, value.worldId);
      }
    }
    assert.equal(replayed.id, record.intent.operationId);
    assert.equal(JSON.stringify(await journal.get(adapter.serverId, record.transactionId)), journalBefore);
    assert.deepEqual((await journal.scan()).records, scan.records);
    await send({ kind: "probe", operationId: replayed.id, worldId: value.worldId, recoveryRequired: operations.getServerState(adapter.serverId).recoveryRequired,
      operationState: replayed.state, replaySameOperation: true, serverBytesUnchanged: before === await serverDigest(),
      transactionCount: (await journal.scan()).records.length, javaStarts: 0,
      physicalRecoveryAccepted, importOperationId: birth?.intent.operationId ?? null,
      importWorldId: birth?.intent.worldLibraryImport?.worldId ?? null,
      importOperationState: birth ? operations.get(birth.intent.operationId)?.state : null, journalState: record.state });
    process.disconnect?.();
  }
} else if (flavor === "repeated") {
  const protection = new WorldActivationHistoryProtection(registry, journal, library, backups, manager);
  const reader = new WorldActivationLiveHistory(registry, journal, library, protection, uploads, manager);
  if (mode === "run") {
    await operations.initialize();
    await library.migrateLegacy({ serverId: adapter.serverId, rootPath: server }, states.snapshot(adapter.serverId)!);
    const originalId = (await library.list({ serverId: adapter.serverId, rootPath: server }, states.snapshot(adapter.serverId))).activeWorldId!;
    const upload = await uploads.upload(adapter.serverId, "world.zip", Readable.from([testWorldZip(testWorldLevel("imported"))]));
    const imported = await service.importIndependent(adapter.serverId, await service.plan(adapter.serverId, { name: "Independent", uploadId: upload.id }), randomUUID());
    const wait = async (id: string) => {
      const deadline = performance.now() + 5000;
      while (operations.get(id)?.state !== "succeeded" || operations.getServerState(adapter.serverId).activeOperationId) {
        assert.ok(performance.now() < deadline, "REPEATED_SETUP_DEADLINE");
        assert.notEqual(operations.get(id)?.state, "interrupted");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    await wait(imported.id);
    const importedId = operations.get(imported.id)!.result!.resourceId!;
    const plans = new WorldActivationPlanService(registry, operations, library, states, async (id, world, revision) => {
      if (!(await journal.scan()).records.some(record => record.intent.worldActivation)) return service.verifyInactiveForActivation(id, world);
      const proof = await protection.verifyTarget(id, world, revision);
      if (proof.kind === "import") await service.verifyInactiveForActivation(id, world);
      return { historyProof: proof.historyProof };
    });
    let transition = 0;
    const controller = new WorldActivationService(registry, operations, journal, library, plans, states, backups, manager, clock, async point => {
      if (transition !== 3 || point !== boundary) return;
      const record = (await journal.scan()).records.find(record => record.intent.worldActivation?.sequence === 3)!;
      if (point === "activation-after-commit") await writeFile(path.join(server, "Independent", "after-third.dat"), "active world subsequent save");
      await send({ kind: "boundary", point, operationId: record.intent.operationId, worldId: importedId });
      await new Promise<void>(() => {});
    }, protection);
    for (const world of [importedId, originalId, importedId]) {
      transition++;
      const plan = await plans.plan(adapter.serverId, world);
      const operation = await controller.activate(adapter.serverId, { ...plan, confirmWorldName: plan.levelName }, randomUUID());
      await wait(operation.id);
      if (transition < 3) await writeFile(path.join(server, transition === 1 ? "Independent" : "world", "normal-save.dat"), `legitimate save ${transition}`);
    }
  } else {
    const before = await serverDigest();
    let physicalVerified = false;
    try { await reader.verify(adapter.serverId); physicalVerified = true; } catch { /* Unknown remains gated. */ }
    const historyImports = new WorldLibraryImportService(registry, operations, journal, library, uploads, states, clock, undefined, undefined, reader);
    await historyImports.reconcileStartup();
    await operations.initialize();
    const records = (await journal.scan()).records, record = records.find(record => record.intent.worldActivation?.sequence === 3)!;
    assert.ok(record);
    assert.equal((await readPrivatePropertiesFile(path.join(server, "world", "level.dat"))).checksum,
      createHash("sha256").update(testWorldLevel("original")).digest("hex"));
    await send({ kind: "probe", operationId: record.intent.operationId, worldId: record.intent.worldActivation!.worldId,
      physicalVerified, recoveryRequired: operations.getServerState(adapter.serverId).recoveryRequired,
      operationState: operations.get(record.intent.operationId)?.state,
      operationResourceId: operations.get(record.intent.operationId)?.result?.resourceId ?? null,
      serverBytesUnchanged: before === await serverDigest(), transactionCount: records.length, javaStarts: 0 });
    process.disconnect?.();
  }
} else if (mode === "run") {
  await operations.initialize();
  await library.migrateLegacy({ serverId: adapter.serverId, rootPath: server }, states.snapshot(adapter.serverId)!);
  const upload = await uploads.upload(adapter.serverId, "world.zip", Readable.from([testWorldZip(testWorldLevel("imported"))]));
  const body = await service.plan(adapter.serverId, { name: "Independent", uploadId: upload.id });
  const key = randomUUID(); await writeRestoreJson(path.join(root, "case.json"), { body, key });
  const imported = await service.importIndependent(adapter.serverId, body, key);
  if (flavor === "activation") {
    const deadline = performance.now() + 5000;
    while (operations.get(imported.id)?.state !== "succeeded" || operations.getServerState(adapter.serverId).activeOperationId) {
      assert.ok(performance.now() < deadline, "IMPORT_SETUP_DEADLINE");
      assert.notEqual(operations.get(imported.id)?.state, "interrupted");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const worldId = operations.get(imported.id)!.result!.resourceId!;
    const plan = await activationPlans.plan(adapter.serverId, worldId);
    const approval: WorldActivationApproval = { worldId, libraryRevision: plan.libraryRevision, currentWorldId: plan.currentWorldId,
      currentWorldRevision: plan.currentWorldRevision, targetWorldRevision: plan.targetWorldRevision, currentContentRevision: plan.currentContentRevision,
      targetContentRevision: plan.targetContentRevision, propertiesRevision: plan.propertiesRevision, confirmWorldName: plan.levelName };
    const activationKey = randomUUID(); await writeRestoreJson(path.join(root, "activation-case.json"), { body: approval, key: activationKey });
    await activation.activate(adapter.serverId, approval, activationKey);
  }
} else {
  const value = await readPrivatePropertiesFile(path.join(root, "case.json"), 4096);
  const saved = JSON.parse(value.bytes.toString("utf8")) as { body: InactiveWorldImportRequest; key: string }; value.bytes.fill(0);
  const before = await serverDigest();
  if (flavor === "activation") await activationReconciler.reconcileStartup();
  await service.reconcileStartup(); await operations.initialize();
  const outcomes = await store.list(); assert.equal(outcomes.length, flavor === "activation" ? 2 : 1);
  const records = (await journal.scan()).records;
  const record = records.find(item => flavor === "activation" ? item.intent.worldActivation : item.intent.worldLibraryImport)!;
  const outcome = outcomes.find(item => item.operation.id === record.intent.operationId)!.operation;
  let replayed;
  if (flavor === "activation") {
    const value = await readPrivatePropertiesFile(path.join(root, "activation-case.json"), 4096);
    const approved = JSON.parse(value.bytes.toString("utf8")) as { body: WorldActivationApproval; key: string }; value.bytes.fill(0);
    replayed = await activation.activate(adapter.serverId, approved.body, approved.key);
    if (boundary !== "activation-intent-persisted") {
      const guard = await backups.exportSource(adapter.serverId, record.intent.worldActivation!.guardBackupId);
      assert.equal(guard.manifest.pinned, true);
      await verifyRestoreTree(path.join(guard.directory, "payload", "world"), guard.manifest.files.map(file => ({ ...file, path: file.path.slice("world/".length) })));
    }
  } else replayed = await service.importIndependent(adapter.serverId, saved.body, saved.key);
  const original = await readPrivatePropertiesFile(path.join(server, "world", "level.dat"));
  assert.deepEqual(original.bytes, testWorldLevel("original")); original.bytes.fill(0);
  const props = await readPrivatePropertiesFile(path.join(server, "server.properties"));
  const switched = flavor === "activation" && ["activation-config-installed", "activation-state-installed", "activation-commit-persisted", "activation-after-commit"].includes(boundary!);
  assert.equal(props.bytes.toString("utf8"), switched ? properties.replace("level-name=world", "level-name=Independent") : properties); props.bytes.fill(0);
  await send({ kind: "probe", operationId: outcome.id, worldId: record.intent.worldActivation?.worldId ?? record.intent.worldLibraryImport!.worldId,
    recoveryRequired: operations.getServerState(adapter.serverId).recoveryRequired, operationState: outcome.state,
    replaySameOperation: replayed.id === outcome.id, serverBytesUnchanged: before === await serverDigest(),
    transactionCount: (await journal.scan()).records.length, javaStarts: 0,
    postCommitWorldChangeSimulated: flavor === "activation" && boundary === "activation-after-commit",
    operationResourceId: outcome.result?.resourceId ?? null });
  process.disconnect?.();
}
