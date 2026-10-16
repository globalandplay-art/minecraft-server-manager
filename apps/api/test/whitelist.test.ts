import { mkdtemp, mkdir, writeFile, readFile, rm, link, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { WhitelistService } from "../src/services/whitelist-service.js";
import { readStoredWhitelist, WHITELIST_BYTES } from "../src/services/whitelist-reader.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { SessionCore } from "../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
const rows = [{ name: "Player_One", uuid: "123e4567-e89b-42d3-a456-426614174000" }];
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(members: string | undefined = JSON.stringify(rows)) {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-whitelist-")); roots.push(parent);
  const root = path.join(parent, "server"); await mkdir(root);
  await writeFile(path.join(root, "server.properties"), "white-list=true\nenforce-whitelist=false\nrcon.password=PRIVATE_SENTINEL\n");
  if (members !== undefined) await writeFile(path.join(root, "whitelist.json"), members);
  const rootIdentity = await backupDirectoryIdentity(root), command = vi.fn(), start = vi.fn(), stop = vi.fn();
  const clock = { now: () => new Date("2026-10-14T00:00:00Z") };
  const adapter = { serverId: "test", mode: "local", plan: { rootPath: root, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getRegisteredExecutionIdentity: () => ({ rootIdentity }),
    getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false, activeOperationId: null }),
    subscribe: () => () => {}, closeObserver: async () => {}, command, start, stop
  } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), store = new MemoryOperationStore(), operations = new OperationService(store, clock);
  await operations.initialize();
  return { parent, root, adapter, store, operations, command, start, stop, clock,
    service: new WhitelistService(registry, operations, clock) };
}
it("reads saved members and configuration without claiming effective state or issuing commands", async () => {
  const f = await fixture(); const before = await readFile(path.join(f.root, "whitelist.json"));
  const value = await f.service.read("test");
  expect(value).toMatchObject({ availability: "available", items: rows, configuredEnabled: true, configuredEnforced: false,
    effectiveEnabled: null, membershipWritable: false });
  expect(JSON.stringify(value)).not.toContain(f.root); expect(JSON.stringify(value)).not.toContain("PRIVATE_SENTINEL");
  expect(await readFile(path.join(f.root, "whitelist.json"))).toEqual(before);
  expect(f.command).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  expect(await f.store.list()).toEqual([]);
});
it("distinguishes a valid empty list from a missing file, and never creates the latter", async () => {
  const f = await fixture("[]"); expect((await f.service.read("test")).availability).toBe("available");
  await rm(path.join(f.root, "whitelist.json"));
  expect(await f.service.read("test")).toMatchObject({ availability: "unavailable", reason: "whitelist-file-missing", configuredEnabled: true });
  await expect(readFile(path.join(f.root, "whitelist.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(['{}', '[null]', '[{"name":"bad;stop","uuid":"123e4567-e89b-42d3-a456-426614174000"}]',
  JSON.stringify([...rows, { ...rows[0], uuid: randomUUID(), name: "player_one" }]), JSON.stringify([...rows, { ...rows[0], name: "OtherName" }]),
  JSON.stringify([{ ...rows[0], secret: "PRIVATE_SENTINEL" }]), JSON.stringify([{ name: "ValidName", uuid: "fabricated" }])])(
  "rejects the entire malformed snapshot without partial membership: %s", async text => {
    const f = await fixture(text); expect(await f.service.read("test")).toMatchObject({ availability: "unavailable", reason: "whitelist-read-unsafe", items: [] });
    expect(await readFile(path.join(f.root, "whitelist.json"), "utf8")).toBe(text);
  });
it("rejects a hardlink and oversized bytes", async () => {
  const f = await fixture(); await link(path.join(f.root, "whitelist.json"), path.join(f.parent, "alias.json"));
  await expect(readStoredWhitelist(f.root)).rejects.toThrow("WHITELIST_READ_UNSAFE");
  await rm(path.join(f.parent, "alias.json")); await writeFile(path.join(f.root, "whitelist.json"), Buffer.alloc(WHITELIST_BYTES + 1));
  await expect(readStoredWhitelist(f.root)).rejects.toThrow("WHITELIST_READ_UNSAFE");
});
it("does not rebaseline an entirely replaced registered root", async () => {
  const f = await fixture(); await rename(f.root, path.join(f.parent, "old-server")); await mkdir(f.root);
  await writeFile(path.join(f.root, "server.properties"), "white-list=false\n"); await writeFile(path.join(f.root, "whitelist.json"), "[]");
  expect((await f.service.read("test")).availability).toBe("unavailable"); expect(f.command).not.toHaveBeenCalled();
});
it("fails closed on unsupported versions, missing registration and external ownership", async () => {
  const f = await fixture();
  vi.spyOn(f.adapter, "getRegisteredExecutionIdentity").mockReturnValue(undefined!);
  expect((await f.service.read("test")).reason).toBe("registration-unavailable"); vi.restoreAllMocks();
  vi.spyOn(f.adapter, "getRegisteredExecutionIdentity").mockImplementation(() => { throw new Error("PRIVATE_REGISTRATION_PATH"); });
  const missing = await f.service.read("test"); expect(missing.reason).toBe("registration-unavailable");
  expect(JSON.stringify(missing)).not.toContain("PRIVATE_REGISTRATION_PATH"); vi.restoreAllMocks();
  vi.spyOn(f.adapter, "getStatus").mockResolvedValue({ state: "running", ownership: "external", recoveryRequired: false, activeOperationId: null } as Awaited<ReturnType<typeof f.adapter.getStatus>>);
  expect((await f.service.read("test")).reason).toBe("server-state-unavailable"); vi.restoreAllMocks();
  Object.assign(f.adapter.plan.serverInfo, { type: "paper" }); expect((await f.service.read("test")).reason).toBe("version-unsupported");
});
it("reads stored members with unavailable RCON without interpreting them as effective runtime state", async () => {
  const f = await fixture();
  vi.spyOn(f.adapter, 'getStatus').mockResolvedValue({ state: 'running', ownership: 'managed', recoveryRequired: false, activeOperationId: null } as Awaited<ReturnType<typeof f.adapter.getStatus>>);
  expect(await f.service.read('test')).toMatchObject({ availability: 'available', effectiveEnabled: null, membershipWritable: false });
  expect(f.command).not.toHaveBeenCalled(); vi.restoreAllMocks();
});
it("rejects invalid encoding and oversized member count without truncation", async () => {
  const f = await fixture();
  for (const bytes of [Buffer.from([0xff]), Buffer.from('\ufeff[]'), Buffer.from(JSON.stringify(Array.from({ length: 1001 }, () => rows[0])))]) {
    await writeFile(path.join(f.root, 'whitelist.json'), bytes);
    expect(await f.service.read('test')).toMatchObject({ availability: 'unavailable', items: [] });
  }
});
it("requires the configured session for HTTP reads and never trusts a claimed Tailnet identity", async () => {
  const f = await fixture(), sessions = new SessionCore();
  const auth = new HttpAuthentication(new PasswordVerifier({ version: 1, username: 'fixture', revision: randomUUID(),
    salt: 'ab'.repeat(16), hash: 'cd'.repeat(64), parameters: SCRYPT_PROFILE }),
    { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
  const app = buildApp({ mode: 'local', adapters: [f.adapter], operationStore: f.store, authentication: auth });
  try {
    const url = '/api/v1/servers/test/whitelist', headers = { host: '127.0.0.1:8080' };
    expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url, headers: { ...headers, 'Tailscale-User-Login': 'admin' } })).statusCode).toBe(401);
    const token = sessions.create('local-http');
    expect((await app.inject({ method: 'GET', url, headers: { ...headers, cookie: `mcsm_local_session=${token.sessionToken}` } })).statusCode).toBe(200);
    expect(f.command).not.toHaveBeenCalled(); expect(await f.store.list()).toEqual([]);
  } finally { await app.close(); }
});
it("shares operation admission and exposes only a readonly HTTP route", async () => {
  const f = await fixture(); const app = buildApp({ mode: "local", adapters: [f.adapter], operationStore: f.store });
  try {
    const url = "/api/v1/servers/test/whitelist", headers = { host: "127.0.0.1:8080" };
    const response = await app.inject({ method: "GET", url, headers }); expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store"); expect(response.json().data.items).toEqual(rows);
    expect((await app.inject({ method: "POST", url, headers, payload: {} })).statusCode).not.toBe(202);
    expect(response.body).not.toContain(f.root); expect(f.command).not.toHaveBeenCalled();
  } finally { await app.close(); }
  f.operations.requireRecovery(["test"]); expect((await f.service.read("test")).reason).toBe("recovery-required");
});
