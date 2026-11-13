import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonOperationStore, MemoryOperationStore, worldStopConfirmation, type StoredOperation } from "../src/services/operation-store.js";
import { OperationService } from "../src/services/operation-service.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import type { RuntimeOperationContext, RuntimeOwnedLaunchObservation } from "../src/infra/runtime-contract.js";
import { captureOwnedWorldLifecycle, requestOwnedWorldStart, requestOwnedWorldStop, verifyStartupOwnedWorldRevision } from "../src/services/world-owned-lifecycle.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { inventoryRestoreTree, restoreFilesChecksum } from "../src/services/restore-files.js";
import * as restoreFiles from "../src/services/restore-files.js";
import { testWorldLevel } from "./fixtures/world-library-content.js";
import { registerWorldStopInspectionRoute } from "../src/routes/world-library.js";
import { worldIdentity } from "../src/services/active-world-state-store.js";
import { DomainError } from "../src/services/domain-errors.js";
import { WorldLibraryStore } from "../src/services/world-library-store.js";
import { validWorldLifecycleReceipt, worldLifecycleFingerprint, type WorldLifecycleReceipt } from "../src/services/world-lifecycle-receipt.js";

const roots: string[] = [], at = "2026-10-30T00:00:00.000Z", clock = { now: () => new Date(at) };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function record(action: "start" | "stop" = "start"): StoredOperation {
  const id = randomUUID(), key = randomUUID();
  const shared = { schemaVersion: 1 as const, serverId: "world-receipt", worldId: `worldv2-${randomUUID()}`, catalogRevision: "a".repeat(64),
    worldRevision: "b".repeat(64), rootIdentity: "c".repeat(64), worldDirectoryIdentity: "d".repeat(64), registeredExecutionDigest: "e".repeat(64),
    runNonce: randomUUID(), startOperationId: action === "start" ? id : randomUUID(), requestDigest: "", keyDigest: hash(key.toLowerCase()) };
  const descriptor: WorldLifecycleReceipt = action === "start" ? { ...shared, action, launchId: null } :
    { ...shared, action, launchId: randomUUID(), startReceiptDigest: "f".repeat(64) };
  descriptor.requestDigest = worldLifecycleFingerprint(descriptor);
  return { operation: { id, serverId: shared.serverId, kind: action, state: "queued", step: "queued", progress: null,
    createdAt: at, updatedAt: at, result: null, error: null }, idempotencyKey: key,
    requestFingerprint: descriptor.requestDigest, expiresAt: "2026-01-01T00:00:00.000Z", worldLifecycle: descriptor };
}
async function fixture(value: StoredOperation) {
  const root = await mkdtemp(path.join(tmpdir(), "lt-world-receipt-")); roots.push(root);
  const store = new JsonOperationStore(root); await store.initialize(); await store.save(value);
  return { root, store, file: path.join(root, "operations", `${value.operation.id}.json`) };
}

describe("world lifecycle receipts", () => {
  it.each(["verified", "revoked", "receipt-drift", "missing-verification", "launch-drift", "seal-drift", "stop-receipt-drift", "stop-parent-drift", "stop-world-drift", "revision-seal-drift", "published-world-drift", "published-seal-drift"] as const)("binds the registered launch to durable lifecycle intents (%s)", async scenario => {
    const root = await mkdtemp(path.join(tmpdir(), "lt-world-receipt-")); roots.push(root);
    const store = new JsonOperationStore(root), operations = new OperationService(store, clock);
    await operations.initialize();
    const value = record(), receipt = value.worldLifecycle!, serverId = value.operation.serverId;
    const directory = path.join(root, "world"), properties = path.join(root, "server.properties");
    await mkdir(directory);
    await writeFile(path.join(directory, "level.dat"), testWorldLevel("initial", true, 5023));
    await writeFile(properties, "level-name=world\n");
    const library = new WorldLibraryStore(root, clock);
    const slot = { schemaVersion: 1 as const, serverId, state: "active" as const,
      worldId: worldIdentity(serverId, "world"), levelName: "world" };
    const libraryBinding = { serverId, rootPath: root };
    await library.migrateLegacy(libraryBinding, slot);
    const catalog = await library.list(libraryBinding, slot);
    receipt.worldId = catalog.activeWorldId!;
    receipt.catalogRevision = catalog.revision!;
    receipt.rootIdentity = await backupDirectoryIdentity(root);
    receipt.worldDirectoryIdentity = await backupDirectoryIdentity(directory);
    const identity = { rootIdentity: receipt.rootIdentity, javaIdentity: "java" };
    receipt.registeredExecutionDigest = hash(JSON.stringify(identity));
    receipt.requestDigest = worldLifecycleFingerprint(receipt);
    Object.assign(value, { requestFingerprint: receipt.requestDigest });
    let observation: RuntimeOwnedLaunchObservation | null = null, authorized = true;
    let changedSealId: string | undefined;
    if (scenario === "launch-drift" || scenario === "seal-drift") {
      const create = store.createWorldLaunchSeal.bind(store);
      vi.spyOn(store, "createWorldLaunchSeal").mockImplementation(async seal => {
        await create(seal);
        if (scenario === "launch-drift") observation = null;
        else {
          const read = store.read.bind(store);
          vi.spyOn(store, "read").mockImplementationOnce(async id => {
            changedSealId = randomUUID();
            await writeFile(path.join(root, "operations", `${id}.launch.json`), JSON.stringify({ ...seal, launchId: changedSealId }));
            return read(id);
          });
        }
      });
    }
    let changed: string | undefined;
    const file = path.join(root, "operations", `${value.operation.id}.json`);
    const launchId = randomUUID(), verifyWorld = vi.fn(async () => {});
    const runtime = { supportsSpawnAdmission: true, supportsStopAdmission: true, getOwnedLaunchObservation: () => observation };
    const sendStop = vi.fn();
    let stoppedStatusReads = 0;
    const adapter = {
      serverId, mode: "local", plan: { rootPath: root, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
      getRuntime: () => runtime, getRegisteredExecutionIdentity: () => identity,
      getStatus: async () => {
        if (scenario === "revision-seal-drift" && observation?.stopCompleted && ++stoppedStatusReads === 4) {
          const seal = await store.readWorldLaunchSeal(value.operation.id);
          changedSealId = randomUUID();
          await writeFile(path.join(root, "operations", `${value.operation.id}.launch.json`), JSON.stringify({ ...seal, launchId: changedSealId }));
        }
        return { state: "stopped", ownership: "none", recoveryRequired: false };
      },
      revalidateBeforeStart: async () => {},
      start: async (context: RuntimeOperationContext) => {
        const saved = await store.read(context.operationId);
        expect(saved.operation.state).toBe("running");
        if (scenario === "receipt-drift") {
          changed = JSON.stringify({ ...saved, expiresAt: at });
          await writeFile(file, changed);
        }
        if (scenario !== "missing-verification") await context.verifyBeforeSpawn!();
        if (scenario === "revoked") authorized = false;
        context.beforeSpawn!();
        observation = { launchId, serverId, ownerOperationId: context.operationId, processId: 12345,
          spawned: true, ready: true, stopRequested: false, stopOperationId: null, stopCompleted: false,
          errorObserved: false, exited: false, exitCode: null, signal: null, closed: false };
      },
      stop: async (context: RuntimeOperationContext) => {
        Object.assign(observation!, { stopRequested: true, stopOperationId: context.operationId });
        if (scenario === "stop-receipt-drift") {
          const saved = await store.read(context.operationId);
          changed = JSON.stringify({ ...saved, expiresAt: at });
          await writeFile(path.join(root, "operations", `${context.operationId}.json`), changed);
        }
        if (scenario === "stop-parent-drift") {
          const read = store.read.bind(store), seal = await store.readWorldLaunchSeal(value.operation.id);
          vi.spyOn(store, "read").mockImplementationOnce(async id => {
            changedSealId = randomUUID();
            await writeFile(path.join(root, "operations", `${value.operation.id}.launch.json`), JSON.stringify({ ...seal, launchId: changedSealId }));
            return read(id);
          });
        }
        await context.verifyBeforeStop!();
        context.beforeStop!();
        sendStop();
        await writeFile(path.join(directory, "level.dat"), testWorldLevel("saved", true, 5023));
        if (scenario === "stop-world-drift") await writeFile(properties, "level-name=other\n");
        Object.assign(observation!, { stopCompleted: true, exited: true, exitCode: 0, closed: true });
      }
    } as unknown as LocalMinecraftServerAdapter;
    let witness: ReturnType<typeof captureOwnedWorldLifecycle> | undefined;
    const onLaunch = vi.fn(async (proof: ReturnType<typeof captureOwnedWorldLifecycle>, seal: Awaited<ReturnType<JsonOperationStore["readWorldLaunchSeal"]>>) => {
      expect(proof.launchId).toBe(launchId);
      expect(await new JsonOperationStore(root).readWorldLaunchSeal(value.operation.id)).toEqual(seal);
      expect(seal.intentDigest).toBe(hash(JSON.stringify(await store.read(value.operation.id))));
      witness = proof;
    });
    const registry = new AdapterRegistry([adapter]);
    await requestOwnedWorldStart(registry, operations, value, verifyWorld, () => {
      if (!authorized) throw new Error("revoked");
      return undefined;
    }, onLaunch);
    await vi.waitFor(() => expect(operations.getServerState(serverId).activeOperationId).toBeNull());
    expect(verifyWorld).toHaveBeenCalledTimes(scenario === "missing-verification" ? 2 : 3);
    const started = scenario === "verified" || scenario.startsWith("stop-") || scenario === "revision-seal-drift" || scenario.startsWith("published-");
    expect(onLaunch).toHaveBeenCalledTimes(started ? 1 : 0);
    if (scenario === "seal-drift") {
      expect((await store.readWorldLaunchSeal(value.operation.id)).launchId).toBe(changedSealId);
    } else if (started || scenario === "launch-drift") {
      const seal = await store.readWorldLaunchSeal(value.operation.id);
      await expect(store.createWorldLaunchSeal({ ...seal, launchId: randomUUID() })).rejects.toMatchObject({ code: "EEXIST" });
      expect(await store.readWorldLaunchSeal(value.operation.id)).toEqual(seal);
    } else await expect(store.readWorldLaunchSeal(value.operation.id)).rejects.toMatchObject({ code: "ENOENT" });
    if (scenario === "receipt-drift") expect(await readFile(file, "utf8")).toBe(changed);
    expect(operations.getServerState(serverId).recoveryRequired).toBe(true);
    if (started) {
      authorized = false; // The subsequent stop uses its own authorization.
      const stop = record("stop"), seal = await store.readWorldLaunchSeal(value.operation.id);
      stop.operation.serverId = serverId;
      const binding = { ...receipt, action: "stop" as const, launchId: seal.launchId, startReceiptDigest: seal.intentDigest,
        keyDigest: hash(stop.idempotencyKey.toLowerCase()) };
      binding.requestDigest = worldLifecycleFingerprint(binding);
      Object.assign(stop, { worldLifecycle: binding, requestFingerprint: binding.requestDigest });
      if (scenario === "published-world-drift") {
        const create = store.createWorldStopSeal.bind(store);
        vi.spyOn(store, "createWorldStopSeal").mockImplementationOnce(async proof => {
          await create(proof);
          await writeFile(path.join(directory, "level.dat"), testWorldLevel("external-change", true, 5023));
        });
      }
      let consumerVerified = false;
      const sealFile = path.join(root, "operations", `${stop.operation.id}.stop.json`);
      const stopped = vi.fn(async (result: { treeChecksum: string; recheck: () => Promise<void> }, seal: Awaited<ReturnType<JsonOperationStore["readWorldStopSeal"]>>) => {
        expect(result.treeChecksum).toBe(restoreFilesChecksum(await inventoryRestoreTree(directory)));
        expect(seal.treeChecksum).toBe(result.treeChecksum);
        expect(seal.stopIntentDigest).toBe(hash(JSON.stringify(await store.read(stop.operation.id))));
        if (scenario === "published-seal-drift") {
          seal.treeChecksum = "0".repeat(64);
          changed = JSON.stringify(seal);
          await writeFile(sealFile, changed);
        }
        await result.recheck();
        consumerVerified = true;
      });
      await requestOwnedWorldStop(registry, operations, stop, "world", witness!, () => undefined, stopped);
      await vi.waitFor(() => expect(operations.getServerState(serverId).activeOperationId).toBeNull());
      expect(sendStop).toHaveBeenCalledTimes(scenario === "stop-receipt-drift" || scenario === "stop-parent-drift" ? 0 : 1);
      expect(stopped).toHaveBeenCalledTimes(scenario === "verified" || scenario === "published-seal-drift" ? 1 : 0);
      expect(consumerVerified).toBe(scenario === "verified");
      if (scenario === "published-seal-drift") {
        expect(changed).toBeDefined();
        expect(await readFile(sealFile, "utf8")).toBe(changed);
      }
      if (scenario === "stop-receipt-drift") expect(await readFile(path.join(root, "operations", `${stop.operation.id}.json`), "utf8")).toBe(changed);
      if (scenario === "stop-parent-drift" || scenario === "revision-seal-drift") {
        expect(changedSealId).toBeDefined();
        expect((await store.readWorldLaunchSeal(value.operation.id)).launchId).toBe(changedSealId);
      }
      expect(operations.getServerState(serverId).recoveryRequired).toBe(true);
      if (scenario === "verified" || scenario.startsWith("published-")) {
        const journal = new TransactionJournalStore(root);
        const restartedStore = new JsonOperationStore(root), restarted = new OperationService(restartedStore, clock, journal);
        await restarted.initialize();
        const seal = await restartedStore.readWorldStopSeal(stop.operation.id);
        expect(seal.stopIntentDigest).toBe(hash(JSON.stringify(await restartedStore.read(stop.operation.id))));
        const checksum = restoreFilesChecksum(await inventoryRestoreTree(directory));
        if (scenario === "verified") expect(seal.treeChecksum).toBe(checksum);
        else expect(seal.treeChecksum).not.toBe(checksum);
        expect(restarted.getServerState(serverId).recoveryRequired).toBe(true);
        const candidate = await restarted.readStartupWorldStopCandidate(serverId);
        expect(candidate?.revision).toEqual(seal);
        expect(candidate?.launch.launchId).toBe(launchId);
        const freshRuntime = { ...runtime, getOwnedLaunchObservation: () => null };
        let external = false;
        const freshRegistry = new AdapterRegistry([{ ...adapter, getRuntime: () => freshRuntime,
          getStatus: async () => external ? { state: "running", ownership: "external", recoveryRequired: false } : adapter.getStatus()
        } as unknown as LocalMinecraftServerAdapter]);
        const inspect = () => verifyStartupOwnedWorldRevision(freshRegistry, restarted, serverId, "world", () => undefined);
        if (scenario === "verified") {
          await expect(inspect()).resolves.toMatchObject({ inspectionOnly: true, worldId: receipt.worldId, treeChecksum: checksum });
          const level = path.join(directory, "level.dat"), held = path.join(root, "level.held");
          const bytes = await readFile(level);
          const inventory = restoreFiles.inventoryRestoreTree;
          let observations = 0;
          const replace = vi.spyOn(restoreFiles, "inventoryRestoreTree").mockImplementation(async (...args) => {
            const files = await inventory(...args);
            if (args[0] === directory && ++observations === 2) {
              await rename(level, held);
              await writeFile(level, bytes, { flag: "wx" });
            }
            return files;
          });
          try {
            await expect(inspect()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
            expect(observations).toBe(2);
          } finally {
            replace.mockRestore();
            await rename(held, level);
          }
          const { locationIdentity } = await journal.scanExisting();
          const confirmation = worldStopConfirmation(candidate!, hash(JSON.stringify({ locationIdentity, records: [] })));
          const confirmationStore = new JsonOperationStore(root);
          await confirmationStore.initialize();
          expect(worldStopConfirmation({ ...candidate!, revision: { ...seal, treeChecksum: "0".repeat(64) } }))
            .not.toEqual(confirmation);
          await expect(confirmationStore.readWorldStopConfirmation(value.operation.id)).rejects.toMatchObject({ code: "ENOENT" });
          expect(restarted.getServerState(serverId).recoveryRequired).toBe(true);
          const app = Fastify();
          let wrongCatalog = false;
          registerWorldStopInspectionRoute(app, freshRegistry, restarted, { list: async (...args) => {
            const current = await library.list(...args);
            return wrongCatalog ? { ...current, revision: "0".repeat(64) } : current;
          } }, { journal: { scan: async () => ({ records: [], issues: [] }) }, receipts: restartedStore }, () => slot, clock, "local", {
            assertMutation: request => {
              if (request.headers["x-test-auth"] !== "verified") throw new DomainError(403, "AUTH_REQUIRED", "Authorization required");
            }
          });
          try {
            const request = { method: "POST" as const, url: `/api/v1/servers/${serverId}/worlds/stopped-revision-inspection`,
              headers: { origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui", "content-type": "application/json" }, payload: {} };
            expect((await app.inject(request)).statusCode).toBe(403);
            const authenticated = { ...request, headers: { ...request.headers, "x-test-auth": "verified" } };
            expect((await app.inject({ ...authenticated, payload: { levelName: "other" } })).statusCode).toBe(400);
            const response = await app.inject(authenticated);
            expect(response.statusCode).toBe(200);
            expect(response.headers["cache-control"]).toBe("no-store");
            expect(response.json().data).toEqual({ serverId, operationId: stop.operation.id, worldId: receipt.worldId,
              inspectionOnly: true, recoveryRequired: true, confirmationRecorded: false });
            const recordsDir = path.join(root, "operations");
            const readConfirmation = restartedStore.readWorldStopConfirmation.bind(restartedStore);
            const moveRecords = vi.spyOn(restartedStore, "readWorldStopConfirmation").mockImplementationOnce(async id => {
              await rename(recordsDir, recordsDir + ".held");
              return readConfirmation(id);
            });
            try { expect((await app.inject(authenticated)).statusCode).toBe(409); }
            finally {
              moveRecords.mockRestore();
              await rename(recordsDir + ".held", recordsDir);
            }
            await expect(confirmationStore.readWorldStopConfirmation(stop.operation.id)).rejects.toMatchObject({ code: "ENOENT" });
            const withoutJournal = new OperationService(confirmationStore, clock);
            await withoutJournal.initialize();
            await expect(verifyStartupOwnedWorldRevision(freshRegistry, withoutJournal, serverId, "world",
              () => undefined, async () => {}, stop.operation.id)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
            await expect(confirmationStore.readWorldStopConfirmation(stop.operation.id)).rejects.toMatchObject({ code: "ENOENT" });
            expect((await app.inject({ ...authenticated, payload: { confirmStopOperationId: randomUUID() } })).statusCode).toBe(409);
            const confirm = { ...authenticated, payload: { confirmStopOperationId: stop.operation.id } };
            expect((await app.inject(confirm)).json().data.confirmationRecorded).toBe(true);
            expect((await app.inject(confirm)).statusCode).toBe(200);
            expect(await confirmationStore.readWorldStopConfirmation(stop.operation.id)).toEqual(confirmation);
            const reopened = new OperationService(confirmationStore, clock, journal);
            await reopened.initialize();
            const inspectReopened = () => verifyStartupOwnedWorldRevision(freshRegistry, reopened, serverId, "world",
              () => undefined, async () => {});
            await expect(inspectReopened()).resolves.toMatchObject({ confirmationRecorded: true, inspectionOnly: true });
            expect(reopened.getServerState(serverId).recoveryRequired).toBe(true);
            const extra = record();
            await confirmationStore.create(extra);
            try {
              await expect(inspectReopened()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
              expect((await app.inject(confirm)).statusCode).toBe(409);
            } finally {
              await rm(path.join(recordsDir, `${extra.operation.id}.json`));
            }
            await expect(restartedStore.createWorldStopConfirmation({ ...confirmation, evidenceDigest: "0".repeat(64) }))
              .rejects.toMatchObject({ code: "EEXIST" });
            const confirmationPath = path.join(root, "operations", `${stop.operation.id}.stop-confirmation.json`);
            const createConfirmation = restartedStore.createWorldStopConfirmation.bind(restartedStore);
            const publish = vi.spyOn(restartedStore, "createWorldStopConfirmation").mockImplementationOnce(async expected => {
              await writeFile(confirmationPath, JSON.stringify({ ...expected, evidenceDigest: "0".repeat(64) }));
              await createConfirmation(expected);
            });
            try { expect((await app.inject(confirm)).statusCode).toBe(409); }
            finally { publish.mockRestore(); }
            await expect(inspectReopened()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
            await writeFile(confirmationPath, JSON.stringify(worldStopConfirmation(candidate!)));
            await expect(inspectReopened()).resolves.toMatchObject({ confirmationRecorded: true, inspectionOnly: true });
            const recordVerified = vi.fn(async () => {});
            await expect(verifyStartupOwnedWorldRevision(freshRegistry, reopened, serverId, "world", () => undefined,
              async () => {}, stop.operation.id, recordVerified)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
            expect(recordVerified).not.toHaveBeenCalled();
            expect(restarted.getServerState(serverId).recoveryRequired).toBe(true);
            wrongCatalog = true;
            expect((await app.inject(authenticated)).statusCode).toBe(409);
          } finally { await app.close(); }
          external = true;
          await expect(inspect()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
          external = false;
          const other = record();
          other.operation.serverId = "other-world";
          other.worldLifecycle!.serverId = "other-world";
          other.worldLifecycle!.requestDigest = worldLifecycleFingerprint(other.worldLifecycle!);
          Object.assign(other, { requestFingerprint: other.worldLifecycle!.requestDigest });
          let release!: () => void, entered!: () => void;
          const waiting = new Promise<void>(resolve => { release = resolve; });
          const queued = new Promise<void>(resolve => { entered = resolve; });
          let competing: Promise<unknown> | undefined;
          const inspection = restarted.runStartupWorldStopInspection(serverId, () => undefined, async () => {
            competing = restarted.persistOwnedWorldStartIntent(other, async () => {
              entered();
              await waiting;
              restarted.requireRecovery([serverId]);
            }, () => undefined);
            return "inspection result";
          });
          const rejected = expect(inspection).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
          await queued;
          release();
          await rejected;
          await competing;
        } else await expect(inspect()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
        expect(restarted.getServerState(serverId).recoveryRequired).toBe(true);
        const invalid = JSON.stringify({ ...seal, stopIntentDigest: "0".repeat(64) });
        await writeFile(sealFile, invalid);
        await expect(restarted.readStartupWorldStopCandidate(serverId)).resolves.toBeUndefined();
        const incomplete = new OperationService(new JsonOperationStore(root), clock);
        await incomplete.initialize();
        await expect(incomplete.readStartupWorldStopCandidate(serverId)).resolves.toBeUndefined();
        expect(incomplete.getServerState(serverId).recoveryRequired).toBe(true);
        expect(await readFile(sealFile, "utf8")).toBe(invalid);
      } else await expect(store.readWorldStopSeal(stop.operation.id)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  it("rejects an asynchronous launch verifier before creating a seal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lt-world-receipt-")); roots.push(root);
    const store = new JsonOperationStore(root), service = new OperationService(store, clock);
    await service.initialize();
    const value = record(), verifier = vi.fn(async () => { throw new Error("not a synchronous witness"); });
    await service.persistOwnedWorldStartIntent(value, async () => {}, () => undefined, async context => {
      await context.sealLaunch(randomUUID(), verifier as never);
    });
    await vi.waitFor(() => expect(service.getServerState(value.operation.serverId).activeOperationId).toBeNull());
    expect(verifier).toHaveBeenCalledOnce();
    await expect(store.readWorldLaunchSeal(value.operation.id)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["verified", "drift", "external-recovery", "revoked"] as const)("dispatches only after a verified running receipt (%s)", async scenario => {
    const root = await mkdtemp(path.join(tmpdir(), "lt-world-receipt-")); roots.push(root);
    const store = new JsonOperationStore(root), service = new OperationService(store, clock);
    await service.initialize();
    const listener = vi.fn();
    service.subscribe(listener);
    const value = record(), read = store.read.bind(store);
    let revoked = false, reads = 0;
    vi.spyOn(store, "read").mockImplementation(async id => {
      const saved = await read(id);
      if (++reads === 2 && saved.operation.state === "running") {
        if (scenario === "drift") return { ...saved, expiresAt: at };
        if (scenario === "external-recovery") service.requireRecovery([value.operation.serverId]);
        if (scenario === "revoked") revoked = true;
      }
      return saved;
    });
    const dispatch = vi.fn(async () => {
      expect((await read(value.operation.id)).operation.state).toBe("running");
    });
    await service.persistOwnedWorldStartIntent(value, async () => {}, () => {
      if (revoked) throw new Error("authorization revoked");
      return undefined;
    }, dispatch);
    await vi.waitFor(() => expect(service.getServerState(value.operation.serverId).activeOperationId).toBeNull());
    expect(dispatch).toHaveBeenCalledTimes(scenario === "verified" ? 1 : 0);
    expect((await read(value.operation.id)).operation.state).toBe("running");
    expect(service.getServerState(value.operation.serverId).recoveryRequired).toBe(true);
    expect(listener).toHaveBeenCalled();
    for (const [event] of listener.mock.calls) {
      expect(event).toMatchObject({ id: value.operation.id, state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
    }
  });
  it("preserves a dispatch receipt changed after admission readback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lt-world-receipt-")); roots.push(root);
    const store = new JsonOperationStore(root), service = new OperationService(store, clock);
    await service.initialize();
    const value = record(), read = store.read.bind(store), dispatch = vi.fn(async () => {});
    const file = path.join(root, "operations", `${value.operation.id}.json`);
    let changed = "";
    vi.spyOn(store, "read").mockImplementationOnce(async id => {
      const saved = await read(id);
      changed = JSON.stringify({ ...saved, expiresAt: at });
      await writeFile(file, changed);
      return saved;
    });
    await service.persistOwnedWorldStartIntent(value, async () => {}, () => undefined, dispatch);
    await vi.waitFor(() => expect(service.getServerState(value.operation.serverId).activeOperationId).toBeNull());
    expect(dispatch).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe(changed);
    expect(service.getServerState(value.operation.serverId).recoveryRequired).toBe(true);
  });
  it("rechecks the operation gate at spawn after dispatch has begun", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lt-world-receipt-")); roots.push(root);
    const store = new JsonOperationStore(root), service = new OperationService(store, clock);
    await service.initialize();
    const value = record(), spawn = vi.fn();
    const dispatch = vi.fn(async ({ beforeSpawn }: { beforeSpawn: () => undefined }) => {
      service.requireRecovery([value.operation.serverId]);
      beforeSpawn();
      spawn();
    });
    await service.persistOwnedWorldStartIntent(value, async () => {}, () => undefined, dispatch);
    await vi.waitFor(() => expect(service.getServerState(value.operation.serverId).activeOperationId).toBeNull());
    expect(dispatch).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
    expect((await store.read(value.operation.id)).operation.state).toBe("running");
  });
  it.each([false, true])("keeps recovery closed after intent readback (mismatch=%s)", async mismatch => {
    const previous = record();
    const f = await fixture(previous);
    const service = new OperationService(f.store, clock);
    await service.initialize();
    const value = record();
    // Use a fresh instance so the previous receipt's recovery cause is isolated.
    value.operation.serverId = "fresh-world";
    value.worldLifecycle!.serverId = "fresh-world";
    value.worldLifecycle!.requestDigest = worldLifecycleFingerprint(value.worldLifecycle!);
    Object.assign(value, { requestFingerprint: value.worldLifecycle!.requestDigest });
    if (mismatch) vi.spyOn(f.store, "read").mockResolvedValue(previous);
    const pending = service.persistOwnedWorldStartIntent(value, async () => {}, () => undefined);
    if (mismatch) await expect(pending).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    else await expect(pending).resolves.toMatchObject({ id: value.operation.id, state: "interrupted" });
    expect(service.getServerState("fresh-world").recoveryRequired).toBe(true);
    expect(await f.store.list()).toContainEqual(value);
    if (mismatch) {
      const competing = structuredClone(value);
      competing.operation.serverId = "competing-world";
      competing.worldLifecycle!.serverId = "competing-world";
      competing.worldLifecycle!.requestDigest = worldLifecycleFingerprint(competing.worldLifecycle!);
      Object.assign(competing, { requestFingerprint: competing.worldLifecycle!.requestDigest });
      await expect(service.persistOwnedWorldStartIntent(competing, async () => {}, () => undefined))
        .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      expect(await f.store.list()).toContainEqual(value);
    }
  });
  it("does not write an intent when recovery is required during preflight", async () => {
    const previous = record();
    const f = await fixture(previous);
    const service = new OperationService(f.store, clock);
    await service.initialize();
    const value = record();
    value.operation.serverId = "fresh-world";
    value.worldLifecycle!.serverId = "fresh-world";
    value.worldLifecycle!.requestDigest = worldLifecycleFingerprint(value.worldLifecycle!);
    Object.assign(value, { requestFingerprint: value.worldLifecycle!.requestDigest });
    await expect(service.persistOwnedWorldStartIntent(value, async () => {
      service.requireRecovery(["fresh-world"]);
    }, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toEqual([previous]);
  });
  it.each(["start", "stop"] as const)("round-trips strict %s binding through existing JSON store", async action => {
    const value = record(action), f = await fixture(value);
    expect(await new JsonOperationStore(f.root).list()).toEqual([value]);
    expect(validWorldLifecycleReceipt(value)).toBe(true);
  });
  it("separates request target from server-created launch observation", () => {
    const value = record(), changed = structuredClone(value);
    Object.assign(changed.worldLifecycle!, { runNonce: randomUUID(), launchId: randomUUID() });
    expect(worldLifecycleFingerprint(changed.worldLifecycle!)).toBe(value.requestFingerprint);
    expect(validWorldLifecycleReceipt(changed)).toBe(true); // Shape only, NOT a sealed runtime proof.
    Object.assign(changed.worldLifecycle!, { worldId: `worldv2-${randomUUID()}` });
    expect(validWorldLifecycleReceipt(changed)).toBe(false);
  });
  it.each(["queued", "running", "succeeded", "failed", "interrupted"] as const)("preserves raw %s receipt on restart and projects recovery", async state => {
    const value = record(); value.operation.state = state;
    const f = await fixture(value), before = await readFile(f.file);
    const service = new OperationService(new JsonOperationStore(f.root), clock); await service.initialize();
    expect(await readFile(f.file)).toEqual(before);
    expect(service.get(value.operation.id)).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
    service.confirmPhysicalTransaction(value.operation.id);
    expect(service.getServerState(value.operation.serverId).recoveryRequired).toBe(true);
    const execute = vi.fn(async () => {});
    await expect(service.requestLifecycle(value.operation.serverId, "start", value.idempotencyKey.toUpperCase(), execute))
      .rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(service.requestLifecycle(value.operation.serverId, "stop", randomUUID(), execute)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(execute).not.toHaveBeenCalled(); expect(await f.store.list()).toEqual([value]);
  });
  it("pins stop idempotency after expiry and rejects wrong start/stop relationships", async () => {
    const value = record("stop"), f = await fixture(value), service = new OperationService(f.store, clock); await service.initialize();
    await expect(service.requestLifecycle(value.operation.serverId, "stop", value.idempotencyKey, vi.fn())).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    const malformed = structuredClone(value); Object.assign(malformed.worldLifecycle!, { launchId: null });
    expect(validWorldLifecycleReceipt(malformed)).toBe(false);
    Object.assign(malformed.worldLifecycle!, { launchId: randomUUID(), startOperationId: malformed.operation.id });
    expect(validWorldLifecycleReceipt(malformed)).toBe(false);
  });
  it.each(["version", "extra", "server", "key", "fingerprint", "generation"])("rejects %s corruption on save, list and custom-store initialization", async kind => {
    const value = record(), f = await fixture(value), malformed = structuredClone(value);
    if (kind === "version") Object.assign(malformed.worldLifecycle!, { schemaVersion: 2 });
    if (kind === "extra") Object.assign(malformed.worldLifecycle!, { path: "not-a-supported-input" });
    if (kind === "server") malformed.operation.serverId = "other";
    if (kind === "key") Object.assign(malformed, { idempotencyKey: randomUUID() });
    if (kind === "fingerprint") Object.assign(malformed, { requestFingerprint: "a".repeat(64) });
    if (kind === "generation") Object.assign(malformed, { worldGenerationExecution: {} });
    await expect(f.store.save(malformed)).rejects.toThrow();
    await writeFile(f.file, JSON.stringify(malformed) + "\n"); await expect(f.store.list()).rejects.toThrow();
    const memory = new MemoryOperationStore(); await memory.save(malformed);
    await expect(new OperationService(memory, clock).initialize()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("rejects case-normalized duplicate tagged keys rather than choosing an owner", async () => {
    const first = record(), second = record(); Object.assign(second, { idempotencyKey: first.idempotencyKey.toUpperCase() });
    second.worldLifecycle!.keyDigest = first.worldLifecycle!.keyDigest;
    const f = await fixture(first); await f.store.save(second);
    await expect(new OperationService(f.store, clock).initialize()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toHaveLength(2);
  });
  it("rejects an untagged legacy key alias rather than replaying the wrong receipt", async () => {
    const first = record(), second = record(); Object.assign(second, { idempotencyKey: first.idempotencyKey.toUpperCase(), worldLifecycle: undefined });
    const f = await fixture(first); await f.store.save(second);
    await expect(new OperationService(f.store, clock).initialize()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toHaveLength(2);
  });
});
