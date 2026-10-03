import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { WorldCreatePlanService } from "../src/services/world-create-plan-service.js";
import { buildApp } from "../src/app.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-create-plan-")); roots.push(root);
  await mkdir(path.join(root, "world"));
  await writeFile(path.join(root, "world", "level.dat"), "unchanged-world");
  await writeFile(path.join(root, "server.properties"), "level-name=world\nrcon.password=never-public\n");
  const status = { state: "stopped", ownership: "none", recoveryRequired: false };
  const getServerInfo = vi.fn(async () => ({ minecraftVersion: "26.3" }));
  const adapter = { serverId: "test", mode: "local", plan: { rootPath: root, serverInfo: { type: "vanilla" } },
    getStatus: async () => status, getServerInfo, subscribe: () => () => {}, closeObserver: async () => {} } as unknown as LocalMinecraftServerAdapter;
  const operations = { getServerState: () => ({ activeOperationId: null, recoveryRequired: false }) };
  return { root, status, adapter, operations, getServerInfo, service: new WorldCreatePlanService(new AdapterRegistry([adapter]), operations) };
}
describe("P3.3a read-only new-world planning", () => {
  it("plans exact 64-bit seed without writes or public paths/secrets", async () => {
    const f = await fixture(); const before = await readdir(f.root);
    const result = await f.service.plan("test", { name: "新世界", seed: "9223372036854775807" });
    expect(result).toMatchObject({ name: "新世界", seed: "9223372036854775807", minecraftVersion: "26.3", requiresStop: false, executionAvailable: false });
    expect(result.worldRevision).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(f.root); expect(JSON.stringify(result)).not.toContain("never-public");
    expect(await readdir(f.root)).toEqual(before);
    expect(await readFile(path.join(f.root, "world", "level.dat"), "utf8")).toBe("unchanged-world");
    expect(await readFile(path.join(f.root, "server.properties"), "utf8")).toContain("rcon.password=never-public");
  });
  it("accepts random and minimum signed seed; reports explicit stop requirement", async () => {
    const f = await fixture(); f.status.state = "running"; f.status.ownership = "managed";
    expect(await f.service.plan("test", { name: "new-world", seed: "" })).toMatchObject({ seed: null, requiresStop: true });
    expect(await f.service.plan("test", { name: "new-world", seed: "-9223372036854775808" })).toMatchObject({ seed: "-9223372036854775808" });
  });
  it.each(["../escape", "C:\\world", "world/name", "world:name", ".manager", "MODS", "Plugins", "CON.txt", "nul", "x.", "x ", " x", "x?", "x|", "x*", "x<", "", "x".repeat(65)])("rejects unsafe/reserved name %s", async (name) => {
    const f = await fixture(); await expect(f.service.plan("test", { name, seed: "" })).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["9223372036854775808", "-9223372036854775809", "1e3", "1.5", " 2", "01", "+1", "1".repeat(21)])("rejects invalid/out-of-range seed %s", async (seed) => {
    const f = await fixture(); await expect(f.service.plan("test", { name: "new", seed })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("rejects existing file and directory names case-insensitively", async () => {
    const f = await fixture();
    for (const name of ["WORLD", "SERVER.PROPERTIES"]) await expect(f.service.plan("test", { name, seed: "" })).rejects.toMatchObject({ code: "WORLD_NAME_CONFLICT" });
  });
  it("rejects unknown, external and recovery states", async () => {
    const f = await fixture();
    f.status.state = "unknown"; await expect(f.service.plan("test", { name: "new", seed: "" })).rejects.toMatchObject({ code: "SERVER_STATE_CONFLICT" });
    f.status.state = "running"; f.status.ownership = "external"; await expect(f.service.plan("test", { name: "new", seed: "" })).rejects.toMatchObject({ code: "SERVER_STATE_CONFLICT" });
    f.status.recoveryRequired = true; await expect(f.service.plan("test", { name: "new", seed: "" })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("rejects operation recovery gate and unknown version", async () => {
    const f = await fixture(); f.operations.getServerState = () => ({ activeOperationId: null, recoveryRequired: true });
    await expect(f.service.plan("test", { name: "new", seed: "" })).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    f.operations.getServerState = () => ({ activeOperationId: null, recoveryRequired: false });
    f.getServerInfo.mockResolvedValue({ minecraftVersion: "" });
    await expect(f.service.plan("test", { name: "new", seed: "" })).rejects.toMatchObject({ code: "WORLD_VERSION_UNAVAILABLE" });
  });
  it.each([
    { name: "new", seed: 9007199254740993 }, { name: "new", seed: ["9223372036854775807"] },
    { name: "new", seed: true }, { name: ["new"], seed: "" }, { name: false, seed: "" }
  ])("rejects non-string HTTP inputs before coercion: %j", async (payload) => {
    const f = await fixture(); const app = buildApp({ adapters: [f.adapter], mode: "local" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/servers/test/worlds/create-plan",
        headers: { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" }, payload });
      expect(response.statusCode).toBe(400);
      expect(await readdir(f.root)).toEqual(["server.properties", "world"]);
    } finally { await app.close(); }
  });
  it("guards HTTP requests, rejects extra fields and serves no-store plan", async () => {
    const f = await fixture(); const app = buildApp({ adapters: [f.adapter], mode: "local" });
    try {
      const url = "/api/v1/servers/test/worlds/create-plan";
      const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" };
      expect((await app.inject({ method: "POST", url, headers: { host: headers.host }, payload: { name: "new", seed: "" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url, headers, payload: { name: "new", seed: "", path: "C:/escape" } })).statusCode).toBe(400);
      const reply = await app.inject({ method: "POST", url, headers, payload: { name: "new", seed: "" } });
      expect(reply.statusCode).toBe(200); expect(reply.headers["cache-control"]).toBe("no-store");
      expect(reply.json().data).toMatchObject({ name: "new", executionAvailable: false });
      expect((await app.inject({ method: "POST", url: url.replace("/test/", "/missing/"), headers, payload: { name: "new", seed: "" } })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
