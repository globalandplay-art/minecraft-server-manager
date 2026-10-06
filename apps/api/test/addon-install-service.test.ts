import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { AddonAdapterIdentity } from "../src/services/addon-adapter-identity.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { BackupService } from "../src/services/backup-service.js";
import { AddonInstallService } from "../src/services/addon-install-service.js";
import { AddonInventory } from "../src/services/addon-inventory.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { AddonUploadService } from "../src/services/addon-upload-service.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { addonZip } from "./helpers/addon-zip.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-10-05T00:00:00.000Z") };
const uuid = () => randomUUID();
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(inject?: (point: string) => Promise<void>) {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-addon-install-")); roots.push(parent);
  const serverRoot = path.join(parent, "server"), managerRoot = path.join(parent, "manager");
  await mkdir(path.join(serverRoot, "plugins"), { recursive: true });
  await mkdir(path.join(serverRoot, "config")); await mkdir(path.join(serverRoot, "world", "dimensions", "minecraft", "the_nether"), { recursive: true });
  await mkdir(path.join(serverRoot, "disabled-plugins")); await mkdir(path.join(serverRoot, "trash")); await mkdir(managerRoot);
  await writeFile(path.join(serverRoot, "server.properties"), "level-name=world\n");
  await writeFile(path.join(serverRoot, "eula.txt"), "eula=true\n");
  await writeFile(path.join(serverRoot, "paper.jar"), "paper launcher fixture");
  await writeFile(path.join(serverRoot, "world", "level.dat"), "world fixture");
  await writeFile(path.join(serverRoot, "world", "dimensions", "minecraft", "the_nether", "level.dat"), "nether fixture");
  await writeFile(path.join(serverRoot, "disabled-plugins", "disabled.jar"), "disabled addon");
  await writeFile(path.join(serverRoot, "trash", "retained.jar"), "trash fixture");
  const adapter = { mode: "local", serverId: "p52-install", plan: { rootPath: serverRoot, jarPath: path.join(serverRoot, "paper.jar"),
    javaExecutable: path.join(parent, "java.exe"), name: "test", serverInfo: { type: "paper", minecraftVersion: "26.2", java: { requiredMajor: 25 } } },
    getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false, activeOperationId: null })
  } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]); const journal = new TransactionJournalStore(managerRoot); await journal.initialize();
  const store = new MemoryOperationStore(); const operations = new OperationService(store, clock, journal); await operations.initialize();
  const backups = new BackupService(registry, operations, journal, managerRoot, clock);
  const identity: AddonAdapterIdentity = { schemaVersion: 1, serverId: adapter.serverId, serverType: "paper", minecraftVersion: "26.2",
    javaMajor: 25, requiredJavaMajor: 25, rootIdentity: await backupDirectoryIdentity(serverRoot),
    addonRootIdentity: await backupDirectoryIdentity(path.join(serverRoot, "plugins")), launchJarIdentity: "a".repeat(64),
    launchJarSha256: "b".repeat(64), identitySha256: "c".repeat(64) };
  const captureIdentity = vi.fn(async () => identity);
  const uploads = new AddonUploadService(registry, operations, managerRoot, clock, captureIdentity);
  const bytes = addonZip("plugin.yml", "name: TestPlugin\nversion: '1.0'\nmain: example.TestPlugin\n");
  const upload = await uploads.upload(adapter.serverId, "test-plugin.jar", (await import("node:stream")).Readable.from([bytes]));
  const inventory = new AddonInventory();
  const service = new AddonInstallService(registry, operations, journal, backups, uploads, inventory, managerRoot, clock, inject, captureIdentity);
  return { adapter, backups, bytes, captureIdentity, identity, inventory, journal, managerRoot, operations, parent, registry, serverRoot, service, store, upload, uploads };
}

async function settle(f: Awaited<ReturnType<typeof fixture>>, operationId: string) {
  await vi.waitFor(() => expect(f.operations.get(operationId)?.state).toMatch(/^(succeeded|failed|interrupted)$/u));
  return f.operations.get(operationId)!;
}

it("installs a validated Paper JAR after a pinned private guard and never starts the server", async () => {
  const f = await fixture(); const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const operation = await f.service.install(f.adapter.serverId, { uploadId: f.upload.id, uploadRevision: f.upload.revision,
    inventoryRevision: listing.revision }, uuid());
  expect((await settle(f, operation.id)).state).toBe("succeeded");
  expect(await readFile(path.join(f.serverRoot, "plugins", "test-plugin.jar"))).toEqual(f.bytes);
  const scan = await f.journal.scan(); const record = scan.records.find((item) => item.intent.addonInstall);
  expect(record?.state).toBe("committed");
  expect(record?.checkpoints.map((item) => item.name)).toEqual(expect.arrayContaining([
    "intent-written", "before-install", "staging-validated", "target-installed", "installed-verified", "before-commit", "staging-consumed", "before-publication"
  ]));
  expect(record?.checkpoints.at(-1)?.details?.filesystemIdentity).toMatch(/^[a-f0-9]{64}$/u);
  expect(await f.uploads.verifyConsumed(f.adapter.serverId, f.upload.id, f.upload.revision, "plugin", operation.id)).toBe(true);
  expect(await f.backups.list(f.adapter.serverId)).toMatchObject([{ kind: "snapshot", scope: "server-snapshot", pinned: true }]);
  const guard = (await f.backups.list(f.adapter.serverId))[0]!;
  const guardManifest = await f.backups.privateSnapshot(f.adapter.serverId, guard.id);
  expect(guardManifest.files.map((file) => file.path)).toEqual(expect.arrayContaining([
    "world/level.dat", "world/dimensions/minecraft/the_nether/level.dat", "disabled-plugins/disabled.jar", "trash/retained.jar"
  ]));
});

it("does not overwrite a same-name addon and returns an explicit conflict before creating a guard", async () => {
  const f = await fixture(); await writeFile(path.join(f.serverRoot, "plugins", "test-plugin.jar"), "existing");
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  await expect(f.service.install(f.adapter.serverId, { uploadId: f.upload.id, uploadRevision: f.upload.revision,
    inventoryRevision: listing.revision }, uuid())).rejects.toMatchObject({ code: "ADDON_TARGET_CONFLICT" });
  expect(await readFile(path.join(f.serverRoot, "plugins", "test-plugin.jar"), "utf8")).toBe("existing");
  expect((await f.journal.scan()).records.filter((record) => record.intent.addonInstall)).toHaveLength(0);
});

it.each(["count", "bytes"] as const)("rejects an install that exceeds the resulting inventory %s limit", async (limit) => {
  const f = await fixture();
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const makeItem = (index: number, sizeBytes: number) => ({ id: String(index), kind: "plugin" as const, state: "enabled" as const,
    filename: `existing-${index}.jar`, sizeBytes, sha256: "a".repeat(64), name: null, version: null, loader: null,
    minecraftConstraint: null, compatibility: "unknown" as const, metadataStatus: "missing" as const });
  const fake = limit === "count"
    ? Array.from({ length: 1000 }, (_, index) => makeItem(index, 1))
    : [makeItem(0, 256 * 1024 ** 2)];
  vi.spyOn(f.inventory, "read").mockResolvedValue({ ...listing, items: fake });
  await expect(f.service.install(f.adapter.serverId, { uploadId: f.upload.id, uploadRevision: f.upload.revision,
    inventoryRevision: listing.revision }, uuid())).rejects.toMatchObject({ code: "ADDON_INVENTORY_LIMIT", statusCode: 413 });
  expect((await f.journal.scan()).records.filter((record) => record.intent.addonInstall)).toHaveLength(0);
  expect((await f.backups.list(f.adapter.serverId))).toHaveLength(0);
});

it("rejects an install when addon-owned data folders already fill the enabled directory entry cap", async () => {
  const f = await fixture();
  for (let index = 0; index < 1000; index++) await mkdir(path.join(f.serverRoot, "plugins", `owned-data-${index}`));
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  expect(listing.items.map((item) => item.filename)).toEqual(["disabled.jar"]);
  await expect(f.service.install(f.adapter.serverId, { uploadId: f.upload.id, uploadRevision: f.upload.revision,
    inventoryRevision: listing.revision }, uuid())).rejects.toMatchObject({ code: "ADDON_INVENTORY_LIMIT", statusCode: 413 });
  expect((await f.journal.scan()).records.filter((record) => record.intent.addonInstall)).toHaveLength(0);
  expect((await f.backups.list(f.adapter.serverId))).toHaveLength(0);
});

it.each([
  ["backup-created", "failed", false, false],
  ["intent-written", "failed", false, false],
  ["before-install", "failed", false, false],
  ["staging-validated", "failed", false, false],
  ["target-installed", "interrupted", true, true],
  ["before-commit", "interrupted", true, true],
  ["committed", "succeeded", false, true],
  ["before-publication", "succeeded", false, true]
] as const)("reconciles install interruption at %s after a fresh service restart", async (point, expectedState, recovery, installed) => {
  const f = await fixture(async (at) => { if (at === point) throw new Error(`synthetic interruption at ${point}`); });
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const operation = await f.service.install(f.adapter.serverId, { uploadId: f.upload.id, uploadRevision: f.upload.revision,
    inventoryRevision: listing.revision }, uuid());
  expect((await settle(f, operation.id)).state).toBe("interrupted");
  const restartedJournal = new TransactionJournalStore(f.managerRoot); await restartedJournal.initialize();
  const restarted = new OperationService(f.store, clock, restartedJournal);
  const restartService = new AddonInstallService(f.registry, restarted, restartedJournal,
    new BackupService(f.registry, restarted, restartedJournal, f.managerRoot, clock), f.uploads, f.inventory, f.managerRoot, clock,
    undefined, f.captureIdentity);
  await restartService.reconcileStartup(); await restarted.initialize();
  expect(restarted.get(operation.id)?.state).toBe(expectedState);
  expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(recovery);
  const target = path.join(f.serverRoot, "plugins", "test-plugin.jar");
  if (installed) expect(await readFile(target)).toEqual(f.bytes);
  else await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await f.backups.list(f.adapter.serverId)).toMatchObject([{ pinned: true, scope: "server-snapshot" }]);
  if (!installed) {
    const secondJournal = new TransactionJournalStore(f.managerRoot); await secondJournal.initialize();
    const secondOperations = new OperationService(f.store, clock, secondJournal);
    const secondService = new AddonInstallService(f.registry, secondOperations, secondJournal,
      new BackupService(f.registry, secondOperations, secondJournal, f.managerRoot, clock), f.uploads, f.inventory, f.managerRoot, clock,
      undefined, f.captureIdentity);
    await secondService.reconcileStartup(); await secondOperations.initialize();
    expect(secondOperations.get(operation.id)?.state).toBe("failed");
    expect(secondOperations.get(operation.id)?.error?.code).toBe("ADDON_INSTALL_NOT_APPLIED");
    expect(secondOperations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  }
});

it("reconciles an unchanged committed install after manager restart", async () => {
  const f = await fixture(async (point) => { if (point === "committed") throw new Error("synthetic manager loss after commit"); });
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const operation = await f.service.install(f.adapter.serverId, { uploadId: f.upload.id, uploadRevision: f.upload.revision,
    inventoryRevision: listing.revision }, uuid());
  expect((await settle(f, operation.id)).state).toBe("interrupted");
  const restartedJournal = new TransactionJournalStore(f.managerRoot); await restartedJournal.initialize();
  const restarted = new OperationService(f.store, clock, restartedJournal);
  const restartService = new AddonInstallService(f.registry, restarted, restartedJournal, new BackupService(f.registry, restarted, restartedJournal, f.managerRoot, clock),
    f.uploads, f.inventory, f.managerRoot, clock, undefined, f.captureIdentity);
  await restartService.reconcileStartup(); await restarted.initialize();
  expect(restarted.get(operation.id)?.state).toBe("succeeded");
  expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
});

it("keeps recovery required if the committed target identity changes before manager restart", async () => {
  const f = await fixture(async (point) => { if (point === "committed") throw new Error("synthetic manager loss after commit"); });
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const operation = await f.service.install(f.adapter.serverId, { uploadId: f.upload.id, uploadRevision: f.upload.revision,
    inventoryRevision: listing.revision }, uuid());
  expect((await settle(f, operation.id)).state).toBe("interrupted");
  const target = path.join(f.serverRoot, "plugins", "test-plugin.jar");
  const original = await readFile(target); await rm(target); await writeFile(target, original);
  const secondJournal = new TransactionJournalStore(f.managerRoot); await secondJournal.initialize();
  const second = new OperationService(f.store, clock, secondJournal);
  const secondService = new AddonInstallService(f.registry, second, secondJournal, new BackupService(f.registry, second, secondJournal, f.managerRoot, clock),
    f.uploads, f.inventory, f.managerRoot, clock, undefined, f.captureIdentity);
  await secondService.reconcileStartup(); await second.initialize();
  expect(second.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
  expect(second.get(operation.id)?.state).toBe("interrupted");
});
