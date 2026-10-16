import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { OperationService, type OperationAdmission } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { DomainError } from "../src/services/domain-errors.js";
const clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };
function gate() { let release = () => {}; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
function grant(valid: () => boolean): OperationAdmission {
  return () => { if (!valid()) throw new DomainError(401, "AUTH_REQUIRED", "Authentication required"); return undefined; };
}
it("denies after a mutation queue wait without observing replay or starting preflight", async () => {
  const store = new MemoryOperationStore(), operations = new OperationService(store, clock); await operations.initialize();
  const held = gate(); let entered = false, valid = true;
  const first = operations.requestBackup("first", randomUUID(), "{}", async () => {}, async () => { entered = true; await held.promise; });
  const preflight = vi.fn(async () => {}), execute = vi.fn(async () => {});
  let second: Promise<unknown> | undefined;
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    second = operations.requestBackup("second", randomUUID(), "{}", execute, preflight, "backup", undefined, grant(() => valid));
    const denied = expect(second).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    valid = false; held.release(); await first; await denied;
    expect(preflight).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    expect((await store.list()).every(record => record.operation.serverId === "first")).toBe(true);
    expect(operations.getServerState("second")).toEqual({ activeOperationId: null, recoveryRequired: false });
  } finally { held.release(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});
it("denies a grant revoked during preflight with no durable record or execution", async () => {
  const store = new MemoryOperationStore(), operations = new OperationService(store, clock); await operations.initialize();
  let valid = true; const execute = vi.fn(async () => {});
  await expect(operations.requestBackup("test", randomUUID(), "{}", execute, async () => {
    await Promise.resolve(); valid = false;
  }, "backup", undefined, grant(() => valid))).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(await store.list()).toEqual([]); expect(execute).not.toHaveBeenCalled();
  expect(operations.getServerState("test")).toEqual({ activeOperationId: null, recoveryRequired: false });
});
it("requires a fresh grant for idempotent replay and never duplicates the operation", async () => {
  const store = new MemoryOperationStore(), operations = new OperationService(store, clock); await operations.initialize();
  let valid = true; const key = randomUUID(), execute = vi.fn(async () => {}), admission = grant(() => valid);
  const first = await operations.requestBackup("test", key, "{}", execute, undefined, "backup", undefined, admission);
  await vi.waitFor(() => expect(operations.get(first.id)?.state).toBe("succeeded"));
  expect((await operations.requestBackup("test", key, "{}", execute, undefined, "backup", undefined, admission)).id).toBe(first.id);
  valid = false;
  await expect(operations.requestBackup("test", key, "{}", execute, undefined, "backup", undefined, admission)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(await store.list()).toHaveLength(1); expect(execute).toHaveBeenCalledOnce();
});
it("preserves valid admission when the grant closes during durable save", async () => {
  const store = new MemoryOperationStore(), operations = new OperationService(store, clock); await operations.initialize();
  const held = gate(); let entered = false, valid = true;
  const original = store.save.bind(store);
  vi.spyOn(store, "save").mockImplementationOnce(async (record) => { entered = true; await held.promise; await original(record); });
  const execute = vi.fn(async () => {});
  const pending = operations.requestBackup("test", randomUUID(), "{}", execute, undefined, "backup", undefined, grant(() => valid));
  try {
    await vi.waitFor(() => expect(entered).toBe(true)); valid = false; held.release();
    const operation = await pending;
    await vi.waitFor(() => expect(operations.get(operation.id)?.state).toBe("succeeded"));
    expect(await store.list()).toHaveLength(1); expect(execute).toHaveBeenCalledOnce();
    expect(operations.getServerState("test").recoveryRequired).toBe(false);
  } finally { held.release(); await Promise.allSettled([pending]); }
});
