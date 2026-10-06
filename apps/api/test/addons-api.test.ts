import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createMockAdapters } from "../src/fixtures/servers.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { addonZip } from "./helpers/addon-zip.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const clock = { now: () => new Date() };
const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000" };
it.each(["fabric", "paper"] as const)("serializes actual %s ZIP metadata through the inventory API", async (type) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-addons-positive-")); roots.push(root);
  const folder = type === "fabric" ? "mods" : "plugins";
  await mkdir(path.join(root, folder)); await mkdir(path.join(root, `disabled-${folder}`));
  const bytes = type === "fabric"
    ? addonZip("fabric.mod.json", JSON.stringify({ schemaVersion: 1, id: "sample_mod", name: "Sample", version: "1.2", depends: { minecraft: "26.2" } }))
    : addonZip("plugin.yml", "name: Sample\nversion: '1.2'\nmain: example.Sample\napi-version: '26.2'\n");
  await writeFile(path.join(root, folder, "sample.jar"), bytes);
  await writeFile(path.join(root, `disabled-${folder}`, "disabled.jar"), bytes);
  const base = createMockAdapters(clock)[0]!;
  const adapter = Object.assign(Object.create(base), { mode: "local", serverId: "addon-test",
    plan: { rootPath: root, serverInfo: { type, minecraftVersion: "26.2" } },
    subscribe: () => () => {}, closeObserver: async () => {} }) as LocalMinecraftServerAdapter;
  const app = buildApp({ mode: "local", clock, adapters: [adapter] });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/servers/addon-test/addons", headers });
    expect(response.statusCode).toBe(200);
    const result = response.json().data;
    expect(result.writeSupported).toBe(false); expect(result.items).toHaveLength(2);
    expect(result.items.map((item: { state: string }) => item.state).sort()).toEqual(["disabled", "enabled"]);
    for (const item of result.items) expect(item).toMatchObject({ name: "Sample", version: "1.2", loader: type,
      metadataStatus: "parsed", compatibility: "unknown", minecraftConstraint: type === "fabric" ? ["26.2"] : null });
    expect(response.body).not.toContain(root); expect(response.body).not.toContain("example.Sample");
  } finally { await app.close(); }
});
it("exposes only bounded read-only inventory and no private paths or bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-addons-api-")); roots.push(root);
  await mkdir(path.join(root, "mods")); await writeFile(path.join(root, "mods", "test.jar"), "private unparsed bytes");
  const base = createMockAdapters(clock)[0]!;
  const adapter = Object.assign(Object.create(base), { mode: "local", serverId: "addon-test",
    plan: { rootPath: root, serverInfo: { type: "fabric", minecraftVersion: "26.2" } },
    subscribe: () => () => {}, closeObserver: async () => {} }) as LocalMinecraftServerAdapter;
  const app = buildApp({ mode: "local", clock, adapters: [adapter] });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/servers/addon-test/addons", headers });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}"$/u);
    expect(response.json().data).toMatchObject({ writeSupported: false, items: [{ filename: "test.jar", metadataStatus: "invalid", compatibility: "unknown" }] });
    expect(response.body).not.toContain(root); expect(response.body).not.toContain("private unparsed bytes");
    expect((await app.inject({ method: "GET", url: "/api/v1/servers/missing/addons", headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/servers/addon-test/addons", headers: { host: "evil.example" } })).statusCode).toBe(403);
  } finally { await app.close(); }
});
it("does not advertise mock extensions as a filesystem inventory", async () => {
  const app = buildApp({ mode: "mock", clock });
  try {
    const servers = (await app.inject({ method: "GET", url: "/api/v1/servers", headers })).json().data.items;
    expect((await app.inject({ method: "GET", url: `/api/v1/servers/${servers[0].server.id}/addons`, headers })).statusCode).toBe(501);
  } finally { await app.close(); }
});
