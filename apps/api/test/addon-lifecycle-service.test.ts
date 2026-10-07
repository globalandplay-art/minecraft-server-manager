import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { AddonAdapterIdentity } from "../src/services/addon-adapter-identity.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { BackupService } from "../src/services/backup-service.js";
import { ADDON_LIMITS, addonOpaqueId, AddonInventory } from "../src/services/addon-inventory.js";
import { AddonLifecycleService } from "../src/services/addon-lifecycle-service.js";
import { registerAddonLifecycleRoutes } from "../src/routes/addons.js";
import { errorResponse, installLocalRequestGuard } from "../src/infra/http.js";
import { DomainError } from "../src/services/domain-errors.js";
import { OperationService } from "../src/services/operation-service.js";
import { JsonOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { addonZip } from "./helpers/addon-zip.js";

const roots: string[] = [];
let clockTick = 0;
const clock = { now: () => new Date(Date.parse("2026-10-06T00:00:00.000Z") + clockTick++) };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(initial: "enabled" | "disabled" = "enabled", interrupt?: string, serverType: "paper" | "fabric" = "paper") {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-addon-lifecycle-")); roots.push(parent);
  const serverRoot = path.join(parent, "server"), managerRoot = path.join(parent, "manager");
  const enabledFolder = serverType === "paper" ? "plugins" : "mods", disabledFolder = serverType === "paper" ? "disabled-plugins" : "disabled-mods";
  await mkdir(path.join(serverRoot, enabledFolder), { recursive: true });
  await mkdir(path.join(serverRoot, disabledFolder)); await mkdir(path.join(serverRoot, "trash"));
  await mkdir(path.join(serverRoot, "config")); await mkdir(path.join(serverRoot, "world")); await mkdir(managerRoot);
  await writeFile(path.join(serverRoot, "server.properties"), "level-name=world\n");
  await writeFile(path.join(serverRoot, "eula.txt"), "eula=true\n"); await writeFile(path.join(serverRoot, serverType === "paper" ? "paper.jar" : "fabric-server-launch.jar"), "server launcher fixture");
  await writeFile(path.join(serverRoot, "world", "level.dat"), "world marker must remain unchanged");
  const bytes = serverType === "paper" ? addonZip("plugin.yml", "name: LifecyclePlugin\nversion: '1.0'\nmain: example.LifecyclePlugin\n") :
    addonZip("fabric.mod.json", JSON.stringify({ schemaVersion: 1, id: "lifecycle_mod", name: "Lifecycle Mod", version: "1.0", environment: "server" }));
  const originalFolder = initial === "enabled" ? enabledFolder : disabledFolder;
  await writeFile(path.join(serverRoot, originalFolder, "lifecycle.jar"), bytes);
  const adapter = { mode: "local", serverId: "p53-lifecycle", plan: { rootPath: serverRoot, jarPath: path.join(serverRoot, "paper.jar"),
    javaExecutable: path.join(parent, "java.exe"), name: "test", serverInfo: { type: serverType, minecraftVersion: "26.2", java: { requiredMajor: 25 } } },
    getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false, activeOperationId: null })
  } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(managerRoot); await journal.initialize();
  const store = new JsonOperationStore(managerRoot), operations = new OperationService(store, clock, journal); await operations.initialize();
  const backups = new BackupService(registry, operations, journal, managerRoot, clock);
  const identity: AddonAdapterIdentity = { schemaVersion: 1, serverId: adapter.serverId, serverType, minecraftVersion: "26.2", javaMajor: 25,
    requiredJavaMajor: 25, rootIdentity: await backupDirectoryIdentity(serverRoot), addonRootIdentity: await backupDirectoryIdentity(path.join(serverRoot, enabledFolder)),
    launchJarIdentity: "a".repeat(64), launchJarSha256: "b".repeat(64), identitySha256: "c".repeat(64) };
  const captureIdentity = vi.fn(async () => identity), inventory = new AddonInventory();
  let activeInterrupt = interrupt, checkpointHook: ((point: string) => Promise<void>) | undefined;
  const inject = async (point: string) => { await checkpointHook?.(point); if (point === activeInterrupt) throw new Error(`synthetic interruption at ${point}`); };
  const service = new AddonLifecycleService(registry, operations, journal, backups, inventory, managerRoot, clock, inject, captureIdentity);
  const setHook = (hook?: (point: string) => Promise<void>) => { checkpointHook = hook; };
  const wrappedService = service;
  // Inject hooks through a thin test wrapper so tests can pause or alter the filesystem at exact journal boundaries.
  return { adapter, backups, bytes, captureIdentity, identity, inventory, journal, managerRoot, operations, parent, registry, serverRoot, service: wrappedService,
    setHook, setInterrupt: (point?: string) => { activeInterrupt = point; } };
}
async function settle(f: Awaited<ReturnType<typeof fixture>>, operationId: string) {
  await vi.waitFor(() => expect(f.operations.get(operationId)?.state).toMatch(/^(succeeded|failed|interrupted)$/u), { timeout: 15_000 });
  return f.operations.get(operationId)!;
}
async function run(f: Awaited<ReturnType<typeof fixture>>, action: "disable" | "enable" | "trash") {
  const serverType = f.adapter.plan.serverInfo.type as "paper" | "fabric";
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, serverType);
  const id = addonOpaqueId(f.adapter.serverId, serverType === "paper" ? "plugin" : "mod", "lifecycle.jar");
  const op = await f.service.mutate(f.adapter.serverId, id, action, listing.revision, randomUUID());
  return { operation: await settle(f, op.id), op };
}

it.each(["count", "bytes"] as const)("refuses Restore exceeding inventory %s without consuming trash", async (limit) => {
  const f = await fixture();
  const original = (await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper")).items[0]!;
  expect((await run(f, "trash")).operation.state).toBe("succeeded");
  const trash = await f.service.listTrash(f.adapter.serverId);
  const empty = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const items = limit === "count" ? Array.from({ length: ADDON_LIMITS.files }, (_, n) => ({ ...original, filename: `other-${n}.jar` })) :
    [{ ...original, filename: "other.jar", sizeBytes: ADDON_LIMITS.totalBytes }];
  vi.spyOn(f.inventory, "read").mockResolvedValue({ ...empty, items });
  const accepted = await f.service.restore(f.adapter.serverId, trash.items[0]!.id, trash.revision, randomUUID());
  expect(await settle(f, accepted.id)).toMatchObject({ state: "failed", error: { code: "ADDON_INVENTORY_LIMIT" } });
  await expect(readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await f.service.listTrash(f.adapter.serverId)).items).toHaveLength(1);
  expect((await f.journal.scan()).records.filter((record) => record.intent.addonLifecycle?.action === "restore")).toHaveLength(0);
});

it.each(["enable", "disable", "trash"] as const)("rechecks %s directory capacity at the publication checkpoint", async (action) => {
  const f = await fixture(action === "enable" ? "disabled" : "enabled");
  f.setHook(async (point) => {
    if (point !== "before-move") return;
    const folder = action === "trash" ? path.join(f.serverRoot, "trash", "addons", f.adapter.serverId) :
      path.join(f.serverRoot, action === "enable" ? "plugins" : "disabled-plugins");
    await Promise.all(Array.from({ length: ADDON_LIMITS.files }, (_, n) => writeFile(path.join(folder, `filler-${n}.txt`), "")));
  });
  expect((await run(f, action)).operation.state).toBe("interrupted");
  const source = path.join(f.serverRoot, action === "enable" ? "disabled-plugins" : "plugins", "lifecycle.jar");
  expect(await readFile(source)).toEqual(f.bytes);
  if (action !== "trash") await expect(readFile(path.join(f.serverRoot, action === "enable" ? "plugins" : "disabled-plugins", "lifecycle.jar"))).rejects.toMatchObject({ code: "ENOENT" });
  const records = (await f.journal.scan()).records.filter((record) => record.intent.addonLifecycle?.action === action);
  expect(records).toHaveLength(1);
  expect(records[0]!.state).toBe("recovery-required");
  expect(records[0]!.checkpoints.some((point) => point.name === "destination-installed")).toBe(false);
});

it.each(["plugins", "disabled-plugins"] as const)("rejects %s junction replacement after the final capacity scan without external publication", async (folder) => {
  const f = await fixture();
  const outside = path.join(f.parent, "outside"); await mkdir(outside);
  f.setHook(async (point) => {
    if (point !== "before-move") return;
    const originalRead = f.inventory.read.bind(f.inventory);
    vi.spyOn(f.inventory, "read").mockImplementationOnce(async (...args) => {
      const listing = await originalRead(...args);
      await rename(path.join(f.serverRoot, folder), path.join(f.serverRoot, `retained-${folder}`));
      await symlink(outside, path.join(f.serverRoot, folder), "junction");
      return listing;
    });
  });
  expect((await run(f, "disable")).operation.state).toBe("interrupted");
  expect(await readdir(outside)).toEqual([]);
  expect(await readFile(path.join(f.serverRoot, folder === "plugins" ? "retained-plugins" : "plugins", "lifecycle.jar"))).toEqual(f.bytes);
  const records = (await f.journal.scan()).records.filter((record) => record.intent.addonLifecycle);
  expect(records).toHaveLength(1);
  expect(records[0]!.state).toBe("recovery-required");
  expect(records[0]!.checkpoints.some((point) => point.name === "destination-installed")).toBe(false);
});

it("completes enabled/disabled/trash/restore flows with a durable pinned guard and no server start", async () => {
  const f = await fixture();
  const disabled = await run(f, "disable"); expect(disabled.operation.state, JSON.stringify(disabled.operation)).toBe("succeeded");
  expect(await readFile(path.join(f.serverRoot, "disabled-plugins", "lifecycle.jar"))).toEqual(f.bytes);
  const enabled = await run(f, "enable"); expect(enabled.operation.state).toBe("succeeded");
  const trashed = await run(f, "trash"); expect(trashed.operation.state).toBe("succeeded");
  const trash = await f.service.listTrash(f.adapter.serverId);
  expect(trash.items).toHaveLength(1); expect(trash.items[0]).toMatchObject({ addonId: addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar"),
    originalState: "enabled", filename: "lifecycle.jar", restoreAllowed: true, name: "LifecyclePlugin", version: "1.0" });
  const restore = await f.service.restore(f.adapter.serverId, trash.items[0]!.id, trash.revision, randomUUID());
  expect((await settle(f, restore.id)).state).toBe("succeeded");
  expect(await readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"))).toEqual(f.bytes);
  expect((await f.service.listTrash(f.adapter.serverId)).items).toHaveLength(0);
  expect((await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper")).items).toMatchObject([{ state: "enabled", filename: "lifecycle.jar" }]);
  expect(await readFile(path.join(f.serverRoot, "world", "level.dat"), "utf8")).toBe("world marker must remain unchanged");
  expect((await f.backups.list(f.adapter.serverId)).filter((backup) => backup.pinned && backup.scope === "server-snapshot").length).toBe(4);
  expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  const records = (await f.journal.scan()).records.filter((record) => record.intent.addonLifecycle);
  expect(records).toHaveLength(4); expect(records.every((record) => record.schemaVersion === 8 && record.state === "committed")).toBe(true);
  for (const record of records) expect(record.checkpoints.map((point) => point.name)).toEqual(expect.arrayContaining([
    "backup-created", "intent-written", "source-verified", "before-move", "destination-installed", "source-removed", "before-commit", "before-publication", "committed"
  ]));
  for (const result of [disabled.operation, enabled.operation, trashed.operation, f.operations.get(restore.id)!]) {
    expect(result.result).toMatchObject({ rollbackAvailable: false, restartRequired: true });
  }
});

it("restores a trashed disabled addon to disabled without implicitly enabling it", async () => {
  const f = await fixture("disabled"), trashed = await run(f, "trash");
  expect(trashed.operation.state).toBe("succeeded");
  const listing = await f.service.listTrash(f.adapter.serverId), item = listing.items[0]!;
  expect(item.originalState).toBe("disabled");
  const operation = await f.service.restore(f.adapter.serverId, item.id, listing.revision, randomUUID());
  expect((await settle(f, operation.id)).state).toBe("succeeded");
  expect(await readFile(path.join(f.serverRoot, "disabled-plugins", "lifecycle.jar"))).toEqual(f.bytes);
  await expect(readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("runs the Fabric mod lifecycle in the mods namespaces and keeps restart explicit", async () => {
  const f = await fixture("enabled", undefined, "fabric");
  expect((await run(f, "disable")).operation.state).toBe("succeeded");
  expect(await readFile(path.join(f.serverRoot, "disabled-mods", "lifecycle.jar"))).toEqual(f.bytes);
  expect((await run(f, "enable")).operation.state).toBe("succeeded");
  const trashed = await run(f, "trash"); expect(trashed.operation.state).toBe("succeeded");
  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(new JsonOperationStore(f.managerRoot), clock, journal);
  const restarted = new AddonLifecycleService(f.registry, operations, journal, new BackupService(f.registry, operations, journal, f.managerRoot, clock),
    new AddonInventory(), f.managerRoot, clock, undefined, f.captureIdentity);
  await restarted.reconcileStartup(); await operations.initialize();
  expect(operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  const listing = await restarted.listTrash(f.adapter.serverId), item = listing.items[0]!;
  expect(item).toMatchObject({ kind: "mod", loader: "fabric", filename: "lifecycle.jar" });
  const restore = await restarted.restore(f.adapter.serverId, item.id, listing.revision, randomUUID());
  await vi.waitFor(() => expect(operations.get(restore.id)?.state).toBe("succeeded"), { timeout: 15_000 });
  expect(operations.get(restore.id)?.result).toMatchObject({ restartRequired: true });
  expect(await readFile(path.join(f.serverRoot, "mods", "lifecycle.jar"))).toEqual(f.bytes);
  expect(await readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar")).catch(() => null)).toBeNull();
});

it("validates a restored tombstone through later committed lifecycle moves after manager restart", async () => {
  const f = await fixture(); await run(f, "trash");
  const oldTrashId = (await f.service.listTrash(f.adapter.serverId)).items[0]!.id;
  const beforeRestore = await f.service.listTrash(f.adapter.serverId);
  const restored = await f.service.restore(f.adapter.serverId, oldTrashId, beforeRestore.revision, randomUUID());
  expect((await settle(f, restored.id)).state).toBe("succeeded");
  expect((await run(f, "disable")).operation.state).toBe("succeeded");
  expect((await run(f, "enable")).operation.state).toBe("succeeded");
  expect((await run(f, "trash")).operation.state).toBe("succeeded");

  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(new JsonOperationStore(f.managerRoot), clock, journal);
  const service = new AddonLifecycleService(f.registry, operations, journal, new BackupService(f.registry, operations, journal, f.managerRoot, clock),
    new AddonInventory(), f.managerRoot, clock, undefined, f.captureIdentity);
  await service.reconcileStartup(); await operations.initialize();
  expect(operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  expect((await service.listTrash(f.adapter.serverId)).items).toHaveLength(1);
});

it("accepts a later Trash successor when a new JAR reuses the restored filename", async () => {
  const f = await fixture(); await run(f, "trash");
  const oldTrashId = (await f.service.listTrash(f.adapter.serverId)).items[0]!.id;
  const firstList = await f.service.listTrash(f.adapter.serverId), restored = await f.service.restore(f.adapter.serverId, oldTrashId, firstList.revision, randomUUID());
  expect((await settle(f, restored.id)).state).toBe("succeeded");
  const secondTrash = await run(f, "trash"); expect(secondTrash.operation.state).toBe("succeeded");
  await writeFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"), addonZip("plugin.yml", "name: Replacement\nversion: '2.0'\nmain: example.Replacement\n"));
  const listing = await f.service.listTrash(f.adapter.serverId);
  expect(listing.items).toHaveLength(1);
  expect(listing.items[0]!.id).not.toBe(oldTrashId);
  expect(await readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"), "utf8")).not.toBe(f.bytes.toString("utf8"));
});

it("serializes a Trash listing that starts before a lifecycle mutation", async () => {
  const f = await fixture(), revision = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  let resume!: () => void, arrived!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; }), atCapture = new Promise<void>((resolve) => { arrived = resolve; });
  f.captureIdentity.mockImplementation(async () => { arrived(); await paused; return f.identity; });
  const listingPromise = f.service.listTrash(f.adapter.serverId);
  await atCapture;
  let mutationFinished = false;
  const mutationPromise = f.service.mutate(f.adapter.serverId, addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar"), "trash", revision.revision, randomUUID())
    .then((operation) => { mutationFinished = true; return operation; }, (error) => { mutationFinished = true; return error; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(mutationFinished).toBe(true);
  const mutation = await mutationPromise;
  expect(mutation).toMatchObject({ code: "OPERATION_CONFLICT", statusCode: 409 });
  expect(f.operations.getServerState(f.adapter.serverId).activeOperationId).toBeNull();
  resume();
  expect((await listingPromise).items).toHaveLength(0);
  expect((await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper")).items).toHaveLength(1);
  expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
});

it("does not publish a hardlink outside the registered root after a target junction substitution", async () => {
  const f = await fixture(), targetParent = path.join(f.serverRoot, "disabled-plugins"), parked = `${targetParent}-parked`, outside = path.join(f.parent, "outside");
  await mkdir(outside);
  f.setHook(async (point) => {
    if (point !== "before-move") return;
    await rename(targetParent, parked);
    await symlink(outside, targetParent, "junction");
  });
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const operation = await f.service.mutate(f.adapter.serverId, addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar"), "disable", listing.revision, randomUUID());
  expect((await settle(f, operation.id)).state).toBe("interrupted");
  expect(await readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"))).toEqual(f.bytes);
  await expect(readFile(path.join(outside, "lifecycle.jar"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
});

it("retains and refuses a restore when the original filename is already occupied", async () => {
  const f = await fixture(); await run(f, "trash");
  const listing = await f.service.listTrash(f.adapter.serverId), item = listing.items[0]!;
  const replacement = addonZip("plugin.yml", "name: Replacement\nversion: '2.0'\nmain: example.Replacement\n");
  await writeFile(path.join(f.serverRoot, "plugins", item.filename), replacement);
  const restore = await f.service.restore(f.adapter.serverId, item.id, listing.revision, randomUUID());
  const outcome = await settle(f, restore.id);
  expect(outcome.state).toBe("failed"); expect(outcome.error?.code).toBe("ADDON_TARGET_CONFLICT");
  expect(await readFile(path.join(f.serverRoot, "plugins", item.filename))).toEqual(replacement);
  expect((await f.service.listTrash(f.adapter.serverId)).items).toHaveLength(1);
});

it("keeps a recovery gate when a committed Trash payload is modified", async () => {
  const f = await fixture(); await run(f, "trash");
  const entry = (await readdir(path.join(f.serverRoot, "trash", "addons", f.adapter.serverId)))[0]!;
  await writeFile(path.join(f.serverRoot, "trash", "addons", f.adapter.serverId, entry, "payload.jar"), "tampered payload");
  await expect(f.service.listTrash(f.adapter.serverId)).rejects.toMatchObject({ code: "ADDON_LIFECYCLE_RECOVERY_REQUIRED" });
  expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
});

it("rejects reuse of a consumed Trash receipt without a second move", async () => {
  const f = await fixture(); await run(f, "trash");
  const trash = await f.service.listTrash(f.adapter.serverId), receipt = trash.items[0]!;
  const restore = await f.service.restore(f.adapter.serverId, receipt.id, trash.revision, randomUUID());
  expect((await settle(f, restore.id)).state).toBe("succeeded");
  const current = await f.service.listTrash(f.adapter.serverId);
  await expect(f.service.restore(f.adapter.serverId, receipt.id, current.revision, randomUUID())).rejects.toMatchObject({ code: "ADDON_TRASH_CONSUMED" });
  expect((await f.journal.scan()).records.filter((record) => record.intent.addonLifecycle?.action === "restore")).toHaveLength(1);
});

it("rejects a changed adapter identity before writing lifecycle intent", async () => {
  const f = await fixture(), inventory = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  let call = 0;
  f.captureIdentity.mockImplementation(async () => {
    call += 1;
    return call === 3 ? { ...f.identity, identitySha256: "d".repeat(64) } : f.identity;
  });
  const operation = await f.service.mutate(f.adapter.serverId, addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar"), "disable", inventory.revision, randomUUID());
  const result = await settle(f, operation.id);
  expect(result.state).toBe("failed"); expect(result.error?.code).toBe("ADDON_REVISION_CONFLICT");
  expect(await readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"))).toEqual(f.bytes);
  expect((await f.journal.scan()).records.filter((record) => record.intent.addonLifecycle)).toHaveLength(0);
});

it("reconciles an unapplied Trash after an earlier Trash was restored", async () => {
  const f = await fixture(); await run(f, "trash");
  const first = (await f.service.listTrash(f.adapter.serverId)).items[0]!;
  const restore = await f.service.restore(f.adapter.serverId, first.id, (await f.service.listTrash(f.adapter.serverId)).revision, randomUUID());
  expect((await settle(f, restore.id)).state).toBe("succeeded");
  f.setInterrupt("before-move");
  const inventory = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const interruptedTrash = await f.service.mutate(f.adapter.serverId, addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar"), "trash", inventory.revision, randomUUID());
  expect((await settle(f, interruptedTrash.id)).state).toBe("interrupted");
  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(new JsonOperationStore(f.managerRoot), clock, journal);
  const service = new AddonLifecycleService(f.registry, operations, journal, new BackupService(f.registry, operations, journal, f.managerRoot, clock),
    f.inventory, f.managerRoot, clock, undefined, f.captureIdentity);
  await service.reconcileStartup(); await operations.initialize();
  expect(operations.get(interruptedTrash.id)?.state).toBe("failed");
  expect(operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  expect((await service.listTrash(f.adapter.serverId)).items).toHaveLength(0);
  expect(await readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"))).toEqual(f.bytes);
});

it("returns a non-destructive busy response to Trash reads during an active move", async () => {
  const f = await fixture(); let resume!: () => void, arrived!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; }), atCheckpoint = new Promise<void>((resolve) => { arrived = resolve; });
  f.setHook(async (point) => { if (point === "destination-installed") { arrived(); await paused; } });
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const operation = await f.service.mutate(f.adapter.serverId, addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar"), "trash", listing.revision, randomUUID());
  await atCheckpoint;
  await expect(f.service.listTrash(f.adapter.serverId)).rejects.toMatchObject({ code: "ADDON_LIFECYCLE_BUSY", statusCode: 409 });
  expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  resume();
  expect((await settle(f, operation.id)).state).toBe("succeeded");
  expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
});

it("replays one idempotency key without a second mutation and rejects payload reuse", async () => {
  const f = await fixture(), listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const key = randomUUID(), id = addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar");
  const [first, replay] = await Promise.all([
    f.service.mutate(f.adapter.serverId, id, "disable", listing.revision, key),
    f.service.mutate(f.adapter.serverId, id, "disable", listing.revision, key)
  ]);
  expect(replay.id).toBe(first.id);
  await expect(f.service.mutate(f.adapter.serverId, id, "trash", listing.revision, key)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  expect((await settle(f, first.id)).state).toBe("succeeded");
  expect((await f.journal.scan()).records.filter((record) => record.intent.addonLifecycle)).toHaveLength(1);
  expect((await f.backups.list(f.adapter.serverId)).filter((backup) => backup.pinned && backup.scope === "server-snapshot")).toHaveLength(1);
});

it("exposes strict local lifecycle operations and a separate sanitized Trash listing", async () => {
  const f = await fixture(), app = fastify({ logger: false });
  app.addHook("onRequest", installLocalRequestGuard(clock, "local"));
  app.setErrorHandler((error, request, reply) => {
    const domain = error instanceof DomainError ? error : new DomainError(400, "VALIDATION_ERROR", "invalid");
    void reply.code(domain.statusCode).send(errorResponse(request.id, clock, domain.code, domain.safeMessage, "local", domain.reason));
  });
  registerAddonLifecycleRoutes(app, f.service, clock, "local");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "content-type": "application/json", "x-manager-intent": "local-ui" };
  try {
    const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
    const id = addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar");
    const response = await app.inject({ method: "POST", url: `/api/v1/servers/${f.adapter.serverId}/addons/${id}/disable`,
      headers: { ...headers, "idempotency-key": randomUUID() }, payload: { revision: listing.revision } });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json().data.operation).toMatchObject({ kind: "addon-change", state: "queued", result: null });
    expect((await settle(f, response.json().data.operation.id)).state).toBe("succeeded");
    const trash = await app.inject({ method: "GET", url: `/api/v1/servers/${f.adapter.serverId}/addons/trash`, headers });
    expect(trash.statusCode).toBe(200); expect(trash.json().data).toMatchObject({ items: [], revision: expect.any(String) });
    const missingKey = await app.inject({ method: "POST", url: `/api/v1/servers/${f.adapter.serverId}/addons/${id}/trash`, headers, payload: { revision: listing.revision } });
    expect(missingKey.statusCode).toBe(428);
  } finally { await app.close(); }
});

it("fails closed when the same addon is present in enabled and disabled namespaces", async () => {
  const f = await fixture("disabled"); await writeFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"), "different target");
  await expect(f.inventory.read(f.adapter.serverId, f.serverRoot, "paper")).rejects.toMatchObject({ code: "ADDON_INVENTORY_UNSAFE" });
  expect(await readFile(path.join(f.serverRoot, "disabled-plugins", "lifecycle.jar"))).toEqual(f.bytes);
  expect(await readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"), "utf8")).toBe("different target");
  expect((await f.journal.scan()).records.filter((record) => record.intent.addonLifecycle)).toHaveLength(0);
});

it.each([
  ["intent-written", "failed", false], ["source-verified", "failed", false], ["before-move", "failed", false],
  ["destination-installed", "succeeded", false], ["source-removed", "succeeded", false], ["before-commit", "succeeded", false],
  ["committed", "succeeded", false], ["before-publication", "succeeded", false]
] as const)("reconciles disable interruption at %s after fresh manager/journal restart", async (point, expectedState, expectedRecovery) => {
  const f = await fixture("enabled", point); const first = await run(f, "disable");
  expect(first.operation.state).toBe("interrupted");
  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(new JsonOperationStore(f.managerRoot), clock, journal);
  const service = new AddonLifecycleService(f.registry, operations, journal, new BackupService(f.registry, operations, journal, f.managerRoot, clock),
    f.inventory, f.managerRoot, clock, undefined, f.captureIdentity);
  await service.reconcileStartup(); await operations.initialize();
  expect(operations.get(first.op.id)?.state).toBe(expectedState);
  expect(operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(expectedRecovery);
  const active = await readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar")).catch(() => null);
  const disabled = await readFile(path.join(f.serverRoot, "disabled-plugins", "lifecycle.jar")).catch(() => null);
  if (expectedState === "failed") { expect(active).toEqual(f.bytes); expect(disabled).toBeNull(); }
  else { expect(active).toBeNull(); expect(disabled).toEqual(f.bytes); }
});

it.each([
  ["enable", "intent-written", "failed"], ["enable", "backup-created", "failed"], ["enable", "source-verified", "failed"], ["enable", "before-move", "failed"],
  ["enable", "destination-installed", "succeeded"], ["enable", "source-removed", "succeeded"], ["enable", "before-commit", "succeeded"],
  ["enable", "committed", "succeeded"], ["enable", "before-publication", "succeeded"],
  ["trash", "intent-written", "failed"], ["trash", "backup-created", "failed"], ["trash", "source-verified", "failed"], ["trash", "before-move", "failed"],
  ["trash", "destination-installed", "succeeded"], ["trash", "source-removed", "succeeded"], ["trash", "receipt-persisted", "succeeded"],
  ["trash", "before-commit", "succeeded"], ["trash", "committed", "succeeded"], ["trash", "before-publication", "succeeded"],
  ["restore", "intent-written", "failed"], ["restore", "backup-created", "failed"], ["restore", "source-verified", "failed"], ["restore", "before-move", "failed"],
  ["restore", "destination-installed", "succeeded"], ["restore", "source-removed", "succeeded"], ["restore", "receipt-consumed", "succeeded"],
  ["restore", "before-commit", "succeeded"], ["restore", "committed", "succeeded"], ["restore", "before-publication", "succeeded"]
] as const)("reconciles %s interruption at %s after manager restart", async (action, point, expectedState) => {
  const f = await fixture(action === "enable" ? "disabled" : "enabled");
  let trashId: string | undefined;
  if (action === "restore") {
    const trashed = await run(f, "trash"); expect(trashed.operation.state).toBe("succeeded");
    trashId = (await f.service.listTrash(f.adapter.serverId)).items[0]!.id;
  }
  f.setInterrupt(point);
  const initial = action === "restore" ? await f.service.listTrash(f.adapter.serverId) : await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const operation = action === "restore"
    ? await f.service.restore(f.adapter.serverId, trashId!, initial.revision, randomUUID())
    : await f.service.mutate(f.adapter.serverId, addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar"), action, initial.revision, randomUUID());
  expect((await settle(f, operation.id)).state).toBe("interrupted");
  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(new JsonOperationStore(f.managerRoot), clock, journal), service = new AddonLifecycleService(f.registry, operations, journal,
    new BackupService(f.registry, operations, journal, f.managerRoot, clock), f.inventory, f.managerRoot, clock, undefined, f.captureIdentity);
  await service.reconcileStartup(); await operations.initialize();
  const reconciled = operations.get(operation.id);
  expect(reconciled?.state).toBe(expectedState);
  if (expectedState === "succeeded") {
    const lifecycle = (await journal.scan()).records.find((record) => record.intent.operationId === operation.id)?.intent.addonLifecycle;
    expect(reconciled?.result).toMatchObject({ resourceId: lifecycle?.action === "trash" ? lifecycle.trashId : lifecycle?.addonId,
      rollbackAvailable: false, restartRequired: true });
  }
  expect(operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  const enabledPath = path.join(f.serverRoot, "plugins", "lifecycle.jar"), disabledPath = path.join(f.serverRoot, "disabled-plugins", "lifecycle.jar");
  const enabled = await readFile(enabledPath).catch(() => null), disabled = await readFile(disabledPath).catch(() => null);
  const hasTrash = (await service.listTrash(f.adapter.serverId)).items.length > 0;
  if (action === "enable") {
    expect(enabled).toEqual(expectedState === "succeeded" ? f.bytes : null);
    expect(disabled).toEqual(expectedState === "failed" ? f.bytes : null);
  } else if (action === "trash") {
    expect(enabled).toEqual(expectedState === "failed" ? f.bytes : null); expect(hasTrash).toBe(expectedState === "succeeded");
  } else {
    expect(enabled).toEqual(expectedState === "succeeded" ? f.bytes : null); expect(hasTrash).toBe(expectedState === "failed");
  }
});

it("retains recoveryRequired when an installed target changes identity before reconciliation", async () => {
  const f = await fixture("enabled", "committed"), op = await run(f, "disable");
  expect(op.operation.state).toBe("interrupted");
  const target = path.join(f.serverRoot, "disabled-plugins", "lifecycle.jar");
  const bytes = await readFile(target); await rm(target); await writeFile(target, bytes);
  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(new JsonOperationStore(f.managerRoot), clock, journal), service = new AddonLifecycleService(f.registry, operations, journal,
    new BackupService(f.registry, operations, journal, f.managerRoot, clock), f.inventory, f.managerRoot, clock, undefined, f.captureIdentity);
  await service.reconcileStartup(); await operations.initialize();
  expect(operations.get(op.op.id)?.state).toBe("interrupted");
  expect(operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
});

it("fails closed and retains a recovery gate when committed Trash evidence is removed", async () => {
  const f = await fixture(), trashed = await run(f, "trash");
  expect(trashed.operation.state).toBe("succeeded");
  const entry = path.join(f.serverRoot, "trash", "addons", f.adapter.serverId, String(trashed.operation.result?.resourceId));
  await rm(entry, { recursive: true, force: true });
  await expect(f.service.listTrash(f.adapter.serverId)).rejects.toMatchObject({ code: "ADDON_LIFECYCLE_RECOVERY_REQUIRED" });
  expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
});

it("rediscovers missing committed Trash evidence during a fresh manager startup", async () => {
  const f = await fixture(), trashed = await run(f, "trash");
  const entry = path.join(f.serverRoot, "trash", "addons", f.adapter.serverId, String(trashed.operation.result?.resourceId));
  await rm(entry, { recursive: true, force: true });
  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(new JsonOperationStore(f.managerRoot), clock, journal);
  const service = new AddonLifecycleService(f.registry, operations, journal, new BackupService(f.registry, operations, journal, f.managerRoot, clock),
    f.inventory, f.managerRoot, clock, undefined, f.captureIdentity);
  await service.reconcileStartup(); await operations.initialize();
  expect(operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
});

it("rejects source-parent substitution after durable intent and before move", async () => {
  const f = await fixture("disabled"), sourceDir = path.join(f.serverRoot, "disabled-plugins"), parked = path.join(f.serverRoot, "disabled-plugins-old");
  f.setHook(async (point) => {
    if (point !== "before-move") return;
    await rename(sourceDir, parked); await mkdir(sourceDir); await rename(path.join(parked, "lifecycle.jar"), path.join(sourceDir, "lifecycle.jar"));
  });
  const listing = await f.inventory.read(f.adapter.serverId, f.serverRoot, "paper");
  const operation = await f.service.mutate(f.adapter.serverId, addonOpaqueId(f.adapter.serverId, "plugin", "lifecycle.jar"), "enable", listing.revision, randomUUID());
  expect((await settle(f, operation.id)).state).toBe("interrupted");
  expect(await readFile(path.join(sourceDir, "lifecycle.jar"))).toEqual(f.bytes);
  await expect(readFile(path.join(f.serverRoot, "plugins", "lifecycle.jar"))).rejects.toMatchObject({ code: "ENOENT" });
  const sourceStat = await stat(path.join(sourceDir, "lifecycle.jar"));
  expect(sourceStat.nlink).toBe(1);
  expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
});
