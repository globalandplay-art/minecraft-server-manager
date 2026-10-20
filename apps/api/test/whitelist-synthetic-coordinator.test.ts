import { randomUUID } from "node:crypto";
import { rm, readFile, readdir, link, rename, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { DomainError } from "../src/services/domain-errors.js";
import { syntheticFixture } from "./whitelist-synthetic-fixture.js";
import { OperationService } from "../src/services/operation-service.js";
import { JsonOperationStore } from "../src/services/operation-store.js";
import { WhitelistCommandStore } from "../src/services/whitelist-command-store.js";
import { WhitelistGuardStore } from "../src/services/whitelist-guard-store.js";
import { SyntheticWhitelistCoordinator } from "../src/services/whitelist-synthetic-coordinator.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) { if (!root.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith("mcsm-whitelist-integration-")) throw new Error("cleanup-boundary"); await rm(root, { recursive: true, force: true }); } });
const allow = () => undefined;
async function fixture() { const f = await syntheticFixture(); roots.push(f.root); return f; }
async function terminal(operations: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["open"]>>["operations"], id: string) {
  await vi.waitFor(() => { expect(["succeeded", "failed", "interrupted"]).toContain(operations.get(id)?.state);
    expect(operations.getServerState(operations.get(id)!.serverId).activeOperationId).toBeNull(); }); return operations.get(id)!;
}
it("executes add/remove once behind private guard and durable command intent; no implicit lifecycle", async () => {
  const f = await fixture(), s = await f.open(), before = await f.runtime.capture("test");
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); expect((await terminal(s.operations, op.id)).state).toBe("succeeded");
  const guard = await s.guards.verify(op.id); expect(guard.snapshot).toEqual(before.snapshot);
  expect((await s.commands.scan())[0]!.map((row) => row.state)).toEqual(["intent-persisted", "dispatch-intent", "response-recorded"]);
  expect(f.runtime.calls).toBe(1);
  const removed = await s.service.submit("test", f.request("remove"), randomUUID(), allow);
  expect((await terminal(s.operations, removed.id)).state).toBe("succeeded"); expect(f.runtime.members).toEqual(before.snapshot.members); expect(f.runtime.calls).toBe(2);
  const reopened = await f.open(); expect(reopened.operations.get(op.id)?.state).toBe("succeeded");
  expect(reopened.operations.get(removed.id)?.state).toBe("succeeded"); expect(reopened.operations.getServerState("test").recoveryRequired).toBe(false);
});
it("replays the original operation after24h and manager reconstruction without new publications/dispatch", async () => {
  const f = await fixture(), s = await f.open(), request = f.request(), key = randomUUID();
  const op = await s.service.submit("test", request, key, allow); await terminal(s.operations, op.id);
  f.setNow("2030-01-01T00:00:00.000Z"); const reopened = await f.open(), count = f.writes();
  const replay = await reopened.service.submit("test", request, key, allow);
  expect(replay.id).toBe(op.id); expect(replay.state).toBe("succeeded"); expect(f.runtime.calls).toBe(1); expect(f.writes()).toBe(count);
  expect(reopened.operations.getServerState("test").recoveryRequired).toBe(false);
});
it("same key different request conflicts with zero additional effects", async () => {
  const f = await fixture(), s = await f.open(), key = randomUUID(), request = f.request();
  const op = await s.service.submit("test", request, key, allow); await terminal(s.operations, op.id); const count = f.writes();
  await expect(s.service.submit("test", { ...request, name: "DifferentName" }, key, allow)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  expect(f.runtime.calls).toBe(1); expect(f.writes()).toBe(count);
});
it("lost response retains guard/dispatch evidence and blocks replay/recovery despite matching members", async () => {
  const f = await fixture(), s = await f.open(), request = f.request(), key = randomUUID(); f.runtime.lost = true;
  const op = await s.service.submit("test", request, key, allow); expect((await terminal(s.operations, op.id)).state).toBe("interrupted");
  const reopened = await f.open(), count = f.writes(); const replay = await reopened.service.submit("test", request, key, allow);
  expect(replay.state).toBe("interrupted"); await expect(reopened.service.recover("test", op.id, allow)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  expect(f.runtime.calls).toBe(1); expect(f.writes()).toBe(count); expect(reopened.operations.getServerState("test").recoveryRequired).toBe(true);
});
it("explicit recovery settles a verified recorded response after common terminal publication failure", async () => {
  const f = await fixture(), s = await f.open(); f.opStore.failSuccessOnce = true;
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); expect((await terminal(s.operations, op.id)).state).toBe("interrupted");
  const reopened = await f.open(); expect(reopened.operations.getServerState("test").recoveryRequired).toBe(true);
  const recovered = await reopened.service.recover("test", op.id, allow); expect(recovered.state).toBe("succeeded");
  expect(reopened.operations.getServerState("test").recoveryRequired).toBe(false); expect(f.runtime.calls).toBe(1);
});
it("queued admission revoked during preflight has zero operation/guard/command writes", async () => {
  const f = await fixture(), s = await f.open(); let allowed = true; const original = f.runtime.capture.bind(f.runtime);
  f.runtime.capture = async (serverId) => { const value = await original(serverId); allowed = false; return value; };
  await expect(s.service.submit("test", f.request(), randomUUID(), () => { if (!allowed) throw new DomainError(401, "AUTH_REQUIRED", "Denied"); return undefined; })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(f.writes()).toBe(0); expect(await f.opStore.list()).toEqual([]); expect(f.runtime.calls).toBe(0);
});
it("common instance exclusion blocks lifecycle while an admitted command is active", async () => {
  const f = await fixture(), s = await f.open(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; }), pending = new Promise<void>((resolve) => { release = resolve; });
  f.runtime.duringDispatch = async () => { entered(); await pending; };
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); await started;
  try { await expect(s.operations.requestLifecycle("test", "stop", randomUUID(), async () => {})).rejects.toMatchObject({ code: "OPERATION_CONFLICT" }); }
  finally { release(); await terminal(s.operations, op.id); }
});
it("guard failure before durable intent dispatches zero commands and preserves staging", async () => {
  const f = await fixture(), s = await f.open({ ...f.publication, publishNew: async (stage, target) => {
    if (target.endsWith("00.bin")) throw new Error("synthetic-guard-failure"); await f.publication.publishNew(stage, target);
  } });
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); expect((await terminal(s.operations, op.id)).state).toBe("interrupted");
  expect(f.runtime.calls).toBe(0); expect(await readdir(path.join(f.root, "whitelist-guards", op.id))).toContain("00.bin.stage");
  await expect(f.open()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
});
it("runtime generation drift at the Fake atomic dispatch boundary prevents send", async () => {
  const f = await fixture(), s = await f.open(); f.runtime.duringDispatch = async () => { f.runtime.runtimeId = randomUUID(); };
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); expect((await terminal(s.operations, op.id)).state).toBe("interrupted"); expect(f.runtime.calls).toBe(0);
});
it("startup cannot clear recovery from a saved success if causal receipt is missing", async () => {
  const f = await fixture(), s = await f.open(), request = f.request(), key = randomUUID(); const op = await s.service.submit("test", request, key, allow); await terminal(s.operations, op.id);
  f.runtime.receipts.clear(); const reopened = await f.open(); expect(reopened.operations.get(op.id)?.state).toBe("interrupted");
  expect((await reopened.service.submit("test", request, key, allow)).state).toBe("interrupted"); expect(f.runtime.calls).toBe(1);
});
it("unrelated recovery is never cleared by member confirmation", async () => {
  const f = await fixture(), s = await f.open(); f.opStore.failSuccessOnce = true;
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); await terminal(s.operations, op.id); s.operations.requireRecovery(["test"]);
  await expect(s.service.recover("test", op.id, allow)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" }); expect(s.operations.getServerState("test").recoveryRequired).toBe(true);
});
it("guards keep exact bytes in bounded chunks and reject replacement/hardlink/corruption", async () => {
  const f = await fixture(), s = await f.open(), capture = await f.runtime.capture("test"), opId = randomUUID();
  const padded = Buffer.from(" ".repeat(9000) + capture.bytes.toString("utf8"));
  const snapshot = { ...capture.snapshot, fileSha256: (await import("../src/services/whitelist-command-record.js")).whitelistCommandHash(padded) };
  const created = await s.guards.create(opId, snapshot, padded); expect(created.snapshot).toEqual(snapshot);
  const directory = path.join(f.root, "whitelist-guards", opId);
  expect(Buffer.concat(await Promise.all(["00.bin", "01.bin", "02.bin"].map((name) => readFile(path.join(directory, name)))))).toEqual(padded);
  await link(path.join(directory, "00.bin"), path.join(f.root, "owned-test-link"));
  await expect(s.guards.verify(opId)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
});
it("guard namespace replacement is rejected without reading a new baseline", async () => {
  const f = await fixture(), s = await f.open(), capture = await f.runtime.capture("test"); await s.guards.create(randomUUID(), capture.snapshot, capture.bytes);
  await rename(path.join(f.root, "whitelist-guards"), path.join(f.root, "retained-guards")); await mkdir(path.join(f.root, "whitelist-guards"));
  await expect(s.guards.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
});
it.each(['acl', 'replacement'])("paired guard read rejects %s changes during its common after-check", async mode => {
  const f = await fixture(), s = await f.open(), capture = await f.runtime.capture('test'), operationId = randomUUID();
  await s.guards.create(operationId, capture.snapshot, capture.bytes);
  const directory = path.join(f.root, 'whitelist-guards', operationId), first = path.join(directory, '00.bin');
  const original = f.acl.verifyMany.bind(f.acl); let calls = 0;
  const spy = vi.spyOn(f.acl, 'verifyMany').mockImplementation(async files => {
    const hashes = await original(files);
    if (files.length === 4 && files.includes(first) && ++calls === 2) {
      if (mode === 'acl') hashes[3] = 'different-acl';
      else { await rename(first, path.join(directory, 'retained.bin')); await writeFile(first, capture.bytes, { flag: 'wx' }); }
    }
    return hashes;
  });
  try {
    await expect(s.guards.verify(operationId)).rejects.toMatchObject({ code: 'WHITELIST_GUARD_UNSAFE' });
    expect(calls).toBe(2); expect(f.runtime.calls).toBe(0);
  } finally { spy.mockRestore(); capture.bytes.fill(0); }
});
it("unavailable Fake runtime refuses preflight without any file writes", async () => {
  const f = await fixture(), s = await f.open(); const request = f.request(); f.runtime.unavailable = true;
  await expect(s.service.submit("test", request, randomUUID(), allow)).rejects.toThrow(); expect(f.writes()).toBe(0); expect(await f.opStore.list()).toEqual([]);
});
it("a source snapshot that disagrees with exact bytes cannot create a guard", async () => {
  const f = await fixture(), s = await f.open(), capture = await f.runtime.capture("test");
  await expect(s.guards.create(randomUUID(), { ...capture.snapshot, members: [] }, capture.bytes)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" }); expect(f.writes()).toBe(0);
});
it.each(["close", "owner-loss"])("%s while dispatch waits prevents any send and retains recovery", async (fault) => {
  const f = await fixture(), s = await f.open(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; }), pending = new Promise<void>((resolve) => { release = resolve; });
  f.runtime.duringDispatch = async () => { entered(); await pending; };
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); await started;
  expect(f.activities()).toBe(1); expect(() => f.owner.release()).toThrow("AUTH_BUSY");
  if (fault === "close") s.service.close(); else f.owner.forceLoss();
  release(); expect((await terminal(s.operations, op.id)).state).toBe("interrupted"); expect(f.runtime.calls).toBe(0); expect(f.activities()).toBe(0);
});
it.each(["queued", "succeeded"])("owner is retained during %s common-record persistence, not just execute", async (state) => {
  const f = await fixture(), s = await f.open(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; }), pending = new Promise<void>((resolve) => { release = resolve; });
  f.opStore.duringSave = async (record) => { if (record.operation.state === state) { entered(); await pending; } };
  const submission = s.service.submit("test", f.request(), randomUUID(), allow); await started;
  expect(f.activities()).toBe(1); expect(() => f.owner.release()).toThrow("AUTH_BUSY");
  if (state === "queued") s.service.close(); release(); const op = await submission; const result = await terminal(s.operations, op.id);
  expect(result.state).toBe(state === "queued" ? "interrupted" : "succeeded"); expect(f.runtime.calls).toBe(state === "queued" ? 0 : 1); expect(f.activities()).toBe(0);
});
it("final recovery reauthentication denial preserves the operation and recovery cause", async () => {
  const f = await fixture(), s = await f.open(); f.opStore.failSuccessOnce = true;
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); await terminal(s.operations, op.id); let allowed = true;
  f.acl.beforeCheck = async () => { allowed = false; };
  await expect(s.service.recover("test", op.id, () => { if (!allowed) throw new DomainError(401, "AUTH_REQUIRED", "Denied"); return undefined; })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(s.operations.get(op.id)?.state).toBe("interrupted"); expect(s.operations.getServerState("test").recoveryRequired).toBe(true); expect(f.runtime.calls).toBe(1); expect(f.activities()).toBe(0);
});
it("unrelated recovery arriving during proof verification prevents settlement", async () => {
  const f = await fixture(), s = await f.open(); f.opStore.failSuccessOnce = true;
  const op = await s.service.submit("test", f.request(), randomUUID(), allow); await terminal(s.operations, op.id);
  f.acl.beforeCheck = async () => { s.operations.requireRecovery(["test"]); };
  await expect(s.service.recover("test", op.id, allow)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" }); expect(s.operations.get(op.id)?.state).toBe("interrupted");
});
it("historical receipt cannot clear recovery for a replaced registered root", async () => {
  const f = await fixture(), s = await f.open(), request = f.request(); const op = await s.service.submit("test", request, randomUUID(), allow); await terminal(s.operations, op.id);
  f.runtime.rootIdentity = "0".repeat(64); const reopened = await f.open(); expect(reopened.operations.get(op.id)?.state).toBe("interrupted");
  await expect(reopened.service.recover("test", op.id, allow)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" }); expect(f.runtime.calls).toBe(1);
});
it("a receipt with missing archived observation is not proof even when current members match", async () => {
  const f = await fixture(), s = await f.open(), request = f.request(); const op = await s.service.submit("test", request, randomUUID(), allow); await terminal(s.operations, op.id);
  f.runtime.evidence.clear(); const reopened = await f.open(); expect(reopened.operations.get(op.id)?.state).toBe("interrupted"); expect(f.runtime.calls).toBe(1);
});
it("reconstructs common operations from the existing JSON disk store without repeating a command", async () => {
  const f = await fixture();
  const connect = async () => {
    const operations = new OperationService(new JsonOperationStore(f.root), f.clock); await operations.initialize();
    const commands = await WhitelistCommandStore.open(f.root, f.owner, f.acl, f.publication);
    const guards = await WhitelistGuardStore.open(f.root, f.owner, f.acl, f.publication);
    const service = new SyntheticWhitelistCoordinator(operations, commands, guards, f.runtime, f.clock, f.owner); await service.initialize();
    return { operations, service };
  };
  const first = await connect(), request = f.request(), key = randomUUID();
  const op = await first.service.submit("test", request, key, allow); expect((await terminal(first.operations, op.id)).state).toBe("succeeded");
  f.setNow("2030-01-01T00:00:00.000Z"); const next = await connect(); const replay = await next.service.submit("test", request, key, allow);
  expect(replay.id).toBe(op.id); expect(replay.state).toBe("succeeded"); expect(f.runtime.calls).toBe(1);
});
