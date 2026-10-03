import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { cp, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import type { RuntimeEvent } from "../src/infra/runtime-contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { BackupService } from "../src/services/backup-service.js";
import { RestoreService } from "../src/services/restore-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { buildApp } from "../src/app.js";
import * as restoreFiles from "../src/services/restore-files.js";
import { DomainError } from "../src/services/domain-errors.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-10-02T00:00:00Z") };
function str(value: string): Buffer {
  const bytes = Buffer.from(value); const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length, bytes]);
}
function tag(kind: number, name: string, bytes: Buffer): Buffer { return Buffer.concat([Buffer.from([kind]), str(name), bytes]); }
function compound(name: string, children: Buffer[]): Buffer { return tag(10, name, Buffer.concat([...children, Buffer.from([0])])); }
function level(version = "1.21.1", marker = "original"): Buffer {
  return gzipSync(Buffer.concat([Buffer.from([10]), str(""), compound("Data", [
    compound("Version", [tag(8, "Name", str(version))]), tag(8, "LevelName", str(marker))
  ]), Buffer.from([0])]));
}
async function complete(ops: OperationService, id: string) {
  await vi.waitFor(() => expect(ops.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u), { timeout: 10_000 });
  return ops.get(id)!;
}
async function fixture(inject?: (point: string) => Promise<void>) {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-restore-")); roots.push(parent);
  const manager = path.join(parent, "manager"); const server = path.join(parent, "server");
  await mkdir(manager); await mkdir(path.join(server, "world"), { recursive: true });
  await writeFile(path.join(server, "server.properties"), "level-name=world\nrcon.password=PRIVATE_SENTINEL\n");
  await writeFile(path.join(server, "eula.txt"), "eula=true\n"); await writeFile(path.join(server, "server.jar"), "fixture");
  await writeFile(path.join(server, "world", "level.dat"), level());
  for (const dimension of ["region", "DIM-1/region", "DIM1/region", "dimensions/minecraft/the_end/region", "players/data"]) {
    await mkdir(path.join(server, "world", dimension), { recursive: true });
    await writeFile(path.join(server, "world", dimension, "fixture.dat"), "backup:" + dimension);
  }
  let state = "stopped"; let ownership = "none"; let uncertain = false;
  const stop = vi.fn(async () => { state = "stopped"; ownership = "none"; uncertain = false; });
  const start = vi.fn(async () => { state = "running"; ownership = "managed"; });
  const stopOwnedForRecovery = vi.fn(async () => { await stop(); });
  const listeners = new Set<(event: RuntimeEvent) => void>();
  const getLogs = vi.fn(async () => ({ items: [], nextCursor: null, gap: false }));
  const adapter = { mode: "local", serverId: "vanilla-test", plan: { rootPath: server, jarPath: path.join(server, "server.jar"), eulaAccepted: true,
    serverInfo: { type: "vanilla", minecraftVersion: "1.21.1" } },
    getStatus: async () => ({ state, ownership, recoveryRequired: uncertain, source: "process", observedAt: clock.now().toISOString(), activeOperationId: null }),
    getCapabilities: async () => ({ backup: true }), start, stop, stopOwnedForRecovery, revalidateBeforeStart: async () => {},
    getLogs, subscribe: (listener: (event: RuntimeEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); }, closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]); const journal = new TransactionJournalStore(manager);
  const store = new MemoryOperationStore(); const ops = new OperationService(store, clock, journal); await ops.initialize();
  const backups = new BackupService(registry, ops, journal, manager, clock);
  const backupOp = await backups.create(adapter.serverId, { scope: "world-set", allowStop: false }, randomUUID());
  expect((await complete(ops, backupOp.id)).state).toBe("succeeded");
  const [backup] = await backups.list(adapter.serverId);
  await writeFile(path.join(server, "world", "region", "fixture.dat"), "current-world");
  await writeFile(path.join(server, "world", "level.dat"), level("1.21.1", "current"));
  const restores = new RestoreService(registry, ops, backups, journal, manager, clock, inject);
  const plan = await restores.plan(adapter.serverId, backup!.id);
  const body = { restoreScope: "world-set" as const, confirmWorldName: "world", worldRevision: plan.worldRevision, allowStop: true as const, startAfterRestore: false };
  return { parent, manager, server, adapter, registry, journal, ops, store, backups, backup: backup!, restores, body, start, stop, stopOwnedForRecovery, getLogs,
    emit: (event: RuntimeEvent) => { for (const listener of listeners) listener(event); },
    setState: (s: string, o = s === "running" ? "managed" : "none", r = false) => { state = s; ownership = o; uncertain = r; } };
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("P3.2 stopped-world transactions", () => {
  it("restores all dimensions, pins a guard, preserves configuration and explicitly rolls back", async () => {
    const f = await fixture(); const before = await readFile(path.join(f.server, "server.properties"));
    const key = randomUUID(); const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, key);
    const result = await complete(f.ops, op.id);
    expect(result).toMatchObject({ state: "succeeded", result: { rollbackAvailable: true } });
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
    expect(await readFile(path.join(f.server, "world", "region", "fixture.dat"), "utf8")).toBe("backup:region");
    expect(await readFile(path.join(f.server, "world", "DIM-1", "region", "fixture.dat"), "utf8")).toBe("backup:DIM-1/region");
    expect(await readFile(path.join(f.server, "server.properties"))).toEqual(before);
    const guard = (await f.backups.list(f.adapter.serverId)).find((b) => b.id === result.result!.resourceId)!;
    expect(guard).toMatchObject({ pinned: true, scope: "world-set", label: "Before Restore" });
    expect((await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, key)).id).toBe(op.id);
    await expect(f.restores.restore(f.adapter.serverId, f.backup.id, { ...f.body, startAfterRestore: true }, key)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    const plan = await f.restores.rollbackPlan(f.adapter.serverId, op.id);
    const rbkey = randomUUID(); const rbbody = { confirmWorldName: "world", worldRevision: plan.worldRevision, startAfterRollback: false };
    const rollback = await f.restores.rollback(f.adapter.serverId, op.id, rbbody, rbkey);
    expect((await complete(f.ops, rollback.id)).state).toBe("succeeded");
    expect(await readFile(path.join(f.server, "world", "region", "fixture.dat"), "utf8")).toBe("current-world");
    expect(f.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect((await f.restores.rollback(f.adapter.serverId, op.id, rbbody, rbkey)).id).toBe(rollback.id);
    expect((await f.restores.history(f.adapter.serverId)).items).toMatchObject([{ state: "rolled-back", rollbackAvailable: false }]);
  });

  it("revises after an authorized stop save and only starts with explicit consent", async () => {
    const f = await fixture(); f.setState("running");
    f.stop.mockImplementation(async () => { f.setState("stopped"); await writeFile(path.join(f.server, "world", "level.dat"), level("1.21.1", "saved-by-stop")); });
    const op = await f.restores.restore(f.adapter.serverId, f.backup.id, { ...f.body, startAfterRestore: true }, randomUUID());
    expect((await complete(f.ops, op.id)).state).toBe("succeeded"); expect(f.start).toHaveBeenCalledOnce(); expect(f.stop).toHaveBeenCalledOnce();
  });

  it.each(["wrong-name", "stale-revision", "version", "external", "unknown"])("rejects %s before journaling or writes", async (reason) => {
    const f = await fixture(); let body = f.body;
    if (reason === "wrong-name") body = { ...body, confirmWorldName: "other" };
    if (reason === "stale-revision") await writeFile(path.join(f.server, "world", "level.dat"), level("1.21.1", "changed"));
    if (reason === "version") await writeFile(path.join(f.server, "world", "level.dat"), level("1.22"));
    if (reason === "external") f.setState("running", "external");
    if (reason === "unknown") f.setState("unknown", "unknown");
    await expect(f.restores.restore(f.adapter.serverId, f.backup.id, body, randomUUID())).rejects.toBeDefined();
    expect((await f.journal.scan()).records.filter((r) => r.intent.kind === "restore")).toHaveLength(0);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });

  it("rejects changed payload, foreign/private backup, and source-root escaping manifest", async () => {
    const f = await fixture();
    await writeFile(path.join(f.manager, "backups", f.adapter.serverId, f.backup.id, "payload", "world", "region", "fixture.dat"), "tampered");
    await expect(f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID())).rejects.toMatchObject({ code: "RESTORE_LAYOUT_UNSAFE" });
    const p = await f.backups.create(f.adapter.serverId, { scope: "server-snapshot", allowStop: false }, randomUUID()); await complete(f.ops, p.id);
    const snap = (await f.backups.list(f.adapter.serverId)).find((b) => b.scope === "server-snapshot")!;
    await expect(f.restores.plan(f.adapter.serverId, snap.id)).rejects.toMatchObject({ code: "EXPORT_NOT_SUPPORTED" });
  });

  it("rejects linked source entries and a junction without following external contents", async () => {
    const f = await fixture();
    const payload = path.join(f.manager, "backups", f.adapter.serverId, f.backup.id, "payload", "world");
    await link(path.join(payload, "level.dat"), path.join(f.parent, "hard-linked-level.dat"));
    await expect(f.restores.plan(f.adapter.serverId, f.backup.id)).rejects.toMatchObject({ code: "RESTORE_LAYOUT_UNSAFE" });
    const outside = path.join(f.parent, "external"); await mkdir(outside);
    await writeFile(path.join(outside, "private.txt"), "must not traverse");
    const junction = path.join(f.server, "world", "external-link");
    await symlink(outside, junction, process.platform === "win32" ? "junction" : "dir");
    await expect(restoreFiles.inventoryRestoreTree(path.join(f.server, "world"))).rejects.toMatchObject({ code: "RESTORE_LAYOUT_UNSAFE" });
    expect(await readFile(path.join(outside, "private.txt"), "utf8")).toBe("must not traverse");
  });

  it("fails low capacity without moving the current world or stopping its server", async () => {
    const f = await fixture(); f.setState("running");
    vi.spyOn(restoreFiles, "restoreCapacity").mockRejectedValue(new DomainError(507, "RESTORE_STORAGE_LOW", "空间不足"));
    const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID());
    expect((await complete(f.ops, op.id)).state).toBe("failed"); expect(f.stop).not.toHaveBeenCalled();
    expect(await readFile(path.join(f.server, "world", "region", "fixture.dat"), "utf8")).toBe("current-world");
  });

  it.each(["after:stop-intent", "before:guard-verified", "after:guard-verified", "before:staging-verified", "after:staging-verified",
    "before:move-old-intent", "after:move-old-intent", "before:rename-old", "after:rename-old", "after:old-moved",
    "before:install-new-intent", "after:install-new-intent", "before:rename-new", "after:rename-new", "after:new-installed", "before:commit"])("preserves failure %s, gates restart and rolls back after manager restart", async (point) => {
    const f = await fixture(async (p) => { if (p === point) throw new Error("injected crash boundary"); });
    const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID());
    expect((await complete(f.ops, op.id)).state).toBe("interrupted"); expect(f.start).not.toHaveBeenCalled();
    const scan = await f.journal.scan(); const parent = scan.records.find((r) => r.intent.operationId === op.id)!;
    expect(scan.recoveryServerIds.has(f.adapter.serverId)).toBe(true);
    const restarted = new OperationService(f.store, clock, new TransactionJournalStore(f.manager)); await restarted.initialize();
    expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    await expect(restarted.requestLifecycle(f.adapter.serverId, "start", randomUUID(), async () => {})).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    if (!parent.checkpoints.some((c) => c.name === "guard-verified")) {
      expect(await readFile(path.join(f.server, "world", "region", "fixture.dat"), "utf8")).toBe("current-world"); return;
    }
    const service = new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock);
    const plan = await service.rollbackPlan(f.adapter.serverId, op.id);
    const rb = await service.rollback(f.adapter.serverId, op.id, { confirmWorldName: "world", worldRevision: plan.worldRevision, startAfterRollback: false }, randomUUID());
    expect((await complete(restarted, rb.id)).state).toBe("succeeded");
    expect(await readFile(path.join(f.server, "world", "region", "fixture.dat"), "utf8")).toBe("current-world");
    expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });

  it("retains a failed launch and narrowly stops its own child", async () => {
    const f = await fixture(); f.start.mockImplementation(async () => { f.setState("unknown", "managed", true); throw new Error("failed spawn readiness"); });
    const op = await f.restores.restore(f.adapter.serverId, f.backup.id, { ...f.body, startAfterRestore: true }, randomUUID());
    expect((await complete(f.ops, op.id)).state).toBe("interrupted");
    expect(f.start).toHaveBeenCalledOnce(); expect(f.stopOwnedForRecovery).toHaveBeenCalledOnce();
    expect(f.stopOwnedForRecovery.mock.calls[0]?.[1]).toBe(op.id);
    expect((await f.restores.rollbackPlan(f.adapter.serverId, op.id)).rollbackAvailable).toBe(true);
  });

  it("does not release unrelated recovery gates", async () => {
    const f = await fixture(); const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, op.id);
    f.ops.requireRecovery([f.adapter.serverId]);
    await expect(f.restores.rollbackPlan(f.adapter.serverId, op.id)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "unrelated-recovery" });
  });

  it.each(["after:rename-old", "after:rename-new", "after:staging-verified", "before:commit"])("permits an explicit retry after interrupted rollback at %s", async (point) => {
    const f = await fixture(); const original = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, original.id);
    const faulty = new RestoreService(f.registry, f.ops, f.backups, f.journal, f.manager, clock, async (p) => { if (p === point) throw new Error("rollback injected interruption"); });
    const p = await faulty.rollbackPlan(f.adapter.serverId, original.id);
    const first = await faulty.rollback(f.adapter.serverId, original.id, { confirmWorldName: "world", worldRevision: p.worldRevision, startAfterRollback: false }, randomUUID());
    expect((await complete(f.ops, first.id)).state).toBe("interrupted");
    const restarted = new OperationService(f.store, clock, f.journal); await restarted.initialize();
    const service = new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock);
    const plan = await service.rollbackPlan(f.adapter.serverId, original.id);
    const retry = await service.rollback(f.adapter.serverId, original.id, { confirmWorldName: "world", worldRevision: plan.worldRevision, startAfterRollback: false }, randomUUID());
    expect((await complete(restarted, retry.id)).state).toBe("succeeded");
    expect(await readFile(path.join(f.server, "world", "region", "fixture.dat"), "utf8")).toBe("current-world");
    expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });

  it("reconciles rollback commit when parent finalization was interrupted", async () => {
    const f = await fixture(); const original = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, original.id);
    const faulty = new RestoreService(f.registry, f.ops, f.backups, f.journal, f.manager, clock, async (p) => { if (p === "after:rollback-commit") throw new Error("metadata interruption"); });
    const p = await faulty.rollbackPlan(f.adapter.serverId, original.id);
    const rb = await faulty.rollback(f.adapter.serverId, original.id, { confirmWorldName: "world", worldRevision: p.worldRevision, startAfterRollback: false }, randomUUID());
    await complete(f.ops, rb.id);
    const restarted = new OperationService(f.store, clock, new TransactionJournalStore(f.manager));
    await new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock).reconcileStartup();
    await restarted.initialize();
    expect(restarted.get(rb.id)?.state).toBe("succeeded"); expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect((await f.journal.scan()).records.find((r) => r.intent.operationId === original.id)?.state).toBe("rolled-back");
  });

  it.each(["sibling-first-interruption", "legacy-parent-first"])("reconciles %s without leaving an orphan recovery gate", async (mode) => {
    const f = await fixture();
    const original = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, original.id);
    const broken = new RestoreService(f.registry, f.ops, f.backups, f.journal, f.manager, clock, async (p) => { if (p === "after:rename-new") throw new Error("rollback interrupted"); });
    let plan = await broken.rollbackPlan(f.adapter.serverId, original.id);
    const first = await broken.rollback(f.adapter.serverId, original.id, { confirmWorldName: "world", worldRevision: plan.worldRevision, startAfterRollback: false }, randomUUID());
    await complete(f.ops, first.id);
    const scanBefore = await f.journal.scan(); const sibling = scanBefore.records.find((r) => r.intent.operationId === first.id)!;
    const finishing = new RestoreService(f.registry, f.ops, f.backups, f.journal, f.manager, clock, async (p) => {
      if (p === (mode === "sibling-first-interruption" ? "after:rollback-sibling-finalized" : "after:rollback-parent-finalized")) throw new Error("metadata write interrupted");
    });
    plan = await finishing.rollbackPlan(f.adapter.serverId, original.id);
    const second = await finishing.rollback(f.adapter.serverId, original.id, { confirmWorldName: "world", worldRevision: plan.worldRevision, startAfterRollback: false }, randomUUID());
    await complete(f.ops, second.id);
    if (mode === "legacy-parent-first") {
      // Recreate the old durable parent-first write window with its unresolved sibling.
      await writeFile(path.join(f.manager, "transactions", `${f.adapter.serverId}.${sibling.transactionId}.json`), JSON.stringify(sibling));
    }
    const restarted = new OperationService(f.store, clock, f.journal);
    await new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock).reconcileStartup(); await restarted.initialize();
    expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect(restarted.get(second.id)?.state).toBe("succeeded");
    expect((await f.journal.scan()).records.filter((r) => r.intent.kind === "rollback").map((r) => r.state)).not.toContain("recovery-required");
    await expect(restarted.requestLifecycle(f.adapter.serverId, "start", randomUUID(), async () => {})).resolves.toBeDefined();
  });

  it.each(["restore", "rollback"])("blocks %s launch when level-name changes at start-intent", async (kind) => {
    const f = await fixture();
    const drift = new RestoreService(f.registry, f.ops, f.backups, f.journal, f.manager, clock, async (p) => {
      if (p === "after:start-intent") await writeFile(path.join(f.server, "server.properties"), "level-name=unapproved-world\n");
    });
    let operation;
    if (kind === "restore") operation = await drift.restore(f.adapter.serverId, f.backup.id, { ...f.body, startAfterRestore: true }, randomUUID());
    else {
      const parent = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, parent.id);
      const plan = await drift.rollbackPlan(f.adapter.serverId, parent.id);
      operation = await drift.rollback(f.adapter.serverId, parent.id, { confirmWorldName: "world", worldRevision: plan.worldRevision, startAfterRollback: true }, randomUUID());
    }
    expect((await complete(f.ops, operation.id)).state).toBe("interrupted"); expect(f.start).not.toHaveBeenCalled();
    expect(f.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    await expect(readFile(path.join(f.server, "unapproved-world", "level.dat"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["error", "crash-signature", "post-ready-error", "post-ready-exit", "rollback-error"])("fails a launch with %s and keeps its guard and explicit rollback", async (failure) => {
    const f = await fixture();
    let parentId: string | undefined;
    if (failure === "rollback-error") {
      const parent = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, parent.id); parentId = parent.id;
    }
    const event = { type: "log", entry: { id: "new", cursor: "new", timestamp: null, level: failure === "crash-signature" ? "info" : "error", source: "latest.log", text: failure === "crash-signature" ? "This crash report has been saved" : "Cannot load saved data" } } as const;
    if (failure === "post-ready-error" || failure === "post-ready-exit") f.getLogs.mockImplementation(async () => {
      if (f.start.mock.calls.length) { if (failure === "post-ready-exit") f.setState("crashed"); else f.emit(event); }
      return { items: [], nextCursor: null, gap: false };
    });
    else f.start.mockImplementation(async () => { f.setState("running"); f.emit(event); });
    const plan = parentId ? await f.restores.rollbackPlan(f.adapter.serverId, parentId) : null;
    const op = parentId ? await f.restores.rollback(f.adapter.serverId, parentId, { confirmWorldName: "world", worldRevision: plan!.worldRevision, startAfterRollback: true }, randomUUID()) :
      await f.restores.restore(f.adapter.serverId, f.backup.id, { ...f.body, startAfterRestore: true }, randomUUID());
    expect((await complete(f.ops, op.id)).state).toBe("interrupted");
    if (failure === "post-ready-exit") expect(f.stopOwnedForRecovery).not.toHaveBeenCalled(); else expect(f.stopOwnedForRecovery).toHaveBeenCalledOnce();
    if (failure !== "post-ready-exit") expect((await f.restores.rollbackPlan(f.adapter.serverId, parentId ?? op.id)).rollbackAvailable).toBe(true);
    expect((await f.journal.scan()).records.find((r) => r.intent.operationId === op.id)?.checkpoints.map((c) => c.name)).not.toContain("start-verified");
  });

  it("ignores historical ERROR drained before the new launch", async () => {
    const f = await fixture();
    f.getLogs.mockImplementation(async () => {
      if (!f.start.mock.calls.length) f.emit({ type: "log", entry: { id: "old", cursor: "old", timestamp: null, level: "error", text: "Historical error", source: "latest.log" } });
      return { items: [], nextCursor: null, gap: false };
    });
    const op = await f.restores.restore(f.adapter.serverId, f.backup.id, { ...f.body, startAfterRestore: true }, randomUUID());
    expect((await complete(f.ops, op.id)).state).toBe("succeeded"); expect(f.stopOwnedForRecovery).not.toHaveBeenCalled();
  });

  it.each(["mismatched-tree", "external-process", "damaged-guard"])("does not finalize rollback metadata on startup with %s", async (failure) => {
    const f = await fixture(); const original = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, original.id);
    const faulty = new RestoreService(f.registry, f.ops, f.backups, f.journal, f.manager, clock, async (p) => { if (p === "after:rollback-commit") throw new Error("metadata interruption"); });
    const plan = await faulty.rollbackPlan(f.adapter.serverId, original.id);
    const rb = await faulty.rollback(f.adapter.serverId, original.id, { confirmWorldName: "world", worldRevision: plan.worldRevision, startAfterRollback: false }, randomUUID());
    await complete(f.ops, rb.id);
    if (failure === "mismatched-tree") await writeFile(path.join(f.server, "world", "region", "fixture.dat"), "unexpected durable layout");
    if (failure === "external-process") f.setState("running", "external");
    if (failure === "damaged-guard") await writeFile(path.join(f.manager, "backups", f.adapter.serverId, plan.backupId, "payload", "world", "level.dat"), "corrupt guard");
    const restarted = new OperationService(f.store, clock, f.journal);
    await new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock).reconcileStartup(); await restarted.initialize();
    expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    expect((await f.journal.scan()).records.find((r) => r.intent.operationId === original.id)?.state).not.toBe("rolled-back");
    expect(restarted.get(rb.id)).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
  });

  it("reconciles a committed restore when final operation persistence fails", async () => {
    const f = await fixture(); const save = f.store.save.bind(f.store);
    vi.spyOn(f.store, "save").mockImplementation(async (record) => { if (record.operation.kind === "restore" && ["succeeded", "interrupted"].includes(record.operation.state)) throw new Error("failed public outcome persistence"); await save(record); });
    const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID());
    await vi.waitFor(() => expect(f.ops.getServerState(f.adapter.serverId).activeOperationId).toBeNull());
    vi.restoreAllMocks(); const restarted = new OperationService(f.store, clock, f.journal);
    await new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock).reconcileStartup(); await restarted.initialize();
    expect(restarted.get(op.id)).toMatchObject({ state: "succeeded", result: { rollbackAvailable: true } });
    expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });

  it.each(["wrong-layout", "unknown-process", "external-process", "missing-source", "damaged-guard"])("gates an unconfirmed committed restore with %s", async (failure) => {
    const f = await fixture(); const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, op.id);
    const stored = (await f.store.list()).find((r) => r.operation.id === op.id)!;
    await f.store.save({ ...stored, operation: { ...stored.operation, state: "running", step: "switching-world" } });
    if (failure === "wrong-layout") await writeFile(path.join(f.server, "world", "region", "fixture.dat"), "rename not persisted");
    if (failure === "unknown-process") f.setState("unknown", "unknown", true);
    if (failure === "external-process") f.setState("running", "external");
    if (failure === "missing-source") await rm(path.join(f.manager, "backups", f.adapter.serverId, f.backup.id), { recursive: true });
    if (failure === "damaged-guard") await writeFile(path.join(f.manager, "backups", f.adapter.serverId, stored.operation.result!.resourceId!, "payload", "world", "level.dat"), "corrupt guard");
    const restarted = new OperationService(f.store, clock, f.journal);
    await new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock).reconcileStartup(); await restarted.initialize();
    expect(restarted.get(op.id)).toMatchObject({ state: "interrupted", error: { code: "RECOVERY_REQUIRED" } });
    expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    await expect(restarted.requestLifecycle(f.adapter.serverId, "start", randomUUID(), async () => {})).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });

  it("does not trust an unconfirmed committed restore when physical reconciliation was not run", async () => {
    const f = await fixture(); const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, op.id);
    const stored = (await f.store.list()).find((r) => r.operation.id === op.id)!;
    await f.store.save({ ...stored, operation: { ...stored.operation, state: "running" } });
    const restarted = new OperationService(f.store, clock, f.journal); await restarted.initialize();
    expect(restarted.get(op.id)?.state).toBe("interrupted"); expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
  });

  it("gates wrong physical layout even after rollback parent finalization if its outcome is uncertain", async () => {
    const f = await fixture(); const parent = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, parent.id);
    const plan = await f.restores.rollbackPlan(f.adapter.serverId, parent.id);
    const op = await f.restores.rollback(f.adapter.serverId, parent.id, { confirmWorldName: "world", worldRevision: plan.worldRevision, startAfterRollback: false }, randomUUID()); await complete(f.ops, op.id);
    const stored = (await f.store.list()).find((r) => r.operation.id === op.id)!;
    await f.store.save({ ...stored, operation: { ...stored.operation, state: "running" } });
    await writeFile(path.join(f.server, "world", "region", "fixture.dat"), "wrong persisted rollback layout");
    const restarted = new OperationService(f.store, clock, f.journal);
    await new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock).reconcileStartup(); await restarted.initialize();
    expect(restarted.get(op.id)?.state).toBe("interrupted"); expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
  });

  it("does not hash-lock established successful worlds after later normal play", async () => {
    const f = await fixture(); const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, op.id);
    await writeFile(path.join(f.server, "world", "region", "fixture.dat"), "normal later play");
    const restarted = new OperationService(f.store, clock, f.journal);
    await new RestoreService(f.registry, restarted, f.backups, f.journal, f.manager, clock).reconcileStartup(); await restarted.initialize();
    expect(restarted.get(op.id)?.state).toBe("succeeded"); expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });

  it.each(["different-root", "legacy-unbound"])("refuses rollback and gates startup for %s journals", async (failure) => {
    const f = await fixture(); const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID()); await complete(f.ops, op.id);
    const record = (await f.journal.scan()).records.find((r) => r.intent.operationId === op.id)!;
    let adapter = f.adapter;
    if (failure === "different-root") {
      const newRoot = path.join(f.parent, "re-registered-server"); await cp(f.server, newRoot, { recursive: true });
      await writeFile(path.join(newRoot, "world", "region", "fixture.dat"), "unrelated root must be unchanged");
      adapter = { ...f.adapter, plan: { ...f.adapter.plan, rootPath: newRoot } };
    } else {
      const restore = { ...record.intent.restore! }; delete restore.rootIdentity;
      await writeFile(path.join(f.manager, "transactions", `${f.adapter.serverId}.${record.transactionId}.json`), JSON.stringify({ ...record, intent: { ...record.intent, restore } }));
    }
    const registry = new AdapterRegistry([adapter]); const restarted = new OperationService(f.store, clock, f.journal);
    const service = new RestoreService(registry, restarted, f.backups, f.journal, f.manager, clock);
    await service.reconcileStartup(); await restarted.initialize();
    expect(restarted.getServerState(adapter.serverId).recoveryRequired).toBe(true);
    await expect(service.rollbackPlan(adapter.serverId, op.id)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(service.rollback(adapter.serverId, op.id, { confirmWorldName: "world", worldRevision: "a".repeat(64), startAfterRollback: false }, randomUUID())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    if (failure === "different-root") expect(await readFile(path.join(adapter.plan.rootPath, "world", "region", "fixture.dat"), "utf8")).toBe("unrelated root must be unchanged");
    expect(f.start).not.toHaveBeenCalled();
  });

  it("serializes backup/lifecycle with restore, and rejects same key on another backup", async () => {
    let release: () => void = () => {}; const barrier = new Promise<void>((r) => { release = r; });
    const f = await fixture(async (point) => { if (point === "after:guard-verified") await barrier; });
    const op = await f.restores.restore(f.adapter.serverId, f.backup.id, f.body, randomUUID());
    await expect(f.backups.create(f.adapter.serverId, { scope: "world-set", allowStop: false }, randomUUID())).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(f.ops.requestLifecycle(f.adapter.serverId, "start", randomUUID(), async () => {})).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    release(); expect((await complete(f.ops, op.id)).state).toBe("succeeded");
  });

  it("exposes guarded API boundaries and no secret/path in plan or history", async () => {
    const f = await fixture(); const app = buildApp({ mode: "local", adapters: [f.adapter], clock, operationStore: f.store, transactionRecovery: f.journal, transactionJournal: f.journal, managerRoot: f.manager });
    await app.ready();
    try {
      const url = `/api/v1/servers/${f.adapter.serverId}/backups/${f.backup.id}/restore`;
      const plan = await app.inject({ method: "GET", url, headers: { host: "127.0.0.1:8080" } });
      expect(plan.statusCode).toBe(200); expect(plan.body).not.toContain("PRIVATE_SENTINEL"); expect(plan.body).not.toContain(f.server);
      const headers = { host: "127.0.0.1:8080", "x-manager-intent": "local-ui", "idempotency-key": randomUUID(), origin: "http://127.0.0.1:3000" };
      expect((await app.inject({ method: "POST", url, headers, payload: { ...f.body, arbitraryPath: "C:/outside" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url, headers: { ...headers, origin: "https://evil.example" }, payload: f.body })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url, headers: { ...headers, "idempotency-key": "bad" }, payload: f.body })).statusCode).toBe(428);
    } finally { await app.close(); }
  });
});
