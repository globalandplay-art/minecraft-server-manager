import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { ActiveWorldStateStore } from "../src/services/active-world-state-store.js";
import { BackupService } from "../src/services/backup-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { JsonOperationStore, type StoredOperation } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { WorldCreatePlanService } from "../src/services/world-create-plan-service.js";
import { WorldCreateService } from "../src/services/world-create-service.js";
import { WorldLibraryStore } from "../src/services/world-library-store.js";
import { generationExecutionFingerprint, generationExecutionRequest, generationKeyDigest, type WorldGenerationExecution } from "../src/services/world-generation-execution.js";
import { testWorldLevel } from "./fixtures/world-library-content.js";

const roots: string[] = [], clock = { now: () => new Date("2026-10-28T10:00:00Z") };
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lt-generation-execution-")); roots.push(root);
  const manager = path.join(root, "manager"), server = path.join(root, "server"), serverId = "execution-test";
  await mkdir(manager); await mkdir(path.join(server, "world"), { recursive: true });
  await writeFile(path.join(server, "world", "level.dat"), testWorldLevel("old", true, 5023)); await writeFile(path.join(server, "server.properties"), "level-name=world\n");
  const start = vi.fn(), stop = vi.fn();
  const adapter = { serverId, mode: "local", plan: { rootPath: server, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }),
    getServerInfo: async () => ({ type: "vanilla", minecraftVersion: "26.3" }), getCapabilities: async () => ({ worlds: true, backup: true }), start, stop } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(manager), store = new JsonOperationStore(manager);
  const ops = new OperationService(store, clock, journal); await ops.initialize();
  const states = new ActiveWorldStateStore(manager, [adapter]); await states.initialize();
  const library = new WorldLibraryStore(manager, clock), binding = { serverId, rootPath: server };
  await library.migrateLegacy(binding, states.snapshot(serverId)!);
  const backups = new BackupService(registry, ops, journal, manager, clock);
  const creator = new WorldCreateService(registry, ops, journal, backups, manager, states, clock, undefined, { library });
  const plan = await new WorldCreatePlanService(registry, ops).plan(serverId, { name: "NewWorld", seed: "17" });
  const operation = await creator.create(serverId, { name: "NewWorld", seed: "17", allowStop: false, worldRevision: plan.worldRevision!, confirmWorldName: "world" }, randomUUID());
  await vi.waitFor(() => { expect(ops.get(operation.id)?.state).toBe("interrupted"); expect(ops.getServerState(serverId).activeOperationId).toBeNull(); });
  await creator.close(); const prepared = await library.readPreparedGeneration(binding, journal);
  const key = randomUUID(), base = { schemaVersion: 1 as const, serverId, executionOperationId: randomUUID(), preparationOperationId: operation.id,
    preparationTransactionId: prepared.record.transactionId, worldId: prepared.reservation.worldId, preparedRecordDigest: prepared.recordDigest,
    registeredExecutionDigest: "a".repeat(64) };
  const execution: WorldGenerationExecution = { ...base, requestDigest: generationExecutionFingerprint(base), keyDigest: generationKeyDigest(key) };
  const receipt: StoredOperation = { operation: { id: execution.executionOperationId, serverId, kind: "world-create", state: "queued", step: "queued",
    createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString(), progress: null, result: null, error: null },
    idempotencyKey: key, requestFingerprint: execution.requestDigest, expiresAt: "2026-10-29T10:00:00Z", worldGenerationExecution: execution };
  const catalog = path.join(manager, "world-library", serverId, "state.json"), anchor = path.join(manager, "world-library", `${serverId}.generation-execution.json`);
  return { manager, server, serverId, binding, library, journal, store, ops, prepared, execution, receipt, key, catalog, anchor, start, stop };
}

function target(f: Awaited<ReturnType<typeof fixture>>) {
  const { preparationOperationId, preparationTransactionId, worldId, preparedRecordDigest, registeredExecutionDigest } = f.execution;
  return { preparationOperationId, preparationTransactionId, worldId, preparedRecordDigest, registeredExecutionDigest };
}

describe("dedicated generation admission without Java", () => {
  it("persists before callback, seals once, masks completion and permanently replays without dispatch", async () => {
    const f = await fixture(), release = vi.fn(() => undefined), owner = vi.fn(() => release), preflight = vi.fn(async () => undefined);
    const execute = vi.fn(async (ctx: { operationId: string }) => {
      const saved = (await f.store.list()).find(record => record.operation.id === ctx.operationId)!;
      expect(saved.worldGenerationExecution?.worldId).toBe(f.execution.worldId);
      await f.library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, saved.worldGenerationExecution!, f.journal, f.store);
    });
    const admitted = await f.ops.requestGenerationExecution(f.serverId, f.key, target(f), execute, preflight, () => undefined, owner);
    expect(admitted.state).toBe("interrupted");
    await vi.waitFor(() => { expect(f.ops.getServerState(f.serverId).activeOperationId).toBeNull(); expect(release).toHaveBeenCalledOnce(); });
    expect(execute).toHaveBeenCalledOnce(); expect(owner).toHaveBeenCalledOnce();
    const persisted = (await f.store.list()).find(record => record.operation.id === admitted.id)!;
    expect(persisted.operation.state).toBe("succeeded");
    expect(JSON.parse(await readFile(f.catalog, "utf8")).schemaVersion).toBe(5);
    expect(JSON.parse(await readFile(f.anchor, "utf8")).executionOperationId).toBe(admitted.id);
    expect((await f.library.readGenerationExecutionSeal(f.binding, f.journal, f.store)).consumed).toBe(true);
    expect(f.ops.get(admitted.id)?.state).toBe("interrupted");
    const replay = await f.ops.requestGenerationExecution(f.serverId, f.key.toUpperCase(), target(f), execute, preflight, () => undefined, owner);
    expect(replay.id).toBe(admitted.id); expect(preflight).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce();
    await expect(f.ops.requestGenerationExecution(f.serverId, randomUUID(), target(f), execute, preflight, () => undefined, owner)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(f.start).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3])("rejects missing callback %s before receipt or owner acquisition", async index => {
    const f = await fixture(), execute = vi.fn(async () => undefined), owner = vi.fn(() => () => undefined);
    const callbacks = [execute, async () => undefined, () => undefined, owner]; callbacks[index] = undefined as never;
    await expect(f.ops.requestGenerationExecution(f.serverId, f.key, target(f), ...callbacks as unknown as Parameters<OperationService["requestGenerationExecution"]> extends [string, string, unknown, ...infer R] ? R : never)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toHaveLength(1); expect(owner).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("rejects an owner factory without a release handle", async () => {
    const f = await fixture(), execute = vi.fn();
    await expect(f.ops.requestGenerationExecution(f.serverId, f.key, target(f), execute, async () => undefined, () => undefined,
      (() => undefined) as never)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toHaveLength(1); expect(execute).not.toHaveBeenCalled();
  });
  it.each(["cause", "receipt"])("rechecks ownership after preflight introduces %s", async scenario => {
    const f = await fixture(), execute = vi.fn(), owner = vi.fn(() => () => undefined);
    await expect(f.ops.requestGenerationExecution(f.serverId, f.key, target(f), execute, async () => {
      if (scenario === "cause") f.ops.requireRecovery([f.serverId]);
      else await f.store.save(f.receipt);
    }, () => undefined, owner)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(execute).not.toHaveBeenCalled(); expect(owner).not.toHaveBeenCalled();
    expect(await f.store.list()).toHaveLength(scenario === "cause" ? 1 : 2);
  });
  it("keeps generic recoveryOwner requests blocked", async () => {
    const f = await fixture(), execute = vi.fn();
    await expect(f.ops.requestBackup(f.serverId, f.key, JSON.stringify(generationExecutionRequest(f.execution)), execute,
      async () => undefined, "world-create", f.execution.preparationOperationId)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(execute).not.toHaveBeenCalled(); expect(await f.store.list()).toHaveLength(1);
  });
  it("retains published-but-unacknowledged receipts and blocks another attempt in the same process", async () => {
    const f = await fixture(), execute = vi.fn(), release = vi.fn(() => undefined), save = f.store.save.bind(f.store);
    vi.spyOn(f.store, "save").mockImplementation(async record => { await save(record); throw new Error("lost acknowledgment"); });
    await expect(f.ops.requestGenerationExecution(f.serverId, f.key, target(f), execute, async () => undefined, () => undefined, () => release)).rejects.toThrow("lost acknowledgment");
    expect(execute).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce(); expect(await f.store.list()).toHaveLength(2);
    vi.restoreAllMocks();
    await expect(f.ops.requestGenerationExecution(f.serverId, randomUUID(), target(f), execute, async () => undefined, () => undefined, () => release)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    const restarted = new OperationService(f.store, clock, f.journal); await restarted.initialize();
    const replay = await restarted.requestGenerationExecution(f.serverId, f.key, target(f), execute, async () => undefined, () => undefined, () => release);
    expect(replay.state).toBe("interrupted"); expect(execute).not.toHaveBeenCalled();
  });
  it("rechecks authorization after receipt persistence before invoking callback", async () => {
    const f = await fixture(), execute = vi.fn(), release = vi.fn(() => undefined), save = f.store.save.bind(f.store); let authorized = true;
    vi.spyOn(f.store, "save").mockImplementation(async record => { await save(record); authorized = false; });
    const operation = await f.ops.requestGenerationExecution(f.serverId, f.key, target(f), execute, async () => undefined,
      () => { if (!authorized) throw new Error("revoked"); }, () => release);
    await vi.waitFor(() => { expect(f.ops.getServerState(f.serverId).activeOperationId).toBeNull(); expect(release).toHaveBeenCalledOnce(); });
    expect(execute).not.toHaveBeenCalled(); expect(f.ops.get(operation.id)?.state).toBe("interrupted");
  });
  it.each(["preflight", "authorization", "async-authorization", "save"])("rejects %s failure without execution", async scenario => {
    const f = await fixture(), execute = vi.fn(), release = vi.fn(() => undefined), owner = vi.fn(() => release);
    if (scenario === "save") vi.spyOn(f.store, "save").mockRejectedValue(new Error("write failed"));
    await expect(f.ops.requestGenerationExecution(f.serverId, f.key, target(f), execute,
      async () => { if (scenario === "preflight") throw new Error("preflight failed"); },
      (() => { if (scenario === "authorization") throw new Error("revoked"); if (scenario === "async-authorization") return Promise.reject(new Error("not synchronous")); }) as never,
      owner)).rejects.toThrow();
    expect(await f.store.list()).toHaveLength(1); expect(execute).not.toHaveBeenCalled();
    expect(owner).toHaveBeenCalledTimes(scenario === "save" ? 1 : 0); expect(release).toHaveBeenCalledTimes(scenario === "save" ? 1 : 0);
  });
  it.each(["preparationOperationId", "preparationTransactionId", "worldId", "preparedRecordDigest", "extra"])("rejects altered target %s", async field => {
    const f = await fixture(), changed: Record<string, unknown> = target(f), execute = vi.fn(), owner = vi.fn(() => () => undefined);
    changed[field] = field === "worldId" ? `worldv2-${randomUUID()}` : field === "preparedRecordDigest" ? "0".repeat(64) : randomUUID();
    await expect(f.ops.requestGenerationExecution(f.serverId, f.key, changed, execute, async () => undefined, () => undefined, owner)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await f.store.list()).toHaveLength(1); expect(owner).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("does not reuse an expired legacy key with different casing", async () => {
    const f = await fixture(), old = { ...f.receipt, idempotencyKey: f.key.toUpperCase(), expiresAt: "2020-01-01T00:00:00Z" };
    delete old.worldGenerationExecution; await f.store.save(old);
    await expect(f.ops.requestGenerationExecution(f.serverId, f.key, target(f), vi.fn(), async () => undefined, () => undefined, () => () => undefined)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    expect(await f.store.list()).toHaveLength(2);
  });
  it("consumes the attempt when execution fails before seal and never retries it", async () => {
    const f = await fixture(), execute = vi.fn(async () => { throw new Error("before seal"); });
    const operation = await f.ops.requestGenerationExecution(f.serverId, f.key, target(f), execute, async () => undefined, () => undefined, () => () => undefined);
    await vi.waitFor(() => expect(f.ops.getServerState(f.serverId).activeOperationId).toBeNull());
    expect(f.ops.get(operation.id)?.state).toBe("interrupted");
    await f.ops.requestGenerationExecution(f.serverId, f.key, target(f), execute, async () => undefined, () => undefined, () => () => undefined);
    expect(execute).toHaveBeenCalledOnce();
    await expect(f.ops.requestGenerationExecution(f.serverId, randomUUID(), target(f), execute, async () => undefined, () => undefined, () => () => undefined)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
});
describe("unmounted one-time generation execution evidence", () => {
  it("seals one persisted attempt, reads it back, and never treats resealing as new execution permission", async () => {
    const f = await fixture(), before = await readFile(f.catalog); await f.store.save(f.receipt);
    const sealed = await f.library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store);
    expect(sealed.alreadySealed).toBe(false);
    const saved = await readFile(f.catalog), value = JSON.parse(saved.toString("utf8"));
    expect(value.schemaVersion).toBe(5); expect(value.generationExecution).toEqual(f.execution);
    expect(value.entries).toEqual(JSON.parse(before.toString("utf8")).entries);
    expect((await f.library.readGenerationExecutionSeal(f.binding, f.journal, f.store)).consumed).toBe(true);
    expect((await f.library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store)).alreadySealed).toBe(true);
    expect(await readFile(f.catalog)).toEqual(saved);
    await expect(f.library.readPreparedGeneration(f.binding, f.journal)).rejects.toThrow();
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["queued", "running", "succeeded", "failed", "interrupted"] as const)("keeps an orphan %s receipt gated and permanently replay-bound after TTL expiry", async state => {
    const f = await fixture(); await f.store.save({ ...f.receipt, operation: { ...f.receipt.operation, state } });
    const original = (await f.store.list()).find(record => record.operation.id === f.execution.executionOperationId);
    const restarted = new OperationService(new JsonOperationStore(f.manager), { now: () => new Date("2026-11-28T10:00:00Z") }, f.journal);
    await restarted.initialize(); expect(restarted.get(f.execution.executionOperationId)?.state).toBe("interrupted");
    expect((await f.store.list()).find(record => record.operation.id === f.execution.executionOperationId)).toEqual(original);
    if (state === "queued" || state === "running") {
      const writer = vi.fn();
      await expect(restarted.runGenerationSlotCommit(f.serverId, f.execution.executionOperationId, writer, () => undefined)).rejects.toThrow();
      expect(writer).not.toHaveBeenCalled();
    }
    expect(restarted.getServerState(f.serverId).recoveryRequired).toBe(true); expect(() => restarted.confirmPhysicalTransaction(f.execution.executionOperationId)).toThrow();
    const execute = vi.fn(), replay = await restarted.requestBackup(f.serverId, f.key, JSON.stringify(generationExecutionRequest(f.execution)), execute, undefined, "world-create");
    expect(replay.id).toBe(f.execution.executionOperationId); expect(replay.state).toBe("interrupted"); expect(execute).not.toHaveBeenCalled();
    await expect(restarted.requestBackup(f.serverId, f.key, "different request", execute, undefined, "world-create")).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(restarted.requestBackup(f.serverId, randomUUID(), JSON.stringify(generationExecutionRequest(f.execution)), execute, undefined, "world-create")).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["key", "fingerprint", "operation", "extra"])("rejects malformed receipt %s binding", async scenario => {
    const f = await fixture(), changed = structuredClone(f.receipt);
    if (scenario === "key") Object.assign(changed, { idempotencyKey: randomUUID() });
    if (scenario === "fingerprint") Object.assign(changed, { requestFingerprint: "0".repeat(64) });
    if (scenario === "operation") Object.assign(changed.operation, { id: randomUUID() });
    if (scenario === "extra") Object.assign(changed.worldGenerationExecution!, { path: "arbitrary" });
    await expect(f.store.save(changed)).rejects.toThrow("Invalid operation record");
    expect((await f.store.list()).some(record => record.operation.id === f.execution.executionOperationId)).toBe(false);
  });
  it.each(["same-parent", "same-world", "same-transaction"])("refuses an absent receipt and refuses two receipts with %s binding", async scenario => {
    const f = await fixture(), before = await readFile(f.catalog);
    await expect(f.library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store)).rejects.toThrow();
    await f.store.save(f.receipt);
    const key = randomUUID(), duplicate = { ...f.execution, executionOperationId: randomUUID(), keyDigest: generationKeyDigest(key),
      ...(scenario === "same-world" ? { preparationOperationId: randomUUID(), preparationTransactionId: randomUUID() } : {}),
      ...(scenario === "same-transaction" ? { preparationOperationId: randomUUID(), worldId: `worldv2-${randomUUID()}` } : {}) };
    duplicate.requestDigest = generationExecutionFingerprint(duplicate);
    await f.store.save({ ...f.receipt, operation: { ...f.receipt.operation, id: duplicate.executionOperationId }, idempotencyKey: key,
      requestFingerprint: duplicate.requestDigest, worldGenerationExecution: duplicate });
    await expect(f.library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store)).rejects.toThrow();
    expect(await readFile(f.catalog)).toEqual(before);
  });
  it("retains the exclusive seal after catalog CAS failure and refuses automatic repair", async () => {
    const f = await fixture(); await f.store.save(f.receipt);
    const list = f.store.list.bind(f.store); let reads = 0;
    vi.spyOn(f.store, "list").mockImplementation(async () => {
      const value = await list();
      if (++reads === 2) {
        const catalog = JSON.parse(await readFile(f.catalog, "utf8")); catalog.entries[0].createdAt = "2026-10-27T10:00:00.000Z";
        await writeFile(f.catalog, JSON.stringify(catalog) + "\n");
      }
      return value;
    });
    await expect(f.library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store)).rejects.toThrow();
    expect(JSON.parse(await readFile(f.anchor, "utf8"))).toEqual(f.execution);
    expect(JSON.parse(await readFile(f.catalog, "utf8")).schemaVersion).toBe(4);
    vi.restoreAllMocks();
    const library = new WorldLibraryStore(f.manager, clock), before = await readFile(f.catalog);
    await expect(library.readPreparedGeneration(f.binding, f.journal)).rejects.toThrow();
    await expect(library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store)).rejects.toThrow();
    expect(await readFile(f.catalog)).toEqual(before);
  });
  it("rejects corrupted persisted receipt metadata before startup publication", async () => {
    const f = await fixture(); await f.store.save(f.receipt);
    const file = path.join(f.manager, "operations", `${f.execution.executionOperationId}.json`), raw = JSON.parse(await readFile(file, "utf8"));
    raw.worldGenerationExecution.keyDigest = "0".repeat(64); const evidence = JSON.stringify(raw); await writeFile(file, evidence);
    await expect(new OperationService(new JsonOperationStore(f.manager), clock, f.journal).initialize()).rejects.toThrow("Invalid operation record");
    expect(await readFile(file, "utf8")).toBe(evidence);
  });
  it.each(["receipt", "anchor", "catalog-revert"])("does not recreate execution opportunity after %s loss", async scenario => {
    const f = await fixture(), original = await readFile(f.catalog); await f.store.save(f.receipt);
    await f.library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store);
    if (scenario === "receipt") await rm(path.join(f.manager, "operations", `${f.execution.executionOperationId}.json`));
    if (scenario === "anchor") await rm(f.anchor);
    if (scenario === "catalog-revert") await writeFile(f.catalog, original);
    const library = new WorldLibraryStore(f.manager, clock), evidence = await readFile(f.catalog);
    await expect(library.readGenerationExecutionSeal(f.binding, f.journal, f.store)).rejects.toThrow();
    await expect(library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store)).rejects.toThrow();
    expect(await readFile(f.catalog)).toEqual(evidence);
  });
  it.each(["same-case", "upper-case", "execution-upper"])("does not let a %s same-key receipt overwrite the protected replay mapping", async scenario => {
    const f = await fixture(); await f.store.save(f.receipt);
    const legacy = { ...f.receipt, operation: { ...f.receipt.operation, id: randomUUID() }, idempotencyKey: scenario === "same-case" ? f.key : f.key.toUpperCase() };
    if (scenario === "execution-upper") legacy.worldGenerationExecution = { ...f.execution, executionOperationId: legacy.operation.id };
    else delete legacy.worldGenerationExecution;
    await f.store.save(legacy);
    await expect(new OperationService(f.store, clock, f.journal).initialize()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["lower", "upper"])("replays the same protected attempt for %s key casing after expiry", async casing => {
    const f = await fixture(); await f.store.save({ ...f.receipt, idempotencyKey: f.key.toUpperCase() });
    const restarted = new OperationService(f.store, { now: () => new Date("2026-11-28T10:00:00Z") }, f.journal); await restarted.initialize();
    const execute = vi.fn(), replay = await restarted.requestBackup(f.serverId, casing === "upper" ? f.key.toUpperCase() : f.key,
      JSON.stringify(generationExecutionRequest(f.execution)), execute, undefined, "world-create");
    expect(replay.id).toBe(f.execution.executionOperationId); expect(replay.state).toBe("interrupted"); expect(execute).not.toHaveBeenCalled();
  });
  it("refuses directory substitution during receipt verification before creating the anchor", async () => {
    const f = await fixture(); await f.store.save(f.receipt);
    const list = f.store.list.bind(f.store), outside = path.join(f.manager, "owned-outside"); let reads = 0;
    await mkdir(outside);
    vi.spyOn(f.store, "list").mockImplementation(async () => {
      const value = await list();
      if (++reads === 2) {
        const directory = path.join(f.manager, "world-library");
        await rename(directory, path.join(f.manager, "retained-world-library"));
        await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
      }
      return value;
    });
    await expect(f.library.sealGenerationExecution(f.binding, f.prepared.catalogRevision, f.execution, f.journal, f.store)).rejects.toThrow();
    await expect(readFile(path.join(outside, `${f.serverId}.generation-execution.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
