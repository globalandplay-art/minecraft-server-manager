import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { BackupScheduleService } from "../src/services/backup-schedule-service.js";
import { BackupService } from "../src/services/backup-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { DomainError } from "../src/services/domain-errors.js";
import type { Operation } from "@mcsm/contracts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(real = false) {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-schedule-")); roots.push(root);
  const manager = path.join(root, "manager"), server = path.join(root, "server");
  await mkdir(manager); await mkdir(server);
  let time = Date.parse("2026-10-04T18:00:00.000Z"), active = true;
  const state = { state: "stopped", ownership: "none", recoveryRequired: false };
  const stop = vi.fn(async () => { state.state = "stopped"; state.ownership = "none"; });
  const start = vi.fn(async () => { state.state = "running"; state.ownership = "managed"; });
  const clock = { now: () => new Date(time) };
  const adapter = { serverId: "test", mode: "local", plan: { rootPath: server, serverInfo: { type: "vanilla" } },
    getStatus: async () => state, getCapabilities: async () => ({ backup: true }), stop, start, revalidateBeforeStart: async () => {} } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(manager);
  await journal.initialize();
  const operations = new OperationService(new MemoryOperationStore(), clock, journal); await operations.initialize();
  const actual = new BackupService(registry, operations, journal, manager, clock);
  const create = vi.fn<BackupService["create"]>(async () => ({ id: randomUUID(), state: "queued" } as Operation));
  const backups = real ? actual : { create } as unknown as BackupService;
  const make = () => new BackupScheduleService(registry, operations, backups, manager, clock, () => active);
  const service = make();
  const enable = async (settings = {}) => service.update("test", { revision: (await service.get("test")).revision,
    settings: { enabled: true, localTime: "02:00", timezone: "Asia/Shanghai", allowStop: false, ...settings } });
  return { root, manager, server, state, stop, start, operations, service, make, enable, create, actual, journal,
    setTime: (value: string) => { time = Date.parse(value); }, setActive: (value: boolean) => { active = value; } };
}
describe("daily backup durable claims", () => {
  it("defaults disabled, exposes no root, and only dispatches in the exact minute", async () => {
    const f = await fixture();
    expect(await f.service.get("test")).toMatchObject({ settings: { enabled: false, allowStop: false }, runs: [] });
    await f.service.tick(); expect(f.create).not.toHaveBeenCalled();
    await f.enable(); f.setTime("2026-10-04T18:01:00Z"); await f.service.tick(); expect(f.create).not.toHaveBeenCalled();
    f.setTime("2026-10-05T18:00:12Z"); await f.service.tick(); await f.service.tick(); expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.create).toHaveBeenCalledWith("test", expect.objectContaining({ scope: "world-set", allowStop: false }), expect.any(String), "auto", expect.any(Function));
    expect(JSON.stringify(await f.service.get("test"))).not.toContain(f.server);
  });
  it("claims before dispatch and does not retry after manager restart", async () => {
    const f = await fixture(); await f.enable();
    f.create.mockImplementation(async () => {
      const raw = JSON.parse(await readFile(path.join(f.manager, "backup-schedules", "test.json"), "utf8"));
      expect(raw.runs[0].state).toBe("claimed"); expect(raw.daysByZone["Asia/Shanghai"]).toBe("2026-10-05");
      return { id: randomUUID(), state: "queued" } as Operation;
    });
    await f.service.tick(); const restarted = f.make(); await restarted.initialize(); await restarted.tick();
    expect(f.create).toHaveBeenCalledTimes(1); expect((await restarted.get("test")).runs[0]!.state).toBe("interrupted");
  });
  it.each(["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"])("fall-back fold %s submits at most once", async (first) => {
    const f = await fixture(); await f.enable({ timezone: "America/New_York", localTime: "01:30" });
    f.setTime(first); await f.service.tick(); f.setTime("2026-11-01T06:30:20Z"); await f.service.tick();
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("spring-forward missing minute is skipped with no backlog", async () => {
    const f = await fixture(); await f.enable({ timezone: "America/New_York", localTime: "02:30" });
    f.setTime("2027-03-14T06:30:00Z"); await f.service.tick(); f.setTime("2027-03-14T07:30:00Z"); await f.service.tick();
    expect(f.create).not.toHaveBeenCalled(); f.setTime("2027-03-15T06:30:00Z"); await f.service.tick(); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("clock rollback and same-day policy edit do not resubmit", async () => {
    const f = await fixture(); await f.enable(); await f.service.tick();
    f.setTime("2026-10-03T18:00:00Z"); await f.service.tick();
    await f.enable({ localTime: "03:00" }); f.setTime("2026-10-04T19:00:00Z"); await f.service.tick();
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("canonicalizes timezone aliases to one claim namespace", async () => {
    const f = await fixture(); await f.enable({ timezone: "US/Eastern", localTime: "01:30" });
    expect((await f.service.get("test")).settings.timezone).toBe("America/New_York");
  });
  it("records skip and retains claim for unsafe/recovery/busy/no-active state", async () => {
    const f = await fixture(); await f.enable(); f.setActive(false); await f.service.tick();
    expect(f.create).not.toHaveBeenCalled(); expect((await f.service.get("test")).runs[0]).toMatchObject({ state: "skipped", code: "NO_ACTIVE_WORLD" });
    f.setActive(true); await f.service.tick(); expect(f.create).not.toHaveBeenCalled();
    f.setTime("2026-10-05T18:00:00Z"); f.create.mockRejectedValue(new DomainError(409, "OPERATION_CONFLICT", "busy"));
    await f.service.tick(); await f.service.tick(); expect(f.create).toHaveBeenCalledTimes(1);
    expect((await f.service.get("test")).runs[0]).toMatchObject({ state: "skipped", code: "OPERATION_CONFLICT" });
  });
  it("rejects stale revisions and invalid timezones", async () => {
    const f = await fixture(), original = await f.service.get("test"); await f.enable();
    await expect(f.service.update("test", { revision: original.revision, settings: original.settings })).rejects.toMatchObject({ code: "SCHEDULE_REVISION_CONFLICT" });
    await expect(f.enable({ timezone: "../../outside" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(f.enable({ localTime: "24:10" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it.each(["delete", "rollback"])("fails closed on %s of consumed day witness", async (mode) => {
    const f = await fixture(); await f.enable(); await f.service.tick();
    const file = path.join(f.manager, "backup-schedules", "test.json"), value = JSON.parse(await readFile(file, "utf8"));
    if (mode === "delete") delete value.daysByZone["Asia/Shanghai"]; else value.daysByZone["Asia/Shanghai"] = "2026-10-04";
    await writeFile(file, JSON.stringify(value)); const restarted = f.make();
    await restarted.initialize(); await restarted.tick();
    expect(f.create).toHaveBeenCalledTimes(1); await expect(restarted.get("test")).rejects.toMatchObject({ code: "SCHEDULE_STATE_UNSAFE" });
  });
  it.each(["root", "link", "corrupt"])("refuses %s replacement without overwriting evidence", async (mode) => {
    const f = await fixture(); await f.enable(); const file = path.join(f.manager, "backup-schedules", "test.json");
    if (mode === "root") { await rename(f.server, f.server + "-old"); await mkdir(f.server); }
    if (mode === "link") { const directory = path.dirname(file); await rename(directory, directory + "-old"); await symlink(directory + "-old", directory, process.platform === "win32" ? "junction" : "dir"); }
    if (mode === "corrupt") await writeFile(file, "not-json");
    await f.service.tick(); expect(f.create).not.toHaveBeenCalled(); await expect(f.service.get("test")).rejects.toMatchObject({ code: "SCHEDULE_STATE_UNSAFE" });
  });
  it("marks real stopped-world backup auto, preserves three dimensions and observes completion", async () => {
    const f = await fixture(true);
    await mkdir(path.join(f.server, "world", "DIM-1"), { recursive: true }); await mkdir(path.join(f.server, "world", "DIM1"));
    await writeFile(path.join(f.server, "server.properties"), "level-name=world\n");
    for (const file of ["level.dat", "DIM-1/marker", "DIM1/marker"]) await writeFile(path.join(f.server, "world", file), file);
    await f.enable(); await f.service.tick();
    const run = (await f.service.get("test")).runs[0]!;
    await vi.waitFor(() => expect(f.operations.get(run.operationId!)?.state).toBe("succeeded"));
    await f.service.tick(); expect((await f.service.get("test")).runs[0]!.state).toBe("succeeded");
    const [backup] = await f.actual.list("test"); expect(backup).toMatchObject({ kind: "auto", scope: "world-set", fileCount: 3, wasRunning: false });
  });
  it("close prevents new dispatch and does not replay a disabled plan", async () => {
    const f = await fixture(); await f.enable(); f.service.start(); await f.service.close(); await f.service.tick(); expect(f.create).not.toHaveBeenCalled();
  });
  it("running instances skip by default and only stop/restart under saved explicit consent", async () => {
    const f = await fixture(true);
    await mkdir(path.join(f.server, "world")); await writeFile(path.join(f.server, "world", "level.dat"), "test-world");
    await writeFile(path.join(f.server, "server.properties"), "level-name=world\n"); f.state.state = "running"; f.state.ownership = "managed";
    await f.enable(); await f.service.tick(); expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect((await f.service.get("test")).runs[0]).toMatchObject({ state: "skipped", code: "SERVER_MUST_BE_STOPPED" });
    await f.enable({ allowStop: true }); f.setTime("2026-10-05T18:00:00Z"); await f.service.tick();
    const id = (await f.service.get("test")).runs[0]!.operationId!;
    await vi.waitFor(() => expect(f.operations.get(id)?.state).toBe("succeeded"));
    expect(f.stop).toHaveBeenCalledTimes(1); expect(f.start).toHaveBeenCalledTimes(1); expect((await f.actual.list("test"))[0]).toMatchObject({ kind: "auto", restarted: true });
  });
  it("revalidates root identity in the queued callback before side effects", async () => {
    const f = await fixture(); await f.enable();
    f.create.mockImplementation(async (_server, _body, _key, _origin, preflight) => {
      await rename(f.server, f.server + "-old"); await mkdir(f.server);
      await expect(preflight!()).rejects.toMatchObject({ code: "SCHEDULE_STATE_UNSAFE" });
      throw new DomainError(409, "SCHEDULE_STATE_UNSAFE", "root changed");
    });
    await f.service.tick(); expect(await f.actual.list("test")).toEqual([]);
  });
  it("closing during submission blocks queued execution without filesystem effects", async () => {
    const f = await fixture(); await f.enable(); let close: Promise<void> | undefined;
    f.create.mockImplementation(async (_server, _body, _key, _origin, preflight) => {
      close = f.service.close(); await expect(preflight!()).rejects.toMatchObject({ code: "SCHEDULE_CLOSED" });
      throw new DomainError(409, "SCHEDULE_CLOSED", "closing");
    });
    await f.service.tick(); await close; expect(await f.actual.list("test")).toEqual([]);
    expect((await f.service.get("test")).runs[0]!.code).toBe("SCHEDULE_CLOSED");
  });
});
