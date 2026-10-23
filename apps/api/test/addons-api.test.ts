import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createMockAdapters } from "../src/fixtures/servers.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { addonZip } from "./helpers/addon-zip.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const clock = { now: () => new Date() };
const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000" };
it.each(["forge", "neoforge"] as const)("serializes %s multi-mod declarations without widening compatibility or writes", async type => {
  const root = await mkdtemp(path.join(tmpdir(), "lt-m3-metadata-")); roots.push(root); await mkdir(path.join(root, "mods"));
  const source = type === "forge" ? "META-INF/mods.toml" : "META-INF/neoforge.mods.toml";
  await writeFile(path.join(root, "mods", "multiple.jar"), addonZip(source, 'modLoader="javafml"\nloaderVersion="[1,)"\n[[mods]]\nmodId="first_mod"\nversion="${file.jarVersion}"\n[[mods]]\nmodId="second_mod"\ndisplayName="第二个模组"\nversion="2.0"\n[[dependencies.second_mod]]\nmodId="minecraft"\nversionRange="[26.3,27)"\n'));
  const base = createMockAdapters(clock)[0]!;
  const adapter = Object.assign(Object.create(base), { mode: "local", serverId: "metadata-mods", plan: { rootPath: root, serverInfo: { type, minecraftVersion: "26.3" } }, subscribe: () => () => {}, closeObserver: async () => {} }) as LocalMinecraftServerAdapter;
  const app = buildApp({ mode: "local", clock, adapters: [adapter] });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/servers/metadata-mods/addons", headers }); expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ writeSupported: false, items: [{ name: null, version: null, loader: null, compatibility: "unknown", metadataStatus: "parsed",
      declaredMetadata: { loader: type, source, mods: [{ id: "first_mod", versionStatus: "unresolved" }, { id: "second_mod", name: "第二个模组", dependencies: [{ id: "minecraft", versionRange: "[26.3,27)", requirement: "unknown" }] }] } }] });
    expect(response.body).not.toContain(root);
  } finally { await app.close(); }
});
it.each(["forge", "neoforge"] as const)("serves registered %s inventory read-only without treating Fabric metadata as compatible", async type => {
  const root = await mkdtemp(path.join(tmpdir(), "lt-m3-read-")); roots.push(root); await mkdir(path.join(root, "mods"));
  await writeFile(path.join(root, "mods", "sample.jar"), addonZip("fabric.mod.json", JSON.stringify({ schemaVersion: 1, id: "sample", name: "Not a Forge claim", version: "1" })));
  const base = createMockAdapters(clock)[0]!;
  const adapter = Object.assign(Object.create(base), { mode: "local", serverId: "readonly-mods",
    plan: { rootPath: root, serverInfo: { type, minecraftVersion: "26.3" } },
    getStatus: async () => ({ ...await base.getStatus(), state: 'stopped', ownership: 'none', recoveryRequired: false, activeOperationId: null }),
    subscribe: () => () => {}, closeObserver: async () => {} }) as LocalMinecraftServerAdapter;
  const manager = await mkdtemp(path.join(tmpdir(), "lt-m3-read-manager-")); roots.push(manager);
  const app = buildApp({ mode: "local", clock, adapters: [adapter], managerRoot: manager, transactionJournal: new TransactionJournalStore(manager) });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/servers/readonly-mods/addons", headers });
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toMatchObject({ writeSupported: false, items: [{ filename: "sample.jar", kind: "mod", loader: null, name: null, compatibility: "unknown", metadataStatus: "missing" }] });
    expect(response.body).not.toContain(root); expect(response.body).not.toContain("Not a Forge claim");
    const managerBefore = (await readdir(manager)).sort();
    const mutationHeaders = { ...headers, "x-manager-intent": "local-ui", "idempotency-key": "7fa79ace-90d9-403e-b651-2a4b6aa71fe3" };
    const hash = "a".repeat(64);
    const mutations = [
      await app.inject({ method: "POST", url: "/api/v1/servers/readonly-mods/addons/uploads", headers: { ...mutationHeaders, "content-type": "application/java-archive", "x-upload-filename": "new.jar" }, payload: addonZip("fabric.mod.json", "{}") }),
      await app.inject({ method: "POST", url: "/api/v1/servers/readonly-mods/addons/install", headers: mutationHeaders, payload: { uploadId: "d7dd6b27-29ca-4886-a9b8-1a4bb9900081", uploadRevision: hash, inventoryRevision: hash } }),
      await app.inject({ method: "POST", url: `/api/v1/servers/readonly-mods/addons/${hash}/trash`, headers: mutationHeaders, payload: { revision: hash } })
    ];
    // Inert upload is now available only after registered execution identity verification.
    expect(mutations[0]!.statusCode).toBe(409); expect(mutations[0]!.json().error.code).toBe('ADDON_ADAPTER_UNTRUSTED');
    expect(mutations[1]!.statusCode).toBe(409); expect(mutations[1]!.json().error.code).toBe('ADDON_ADAPTER_UNTRUSTED');
    expect(mutations[2]!.statusCode).toBe(501);
    expect(await readFile(path.join(root, "mods", "sample.jar"))).toEqual(addonZip("fabric.mod.json", JSON.stringify({ schemaVersion: 1, id: "sample", name: "Not a Forge claim", version: "1" })));
    expect((await readdir(root)).sort()).toEqual(["mods"]); expect(await readdir(path.join(root, "mods"))).toEqual(["sample.jar"]);
    expect((await readdir(manager)).sort()).toEqual(managerBefore);
    expect((await app.inject({ method: "GET", url: "/api/v1/servers/other/addons", headers })).statusCode).toBe(404);
  } finally { await app.close(); }
});
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
