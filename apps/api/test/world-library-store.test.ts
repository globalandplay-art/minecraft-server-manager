import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import fastify from "fastify";
import { Value } from "@sinclair/typebox/value";
import { worldLibraryResponseSchema } from "@mcsm/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { allocateWorldIdentity, WorldLibraryStore } from "../src/services/world-library-store.js";
import { ActiveWorldStateStore, worldIdentity, type ActiveWorldState } from "../src/services/active-world-state-store.js";
import { buildApp } from "../src/app.js";
import { HttpAuthentication } from "../src/auth/http-auth.js";
import { SessionCore } from "../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../src/auth/password.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { registerWorldLibraryRoutes } from "../src/routes/world-library.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-10-25T08:00:00.000Z") };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(serverId = "test-a") {
  const manager = await mkdtemp(path.join(tmpdir(), "lt-world-library-")); roots.push(manager);
  const binding = { serverId, rootPath: path.join(manager, "server") };
  await mkdir(binding.rootPath); await mkdir(path.join(binding.rootPath, "world"));
  await writeFile(path.join(binding.rootPath, "world", "level.dat"), "isolated fixture");
  const state: ActiveWorldState = { schemaVersion: 1, serverId, state: "active", levelName: "world", worldId: worldIdentity(serverId, "world") };
  const file = path.join(manager, "world-library", serverId, "state.json");
  const store = new WorldLibraryStore(manager, clock);
  return { manager, binding, state, file, store };
}
describe("V2 world lineage sidecar", () => {
  it("persists a random identity across store reconstruction without associating old backups", async () => {
    const f = await fixture();
    const oldBackup = path.join(f.manager, "legacy-manifest.json");
    await writeFile(oldBackup, '{"schemaVersion":1,"historical":"untouched"}');
    await f.store.migrateLegacy(f.binding, f.state);
    const first = await f.store.list(f.binding, f.state);
    expect(first.state).toBe("ready"); expect(first.activeWorldId).toMatch(/^worldv2-/u);
    expect(first.items[0]).toMatchObject({ legacySlotId: f.state.worldId, legacyBackupAssociation: "unverified" });
    const before = await readFile(f.file, "utf8");
    const restarted = new WorldLibraryStore(f.manager, clock);
    await restarted.migrateLegacy(f.binding, f.state);
    expect((await restarted.list(f.binding, f.state)).activeWorldId).toBe(first.activeWorldId);
    expect(await readFile(f.file, "utf8")).toBe(before);
    expect(await readFile(oldBackup, "utf8")).toBe('{"schemaVersion":1,"historical":"untouched"}');
  });
  it("rejects a same-name physical replacement instead of inheriting its identity", async () => {
    const f = await fixture(); await f.store.migrateLegacy(f.binding, f.state);
    const original = await readFile(f.file, "utf8");
    await rename(path.join(f.binding.rootPath, "world"), path.join(f.binding.rootPath, "preserved-world"));
    await mkdir(path.join(f.binding.rootPath, "world")); await writeFile(path.join(f.binding.rootPath, "world", "level.dat"), "replacement");
    const restarted = new WorldLibraryStore(f.manager, clock);
    await expect(restarted.migrateLegacy(f.binding, f.state)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect((await restarted.list(f.binding, f.state)).state).toBe("inspection-required");
    expect(await readFile(f.file, "utf8")).toBe(original);
  });
  it("assigns a new identity to explicitly committed replacement and preserves the old lineage", async () => {
    const f = await fixture(); await f.store.migrateLegacy(f.binding, f.state);
    const before = await f.store.list(f.binding, f.state);
    await rename(path.join(f.binding.rootPath, "world"), path.join(f.binding.rootPath, "protected-original"));
    await mkdir(path.join(f.binding.rootPath, "world")); await writeFile(path.join(f.binding.rootPath, "world", "level.dat"), "new");
    const operationId = randomUUID();
    const request = { worldId: allocateWorldIdentity(), levelName: "world", operationId, expectedRevision: before.revision!, replacesWorldId: before.activeWorldId! };
    const next = await f.store.recordInstalled(f.binding, request);
    expect(next).toBe(request.worldId);
    expect(next).not.toBe(before.activeWorldId);
    expect(await f.store.recordInstalled(f.binding, request)).toBe(next);
    await expect(f.store.recordInstalled(f.binding, { ...request, worldId: allocateWorldIdentity() })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(f.store.recordInstalled(f.binding, { ...request, operationId: randomUUID(),
      expectedRevision: (await f.store.list(f.binding, f.state)).revision! })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(f.store.recordInstalled(f.binding, { ...request, replacesWorldId: next })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(f.store.recordInstalled(f.binding, { ...request, expectedRevision: "f".repeat(64) })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    const after = await f.store.list(f.binding, f.state);
    expect(after.items).toHaveLength(2); expect(after.items[0]?.state).toBe("retired"); expect(after.activeWorldId).toBe(next);
    expect(await readFile(path.join(f.binding.rootPath, "protected-original", "level.dat"), "utf8")).toBe("isolated fixture");
  });
  it("does not guess ownership from a different root or server", async () => {
    const f = await fixture(); await f.store.migrateLegacy(f.binding, f.state);
    const other = await fixture("test-b");
    expect((await f.store.list({ ...f.binding, rootPath: other.binding.rootPath }, f.state)).state).toBe("inspection-required");
    expect((await f.store.list(f.binding, other.state)).state).toBe("inspection-required");
  });
  it.each(["corrupt", "stage", "missing"])("preserves %s evidence without remigration", async kind => {
    const f = await fixture(); await f.store.migrateLegacy(f.binding, f.state);
    if (kind === "corrupt") await writeFile(f.file, "{broken");
    if (kind === "stage") await writeFile(f.file + ".orphan.tmp", "evidence");
    if (kind === "missing") await rm(f.file);
    await expect(f.store.migrateLegacy(f.binding, f.state)).rejects.toBeDefined();
    expect((await f.store.list(f.binding, f.state)).state).toBe("inspection-required");
  });
  it("rejects stale revisions and repeated operations targeting another name", async () => {
    const f = await fixture(); await f.store.migrateLegacy(f.binding, f.state);
    await mkdir(path.join(f.binding.rootPath, "second")); await writeFile(path.join(f.binding.rootPath, "second", "level.dat"), "new");
    await expect(f.store.recordInstalled(f.binding, { worldId: allocateWorldIdentity(), levelName: "second", operationId: randomUUID(), expectedRevision: "0".repeat(64) })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    const list = await f.store.list(f.binding, f.state);
    const operationId = randomUUID();
    const worldId = allocateWorldIdentity();
    await f.store.recordInstalled(f.binding, { worldId, levelName: "second", operationId, expectedRevision: list.revision! });
    await expect(f.store.recordInstalled(f.binding, { worldId, levelName: "world", operationId, expectedRevision: list.revision! })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("rejects pending generation instead of fabricating a world identity", async () => {
    const f = await fixture();
    await expect(f.store.migrateLegacy(f.binding, { ...f.state, state: "pending-generation" })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("binds revision to immutable lineage and rejects retired or stale queue targets", async () => {
    const f = await fixture(); await f.store.migrateLegacy(f.binding, f.state);
    const before = await f.store.list(f.binding, f.state);
    const first = await f.store.resolve(f.binding, before.activeWorldId!, before.revision!);
    await expect(f.store.resolve(f.binding, before.activeWorldId!, "0".repeat(64))).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await rename(path.join(f.binding.rootPath, "world"), path.join(f.binding.rootPath, "protected-world"));
    await mkdir(path.join(f.binding.rootPath, "world"));
    await writeFile(path.join(f.binding.rootPath, "world", "level.dat"), "isolated fixture");
    const next = await f.store.recordInstalled(f.binding, { worldId: allocateWorldIdentity(), levelName: "world", operationId: randomUUID(),
      expectedRevision: before.revision!, replacesWorldId: before.activeWorldId! });
    const after = await f.store.list(f.binding, f.state);
    expect((await f.store.resolve(f.binding, next, after.revision!)).worldRevision).not.toBe(first.worldRevision);
    await expect(f.store.resolve(f.binding, first.worldId, after.revision!)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("does not regenerate missing catalogs in a reconstructed store with no memory cache", async () => {
    const f = await fixture(); await f.store.migrateLegacy(f.binding, f.state);
    await rm(f.file);
    await expect(new WorldLibraryStore(f.manager, clock).migrateLegacy(f.binding, f.state)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(await readFile(path.join(f.manager, "world-library", `${f.binding.serverId}.identity.json`), "utf8")).toContain("catalogId");
  });
  it("preserves interrupted first adoption with an empty existing catalog directory", async () => {
    const f = await fixture(); await mkdir(path.dirname(f.file), { recursive: true });
    await expect(f.store.migrateLegacy(f.binding, f.state)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("serves a strict redacted contract without exposing physical identity or enabling writes", async () => {
    const f = await fixture(); await f.store.migrateLegacy(f.binding, f.state);
    const adapter = { mode: "local", serverId: f.binding.serverId,
      plan: { rootPath: f.binding.rootPath, serverInfo: { type: "vanilla" } } } as unknown as LocalMinecraftServerAdapter;
    const app = fastify(); registerWorldLibraryRoutes(app, f.store, new AdapterRegistry([adapter]), () => f.state, clock, "local");
    try {
      const response = await app.inject({ method: "GET", url: `/api/v1/servers/${f.binding.serverId}/world-library` });
      expect(response.statusCode).toBe(200); expect(Value.Check(worldLibraryResponseSchema, response.json())).toBe(true);
      expect(response.body).not.toContain(f.binding.rootPath); expect(response.body).not.toContain("directoryIdentity");
      expect(response.json().data.mutationsAvailable).toBe(false);
    } finally { await app.close(); }
  });
  it("wires startup observation into the real app and retains session/origin protection", async () => {
    const f = await fixture(); await writeFile(path.join(f.binding.rootPath, "server.properties"), "level-name=world\n");
    const adapter = { mode: "local", serverId: f.binding.serverId,
      plan: { rootPath: f.binding.rootPath, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
      subscribe: () => () => {}, closeObserver: async () => {},
      getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false })
    } as unknown as LocalMinecraftServerAdapter;
    const sessions = new SessionCore(() => 0);
    const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(),
      salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
    { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
    const app = buildApp({ mode: "local", adapters: [adapter], clock, managerRoot: f.manager,
      activeWorldState: new ActiveWorldStateStore(f.manager, [adapter]), authentication, backupSchedulerTimers: false });
    const url = `/api/v1/servers/${f.binding.serverId}/world-library`;
    const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000" };
    try {
      expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(401);
      const token = sessions.create("local-http");
      const authorized = { ...headers, cookie: `mcsm_local_session=${token.sessionToken}` };
      const response = await app.inject({ method: "GET", url, headers: authorized });
      expect(response.statusCode).toBe(200); expect(response.json().data.state).toBe("ready");
      expect((await app.inject({ method: "GET", url, headers: { ...authorized, origin: "https://untrusted.invalid" } })).statusCode).toBe(403);
      expect(response.body).not.toContain(f.manager);
    } finally { await app.close(); }
  });
});
