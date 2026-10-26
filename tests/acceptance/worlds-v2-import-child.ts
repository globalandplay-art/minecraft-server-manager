import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { AdapterRegistry } from "../../apps/api/src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../../apps/api/src/adapters/contract.js";
import { ActiveWorldStateStore } from "../../apps/api/src/services/active-world-state-store.js";
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

const [rootArgument, mode, boundary, nonce, flavor = "import"] = process.argv.slice(2);
assert.ok(rootArgument && nonce && ["run", "probe"].includes(mode ?? ""));
assert.ok(["import", "activation"].includes(flavor));
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
  await writeFile(path.join(server, "world", "level.dat"), testWorldLevel("original"));
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
if (mode === "run") {
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
