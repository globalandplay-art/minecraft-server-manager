import { randomUUID } from "node:crypto";
import { cp, link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { WorldCreateRequest } from "@mcsm/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import { parseProperties } from "../src/config/properties.js";
import { ActiveWorldStateStore, worldIdentity } from "../src/services/active-world-state-store.js";
import { BackupService } from "../src/services/backup-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { WorldCreatePlanService } from "../src/services/world-create-plan-service.js";
import { WorldCreateService } from "../src/services/world-create-service.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-10-02T00:00:00Z") };
const originalProperties = "# retained comment\nlevel-name=world\nlevel-seed=17\nrcon.password=PRIVATE_SENTINEL\nmax-players=20\n";
function string(value: string): Buffer {
  const bytes = Buffer.from(value); const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}
function tag(kind: number, name: string, value: Buffer): Buffer { return Buffer.concat([Buffer.from([kind]), string(name), value]); }
function compound(name: string, children: Buffer[]): Buffer { return tag(10, name, Buffer.concat([...children, Buffer.from([0])])); }
function level(marker = "preserved", version = "26.3"): Buffer {
  return gzipSync(Buffer.concat([Buffer.from([10]), string(""), compound("Data", [
    compound("Version", [tag(8, "Name", string(version))]), tag(8, "LevelName", string(marker))
  ]), Buffer.from([0])]));
}
async function complete(ops: OperationService, id: string) {
  await vi.waitFor(() => {
    expect(ops.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u);
    expect(ops.getServerState(ops.get(id)!.serverId).activeOperationId).toBeNull();
  }, { timeout: 10_000 });
  return ops.get(id)!;
}
async function fixture(inject?: (point: string) => Promise<void>) {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-world-create-")); roots.push(parent);
  const manager = path.join(parent, "manager"); const server = path.join(parent, "server");
  await mkdir(manager); await mkdir(path.join(server, "world"), { recursive: true });
  await writeFile(path.join(server, "server.properties"), originalProperties);
  await writeFile(path.join(server, "world", "level.dat"), level());
  for (const dimension of ["region", "DIM-1/region", "DIM1/region", "dimensions/custom/deep/region", "playerdata"]) {
    await mkdir(path.join(server, "world", dimension), { recursive: true });
    await writeFile(path.join(server, "world", dimension, "fixture.dat"), "old:" + dimension);
  }
  const status = { state: "stopped", ownership: "none", recoveryRequired: false };
  const stop = vi.fn(async () => { status.state = "stopped"; status.ownership = "none"; });
  const start = vi.fn(async () => { status.state = "running"; status.ownership = "managed"; });
  const adapter = { serverId: "create-test", mode: "local", plan: { rootPath: server, eulaAccepted: true, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getStatus: async () => ({ ...status, source: "process", observedAt: clock.now().toISOString(), activeOperationId: null }),
    getServerInfo: async () => ({ id: "create-test", name: "Create fixture", type: "vanilla", minecraftVersion: "26.3",
      java: { runtimeVersion: "25", requiredMajor: 25 }, detection: { confidence: "high", evidence: ["fixture"], warnings: [] } }),
    getCapabilities: async () => ({ mods: false, plugins: false, rcon: false, console: false, backup: true, worlds: true, properties: true }),
    getCommandTransport: async () => "unavailable", revalidateBeforeStart: async () => {},
    stop, start, subscribe: () => () => {}, closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]); const journal = new TransactionJournalStore(manager);
  const store = new MemoryOperationStore(); const ops = new OperationService(store, clock, journal); await ops.initialize();
  const states = new ActiveWorldStateStore(manager, [adapter]); expect((await states.initialize()).size).toBe(0);
  const backups = new BackupService(registry, ops, journal, manager, clock);
  const service = new WorldCreateService(registry, ops, journal, backups, manager, states, clock, inject);
  const plan = await new WorldCreatePlanService(registry, ops).plan(adapter.serverId, { name: "new-world", seed: "9223372036854775807" });
  const body: WorldCreateRequest = { name: plan.name, seed: plan.seed!, confirmWorldName: plan.currentWorldName,
    worldRevision: plan.worldRevision!, allowStop: false };
  return { parent, manager, server, adapter, registry, journal, store, ops, states, backups, service, body, status, start, stop };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function restarted(f: Fixture, reconcile = true, adapter = f.adapter) {
  const registry = new AdapterRegistry([adapter]); const journal = new TransactionJournalStore(f.manager);
  const ops = new OperationService(f.store, clock, journal);
  const backups = new BackupService(registry, ops, journal, f.manager, clock);
  const states = new ActiveWorldStateStore(f.manager, [adapter]);
  const service = new WorldCreateService(registry, ops, journal, backups, f.manager, states, clock);
  if (reconcile) await service.reconcileStartup();
  await ops.initialize(); ops.requireRecovery(await states.initialize());
  return { ops, service, states, journal };
}
async function makeOutcomeUncertain(f: Fixture, id: string) {
  const stored = (await f.store.list()).find((record) => record.operation.id === id)!;
  await f.store.save({ ...stored, operation: { ...stored.operation, state: "running", step: "switching-world-config" } });
}
async function assertOldWorld(f: Fixture) {
  expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(level());
  for (const dimension of ["region", "DIM-1/region", "DIM1/region", "dimensions/custom/deep/region", "playerdata"]) {
    expect(await readFile(path.join(f.server, "world", dimension, "fixture.dat"), "utf8")).toBe("old:" + dimension);
  }
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("P3.3b guarded new-world configuration transaction", () => {
  it("preserves every old dimension, pins a full guard and persists pending generation without starting", async () => {
    const f = await fixture(); const key = randomUUID(); const op = await f.service.create(f.adapter.serverId, f.body, key);
    const result = await complete(f.ops, op.id);
    expect(result).toMatchObject({ kind: "world-create", state: "succeeded", result: { rollbackAvailable: false } });
    expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled(); await assertOldWorld(f);
    expect(await readdir(f.server)).not.toContain(f.body.name);
    const props = await readFile(path.join(f.server, "server.properties"), "utf8");
    expect(parseProperties(props)).toEqual(new Map([["level-name", f.body.name], ["level-seed", f.body.seed], ["rcon.password", "PRIVATE_SENTINEL"], ["max-players", "20"]]));
    expect(props).toContain("# retained comment");
    const [guard] = await f.backups.list(f.adapter.serverId);
    expect(guard).toMatchObject({ id: result.result!.resourceId, pinned: true, scope: "world-set", label: "Before World Create", minecraftVersion: "26.3", includedRoots: ["world"], wasRunning: false, restarted: false });
    const { directory, manifest } = await f.backups.exportSource(f.adapter.serverId, guard!.id);
    expect(manifest.files.map((file) => file.path)).toContain("world/dimensions/custom/deep/region/fixture.dat");
    expect(await readFile(path.join(directory, "payload", "world", "level.dat"))).toEqual(level());
    expect(f.states.snapshot(f.adapter.serverId)).toMatchObject({ state: "pending-generation", levelName: f.body.name, worldId: worldIdentity(f.adapter.serverId, f.body.name) });
    const record = (await f.journal.scan()).records.find((r) => r.intent.operationId === op.id)!;
    expect(record).toMatchObject({ schemaVersion: 3, state: "committed", intent: { worldChange: { previousName: "world", nextName: f.body.name, guardBackupId: guard!.id } } });
    expect(await readFile(path.join(f.server, record.intent.worldChange!.workspaceName, "properties.before"), "utf8")).toBe(originalProperties);
    expect((await f.service.create(f.adapter.serverId, f.body, key)).id).toBe(op.id);
    await expect(f.service.create(f.adapter.serverId, { ...f.body, seed: "0" }, key)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    const next = await restarted(f);
    expect(next.ops.get(op.id)?.state).toBe("succeeded"); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect(next.states.snapshot(f.adapter.serverId)?.state).toBe("pending-generation");
    expect(JSON.stringify(result)).not.toContain(f.server); expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
  });

  it("requires stop consent, then preserves the authorized stop save and never restarts", async () => {
    const f = await fixture(); f.status.state = "running"; f.status.ownership = "managed";
    await expect(f.service.create(f.adapter.serverId, f.body, randomUUID())).rejects.toMatchObject({ code: "SERVER_MUST_BE_STOPPED" });
    expect((await f.journal.scan()).records).toHaveLength(0); expect(f.stop).not.toHaveBeenCalled();
    f.stop.mockImplementation(async () => { f.status.state = "stopped"; f.status.ownership = "none"; await writeFile(path.join(f.server, "world", "level.dat"), level("saved-at-stop")); });
    const op = await f.service.create(f.adapter.serverId, { ...f.body, allowStop: true }, randomUUID());
    const result = await complete(f.ops, op.id); expect(result.state).toBe("succeeded");
    expect(f.stop).toHaveBeenCalledOnce(); expect(f.start).not.toHaveBeenCalled();
    const source = await f.backups.exportSource(f.adapter.serverId, result.result!.resourceId!);
    expect(source.manifest.wasRunning).toBe(true);
    expect(await readFile(path.join(source.directory, "payload", "world", "level.dat"))).toEqual(level("saved-at-stop"));
  });

  it.each(["wrong-name", "stale-world", "external", "unknown", "recovery", "active-state"])("rejects %s before creating an operation or modifying files", async (reason) => {
    const f = await fixture(); let body = f.body;
    if (reason === "wrong-name") body = { ...body, confirmWorldName: "wrong" };
    if (reason === "stale-world") await writeFile(path.join(f.server, "world", "level.dat"), level("changed"));
    if (reason === "external") { f.status.state = "running"; f.status.ownership = "external"; }
    if (reason === "unknown") f.status.state = "unknown";
    if (reason === "recovery") f.ops.requireRecovery([f.adapter.serverId]);
    if (reason === "active-state") vi.spyOn(f.states, "snapshot").mockReturnValue({ schemaVersion: 1, serverId: f.adapter.serverId, state: "active", worldId: "wrong", levelName: "world" });
    await expect(f.service.create(f.adapter.serverId, body, randomUUID())).rejects.toBeDefined();
    expect(await f.store.list()).toHaveLength(0); expect((await f.journal.scan()).records).toHaveLength(0);
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(originalProperties);
    expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
  });

  it.each(["intent-created", "stop-confirmed", "guard-verified", "config-ready", "config-switch-intent", "config-installed", "active-state-installed", "before-commit"])("preserves old-world evidence and gates recovery after injected %s", async (boundary) => {
    const f = await fixture(async (point) => { if (point === boundary) throw new Error("simulated interruption"); });
    const op = await f.service.create(f.adapter.serverId, f.body, randomUUID());
    expect(await complete(f.ops, op.id)).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
    await assertOldWorld(f); expect(f.start).not.toHaveBeenCalled(); expect(await readdir(f.server)).not.toContain(f.body.name);
    const record = (await f.journal.scan()).records.find((r) => r.intent.operationId === op.id)!;
    expect(record).toBeDefined(); expect(record.intent.worldChange).toBeDefined();
    if (record.checkpoints.some((c) => c.name === "guard-verified")) {
      const source = await f.backups.exportSource(f.adapter.serverId, record.intent.worldChange!.guardBackupId);
      expect(source.manifest.pinned).toBe(true); expect(await readFile(path.join(source.directory, "payload", "world", "level.dat"))).toEqual(level());
    }
    const next = await restarted(f); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    await expect(next.ops.requestLifecycle(f.adapter.serverId, "start", randomUUID(), async () => {})).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(next.service.create(f.adapter.serverId, f.body, randomUUID())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });

  it("locks concurrent create, backup and lifecycle while a guard checkpoint is held", async () => {
    let release: () => void = () => {}; let entered: () => void = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const f = await fixture(async (point) => { if (point === "guard-verified") { entered(); await barrier; } });
    const key = randomUUID(); const op = await f.service.create(f.adapter.serverId, f.body, key);
    try {
      await reached;
      expect((await f.service.create(f.adapter.serverId, f.body, key)).id).toBe(op.id);
      await expect(f.service.create(f.adapter.serverId, f.body, randomUUID())).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      await expect(f.backups.create(f.adapter.serverId, { scope: "world-set", allowStop: false }, randomUUID())).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      await expect(f.ops.requestLifecycle(f.adapter.serverId, "start", randomUUID(), async () => {})).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    } finally { release(); }
    expect((await complete(f.ops, op.id)).state).toBe("succeeded");
  });

  it("confirms an uncertain committed operation only after verifying the physical configuration and guard", async () => {
    const f = await fixture(); const op = await f.service.create(f.adapter.serverId, f.body, randomUUID()); await complete(f.ops, op.id);
    await makeOutcomeUncertain(f, op.id); const next = await restarted(f);
    expect(next.ops.get(op.id)).toMatchObject({ state: "succeeded", error: null });
    expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect(next.states.snapshot(f.adapter.serverId)?.state).toBe("pending-generation"); expect(f.start).not.toHaveBeenCalled();
  });

  it("physically reconciles an interruption after durable commit before recovering its success", async () => {
    const f = await fixture(async (point) => { if (point === "after-commit") throw new Error("commit outcome interruption"); });
    const op = await f.service.create(f.adapter.serverId, f.body, randomUUID());
    expect((await complete(f.ops, op.id)).state).toBe("interrupted");
    expect(f.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    const next = await restarted(f);
    expect(next.ops.get(op.id)).toMatchObject({ state: "succeeded", error: null });
    expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    await assertOldWorld(f); expect(f.start).not.toHaveBeenCalled();
  });

  it("keeps an uncertain commit gated if physical reconciliation did not run", async () => {
    const f = await fixture(); const op = await f.service.create(f.adapter.serverId, f.body, randomUUID()); await complete(f.ops, op.id);
    await makeOutcomeUncertain(f, op.id); const next = await restarted(f, false);
    expect(next.ops.get(op.id)?.state).toBe("interrupted"); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
  });

  it.each(["configuration", "active-state", "old-world", "guard", "missing-snapshot", "unexpected-target", "unknown-process", "external-process"])("keeps uncertain committed %s gated on restart", async (failure) => {
    const f = await fixture(); const op = await f.service.create(f.adapter.serverId, f.body, randomUUID()); const outcome = await complete(f.ops, op.id);
    const record = (await f.journal.scan()).records.find((r) => r.intent.operationId === op.id)!;
    await makeOutcomeUncertain(f, op.id);
    if (failure === "configuration") await writeFile(path.join(f.server, "server.properties"), originalProperties);
    if (failure === "active-state") await writeFile(path.join(f.manager, "active-worlds", `${f.adapter.serverId}.json`), JSON.stringify({ ...f.states.snapshot(f.adapter.serverId), worldId: "wrong" }));
    if (failure === "old-world") await writeFile(path.join(f.server, "world", "level.dat"), level("tampered"));
    if (failure === "guard") await writeFile(path.join(f.manager, "backups", f.adapter.serverId, outcome.result!.resourceId!, "payload", "world", "level.dat"), level("tampered"));
    if (failure === "missing-snapshot") await rm(path.join(f.server, record.intent.worldChange!.workspaceName, "properties.before"));
    if (failure === "unexpected-target") await mkdir(path.join(f.server, f.body.name));
    if (failure === "unknown-process") { f.status.state = "unknown"; f.status.recoveryRequired = true; }
    if (failure === "external-process") { f.status.state = "running"; f.status.ownership = "external"; }
    const next = await restarted(f);
    expect(next.ops.get(op.id)).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
    expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    await expect(next.ops.requestLifecycle(f.adapter.serverId, "start", randomUUID(), async () => {})).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });

  it("binds even an established commit to its registered root rather than an identical copied server", async () => {
    const f = await fixture(); const op = await f.service.create(f.adapter.serverId, f.body, randomUUID()); await complete(f.ops, op.id);
    const other = path.join(f.parent, "other-server"); await cp(f.server, other, { recursive: true });
    const adapter = { ...f.adapter, plan: { ...f.adapter.plan, rootPath: other } };
    const before = await readFile(path.join(other, "server.properties")); const next = await restarted(f, true, adapter);
    expect(next.ops.getServerState(adapter.serverId).recoveryRequired).toBe(true);
    await expect(next.ops.requestLifecycle(adapter.serverId, "start", randomUUID(), async () => {})).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(path.join(other, "server.properties"))).toEqual(before); expect(f.start).not.toHaveBeenCalled();
  });

  it("does not hash-lock an established successful operation after explicit generation and later play", async () => {
    const f = await fixture(); const op = await f.service.create(f.adapter.serverId, f.body, randomUUID()); await complete(f.ops, op.id);
    await mkdir(path.join(f.server, f.body.name)); await writeFile(path.join(f.server, f.body.name, "level.dat"), level("normal generated world"));
    await f.states.reconcileAfterStart(f.adapter.serverId);
    await writeFile(path.join(f.server, "world", "level.dat"), level("later archived changes"));
    const next = await restarted(f);
    expect(next.ops.get(op.id)?.state).toBe("succeeded"); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect(next.states.snapshot(f.adapter.serverId)?.state).toBe("active");
  });

  it("rejects a hard-linked configuration without changing the linked file", async () => {
    const f = await fixture(); const linked = path.join(f.parent, "linked.properties"); await link(path.join(f.server, "server.properties"), linked);
    const op = await f.service.create(f.adapter.serverId, f.body, randomUUID()); const outcome = await complete(f.ops, op.id);
    expect(outcome.state).toBe("failed"); expect(outcome.error?.code).toBe("WORLD_REVISION_CONFLICT");
    expect(await readFile(linked, "utf8")).toBe(originalProperties); expect((await f.journal.scan()).records).toHaveLength(0);
  });
});

describe("P3.3b composed HTTP create and journal startup", () => {
  const readHeaders = { host: "127.0.0.1:8080" };
  const writeHeaders = { ...readHeaders, origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" };
  function httpApp(f: Fixture) {
    return buildApp({ adapters: [f.adapter], mode: "local", clock, operationStore: f.store,
      transactionJournal: f.journal, managerRoot: f.manager, activeWorldState: f.states });
  }

  it("blocks an active pre-switch journal even with a legacy partial state provider and omitted transactionRecovery", async () => {
    const f = await fixture(); const operationId = randomUUID();
    const workspaceName = `.manager-world-create-${operationId}`;
    await f.journal.createIntent({ operationId, serverId: f.adapter.serverId, kind: "world-create", scope: "world-set",
      resourceId: worldIdentity(f.adapter.serverId, f.body.name), allowStop: false, originalState: "stopped", createdAt: clock.now().toISOString(),
      paths: [{ role: "source", namespace: "server", relativePath: "world" },
        { role: "target", namespace: "server", relativePath: f.body.name }, { role: "staging", namespace: "server", relativePath: workspaceName }],
      worldChange: { rootIdentity: "a".repeat(64), previousName: "world", nextName: f.body.name, approvedRevision: f.body.worldRevision,
        guardBackupId: randomUUID(), propertiesBefore: "b".repeat(64), propertiesAfter: "c".repeat(64), workspaceName } });
    const legacyState = { initialize: f.states.initialize.bind(f.states), isActive: f.states.isActive.bind(f.states),
      reconcileAfterStart: f.states.reconcileAfterStart.bind(f.states) };
    const app = buildApp({ adapters: [f.adapter], mode: "local", clock, operationStore: f.store,
      transactionJournal: f.journal, managerRoot: f.manager, activeWorldState: legacyState });
    try {
      const summary = await app.inject({ method: "GET", url: `/api/v1/servers/${f.adapter.serverId}`, headers: readHeaders });
      expect(summary.statusCode).toBe(200);
      expect(summary.json().data.status).toMatchObject({ state: "stopped", recoveryRequired: true });
      expect(summary.json().data.readiness.start).toEqual({ allowed: false, reason: "recovery-required" });
      for (const request of [
        { url: `/api/v1/servers/${f.adapter.serverId}/actions/start`, payload: {} },
        { url: `/api/v1/servers/${f.adapter.serverId}/backups`, payload: { scope: "world-set", allowStop: false } },
        { url: `/api/v1/servers/${f.adapter.serverId}/worlds/create-plan`, payload: { name: f.body.name, seed: f.body.seed } }
      ]) {
        const response = await app.inject({ method: "POST", ...request, headers: { ...writeHeaders, "idempotency-key": randomUUID() } });
        expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("RECOVERY_REQUIRED");
      }
      expect(f.states.snapshot(f.adapter.serverId)?.state).toBe("active"); expect(await f.store.list()).toHaveLength(0);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(originalProperties);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("returns 202 for guarded HTTP create, polls success, and reuses the persisted idempotent operation", async () => {
    const f = await fixture(); const app = httpApp(f); const key = randomUUID();
    const url = `/api/v1/servers/${f.adapter.serverId}/worlds`;
    const headers = { ...writeHeaders, "idempotency-key": key };
    try {
      const response = await app.inject({ method: "POST", url, headers, payload: f.body });
      expect(response.statusCode).toBe(202); const id = response.json().data.operation.id;
      await vi.waitFor(async () => {
        const poll = await app.inject({ method: "GET", url: `/api/v1/operations/${id}`, headers: readHeaders });
        expect(poll.statusCode).toBe(200); expect(poll.json().data.state).toBe("succeeded");
      }, { timeout: 10_000 });
      const retry = await app.inject({ method: "POST", url, headers, payload: f.body });
      expect(retry.statusCode).toBe(202); expect(retry.json().data.operation.id).toBe(id);
      const changed = await app.inject({ method: "POST", url, headers, payload: { ...f.body, seed: "0" } });
      expect(changed.statusCode).toBe(409); expect(changed.json().error.code).toBe("OPERATION_CONFLICT");
      expect(await f.store.list()).toHaveLength(1);
      expect(f.states.snapshot(f.adapter.serverId)?.state).toBe("pending-generation");
      expect(parseProperties(await readFile(path.join(f.server, "server.properties"), "utf8")).get("level-seed")).toBe(f.body.seed);
      await assertOldWorld(f); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
      expect(response.body).not.toContain("PRIVATE_SENTINEL"); expect(response.body).not.toContain(f.server);
    } finally { await app.close(); }
  });

  it.each([9007199254740993, ["9223372036854775807"], true])("rejects non-string HTTP create seed %j before coercion or mutation", async (seed) => {
    const f = await fixture(); const app = httpApp(f);
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/servers/${f.adapter.serverId}/worlds`,
        headers: { ...writeHeaders, "idempotency-key": randomUUID() }, payload: { ...f.body, seed } });
      expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe("VALIDATION_ERROR");
      expect(await f.store.list()).toHaveLength(0); expect((await f.journal.scan()).records).toHaveLength(0);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(originalProperties);
      await assertOldWorld(f); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(["wrong-confirmation", "stale-revision", "stop-consent"])("rejects HTTP create %s during preflight without mutation", async (failure) => {
    const f = await fixture(); const app = httpApp(f); let body = f.body;
    if (failure === "wrong-confirmation") body = { ...body, confirmWorldName: "different" };
    if (failure === "stale-revision") body = { ...body, worldRevision: "0".repeat(64) };
    if (failure === "stop-consent") { f.status.state = "running"; f.status.ownership = "managed"; }
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/servers/${f.adapter.serverId}/worlds`,
        headers: { ...writeHeaders, "idempotency-key": randomUUID() }, payload: body });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe(failure === "stop-consent" ? "SERVER_MUST_BE_STOPPED" : "WORLD_REVISION_CONFLICT");
      expect(await f.store.list()).toHaveLength(0); expect((await f.journal.scan()).records).toHaveLength(0);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(originalProperties);
      await assertOldWorld(f); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("requires a valid idempotency key and enforces write guards and strict fields before create", async () => {
    const f = await fixture(); const app = httpApp(f); const url = `/api/v1/servers/${f.adapter.serverId}/worlds`;
    try {
      for (const headers of [writeHeaders, { ...writeHeaders, "idempotency-key": "invalid" }]) {
        const response = await app.inject({ method: "POST", url, headers, payload: f.body });
        expect(response.statusCode).toBe(428); expect(response.json().error.code).toBe("PRECONDITION_REQUIRED");
      }
      const headers = { ...writeHeaders, "idempotency-key": randomUUID() };
      expect((await app.inject({ method: "POST", url, headers: { ...headers, origin: "https://evil.example" }, payload: f.body })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url, headers, payload: { ...f.body, startAfterCreate: true } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url, headers, payload: { ...f.body, allowStop: "false" } })).statusCode).toBe(400);
      expect(await f.store.list()).toHaveLength(0); expect((await f.journal.scan()).records).toHaveLength(0);
      expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(originalProperties);
      expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
