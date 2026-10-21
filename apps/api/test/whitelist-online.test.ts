import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm, rename, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { WhitelistService } from "../src/services/whitelist-service.js";
import { WhitelistOnlineService, parseWhitelistList } from "../src/services/whitelist-online-service.js";
import { discoverWhitelistCandidates } from "../src/services/whitelist-candidates.js";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { SessionCore } from "../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";

const roots: string[] = [];
const first = { name: "Player_One", uuid: "123e4567-e89b-42d3-a456-426614174000" };
const second = { name: "Player_Two", uuid: "123e4567-e89b-42d3-a456-426614174001" };
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(id = "test") {
  const parent = await mkdtemp(path.join(tmpdir(), "lt-whitelist-online-")); roots.push(parent);
  const root = path.join(parent, "server"); await mkdir(root);
  await mkdir(path.join(root, "logs")); const logFile = path.join(root, "logs", "latest.log"); await writeFile(logFile, "[10:00:00] [Server thread/INFO]: Done\n");
  await writeFile(path.join(root, "server.properties"), "white-list=true\nenforce-whitelist=false\n");
  const file = path.join(root, "whitelist.json");
  // Minecraft may serialize uuid before name; comparison must not depend on object-key order.
  await writeFile(file, JSON.stringify([{ uuid: first.uuid, name: first.name }]));
  const identity = await backupDirectoryIdentity(root), runtimeId = randomUUID();
  let runtimeNames = [first.name], state = "running", logs: string[] = [];
  const list = vi.fn(async () => runtimeNames.length ? `There are ${runtimeNames.length} whitelisted player(s): ${runtimeNames.join(", ")}` : "There are no whitelisted players");
  const change = vi.fn(async (action: "add" | "remove", name: string, authorize: () => undefined) => {
    authorize();
    const rows = JSON.parse(await readFile(file, "utf8")) as typeof first[];
    const next = action === "add" ? [...rows, { ...second, name }] : rows.filter(row => row.name !== name);
    await writeFile(file, JSON.stringify(next)); runtimeNames = next.map(row => row.name);
    for (const line of logs) await appendFile(logFile, line + "\n");
    return `${action === "add" ? "Added" : "Removed"} ${name} ${action === "add" ? "to" : "from"} the whitelist`;
  });
  const session = { runtimeId, list, add: (name: string, authorize: () => undefined) => change("add", name, authorize),
    remove: (name: string, authorize: () => undefined) => change("remove", name, authorize), close: vi.fn() };
  const openWhitelistSession = vi.fn(async () => session);
  const adapter = { serverId: id, mode: "local", plan: { rootPath: root, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getRegisteredExecutionIdentity: () => ({ rootIdentity: identity }), getRuntime: () => ({ openWhitelistSession }),
    getStatus: async () => ({ state, ownership: "managed", recoveryRequired: false, activeOperationId: null }),
    streamSnapshot: async () => ({ streamId: "test-stream", latestSequence: 2, logs: [] }),
    replayStream: async () => ({ streamId: "test-stream", gap: false, events: logs.map((text, index) => ({ sequence: index + 3,
      event: { type: "log", entry: { level: "error", source: "latest.log", text } } })) }),
    subscribe: () => () => {}, closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), clock = { now: () => new Date() }, operations = new OperationService(new MemoryOperationStore(), clock);
  await operations.initialize();
  const saved = new WhitelistService(registry, operations, clock), online = new WhitelistOnlineService(registry, operations, saved, clock);
  const request = async (action: "add" | "remove" = "add", name = second.name) => {
    const current = await online.read(id); if (!current.membershipWritable) throw new Error("fixture expected writable");
    return { action, name, revision: current.revision, confirm: true as const };
  };
  return { root, parent, file, logFile, identity, id, registry, clock, operations, online, adapter, session, change, request, openWhitelistSession,
    setState: (value: string) => { state = value; }, setLogs: (value: string[]) => { logs = value; },
    setRuntime: (value: string[]) => { runtimeNames = value; } };
}
it.each(["add", "remove"] as const)("confirms %s from exact response, live runtime and saved file; retains no native dependency", async action => {
  const f = await fixture(); const name = action === "add" ? second.name : first.name;
  const result = await f.online.mutate(f.id, await f.request(action, name), randomUUID(), () => undefined);
  expect(result).toMatchObject({ outcome: "succeeded", relatedErrorObserved: false, action, name });
  expect(f.change).toHaveBeenCalledOnce();
  const after = await f.online.read(f.id); expect(after.runtime?.consistent).toBe(true);
  expect(after.items.some(row => row.name === name)).toBe(action === "add");
  expect((await f.operations.storedOutcomes())).toEqual([]);
});
it.each(["add", "remove"] as const)("rejects already satisfied %s without sending a command", async action => {
  const f = await fixture();
  expect(await f.online.mutate(f.id, await f.request(action, action === "add" ? first.name : second.name), randomUUID(), () => undefined))
    .toMatchObject({ outcome: "failed", code: action === "add" ? "ALREADY_WHITELISTED" : "NOT_WHITELISTED" });
  expect(f.change).not.toHaveBeenCalled();
});
it("returns a known Minecraft account-resolution failure only when no file change occurred", async () => {
  const f = await fixture(); f.change.mockImplementation(async () => "That player does not exist");
  expect(await f.online.mutate(f.id, await f.request(), randomUUID(), () => undefined)).toMatchObject({ outcome: "failed", code: "PLAYER_NOT_FOUND" });
});
it("retains UNKNOWN after response loss and deduplicates concurrent and repeated request keys without resend", async () => {
  const f = await fixture(), request = await f.request(), key = randomUUID();
  const original = f.change.getMockImplementation()!;
  f.change.mockImplementation(async (...args) => { await original(...args); throw new Error("lost-rcon-response"); });
  const results = await Promise.all([f.online.mutate(f.id, request, key, () => undefined), f.online.mutate(f.id, request, key, () => undefined)]);
  expect(results.every(row => row.outcome === "unknown")).toBe(true);
  expect(await f.online.mutate(f.id, request, key, () => undefined)).toEqual(results[0]);
  expect(f.change).toHaveBeenCalledOnce();
  await expect(f.online.mutate(f.id, { ...request, name: "Other_Name" }, key, () => undefined)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
});
it.each(["save-error", "save-warn", "crash", "file-read-failure", "unrelated-member", "response-mismatch", "log-gap"])("refuses success after %s", async kind => {
  const f = await fixture(), request = await f.request(), original = f.change.getMockImplementation()!;
  f.change.mockImplementation(async (...args) => {
    if (kind === "save-error") f.setLogs(["[12:00:00] [Server thread/ERROR]: Could not save the list after adding a user."]);
    if (kind === "save-warn") f.setLogs(["[12:00:00] [Server thread/WARN]: Could not save the list after adding a user."]);
    const output = await original(...args);
    if (kind === "crash") f.setState("crashed");
    if (kind === "file-read-failure") await writeFile(f.file, "{");
    if (kind === "unrelated-member") await writeFile(f.file, JSON.stringify([second]));
    if (kind === "log-gap") { await rename(f.logFile, f.logFile + ".old"); await writeFile(f.logFile, ""); }
    return kind === "response-mismatch" ? "Added Wrong_Name to the whitelist" : output;
  });
  expect(await f.online.mutate(f.id, request, randomUUID(), () => undefined)).toMatchObject({ outcome: "unknown" });
  expect(f.change).toHaveBeenCalledOnce();
});
it("does not attribute unrelated errors or ordinary warnings to the whitelist command", async () => {
  const f = await fixture(); f.setLogs(["[12:00:00] [Server thread/ERROR]: Unrelated unrelated-component failure", "[12:00:00] [Server thread/WARN]: A warning"]);
  expect(await f.online.mutate(f.id, await f.request(), randomUUID(), () => undefined)).toMatchObject({ outcome: "succeeded", relatedErrorObserved: false });
});
it("checks the log window after the final runtime health read, and fails closed when that window disappears", async () => {
  const f = await fixture(), request = await f.request(); let postChecks = 0;
  const original = f.adapter.getStatus.bind(f.adapter);
  vi.spyOn(f.adapter, "getStatus").mockImplementation(async () => {
    if (f.change.mock.calls.length && ++postChecks === 2)
      await appendFile(f.logFile, "[12:00:00] [Server thread/ERROR]: Could not save the list after adding a user.\n");
    return original();
  });
  expect(await f.online.mutate(f.id, request, randomUUID(), () => undefined)).toMatchObject({ outcome: "unknown", relatedErrorObserved: true });
  expect(f.change).toHaveBeenCalledOnce();
});
it("does not send a mutation without an observable initial log window", async () => {
  const f = await fixture(), request = await f.request(); await rm(f.logFile);
  expect(await f.online.mutate(f.id, request, randomUUID(), () => undefined)).toMatchObject({ outcome: "failed" });
  expect(f.change).not.toHaveBeenCalled();
});
it("keeps wrong instances, replaced roots, stopped servers and unavailable RCON closed", async () => {
  const f = await fixture(), request = await f.request();
  await expect(f.online.mutate("other", request, randomUUID(), () => undefined)).rejects.toMatchObject({ code: "SERVER_NOT_FOUND" });
  f.setState("stopped"); expect((await f.online.read(f.id)).membershipWritable).toBe(false); f.setState("running");
  f.openWhitelistSession.mockRejectedValueOnce(new Error("no-rcon")); expect((await f.online.read(f.id)).membershipWritable).toBe(false);
  await rename(f.root, path.join(f.parent, "retained")); await mkdir(f.root);
  await writeFile(path.join(f.root, "server.properties"), "white-list=true\n"); await writeFile(f.file, "[]");
  expect((await f.online.read(f.id)).membershipWritable).toBe(false); expect(f.change).not.toHaveBeenCalled();
});
it("shares lifecycle exclusion and rejects changed revisions with zero sends", async () => {
  const f = await fixture(), request = await f.request();
  expect(await f.online.mutate(f.id, { ...request, revision: "a".repeat(64) }, randomUUID(), () => undefined)).toMatchObject({ outcome: "failed", code: "WHITELIST_REVISION_CONFLICT" });
  await f.operations.runExclusive(f.id, async () => {
    await expect(f.online.mutate(f.id, request, randomUUID(), () => undefined)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  });
  expect(f.change).not.toHaveBeenCalled();
});
it("binds candidates to the selected root, deduplicates names and excludes saved members", async () => {
  const f = await fixture(); await writeFile(path.join(f.root, "usercache.json"), JSON.stringify([first, second, { ...second, name: "player_two" }]));
  const candidates = await f.online.candidates(f.id);
  expect(candidates).toMatchObject({ availability: "available", items: [{ name: "player_two", uuid: second.uuid, source: "usercache", identityVerified: false }] });
  const other = await fixture("other"); await writeFile(path.join(other.root, "usercache.json"), "[]");
  expect((await other.online.candidates(other.id)).items).toEqual([]);
  expect(JSON.stringify(candidates)).not.toContain(f.root);
});
it("reports absent, conflicting and linked cache files as unavailable rather than an empty candidate list", async () => {
  const f = await fixture(); expect((await f.online.candidates(f.id)).reason).toBe("usercache-missing");
  const cache = path.join(f.root, "usercache.json"); await writeFile(cache, JSON.stringify([second, { ...second, uuid: first.uuid }]));
  expect((await f.online.candidates(f.id)).reason).toBe("usercache-identity-conflict");
  await link(cache, path.join(f.parent, "cache-link")); expect((await f.online.candidates(f.id)).reason).toBe("usercache-unsafe");
  expect((await discoverWhitelistCandidates(f.root, "a".repeat(64), new Date().toISOString())).reason).toBe("registration-changed");
});
it.each(["whitelist failure Player_One", "There are 2 whitelisted player(s): Player_One", "There are 1 whitelisted player(s): bad;stop"])("rejects unsupported live-list grammar: %s", output => {
  expect(() => parseWhitelistList(output)).toThrow();
});
it("recognizes the exact empty-list response from the local Vanilla 26.3 artifact", () => {
  expect(parseWhitelistList("There are no whitelisted players")).toEqual([]);
});
it("uses the production HTTP route and local request guards, and sends only to the selected instance", async () => {
  const f = await fixture(), app = buildApp({ mode: "local", adapters: [f.adapter] });
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui", "idempotency-key": randomUUID() };
  try {
    const url = `/api/v1/servers/${f.id}/whitelist`, read = await app.inject({ method: "GET", url, headers });
    expect(read.statusCode).toBe(200); expect(read.json().data.membershipWritable).toBe(true);
    await writeFile(path.join(f.root, "usercache.json"), JSON.stringify([first, second]));
    const candidates = await app.inject({ method: "GET", url: `${url}/candidates`, headers });
    expect(candidates.statusCode).toBe(200); expect(candidates.json().data.items).toEqual([{ ...second, source: "usercache", identityVerified: false }]);
    expect(candidates.body).not.toContain(f.root);
    const payload = { action: "add", name: second.name, revision: read.json().data.revision, confirm: true };
    expect((await app.inject({ method: "POST", url: `${url}/members`, headers: { ...headers, origin: "http://evil.invalid" }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${url}/members`, headers, payload: { ...payload, name: "bad;stop" } })).statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url: `${url}/members`, headers, payload });
    expect(response.statusCode).toBe(200); expect(response.json().data).toMatchObject({ serverId: f.id, outcome: "succeeded" });
    expect(f.change).toHaveBeenCalledOnce(); expect(response.body).not.toContain(f.root);
  } finally { await app.close(); }
});
it("preserves configured Session/CSRF/re-auth gates instead of bypassing them through the new local route", async () => {
  const f = await fixture(), sessions = new SessionCore();
  const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "fixture", revision: randomUUID(),
    salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
  { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
  const app = buildApp({ mode: "local", adapters: [f.adapter], authentication });
  const token = sessions.create("local-http"), headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000",
    "x-manager-intent": "local-ui", "idempotency-key": randomUUID() };
  const payload = { action: "add", name: second.name, revision: "a".repeat(64), confirm: true };
  try {
    const url = "/api/v1/servers/test/whitelist/members";
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { ...headers, cookie: `mcsm_local_session=${token.sessionToken}` }, payload })).statusCode).toBe(403);
    expect(f.change).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
