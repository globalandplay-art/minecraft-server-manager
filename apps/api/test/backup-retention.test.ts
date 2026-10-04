import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupInfo } from "@mcsm/contracts";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { BackupService } from "../src/services/backup-service.js";
import { BackupRetentionService } from "../src/services/backup-retention-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(inject?: (point: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-retention-")); roots.push(root);
  const manager = path.join(root, "manager"), server = path.join(root, "server"); await mkdir(manager);
  await mkdir(path.join(server, "world", "DIM-1"), { recursive: true }); await mkdir(path.join(server, "world", "DIM1"));
  await writeFile(path.join(server, "server.properties"), "level-name=world\n");
  for (const file of ["level.dat", "DIM-1/marker", "DIM1/marker"]) await writeFile(path.join(server, "world", file), file);
  let time = Date.parse("2026-10-01T00:00:00.000Z"); const clock = { now: () => new Date(time) };
  const state = { state: "stopped", ownership: "none", recoveryRequired: false };
  const adapter = { serverId: "test", mode: "local", plan: { rootPath: server, serverInfo: { type: "vanilla" } },
    getStatus: async () => state, getCapabilities: async () => ({ backup: true }) } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(manager); await journal.initialize();
  const operations = new OperationService(new MemoryOperationStore(), clock, journal); await operations.initialize();
  const backups = new BackupService(registry, operations, journal, manager, clock);
  const make = (hook = inject) => new BackupRetentionService(registry, operations, backups, journal, manager, clock, hook);
  const service = make();
  const backup = async (origin: "manual" | "auto" = "manual") => {
    const operation = await backups.create("test", { scope: "world-set", allowStop: false }, randomUUID(), origin);
    await vi.waitFor(() => expect(operations.get(operation.id)?.state).toBe("succeeded"));
    return (await backups.list("test")).find((entry) => entry.id === operations.get(operation.id)!.result!.resourceId)!;
  };
  const enable = async (settings = {}) => service.update("test", { revision: (await service.get("test")).revision,
    settings: { enabled: true, retainCount: 1, retainDays: 1, ...settings } });
  const run = async (target = service) => target.run("test", { revision: (await target.get("test")).revision, intent: "apply-backup-retention" });
  const directory = (backup: BackupInfo) => path.join(manager, "backups", "test", backup.id);
  return { root, manager, server, service, make, operations, journal, backups, state, backup, enable, run, directory,
    advance: (days: number) => { time += days * 86_400_000; } };
}
describe("union retention only removes verified unreferenced backup trees", () => {
  it("defaults off; passing time alone never deletes anything", async () => {
    const f = await fixture(), a = await f.backup(); f.advance(40);
    expect((await f.service.get("test")).settings.enabled).toBe(false); await f.run();
    expect(await readFile(path.join(f.directory(a), "payload", "world", "level.dat"), "utf8")).toBe("level.dat");
  });
  it("keeps the union of latest count and recent age, deletes only older eligible snapshots", async () => {
    const f = await fixture(), a = await f.backup(); f.advance(1); const b = await f.backup("auto"); f.advance(1); const c = await f.backup(); f.advance(8);
    await f.enable({ retainDays: 9 }); const result = await f.run();
    expect(result.lastRun).toMatchObject({ state: "completed", removed: [a.id] });
    expect((await f.backups.list("test")).map((backup) => backup.id).sort()).toEqual([b.id, c.id].sort());
    const receipt = JSON.parse(await readFile(path.join(f.manager, "backup-retention", "test", `${a.id}.json`), "utf8")); expect(receipt.state).toBe("deleted");
  });
  it.each(["pinned", "legacy", "referenced", "future", "owner-changed", "extra-file", "hardlink", "junction"])("retains %s data and never touches external/world sentinels", async (mode) => {
    const f = await fixture(), a = await f.backup(); f.advance(1); await f.backup(); f.advance(30); await f.enable();
    const dir = f.directory(a), manifestFile = path.join(dir, "manifest.json");
    if (mode === "pinned" || mode === "future") {
      const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
      if (mode === "pinned") manifest.pinned = true; else manifest.createdAt = "2099-01-01T00:00:00.000Z";
      await writeFile(manifestFile, JSON.stringify(manifest));
    }
    if (mode === "legacy") await rm(path.join(dir, "owner.json"));
    if (mode === "owner-changed") { const owner = JSON.parse(await readFile(path.join(dir, "owner.json"), "utf8")); owner.rootIdentity = "0".repeat(64); await writeFile(path.join(dir, "owner.json"), JSON.stringify(owner)); }
    if (mode === "referenced") {
      const record = await f.journal.createIntent({ operationId: randomUUID(), serverId: "test", kind: "backup", scope: "world-set", resourceId: randomUUID(), allowStop: false,
        originalState: "stopped", createdAt: "2026-10-01T00:00:00.000Z", paths: [{ role: "source", relativePath: `backups/test/${a.id}` }] });
      await f.journal.setState("test", record.transactionId, "committed", "2026-10-01T00:00:00.000Z");
    }
    if (mode === "extra-file") await writeFile(path.join(dir, "unknown"), "preserve");
    const outside = path.join(f.root, "outside"); await mkdir(outside); const sentinel = path.join(outside, "sentinel"); await writeFile(sentinel, "external");
    if (mode === "hardlink") { const file = path.join(dir, "payload", "world", "level.dat"); await rm(file); await link(sentinel, file); }
    if (mode === "junction") await symlink(outside, path.join(dir, "payload", "world", "linked"), process.platform === "win32" ? "junction" : "dir");
    const result = await f.run(); expect(result.lastRun!.removed).not.toContain(a.id);
    expect(await readFile(sentinel, "utf8")).toBe("external"); expect(await readFile(path.join(f.server, "world", "level.dat"), "utf8")).toBe("level.dat");
  });
  it.each(["root-changed", "recovery", "running"])("does not clean %s state", async (mode) => {
    const f = await fixture(); await f.backup(); f.advance(1); await f.backup(); f.advance(20); await f.enable();
    if (mode === "root-changed") { await rename(f.server, f.server + "-old"); await mkdir(f.server); await expect(f.run()).rejects.toMatchObject({ code: "RETENTION_STATE_UNSAFE" }); }
    if (mode === "recovery") { f.operations.requireRecovery(["test"]); await expect(f.run()).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" }); }
    if (mode === "running") { f.state.state = "running"; f.state.ownership = "managed"; expect((await f.run()).lastRun).toMatchObject({ state: "blocked", code: "RETENTION_RUNTIME_UNSAFE", removed: [] }); }
    expect(await f.backups.list("test")).toHaveLength(2);
  });
  it("a new reference introduced after intent is preserved before any unlink", async () => {
    const f = await fixture(), a = await f.backup(); f.advance(1); await f.backup(); f.advance(20); await f.enable();
    let referenceInstalled = false;
    const hooked = f.make(async (point) => { if (point === "after-intent") {
      const record = await f.journal.createIntent({ operationId: randomUUID(), serverId: "test", kind: "backup", scope: "world-set", resourceId: randomUUID(), allowStop: false,
        originalState: "stopped", createdAt: "2026-10-01T00:00:00.000Z", paths: [{ role: "source", relativePath: `backups/test/${a.id}` }] });
      await f.journal.setState("test", record.transactionId, "committed", "2026-10-01T00:00:00.000Z");
      referenceInstalled = true;
    } });
    expect((await f.run(hooked)).lastRun!.removed).toEqual([]);
    expect(referenceInstalled).toBe(true);
    expect(await readFile(path.join(f.directory(a), "payload", "world", "level.dat"), "utf8")).toBe("level.dat");
  });
  it("partial deletion keeps durable receipt and is never automatically resumed after restart", async () => {
    const f = await fixture(), a = await f.backup(); f.advance(1); await f.backup(); f.advance(20); await f.enable();
    const hooked = f.make(async (point) => { if (point === "after-entry") throw new Error("INJECTED_RETENTION_INTERRUPTION"); });
    expect((await f.run(hooked)).lastRun).toMatchObject({ state: "partial", removed: [] });
    const file = path.join(f.manager, "backup-retention", "test", `${a.id}.json`), receipt = await readFile(file, "utf8");
    await f.run(f.make()); expect(await readFile(file, "utf8")).toBe(receipt);
    expect((await f.service.get("test")).lastRun).toMatchObject({ state: "partial", code: "RETENTION_INSPECTION_REQUIRED" });
    expect(await readFile(path.join(f.server, "world", "DIM-1", "marker"), "utf8")).toBe("DIM-1/marker");
  });
  it("keeps cleanup failure visible when manifest was already removed", async () => {
    const f = await fixture(), a = await f.backup(); f.advance(1); await f.backup(); f.advance(20); await f.enable();
    const hooked = f.make(async (point) => { if (point === "after-entry") {
      try { await readFile(path.join(f.directory(a), "manifest.json")); }
      catch { throw new Error("INJECTED_AFTER_MANIFEST_UNLINK"); }
    } });
    expect((await f.run(hooked)).lastRun!.state).toBe("partial");
    const result = await f.run(f.make());
    expect(result.lastRun).toMatchObject({ state: "partial", retained: expect.arrayContaining([{ id: a.id, reason: "cleanup-receipt-inspection-required" }]) });
    expect(await f.backups.list("test")).toHaveLength(1);
  });
  it("runs only after a newly successful backup, with no startup cleanup", async () => {
    const f = await fixture(), a = await f.backup(); f.advance(20); await f.enable(); f.service.start();
    expect(await f.backups.list("test")).toHaveLength(1); await f.backup();
    await vi.waitFor(async () => expect((await f.service.get("test")).lastRun?.removed).toContain(a.id)); await f.service.close();
  });
  it("rejects stale revisions and refuses overlapping maintenance under the instance lease", async () => {
    const f = await fixture(), old = await f.service.get("test"); await f.enable();
    await expect(f.service.update("test", { revision: old.revision, settings: old.settings })).rejects.toMatchObject({ code: "RETENTION_REVISION_CONFLICT" });
    await f.operations.runExclusive("test", async () => { await expect(f.run()).rejects.toMatchObject({ code: "OPERATION_CONFLICT" }); });
  });
});
