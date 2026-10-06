import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { OperationService } from "../src/services/operation-service.js";
import { AddonUploadService } from "../src/services/addon-upload-service.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { addonZip } from "./helpers/addon-zip.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-10-05T00:00:00.000Z") };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-addon-upload-")); roots.push(parent);
  const serverRoot = path.join(parent, "server"), managerRoot = path.join(parent, "manager");
  await mkdir(serverRoot); await mkdir(managerRoot);
  const identity = { schemaVersion: 1 as const, serverId: "p52-test", serverType: "fabric" as const, minecraftVersion: "26.2",
    javaMajor: 25, requiredJavaMajor: 25, rootIdentity: await backupDirectoryIdentity(serverRoot), addonRootIdentity: null,
    launchJarIdentity: "b".repeat(64), launchJarSha256: "c".repeat(64), identitySha256: "d".repeat(64) };
  const adapter = { mode: "local", serverId: "p52-test", plan: { rootPath: serverRoot, serverInfo: { type: "fabric", minecraftVersion: "26.2" } },
    getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false, activeOperationId: null }) } as unknown as LocalMinecraftServerAdapter;
  const operations = new OperationService(new MemoryOperationStore(), clock);
  await operations.initialize();
  const capture = vi.fn(async () => identity);
  const service = new AddonUploadService(new AdapterRegistry([adapter]), operations, managerRoot, clock, capture);
  return { serverRoot, managerRoot, service, capture };
}

it("stages and revalidates one bounded Fabric JAR without exposing private paths or bytes", async () => {
  const f = await fixture();
  const bytes = addonZip("fabric.mod.json", JSON.stringify({ schemaVersion: 1, id: "sample_mod", name: "Sample", version: "1.0" }));
  const result = await f.service.upload("p52-test", "sample.jar", Readable.from([bytes]));
  expect(result).toMatchObject({ kind: "mod", filename: "sample.jar", name: "Sample", loader: "fabric", state: "validated", executionAvailable: false });
  const record = JSON.parse(await readFile(path.join(f.managerRoot, "addon-uploads", result.id, "validated.json"), "utf8"));
  expect(record).toMatchObject({ metadata: { loader: "fabric" }, schemaVersion: 1, kind: "mod" });
  const { revision, ...body } = record;
  expect(revision).toBe(result.revision);
  expect(createHash("sha256").update(JSON.stringify(body)).digest("hex")).toBe(revision);
  expect(Object.keys(record)).toHaveLength(10);
  expect(JSON.stringify(result)).not.toContain(f.serverRoot); expect(JSON.stringify(result)).not.toContain(f.managerRoot);
  const staged = await f.service.validatedSource("p52-test", result.id, result.revision, "mod");
  expect(staged.validated.checksumSha256).toBe(result.checksumSha256);
  expect(await readFile(staged.filePath)).toEqual(bytes);
  expect(f.capture).toHaveBeenCalledTimes(3);
});

it("retains invalid uploads as failed private evidence and rejects them for install", async () => {
  const f = await fixture();
  await expect(f.service.upload("p52-test", "bad.jar", Readable.from([Buffer.from("not a jar")]))).rejects.toMatchObject({ code: "ADDON_JAR_UNSAFE" });
  const dirs = await readdir(path.join(f.managerRoot, "addon-uploads"));
  expect(dirs).toHaveLength(1);
  const lifecycle = JSON.parse(await readFile(path.join(f.managerRoot, "addon-uploads", dirs[0]!, "lifecycle.json"), "utf8"));
  expect(lifecycle.state).toBe("failed");
  await expect(f.service.validatedSource("p52-test", dirs[0]!, "e".repeat(64), "mod")).rejects.toMatchObject({ code: "ADDON_STAGING_UNSAFE" });
});

it("rejects unsafe filenames, empty metadata, and other Loader metadata", async () => {
  const f = await fixture();
  await expect(f.service.upload("p52-test", "../escape.jar", Readable.from([Buffer.from("x")]))).rejects.toMatchObject({ reason: "invalid-addon-filename" });
  const paperJar = addonZip("plugin.yml", "name: Test\nversion: '1'\nmain: example.Test\n");
  await expect(f.service.upload("p52-test", "wrong-loader.jar", Readable.from([paperJar]))).rejects.toMatchObject({ code: "ADDON_METADATA_INVALID" });
});
