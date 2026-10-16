import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { aclSessionScript, PrototypeAclSession, type OwnedAclChild } from "./fixtures/whitelist-acl-session.js";

class FakeChild extends EventEmitter implements OwnedAclChild {
  readonly stdout = new PassThrough(); readonly stderr = new PassThrough(); readonly pid = 123;
  kills = 0; closeOnKill = true; closeOnEnd = true; frames: { version: number; id: number; paths: string }[] = [];
  readonly stdin = new Writable({ write: (chunk: Buffer, _encoding, callback) => {
    this.frames.push(JSON.parse(chunk.toString("utf8"))); callback();
  }, final: (callback) => { callback(); if (this.closeOnEnd) queueMicrotask(() => this.emit("close", 0, null)); } });
  kill() { this.kills++; if (this.closeOnKill) queueMicrotask(() => this.emit("close", null, "SIGTERM")); return true; }
  reply(snapshots: unknown[] = [{}], id = this.frames.at(-1)!.id) { this.stdout.write(Buffer.from(JSON.stringify({ version: 1, id, snapshots }) + "\n")); }
}
afterEach(() => vi.useRealTimers());
it("applies the constructor-only fixed-script wrapper once, inside the query, without changing request data", async () => {
  const child = new FakeChild(), factory = vi.fn<(script: string) => FakeChild>(() => child), wrap = vi.fn((script: string) => `# FIXED_BOOTSTRAP\n${script}`);
  const session = new PrototypeAclSession(factory, undefined, wrap);
  expect(wrap).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled();
  const result = session.query(["fixture"]); expect(wrap).toHaveBeenCalledExactlyOnceWith(aclSessionScript);
  expect(factory).toHaveBeenCalledExactlyOnceWith(`# FIXED_BOOTSTRAP\n${aclSessionScript}`);
  child.reply(); await result; const next = session.query(["fixture"]); child.reply(); await next;
  expect(wrap).toHaveBeenCalledOnce(); await session.close();
});
it("rejects a revoked bootstrap without spawning or guessing a child", async () => {
  const factory = vi.fn(() => new FakeChild()), wrap = () => { throw new Error("PRIVATE_SENTINEL"); };
  const session = new PrototypeAclSession(factory, undefined, wrap);
  await expect(session.query(["fixture"])).rejects.toMatchObject({ code: "ACL_SESSION_UNSAFE", reason: "spawn" });
  expect(factory).not.toHaveBeenCalled(); await expect(session.close()).rejects.toMatchObject({ reason: "spawn" });
  expect(session.closedConfirmed).toBe(true);
});
it("does not spawn after fixed bootstrap preparation consumes the original query deadline", async () => {
  let tick = 0;
  const factory = vi.fn(() => new FakeChild()), session = new PrototypeAclSession(factory, () => tick, (script) => { tick = 5001; return script; });
  await expect(session.query(["fixture"])).rejects.toMatchObject({ code: "ACL_SESSION_UNSAFE", reason: "timeout" });
  expect(factory).not.toHaveBeenCalled(); await expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
  expect(session.closedConfirmed).toBe(true);
});
it("lazily starts exactly one child and preserves real batch boundaries and request IDs", async () => {
  const child = new FakeChild(), factory = vi.fn(() => child), session = new PrototypeAclSession(factory);
  expect(factory).not.toHaveBeenCalled();
  const first = session.query(["fixture-a", "fixture-b"]); expect(factory).toHaveBeenCalledTimes(1);
  expect(JSON.parse(Buffer.from(child.frames[0]!.paths, "base64").toString("utf8"))).toEqual(["fixture-a", "fixture-b"]);
  child.reply([{}, {}]); await expect(first).resolves.toHaveLength(2);
  const second = session.query(["fixture-a"]); child.reply(); await second;
  expect(child.frames.map((row) => row.id)).toEqual([1, 2]); expect(factory).toHaveBeenCalledTimes(1);
  await session.close(); expect(session.closedConfirmed).toBe(true);
});
it("counts startup and waiting inside the unchanged5000ms first-request limit", async () => {
  vi.useFakeTimers(); const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ code: "ACL_SESSION_UNSAFE", reason: "timeout" });
  await vi.advanceTimersByTimeAsync(5000); await failure;
  await expect(session.close()).rejects.toMatchObject({ reason: "timeout" }); expect(session.closedConfirmed).toBe(true); expect(child.kills).toBe(1);
});
it("rejects concurrency without writing or resetting the first deadline", async () => {
  vi.useFakeTimers(); const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const first = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "timeout" });
  await vi.advanceTimersByTimeAsync(4000);
  await expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "busy" }); expect(child.frames).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000); await first; await expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
});
it.each(["wrong-id", "unknown-version", "extra-field", "wrong-count", "duplicate", "trailing"])("poisons %s output and confirms owned close", async (fault) => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "protocol" });
  const base = { version: 1, id: 1, snapshots: [{}] };
  const value = fault === "wrong-id" ? { ...base, id: 2 } : fault === "unknown-version" ? { ...base, version: 2 } :
    fault === "extra-field" ? { ...base, secret: "PRIVATE_SENTINEL" } : fault === "wrong-count" ? { ...base, snapshots: [] } : base;
  child.stdout.write(Buffer.from(JSON.stringify(value) + "\n" + (fault === "duplicate" ? JSON.stringify(base) + "\n" : fault === "trailing" ? "x" : "")));
  await failure; await expect(session.close()).rejects.toMatchObject({ reason: "protocol" }); expect(session.closedConfirmed).toBe(true);
  await expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "protocol" });
});
it("bounds incomplete stdout at64KiB and never returns raw output", async () => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ message: "ACL_SESSION_UNSAFE", reason: "protocol" });
  child.stdout.write(Buffer.alloc(65537, 65)); await failure; await expect(session.close()).rejects.toMatchObject({ reason: "protocol" });
});
it("rejects stderr without exposing it", async () => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ message: "ACL_SESSION_UNSAFE", reason: "protocol" });
  child.stderr.write("PRIVATE_SENTINEL"); await failure; await expect(session.close()).rejects.toMatchObject({ reason: "protocol" });
});
it("treats partial frame plus premature exit as closed and never supplies snapshots", async () => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "closed" });
  child.stdout.write('{"version":1'); child.emit("close", 1, null); await failure;
  await expect(session.close()).rejects.toMatchObject({ reason: "closed" });
});
it("retains CLEANUP_BLOCKED when owned kill does not yield close proof", async () => {
  vi.useFakeTimers(); const child = new FakeChild(); child.closeOnKill = false; child.closeOnEnd = false;
  const session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "timeout" });
  await vi.advanceTimersByTimeAsync(5000); await failure;
  const close = expect(session.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED", reason: "cleanup" });
  await vi.advanceTimersByTimeAsync(5000); await close; expect(session.closedConfirmed).toBe(false);
});
it("rejects unsafe input and capacity before any extra write", async () => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  await expect(session.query([])).rejects.toMatchObject({ reason: "protocol" }); expect(child.frames).toHaveLength(0);
  for (let id = 1; id <= 64; id++) { const pending = session.query(["fixture"]); child.reply(); await pending; }
  await expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "capacity" }); expect(child.frames).toHaveLength(64); await session.close();
});
it("poisons unsolicited or late output after a valid response", async () => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const pending = session.query(["fixture"]); child.reply(); await pending; child.reply();
  await expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "protocol" }); await expect(session.close()).rejects.toMatchObject({ reason: "protocol" });
});
it("accepts one valid frame split over chunks and supports idempotent close", async () => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child), pending = session.query(["fixture"]);
  child.stdout.write('{"version":1,'); child.stdout.write('"id":1,"snapshots":[{}]}\r\n');
  await expect(pending).resolves.toEqual([{}]); await session.close(); await session.close();
});
it("rejects invalid UTF8 instead of replacing bytes", async () => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "protocol" });
  child.stdout.write(Buffer.concat([Buffer.from('{"version":1,"id":1,"snapshots":["'), Buffer.from([255]), Buffer.from('"]}\n')]));
  await failure; await expect(session.close()).rejects.toMatchObject({ reason: "protocol" });
});
it("bounds session lifetime even between requests", async () => {
  vi.useFakeTimers(); const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const pending = session.query(["fixture"]); child.reply(); await pending;
  await vi.advanceTimersByTimeAsync(40_000);
  await expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "timeout" });
  await expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
});
it("sanitizes factory failure without retry or an invented absence proof", async () => {
  const factory = vi.fn(() => { throw new Error("PRIVATE_SENTINEL"); }), session = new PrototypeAclSession(factory);
  await expect(session.query(["fixture"])).rejects.toMatchObject({ message: "ACL_SESSION_UNSAFE", reason: "spawn" });
  await expect(session.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" }); expect(session.closedConfirmed).toBe(false); expect(factory).toHaveBeenCalledTimes(1);
});
it.each(["stdout", "stderr"] as const)("poisons pending %s errors without raw exception leakage", async (stream) => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ message: "ACL_SESSION_UNSAFE", reason: "protocol" });
  child[stream].emit("error", new Error("PRIVATE_SENTINEL")); await failure;
  await expect(session.close()).rejects.toMatchObject({ reason: "protocol" }); expect(session.closedConfirmed).toBe(true);
});
it.each(["stdout", "stderr"] as const)("poisons idle %s errors before further use", async (stream) => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child), pending = session.query(["fixture"]);
  child.reply(); await pending; child[stream].emit("error", new Error("PRIVATE_SENTINEL"));
  await expect(session.query(["fixture"])).rejects.toMatchObject({ message: "ACL_SESSION_UNSAFE", reason: "protocol" });
  await expect(session.close()).rejects.toMatchObject({ reason: "protocol" });
});
it("poisons a hanging close permanently even after a late successful exit", async () => {
  vi.useFakeTimers(); const child = new FakeChild(); child.closeOnEnd = false; child.closeOnKill = false;
  const session = new PrototypeAclSession(() => child), pending = session.query(["fixture"]); child.reply(); await pending;
  const closing = expect(session.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(5000); await closing; expect(child.kills).toBe(1); expect(session.closedConfirmed).toBe(false);
  child.emit("close", 0, null); expect(session.closedConfirmed).toBe(true);
  await expect(session.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await expect(session.query(["fixture"])).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
});
it("categorizes a progress marker without accepting it or recording its contents", async () => {
  const child = new FakeChild(), session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "protocol" });
  child.stderr.write('#< CLIXML\r\n<Objs><Obj S="progress">PRIVATE_SENTINEL</Obj></Objs>'); await failure;
  expect(session.diagnostic).toMatchObject({ protocolLocation: "stderr", stderrKind: "clixml-progress-marker" });
  expect(JSON.stringify(session.diagnostic)).not.toContain("PRIVATE_SENTINEL");
  await expect(session.close()).rejects.toMatchObject({ reason: "protocol" });
});
it("categorizes split stderr metadata without releasing any raw text or accepting it", async () => {
  const child = new FakeChild(); child.closeOnKill = false;
  const session = new PrototypeAclSession(() => child);
  const failure = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "protocol" });
  child.stderr.write('#< CLI'); child.stderr.write('XML\n<Objs><S S="Error">InputEncoding PRIVATE_SENTINEL</S></Objs>');
  await failure; child.emit("close", 1, null);
  await expect(session.close()).rejects.toMatchObject({ reason: "protocol" });
  expect(session.diagnostic).toMatchObject({ stderrKind: "clixml-error-marker", inputEncoding: true });
  expect(JSON.stringify(session.diagnostic)).not.toContain("PRIVATE_SENTINEL");
});
it.each([Number.NaN, Number.POSITIVE_INFINITY, 6000])("rejects an invalid or extended absolute deadline %s before spawning", async (deadline) => {
  const factory = vi.fn(() => new FakeChild()), session = new PrototypeAclSession(factory, () => 0);
  await expect(session.query(["fixture"], deadline)).rejects.toMatchObject({ reason: "protocol" });
  expect(factory).not.toHaveBeenCalled(); await session.close();
});
it("does not spawn or dispatch an already expired logical query", async () => {
  const factory = vi.fn(() => new FakeChild()), session = new PrototypeAclSession(factory, () => 100);
  await expect(session.query(["fixture"], 100)).rejects.toMatchObject({ reason: "timeout" });
  expect(factory).not.toHaveBeenCalled(); await expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
});
it("uses only the remaining logical deadline and never grants a fresh5000ms", async () => {
  vi.useFakeTimers(); let now = 0;
  const child = new FakeChild(), session = new PrototypeAclSession(() => child, () => now);
  const pending = expect(session.query(["fixture"], 200)).rejects.toMatchObject({ reason: "timeout" });
  now = 200; await vi.advanceTimersByTimeAsync(200); await pending;
  expect(child.frames).toHaveLength(1); await expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
});
it("rejects a late valid reply even when the timer callback has not run", async () => {
  vi.useFakeTimers(); let now = 0;
  const child = new FakeChild(), session = new PrototypeAclSession(() => child, () => now);
  const pending = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "timeout" });
  now = 5001; child.reply(); await pending; await expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
});
it("counts synchronous spawn overhead before permitting stdin dispatch", async () => {
  vi.useFakeTimers(); let now = 0; const child = new FakeChild();
  const session = new PrototypeAclSession(() => { now = 1001; return child; }, () => now);
  await expect(session.query(["fixture"], 1000)).rejects.toMatchObject({ reason: "timeout" });
  expect(child.frames).toHaveLength(0); await expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
});
it("shares one close promise and one independent cleanup deadline", async () => {
  vi.useFakeTimers(); const child = new FakeChild(); child.closeOnEnd = false;
  const session = new PrototypeAclSession(() => child), pending = session.query(["fixture"]); child.reply(); await pending;
  const end = vi.spyOn(child.stdin, "end"), first = session.close(), second = session.close();
  expect(first).toBe(second); expect(end).toHaveBeenCalledOnce();
  child.emit("close", 0, null); await first; await second; expect(session.close()).toBe(first);
});
it.each(["query", "close"])("cannot rehabilitate a lifetime-expired child using %s before an overdue timer fires", async (mode) => {
  vi.useFakeTimers(); let now = 0; const child = new FakeChild(), session = new PrototypeAclSession(() => child, () => now);
  const first = session.query(["fixture"]); child.reply(); await first; now = 40_000;
  expect(session.healthyForRotation).toBe(false);
  if (mode === "query") await expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "timeout" });
  await expect(session.close()).rejects.toMatchObject({ reason: "timeout" }); expect(child.frames).toHaveLength(1);
});
it("does not cancel lifetime expiry merely by starting close before40seconds", async () => {
  vi.useFakeTimers(); let now = 0; const child = new FakeChild(); child.closeOnEnd = false;
  const session = new PrototypeAclSession(() => child, () => now), first = session.query(["fixture"]); child.reply(); await first;
  now = 35_001; const closed = expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
  now = 40_000; child.emit("close", 0, null); await closed;
});
it("retains cleanup failure after an overdue close even when its timer has not run", async () => {
  vi.useFakeTimers(); let now = 0; const child = new FakeChild(); child.closeOnEnd = false;
  const session = new PrototypeAclSession(() => child, () => now), first = session.query(["fixture"]); child.reply(); await first;
  const closed = expect(session.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  now = 5001; child.emit("close", 0, null); await closed; expect(session.closedConfirmed).toBe(true);
  await expect(session.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
});
it("rejects a reply at40s lifetime even when the per-query deadline and delayed timer have not expired", async () => {
  vi.useFakeTimers(); let now = 0; const child = new FakeChild(), session = new PrototypeAclSession(() => child, () => now);
  const first = session.query(["fixture"]); child.reply(); await first;
  now = 39000; const second = expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "timeout" });
  now = 40000; child.reply(); await second; await expect(session.close()).rejects.toMatchObject({ reason: "timeout" });
});
it("does not guess a child identity or close proof when a factory creates then throws", async () => {
  let abandoned: FakeChild | undefined;
  const session = new PrototypeAclSession(() => { abandoned = new FakeChild(); throw new Error("PRIVATE_FACTORY"); });
  await expect(session.query(["fixture"])).rejects.toMatchObject({ reason: "spawn" });
  await expect(session.close()).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(session.closedConfirmed).toBe(false); expect(session.healthyForRotation).toBe(false); expect(abandoned!.kills).toBe(0);
});
