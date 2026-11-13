import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as maturityIo from "../src/services/world-generation-maturity-io.js";
import * as completionWriter from "../src/services/world-generation-completion.js";
import * as restoreFiles from "../src/services/restore-files.js";
import { inspectInitialMaturityPublicationMetadata } from "../src/services/world-generation-maturity-publication.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import type { RuntimeOwnedLaunchObservation, RuntimeOperationContext } from "../src/infra/runtime-contract.js";
import { ActiveWorldStateStore } from "../src/services/active-world-state-store.js";
import { BackupService } from "../src/services/backup-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { JsonOperationStore, type StoredOperation } from "../src/services/operation-store.js";
import { worldLifecycleFingerprint, type WorldLifecycleReceipt } from "../src/services/world-lifecycle-receipt.js";
import { requestOwnedWorldStop, type captureOwnedWorldLifecycle } from "../src/services/world-owned-lifecycle.js";
import { TransactionJournalStore, type TransactionJournalRecord } from "../src/services/transaction-journal.js";
import { WorldCreatePlanService } from "../src/services/world-create-plan-service.js";
import { WorldCreateService } from "../src/services/world-create-service.js";
import { WorldGenerationService } from "../src/services/world-generation-service.js";
import { WorldLibraryStore, inspectGenerationGenesisSnapshot, projectGenerationWorldHistory, projectGenerationJournalHistory } from "../src/services/world-library-store.js";
import { testWorldLevel } from "./fixtures/world-library-content.js";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import Fastify from "fastify";
import { registerWorldGenerationRoute } from "../src/routes/world-create-plans.js";
import { registerWorldStopInspectionRoute } from "../src/routes/world-library.js";
import { SessionCore } from "../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
import { verifyGenerationCurrentState } from "../src/services/world-generation-current-state.js";
import { commitGenerationSlot, generationSlotProofDigest } from "../src/services/world-generation-slot.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { sealGenerationCompletion } from "../src/services/world-generation-completion.js";
import * as privateFiles from "../src/services/properties-private-file.js";
import { generationReferenceObjectWitness, inspectGenerationGenesisReference } from "../src/services/world-generation-genesis-reference.js";
import { generationExecutionFingerprint } from "../src/services/world-generation-execution.js";
import { inspectIssuedGenerationReference } from "../src/services/world-generation-reference-issuer.js";
import { verifyInitialMatureGenerationCurrentState, verifyPublishedInitialWorldBaseline } from "../src/services/world-generation-mature-current-state.js";
import * as currentStateVerification from "../src/services/world-generation-current-state.js";

const roots: string[] = [], clock = { now: () => new Date("2026-10-28T12:00:00Z") };
it("rejects extra and coerced finalization fields before calling its executor", async () => {
  const app = Fastify();
  const finalizePublishedGeneration = vi.fn();
  registerWorldGenerationRoute(app, { finalizePublishedGeneration, generate: vi.fn(), executionTarget: vi.fn() },
    clock, "local", { assertMutation: vi.fn() });
  try {
    for (const payload of [
      { executionOperationId: randomUUID(), extra: true },
      { executionOperationId: 123 },
      {}
    ]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/servers/test/worlds/generation-finalize",
        headers: { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" }, payload });
      expect(response.statusCode).toBe(400);
    }
    expect(finalizePublishedGeneration).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
const cleanupOwners = new Map<string, () => Promise<void>>(), deliberatelyBlocked = new Set<string>();
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (deliberatelyBlocked.delete(root)) {
      await writeFile(path.join(root, "fixture-retained.json"), JSON.stringify({ kind: "Fake-only intentional CLEANUP_BLOCKED; no real process", cleanup: "retained" }));
      cleanupOwners.delete(root); continue;
    }
    await cleanupOwners.get(root)?.(); // A failed drain must never fall through to deletion.
    cleanupOwners.delete(root); await rm(root, { recursive: true, force: true });
  }
});
async function fixture(publishCatalog = false, prepareVia?: (input: {
  adapter: LocalMinecraftServerAdapter; manager: string; store: JsonOperationStore;
  journal: TransactionJournalStore; states: ActiveWorldStateStore;
  body: Parameters<WorldCreateService["create"]>[1];
  own: (owner: { close(): Promise<void> }) => void;
  hasSettled: (id: string) => boolean;
}) => Promise<{ id: string }>) {
  const root = await mkdtemp(path.join(tmpdir(), "lt-generation-run-")); roots.push(root);
  const manager = path.join(root, "manager"), server = path.join(root, "server"), serverId = "generation-run";
  await mkdir(manager); await mkdir(path.join(server, "world"), { recursive: true });
  await writeFile(path.join(server, "world", "level.dat"), testWorldLevel("old", true, 5023));
  await writeFile(path.join(server, "server.properties"), "#Minecraft server properties\n#Wed Oct 28 21:36:46 CST 2026\nlevel-name=world\n");
  let observation: RuntimeOwnedLaunchObservation | null = null;
  const runtime = { supportsSpawnAdmission: true as const, getOwnedLaunchObservation: vi.fn(() => observation && structuredClone(observation)),
    stopOwnedForRecovery: (ctx: RuntimeOperationContext, owner: string) => stop(ctx, owner) };
  const identity = { rootIdentity: await backupDirectoryIdentity(server), javaIdentity: "2".repeat(64), javaSha256: "3".repeat(64), launcherIdentity: "4".repeat(64), launcherSha256: "5".repeat(64) };
  const start = vi.fn(async (ctx: RuntimeOperationContext) => {
    ctx.beforeSpawn?.();
    observation = { launchId: randomUUID(), serverId, ownerOperationId: ctx.operationId, processId: 12345, spawned: true, ready: true,
      stopRequested: false, stopOperationId: null, stopCompleted: false, errorObserved: false, exited: false, exitCode: null, signal: null, closed: false };
    await mkdir(path.join(server, "NewWorld")); await writeFile(path.join(server, "NewWorld", "level.dat"), testWorldLevel("new", true, 5023));
  });
  const stop = vi.fn(async (ctx: RuntimeOperationContext, owner: string) => {
    expect(observation?.ownerOperationId).toBe(owner);
    await ctx.onStep("test-owned-stop");
    Object.assign(observation!, { stopRequested: true, stopOperationId: ctx.operationId, stopCompleted: true, exited: true, exitCode: 0, closed: true });
  });
  const adapter = { serverId, mode: "local", plan: { rootPath: server, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }),
    getServerInfo: async () => ({ type: "vanilla", minecraftVersion: "26.3" }), getCapabilities: async () => ({ worlds: true, backup: true }),
    getRegisteredExecutionIdentity: () => identity, getRuntime: () => runtime, revalidateBeforeStart: vi.fn(async () => undefined),
    subscribe: () => () => undefined, closeObserver: async () => undefined,
    start, stop, stopOwnedForRecovery: stop } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(manager), store = new JsonOperationStore(manager);
  const ops = new OperationService(store, clock, journal);
  const completed = new Set<string>(), listeners = new Map<string, () => void>(), save = store.save.bind(store);
  store.save = async record => {
    await save(record);
    if (record.operation.serverId === serverId && ["succeeded", "failed", "interrupted"].includes(record.operation.state)) {
      completed.add(record.operation.id); listeners.get(record.operation.id)?.();
    }
  };
  const settle = async () => {
    const id = ops.getServerState(serverId).activeOperationId;
    if (id !== null) await new Promise<void>(resolve => {
      const finish = () => { setImmediate(() => {
        if (ops.getServerState(serverId).activeOperationId === null) { listeners.delete(id); resolve(); }
      }); };
      listeners.set(id, finish); if (completed.has(id)) finish();
    });
    expect(ops.getServerState(serverId).activeOperationId).toBeNull();
  };
  await ops.initialize();
  const states = new ActiveWorldStateStore(manager, [adapter]); await states.initialize();
  const library = new WorldLibraryStore(manager, clock), binding = { serverId, rootPath: server };
  await library.migrateLegacy(binding, states.snapshot(serverId)!);
  const backups = new BackupService(registry, ops, journal, manager, clock);
  const creator = new WorldCreateService(registry, ops, journal, backups, manager, states, clock, undefined, { library });
  const owners: Array<{ close(): Promise<void> }> = [creator];
  cleanupOwners.set(root, async () => { for (const owner of owners) await owner.close(); });
  const plan = await new WorldCreatePlanService(registry, ops).plan(serverId, { name: "NewWorld", seed: "17" });
  const body = { name: "NewWorld", seed: "17", allowStop: false, worldRevision: plan.worldRevision!, confirmWorldName: "world" };
  const hasSettled = (id: string) => completed.has(id);
  const parent = prepareVia
    ? await prepareVia({ adapter, manager, store, journal, states, body, own: owner => owners.push(owner), hasSettled })
    : await creator.create(serverId, body, randomUUID());
  await settle(); await creator.close();
  const prepared = await (prepareVia ? new WorldLibraryStore(manager, clock) : library).readPreparedGeneration(binding, journal);
  const target = { preparationOperationId: parent.id, preparationTransactionId: prepared.record.transactionId,
    worldId: prepared.reservation.worldId, preparedRecordDigest: prepared.recordDigest,
    registeredExecutionDigest: createHash("sha256").update(JSON.stringify(identity)).digest("hex") };
  const service = new WorldGenerationService(registry, ops, journal, backups, manager, library, store, publishCatalog);
  owners.push(service);
  return { root, manager, server, serverId, adapter, runtime, registry, store, ops, library, journal, service, target, start, stop, settle,
    observation: () => observation, binding, states, backups, hasSettled };
}

describe("unmounted controlled generation with Fake owned runtime", () => {
  it("rejects a target when registration identity mutates in place during verification", async () => {
    const f = await fixture();
    const identity = f.adapter.getRegisteredExecutionIdentity!()!;
    const receipts = await f.store.list();
    const journal = await f.journal.scan();
    const status = f.adapter.getStatus.bind(f.adapter);
    vi.spyOn(f.adapter, "getStatus").mockImplementation(async () => {
      Object.assign(identity, { javaSha256: "9".repeat(64) });
      return status();
    });
    await expect(f.service.executionTarget(f.serverId, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(identity.javaSha256).toBe("9".repeat(64));
    expect(await f.store.list()).toEqual(receipts);
    expect((await f.journal.scan()).records).toEqual(journal.records);
    expect(existsSync(path.join(f.server, "NewWorld"))).toBe(false);
  });
  it.each([false, true])("validates authenticated HTTP generation (same Manager=%s)", async live => {
    const sessions = new SessionCore(() => 0);
    const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin",
      revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
      { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
    const token = sessions.create("local-http");
    const openApp = (input: { adapter: LocalMinecraftServerAdapter; store: JsonOperationStore;
      journal: TransactionJournalStore; manager: string; states: ActiveWorldStateStore }) =>
      buildApp({ mode: "local", adapters: [input.adapter], clock, authentication,
      operationStore: input.store, transactionJournal: input.journal, managerRoot: input.manager, activeWorldState: input.states,
      worldGenerationPreparation: true, worldGenerationExecution: true, backupSchedulerTimers: false });
    const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000",
      "x-manager-intent": "local-ui", "idempotency-key": randomUUID(),
      cookie: `mcsm_local_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken };
    let liveApp: ReturnType<typeof buildApp> | undefined;
    const f = await fixture(false, live ? async input => {
      liveApp = openApp(input);
      input.own(liveApp);
      const prepared = await liveApp.inject({ method: "POST", url: `/api/v1/servers/${input.adapter.serverId}/worlds`,
        headers: { ...headers, "idempotency-key": randomUUID() }, payload: input.body });
      expect(prepared.statusCode, JSON.stringify(prepared.json().error)).toBe(202);
      const operation = prepared.json().data.operation;
      await vi.waitFor(() => expect(input.hasSettled(operation.id)).toBe(true));
      const { operation: current } = await input.store.read(operation.id);
      const detail = current.state === "interrupted" || current.state === "failed"
        ? JSON.stringify({ step: current.step, code: current.error?.code, checkpoints: (await input.journal.scan()).records
          .filter(record => record.intent.operationId === operation.id).flatMap(record => record.checkpoints.map(item => item.name)) })
        : current.step;
      expect(current.state, detail).toBe("succeeded");
      return operation;
    } : undefined);
    const app = liveApp ?? openApp(f);
    try {
      const targetUrl = `/api/v1/servers/${f.serverId}/worlds/generation-target`;
      const deniedFinalize = await app.inject({ method: "POST",
        url: `/api/v1/servers/${f.serverId}/worlds/generation-finalize`,
        headers: { ...headers, "x-csrf-token": "invalid" },
        payload: { executionOperationId: randomUUID() } });
      expect(deniedFinalize.statusCode).toBe(403);
      const denied = await app.inject({ method: "POST", url: targetUrl, headers: { ...headers, "x-csrf-token": "invalid" }, payload: {} });
      expect(denied.statusCode).toBe(403);
      const target = await app.inject({ method: "POST", url: targetUrl, headers, payload: {} });
      expect(target.statusCode).toBe(200);
      expect(target.headers["cache-control"]).toBe("no-store");
      expect(target.json().data).toEqual(f.target);
      const request = { method: "POST" as const, url: `/api/v1/servers/${f.serverId}/worlds/generate`,
        headers, payload: target.json().data };
      const response = await app.inject(request);
      if (live) {
        expect(response.statusCode, JSON.stringify(response.json().error)).toBe(202);
        const id = response.json().data.operation.id;
        await vi.waitFor(() => expect(f.hasSettled(id)).toBe(true), { timeout: 3000 });
        const operation = (await f.store.read(id)).operation;
        expect(operation.state, JSON.stringify({ step: operation.step, error: operation.error,
          started: f.start.mock.calls.length, stopped: f.stop.mock.calls.length })).toBe("succeeded");
        const replay = await app.inject(request);
        expect(replay.statusCode).toBe(202);
        expect(replay.json().data.operation.id).toBe(response.json().data.operation.id);
        expect(f.start).toHaveBeenCalledOnce();
        expect(f.stop).toHaveBeenCalledOnce();
        const reader = new WorldLibraryStore(f.manager, clock);
        const evidence = await reader.readPublishedGenerationEvidence(f.binding, f.journal, f.store);
        expect(evidence.birth.value.execution.executionOperationId).toBe(id);
        expect(evidence.birth.value.execution.worldId).toBe(f.target.worldId);
        const library = await app.inject({ url: `/api/v1/servers/${f.serverId}/world-library`, headers });
        expect(library.statusCode).toBe(200);
        expect(library.json().data).toMatchObject({ state: "inspection-required", mutationsAvailable: false });
        expect(library.json().data.items).toContainEqual(expect.objectContaining({ worldId: f.target.worldId, origin: "generation" }));
        return;
      }
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({
        code: "RECOVERY_REQUIRED", details: { reason: "generation-owner-unverified" }
      });
      expect(f.start).not.toHaveBeenCalled();
      expect(f.stop).not.toHaveBeenCalled();
    } finally {
      await f.service.close();
      await app.close();
    }
  });
  it("publishes the same generated UUID as a pending entry without promoting the legacy slot", async () => {
    const f = await fixture(true), operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect((await f.store.list()).find(item => item.operation.id === operation.id)?.operation.state).toBe("succeeded");
    const snapshot = f.states.snapshot(f.serverId)!;
    expect(snapshot.state).toBe("pending-generation");
    const listed = await f.library.list(f.binding, snapshot, { journal: f.journal, receipts: f.store });
    expect(listed.state).toBe("inspection-required"); expect(listed.activeWorldId).toBeNull(); expect(listed.mutationsAvailable).toBe(false);
    expect(listed.items).toHaveLength(2); expect(listed.items[1]).toMatchObject({ worldId: f.target.worldId, origin: "generation", legacySlotId: null });
    await expect(f.library.readPreparedGeneration(f.binding, f.journal)).rejects.toThrow();
    expect((await f.library.list(f.binding, snapshot)).items).toHaveLength(0);
    await f.service.close();
  });
  it("seals before one start, stops the exact child and retains candidate/recovery without publication", async () => {
    const f = await fixture(), key = randomUUID();
    const operation = await f.service.generate(f.serverId, key, f.target, () => undefined); await f.settle();
    const raw = (await f.store.list()).find(record => record.operation.id === operation.id)!;
    expect(raw.operation.state).toBe("succeeded"); expect(f.start).toHaveBeenCalledOnce(); expect(f.stop).toHaveBeenCalledOnce();
    expect(f.observation()).toMatchObject({ ownerOperationId: operation.id, exited: true, closed: true, exitCode: 0 });
    const seal = await f.library.readGenerationExecutionSeal(f.binding, f.journal, f.store);
    expect(seal.execution.executionOperationId).toBe(operation.id);
    const birth = await f.library.readGenerationBirth(f.binding, f.journal, f.store);
    expect(birth.inspectionOnly).toBe(true); expect(birth.value.execution.worldId).toBe(f.target.worldId);
    expect(birth.value.launchId).toBe(f.observation()?.launchId);
    expect(f.ops.get(operation.id)?.state).toBe("interrupted"); expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(JSON.parse(await readFile(path.join(f.manager, "world-library", f.serverId, "state.json"), "utf8")).entries).toHaveLength(1);
    const replay = await f.service.generate(f.serverId, key, f.target, () => undefined); expect(replay.id).toBe(operation.id);
    expect(f.start).toHaveBeenCalledOnce(); await f.service.close();
  });
  it("rejects wrong registered identity before creating an execution receipt", async () => {
    const f = await fixture();
    await expect(f.service.generate(f.serverId, randomUUID(), { ...f.target, registeredExecutionDigest: "0".repeat(64) }, () => undefined)).rejects.toThrow();
    expect(await f.store.list()).toHaveLength(1); expect(f.start).not.toHaveBeenCalled(); await f.service.close();
  });
  it("rechecks absence after revalidation and never starts over an external target", async () => {
    const f = await fixture(); vi.spyOn(f.adapter, "revalidateBeforeStart").mockImplementation(async () => { await mkdir(path.join(f.server, "NewWorld")); });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect(f.start).not.toHaveBeenCalled(); expect(f.ops.get(operation.id)?.state).toBe("interrupted"); await f.service.close();
  });
  it("cleans an owned failed-readiness child without reporting generation success", async () => {
    const f = await fixture(), original = f.start.getMockImplementation()!;
    f.start.mockImplementation(async ctx => { await original(ctx); Object.assign(f.observation()!, { ready: false }); throw new Error("not ready"); });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect(f.stop).toHaveBeenCalledOnce(); expect(f.observation()).toMatchObject({ exited: true, closed: true });
    expect((await f.store.list()).find(record => record.operation.id === operation.id)?.operation.state).not.toBe("succeeded"); await f.service.close();
  });
  it("releases cleanup for abnormal exit but never accepts its candidate", async () => {
    const f = await fixture(), original = f.stop.getMockImplementation()!;
    f.stop.mockImplementation(async (ctx, owner) => { await original(ctx, owner); Object.assign(f.observation()!, { exitCode: 2 }); });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect((await f.store.list()).find(record => record.operation.id === operation.id)?.operation.state).not.toBe("succeeded"); await f.service.close();
  });
  it("retains owner on lost observation and close reports CLEANUP_BLOCKED", async () => {
    const f = await fixture(), original = f.start.getMockImplementation()!;
    f.start.mockImplementation(async ctx => { await original(ctx); f.runtime.getOwnedLaunchObservation.mockReturnValue(null); });
    await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect(f.stop).not.toHaveBeenCalled();
    vi.useFakeTimers();
    try { const closing = expect(f.service.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" }); await vi.advanceTimersByTimeAsync(5001); await closing; }
    finally { vi.useRealTimers(); }
    deliberatelyBlocked.add(f.root);
  });
  it("revocation during revalidation prevents start after seal", async () => {
    const f = await fixture(); let allowed = true;
    vi.spyOn(f.adapter, "revalidateBeforeStart").mockImplementation(async () => { allowed = false; });
    await f.service.generate(f.serverId, randomUUID(), f.target, () => { if (!allowed) throw new Error("revoked"); }); await f.settle();
    expect(f.start).not.toHaveBeenCalled(); expect(await f.store.list()).toHaveLength(2); await f.service.close();
  });
  it("revocation at the spawn boundary preserves recovery and releases the no-child owner", async () => {
    const f = await fixture(), start = f.start.getMockImplementation()!;
    let allowed = true;
    f.start.mockImplementation(async context => {
      allowed = false;
      await start(context);
    });
    await f.service.generate(f.serverId, randomUUID(), f.target, () => {
      if (!allowed) throw new Error("revoked");
      return undefined;
    });
    await f.settle();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.observation()).toBeNull();
    expect(f.stop).not.toHaveBeenCalled();
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    await f.service.close();
  });
  it("closes cleanly when startup is aborted before reaching spawn admission", async () => {
    const f = await fixture();
    let entered!: () => void;
    const preparing = new Promise<void>(resolve => { entered = resolve; });
    f.start.mockImplementation(async ({ signal }) => {
      entered();
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new Error("startup preparation aborted");
    });
    await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined);
    await preparing;
    await f.service.close();
    await f.settle();
    expect(f.observation()).toBeNull();
    expect(f.stop).not.toHaveBeenCalled();
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("refuses generation on a runtime without spawn admission support", async () => {
    const f = await fixture();
    const key = randomUUID(), records = await f.store.list();
    Object.assign(f.runtime, { supportsSpawnAdmission: undefined });
    await expect(f.service.generate(f.serverId, key, f.target, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(f.start).not.toHaveBeenCalled();
    expect(await f.store.list()).toEqual(records);
    Object.assign(f.runtime, { supportsSpawnAdmission: true });
    await f.service.generate(f.serverId, key, f.target, () => undefined);
    await f.settle();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
    await f.service.close();
  });
  it("does not dispatch when the final execution seal belongs to another operation", async () => {
    const f = await fixture();
    const read = f.library.readGenerationExecutionSeal.bind(f.library);
    const check = vi.spyOn(f.library, "readGenerationExecutionSeal").mockImplementation(async (...args) => {
      const seal = await read(...args);
      return { ...seal, execution: { ...seal.execution, executionOperationId: randomUUID() } };
    });
    await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined);
    await f.settle();
    expect(check).toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    await f.service.close();
  });
  it.each(["terminal-receipt", "queued-receipt", "target-appears"])("blocks dispatch on late %s", async fault => {
    const f = await fixture();
    const read = f.library.readGenerationExecutionSeal.bind(f.library);
    const list = f.store.list.bind(f.store);
    let injected = false;
    vi.spyOn(f.library, "readGenerationExecutionSeal").mockImplementationOnce(async (...args) => {
      const seal = await read(...args);
      if (fault === "target-appears") await mkdir(path.join(f.server, "NewWorld"));
      else {
        const listing = vi.spyOn(f.store, "list");
        if (fault === "queued-receipt") listing.mockImplementationOnce(list);
        listing.mockImplementationOnce(async () => (await list()).map(record =>
          record.operation.id === seal.execution.executionOperationId
            ? { ...record, operation: { ...record.operation, state: fault === "queued-receipt" ? "queued" : "succeeded" } } : record));
      }
      injected = true;
      return seal;
    });
    await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined);
    await f.settle();
    expect(injected).toBe(true);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.stop).not.toHaveBeenCalled();
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(existsSync(path.join(f.manager, "world-library", `${f.serverId}.generation-birth.json`))).toBe(false);
    await f.service.close();
  });
  it("receipt failure during stop does not prevent owned cleanup or become successful", async () => {
    const f = await fixture(), save = f.store.save.bind(f.store); let failed = false;
    vi.spyOn(f.store, "save").mockImplementation(async record => {
      if (!failed && record.operation.step === "test-owned-stop") { failed = true; throw new Error("receipt unavailable"); }
      await save(record);
    });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect(failed).toBe(true); expect(f.observation()).toMatchObject({ exited: true, closed: true });
    expect((await f.store.list()).find(record => record.operation.id === operation.id)?.operation.state).not.toBe("succeeded"); await f.service.close();
  });
  it("close aborts readiness but uses an independent valid signal for owned cleanup", async () => {
    const f = await fixture(), original = f.start.getMockImplementation()!;
    f.start.mockImplementation(async ctx => {
      await original(ctx); Object.assign(f.observation()!, { ready: false });
      await new Promise<void>(resolve => { if (ctx.signal.aborted) resolve(); else ctx.signal.addEventListener("abort", () => resolve(), { once: true }); });
      throw new Error("readiness canceled");
    });
    await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined);
    await vi.waitFor(() => expect(f.observation()).not.toBeNull());
    await f.service.close(); await f.settle();
    expect(f.stop).toHaveBeenCalledOnce(); expect(f.stop.mock.calls[0]![0].signal.aborted).toBe(false);
    expect(f.observation()).toMatchObject({ exited: true, closed: true });
  });
  it("runtime replacement cannot redirect cleanup away from the captured child", async () => {
    const f = await fixture(), original = f.start.getMockImplementation()!;
    f.start.mockImplementation(async ctx => { await original(ctx); vi.spyOn(f.adapter, "getRuntime").mockReturnValue({} as never); });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect(f.stop).toHaveBeenCalledOnce(); expect(f.observation()).toMatchObject({ exited: true, closed: true });
    expect((await f.store.list()).find(record => record.operation.id === operation.id)?.operation.state).not.toBe("succeeded"); await f.service.close();
  });
  it("waits for actual close after stop returns and rejects post-run source changes", async () => {
    const f = await fixture(), original = f.stop.getMockImplementation()!;
    f.stop.mockImplementation(async (ctx, owner) => {
      await original(ctx, owner); Object.assign(f.observation()!, { closed: false });
      await writeFile(path.join(f.server, "world", "external.txt"), "changed");
      setTimeout(() => Object.assign(f.observation()!, { closed: true }), 50);
    });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect(f.observation()?.closed).toBe(true);
    expect((await f.store.list()).find(record => record.operation.id === operation.id)?.operation.state).not.toBe("succeeded"); await f.service.close();
  });
  it("retains recovery when the active slot is replaced with identical bytes after owned stop", async () => {
    const f = await fixture(), original = f.stop.getMockImplementation()!;
    const active = path.join(f.manager, "active-worlds", `${f.serverId}.json`);
    const originalBytes = await readFile(active);
    f.stop.mockImplementation(async (ctx, owner) => {
      await original(ctx, owner);
      await rename(active, active + ".retained");
      await writeFile(active, originalBytes, { flag: "wx" });
    });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined);
    await f.settle();
    expect(f.observation()).toMatchObject({ exited: true, closed: true });
    expect((await f.store.read(operation.id)).operation).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(await readFile(active)).toEqual(originalBytes);
    expect(await readFile(active + ".retained")).toEqual(originalBytes);
    await f.service.close();
  });
  it("retains recovery when the preparation workspace is replaced after owned stop", async () => {
    const f = await fixture(), original = f.stop.getMockImplementation()!;
    const prepared = await f.library.readPreparedGeneration(f.binding, f.journal);
    const workspace = path.join(f.server, prepared.record.intent.worldChange!.workspaceName);
    const retained = workspace + ".retained";
    f.stop.mockImplementation(async (ctx, owner) => {
      await original(ctx, owner);
      await rename(workspace, retained);
      await mkdir(workspace);
      await rename(path.join(retained, "properties.before"), path.join(workspace, "properties.before"));
    });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined);
    await f.settle();
    expect(f.observation()).toMatchObject({ exited: true, closed: true });
    expect((await f.store.read(operation.id)).operation).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(await readdir(retained)).toEqual([]);
    expect(await readdir(workspace)).toEqual(["properties.before"]);
    await f.service.close();
  });
  it("does not resend stop after an error when actual exit and close are already confirmed", async () => {
    const f = await fixture(), original = f.stop.getMockImplementation()!;
    f.stop.mockImplementation(async (ctx, owner) => { await original(ctx, owner); throw new Error("stop acknowledgment lost"); });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect(f.stop).toHaveBeenCalledOnce(); expect(f.observation()).toMatchObject({ exited: true, closed: true });
    expect((await f.store.list()).find(record => record.operation.id === operation.id)?.operation.state).not.toBe("succeeded"); await f.service.close();
  });
  it("refuses startup if the old source changes after execution was sealed", async () => {
    const f = await fixture();
    vi.spyOn(f.adapter, "revalidateBeforeStart").mockImplementation(async () => {
      await writeFile(path.join(f.server, "world", "level.dat"), testWorldLevel("external", true, 5023));
    });
    await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect(f.start).not.toHaveBeenCalled(); await f.service.close();
  });
  it("accepts only the observed vanilla timestamp rewrite after exact owned normal stop", async () => {
    const f = await fixture(), original = f.start.getMockImplementation()!;
    f.start.mockImplementation(async ctx => {
      await original(ctx); const config = path.join(f.server, "server.properties");
      await writeFile(config, (await readFile(config, "utf8")).replace("21:36:46", "21:37:08"));
    });
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
    expect((await f.store.list()).find(record => record.operation.id === operation.id)?.operation.state).toBe("succeeded");
    expect(f.ops.get(operation.id)?.state).toBe("interrupted"); await f.service.close();
  });
});

async function currentStateFixture() {
  const f = await fixture(true), operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
  expect((await f.store.list()).find(item => item.operation.id === operation.id)?.operation.state).toBe("succeeded");
  await f.service.close();
  return { ...f, operation, verify: () => verifyGenerationCurrentState(f.registry, f.manager, f.library, f.journal, f.store, f.backups, f.serverId) };
}

function slotPaths(f: Awaited<ReturnType<typeof currentStateFixture>>) {
  const prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-slot`);
  return { slot: path.join(f.manager, "active-worlds", `${f.serverId}.json`), stage: prefix + ".tmp", intent: prefix + ".json", completion: prefix + ".completion.json" };
}
describe("unmounted generation slot CAS primitive", () => {
  it("rejects a fixed stage reappearing after rename and retains all uncertain evidence", async () => {
    const f = await currentStateFixture(), files = slotPaths(f);
    await expect(commitGenerationSlot(f.manager, await f.verify(), async () => {
      const proof = await f.verify();
      if (proof.slot.state === "active") await writeFile(files.stage, "uncertain recreated stage");
      return proof;
    }, () => undefined)).rejects.toThrow();
    expect(JSON.parse(await readFile(files.slot, "utf8")).state).toBe("active");
    expect(existsSync(files.intent)).toBe(true); expect(existsSync(files.stage)).toBe(true);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("rejects caller-mutated proof fields before creating any stage or intent", async () => {
    const f = await currentStateFixture(), initial = await f.verify();
    const directory = path.join(f.manager, "active-worlds"), before = await readdir(directory), files = slotPaths(f), bytes = await readFile(files.slot);
    initial.operationId = randomUUID();
    await expect(commitGenerationSlot(f.manager, initial, f.verify, () => undefined)).rejects.toThrow();
    expect(await readdir(directory)).toEqual(before); expect(await readFile(files.slot)).toEqual(bytes);
  });
  it.each(["stage", "intent"])("rejects a same-byte %s replacement before first private readback", async which => {
    const f = await currentStateFixture(), files = slotPaths(f); let swapped = false;
    await expect(commitGenerationSlot(f.manager, await f.verify(), f.verify, () => {
      const file = which === "stage" ? files.stage : files.intent;
      if (!swapped && existsSync(file)) {
        swapped = true; const bytes = readFileSync(file); renameSync(file, file + ".retained"); writeFileSync(file, bytes);
      }
      return undefined;
    })).rejects.toThrow();
    expect(swapped).toBe(true); expect(JSON.parse(await readFile(files.slot, "utf8")).state).toBe("pending-generation");
    expect(existsSync(files.stage)).toBe(true);
  });
  it("preserves non-slot control identity across the CAS instead of dropping the controls digest", async () => {
    const f = await currentStateFixture(), initial = await f.verify();
    const prepared = await f.library.readPublishedGenerationPreparation(f.binding, f.journal, f.store);
    const file = path.join(f.server, prepared.record.intent.worldChange!.workspaceName, "properties.before"), bytes = await readFile(file);
    let after: Awaited<ReturnType<typeof f.verify>> | undefined;
    await expect(commitGenerationSlot(f.manager, initial, async () => {
      const current = await f.verify(); if (current.slot.state !== "active") return current;
      await rename(file, path.join(f.root, "original.properties.before")); await writeFile(file, bytes);
      after = await f.verify(); return after;
    }, () => undefined)).rejects.toThrow();
    expect(after?.slot.state).toBe("active"); expect(after?.nonSlotControlsDigest).not.toBe(initial.nonSlotControlsDigest);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("installs only the staged active slot, retaining intent, receipts and both recovery gates", async () => {
    const f = await currentStateFixture(), files = slotPaths(f), receipts = await f.store.list();
    const result = await commitGenerationSlot(f.manager, await f.verify(), f.verify, () => undefined);
    expect(result).toMatchObject({ slotState: "active", inspectionOnly: true, recoveryRequired: true, worldId: f.target.worldId });
    expect(JSON.parse(await readFile(files.slot, "utf8")).state).toBe("active"); expect(existsSync(files.stage)).toBe(false);
    expect(existsSync(files.intent)).toBe(true); expect(await f.store.list()).toEqual(receipts);
    expect(f.states.snapshot(f.serverId)?.state).toBe("pending-generation"); expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    const installed = await readFile(files.slot), intent = await readFile(files.intent);
    expect((await commitGenerationSlot(f.manager, await f.verify(), f.verify, () => undefined)).slot).toEqual(result.slot);
    expect(await readFile(files.slot)).toEqual(installed); expect(await readFile(files.intent)).toEqual(intent);
    expect(f.start).toHaveBeenCalledOnce();
  });
  it("never reuses an orphan stage without a durable intent", async () => {
    const f = await currentStateFixture(), files = slotPaths(f), original = await readFile(files.slot);
    await expect(commitGenerationSlot(f.manager, await f.verify(), f.verify, () => {
      if (existsSync(files.stage)) throw new Error("simulated interruption before intent"); return undefined;
    })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(existsSync(files.stage)).toBe(true); expect(existsSync(files.intent)).toBe(false);
    await expect(commitGenerationSlot(f.manager, await f.verify(), f.verify, () => undefined)).rejects.toThrow();
    expect(await readFile(files.slot)).toEqual(original); expect(existsSync(files.stage)).toBe(true);
  });
  it("explicitly resumes an intact pre-rename intent and stage after a fresh proof", async () => {
    const f = await currentStateFixture(), files = slotPaths(f), original = await readFile(files.slot);
    await expect(commitGenerationSlot(f.manager, await f.verify(), f.verify, () => {
      if (existsSync(files.intent)) throw new Error("simulated interruption before rename"); return undefined;
    })).rejects.toThrow();
    expect(await readFile(files.slot)).toEqual(original); expect(existsSync(files.stage)).toBe(true);
    expect((await commitGenerationSlot(f.manager, await f.verify(), f.verify, () => undefined)).slotState).toBe("active");
  });
  it("confirms an installed stage after post-rename verification loss without performing another rename", async () => {
    const f = await currentStateFixture(), files = slotPaths(f);
    await expect(commitGenerationSlot(f.manager, await f.verify(), async () => {
      const proof = await f.verify(); if (proof.slot.state === "active") throw new Error("lost final observation"); return proof;
    }, () => undefined)).rejects.toThrow();
    const after = await f.verify(); expect(after.slot.state).toBe("active"); expect(existsSync(files.stage)).toBe(false);
    expect((await commitGenerationSlot(f.manager, after, f.verify, () => undefined)).slot.identity).toBe(after.slot.identity);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it.each(["stage-replaced", "slot-replaced", "world-changed", "receipt-changed", "intent-corrupt"])("retains evidence instead of committing %s", async scenario => {
    const f = await currentStateFixture(), files = slotPaths(f);
    await expect(commitGenerationSlot(f.manager, await f.verify(), f.verify, () => {
      if (existsSync(files.intent)) throw new Error("pause with durable intent"); return undefined;
    })).rejects.toThrow();
    if (scenario === "stage-replaced" || scenario === "slot-replaced") {
      const file = scenario === "stage-replaced" ? files.stage : files.slot, bytes = await readFile(file);
      await rename(file, file + ".retained"); await writeFile(file, bytes);
    }
    if (scenario === "world-changed") await writeFile(path.join(f.server, "NewWorld", "later.dat"), "external change");
    if (scenario === "receipt-changed") {
      const record = (await f.store.list()).find(value => value.operation.id === f.operation.id)!;
      await f.store.save({ ...record, operation: { ...record.operation, updatedAt: "2026-10-29T18:00:00Z" } });
    }
    if (scenario === "intent-corrupt") await writeFile(files.intent, "{incomplete");
    await expect(commitGenerationSlot(f.manager, await f.verify(), f.verify, () => undefined)).rejects.toThrow();
    expect(JSON.parse(await readFile(files.slot, "utf8")).state).toBe("pending-generation");
    expect(existsSync(files.stage)).toBe(true); expect(existsSync(files.intent)).toBe(true);
  });
  it("does not claim an external active slot without the CAS intent", async () => {
    const f = await currentStateFixture(), files = slotPaths(f), before = JSON.parse(await readFile(files.slot, "utf8"));
    await writeFile(files.slot, JSON.stringify({ ...before, state: "active" }) + "\n");
    await expect(commitGenerationSlot(f.manager, await f.verify(), f.verify, () => undefined)).rejects.toThrow();
    expect(existsSync(files.stage)).toBe(false); expect(existsSync(files.intent)).toBe(false);
  });
});
describe("read-only published generation current-state proof", () => {
  it("never downgrades a global startup directory failure to protected generation", async () => {
    const f = await currentStateFixture(), states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const initialize = () => states.initialize(undefined, undefined, undefined, undefined, undefined, new Set([f.serverId]));
    await initialize(); expect(states.protectedGenerationRecovery(f.serverId)).not.toBeNull();
    const directory = path.join(f.manager, "active-worlds"), retained = directory + ".retained";
    await rename(directory, retained); await writeFile(directory, "not a directory");
    await expect(initialize()).rejects.toThrow(); expect(states.protectedGenerationRecovery(f.serverId)).toBeNull();
    await rm(directory); await rename(retained, directory);
    expect((await initialize()).has(f.serverId)).toBe(true); expect(states.protectedGenerationRecovery(f.serverId)).toBeNull();
  });
  it("verifies pending and exact active shapes without changing files, receipts or recovery gates", async () => {
    const f = await currentStateFixture(), slot = path.join(f.manager, "active-worlds", `${f.serverId}.json`);
    const before = await readFile(slot), receipts = await f.store.list();
    const proof = await f.verify(); expect(proof.worldId).toBe(f.target.worldId); expect(proof.slot.state).toBe("pending-generation");
    proof.slot.checksum = "0".repeat(64); await proof.recheck();
    expect(await readFile(slot)).toEqual(before); expect(await f.store.list()).toEqual(receipts);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    await writeFile(slot, JSON.stringify({ ...JSON.parse(before.toString("utf8")), state: "active" }) + "\n");
    expect((await f.verify()).slot.state).toBe("active"); expect(f.start).toHaveBeenCalledOnce();
  });
  it("uses exact post-stop properties, never a new timestamp rewrite exemption", async () => {
    const f = await currentStateFixture(), file = path.join(f.server, "server.properties");
    const value = await readFile(file, "utf8"); await writeFile(file, value.replace("21:36:46", "21:37:08"));
    await expect(f.verify()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("rejects tree drift during observation and rejects later drift on proof recheck", async () => {
    const f = await currentStateFixture(), proof = await f.verify();
    await writeFile(path.join(f.server, "NewWorld", "later.dat"), "new file"); await expect(proof.recheck()).rejects.toThrow();
    let calls = 0; vi.spyOn(f.adapter, "getStatus").mockImplementation(async () => {
      if (++calls === 3) await writeFile(path.join(f.server, "NewWorld", "during.dat"), "drift");
      return { state: "stopped", ownership: "none", recoveryRequired: false } as never;
    });
    await expect(f.verify()).rejects.toThrow();
  });
  it.each(["birth", "parent-receipt", "execution-receipt", "level", "runtime", "registration"])("rejects missing or unsafe %s evidence", async scenario => {
    const f = await currentStateFixture();
    if (scenario === "birth") await rm(path.join(f.manager, "world-library", `${f.serverId}.generation-birth.json`));
    if (scenario === "parent-receipt" || scenario === "execution-receipt") await rm(path.join(f.manager, "operations", `${scenario === "parent-receipt" ? f.target.preparationOperationId : f.operation.id}.json`));
    if (scenario === "level") await writeFile(path.join(f.server, "NewWorld", "level.dat"), testWorldLevel("changed", true, 5023));
    if (scenario === "runtime") vi.spyOn(f.adapter, "getStatus").mockResolvedValue({ state: "unknown", ownership: "unknown", recoveryRequired: true } as never);
    if (scenario === "registration") vi.spyOn(f.adapter, "getRegisteredExecutionIdentity").mockReturnValue({} as never);
    await expect(f.verify()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("classifies only protected pending startup without promoting it or clearing unknown recovery", async () => {
    const f = await currentStateFixture(), states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.json`), before = await readFile(file);
    const recovery = await states.initialize(undefined, undefined, undefined, undefined, undefined, new Set([f.serverId]));
    expect(recovery.has(f.serverId)).toBe(true); expect(await readFile(file)).toEqual(before);
    const protection = states.protectedGenerationRecovery(f.serverId)!; expect(protection.kind).toBe("protected-pending-generation");
    const proof = await verifyGenerationCurrentState(f.registry, f.manager, f.library, f.journal, f.store, f.backups, f.serverId, protection);
    expect(proof.slot.state).toBe("pending-generation");
    protection.slotChecksum = "0".repeat(64);
    expect(states.protectedGenerationRecovery(f.serverId)?.slotChecksum).not.toBe(protection.slotChecksum);
    await proof.recheck();
    await expect(verifyGenerationCurrentState(f.registry, f.manager, f.library, f.journal, f.store, f.backups, f.serverId, protection)).rejects.toThrow();
    await writeFile(file, "{}"); await states.initialize(undefined, undefined, undefined, undefined, undefined, new Set([f.serverId]));
    expect(states.protectedGenerationRecovery(f.serverId)).toBeNull();
    await writeFile(file, before); await states.initialize(undefined, undefined, undefined, undefined, undefined, new Set([f.serverId]));
    expect(states.protectedGenerationRecovery(f.serverId)).toBeNull();
  });
  it("binds receipt snapshots and refuses unsupported new dimensions", async () => {
    const f = await currentStateFixture(), proof = await f.verify();
    const record = (await f.store.list()).find(item => item.operation.id === f.operation.id)!;
    await f.store.save({ ...record, operation: { ...record.operation, state: "interrupted", step: "recovery-required" } });
    await expect(proof.recheck()).rejects.toThrow();
    await mkdir(path.join(f.server, "NewWorld", "dimensions", "unknown", "extra"), { recursive: true });
    await writeFile(path.join(f.server, "NewWorld", "dimensions", "unknown", "extra", "file.dat"), "unsupported");
    await expect(f.verify()).rejects.toThrow();
  });
});

describe("published generation finalization", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  let operationId: string;
  beforeEach(async () => {
    f = await fixture(true);
    const operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined);
    await f.settle();
    operationId = operation.id;
  }, 5000);
  it("finalizes a published generated world through the real metadata writers", async () => {
    const phases: { phase: string; durationMs: number; completed: boolean }[] = [];
    const methods = ["sealPublishedCompletion", "sealPublishedGenesis", "sealPublishedGenesisReference", "publishInitialMaturity"] as const;
    for (const method of methods) {
      const original = f.service[method].bind(f.service);
      vi.spyOn(f.service, method).mockImplementation((async (...args: unknown[]) => {
        const started = performance.now();
        const sample = { phase: method, durationMs: 0, completed: false };
        phases.push(sample);
        try {
          const result = await (original as (...values: unknown[]) => Promise<unknown>)(...args);
          sample.completed = true;
          return result;
        } finally {
          sample.durationMs = performance.now() - started;
          await writeFile(new URL("../../../test-results/worlds-v2-finalizer-phase-timing.json", import.meta.url),
            JSON.stringify({ clock: "node-performance-monotonic", phases }) + "\n");
        }
      }) as never);
    }
    const result = await f.service.finalizePublishedGeneration(f.serverId, operationId, () => undefined);
    expect(result).toMatchObject({ worldId: f.target.worldId, catalogPublicationVerified: true, recoveryRequired: true });
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("retains installed slot and completion when continuation is interrupted", async () => {
    const complete = completionWriter.sealGenerationCompletion;
    vi.spyOn(completionWriter, "sealGenerationCompletion").mockImplementation(async (...args) => {
      await complete(...args);
      throw new Error("injected phase interruption");
    });
    await expect(f.service.finalizePublishedGeneration(f.serverId, operationId, () => undefined))
      .rejects.toThrow("injected phase interruption");
    const slot = path.join(f.manager, "active-worlds", f.serverId + ".json");
    const completion = path.join(f.manager, "active-worlds", `${f.serverId}.${operationId}.generation-slot.completion.json`);
    const before = await Promise.all([readFile(slot), readFile(completion)]);
    await expect(f.service.finalizePublishedGeneration(f.serverId, operationId, () => undefined))
      .rejects.toThrow("injected phase interruption");
    expect(await Promise.all([readFile(slot), readFile(completion)])).toEqual(before);
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("finalizes through HTTP with a real local session and CSRF", async () => {
    const began = performance.now();
    const phases: { phase: string; elapsedMs: number }[] = [];
    const mark = async (phase: string) => {
      phases.push({ phase, elapsedMs: performance.now() - began });
      await writeFile(new URL("../../../test-results/worlds-v2-http-finalizer-timing.json", import.meta.url),
        JSON.stringify({ clock: "node-performance-monotonic", phases }) + "\n");
    };
    const sessions = new SessionCore(() => 0);
    const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin",
      revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
      { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
    const token = sessions.create("local-http");
    const app = Fastify();
    authentication.install(app, clock, "local");
    registerWorldGenerationRoute(app, f.service, clock, "local", authentication);
    await app.ready();
    await mark("http-ready");
    try {
      await mark("request-begin");
      const response = await app.inject({ method: "POST",
        url: `/api/v1/servers/${f.serverId}/worlds/generation-finalize`,
        headers: { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000",
          "x-manager-intent": "local-ui", cookie: `mcsm_local_session=${token.sessionToken}`,
          "x-csrf-token": token.csrfToken }, payload: { executionOperationId: operationId } });
      await mark("response-received");
      expect(response.statusCode, JSON.stringify(response.json().error)).toBe(200);
      expect(response.json().data).toEqual({ serverId: f.serverId, operationId, worldId: f.target.worldId,
        inspectionOnly: true, recoveryRequired: true });
      expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
      expect(f.start).toHaveBeenCalledOnce();
      expect(f.stop).toHaveBeenCalledOnce();
    } finally { await app.close(); await mark("http-closed"); }
  });
  it.each(["completion-delete", "completion-replace", "intent-replace", "tree-drift", "stage"])("rejects %s between combined writers", async fault => {
    const complete = completionWriter.sealGenerationCompletion;
    let injected = false;
    vi.spyOn(completionWriter, "sealGenerationCompletion").mockImplementation(async (...args) => {
      const result = await complete(...args);
      const prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${operationId}.generation-slot`);
      const file = prefix + (fault.startsWith("completion") ? ".completion.json" : ".json");
      if (fault === "tree-drift") await writeFile(path.join(f.server, "NewWorld", "external.dat"), "changed");
      else if (fault === "stage") await writeFile(prefix + ".tmp", "injected");
      else if (fault.endsWith("delete")) await rm(file);
      else {
        const bytes = await readFile(file);
        await rename(file, file + ".retained");
        await writeFile(file, bytes, { flag: "wx" });
      }
      injected = true;
      return result;
    });
    await expect(f.service.finalizePublishedGeneration(f.serverId, operationId, () => undefined))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(injected).toBe(true);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(existsSync(path.join(f.manager, "active-worlds", `${f.serverId}.${operationId}.generation-genesis.json`))).toBe(false);
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.stop).toHaveBeenCalledOnce();
  });
});

async function inspectionFixture() {
  const f = await currentStateFixture();
  const inspector = new WorldGenerationService(f.registry, f.ops, f.journal, f.backups, f.manager, f.library, f.store);
  const previous = cleanupOwners.get(f.root)!;
  cleanupOwners.set(f.root, async () => { await inspector.close(); await previous(); });
  return { ...f, inspector, inspect: (admission = () => undefined) => inspector.inspectPublished(f.serverId, f.operation.id, admission) };
}

async function historicalReferenceFixture() {
  const f = await inspectionFixture(), files = slotPaths(f);
  const completed = await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
  const snapshotFile = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`);
  // Existing historical snapshot fixture; production wx publication is covered
  // separately by the genesis persistence tests.
  await writeFile(snapshotFile, await readFile(path.join(f.manager, "world-library", f.serverId, "state.json")));
  const saved = await privateFiles.readPrivatePropertiesFile(snapshotFile); saved.bytes.fill(0);
  const reference = { schemaVersion: 1 as const, serverId: f.serverId, executionOperationId: f.operation.id,
    worldId: f.target.worldId, recordDigest: f.target.preparedRecordDigest,
    snapshot: { checksum: saved.checksum, identity: saved.identity }, completion: completed.completion };
  const binding = { serverId: f.serverId, rootPath: f.server, registeredExecutionDigest: f.target.registeredExecutionDigest };
  return { ...f, files, snapshotFile, reference, binding,
    readReference: (authorize = () => undefined) => inspectGenerationGenesisReference(f.manager, reference, binding, authorize) };
}

async function maturityFixture() {
  const f = await historicalReferenceFixture();
  const issued = await f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
  const prepared = await f.library.prepareInitialGenerationMaturity(f.binding, f.reference.snapshot.checksum, f.operation.id,
    issued.issuer, f.binding.registeredExecutionDigest, f.journal, f.store, () => undefined);
  const catalogFile = path.join(f.manager, "world-library", f.serverId, "state.json");
  return { ...f, issued, prepared, catalogFile,
    inspectMature: () => f.library.inspectInitialGenerationMaturity(f.binding, f.binding.registeredExecutionDigest, f.journal, f.store, () => undefined) };
}

async function maturePhysicalFixture(record?: (phase: string) => Promise<void>, installMature = true) {
  const f = await inspectionFixture(), files = slotPaths(f), before = await f.verify();
  // MANUAL protocol evidence fixture, NOT CAS/completion execution acceptance.
  // Every value/identity is derived from actual files and physical proofs.
  const slot = JSON.parse(await readFile(files.slot, "utf8")); slot.state = "active";
  await writeFile(files.stage, JSON.stringify(slot) + "\n", { flag: "wx" });
  const stage = await privateFiles.readPrivatePropertiesFile(files.stage); stage.bytes.fill(0);
  const intent = { schemaVersion: 1, phase: "generation-slot-cas", serverId: f.serverId, executionOperationId: f.operation.id,
    proofDigest: generationSlotProofDigest(before), directoryIdentity: await backupDirectoryIdentity(path.dirname(files.slot)),
    before: { checksum: before.slot.checksum, identity: before.slot.identity }, after: { checksum: stage.checksum, identity: stage.identity } };
  await writeFile(files.intent, JSON.stringify(intent) + "\n", { flag: "wx" }); await rename(files.stage, files.slot);
  const current = await f.verify(); expect(generationSlotProofDigest(current)).toBe(generationSlotProofDigest(before));
  const intentFile = await privateFiles.readPrivatePropertiesFile(files.intent); intentFile.bytes.fill(0);
  const completion = { schemaVersion: 1, phase: "generation-completion-evidence", serverId: f.serverId, executionOperationId: f.operation.id,
    preparationOperationId: current.preparationOperationId, preparationTransactionId: current.preparationTransactionId,
    worldId: current.worldId, proofDigest: generationSlotProofDigest(current), catalogRevision: current.catalogRevision,
    recordDigest: current.recordDigest, receiptDigest: current.receiptDigest, birth: { checksum: current.birthChecksum, identity: current.birthIdentity },
    slot: { checksum: current.slot.checksum, identity: current.slot.identity }, intent: { checksum: intentFile.checksum, identity: intentFile.identity } };
  await writeFile(files.completion, JSON.stringify(completion) + "\n", { flag: "wx" });
  const snapshotFile = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`);
  await writeFile(snapshotFile, await readFile(path.join(f.manager, "world-library", f.serverId, "state.json")), { flag: "wx" });
  const savedSnapshot = await privateFiles.readPrivatePropertiesFile(snapshotFile); savedSnapshot.bytes.fill(0);
  const savedCompletion = await privateFiles.readPrivatePropertiesFile(files.completion); savedCompletion.bytes.fill(0);
  const reference = { schemaVersion: 1 as const, serverId: f.serverId, executionOperationId: f.operation.id, worldId: f.target.worldId,
    recordDigest: current.recordDigest, snapshot: { checksum: savedSnapshot.checksum, identity: savedSnapshot.identity },
    completion: { checksum: savedCompletion.checksum, identity: savedCompletion.identity } };
  const binding = { serverId: f.serverId, rootPath: f.server, registeredExecutionDigest: f.target.registeredExecutionDigest };
  if (record) await record("manual-protocol-fixture-verified");
  const issued = await f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
  if (record) await record("reference-issued");
  const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
  // Physical-only fixture: preparation is covered separately. This remains a
  // MANUAL schema7 installation and cannot prove authorized publication.
  const candidate = { schemaVersion: 7, serverId: snapshot.serverId, catalogId: snapshot.catalogId, rootIdentity: snapshot.rootIdentity,
    entries: snapshot.entries, generationGenesis: { executionOperationId: f.operation.id, worldId: f.target.worldId, issuer: issued.issuer } };
  const catalogFile = path.join(f.manager, "world-library", f.serverId, "state.json");
  if (installMature) await writeFile(catalogFile, JSON.stringify(candidate) + "\n");
  if (record) await record("manual-schema7-installed");
  return { ...f, files, snapshotFile, reference, binding, issued, catalogFile, verifyMature: () => verifyInitialMatureGenerationCurrentState(f.registry, f.manager, f.library, f.journal,
    f.store, f.backups, f.serverId, () => undefined) };
}

describe("initial maturity startup classification", () => {
  it("observes publication metadata without rename, sync, durability or readiness claims", async () => {
    const f = await maturePhysicalFixture(undefined, false);
    const published = await f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined);
    const catalog = JSON.parse(await readFile(f.catalogFile, "utf8")), before = await readdir(path.dirname(f.catalogFile));
    const renameSpy = vi.spyOn(maturityIo, "renameMaturityCatalog"), syncSpy = vi.spyOn(restoreFiles, "syncRestoreDirectory");
    const result = await inspectInitialMaturityPublicationMetadata(f.manager, f.binding, {
      executionOperationId: f.operation.id, worldId: f.target.worldId, catalogId: catalog.catalogId, rootIdentity: catalog.rootIdentity,
      issuer: f.issued.issuer, genesisCatalogRevision: f.reference.snapshot.checksum, birthProofDigest: f.issued.reference.proofDigest,
      catalog: published.catalog }, async () => {
      await f.library.inspectInitialGenerationMaturity(f.binding, f.binding.registeredExecutionDigest, f.journal, f.store, () => undefined);
    }, () => undefined);
    expect(result).toMatchObject({ publicationObserved: true, durabilityVerified: false, inspectionOnly: true, recoveryRequired: true });
    expect(renameSpy).not.toHaveBeenCalled(); expect(syncSpy).not.toHaveBeenCalled(); expect(await readdir(path.dirname(f.catalogFile))).toEqual(before);
  });
  it("rejects missing optional startup proof dependencies instead of accepting7 as legacy", async () => {
    const f = await maturePhysicalFixture(undefined, false);
    await f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined);
    for (const evidence of [{ journal: f.journal, receipts: f.store },
      { journal: f.journal, receipts: f.store, registeredExecutionDigest: f.binding.registeredExecutionDigest }]) {
      await expect(f.library.auditImportBindings(f.binding, [], true, evidence)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    }
  });
  describe("prepared published catalog", () => {
    let f: Awaited<ReturnType<typeof maturePhysicalFixture>>;
    let published: Awaited<ReturnType<WorldGenerationService["publishInitialMaturity"]>>;
    // Setup creates a real isolated catalog with the unchanged issuer/publisher.
    // The body measures startup and confirmation; setup/body each retain a 5000ms bound.
    beforeEach(async () => {
      f = await maturePhysicalFixture(undefined, false);
      published = await f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined);
    }, 5000);
    it("reads the first managed start target under the generation recovery lease", async () => {
      const inspect = (id: string) => f.inspector.inspectFirstManagedStart(f.serverId, id, () => undefined);
      const launches = f.start.mock.calls.length;
      await expect(inspect(randomUUID())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      await expect(inspect(f.operation.id)).resolves.toMatchObject({ serverId: f.serverId, executionOperationId: f.operation.id,
        worldId: f.target.worldId, catalogRevision: published.catalog.checksum, inspectionOnly: true, recoveryRequired: true });
      expect(f.start).toHaveBeenCalledTimes(launches);
      expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    });
    it("persists the first managed start intent without dispatch and retains it across restart", async () => {
      const launches = f.start.mock.calls.length;
      const stage = () => f.inspector.stageFirstManagedStart(f.serverId, f.operation.id, randomUUID(), () => undefined);
      const result = await stage();
      expect((await f.store.read(result.id))).toMatchObject({ operation: { state: "queued", kind: "start" },
        worldLifecycle: { action: "start", serverId: f.serverId, worldId: f.target.worldId,
          catalogRevision: published.catalog.checksum, launchId: null } });
      await expect(stage()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      const store = new JsonOperationStore(f.manager), operations = new OperationService(store, clock, f.journal);
      await operations.initialize();
      const reopened = new WorldGenerationService(f.registry, operations, f.journal, f.backups, f.manager, f.library, store);
      expect(operations.get(result.id)).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
      await expect(reopened.stageFirstManagedStart(f.serverId, f.operation.id, randomUUID(), () => undefined))
        .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      expect((await store.read(result.id)).operation.state).toBe("queued");
      expect(operations.getServerState(f.serverId)).toMatchObject({ recoveryRequired: true, activeOperationId: null });
      await reopened.close();
      expect(f.start).toHaveBeenCalledTimes(launches);
      expect(f.ops.getServerState(f.serverId)).toMatchObject({ recoveryRequired: true, activeOperationId: null });
    });
    it.each([false, true])("dispatches the first managed start after readback (extra receipt: %s)", async extra => {
      const original = f.start.getMockImplementation()!;
      let spawned = false;
      f.start.mockImplementation(async ctx => {
        const saved = await f.store.read(ctx.operationId);
        expect(saved.operation).toMatchObject({ kind: "start", state: "running" });
        const read = f.store.read.bind(f.store);
        const drift = extra ? vi.spyOn(f.store, "read").mockImplementationOnce(async id => {
          const current = await read(id);
          const otherId = randomUUID(), other = structuredClone(saved), receipt = other.worldLifecycle!;
          if (receipt.action !== "start") throw new Error("Expected start receipt");
          other.operation.id = otherId;
          receipt.startOperationId = otherId;
          await f.store.create(other);
          return current;
        }) : undefined;
        try { await ctx.verifyBeforeSpawn?.(); } finally { drift?.mockRestore(); }
        ctx.beforeSpawn?.();
        spawned = true;
        // This Fake runtime reuses the owned observation without creating the already generated world again.
        const launch = { launchId: randomUUID(), serverId: f.serverId, ownerOperationId: ctx.operationId, processId: 12345,
          spawned: true, ready: true, stopRequested: false, stopOperationId: null, stopCompleted: false,
          errorObserved: false, exited: false, exitCode: null, signal: null, closed: false };
        f.runtime.getOwnedLaunchObservation.mockReturnValue(launch);
      });
      let witness: ReturnType<typeof captureOwnedWorldLifecycle> | undefined;
      const launches = f.start.mock.calls.length, onLaunch = vi.fn(async (proof: ReturnType<typeof captureOwnedWorldLifecycle>) => { witness = proof; });
      try {
        const launch = f.inspector.stageFirstManagedStart(f.serverId, f.operation.id, randomUUID(), () => undefined, onLaunch);
        if (extra) {
          await expect(launch).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
          expect(onLaunch).not.toHaveBeenCalled();
        } else {
          const result = await launch;
          expect(onLaunch).toHaveBeenCalledOnce();
          expect(await f.store.readWorldLaunchSeal(result.id)).toMatchObject({ startOperationId: result.id });
          const start = await f.store.read(result.id), startReceipt = start.worldLifecycle!;
          if (startReceipt.action !== "start" || !witness) throw new Error("Expected live start witness");
          const seal = await f.store.readWorldLaunchSeal(result.id);
          const id = randomUUID(), key = randomUUID();
          const receipt: WorldLifecycleReceipt = { ...startReceipt, action: "stop", launchId: seal.launchId,
            startReceiptDigest: seal.intentDigest, keyDigest: createHash("sha256").update(key).digest("hex") };
          receipt.requestDigest = worldLifecycleFingerprint(receipt);
          const stop: StoredOperation = { ...start, operation: { ...start.operation, id, kind: "stop", state: "queued", step: "queued" },
            idempotencyKey: key, requestFingerprint: receipt.requestDigest, worldLifecycle: receipt };
          Object.assign(f.runtime, { supportsStopAdmission: true });
          const stopRuntime = vi.spyOn(f.adapter, "stop").mockImplementation(async ctx => {
            const observation = f.runtime.getOwnedLaunchObservation()!;
            Object.assign(observation, { stopRequested: true, stopOperationId: ctx.operationId });
            await ctx.verifyBeforeStop?.();
            ctx.beforeStop?.();
            Object.assign(observation, { stopCompleted: true, exited: true, closed: true, exitCode: 0 });
          });
          const onStopped = vi.fn(async () => {});
          const previousStops = stopRuntime.mock.calls.length;
          try {
            const extraStart = structuredClone(start), extraId = randomUUID();
            extraStart.operation.id = extraId;
            if (extraStart.worldLifecycle?.action !== "start") throw new Error("Expected start receipt");
            extraStart.worldLifecycle.startOperationId = extraId;
            await f.store.create(extraStart);
            try {
              await expect(requestOwnedWorldStop(f.registry, f.ops, stop, "NewWorld", witness, () => undefined, onStopped))
                .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
              expect(stopRuntime).toHaveBeenCalledTimes(previousStops);
              await expect(f.store.read(id)).rejects.toMatchObject({ code: "ENOENT" });
            } finally { await rm(path.join(f.manager, "operations", `${extraId}.json`)); }
            await expect(f.inspector.stopFirstManagedWorld(f.serverId, randomUUID(), randomUUID(), () => undefined))
              .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
            const stopped = await f.inspector.stopFirstManagedWorld(f.serverId, result.id, key, () => undefined);
            expect(stopRuntime).toHaveBeenCalledTimes(previousStops + 1);
            expect(await f.store.readWorldStopSeal(stopped.id)).toMatchObject({ stopOperationId: stopped.id });
            const recovered = new OperationService(new JsonOperationStore(f.manager), clock, f.journal);
            await recovered.initialize();
            expect(await recovered.readStartupWorldStopCandidate(f.serverId)).toMatchObject({
              start: { operation: { id: result.id } }, stop: { operation: { id: stopped.id } },
              revision: { stopOperationId: stopped.id }
            });
            expect(recovered.getServerState(f.serverId).recoveryRequired).toBe(true);
            const issuer = new WorldGenerationService(f.registry, recovered, f.journal, f.backups, f.manager, f.library, f.store);
            try {
              const createSettlement = f.store.createWorldGenerationSettlement.bind(f.store);
              vi.spyOn(f.store, "createWorldGenerationSettlement").mockImplementationOnce(async value => {
                await createSettlement(value); throw new Error("lost-settlement-response");
              });
              await expect(issuer.recordFirstManagedStopSettlement(f.serverId, stopped.id, () => undefined))
                .rejects.toThrow("lost-settlement-response");
              expect(recovered.getServerState(f.serverId).recoveryRequired).toBe(true);
              await expect(issuer.recordFirstManagedStopSettlement(f.serverId, stopped.id, () => undefined))
                .resolves.toMatchObject({ historicalEvidenceRecorded: true, recoveryRequired: true, stopOperationId: stopped.id });
              const saved = await f.store.readWorldGenerationSettlement(stopped.id);
              const generation = await f.store.read(f.operation.id);
              expect(saved).toMatchObject({ preparationOperationId: generation.worldGenerationExecution!.preparationOperationId,
                executionOperationId: f.operation.id, startOperationId: result.id, stopOperationId: stopped.id });
              await expect(issuer.recordFirstManagedStopSettlement(f.serverId, stopped.id, () => undefined)).resolves.toBeDefined();
              expect(await f.store.readWorldGenerationSettlement(stopped.id)).toEqual(saved);
              expect(recovered.getServerState(f.serverId).recoveryRequired).toBe(true);
              await expect(issuer.recordFirstManagedStopSettlement(f.serverId, randomUUID(), () => undefined))
                .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
              const settlementFile = path.join(f.manager, "operations", `${stopped.id}.generation-settlement.json`);
              await writeFile(settlementFile, JSON.stringify({ ...saved, serverId: "other" }));
              await expect(issuer.recordFirstManagedStopSettlement(f.serverId, stopped.id, () => undefined))
                .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
              expect(recovered.getServerState(f.serverId).recoveryRequired).toBe(true);
            } finally { await issuer.close(); }
            await expect(f.inspector.stopFirstManagedWorld(f.serverId, result.id, randomUUID(), () => undefined))
              .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
          } finally { stopRuntime.mockRestore(); }
        }
        expect(spawned).toBe(!extra);
        expect(f.start).toHaveBeenCalledTimes(launches + 1);
        expect(f.ops.getServerState(f.serverId)).toMatchObject({ recoveryRequired: true, activeOperationId: null });
      } finally { f.start.mockImplementation(original); }
    });
    it("cancels the first managed start readiness wait when the generation service closes", async () => {
      let entered!: () => void, canceled = false;
      const readiness = new Promise<void>(resolve => { entered = resolve; });
      f.start.mockImplementation(async ctx => {
        await ctx.verifyBeforeSpawn?.();
        ctx.beforeSpawn?.();
        entered();
        await new Promise<void>(resolve => {
          if (ctx.signal.aborted) resolve();
          else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        canceled = true;
        throw new Error("readiness canceled");
      });
      const launch = f.inspector.stageFirstManagedStart(f.serverId, f.operation.id, randomUUID(), () => undefined, async () => {});
      const rejected = expect(launch).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      await Promise.race([readiness, rejected.then(() => { throw new Error("Launch rejected before readiness wait"); })]);
      await f.inspector.close();
      await rejected;
      expect(canceled).toBe(true);
      expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    });
    it("runs explicit first managed start and stop over authenticated HTTP", async () => {
      Object.assign(f.runtime, { supportsStopAdmission: true });
      f.start.mockImplementation(async ctx => {
        await ctx.verifyBeforeSpawn?.(); ctx.beforeSpawn?.();
        f.runtime.getOwnedLaunchObservation.mockReturnValue({ launchId: randomUUID(), serverId: f.serverId,
          ownerOperationId: ctx.operationId, processId: 12345, spawned: true, ready: true, stopRequested: false,
          stopOperationId: null, stopCompleted: false, errorObserved: false, exited: false, exitCode: null, signal: null, closed: false });
      });
      const stopRuntime = vi.spyOn(f.adapter, "stop").mockImplementation(async ctx => {
        const observation = f.runtime.getOwnedLaunchObservation()!;
        Object.assign(observation, { stopRequested: true, stopOperationId: ctx.operationId });
        await ctx.verifyBeforeStop?.(); ctx.beforeStop?.();
        Object.assign(observation, { stopCompleted: true, exited: true, closed: true, exitCode: 0 });
      });
      const sessions = new SessionCore(() => 0), token = sessions.create("local-http");
      const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin",
        revision: randomUUID(), salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
        { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
      const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000",
        "x-manager-intent": "local-ui", "idempotency-key": randomUUID(),
        cookie: `mcsm_local_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken };
      const app = buildApp({ mode: "local", adapters: [f.adapter], clock, authentication, managerRoot: f.manager,
        operationStore: f.store, transactionJournal: f.journal, activeWorldState: f.states,
        worldGenerationPreparation: true, worldGenerationExecution: true, backupSchedulerTimers: false });
      const base = `/api/v1/servers/${f.serverId}/worlds/first-managed-`;
      const startRequest = { method: "POST" as const, url: base + "start", headers,
        payload: { executionOperationId: f.operation.id, confirm: true } };
      try {
        expect((await app.inject({ ...startRequest, headers: { ...headers, cookie: "" } })).statusCode).toBe(401);
        expect((await app.inject({ ...startRequest, headers: { ...headers, "x-csrf-token": "bad" } })).statusCode).toBe(403);
        expect((await app.inject({ ...startRequest, payload: { ...startRequest.payload, path: "outside" } })).statusCode).toBe(400);
        expect((await app.inject({ ...startRequest, payload: { executionOperationId: f.operation.id, confirm: false } })).statusCode).toBe(400);
        expect((await app.inject({ ...startRequest, headers: { ...headers, "idempotency-key": "" } })).statusCode).toBe(428);
        const started = await app.inject(startRequest);
        expect(started.statusCode, started.body).toBe(202);
        expect(started.headers["cache-control"]).toBe("no-store");
        const startOperationId = started.json().data.operation.id;
        const stopped = await app.inject({ method: "POST", url: base + "stop",
          headers: { ...headers, "idempotency-key": randomUUID() }, payload: { startOperationId, confirm: true } });
        expect(stopped.statusCode, stopped.body).toBe(202);
        expect(await f.store.readWorldStopSeal(stopped.json().data.operation.id)).toMatchObject({ schemaVersion: 1 });
        expect((await app.inject(startRequest)).statusCode).toBe(409);
        expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
      } finally { await app.close(); stopRuntime.mockRestore(); }
    });
    it("retains the stop owner after timeout until its actual task drains", async () => {
      Object.assign(f.runtime, { supportsStopAdmission: true });
      f.start.mockImplementation(async ctx => {
        await ctx.verifyBeforeSpawn?.(); ctx.beforeSpawn?.();
        f.runtime.getOwnedLaunchObservation.mockReturnValue({ launchId: randomUUID(), serverId: f.serverId,
          ownerOperationId: ctx.operationId, processId: 12345, spawned: true, ready: true, stopRequested: false,
          stopOperationId: null, stopCompleted: false, errorObserved: false, exited: false, exitCode: null, signal: null, closed: false });
      });
      const start = await f.inspector.stageFirstManagedStart(f.serverId, f.operation.id, randomUUID(), () => undefined, async () => {});
      let entered!: () => void, release!: () => void, stopId: string | undefined;
      const stopping = new Promise<void>(resolve => { entered = resolve; });
      const pending = new Promise<void>(resolve => { release = resolve; });
      const stop = vi.spyOn(f.adapter, "stop").mockImplementation(async ctx => {
        stopId = ctx.operationId;
        const observation = f.runtime.getOwnedLaunchObservation()!;
        Object.assign(observation, { stopRequested: true, stopOperationId: ctx.operationId });
        await ctx.verifyBeforeStop?.(); ctx.beforeStop?.();
        entered();
        await pending;
        Object.assign(observation, { stopCompleted: true, exited: true, closed: true, exitCode: 0 });
      });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const request = f.inspector.stopFirstManagedWorld(f.serverId, start.id, randomUUID(), () => undefined);
        const failed = expect(request).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
        await stopping;
        await vi.advanceTimersByTimeAsync(5000);
        await failed;
        expect(f.ops.getServerState(f.serverId).activeOperationId).toBe(stopId);
        const closing = expect(f.inspector.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
        await vi.advanceTimersByTimeAsync(5000);
        await closing;
        release();
        await f.ops.ownedStopCompletion(stopId!);
        await f.inspector.close();
        expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
      } finally { release(); stop.mockRestore(); vi.useRealTimers(); }
    });
    it("retains a readable first managed start intent when authorization is lost during creation", async () => {
      const create = f.store.create.bind(f.store);
      let allowed = true, operationId: string | undefined;
      const publish = vi.spyOn(f.store, "create").mockImplementationOnce(async record => {
        await create(record);
        operationId = record.operation.id;
        allowed = false;
      });
      const launches = f.start.mock.calls.length;
      try {
        await expect(f.inspector.stageFirstManagedStart(f.serverId, f.operation.id, randomUUID(), () => {
          if (!allowed) throw new Error("authorization revoked");
          return undefined;
        })).rejects.toThrow("authorization revoked");
      } finally { publish.mockRestore(); }
      expect(operationId).toBeDefined();
      expect((await f.store.read(operationId!)).operation.state).toBe("queued");
      expect(f.ops.get(operationId!)).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
      expect(f.start).toHaveBeenCalledTimes(launches);
    });
    it("retains the first managed start intent when publication evidence changes during creation", async () => {
      const create = f.store.create.bind(f.store);
      const intent = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity.json`);
      let operationId: string | undefined;
      const publish = vi.spyOn(f.store, "create").mockImplementationOnce(async record => {
        await create(record);
        operationId = record.operation.id;
        await rename(intent, intent + ".held");
      });
      const launches = f.start.mock.calls.length;
      try {
        await expect(f.inspector.stageFirstManagedStart(f.serverId, f.operation.id, randomUUID(), () => undefined))
          .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      } finally {
        publish.mockRestore();
        if (operationId) await rename(intent + ".held", intent);
      }
      expect(operationId).toBeDefined();
      expect((await f.store.read(operationId!)).operation.state).toBe("queued");
      expect(f.ops.getServerState(f.serverId)).toMatchObject({ recoveryRequired: true, activeOperationId: null });
      expect(f.start).toHaveBeenCalledTimes(launches);
    });
    it("rejects first managed start intent drift after the final publication fence", async () => {
      const create = f.store.create.bind(f.store), fence = maturityIo.validateMaturityFenceSync;
      let saved: StoredOperation | undefined, changed = false;
      const publish = vi.spyOn(f.store, "create").mockImplementationOnce(async record => {
        await create(record);
        saved = record;
      });
      const replace = vi.spyOn(maturityIo, "validateMaturityFenceSync").mockImplementation((...args) => {
        fence(...args);
        if (saved && !changed) {
          writeFileSync(path.join(f.manager, "operations", `${saved.operation.id}.json`),
            JSON.stringify({ ...saved, operation: { ...saved.operation, step: "changed-after-fence" } }));
          changed = true;
        }
      });
      try {
        await expect(f.inspector.stageFirstManagedStart(f.serverId, f.operation.id, randomUUID(), () => undefined))
          .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      } finally { replace.mockRestore(); publish.mockRestore(); }
      expect(changed).toBe(true);
      expect((await f.store.read(saved!.operation.id)).operation.step).toBe("changed-after-fence");
      expect(f.ops.getServerState(f.serverId)).toMatchObject({ recoveryRequired: true, activeOperationId: null });
    });
    it("binds the first managed start baseline to the actual published maturity intent", async () => {
      const proof = await verifyPublishedInitialWorldBaseline(f.registry, f.manager, f.library, f.journal,
        f.store, f.backups, f.serverId, () => undefined);
      expect(proof).toMatchObject({ worldId: f.target.worldId, catalogRevision: published.catalog.checksum,
        catalogObjectIdentity: published.catalog.objectIdentity, recoveryRequired: true });
      const intent = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity.json`);
      const bytes = await readFile(intent);
      await rename(intent, intent + ".held");
      try {
        await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
        await writeFile(intent, bytes, { flag: "wx" });
        await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      }
      finally { await rename(intent + ".held", intent); }
      expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    });
    it("lists initial7 for an exact sealed ordinary pair but rejects drift and extra lifecycle receipts", async () => {
      const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
      const active = JSON.parse(await readFile(f.files.slot, "utf8")), catalogBytes = await readFile(f.catalogFile);
      const startId = randomUUID(), stopId = randomUUID(), launchId = randomUUID();
      const catalog = JSON.parse(catalogBytes.toString("utf8")) as { rootIdentity: string; entries: { worldId: string; directoryIdentity: string }[] };
      const entry = catalog.entries.find(item => item.worldId === f.target.worldId)!;
      const binding = { schemaVersion: 1 as const, serverId: f.serverId, worldId: entry.worldId, catalogRevision: hash(catalogBytes),
        worldRevision: "1".repeat(64), rootIdentity: catalog.rootIdentity, worldDirectoryIdentity: entry.directoryIdentity,
        registeredExecutionDigest: f.binding.registeredExecutionDigest, runNonce: randomUUID(), startOperationId: startId };
      const make = (id: string, descriptor: WorldLifecycleReceipt): StoredOperation => {
        const key = randomUUID(), at = clock.now().toISOString();
        descriptor.keyDigest = hash(key);
        descriptor.requestDigest = worldLifecycleFingerprint(descriptor);
        return { operation: { id, serverId: f.serverId, kind: descriptor.action, state: "running", step: "running", progress: null,
          createdAt: at, updatedAt: at, result: null, error: null }, idempotencyKey: key, expiresAt: at,
          requestFingerprint: descriptor.requestDigest, worldLifecycle: descriptor };
      };
      const start = make(startId, { ...binding, action: "start", launchId: null, keyDigest: "", requestDigest: "" });
      const startReceiptDigest = hash(JSON.stringify(start));
      const stop = make(stopId, { ...binding, action: "stop", launchId, startReceiptDigest, keyDigest: "", requestDigest: "" });
      await f.store.create(start); await f.store.create(stop);
      await f.store.createWorldLaunchSeal({ schemaVersion: 1, startOperationId: startId, launchId, intentDigest: startReceiptDigest });
      const worldRoot = path.join(f.binding.rootPath, active.levelName);
      const config = await privateFiles.readPrivatePropertiesFile(path.join(f.binding.rootPath, "server.properties"), 1024 * 1024);
      const level = await privateFiles.readPrivatePropertiesFile(path.join(worldRoot, "level.dat"), 8 * 1024 * 1024);
      config.bytes.fill(0); level.bytes.fill(0);
      await f.store.createWorldStopSeal({ schemaVersion: 1, stopOperationId: stopId, stopIntentDigest: hash(JSON.stringify(stop)),
        treeChecksum: restoreFiles.restoreFilesChecksum(await restoreFiles.inventoryRestoreTree(worldRoot)),
        propertiesChecksum: config.checksum, propertiesIdentity: config.identity, levelIdentity: level.identity });
      let journalFault: "none" | "missing-parent" | "replaced-location" = "none";
      const operations = new OperationService(f.store, clock, {
        initialize: bindLocation => f.journal.initialize(bindLocation),
        scanExisting: async () => {
          const scan = await f.journal.scanExisting();
          if (journalFault === "missing-parent") return { ...scan, records: scan.records.filter(record => record.intent.serverId !== f.serverId) };
          if (journalFault === "replaced-location") return { ...scan, locationIdentity: "0".repeat(64) };
          return scan;
        }
      });
      await operations.initialize();
      const lifecycle = await operations.readStartupWorldStopCandidate(f.serverId);
      expect(lifecycle).toBeDefined();
      try {
        for (const fault of ["missing-parent", "replaced-location"] as const) {
          journalFault = fault;
          await expect(operations.runStartupWorldStopInspection(f.serverId, () => undefined,
            async (_assertCurrent, historical, checkConfirmation) => {
              expect(historical).toBe(true);
              return checkConfirmation(lifecycle!, true);
            }, true)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
          await expect(f.store.readWorldStopConfirmation(stopId)).rejects.toMatchObject({ code: "ENOENT" });
        }
      } finally { journalFault = "none"; }
      const checkSaved = (service: OperationService, write: boolean) => service.runStartupWorldStopInspection(f.serverId, () => undefined,
        async (_assertCurrent, _historical, checkConfirmation) => checkConfirmation(lifecycle!, write), true);
      await expect(checkSaved(operations, true)).resolves.toBe(true);
      expect(await f.store.readWorldStopConfirmation(stopId)).toMatchObject({ schemaVersion: 2, journalDigest: expect.stringMatching(/^[0-9a-f]{64}$/u) });
      const restartWithReplacedLocation = new OperationService(f.store, clock, {
        initialize: async bindLocation => ({ ...await f.journal.initialize(bindLocation), locationIdentity: "0".repeat(64) }),
        scanExisting: async () => ({ ...await f.journal.scanExisting(), locationIdentity: "0".repeat(64) })
      });
      await restartWithReplacedLocation.initialize();
      await expect(checkSaved(restartWithReplacedLocation, false)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      const proof = { journal: f.journal, receipts: f.store, registeredExecutionDigest: f.binding.registeredExecutionDigest,
        assertCurrent: () => undefined, readLifecycle: () => operations.readStartupWorldStopCandidate(f.serverId) };
      await expect(f.library.auditImportBindings(f.binding, [], true, { ...proof, authorize: proof.assertCurrent })).resolves.toBeUndefined();
      const app = Fastify();
      registerWorldStopInspectionRoute(app, f.registry, operations, f.library, proof, () => active, clock, "local", { assertMutation: () => {} });
      const inspect = () => app.inject({ method: "POST", url: `/api/v1/servers/${f.serverId}/worlds/stopped-revision-inspection`,
        headers: { origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui", "content-type": "application/json" }, payload: {} });
      try {
        const projection = await f.library.list(f.binding, active, proof);
        const list = vi.spyOn(f.library, "list").mockResolvedValueOnce({
          ...projection, state: "ready", reason: null, activeWorldId: f.target.worldId
        });
        try {
          const rejected = await inspect();
          expect(rejected.statusCode).toBe(409);
        } finally { list.mockRestore(); }
        const response = await inspect();
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().data).toMatchObject({ worldId: f.target.worldId, operationId: stopId, inspectionOnly: true, recoveryRequired: true });
        const intent = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity.json`);
        await rename(intent, intent + ".held");
        try { expect((await inspect()).statusCode).toBe(409); }
        finally { await rename(intent + ".held", intent); }
      } finally { await app.close(); }
      expect(await f.library.list(f.binding, active, proof)).toMatchObject({ state: "inspection-required", activeWorldId: null,
        mutationsAvailable: false, items: expect.arrayContaining([expect.objectContaining({ worldId: entry.worldId })]) });
      const stopSeal = path.join(f.manager, "operations", `${stopId}.stop.json`), sealBytes = await readFile(stopSeal);
      let reads = 0;
      expect(await f.library.list(f.binding, active, { ...proof, readLifecycle: async () => {
        if (++reads === 2) await writeFile(stopSeal, JSON.stringify({ ...lifecycle!.revision, treeChecksum: "0".repeat(64) }));
        return proof.readLifecycle();
      } })).toMatchObject({ state: "inspection-required", items: [] });
      expect(reads).toBe(2);
      await writeFile(stopSeal, sealBytes);
      const extraId = randomUUID();
      const extra = make(extraId, { ...binding, startOperationId: extraId, action: "start", launchId: null, keyDigest: "", requestDigest: "" });
      extra.operation.state = "succeeded";
      await f.store.create(extra);
      await expect(f.library.auditImportBindings(f.binding, [], true, { ...proof, authorize: proof.assertCurrent })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      expect(await f.library.list(f.binding, active, proof)).toMatchObject({ state: "inspection-required", items: [] });
      expect(operations.getServerState(f.serverId).recoveryRequired).toBe(true);
      expect(await readFile(f.catalogFile)).toEqual(catalogBytes);
    });
    it.each(["missing-proof", "foreign-slot", "foreign-registration", "lost-authority"])("keeps initial7 list closed for %s", async problem => {
      const active = JSON.parse(await readFile(f.files.slot, "utf8"));
      const original = await readFile(f.catalogFile), receipts = await f.store.list();
      let calls = 0;
      const proof = { journal: f.journal, receipts: f.store,
        registeredExecutionDigest: problem === "foreign-registration" ? "f".repeat(64) : f.binding.registeredExecutionDigest,
        assertCurrent: (): undefined => { if (problem === "lost-authority" && ++calls > 1) throw new Error("authority lost"); return undefined; } };
      if (problem === "foreign-slot") active.worldId = "world-foreign";
      const result = await f.library.list(f.binding, active, problem === "missing-proof" ? undefined : proof);
      expect(result).toMatchObject({ state: "inspection-required", activeWorldId: null, mutationsAvailable: false, items: [] });
      expect(await readFile(f.catalogFile)).toEqual(original);
      expect(await f.store.list()).toEqual(receipts);
      expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
      expect(f.start).toHaveBeenCalledOnce();
    });
    it("permits only explicit confirmation after fresh app startup and leaves all normal actions closed", async () => {
      const classification = vi.spyOn(OperationService.prototype, "requireStartupWorldRecovery");
      const app = buildApp({ mode: "local", adapters: [f.adapter], managerRoot: f.manager, transactionJournal: f.journal,
        operationStore: f.store, activeWorldState: new ActiveWorldStateStore(f.manager, [f.adapter]), backupSchedulerTimers: false });
      let service: WorldGenerationService | undefined;
      try {
        await app.ready(); const operations = classification.mock.contexts.at(-1)!;
        service = new WorldGenerationService(f.registry, operations, f.journal, f.backups, f.manager, new WorldLibraryStore(f.manager, clock), f.store);
        const renameCatalog = vi.spyOn(maturityIo, "renameMaturityCatalog");
        const confirmed = await service.finalizePublishedGeneration(f.serverId, f.operation.id, () => undefined);
        expect(renameCatalog).not.toHaveBeenCalled();
        expect(confirmed.catalog).toEqual(published.catalog); expect(confirmed.catalogPublicationVerified).toBe(true);
        const retried = await service.finalizePublishedGeneration(f.serverId, f.operation.id, () => undefined);
        expect(retried.catalog).toEqual(confirmed.catalog);
        expect(renameCatalog).not.toHaveBeenCalled();
        expect(operations.getServerState(f.serverId).recoveryRequired).toBe(true);
        const response = await app.inject({ method: "GET", url: `/api/v1/servers/${f.serverId}/world-library`, headers: { host: "127.0.0.1:8080" } });
        expect(response.json().data).toMatchObject({ state: "inspection-required", mutationsAvailable: false, activationAvailable: false });
        expect(response.json().data.activeWorldId).toBeNull();
        expect(response.json().data.items).toContainEqual(expect.objectContaining({ worldId: f.target.worldId, origin: "generation" }));
        expect(f.start).toHaveBeenCalledOnce();
      } finally { await service?.close(); await app.close(); }
    });
    });
  it.each(["manual7", "intent", "identity", "pending", "external"])("keeps startup %s ambiguity blocked", async problem => {
    const f = await maturePhysicalFixture(undefined, problem === "manual7");
    if (problem !== "manual7") await f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined);
    if (problem === "intent") await writeFile(path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity.json`), "{partial");
    if (problem === "identity") { const bytes = await readFile(f.catalogFile); await rename(f.catalogFile, f.catalogFile + ".retained"); await writeFile(f.catalogFile, bytes); }
    if (problem === "pending") await writeFile(f.files.stage, "pending");
    if (problem === "external") {
      const initialize = OperationService.prototype.initialize;
      vi.spyOn(OperationService.prototype, "initialize").mockImplementation(async function (this: OperationService, ...args) {
        this.requireRecovery([f.serverId]); return initialize.apply(this, args);
      });
    }
    const classification = vi.spyOn(OperationService.prototype, "requireStartupWorldRecovery");
    const app = buildApp({ mode: "local", adapters: [f.adapter], managerRoot: f.manager, transactionJournal: f.journal,
      operationStore: f.store, activeWorldState: new ActiveWorldStateStore(f.manager, [f.adapter]), backupSchedulerTimers: false });
    let service: WorldGenerationService | undefined;
    try {
      await app.ready(); const operations = classification.mock.contexts.at(-1)!;
      service = new WorldGenerationService(f.registry, operations, f.journal, f.backups, f.manager, new WorldLibraryStore(f.manager, clock), f.store);
      await expect(service.finalizePublishedGeneration(f.serverId, f.operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      expect(operations.getServerState(f.serverId).recoveryRequired).toBe(true); expect(f.start).toHaveBeenCalledOnce();
    } finally { await service?.close(); await app.close(); }
  });
});

describe("initial maturity catalog publication", () => {
  it("compares exact bigint devices rather than rounded numeric aliases", () => {
    const device = 9007199254740992n;
    expect(() => maturityIo.assertMaturitySameDevice(device, device)).not.toThrow();
    expect(() => maturityIo.assertMaturitySameDevice(device, device + 1n)).toThrow();
    expect(Number(device)).toBe(Number(device + 1n));
  });
  it("rejects an injected preflight device mismatch before attempting rename", async () => {
    const f = await maturePhysicalFixture(undefined, false), before = await readFile(f.catalogFile), check = maturityIo.assertMaturitySameDevice;
    const deviceSpy = vi.spyOn(maturityIo, "assertMaturitySameDevice").mockImplementationOnce((left, right) => check(left, right + 1n));
    const renameSpy = vi.spyOn(maturityIo, "renameMaturityCatalog");
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(deviceSpy).toHaveBeenCalled(); expect(renameSpy).not.toHaveBeenCalled(); expect(await readFile(f.catalogFile)).toEqual(before);
  });
  it.each(["source", "stage", "intent"])("rejects same-byte %s object replacement at the final CAS fence", async changedFile => {
    const f = await maturePhysicalFixture(undefined, false), prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity`);
    const file = changedFile === "source" ? f.catalogFile : prefix + (changedFile === "stage" ? ".tmp" : ".json");
    const before = await readFile(f.catalogFile), fence = maturityIo.validateMaturityFenceSync; let changed = false;
    vi.spyOn(maturityIo, "validateMaturityFenceSync").mockImplementation((...args) => {
      if (!changed && args[0].length === 3) { changed = true; const bytes = readFileSync(file); renameSync(file, file + ".retained"); writeFileSync(file, bytes); }
      return fence(...args);
    });
    const renameSpy = vi.spyOn(maturityIo, "renameMaturityCatalog");
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(changed).toBe(true); expect(renameSpy).not.toHaveBeenCalled(); expect(await readFile(f.catalogFile)).toEqual(before);
    expect(existsSync(file + ".retained")).toBe(true);
  });
  it("retains source6 and intent when persistent receipts drift in the closing IO window", async () => {
    const f = await maturePhysicalFixture(undefined, false), sync = restoreFiles.syncRestoreDirectory;
    const prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity`), before = await readFile(f.catalogFile);
    let changed = false;
    vi.spyOn(restoreFiles, "syncRestoreDirectory").mockImplementation(async directory => {
      await sync(directory);
      if (!changed && existsSync(prefix + ".json")) {
        changed = true; const record = (await f.store.list()).find(record => record.operation.id === f.operation.id)!;
        await f.store.save({ ...record, operation: { ...record.operation, updatedAt: "2026-11-02T00:00:00Z" } });
      }
    });
    const renameSpy = vi.spyOn(maturityIo, "renameMaturityCatalog");
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(changed).toBe(true); expect(renameSpy).not.toHaveBeenCalled(); expect(await readFile(f.catalogFile)).toEqual(before);
    expect(existsSync(prefix + ".json")).toBe(true);
  });
  it("rejects late authorization revocation without renaming or removing durable evidence", async () => {
    const f = await maturePhysicalFixture(undefined, false), prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity`);
    const before = await readFile(f.catalogFile), renameSpy = vi.spyOn(maturityIo, "renameMaturityCatalog");
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => {
      if (existsSync(prefix + ".json")) throw new Error("revoked"); return undefined;
    })).rejects.toThrow("revoked");
    expect(renameSpy).not.toHaveBeenCalled(); expect(await readFile(f.catalogFile)).toEqual(before);
    expect(existsSync(prefix + ".tmp")).toBe(true); expect(existsSync(prefix + ".json")).toBe(true);
  });
  it.each(["source", "stage"])("rejects in-place %s edits at the final pre-rename content fence", async changedFile => {
    const f = await maturePhysicalFixture(undefined, false), prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity`);
    const before = await readFile(f.catalogFile), fence = maturityIo.validateMaturityFenceSync; let changed = false;
    const external = changedFile === "source" ? Buffer.concat([before, Buffer.from(" ")]) : Buffer.from("corrupt-stage");
    vi.spyOn(maturityIo, "validateMaturityFenceSync").mockImplementation((...args) => {
      if (!changed && args[0].some(file => file.file === prefix + ".tmp")) { changed = true; writeFileSync(changedFile === "source" ? f.catalogFile : prefix + ".tmp", external); }
      return fence(...args);
    });
    const renameSpy = vi.spyOn(maturityIo, "renameMaturityCatalog");
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(changed).toBe(true); expect(renameSpy).not.toHaveBeenCalled();
    expect(await readFile(f.catalogFile)).toEqual(changedFile === "source" ? external : before);
    expect(existsSync(prefix + ".tmp")).toBe(true); expect(existsSync(prefix + ".json")).toBe(true);
  });
  it.each(["generation-stage", "catalog-sibling", "maturity-stage"])("rejects late %s in the final post-publication fence", async problem => {
    const f = await maturePhysicalFixture(undefined, false), fence = maturityIo.validateMaturityFenceSync; let changed = false;
    const prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity`);
    const unexpected = problem === "catalog-sibling" ? path.join(path.dirname(f.catalogFile), "unexpected.tmp") :
      problem === "generation-stage" ? f.files.stage : prefix + ".tmp";
    vi.spyOn(maturityIo, "validateMaturityFenceSync").mockImplementation((...args) => {
      if (!changed && args[0].length === 2) { changed = true; writeFileSync(unexpected, "late-evidence"); }
      return fence(...args);
    });
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(changed).toBe(true); expect(await readFile(unexpected, "utf8")).toBe("late-evidence");
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("retains a cross-device rename refusal without copying or overwriting source", async () => {
    const f = await maturePhysicalFixture(undefined, false), before = await readFile(f.catalogFile);
    vi.spyOn(maturityIo, "renameMaturityCatalog").mockRejectedValue(Object.assign(new Error("cross-device-refusal"), { code: "EXDEV" }));
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(f.catalogFile)).toEqual(before);
    expect(existsSync(path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity.tmp`))).toBe(true);
  });
  it("does not open startup gates after actual catalog publication and fresh Fastify reconstruction", async () => {
    const f = await maturePhysicalFixture(undefined, false);
    await f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined);
    const classification = vi.spyOn(OperationService.prototype, "requireStartupWorldRecovery");
    const app = buildApp({ mode: "local", adapters: [f.adapter], managerRoot: f.manager, transactionJournal: f.journal,
      operationStore: f.store, activeWorldState: new ActiveWorldStateStore(f.manager, [f.adapter]), backupSchedulerTimers: false });
    try {
      await app.ready(); const response = await app.inject({ method: "GET", url: `/api/v1/servers/${f.serverId}/world-library`, headers: { host: "127.0.0.1:8080" } });
      expect(response.json().data).toMatchObject({ state: "inspection-required", mutationsAvailable: false, activationAvailable: false });
      expect(classification.mock.contexts.at(-1)!.getServerState(f.serverId).recoveryRequired).toBe(true); expect(f.start).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });
  it("publishes actual7 without settling receipts, opening readiness or changing worlds", async () => {
    const f = await maturePhysicalFixture(undefined, false), receipts = await f.store.list();
    const world = await readFile(path.join(f.server, "NewWorld", "level.dat"));
    const result = await f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined);
    expect(result).toMatchObject({ phase: "initial-maturity-catalog-installed", catalogPublicationVerified: true,
      inspectionOnly: true, recoveryRequired: true, worldId: f.target.worldId });
    expect(JSON.parse(await readFile(f.catalogFile, "utf8")).schemaVersion).toBe(7);
    expect(await f.store.list()).toEqual(receipts); expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(await readFile(path.join(f.server, "NewWorld", "level.dat"))).toEqual(world);
    expect(await f.library.list(f.binding, f.states.snapshot(f.serverId))).toMatchObject({ state: "inspection-required", mutationsAvailable: false });
    expect(f.start).toHaveBeenCalledOnce();
  });
  it.each(["before", "after"])("retains and explicitly continues failure %s rename without unsafe replay", async phase => {
    const f = await maturePhysicalFixture(undefined, false), renameActual = maturityIo.renameMaturityCatalog;
    const prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity`);
    let calls = 0;
    const spy = vi.spyOn(maturityIo, "renameMaturityCatalog").mockImplementation(async (...args) => {
      if (args[0] === prefix + ".tmp") { calls++; if (phase === "after") await renameActual(...args); throw new Error("injected-rename-response-loss"); }
      return renameActual(...args);
    });
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(calls).toBe(1); spy.mockRestore();
    expect(existsSync(prefix + ".json")).toBe(true); expect(existsSync(prefix + ".tmp")).toBe(phase === "before");
    const target = phase === "after" ? await generationReferenceObjectWitness(f.catalogFile) : await generationReferenceObjectWitness(prefix + ".tmp");
    const retrySpy = vi.spyOn(maturityIo, "renameMaturityCatalog");
    const result = await f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined);
    expect(result.catalog.objectIdentity).toBe(target);
    expect(retrySpy).toHaveBeenCalledTimes(phase === "before" ? 1 : 0);
  });
  it.each(["catalog", "staging"])("confirms a target7 after %s directory sync failure without another rename", async failed => {
    const f = await maturePhysicalFixture(undefined, false), sync = restoreFiles.syncRestoreDirectory;
    const directory = failed === "catalog" ? path.dirname(f.catalogFile) : path.join(f.manager, "active-worlds"); let injected = false;
    const spy = vi.spyOn(restoreFiles, "syncRestoreDirectory").mockImplementation(async file => {
      if (!injected && file === directory && JSON.parse(readFileSync(f.catalogFile, "utf8")).schemaVersion === 7) {
        injected = true; throw new Error("sync-failed");
      }
      return sync(file);
    });
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(injected).toBe(true); spy.mockRestore();
    const syncSpy = vi.spyOn(restoreFiles, "syncRestoreDirectory"), renameSpy = vi.spyOn(maturityIo, "renameMaturityCatalog");
    await f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined);
    expect(renameSpy).not.toHaveBeenCalled(); expect(syncSpy).toHaveBeenCalledWith(path.dirname(f.catalogFile));
    expect(syncSpy).toHaveBeenCalledWith(path.join(f.manager, "active-worlds"));
  });
  it.each(["orphan-stage", "partial-intent", "manual7"])("rejects ambiguous %s evidence without repair", async scenario => {
    const f = await maturePhysicalFixture(undefined, scenario === "manual7");
    const prefix = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-maturity`);
    if (scenario === "orphan-stage") await writeFile(prefix + ".tmp", "orphan");
    if (scenario === "partial-intent") { await writeFile(prefix + ".tmp", "staged"); await writeFile(prefix + ".json", "{partial"); }
    const before = await readFile(f.catalogFile);
    await expect(f.inspector.publishInitialMaturity(f.serverId, f.operation.id, f.issued.issuer, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(f.catalogFile)).toEqual(before);
    if (scenario === "orphan-stage") expect(await readFile(prefix + ".tmp", "utf8")).toBe("orphan");
    if (scenario === "partial-intent") expect(await readFile(prefix + ".json", "utf8")).toBe("{partial");
  });
});

describe("initial mature physical proof", () => {
  it("records bounded maturity timing evidence", async () => {
    const start = performance.now(), phases: { phase: string; elapsedMs: number }[] = [];
    const file = new URL(`../../../test-results/worlds-v2-maturity-timing-${randomUUID()}.json`, import.meta.url);
    const record = async (phase: string) => { phases.push({ phase, elapsedMs: performance.now() - start });
      await writeFile(file, JSON.stringify({ clock: "node-performance-monotonic", phases }) + "\n"); };
    await record("begin"); const f = await maturePhysicalFixture(record);
    await record("physical-verification-begin"); const proof = await f.verifyMature();
    await record("physical-verification-complete"); expect(proof.catalogPublicationVerified).toBe(false);
  });
  it("rejects a runtime becoming active during final metadata verification", async () => {
    const f = await maturePhysicalFixture(), read = f.library.readInitialMaturePublishedEvidence.bind(f.library); let calls = 0;
    vi.spyOn(f.library, "readInitialMaturePublishedEvidence").mockImplementation(async (...args) => {
      const value = await read(...args);
      if (++calls === 2) vi.spyOn(f.adapter, "getStatus").mockResolvedValue({ state: "running", ownership: "managed", recoveryRequired: false } as never);
      return value;
    });
    await expect(f.verifyMature()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" }); expect(calls).toBe(2);
  });
  it("verifies actual birth state while keeping publication and readiness unverified", async () => {
    const f = await maturePhysicalFixture(), proof = await f.verifyMature();
    expect(proof).toMatchObject({ phase: "initial-mature-generation-current-state", inspectionOnly: true, recoveryRequired: true,
      catalogPublicationVerified: false, birthProofDigest: f.issued.reference.proofDigest,
      genesisCatalogRevision: f.reference.snapshot.checksum });
    expect(proof.catalogRevision).toBe(createHash("sha256").update(await readFile(f.catalogFile)).digest("hex"));
    expect(proof.catalogRevision).not.toBe(proof.genesisCatalogRevision);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it.each(["pending", "external-active", "level", "extra-file", "running", "properties", "issuer"])("rejects mature physical %s", async scenario => {
    const f = await maturePhysicalFixture();
    if (scenario === "pending") { const slot = JSON.parse(await readFile(f.files.slot, "utf8")); slot.state = "pending-generation"; await writeFile(f.files.slot, JSON.stringify(slot) + "\n"); }
    if (scenario === "external-active") { const bytes = await readFile(f.files.slot); await rename(f.files.slot, f.files.slot + ".retained"); await writeFile(f.files.slot, bytes); }
    if (scenario === "level") await writeFile(path.join(f.server, "NewWorld", "level.dat"), testWorldLevel("changed", true, 5023));
    if (scenario === "extra-file") await writeFile(path.join(f.server, "NewWorld", "extra.dat"), "external");
    if (scenario === "running") vi.spyOn(f.adapter, "getStatus").mockResolvedValue({ state: "running", ownership: "managed", recoveryRequired: false } as never);
    if (scenario === "properties") await writeFile(path.join(f.server, "server.properties"), "level-name=NewWorld\nmotd=changed\n");
    if (scenario === "issuer") { const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`), bytes = await readFile(file); await rename(file, file + ".retained"); await writeFile(file, bytes); }
    await expect(f.verifyMature()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["catalog", "receipt"])("rejects %s drift during physical verification", async scenario => {
    const f = await maturePhysicalFixture(); let changed = false;
    vi.spyOn(f.adapter, "revalidateBeforeStart").mockImplementationOnce(async () => {
      changed = true;
      if (scenario === "catalog") { const bytes = await readFile(f.catalogFile); await rename(f.catalogFile, f.catalogFile + ".retained"); await writeFile(f.catalogFile, bytes); }
      else { const record = (await f.store.list()).find(record => record.operation.id === f.operation.id)!;
        await f.store.save({ ...record, operation: { ...record.operation, updatedAt: "2026-11-01T00:00:00Z" } }); }
    });
    await expect(f.verifyMature()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" }); expect(changed).toBe(true);
  });
  it.each(["tree", "catalog", "receipt"])("rechecks original %s baseline rather than accepting a new observation", async scenario => {
    const f = await maturePhysicalFixture(), proof = await f.verifyMature();
    if (scenario === "tree") await writeFile(path.join(f.server, "NewWorld", "later.dat"), "external-content");
    if (scenario === "catalog") {
      const bytes = await readFile(f.catalogFile); await rename(f.catalogFile, f.catalogFile + ".retained"); await writeFile(f.catalogFile, bytes);
      // Caller-visible data is not the captured private baseline.
      proof.catalogObjectIdentity = await generationReferenceObjectWitness(f.catalogFile);
    }
    if (scenario === "receipt") {
      const record = (await f.store.list()).find(record => record.operation.id === f.operation.id)!;
      await f.store.save({ ...record, operation: { ...record.operation, updatedAt: "2026-11-01T00:00:00Z" } });
    }
    await expect(proof.recheck()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("detaches and expires the private view and refuses unsupported getters", async () => {
    const f = await maturePhysicalFixture(), original = currentStateVerification.verifyGenerationCurrentState;
    let escaped: (() => Promise<unknown>) | undefined;
    vi.spyOn(currentStateVerification, "verifyGenerationCurrentState").mockImplementationOnce(async (...args) => {
      const view = args[2]; escaped = () => view.readPublishedGenerationEvidence(f.binding, f.journal, f.store);
      const first = await escaped() as Awaited<ReturnType<typeof f.library.readPublishedGenerationEvidence>>;
      first.prepared.reservation.nextName = "mutated";
      expect((await view.readPublishedGenerationEvidence(f.binding, f.journal, f.store)).prepared.reservation.nextName).toBe("NewWorld");
      await expect(view.readPreparedGeneration(f.binding, f.journal)).rejects.toThrow();
      return original(...args);
    });
    await f.verifyMature(); expect(escaped).toBeDefined(); await expect(escaped!()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
});

describe("initial mature catalog inspection only", () => {
  it.each(["prepare-catalog", "prepare-generation", "inspect-catalog", "inspect-generation"])("rejects late pending evidence in %s", async scenario => {
    const f = await maturityFixture(), inspect = scenario.startsWith("inspect");
    if (inspect) await writeFile(f.catalogFile, JSON.stringify(f.prepared.candidate) + "\n");
    const read = privateFiles.readPrivatePropertiesFile; let calls = 0;
    const pending = scenario.endsWith("catalog") ? path.join(path.dirname(f.catalogFile), "late.tmp") : f.files.stage;
    vi.spyOn(privateFiles, "readPrivatePropertiesFile").mockImplementation(async (...args) => {
      const saved = await read(...args);
      if (args[0] === f.catalogFile && ++calls === 2) writeFileSync(pending, "pending-evidence");
      return saved;
    });
    const action = inspect ? f.inspectMature() : f.library.prepareInitialGenerationMaturity(f.binding, f.reference.snapshot.checksum,
      f.operation.id, f.issued.issuer, f.binding.registeredExecutionDigest, f.journal, f.store, () => undefined);
    await expect(action).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(pending, "utf8")).toBe("pending-evidence");
  });
  it("normalizes malformed schema7 errors and captures caller binding aliases", async () => {
    const f = await maturityFixture(); await writeFile(f.catalogFile, "{");
    await expect(f.inspectMature()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await writeFile(f.catalogFile, JSON.stringify(f.prepared.candidate) + "\n");
    const binding = { ...f.binding };
    const result = await f.library.inspectInitialGenerationMaturity(binding, f.binding.registeredExecutionDigest, f.journal, f.store, () => {
      binding.serverId = "other"; binding.rootPath = f.manager; return undefined;
    });
    expect(result.catalog.serverId).toBe(f.serverId); expect(result.catalogPublicationVerified).toBe(false);
  });
  it("prepares through the owned service lease without changing schema6", async () => {
    const f = await historicalReferenceFixture();
    const issued = await f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
    const result = await f.inspector.prepareInitialMaturity(f.serverId, f.operation.id, issued.issuer, () => undefined);
    expect(result).toMatchObject({ inspectionOnly: true, recoveryRequired: true, catalogPublicationVerified: false });
    expect(JSON.parse(await readFile(path.join(f.manager, "world-library", f.serverId, "state.json"), "utf8")).schemaVersion).toBe(6);
  });
  it("prepares detached candidate metadata without writing or granting publication", async () => {
    const f = await maturityFixture(), bytes = await readFile(f.catalogFile);
    expect(JSON.parse(bytes.toString()).schemaVersion).toBe(6);
    expect(f.prepared).toMatchObject({ inspectionOnly: true, recoveryRequired: true, catalogPublicationVerified: false,
      candidate: { schemaVersion: 7, generationGenesis: { worldId: f.target.worldId } } });
    expect(f.prepared.candidate.entries[1]?.origin).toBe("generation");
    f.prepared.candidate.entries[1]!.levelName = "mutated-candidate";
    expect(await readFile(f.catalogFile)).toEqual(bytes);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("reads staged7 explicitly while ordinary readers and mutators remain closed", async () => {
    const f = await maturityFixture();
    await writeFile(f.catalogFile, JSON.stringify(f.prepared.candidate) + "\n");
    expect(await f.inspectMature()).toMatchObject({ inspectionOnly: true, recoveryRequired: true, catalogPublicationVerified: false,
      catalog: { schemaVersion: 7 } });
    expect(await f.library.list(f.binding, f.states.snapshot(f.serverId))).toMatchObject({ state: "inspection-required", mutationsAvailable: false });
    const bytes = await readFile(f.catalogFile);
    await expect(f.library.migrateLegacy(f.binding, f.states.snapshot(f.serverId)!)).rejects.toThrow();
    expect(await readFile(f.catalogFile)).toEqual(bytes);
  });
  it.each(["timestamp", "entry-order", "origin", "issuer", "world", "journal", "receipt", "other-pending"])("rejects mature %s tampering", async scenario => {
    const f = await maturityFixture(), candidate = structuredClone(f.prepared.candidate);
    if (scenario === "timestamp") candidate.entries[1]!.createdAt = "2026-10-30T00:00:00Z";
    if (scenario === "entry-order") candidate.entries.reverse();
    if (scenario === "origin") candidate.entries[1]!.origin = "import";
    if (scenario === "issuer") candidate.generationGenesis.issuer.objectIdentity = "0".repeat(64);
    if (scenario === "world") candidate.generationGenesis.worldId = `worldv2-${randomUUID()}`;
    await writeFile(f.catalogFile, JSON.stringify(candidate) + "\n");
    if (scenario === "journal") {
      const scan = await f.journal.scan();
      vi.spyOn(f.journal, "scan").mockResolvedValue({ ...scan, records: [...scan.records, { ...scan.records[0]!, transactionId: randomUUID() }] });
    }
    if (scenario === "receipt" || scenario === "other-pending") {
      const records = await f.store.list();
      const extra = { ...records[0]!, operation: { ...records[0]!.operation, id: randomUUID(), kind: "backup" as const, state: "running" as const } };
      delete extra.worldGenerationExecution;
      vi.spyOn(f.store, "list").mockResolvedValue(scenario === "receipt" ? records.map(record => ({ ...record,
        operation: { ...record.operation, updatedAt: "2026-10-30T00:00:00Z" } })) : [...records, extra]);
    }
    await expect(f.inspectMature()).rejects.toThrow();
  });
  it("rejects a same-byte schema7 catalog replaced during inspection", async () => {
    const f = await maturityFixture(); await writeFile(f.catalogFile, JSON.stringify(f.prepared.candidate) + "\n");
    const read = privateFiles.readPrivatePropertiesFile; let changed = false;
    vi.spyOn(privateFiles, "readPrivatePropertiesFile").mockImplementation(async (...args) => {
      const saved = await read(...args);
      if (!changed && args[0] === f.catalogFile) { changed = true; renameSync(f.catalogFile, f.catalogFile + ".retained"); writeFileSync(f.catalogFile, saved.bytes); }
      return saved;
    });
    await expect(f.inspectMature()).rejects.toThrow(); expect(changed).toBe(true);
  });
});

describe("durable genesis reference issuer", () => {
  it("re-confirms a lost response without replacing the issued anchor", async () => {
    const f = await historicalReferenceFixture();
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`);
    await expect(f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => {
      if (existsSync(file)) throw new Error("lost-response"); return undefined;
    })).rejects.toThrow("lost-response");
    const bytes = await readFile(file), original = await generationReferenceObjectWitness(file);
    const service = new WorldGenerationService(f.registry, f.ops, f.journal, f.backups, f.manager, f.library, f.store);
    const previous = cleanupOwners.get(f.root)!; cleanupOwners.set(f.root, async () => { await service.close(); await previous(); });
    const result = await service.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
    expect(await readFile(file)).toEqual(bytes);
    expect(await generationReferenceObjectWitness(file)).toBe(original);
    expect(result.issuer).toEqual({ checksum: createHash("sha256").update(bytes).digest("hex"), objectIdentity: original });
    expect(result.reference.schemaVersion).toBe(2);
  });
  it.each(["snapshot", "completion", "intent", "birth", "execution", "anchor"])("rejects pre-entry replacement of issued %s", async kind => {
    const f = await historicalReferenceFixture();
    const result = await f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
    const file = kind === "snapshot" ? f.snapshotFile : kind === "completion" ? f.files.completion : kind === "intent" ? f.files.intent :
      path.join(f.manager, "world-library", `${f.serverId}.${kind === "anchor" ? "identity" : `generation-${kind}`}.json`);
    const bytes = await readFile(file); await rename(file, file + ".retained"); await writeFile(file, bytes);
    await expect(inspectIssuedGenerationReference(f.manager, f.serverId, f.operation.id, f.binding, result.issuer, () => undefined))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(existsSync(file + ".retained")).toBe(true);
  });
  it("rejects same-byte issuer-anchor replacement against its external proof", async () => {
    const f = await historicalReferenceFixture();
    const result = await f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`), bytes = await readFile(file);
    await rename(file, file + ".retained"); await writeFile(file, bytes);
    await expect(inspectIssuedGenerationReference(f.manager, f.serverId, f.operation.id, f.binding, result.issuer, () => undefined))
      .rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["write", "read"])("rejects late stage recreation during final issuer-anchor %s readback", async entry => {
    const f = await historicalReferenceFixture();
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`);
    const issued = entry === "read" ? await f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined) : null;
    const read = privateFiles.readPrivatePropertiesFile; let calls = 0;
    vi.spyOn(privateFiles, "readPrivatePropertiesFile").mockImplementation(async (...args) => {
      const saved = await read(...args);
      if (args[0] === file && ++calls === (entry === "read" ? 2 : 1)) writeFileSync(f.files.stage, "late-stage");
      return saved;
    });
    const action = issued ? inspectIssuedGenerationReference(f.manager, f.serverId, f.operation.id, f.binding, issued.issuer, () => undefined) :
      f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
    await expect(action).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(f.files.stage, "utf8")).toBe("late-stage"); expect(existsSync(file)).toBe(true);
  });
  it("retains an anchor when its owner closes during verification", async () => {
    const f = await historicalReferenceFixture(); let closing: Promise<void> | undefined;
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`);
    await expect(f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => {
      if (existsSync(file) && !closing) closing = f.inspector.close(); return undefined;
    })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await closing; expect(existsSync(file)).toBe(true); expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("rejects snapshot replacement after issuing but before full verification", async () => {
    const f = await historicalReferenceFixture(); let changed = false;
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`);
    await expect(f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => {
      if (existsSync(file) && !changed) { changed = true; const bytes = readFileSync(f.snapshotFile); renameSync(f.snapshotFile, f.snapshotFile + ".retained"); writeFileSync(f.snapshotFile, bytes); }
      return undefined;
    })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(changed).toBe(true); expect(existsSync(file)).toBe(true);
  });
  it("issues a strong durable anchor and verifies it without opening readiness", async () => {
    const f = await historicalReferenceFixture();
    const result = await f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
    expect(result).toMatchObject({ inspectionOnly: true, recoveryRequired: true, reference: { schemaVersion: 2 } });
    const inspected = await inspectIssuedGenerationReference(f.manager, f.serverId, f.operation.id, f.binding, result.issuer, () => undefined);
    expect(inspected.seed.worldId).toBe(f.target.worldId);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true); expect(f.start).toHaveBeenCalledOnce();
    await expect(inspectIssuedGenerationReference(f.manager, f.serverId, f.operation.id, f.binding, result.reference, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["pending", "snapshot", "completion"])("never writes when %s evidence is unavailable", async scenario => {
    const f = scenario === "pending" ? await inspectionFixture() : await historicalReferenceFixture();
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`);
    if (scenario !== "pending") await rename(scenario === "snapshot" ?
      path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`) : slotPaths(f).completion,
      path.join(f.manager, "active-worlds", `${scenario}.retained`));
    const before = await readdir(path.dirname(file));
    await expect(f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(existsSync(file)).toBe(false); expect(await readdir(path.dirname(file))).toEqual(before);
  });
  it("retains a partial durable anchor without repair", async () => {
    const f = await historicalReferenceFixture();
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`);
    await writeFile(file, "{partial");
    await expect(f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(file, "utf8")).toBe("{partial");
  });
  it("retains a conflicting canonical durable anchor without replacement", async () => {
    const f = await historicalReferenceFixture();
    const result = await f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined);
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`);
    const text = JSON.stringify({ ...result.reference, rootIdentity: "0".repeat(64) }) + "\n";
    await writeFile(file, text); const object = await generationReferenceObjectWitness(file);
    await expect(f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(file, "utf8")).toBe(text); expect(await generationReferenceObjectWitness(file)).toBe(object);
  });
  it("retains an issued anchor after authorization loss", async () => {
    const f = await historicalReferenceFixture();
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-reference.json`);
    await expect(f.inspector.sealPublishedGenesisReference(f.serverId, f.operation.id, () => {
      if (existsSync(file)) throw new Error("revoked"); return undefined;
    })).rejects.toThrow("revoked");
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(2);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
});

describe("historical genesis reference inspection", () => {
  it("rejects a self-consistent birth link with different execution metadata", async () => {
    const f = await historicalReferenceFixture(), birthFile = path.join(f.manager, "world-library", `${f.serverId}.generation-birth.json`);
    const birth = JSON.parse(await readFile(birthFile, "utf8"));
    birth.execution.registeredExecutionDigest = "c".repeat(64);
    birth.execution.requestDigest = generationExecutionFingerprint(birth.execution);
    await writeFile(birthFile, JSON.stringify(birth) + "\n");
    const changedBirth = await privateFiles.readPrivatePropertiesFile(birthFile); changedBirth.bytes.fill(0);
    const snapshot = JSON.parse(await readFile(f.snapshotFile, "utf8"));
    snapshot.generationPublication.birthChecksum = changedBirth.checksum; snapshot.generationPublication.birthIdentity = changedBirth.identity;
    await writeFile(f.snapshotFile, JSON.stringify(snapshot) + "\n");
    const changedSnapshot = await privateFiles.readPrivatePropertiesFile(f.snapshotFile); changedSnapshot.bytes.fill(0);
    f.reference.snapshot = { checksum: changedSnapshot.checksum, identity: changedSnapshot.identity };
    const completion = JSON.parse(await readFile(f.files.completion, "utf8"));
    completion.birth = { checksum: changedBirth.checksum, identity: changedBirth.identity }; completion.catalogRevision = changedSnapshot.checksum;
    await writeFile(f.files.completion, JSON.stringify(completion) + "\n");
    const changedCompletion = await privateFiles.readPrivatePropertiesFile(f.files.completion); changedCompletion.bytes.fill(0);
    f.reference.completion = { checksum: changedCompletion.checksum, identity: changedCompletion.identity };
    await expect(f.readReference()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("retains original evidence independently of later mutable catalog and slot bytes", async () => {
    const f = await historicalReferenceFixture();
    const result = await f.readReference();
    expect(result).toMatchObject({ inspectionOnly: true, recoveryRequired: true, seed: { worldId: f.target.worldId, origin: "generation" } });
    await writeFile(path.join(f.manager, "world-library", f.serverId, "state.json"), "later-unverified-catalog");
    await writeFile(f.files.slot, "later-unverified-slot");
    expect(await f.readReference()).toEqual(result);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it.each(["snapshot", "completion", "intent", "birth", "execution", "anchor", "stage", "registration", "server", "root"])("rejects historical %s drift", async scenario => {
    const f = await historicalReferenceFixture();
    if (scenario === "registration") f.binding.registeredExecutionDigest = "0".repeat(64);
    else if (scenario === "server") f.binding.serverId = "other";
    else if (scenario === "root") f.binding.rootPath = f.manager;
    else if (scenario === "stage") await writeFile(f.files.stage, "partial");
    else {
      const file = scenario === "snapshot" ? f.snapshotFile : scenario === "completion" ? f.files.completion : scenario === "intent" ? f.files.intent :
        path.join(f.manager, "world-library", `${f.serverId}.${scenario === "anchor" ? "identity" : `generation-${scenario}`}.json`);
      if (scenario === "snapshot" || scenario === "completion" || scenario === "intent" || scenario === "birth") {
        const bytes = await readFile(file); await rename(file, file + ".retained"); await writeFile(file, bytes);
      } else await writeFile(file, "{}");
    }
    await expect(f.readReference()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("rejects a snapshot replaced during readback and retains evidence", async () => {
    const f = await historicalReferenceFixture(), read = privateFiles.readPrivatePropertiesFile; let swapped = false;
    const evidence: Record<string, string> = {};
    vi.spyOn(privateFiles, "readPrivatePropertiesFile").mockImplementation(async (...args) => {
      const saved = await read(...args);
      if (!swapped && args[0] === f.snapshotFile) {
        swapped = true; renameSync(f.snapshotFile, f.snapshotFile + ".retained"); writeFileSync(f.snapshotFile, saved.bytes);
        evidence.before = saved.identity;
        const changed = await read(f.snapshotFile); evidence.after = changed.identity; changed.bytes.fill(0);
        const oldStat = await lstat(f.snapshotFile + ".retained", { bigint: true }), newStat = await lstat(f.snapshotFile, { bigint: true });
        evidence.oldInode = oldStat.ino.toString(); evidence.newInode = newStat.ino.toString();
        evidence.oldBirthNs = oldStat.birthtimeNs.toString(); evidence.newBirthNs = newStat.birthtimeNs.toString();
      }
      return saved;
    });
    const outcome = await f.readReference().then(() => "resolved", (error: { code?: string }) => error.code);
    await writeFile(new URL(`../../../test-results/worlds-v2-genesis-identity-${randomUUID()}.json`, import.meta.url),
      JSON.stringify({ outcome, ...evidence }) + "\n");
    expect({ outcome, ...evidence }).toMatchObject({ outcome: "RECOVERY_REQUIRED" });
    expect(swapped).toBe(true); expect(existsSync(f.snapshotFile + ".retained")).toBe(true);
  });
  it("rejects revoked or asynchronous authorization without writing", async () => {
    const f = await historicalReferenceFixture(), before = await readdir(path.dirname(f.snapshotFile));
    await expect(f.readReference(() => { throw new Error("revoked"); })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(f.readReference((() => Promise.resolve()) as never)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readdir(path.dirname(f.snapshotFile))).toEqual(before);
  });
  it("rejects bigint object replacement even when legacy IDs are equal", async () => {
    const f = await historicalReferenceFixture(), read = privateFiles.readPrivatePropertiesFile; let swapped = false;
    vi.spyOn(privateFiles, "readPrivatePropertiesFile").mockImplementation(async (...args) => {
      const saved = await read(...args);
      if (args[0] === f.snapshotFile) {
        if (!swapped) { swapped = true; renameSync(f.snapshotFile, f.snapshotFile + ".retained"); writeFileSync(f.snapshotFile, saved.bytes); }
        // Deterministic legacy-identity alias: the stronger witness must reject
        // the actual filesystem change even if all old hash/id reads agree.
        return { ...saved, checksum: f.reference.snapshot.checksum, identity: f.reference.snapshot.identity };
      }
      return saved;
    });
    await expect(f.readReference()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(swapped).toBe(true); expect(existsSync(f.snapshotFile + ".retained")).toBe(true);
  });
});

describe("append-only generation completion evidence", () => {
  it("preserves original genesis snapshot bytes after verified completion", async () => {
    const f = await inspectionFixture();
    await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
    const source = await readFile(path.join(f.manager, "world-library", f.serverId, "state.json"));
    const result = await f.inspector.sealPublishedGenesis(f.serverId, f.operation.id, () => undefined);
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`);
    expect(await readFile(file)).toEqual(source);
    expect(result).toMatchObject({ inspectionOnly: true, recoveryRequired: true, seed: { worldId: f.target.worldId, origin: "generation" } });
    expect(result.snapshot.checksum).toBe(createHash("sha256").update(source).digest("hex"));
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(f.start).toHaveBeenCalledOnce();
  });
  it("does not create completion or change a pending slot for genesis preservation", async () => {
    const f = await inspectionFixture(), files = slotPaths(f), before = await readFile(files.slot);
    await expect(f.inspector.sealPublishedGenesis(f.serverId, f.operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(files.slot)).toEqual(before); expect(existsSync(files.completion)).toBe(false);
  });
  it("retains conflicting genesis snapshot evidence without overwrite", async () => {
    const f = await inspectionFixture();
    await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`);
    await writeFile(file, "partial");
    await expect(f.inspector.sealPublishedGenesis(f.serverId, f.operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(file, "utf8")).toBe("partial");
  });
  it("reads identical existing genesis evidence through a reconstructed service", async () => {
    const f = await inspectionFixture();
    await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
    const source = await readFile(path.join(f.manager, "world-library", f.serverId, "state.json"));
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`);
    await writeFile(file, source);
    const service = new WorldGenerationService(f.registry, f.ops, f.journal, f.backups, f.manager, f.library, f.store);
    const previous = cleanupOwners.get(f.root)!; cleanupOwners.set(f.root, async () => { await service.close(); await previous(); });
    const original = await privateFiles.readPrivatePropertiesFile(file); original.bytes.fill(0);
    const result = await service.sealPublishedGenesis(f.serverId, f.operation.id, () => undefined);
    expect(result.snapshot.identity).toBe(original.identity); expect(await readFile(file)).toEqual(source);
  });
  it("retains newly written genesis evidence when authorization is revoked", async () => {
    const f = await inspectionFixture();
    await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`);
    await expect(f.inspector.sealPublishedGenesis(f.serverId, f.operation.id, () => {
      if (existsSync(file)) throw new Error("revoked"); return undefined;
    })).rejects.toThrow("revoked");
    expect(await readFile(file)).toEqual(await readFile(path.join(f.manager, "world-library", f.serverId, "state.json")));
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("never recreates completion lost between genesis pre-read and confirmation", async () => {
    const f = await inspectionFixture(), files = slotPaths(f);
    await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
    const read = privateFiles.readPrivatePropertiesFile; let removed = false;
    vi.spyOn(privateFiles, "readPrivatePropertiesFile").mockImplementation(async (...args) => {
      const value = await read(...args);
      if (!removed && args[0] === files.completion) { removed = true; renameSync(files.completion, files.completion + ".retained"); }
      return value;
    });
    await expect(f.inspector.sealPublishedGenesis(f.serverId, f.operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(removed).toBe(true); expect(existsSync(files.completion)).toBe(false);
    expect(existsSync(files.completion + ".retained")).toBe(true);
  });
  it.each(["intent", "stage", "snapshot"])("rejects late %s drift after genesis snapshot write", async scenario => {
    const f = await inspectionFixture(), files = slotPaths(f);
    await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
    const file = path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`);
    let changed = false;
    await expect(f.inspector.sealPublishedGenesis(f.serverId, f.operation.id, () => {
      if (!changed && existsSync(file)) {
        changed = true;
        if (scenario === "stage") writeFileSync(files.stage, "late-stage");
        else if (scenario === "snapshot") { const bytes = readFileSync(file); renameSync(file, file + ".retained"); writeFileSync(file, bytes); }
        else { const bytes = readFileSync(files.intent); renameSync(files.intent, files.intent + ".retained"); writeFileSync(files.intent, bytes); }
      }
      return undefined;
    })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(changed).toBe(true); expect(existsSync(file)).toBe(true);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("refuses active genesis without an existing completion record", async () => {
    const f = await inspectionFixture(), files = slotPaths(f);
    await f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined);
    await expect(f.inspector.sealPublishedGenesis(f.serverId, f.operation.id, () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(existsSync(files.completion)).toBe(false);
    expect(existsSync(path.join(f.manager, "active-worlds", `${f.serverId}.${f.operation.id}.generation-genesis.json`))).toBe(false);
  });
  it("extracts an immutable genesis seed without granting readiness", async () => {
    const f = await inspectionFixture(), proof = await f.verify();
    const bytes = await readFile(path.join(f.manager, "world-library", f.serverId, "state.json")), original = Buffer.from(bytes);
    const expected = { serverId: f.serverId, catalogRevision: proof.catalogRevision, worldId: f.target.worldId,
      executionOperationId: f.operation.id, recordDigest: proof.recordDigest };
    const seed = inspectGenerationGenesisSnapshot(bytes, expected);
    expect(seed).toMatchObject({ origin: "generation", worldId: f.target.worldId, inspectionOnly: true });
    expect(Object.isFrozen(seed)).toBe(true);
    expect(inspectGenerationGenesisSnapshot(bytes, expected)).toEqual(seed);
    const initial = projectGenerationWorldHistory(bytes, expected, []);
    expect(projectGenerationJournalHistory(bytes, expected, []).projection).toEqual(initial);
    expect(initial.activeWorldId).toBe(seed.worldId); expect(initial.transactionIds).toEqual([]);
    expect(initial.worlds).toHaveLength(2); expect(initial.genesis.origin).toBe("generation");
    const at = clock.now().toISOString();
    const successor: TransactionJournalRecord = { schemaVersion: 10, transactionId: randomUUID(), state: "committed",
      updatedAt: at, checkpoints: [], intent: { operationId: randomUUID(), serverId: seed.serverId, kind: "world-activate",
        scope: "world-set", resourceId: seed.previousWorldId, allowStop: false, originalState: "stopped", createdAt: at, paths: [],
        worldActivation: { rootIdentity: seed.rootIdentity, catalogId: seed.catalogId, worldId: seed.previousWorldId,
          previousWorldId: seed.worldId, previousName: seed.levelName, nextName: seed.previousLevelName,
          libraryRevision: "a".repeat(64), currentWorldRevision: "b".repeat(64), targetWorldRevision: "c".repeat(64),
          currentContentChecksum: "d".repeat(64), targetContentChecksum: "e".repeat(64), currentDirectoryIdentity: seed.directoryIdentity,
          targetDirectoryIdentity: seed.previousDirectoryIdentity, sourceImportTransactionId: randomUUID(), sourceImportChecksum: "f".repeat(64),
          predecessorTransactionId: null, sequence: 1, guardBackupId: randomUUID(), propertiesBefore: "a".repeat(64), propertiesAfter: "b".repeat(64),
          workspaceName: ".manager-structural-fixture" } } };
    const savedSuccessor = JSON.stringify(successor), journalProjection = projectGenerationJournalHistory(bytes, expected, [successor]);
    expect(journalProjection.records[0]).toBe(successor);
    expect(JSON.stringify(successor)).toBe(savedSuccessor);
    expect(journalProjection.projection.activeWorldId).toBe(seed.previousWorldId);
    for (const forbidden of [{ ...successor, transactionId: seed.preparationTransactionId },
      { ...successor, intent: { ...successor.intent, operationId: seed.executionOperationId } },
      { ...successor, intent: { ...successor.intent, worldActivation: { ...successor.intent.worldActivation!, guardBackupId: seed.guardBackupId } } }]) {
      expect(() => projectGenerationJournalHistory(bytes, expected, [forbidden])).toThrow();
    }
    const first = { kind: "replacement" as const, serverId: seed.serverId, catalogId: seed.catalogId, rootIdentity: seed.rootIdentity,
      transactionId: randomUUID(), operationId: randomUUID(), guardBackupId: randomUUID(), sequence: 1, predecessorTransactionId: null,
      previous: { worldId: seed.worldId, levelName: seed.levelName, directoryIdentity: seed.directoryIdentity },
      next: { worldId: `worldv2-${randomUUID()}`, levelName: seed.levelName, directoryIdentity: "f".repeat(64) } };
    const replaced = projectGenerationWorldHistory(bytes, expected, [first]);
    expect(replaced.retiredWorldIds).toEqual([seed.worldId]); expect(replaced.genesis).toEqual(seed);
    expect(replaced.worlds).toContainEqual(expect.objectContaining({ worldId: seed.previousWorldId, state: "present" }));
    for (const forbidden of [{ ...first, transactionId: seed.preparationTransactionId },
      { ...first, operationId: seed.preparationOperationId }, { ...first, operationId: seed.executionOperationId },
      { ...first, guardBackupId: seed.guardBackupId }]) {
      expect(() => projectGenerationWorldHistory(bytes, expected, [forbidden])).toThrow();
    }
    expect(bytes).toEqual(original);
    for (const field of ["serverId", "worldId", "executionOperationId", "recordDigest", "catalogRevision"] as const) {
      expect(() => inspectGenerationGenesisSnapshot(bytes, { ...expected, [field]: "invalid" })).toThrow();
    }
    const changed = JSON.parse(bytes.toString("utf8")); changed.schemaVersion = 7;
    const unsupported = Buffer.from(JSON.stringify(changed) + "\n");
    expect(() => inspectGenerationGenesisSnapshot(unsupported, { ...expected,
      catalogRevision: createHash("sha256").update(unsupported).digest("hex") })).toThrow();
    expect(() => inspectGenerationGenesisSnapshot(Buffer.concat([bytes, Buffer.from(" ")]), expected)).toThrow();
    for (const invalid of [Buffer.from("{"), Buffer.alloc(1024 * 1024 + 1), Buffer.from(JSON.stringify(JSON.parse(bytes.toString("utf8"))))]) {
      expect(() => inspectGenerationGenesisSnapshot(invalid, { ...expected,
        catalogRevision: createHash("sha256").update(invalid).digest("hex") })).toThrow();
    }
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("re-verifies completion after an advancing-clock Manager reconstruction without rewriting generation receipts", async () => {
    const f = await inspectionFixture(), files = slotPaths(f);
    const first = await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
    const records = (await f.store.list()).filter(record => record.operation.serverId === f.serverId);
    const receiptBytes = await Promise.all(records.map(record => readFile(path.join(f.manager, "operations", `${record.operation.id}.json`))));
    const ordinaryId = randomUUID(), template = records[0]!;
    await f.store.save({ operation: { ...template.operation, id: ordinaryId, serverId: "other-instance", kind: "backup", state: "running" },
      idempotencyKey: randomUUID(), requestFingerprint: "a".repeat(64), expiresAt: template.expiresAt });
    const lateClock = { now: () => new Date("2026-11-29T18:00:00Z") }, restarted = new OperationService(f.store, lateClock, f.journal);
    await restarted.initialize();
    expect(await Promise.all(records.map(record => readFile(path.join(f.manager, "operations", `${record.operation.id}.json`))))).toEqual(receiptBytes);
    expect(restarted.get(f.operation.id)?.state).toBe("interrupted"); expect(restarted.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect((await f.store.list()).find(record => record.operation.id === ordinaryId)?.operation).toMatchObject({ state: "interrupted", updatedAt: lateClock.now().toISOString() });
    const service = new WorldGenerationService(f.registry, restarted, f.journal, f.backups, f.manager, f.library, f.store);
    const prior = cleanupOwners.get(f.root)!; cleanupOwners.set(f.root, async () => { await service.close(); await prior(); });
    expect((await service.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined)).completion).toEqual(first.completion);
    expect(existsSync(files.completion)).toBe(true); expect(f.start).toHaveBeenCalledOnce();
  });
  it.each(["slot", "completion"])("never commits when late completion appears through the %s entry", async entry => {
    const f = await inspectionFixture(), files = slotPaths(f); let created = false;
    const invoke = entry === "slot" ? f.inspector.commitPublishedSlot.bind(f.inspector) : f.inspector.sealPublishedCompletion.bind(f.inspector);
    await expect(invoke(f.serverId, f.operation.id, () => {
      if (!created && existsSync(files.intent)) { created = true; writeFileSync(files.completion, "{late-partial"); }
      return undefined;
    })).rejects.toThrow();
    expect(created).toBe(true); expect(JSON.parse(await readFile(files.slot, "utf8")).state).toBe("pending-generation");
    expect(existsSync(files.stage)).toBe(true); expect(existsSync(files.intent)).toBe(true);
    expect(await readFile(files.completion, "utf8")).toBe("{late-partial");
  });
  it("publishes and re-reads completion without mutating raw receipts, snapshot or recovery causes", async () => {
    const f = await inspectionFixture(), files = slotPaths(f), before = await f.store.list();
    const result = await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined);
    expect(result).toMatchObject({ phase: "completion-evidence-awaiting-readiness", inspectionOnly: true, recoveryRequired: true, worldId: f.target.worldId });
    const saved = await readFile(files.completion), slot = await readFile(files.slot);
    expect((await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined)).completion).toEqual(result.completion);
    expect(await readFile(files.completion)).toEqual(saved); expect(await readFile(files.slot)).toEqual(slot);
    expect(await f.store.list()).toEqual(before); expect(f.states.snapshot(f.serverId)?.state).toBe("pending-generation");
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true); expect(f.start).toHaveBeenCalledOnce();
  });
  it("never invokes CAS or repairs a pending slot when even partial completion already exists", async () => {
    const f = await inspectionFixture(), files = slotPaths(f), before = await readFile(files.slot);
    await writeFile(files.completion, "{partial");
    await expect(f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined)).rejects.toThrow();
    await expect(f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined)).rejects.toThrow();
    expect(await readFile(files.slot)).toEqual(before); expect(await readFile(files.completion, "utf8")).toBe("{partial");
    expect(existsSync(files.stage)).toBe(false); expect(existsSync(files.intent)).toBe(false);
  });
  it("retains a fully published completion after lost response and permits only explicit re-verification", async () => {
    const f = await inspectionFixture(), files = slotPaths(f), before = await f.store.list();
    await expect(f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => {
      if (existsSync(files.completion)) throw new Error("response authority lost"); return undefined;
    })).rejects.toThrow();
    const saved = await readFile(files.completion);
    expect((await f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => undefined)).phase).toBe("completion-evidence-awaiting-readiness");
    expect(await readFile(files.completion)).toEqual(saved); expect(await f.store.list()).toEqual(before);
  });
  it.each(["replace", "corrupt", "stage"])("rejects %s during completion publication and retains evidence", async scenario => {
    const f = await inspectionFixture(), files = slotPaths(f); let changed = false;
    await expect(f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => {
      if (!changed && existsSync(files.completion)) {
        changed = true;
        if (scenario === "replace") { const bytes = readFileSync(files.completion); renameSync(files.completion, files.completion + ".retained"); writeFileSync(files.completion, bytes); }
        if (scenario === "corrupt") writeFileSync(files.completion, "{corrupt");
        if (scenario === "stage") writeFileSync(files.stage, "unexpected stage");
      }
      return undefined;
    })).rejects.toThrow();
    expect(changed).toBe(true); expect(existsSync(files.completion)).toBe(true); expect(existsSync(files.intent)).toBe(true);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("does not create artifacts on write-before authorization failure or a mutated proof", async () => {
    const f = await inspectionFixture(), files = slotPaths(f), directory = path.dirname(files.slot), before = await readdir(directory);
    await expect(f.inspector.sealPublishedCompletion(f.serverId, f.operation.id, () => { throw new Error("denied"); })).rejects.toThrow();
    const proof = await f.verify(); proof.operationId = randomUUID();
    await expect(sealGenerationCompletion(f.manager, proof, f.verify, () => undefined)).rejects.toThrow();
    expect(await readdir(directory)).toEqual(before);
  });
});

describe("leased published-generation inspection", () => {
  it("keeps a write guard private to its own lifetime and never passes it to the read-only callback", async () => {
    const f = await inspectionFixture(); let escaped: (() => undefined) | undefined;
    await f.ops.runGenerationInspection(f.serverId, f.operation.id, async (...args: unknown[]) => { expect(args).toHaveLength(1); }, () => undefined);
    await f.ops.runGenerationSlotCommit(f.serverId, f.operation.id, async (_protection, guard) => { escaped = guard; guard(); }, () => undefined);
    expect(() => escaped!()).toThrow();
    await f.ops.runGenerationSlotCommit(f.serverId, f.operation.id, async (_protection, current) => {
      expect(() => escaped!()).toThrow(); expect(current()).toBeUndefined();
    }, () => undefined);
  });
  it("commits a live published slot under the dedicated lease without settling or unlocking", async () => {
    const f = await inspectionFixture(), before = await f.store.list();
    const result = await f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined);
    expect(result).toMatchObject({ slotState: "active", inspectionOnly: true, recoveryRequired: true });
    expect(await f.store.list()).toEqual(before); expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
    expect(f.states.snapshot(f.serverId)?.state).toBe("pending-generation"); expect(f.start).toHaveBeenCalledOnce();
    expect((await f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined)).slot).toEqual(result.slot);
  });
  it("commits a fresh-startup protected pending slot, retaining its old descriptor and explicit intent continuation", async () => {
    const f = await inspectionFixture(); await f.ops.initialize();
    const states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const recovery = await states.initialize(undefined, undefined, undefined, undefined, undefined, new Set([f.serverId]));
    f.ops.requireStartupWorldRecovery(recovery, id => states.protectedGenerationRecovery(id));
    const descriptor = states.protectedGenerationRecovery(f.serverId);
    const result = await f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined);
    expect(result.slotState).toBe("active"); expect(states.snapshot(f.serverId)).toBeNull();
    expect(states.protectedGenerationRecovery(f.serverId)).toEqual(descriptor);
    await expect(f.inspect()).rejects.toThrow();
    expect((await f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined)).slot).toEqual(result.slot);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("does not commit an externally active slot without its durable intent", async () => {
    const f = await inspectionFixture(), files = slotPaths(f), original = JSON.parse(await readFile(files.slot, "utf8"));
    await writeFile(files.slot, JSON.stringify({ ...original, state: "active" }) + "\n");
    await expect(f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined)).rejects.toThrow();
    expect(existsSync(files.intent)).toBe(false); expect(existsSync(files.stage)).toBe(false);
  });
  it("holds the dedicated slot lease through physical IO and drains it on close", async () => {
    const f = await inspectionFixture(), files = slotPaths(f); let release!: () => void, entered!: () => void;
    const started = new Promise<void>(done => { entered = done; }), held = new Promise<void>(done => { release = done; });
    vi.spyOn(f.adapter, "revalidateBeforeStart").mockImplementationOnce(async () => { entered(); await held; });
    const task = f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined), failed = expect(task).rejects.toThrow();
    await started; await expect(f.inspect()).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    let closed = false; const closing = f.inspector.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); release(); await failed; await closing;
    expect(existsSync(files.intent)).toBe(false); expect(existsSync(files.stage)).toBe(false);
    await expect(f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined)).rejects.toThrow();
  });
  it.each(["revoke", "external"])("retains pending/stage/intent when %s occurs before rename", async scenario => {
    const f = await inspectionFixture(), files = slotPaths(f);
    await expect(f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => {
      if (existsSync(files.intent)) {
        if (scenario === "external") f.ops.requireRecovery([f.serverId]);
        else throw new Error("authorization revoked");
      }
      return undefined;
    })).rejects.toThrow();
    expect(existsSync(files.intent)).toBe(true); expect(existsSync(files.stage)).toBe(true);
    expect(JSON.parse(await readFile(files.slot, "utf8")).state).toBe("pending-generation");
    if (scenario === "external") await expect(f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined)).rejects.toThrow();
    else expect((await f.inspector.commitPublishedSlot(f.serverId, f.operation.id, () => undefined)).slotState).toBe("active");
  });
  it.each(["schema4", "schema5", "receipt", "sibling"])("keeps %s catalogs outside the import compatibility exception", async scenario => {
    const f = scenario === "schema4" || scenario === "schema5" ? await fixture() : await inspectionFixture();
    if (scenario === "schema5") { await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle(); await f.service.close(); }
    if (scenario === "receipt") {
      const record = (await f.store.list()).find(value => value.worldGenerationExecution)!;
      await f.store.save({ ...record, operation: { ...record.operation, state: "failed" } });
    }
    if (scenario === "sibling") await writeFile(path.join(f.manager, "world-library", f.serverId, "unexpected.tmp"), "unsettled");
    await expect(f.library.auditImportBindings(f.binding, [], true, { journal: f.journal, receipts: f.store })).rejects.toThrow();
  });
  it("recognizes only fully evidenced published catalogs as having no ordinary import work", async () => {
    const f = await inspectionFixture(), evidence = { journal: f.journal, receipts: f.store };
    await expect(f.library.auditImportBindings(f.binding, [], true)).rejects.toThrow();
    await expect(f.library.auditImportBindings(f.binding, [], true, evidence)).resolves.toBeUndefined();
    await expect(f.library.auditImportBindings(f.binding, [{ intent: { serverId: f.serverId, worldLibraryImport: {} } }] as never, true, evidence)).rejects.toThrow();
    await rm(path.join(f.manager, "world-library", `${f.serverId}.generation-birth.json`));
    await expect(f.library.auditImportBindings(f.binding, [], true, evidence)).rejects.toThrow();
  });
  it("classifies only the known startup slot and carries its immutable descriptor into full proof", async () => {
    const f = await inspectionFixture(), restarted = new OperationService(f.store, clock, f.journal);
    await restarted.initialize();
    const states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    const recovery = await states.initialize(undefined, undefined, undefined, undefined, undefined, new Set([f.serverId]));
    const descriptor = states.protectedGenerationRecovery(f.serverId)!;
    const records = await f.store.list(), slot = path.join(f.manager, "active-worlds", `${f.serverId}.json`), bytes = await readFile(slot);
    restarted.requireStartupWorldRecovery(recovery, () => descriptor);
    descriptor.slotIdentity = "0".repeat(64);
    expect(await restarted.runGenerationInspection(f.serverId, f.operation.id, async protection => {
      expect(protection?.slotIdentity).not.toBe(descriptor.slotIdentity);
      const proof = await verifyGenerationCurrentState(f.registry, f.manager, f.library, f.journal, f.store, f.backups, f.serverId, protection);
      await proof.recheck(); return true;
    }, () => undefined)).toBe(true);
    expect(await f.store.list()).toEqual(records); expect(await readFile(slot)).toEqual(bytes);
    expect(restarted.getServerState(f.serverId).recoveryRequired).toBe(true);
    restarted.requireRecovery([f.serverId]);
    restarted.requireStartupWorldRecovery(recovery, id => states.protectedGenerationRecovery(id));
    await expect(restarted.runGenerationInspection(f.serverId, f.operation.id, async () => true, () => undefined)).rejects.toThrow();
  });
  it.each(["missing", "lookup-error", "wrong-name", "extra-field", "unknown-init"])("retains external recovery for %s startup", async scenario => {
    const f = await inspectionFixture(), restarted = new OperationService(f.store, clock, f.journal);
    await restarted.initialize();
    const states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    await states.initialize(undefined, undefined, undefined, undefined, undefined, new Set([f.serverId]));
    const descriptor = states.protectedGenerationRecovery(f.serverId)!;
    if (scenario === "unknown-init") {
      vi.spyOn(f.store, "list").mockRejectedValueOnce(new Error("startup failed"));
      await expect(restarted.initialize()).rejects.toThrow("startup failed");
    }
    restarted.requireStartupWorldRecovery([f.serverId], () => {
      if (scenario === "missing") return null;
      if (scenario === "lookup-error") throw new Error("lookup failed");
      if (scenario === "wrong-name") return { ...descriptor, levelName: "different" };
      if (scenario === "extra-field") return { ...descriptor, unexpected: true };
      return descriptor;
    });
    const action = vi.fn(async () => true);
    await expect(restarted.runGenerationInspection(f.serverId, f.operation.id, action, () => undefined)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled(); expect(restarted.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("does not bypass stale slot identity through typed startup classification", async () => {
    const f = await inspectionFixture(), restarted = new OperationService(f.store, clock, f.journal);
    await restarted.initialize(); const states = new ActiveWorldStateStore(f.manager, [f.adapter]);
    await states.initialize(undefined, undefined, undefined, undefined, undefined, new Set([f.serverId]));
    restarted.requireStartupWorldRecovery([f.serverId], () => ({ ...states.protectedGenerationRecovery(f.serverId)!, slotIdentity: "0".repeat(64) }));
    await expect(restarted.runGenerationInspection(f.serverId, f.operation.id, async protection => {
      await verifyGenerationCurrentState(f.registry, f.manager, f.library, f.journal, f.store, f.backups, f.serverId, protection);
    }, () => undefined)).rejects.toThrow();
  });
  it("rechecks causes while releasing behind another instance's mutation and still releases its lease", async () => {
    const f = await inspectionFixture(), before = await f.store.list(); let entered!: () => void, release!: () => void;
    const started = new Promise<void>(done => { entered = done; }), held = new Promise<void>(done => { release = done; });
    let blockerResult: Promise<void> | undefined;
    const task = f.ops.runGenerationInspection(f.serverId, f.operation.id, async () => {
      const blocker = f.ops.requestBackup("other-instance", randomUUID(), "{}", async () => { throw new Error("must not execute"); },
        async () => { entered(); await held; throw new Error("blocker preflight sentinel"); });
      blockerResult = expect(blocker).rejects.toThrow("blocker preflight sentinel");
      await started; throw new Error("inspection action sentinel");
    }, () => undefined);
    const rejected = expect(task).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await started; f.ops.requireRecovery([f.serverId]); release(); await rejected; await blockerResult;
    expect(await f.store.list()).toEqual(before);
    await expect(f.inspect()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    // Parent/execution validation occurs before cause validation, but conflict
    // occurs before cause validation: RECOVERY_REQUIRED proves the lease is gone.
  });
  it("allows unrelated historical lifecycle receipts but rejects competing generation evidence", async () => {
    const f = await inspectionFixture(), record = (await f.store.list()).find(value => value.operation.id === f.operation.id)!;
    const history = { ...record, operation: { ...record.operation, id: randomUUID(), kind: "start" as const },
      worldGenerationExecution: undefined, idempotencyKey: randomUUID() };
    await f.store.save(history); expect((await f.inspect()).inspectionOnly).toBe(true);
    const id = randomUUID();
    await f.store.save({ ...record, operation: { ...record.operation, id },
      worldGenerationExecution: { ...record.worldGenerationExecution!, executionOperationId: id } });
    await expect(f.inspect()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("returns a strict read-only summary without changing receipts, slot or recovery", async () => {
    const f = await inspectionFixture(), records = await f.store.list();
    const slot = path.join(f.manager, "active-worlds", `${f.serverId}.json`), before = await readFile(slot);
    expect(await f.inspect()).toEqual({ inspectionOnly: true, recoveryRequired: true, serverId: f.serverId,
      operationId: f.operation.id, worldId: f.target.worldId, catalogRevision: (await f.verify()).catalogRevision, slotState: "pending-generation" });
    expect(await f.store.list()).toEqual(records); expect(await readFile(slot)).toEqual(before);
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true); expect(f.start).toHaveBeenCalledOnce();
  });
  it("rejects external and unrelated causes before physical inspection", async () => {
    const f = await inspectionFixture(), spy = vi.spyOn(f.adapter, "revalidateBeforeStart"); spy.mockClear();
    f.ops.requireRecovery([f.serverId]); await expect(f.inspect()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("keeps the instance lease during inspection and releases it after failure", async () => {
    const f = await inspectionFixture(); let release!: () => void, entered!: () => void;
    const started = new Promise<void>(done => { entered = done; });
    const held = new Promise<void>(done => { release = done; });
    const spy = vi.spyOn(f.adapter, "revalidateBeforeStart").mockImplementationOnce(async () => { entered(); await held; throw new Error("inspection failed"); });
    const task = f.inspect(); const failed = expect(task).rejects.toThrow(); await started;
    await expect(f.inspect()).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    // One instance's physical IO does not hold the global mutation queue.
    expect(await f.ops.runReadAdmission("other-instance", async () => "independent")).toBe("independent");
    release(); await failed; spy.mockRestore(); expect((await f.inspect()).inspectionOnly).toBe(true);
  });
  it.each(["authorization", "new-cause", "receipt"])("rejects %s drift during physical inspection", async scenario => {
    const f = await inspectionFixture(); let allowed = true;
    vi.spyOn(f.adapter, "revalidateBeforeStart").mockImplementationOnce(async () => {
      if (scenario === "authorization") allowed = false;
      if (scenario === "new-cause") f.ops.requireTransactionRecovery(f.serverId, randomUUID());
      if (scenario === "receipt") {
        const record = (await f.store.list()).find(value => value.operation.id === f.operation.id)!;
        await f.store.save({ ...record, operation: { ...record.operation, updatedAt: "2026-10-29T14:00:00Z" } });
      }
    });
    await expect(f.inspect(() => { if (!allowed) throw new Error("revoked"); return undefined; })).rejects.toThrow();
    expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("drains an inspection during close and never returns successful inspection after closing", async () => {
    const f = await inspectionFixture(); let release!: () => void, entered!: () => void;
    const started = new Promise<void>(done => { entered = done; }), held = new Promise<void>(done => { release = done; });
    vi.spyOn(f.adapter, "revalidateBeforeStart").mockImplementationOnce(async () => { entered(); await held; });
    const task = f.inspect(), failed = expect(task).rejects.toThrow(); await started;
    let closed = false; const closing = f.inspector.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); release(); await failed; await closing;
    await expect(f.inspect()).rejects.toThrow(); expect(f.ops.getServerState(f.serverId).recoveryRequired).toBe(true);
  });
  it("rejects async authorization and a wrong execution owner", async () => {
    const f = await inspectionFixture();
    await expect(f.inspect((() => Promise.resolve()) as never)).rejects.toThrow();
    await expect(f.inspector.inspectPublished(f.serverId, f.target.preparationOperationId, () => undefined)).rejects.toThrow();
  });
});

async function birthFixture() {
  const f = await fixture(), operation = await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle();
  const birth = await f.library.readGenerationBirth(f.binding, f.journal, f.store), file = path.join(f.manager, "world-library", `${f.serverId}.generation-birth.json`);
  const record = (await f.store.list()).find(item => item.operation.id === operation.id)!;
  await f.store.save({ ...record, operation: { ...record.operation, state: "running" } });
  await f.service.close();
  return { ...f, birth: birth.value, file, record };
}
describe("immutable generation birth storage (Fake owned runtime)", () => {
  it.each(["revocation", "closing"])("rejects %s during final directory IO before creating birth", async reason => {
    const f = await birthFixture(); await rm(f.file); let checks = 0, revoked = false;
    const access = f.library as unknown as { directory: (binding: typeof f.binding, create?: boolean) => Promise<string> };
    const directory = access.directory.bind(f.library);
    vi.spyOn(access, "directory").mockImplementation(async (...args) => {
      const value = await directory(...args); if (checks === 2) revoked = true; return value;
    });
    const authorize = vi.fn((): undefined => { if (revoked) throw new Error(reason); });
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => { checks++; }, authorize)).rejects.toThrow(reason);
    expect(checks).toBe(2); expect(authorize).toHaveBeenCalledOnce();
    await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["delete", "tamper"])("rejects birth %s during final live callback and preserves resulting state", async scenario => {
    const f = await birthFixture(); await rm(f.file); let checks = 0;
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => {
      if (++checks === 3) {
        if (scenario === "delete") await rm(f.file);
        else await writeFile(f.file, JSON.stringify({ ...f.birth, launchId: randomUUID() }) + "\n");
      }
    }, () => undefined)).rejects.toThrow();
    expect(checks).toBe(3);
    if (scenario === "delete") await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
    else expect(JSON.parse(await readFile(f.file, "utf8")).launchId).not.toBe(f.birth.launchId);
  });
  it("rejects missing or asynchronous final authorization before any birth write", async () => {
    const f = await birthFixture(); await rm(f.file);
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, undefined as never)).rejects.toThrow();
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, (() => Promise.reject(new Error("async guard"))) as never)).rejects.toThrow();
    await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("never overwrites an existing birth or creates a catalog entry", async () => {
    const f = await birthFixture(), before = await readFile(f.file);
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, () => undefined)).rejects.toThrow();
    expect(await readFile(f.file)).toEqual(before);
    expect((await f.library.readGenerationBirth(f.binding, f.journal, f.store)).inspectionOnly).toBe(true);
  });
  it("requires the live callback and refuses mismatched metadata before writing", async () => {
    const f = await birthFixture(); await rm(f.file);
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, undefined as never, () => undefined)).rejects.toThrow();
    const callback = vi.fn(async () => undefined);
    await expect(f.library.sealGenerationBirth(f.binding, { ...f.birth, arbitraryPath: "not-allowed" }, f.journal, f.store, callback, () => undefined)).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled(); await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([1, 3])("retains the appropriate evidence when live check %s fails", async failAt => {
    const f = await birthFixture(); await rm(f.file); let calls = 0;
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => {
      if (++calls === failAt) throw new Error("live witness lost");
    }, () => undefined)).rejects.toThrow("live witness lost");
    if (failAt === 1) await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
    else {
      expect(JSON.parse(await readFile(f.file, "utf8"))).toEqual(f.birth);
      expect((await f.library.readGenerationBirth(f.binding, f.journal, f.store)).inspectionOnly).toBe(true);
      await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, () => undefined)).rejects.toThrow();
    }
  });
  it("preserves partial birth evidence and refuses inspection as a valid record", async () => {
    const f = await birthFixture(); await writeFile(f.file, '{"partial":');
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, () => undefined)).rejects.toThrow();
    await expect(f.library.readGenerationBirth(f.binding, f.journal, f.store)).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe('{"partial":');
  });
  it("refuses a missing execution receipt instead of reconstructing a birth from metadata", async () => {
    const f = await birthFixture(); await rm(f.file); await rm(path.join(f.manager, "operations", `${f.record.operation.id}.json`));
    await expect(f.library.sealGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, () => undefined)).rejects.toThrow();
    await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function publicationFixture() {
  const f = await birthFixture();
  await f.store.save({ ...f.record, operation: { ...f.record.operation, state: "running", step: "generation-birth-awaiting-catalog-publication" } });
  return { ...f, catalog: path.join(f.manager, "world-library", f.serverId, "state.json") };
}
describe("pending generated catalog publication", () => {
  it("preserves a same-byte externally replaced catalog during final directory IO", async () => {
    const f = await publicationFixture(), bytes = await readFile(f.catalog);
    const access = f.library as unknown as { generationPublicationStage: (value: unknown) => Promise<void> };
    const verify = access.generationPublicationStage.bind(f.library);
    vi.spyOn(access, "generationPublicationStage").mockImplementation(async value => {
      await verify(value); await rename(f.catalog, f.catalog + ".external-retained"); await writeFile(f.catalog, bytes);
    });
    await expect(f.library.publishGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, () => undefined)).rejects.toThrow();
    expect(await readFile(f.catalog)).toEqual(bytes);
    expect((await readdir(path.dirname(f.catalog))).filter(name => name.endsWith(".tmp"))).toHaveLength(1);
  });
  it.each(["receipt-before", "phase-before", "parent-before", "receipt-after", "parent-after"])("rejects persistent drift at %s", async scenario => {
    const f = await publicationFixture(); let calls = 0;
    await expect(f.library.publishGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => {
      if (++calls !== (scenario.endsWith("before") ? 2 : 3)) return;
      if (scenario.startsWith("parent")) {
        const file = path.join(f.manager, "transactions", `${f.serverId}.${f.target.preparationTransactionId}.json`);
        const record = JSON.parse(await readFile(file, "utf8")); record.updatedAt = "2026-10-29T12:00:00.000Z"; await writeFile(file, JSON.stringify(record) + "\n");
      } else await f.store.save({ ...f.record, operation: { ...f.record.operation,
        state: scenario.startsWith("phase") ? "running" : "failed", step: scenario.startsWith("phase") ? "unexpected-phase" : "failed" } });
    }, () => undefined)).rejects.toThrow();
    expect(JSON.parse(await readFile(f.catalog, "utf8")).schemaVersion).toBe(scenario.endsWith("before") ? 5 : 6);
  });
  it("does not allow failed completion or different birth evidence to authorize publication", async () => {
    const f = await publicationFixture();
    await expect(f.library.publishGenerationBirth(f.binding, { ...f.birth, launchId: randomUUID() }, f.journal, f.store, async () => undefined, () => undefined)).rejects.toThrow();
    await f.store.save({ ...f.record, operation: { ...f.record.operation, state: "failed" } });
    await expect(f.library.publishGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, () => undefined)).rejects.toThrow();
    expect(JSON.parse(await readFile(f.catalog, "utf8")).schemaVersion).toBe(5);
  });
  it.each(["revoke-before-rename", "fail-after-rename"])("preserves evidence on %s", async scenario => {
    const f = await publicationFixture(); let calls = 0, allowed = true;
    await expect(f.library.publishGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => {
      calls++;
      if (scenario === "revoke-before-rename" && calls === 2) allowed = false;
      if (scenario === "fail-after-rename" && calls === 3) throw new Error("postpublication verification failed");
    }, () => { if (!allowed) throw new Error("revoked"); })).rejects.toThrow();
    expect(JSON.parse(await readFile(f.catalog, "utf8")).schemaVersion).toBe(scenario === "fail-after-rename" ? 6 : 5);
  });
  it("is one-way and requires complete historical evidence for inspection after reconstruction", async () => {
    const f = await publicationFixture();
    const original = JSON.parse(await readFile(f.catalog, "utf8")).entries[0];
    await f.library.publishGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, () => undefined);
    const raw = JSON.parse(await readFile(f.catalog, "utf8")); expect(raw.entries[0]).toEqual(original);
    await expect(f.library.publishGenerationBirth(f.binding, f.birth, f.journal, f.store, async () => undefined, () => undefined)).rejects.toThrow();
    const restarted = new WorldLibraryStore(f.manager, clock), active = f.states.snapshot(f.serverId)!;
    const proof = { journal: f.journal, receipts: f.store };
    expect((await restarted.list(f.binding, active, proof)).items).toHaveLength(2);
    await expect(restarted.activationBinding(f.binding, f.target.worldId, raw.generationPublication.admissionRevision)).rejects.toThrow();
    await expect(restarted.readPreparedGeneration(f.binding, f.journal)).rejects.toThrow();
    await rm(path.join(f.manager, "operations", `${f.record.operation.id}.json`));
    expect((await restarted.list(f.binding, active, proof)).items).toHaveLength(0);
  });
  it.each([false, true])("keeps all generation actions closed after app reconstruction (fresh state store: %s)", async fresh => {
    const f = await fixture(true); await f.service.generate(f.serverId, randomUUID(), f.target, () => undefined); await f.settle(); await f.service.close();
    const classification = vi.spyOn(OperationService.prototype, "requireStartupWorldRecovery");
    const freshStates = fresh ? new ActiveWorldStateStore(f.manager, [f.adapter]) : f.states;
    const app = buildApp({ mode: "local", adapters: [f.adapter], managerRoot: f.manager, transactionJournal: f.journal,
      operationStore: f.store, activeWorldState: freshStates, backupSchedulerTimers: false });
    try {
      await app.ready();
      const response = await app.inject({ method: "GET", url: `/api/v1/servers/${f.serverId}/world-library`, headers: { host: "127.0.0.1:8080" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ state: "inspection-required", activeWorldId: null, mutationsAvailable: false, activationAvailable: false });
      // Retain the original cached-store two-item assertion. A fresh protected
      // store has no trusted snapshot and intentionally exposes no items yet.
      expect(response.json().data.items).toHaveLength(fresh ? 0 : 2);
      if (fresh) expect(freshStates.snapshot(f.serverId)).toBeNull();
      else expect(freshStates.snapshot(f.serverId)?.state).toBe("pending-generation");
      const restarted = classification.mock.contexts[0]!;
      expect(await restarted.runGenerationInspection(f.serverId, (await f.store.list()).find(record => record.worldGenerationExecution)!.operation.id,
        async protection => {
          expect(protection?.kind).toBe("protected-pending-generation");
          const proof = await verifyGenerationCurrentState(f.registry, f.manager, f.library, f.journal, f.store, f.backups, f.serverId, protection);
          await proof.recheck(); return true;
        }, () => undefined)).toBe(true);
    } finally { await app.close(); }
  });
});
