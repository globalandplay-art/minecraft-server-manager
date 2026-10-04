import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AdapterRegistry } from "../src/adapters/registry.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import type { RuntimeOperationContext } from "../src/infra/runtime-contract.js";
import { worldIdentity } from "../src/services/active-world-state-store.js";
import { PropertiesWriteService } from "../src/services/properties-write-service.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { verifyCommittedProperties } from "../src/services/properties-reconciliation.js";
import { assertPropertiesBootstrapSafety } from "../src/services/properties-bootstrap.js";
import { buildApp } from "../src/app.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(inject?: (point: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-properties-write-")); roots.push(root);
  const server = path.join(root, "server"), manager = path.join(root, "manager");
  await mkdir(server); await mkdir(manager); await mkdir(path.join(server, "world"));
  await writeFile(path.join(server, "world", "level.dat"), "isolated world revision");
  const original = "# retained\r\nlevel-name=world\npvp=true\rrcon.password=isolated-private-password\n";
  await writeFile(path.join(server, "server.properties"), original);
  const journal = new TransactionJournalStore(manager); await journal.initialize();
  const id = "test-server";
  const confirmations: string[] = [], recovery: string[] = [];
  const adapter = { serverId: id, plan: { rootPath: server, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false, activeOperationId: null }) };
  const registry = { getLocal: () => adapter } as unknown as AdapterRegistry;
  // This fixture exercises the coupled filesystem core, not durable admission/idempotency.
  const operations = { getServerState: () => ({ recoveryRequired: false, activeOperationId: null }),
    storedOutcomes: async () => [], confirmPhysicalTransaction: (id: string) => confirmations.push(id),
    requireTransactionRecovery: (_server: string, id: string) => recovery.push(id),
    requestBackup: async (_server: string, _key: string, _body: string,
      execute: (ctx: RuntimeOperationContext) => Promise<void>, preflight: () => Promise<void>) => {
      await preflight(); await execute({ operationId: randomUUID(), signal: new AbortController().signal,
        onStep: async () => {}, onResult: async () => {} }); return {};
    } } as unknown as OperationService;
  const states = { snapshot: () => ({ schemaVersion: 1 as const, serverId: id, state: "active" as const,
    levelName: "world", worldId: worldIdentity(id, "world") }) };
  const service = new PropertiesWriteService(registry, operations, journal, manager, states, { now: () => new Date() }, inject);
  const revision = (await service.reader.read(id, server)).revision;
  const request = { changes: { pvp: "false" }, revision, confirmOfflineIdentity: false };
  return { server, manager, journal, service, request, original, id, adapter, confirmations, recovery };
}

it("commits exact non-target bytes with immutable old slot and verified pinned guard", async () => {
  const f = await fixture();
  try { await f.service.save(f.id, f.request, randomUUID()); } catch (error) {
    throw new Error(`Core stopped after checkpoints: ${JSON.stringify((await f.journal.scan()).records[0]?.checkpoints.map((cp) => cp.name))}`, { cause: error });
  }
  expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(f.original.replace("pvp=true", "pvp=false"));
  const record = (await f.journal.scan()).records[0]!;
  expect(record.state).toBe("committed");
  expect(JSON.stringify(record)).not.toContain("isolated-private-password");
  await expect(verifyCommittedProperties(f.manager, f.journal, record, f.server, false)).resolves.toBeUndefined();
  expect(await readFile(path.join(f.server, record.intent.propertiesWrite!.workspaceName, "old.properties"), "utf8")).toBe(f.original);
});

it.each(["properties-prepare-intent", "properties-old-moved", "properties-installed", "properties-before-commit"])("retains recovery evidence at %s without automatic rollback", async (point) => {
  const f = await fixture(async (current) => { if (current === point) throw new Error("isolated interruption"); });
  await expect(f.service.save(f.id, f.request, randomUUID())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  const record = (await f.journal.scan()).records[0]!;
  expect(record.state).toBe("recovery-required");
  const guard = path.join(f.manager, "properties-backups", f.id, record.intent.propertiesWrite!.guardId, "original.properties");
  expect(await readFile(guard, "utf8")).toBe(f.original);
});

it("rejects a stale approval before creating a journal or altering config", async () => {
  const f = await fixture(); await writeFile(path.join(f.server, "server.properties"), f.original + "# changed\n");
  await expect(f.service.save(f.id, f.request, randomUUID())).rejects.toMatchObject({ code: "PROPERTIES_REVISION_CONFLICT" });
  expect((await f.journal.scan()).records).toHaveLength(0);
});

it("does not publish success if target changes after commit", async () => {
  let server = "";
  const f = await fixture(async (point) => {
    if (point === "properties-after-commit") await writeFile(path.join(server, "server.properties"), "level-name=world\npvp=true\n");
  }); server = f.server;
  await expect(f.service.save(f.id, f.request, randomUUID())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  expect((await f.journal.scan()).records[0]!.state).toBe("committed");
});

it("reconciles a physically verified committed operation without guessing a repair", async () => {
  const f = await fixture(); await f.service.save(f.id, f.request, randomUUID());
  await f.service.reconcileStartup();
  expect(f.confirmations).toHaveLength(1); expect(f.recovery).toHaveLength(0);
});

it("rechecks target after the runtime status await before confirming restart success", async () => {
  const f = await fixture(); await f.service.save(f.id, f.request, randomUUID());
  f.adapter.getStatus = async () => {
    await writeFile(path.join(f.server, "server.properties"), f.original);
    return { state: "stopped", ownership: "none", recoveryRequired: false, activeOperationId: null };
  };
  await f.service.reconcileStartup();
  expect(f.confirmations).toHaveLength(0); expect(f.recovery).toHaveLength(1);
});

it("keeps physically confirmed history valid across two OperationService restarts and a legitimate offline edit", async () => {
  const f = await fixture(); await f.service.save(f.id, f.request, randomUUID());
  const record = (await f.journal.scan()).records[0]!;
  const clock = { now: () => new Date() }, store = new MemoryOperationStore();
  await store.save({ idempotencyKey: randomUUID(), requestFingerprint: "fixture", expiresAt: new Date(Date.now() + 60000).toISOString(),
    operation: { id: record.intent.operationId, serverId: f.id, kind: "properties-write", state: "running", step: "installing",
      progress: null, createdAt: record.intent.createdAt, updatedAt: record.updatedAt,
      result: { resourceId: record.intent.propertiesWrite!.guardId, rollbackAvailable: false }, error: null } });
  const states = { snapshot: () => ({ schemaVersion: 1 as const, serverId: f.id, state: "active" as const,
    levelName: "world", worldId: worldIdentity(f.id, "world") }) };
  const first = new OperationService(store, clock, f.journal);
  const service = new PropertiesWriteService(f.service.registry, first, f.journal, f.manager, states, clock);
  await service.reconcileStartup(); await first.initialize();
  expect((await store.list())[0]!.operation).toMatchObject({ state: "succeeded", step: "committed", error: null });
  await writeFile(path.join(f.server, "server.properties"), f.original + "# legitimate offline edit\n");
  const second = new OperationService(store, clock, f.journal);
  await new PropertiesWriteService(f.service.registry, second, f.journal, f.manager, states, clock).reconcileStartup();
  await second.initialize();
  expect(second.getServerState(f.id).recoveryRequired).toBe(false);
  expect((await store.list())[0]!.operation.state).toBe("succeeded");
});

it("bootstrap permits physically proven committed config before constructing a launch plan", async () => {
  const f = await fixture(); await f.service.save(f.id, f.request, randomUUID());
  const config = { id: f.id, name: "isolated", root: f.server, javaExecutable: "never-execute", jarFile: "never-read.jar", jvmArgs: [], serverArgs: [] };
  await expect(assertPropertiesBootstrapSafety([config], await f.journal.scan(),
    { managerRoot: f.manager, journal: f.journal, outcomes: [] })).resolves.toBeUndefined();
  await writeFile(path.join(f.server, "server.properties"), f.original);
  await expect(assertPropertiesBootstrapSafety([config], await f.journal.scan(),
    { managerRoot: f.manager, journal: f.journal, outcomes: [] })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
});

it("real durable admission deduplicates the same key without creating a second transaction", async () => {
  const f = await fixture(); const clock = { now: () => new Date() };
  const operations = new OperationService(new MemoryOperationStore(), clock, f.journal); await operations.initialize();
  const states = { snapshot: () => ({ schemaVersion: 1 as const, serverId: f.id, state: "active" as const,
    levelName: "world", worldId: worldIdentity(f.id, "world") }) };
  const service = new PropertiesWriteService(f.service.registry, operations, f.journal, f.manager, states, clock);
  const request = { ...f.request, revision: (await service.reader.read(f.id, f.server)).revision };
  const key = randomUUID(); const first = await service.save(f.id, request, key);
  const duplicate = await service.save(f.id, request, key); expect(duplicate.id).toBe(first.id);
  await expect.poll(async () => (await operations.storedOutcomes()).find((op) => op.id === first.id)?.state).toBe("succeeded");
  expect((await f.journal.scan()).records).toHaveLength(1);
  await expect(service.save(f.id, { ...request, changes: { pvp: "true" } }, key)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
});

it("app startup physically reconciles properties before OperationService reconstructs its result", async () => {
  const f = await fixture(); await f.service.save(f.id, f.request, randomUUID());
  const record = (await f.journal.scan()).records[0]!;
  const store = new MemoryOperationStore();
  await store.save({ idempotencyKey: randomUUID(), requestFingerprint: "fixture", expiresAt: new Date(Date.now() + 60000).toISOString(),
    operation: { id: record.intent.operationId, serverId: f.id, kind: "properties-write", state: "running", step: "installing",
      progress: null, createdAt: record.intent.createdAt, updatedAt: record.updatedAt,
      result: { resourceId: record.intent.propertiesWrite!.guardId, rollbackAvailable: false }, error: null } });
  const adapter = { ...f.adapter, mode: "local", subscribe: () => () => {}, closeObserver: async () => {} } as unknown as LocalMinecraftServerAdapter;
  const active = { snapshot: () => ({ schemaVersion: 1 as const, serverId: f.id, state: "active" as const,
      levelName: "world", worldId: worldIdentity(f.id, "world") }),
    initialize: async () => new Set<string>(), isActive: async () => true, reconcileAfterStart: async () => {} };
  const app = buildApp({ mode: "local", adapters: [adapter], operationStore: store, transactionJournal: f.journal,
    managerRoot: f.manager, activeWorldState: active, backupSchedulerTimers: false });
  try {
    await app.ready();
    expect((await store.list())[0]!.operation).toMatchObject({ state: "succeeded", step: "committed", error: null });
    const url = `/api/v1/servers/${f.id}/properties`;
    const read = await app.inject({ method: "GET", url, headers: { host: "localhost:8080" } });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toBe("no-store");
    expect(read.body).not.toContain("isolated-private-password");
    expect(Object.keys(read.json().data)).toEqual(["fields", "revision", "fieldRules"]);
    expect(read.json().data.fieldRules["view-distance"].editable).toBe(false);
    const headers = { host: "localhost:8080", origin: "http://localhost:3000", "x-manager-intent": "local-ui",
      "content-type": "application/json", "if-match": String(read.headers.etag), "idempotency-key": randomUUID() };
    const payload = { changes: { pvp: "true" }, confirmOfflineIdentity: false };
    const noIntent = await app.inject({ method: "PATCH", url, headers: { ...headers, "x-manager-intent": "missing" }, payload });
    expect(noIntent.statusCode).toBe(403);
    const forbidden = await app.inject({ method: "PATCH", url, headers, payload: { ...payload, changes: { "rcon.password": "private" } } });
    expect(forbidden.statusCode).toBe(400);
    const missing = await app.inject({ method: "PATCH", url, headers: { ...headers, "if-match": "*" }, payload });
    expect(missing.statusCode).toBe(428);
    const unsafe = await app.inject({ method: "PATCH", url, headers, payload: { ...payload, root: "outside" } });
    expect(unsafe.statusCode).toBe(400);
    const invalidValue = await app.inject({ method: "PATCH", url, headers, payload: { ...payload, changes: { pvp: false } } });
    expect(invalidValue.statusCode).toBe(400);
    const write = await app.inject({ method: "PATCH", url, headers, payload });
    expect(write.statusCode).toBe(202);
    expect(write.json().data).toMatchObject({ restartRequired: true, restartFields: ["pvp"] });
    const duplicate = await app.inject({ method: "PATCH", url, headers, payload });
    expect(duplicate.json().data.operation.id).toBe(write.json().data.operation.id);
    await expect.poll(async () => (await store.list()).find((item) => item.operation.id === write.json().data.operation.id)?.operation.state).toBe("succeeded");
    const stale = await app.inject({ method: "PATCH", url, headers: { ...headers, "idempotency-key": randomUUID() }, payload });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("PROPERTIES_REVISION_CONFLICT");
    expect((await f.journal.scan()).records).toHaveLength(2);
    const refreshed = await app.inject({ method: "GET", url, headers: { host: "localhost:8080" } });
    const offlineHeaders = { ...headers, "if-match": String(refreshed.headers.etag), "idempotency-key": randomUUID() };
    const offlinePayload = { changes: { "online-mode": "false" }, confirmOfflineIdentity: false };
    const unconfirmed = await app.inject({ method: "PATCH", url, headers: offlineHeaders, payload: offlinePayload });
    expect(unconfirmed.statusCode).toBe(400);
    expect((await f.journal.scan()).records).toHaveLength(2);
    const confirmed = await app.inject({ method: "PATCH", url, headers: offlineHeaders, payload: { ...offlinePayload, confirmOfflineIdentity: true } });
    expect(confirmed.statusCode).toBe(202);
    await expect.poll(async () => (await store.list()).find((item) => item.operation.id === confirmed.json().data.operation.id)?.operation.state).toBe("succeeded");
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toContain("online-mode=false");
  } finally { await app.close(); }
});

it.each(["running", "external", "unknown", "recovery", "none"])("real admission refuses %s with no journal or config mutation", async (kind) => {
  const f = await fixture(); const clock = { now: () => new Date() };
  const operations = new OperationService(new MemoryOperationStore(), clock, f.journal); await operations.initialize();
  if (kind === "recovery") operations.requireRecovery([f.id]);
  f.adapter.getStatus = async () => ({ state: kind === "running" ? "running" : "stopped",
    ownership: kind === "external" ? "external" : kind === "unknown" ? "unknown" : "none", recoveryRequired: false, activeOperationId: null });
  const states = { snapshot: () => kind === "none"
    ? { schemaVersion: 1 as const, serverId: f.id, state: "none" as const, levelName: null, worldId: null }
    : { schemaVersion: 1 as const, serverId: f.id, state: "active" as const, levelName: "world", worldId: worldIdentity(f.id, "world") } };
  const service = new PropertiesWriteService(f.service.registry, operations, f.journal, f.manager, states, clock);
  const request = { ...f.request, revision: (await service.reader.read(f.id, f.server)).revision };
  await expect(service.save(f.id, request, randomUUID())).rejects.toMatchObject({ statusCode: 409 });
  expect((await f.journal.scan()).records).toHaveLength(0);
  expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(f.original);
});

it("keeps unverified Minecraft versions read-only at both field rules and write admission", async () => {
  const f = await fixture(); f.adapter.plan.serverInfo.minecraftVersion = "unknown";
  expect(Object.values(f.service.fieldRules(f.id)).every((rule) => !rule.editable)).toBe(true);
  await expect(f.service.save(f.id, f.request, randomUUID())).rejects.toMatchObject({ code: "VERSION_RULE_UNAVAILABLE" });
  expect((await f.journal.scan()).records).toHaveLength(0);
});
