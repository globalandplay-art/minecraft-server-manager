import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { BackupService } from "../src/services/backup-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";

const roots: string[] = [];
const now = new Date("2026-09-30T00:00:00.000Z");

async function fixture(running = false, availableBytes?: (directory: string) => Promise<number>, type: "vanilla" | "paper" | "fabric" = "vanilla") {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-backup-"));
  roots.push(parent);
  const managerRoot = path.join(parent, "manager");
  const serverRoot = path.join(parent, "server");
  await mkdir(managerRoot);
  await mkdir(path.join(serverRoot, "world", "region"), { recursive: true });
  await writeFile(path.join(serverRoot, "server.properties"), "level-name=world\n");
  await writeFile(path.join(serverRoot, "eula.txt"), "eula=true\n");
  await writeFile(path.join(serverRoot, "server.jar"), "server jar fixture");
  await writeFile(path.join(serverRoot, "world", "level.dat"), "world data fixture");
  await writeFile(path.join(serverRoot, "world", "region", "r.0.0.mca"), "region fixture");

  let state: "running" | "stopped" = running ? "running" : "stopped";
  const stop = vi.fn(async () => { state = "stopped"; });
  const start = vi.fn(async () => { state = "running"; });
  const adapter = {
    mode: "local",
    serverId: "vanilla-test",
    plan: {
      rootPath: serverRoot,
      jarPath: path.join(serverRoot, "server.jar"),
      eulaAccepted: true,
      serverInfo: { type, minecraftVersion: "1.21.1" }
    },
    getStatus: async () => ({
      state,
      ownership: state === "running" ? "managed" : "none",
      source: "process",
      observedAt: now.toISOString(),
      activeOperationId: null,
      recoveryRequired: false
    }),
    getCapabilities: async () => ({ backup: true }),
    stop,
    start,
    revalidateBeforeStart: async () => {}
  } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]);
  const journal = new TransactionJournalStore(managerRoot);
  await journal.initialize();
  const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date(now) }, journal);
  await operations.initialize();
  const backups = new BackupService(registry, operations, journal, managerRoot, { now: () => new Date(now) }, availableBytes);
  return { managerRoot, serverRoot, adapter, stop, start, operations, backups, journal };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function waitForCompletion(operations: OperationService, id: string) {
  await vi.waitFor(() => expect(operations.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u));
  return operations.get(id)!;
}

describe("BackupService manual snapshots", () => {
  it.each(["paper", "fabric"] as const)("creates a complete private pinned %s addon protection snapshot", async (type) => {
    const f = await fixture(false, undefined, type);
    const enabled = type === "paper" ? "plugins" : "mods";
    const disabled = type === "paper" ? "disabled-plugins" : "disabled-mods";
    for (const folder of [enabled, disabled, "config", type === "paper" ? ".paper" : ".fabric", "libraries", "versions", "world", "trash", "plugins-archive"]) {
      await mkdir(path.join(f.serverRoot, folder), { recursive: true });
      await writeFile(path.join(f.serverRoot, folder, folder === enabled ? "addon.jar" : "state.txt"), `fixture:${folder}`);
    }
    await mkdir(path.join(f.serverRoot, "world", "dimensions", "minecraft", "the_nether"), { recursive: true });
    await writeFile(path.join(f.serverRoot, "world", "dimensions", "minecraft", "the_nether", "level.dat"), "nether world state");
    const guard = await f.backups.createAddonProtectionSnapshot({
      operationId: "423e4567-e89b-42d3-a456-426614174000", signal: new AbortController().signal,
      onStep: async () => {}, onResult: async () => {}
    }, "vanilla-test", type);
    const manifest = await f.backups.privateSnapshot("vanilla-test", guard.id);
    expect(manifest).toMatchObject({ id: guard.id, scope: "server-snapshot", pinned: true, serverType: type });
    expect(manifest.includedRoots).toEqual((await readdir(f.serverRoot)).sort());
    expect(manifest.files.map((item) => item.path)).toContain(`${enabled}/addon.jar`);
    expect(manifest.files.map((item) => item.path)).toContain("world/dimensions/minecraft/the_nether/level.dat");
    expect(manifest.files.map((item) => item.path)).toContain("trash/state.txt");
    expect(manifest.checksumSha256).toBe(guard.checksumSha256);
    await expect(f.backups.exportSource("vanilla-test", guard.id)).rejects.toMatchObject({ code: "EXPORT_NOT_SUPPORTED" });
  });

  it("creates a stopped world-set with all dimension files and a verified manifest", async () => {
    const fixtureState = await fixture();
    for (const dimension of ["DIM-1", "DIM1"]) {
      await mkdir(path.join(fixtureState.serverRoot, "world", dimension, "region"), { recursive: true });
      await writeFile(path.join(fixtureState.serverRoot, "world", dimension, "region", "r.0.0.mca"), dimension + " saved region");
    }
    const operation = await fixtureState.backups.create("vanilla-test", {
      scope: "world-set", allowStop: false, label: "Before changes"
    }, "123e4567-e89b-42d3-a456-426614174000");
    const completed = await waitForCompletion(fixtureState.operations, operation.id);

    expect(completed.state).toBe("succeeded");
    expect(fixtureState.stop).not.toHaveBeenCalled();
    expect(fixtureState.start).not.toHaveBeenCalled();
    const [backup] = await fixtureState.backups.list("vanilla-test");
    expect(backup).toMatchObject({ scope: "world-set", kind: "manual", label: "Before changes", state: "complete" });
    const payload = path.join(fixtureState.managerRoot, "backups", "vanilla-test", backup!.id, "payload", "world");
    expect(await readFile(path.join(payload, "region", "r.0.0.mca"), "utf8")).toBe("region fixture");
    expect(backup!.fileCount).toBe(4);
    for (const dimension of ["DIM-1", "DIM1"]) {
      expect(await readFile(path.join(payload, dimension, "region", "r.0.0.mca"), "utf8")).toBe(dimension + " saved region");
    }
    expect(backup!.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("requires explicit stop permission and restarts an originally running server", async () => {
    const fixtureState = await fixture(true);
    await expect(fixtureState.backups.create("vanilla-test", {
      scope: "world-set", allowStop: false
    }, "223e4567-e89b-42d3-a456-426614174000")).rejects.toMatchObject({
      code: "SERVER_MUST_BE_STOPPED", reason: "allow-stop-required"
    });

    const operation = await fixtureState.backups.create("vanilla-test", {
      scope: "world-set", allowStop: true
    }, "323e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(fixtureState.operations, operation.id)).state).toBe("succeeded");
    expect(fixtureState.stop).toHaveBeenCalledTimes(1);
    expect(fixtureState.start).toHaveBeenCalledTimes(1);
    expect(await fixtureState.backups.list("vanilla-test")).toMatchObject([
      { wasRunning: true, restarted: true, scope: "world-set" }
    ]);
  });

  it("keeps a completed world archive when restart fails", async () => {
    const fixtureState = await fixture(true);
    vi.spyOn(fixtureState.adapter, "start").mockRejectedValue(new Error("synthetic start failure"));
    const operation = await fixtureState.backups.create("vanilla-test", {
      scope: "world-set", allowStop: true
    }, "623e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(fixtureState.operations, operation.id)).state).toBe("interrupted");
    expect(await fixtureState.backups.list("vanilla-test")).toMatchObject([
      { state: "complete", wasRunning: true, restarted: false }
    ]);
  });

  it.each([
    { state: "unknown", ownership: "managed", recoveryRequired: false },
    { state: "running", ownership: "external", recoveryRequired: false },
    { state: "stopped", ownership: "managed", recoveryRequired: false },
    { state: "stopped", ownership: "none", recoveryRequired: true }
  ])("revalidates changed execution status before journaling or copying: %s", async (changed) => {
    const f = await fixture(true);
    const original = await f.adapter.getStatus();
    vi.spyOn(f.adapter, "getStatus").mockResolvedValueOnce(original).mockResolvedValue({ ...original, ...changed } as never);
    const op = await f.backups.create("vanilla-test", { scope: "world-set", allowStop: true }, "a23e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(f.operations, op.id)).error?.code).toBe("ACTION_UNAVAILABLE");
    expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(await f.backups.list("vanilla-test")).toEqual([]);
    expect(f.operations.getServerState("vanilla-test").recoveryRequired).toBe(false);
  });

  it.each(["running", "unknown"])("does not copy or restart when stop is unconfirmed: %s", async (state) => {
    const f = await fixture(true); const original = await f.adapter.getStatus();
    vi.spyOn(f.adapter, "getStatus").mockResolvedValueOnce(original).mockResolvedValueOnce(original)
      .mockResolvedValue({ ...original, state } as never);
    const op = await f.backups.create("vanilla-test", { scope: "world-set", allowStop: true }, "b23e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(f.operations, op.id)).state).toBe("interrupted");
    expect(f.stop).toHaveBeenCalledTimes(1); expect(f.start).not.toHaveBeenCalled();
    expect(await f.backups.list("vanilla-test")).toEqual([]);
    expect(f.operations.getServerState("vanilla-test").recoveryRequired).toBe(true);
  });

  it("rechecks stop permission when a stopped preflight changes to running", async () => {
    const f = await fixture(); const original = await f.adapter.getStatus();
    vi.spyOn(f.adapter, "getStatus").mockResolvedValueOnce(original)
      .mockResolvedValue({ ...original, state: "running", ownership: "managed" });
    const op = await f.backups.create("vanilla-test", { scope: "world-set", allowStop: false }, "d23e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(f.operations, op.id)).error?.code).toBe("SERVER_MUST_BE_STOPPED");
    expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(await f.backups.list("vanilla-test")).toEqual([]);
  });

  it("checks status again immediately before copying an originally stopped world", async () => {
    const f = await fixture(); const original = await f.adapter.getStatus();
    vi.spyOn(f.adapter, "getStatus").mockResolvedValueOnce(original).mockResolvedValueOnce(original)
      .mockResolvedValue({ ...original, state: "unknown", ownership: "managed" });
    const op = await f.backups.create("vanilla-test", { scope: "world-set", allowStop: false }, "e23e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(f.operations, op.id)).state).toBe("interrupted");
    expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(await f.backups.list("vanilla-test")).toEqual([]);
    expect(f.operations.getServerState("vanilla-test").recoveryRequired).toBe(true);
  });

  it("does not restart when copying fails after confirmed stop; retains recovery journal", async () => {
    const f = await fixture(true);
    f.stop.mockImplementation(async () => {
      await symlink(f.managerRoot, path.join(f.serverRoot, "world", "linked-after-stop"), process.platform === "win32" ? "junction" : "dir");
    });
    const original = await f.adapter.getStatus();
    vi.spyOn(f.adapter, "getStatus").mockResolvedValueOnce(original).mockResolvedValueOnce(original)
      .mockResolvedValue({ ...original, state: "stopped", ownership: "none" });
    const op = await f.backups.create("vanilla-test", { scope: "world-set", allowStop: true }, "c23e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(f.operations, op.id)).state).toBe("interrupted");
    expect(f.start).not.toHaveBeenCalled(); expect(await f.backups.list("vanilla-test")).toEqual([]);
    expect(f.operations.getServerState("vanilla-test").recoveryRequired).toBe(true);
    const scan = await f.journal.scan();
    expect(scan.records).toHaveLength(1);
    expect(scan.records[0]!.state).toBe("recovery-required");
    expect(scan.recoveryServerIds.has("vanilla-test")).toBe(true);
  });

  it("keeps server snapshots private and pinned", async () => {
    const fixtureState = await fixture();
    const operation = await fixtureState.backups.create("vanilla-test", {
      scope: "server-snapshot", allowStop: false, label: "Before upgrade"
    }, "723e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(fixtureState.operations, operation.id)).state).toBe("succeeded");
    const [snapshot] = await fixtureState.backups.list("vanilla-test");
    expect(snapshot).toMatchObject({ kind: "snapshot", pinned: true, label: "Before upgrade" });
    expect(snapshot!.includedRoots).toContain("server.properties");
  });

  it("checks free space before attempting to stop or copy", async () => {
    const fixtureState = await fixture(true, async () => 1);
    const operation = await fixtureState.backups.create("vanilla-test", {
      scope: "world-set", allowStop: true
    }, "923e4567-e89b-42d3-a456-426614174000");
    const finished = await waitForCompletion(fixtureState.operations, operation.id);
    expect(finished.state).toBe("failed");
    expect(finished.error?.code).toBe("BACKUP_STORAGE_LOW");
    expect(fixtureState.stop).not.toHaveBeenCalled();
    expect(fixtureState.start).not.toHaveBeenCalled();
  });

  it("lists a valid manifest larger than the former 8 MiB read limit", async () => {
    const fixtureState = await fixture();
    const id = "823e4567-e89b-42d3-a456-426614174000";
    const files = Array.from({ length: 80_000 }, (_, index) => ({
      path: `world/region/r-${index.toString().padStart(6, "0")}.mca`, sizeBytes: 0, sha256: "0".repeat(64)
    }));
    const checksumSha256 = createHash("sha256").update(files.map((file) =>
      `${file.path}\0${file.sizeBytes}\0${file.sha256}`).join("\n")).digest("hex");
    const root = path.join(fixtureState.managerRoot, "backups", "vanilla-test", id);
    await mkdir(root, { recursive: true });
    const manifest = {
      schemaVersion: 1, id, serverId: "vanilla-test", scope: "world-set", kind: "manual", label: null,
      state: "complete", pinned: false, createdAt: now.toISOString(), minecraftVersion: null,
      serverType: "vanilla", includedRoots: ["world"], fileCount: files.length, sizeBytes: 0,
      checksumSha256, wasRunning: false, restarted: false, downtimeMs: null, files
    };
    const serialized = JSON.stringify(manifest);
    expect(Buffer.byteLength(serialized)).toBeGreaterThan(8 * 1024 * 1024);
    await writeFile(path.join(root, "manifest.json"), serialized);
    expect(await fixtureState.backups.list("vanilla-test")).toMatchObject([{ id, fileCount: 80_000 }]);
  });

  it.each([false, true])("rejects a pre-existing hardlinked world file before stop, journal or publication (running=%s)", async (running) => {
    const f = await fixture(running);
    const outside = path.join(f.managerRoot, "outside-sentinel.bin");
    const sentinel = "private file outside registered world";
    await writeFile(outside, sentinel);
    const region = path.join(f.serverRoot, "world", "region", "r.0.0.mca");
    await rm(region);
    await link(outside, region);
    const operation = await f.backups.create("vanilla-test", { scope: "world-set", allowStop: true },
      "723e4567-e89b-42d3-a456-426614174000");
    const result = await waitForCompletion(f.operations, operation.id);
    expect(result).toMatchObject({ state: "failed", error: { code: "BACKUP_LAYOUT_UNSAFE" } });
    expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(await f.backups.list("vanilla-test")).toEqual([]);
    expect((await f.journal.scan()).records).toEqual([]);
    expect(f.operations.getServerState("vanilla-test").recoveryRequired).toBe(false);
    expect(await readFile(outside, "utf8")).toBe(sentinel);
  });

  it("retains recovery evidence if a source gains a hardlink after authorized stop", async () => {
    const f = await fixture(true);
    const outside = path.join(f.managerRoot, "outside-after-stop.bin");
    f.stop.mockImplementation(async () => {
      await link(path.join(f.serverRoot, "world", "region", "r.0.0.mca"), outside);
    });
    const original = await f.adapter.getStatus();
    vi.spyOn(f.adapter, "getStatus").mockResolvedValueOnce(original).mockResolvedValueOnce(original)
      .mockResolvedValue({ ...original, state: "stopped", ownership: "none" });
    const operation = await f.backups.create("vanilla-test", { scope: "world-set", allowStop: true },
      "823e4567-e89b-42d3-a456-426614174000");
    expect((await waitForCompletion(f.operations, operation.id)).state).toBe("interrupted");
    expect(f.start).not.toHaveBeenCalled(); expect(await f.backups.list("vanilla-test")).toEqual([]);
    expect(f.operations.getServerState("vanilla-test").recoveryRequired).toBe(true);
    expect((await f.journal.scan()).records).toMatchObject([{ state: "recovery-required" }]);
    expect(await readFile(outside, "utf8")).toBe("region fixture");
  });

  it("refuses linked world roots before journaling or requiring recovery", async () => {
    const fixtureState = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), "mcsm-backup-outside-"));
    roots.push(outside);
    await writeFile(path.join(outside, "level.dat"), "outside");
    await rm(path.join(fixtureState.serverRoot, "world"), { recursive: true });
    await symlink(outside, path.join(fixtureState.serverRoot, "world"), process.platform === "win32" ? "junction" : "dir");
    const operation = await fixtureState.backups.create("vanilla-test", {
      scope: "world-set", allowStop: false
    }, "423e4567-e89b-42d3-a456-426614174000");

    expect((await waitForCompletion(fixtureState.operations, operation.id)).state).toBe("failed");
    await expect(fixtureState.operations.requestLifecycle(
      "vanilla-test", "start", "523e4567-e89b-42d3-a456-426614174000", async () => {}
    )).resolves.toMatchObject({ kind: "start" });
    expect(await fixtureState.backups.list("vanilla-test")).toEqual([]);
  });
});
