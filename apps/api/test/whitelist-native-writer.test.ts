import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { WhitelistNativeWriter, WhitelistWriterError } from "../src/services/whitelist-native-writer.js";

class FakeChild extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  kills = 0;
  kill() { this.kills++; return true; }
  finish(code: number | null = 0, signal: string | null = null) { this.emit("close", code, signal); }
}
const wrapper = (script: string) => `OWNER_PROOF:${script}`;
afterEach(() => { vi.useRealTimers(); });

it("requires the trusted wrapper, does not prewarm, and resolves only after actual close", async () => {
  const child = new FakeChild(), factory = vi.fn(() => child), wrap = vi.fn(wrapper);
  const writer = new WhitelistNativeWriter(wrap, factory);
  expect(factory).not.toHaveBeenCalled();
  let complete = false;
  const result = writer.run("FIXED_SCRIPT").then((value) => { complete = true; return value; });
  child.stdout.write('{"ok":true}'); child.emit("exit", 0, null);
  await Promise.resolve(); expect(complete).toBe(false); expect(writer.closedConfirmed).toBe(false);
  expect(wrap).toHaveBeenCalledExactlyOnceWith("FIXED_SCRIPT");
  expect(factory).toHaveBeenCalledExactlyOnceWith("OWNER_PROOF:FIXED_SCRIPT");
  child.finish(); await expect(result).resolves.toEqual({ ok: true });
  expect(writer.closedConfirmed).toBe(true); await writer.close(); expect(child.kills).toBe(0);
  await expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "used" });
});

it.each(["missing", "throw", "empty"])("fails closed for an invalid owner wrapper: %s", async (mode) => {
  const factory = vi.fn(() => new FakeChild());
  const wrap = mode === "missing" ? undefined : mode === "throw" ? () => { throw new Error("SECRET"); } : () => "";
  const writer = new WhitelistNativeWriter(wrap as unknown as (s: string) => string, factory);
  await expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "owner", message: "WHITELIST_WRITER_UNSAFE" });
  expect(factory).not.toHaveBeenCalled(); await writer.close();
  await expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "used" });
});

it.each([[1, null], [null, "SIGTERM"]] as const)("rejects a non-success close after valid JSON (%s/%s)", async (code, signal) => {
  const child = new FakeChild(), writer = new WhitelistNativeWriter(wrapper, () => child);
  const result = expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "exit" });
  child.stdout.write('{"ok":true}'); child.finish(code, signal); await result;
  expect(writer.closedConfirmed).toBe(true); await writer.close();
});

it.each(["stderr", "stdout-error", "stderr-error", "stdin-error", "child-error"])("rejects late %s and requires separate drain", async (event) => {
  const child = new FakeChild(), writer = new WhitelistNativeWriter(wrapper, () => child);
  const result = expect(writer.run("FIXED_SCRIPT")).rejects.toBeInstanceOf(WhitelistWriterError);
  child.stdout.write('{"ok":true}');
  if (event === "stderr") child.stderr.write("SECRET_STDERR");
  else if (event === "child-error") child.emit("error", new Error("SECRET_CHILD"));
  else ({ "stdout-error": child.stdout, "stderr-error": child.stderr, "stdin-error": child.stdin }[event])!.emit("error", new Error("SECRET_STREAM"));
  await result; expect(child.kills).toBe(1); expect(writer.closedConfirmed).toBe(false);
  const drain = writer.close(); child.finish(); await drain; expect(child.kills).toBe(1);
});

it.each(["overflow", "mixed-stream", "invalid-utf8", "trailing-json", "empty"])("rejects bounded protocol violation: %s", async (mode) => {
  const child = new FakeChild(), writer = new WhitelistNativeWriter(wrapper, () => child);
  const result = expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "output" });
  if (mode === "overflow") { child.stdout.write(Buffer.alloc(8192, 32)); child.stdout.write(Buffer.alloc(8193, 32)); }
  if (mode === "mixed-stream") { child.stdout.write(Buffer.alloc(16384, 32)); child.stderr.write(Buffer.alloc(1)); }
  if (mode === "invalid-utf8") child.stdout.write(Buffer.from([0x22, 0xc3, 0x28, 0x22]));
  if (mode === "trailing-json") child.stdout.write('{}{}');
  child.finish(); await result; await writer.close();
});

it("accepts exactly16KiB and split multibyte UTF8 after complete close", async () => {
  const child = new FakeChild(), writer = new WhitelistNativeWriter(wrapper, () => child);
  const bytes = Buffer.from(JSON.stringify("中") + " ".repeat(16379), "utf8");
  expect(bytes.length).toBe(16384);
  const result = writer.run("FIXED_SCRIPT");
  child.stdout.write(bytes.subarray(0, 2)); child.stdout.write(bytes.subarray(2)); child.finish();
  await expect(result).resolves.toBe("中"); await writer.close();
});

it("keeps the original15s limit and a distinct shared5s drain, without retry", async () => {
  vi.useFakeTimers();
  const child = new FakeChild(), factory = vi.fn(() => child), writer = new WhitelistNativeWriter(wrapper, factory);
  const result = expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "timeout" });
  await vi.advanceTimersByTimeAsync(14999); expect(child.kills).toBe(0);
  await vi.advanceTimersByTimeAsync(1); await result; expect(child.kills).toBe(1);
  const first = writer.close(), second = writer.close(); expect(first).toBe(second);
  const drained = expect(first).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(4999); expect(writer.closedConfirmed).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await drained;
  child.stdout.write('{"ok":true}'); child.finish();
  expect(writer.close()).toBe(first); await expect(writer.close()).rejects.toMatchObject({ reason: "cleanup" });
  await expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "used" });
  expect(factory).toHaveBeenCalledOnce(); expect(child.kills).toBe(1);
});

it.each(["wrapper", "factory", "reply", "close"])("checks monotonic deadline after delayed %s even before timer dispatch", async (phase) => {
  let now = 0; const child = new FakeChild(), factory = vi.fn(() => { if (phase === "factory") now = 15000; return child; });
  const writer = new WhitelistNativeWriter((script) => { if (phase === "wrapper") now = 15000; return wrapper(script); }, factory, () => now);
  const result = expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "timeout" });
  if (phase === "reply") { now = 15000; child.stdout.write('{"ok":true}'); }
  if (phase === "close") { child.stdout.write('{"ok":true}'); now = 15000; child.finish(); }
  await result;
  if (phase === "wrapper") { expect(factory).not.toHaveBeenCalled(); await writer.close(); }
  else { const drain = writer.close(); child.finish(); await drain; }
});

it("treats a factory throw after possible child creation as permanently unknown", async () => {
  const orphan = new FakeChild(), writer = new WhitelistNativeWriter(wrapper, () => { void orphan; throw new Error("SECRET_PATH"); });
  await expect(writer.run("SECRET_SCRIPT")).rejects.toMatchObject({ reason: "spawn", message: "WHITELIST_WRITER_UNSAFE" });
  expect(writer.closedConfirmed).toBe(false);
  await expect(writer.close()).rejects.toMatchObject({ reason: "cleanup" });
  expect(orphan.kills).toBe(0); orphan.finish(); expect(writer.closedConfirmed).toBe(false);
  await expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "used" });
});

it.each(["cancel", "close"])("consumes the one shot when %s is called before run", async (method) => {
  const factory = vi.fn(() => new FakeChild()), writer = new WhitelistNativeWriter(wrapper, factory);
  if (method === "cancel") writer.cancel(); else await writer.close();
  await expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "used" });
  expect(factory).not.toHaveBeenCalled(); expect(writer.closedConfirmed).toBe(true);
});

it("cancels during factory return without dispatch or a second kill", async () => {
  const child = new FakeChild(), end = vi.spyOn(child.stdin, "end");
  const writer = new WhitelistNativeWriter(wrapper, () => { writer.cancel(); return child; });
  await expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "cancelled" });
  expect(end).not.toHaveBeenCalled(); expect(child.kills).toBe(1);
  const drain = writer.close(); writer.cancel(); child.stdout.write('{"ok":true}'); child.finish(); await drain;
  expect(child.kills).toBe(1);
});

it("cannot turn a late close into a successful cleanup when its timer was delayed", async () => {
  let now = 0; const child = new FakeChild(), writer = new WhitelistNativeWriter(wrapper, () => child, () => now);
  const result = expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "cancelled" });
  const drain = expect(writer.close()).rejects.toMatchObject({ reason: "cleanup" });
  now = 5000; child.finish(); await result; await drain;
});

it.each([false, true])("includes synchronous kill cost in the shared cleanup limit (closes=%s)", async (closes) => {
  let now = 0; const child = new FakeChild();
  child.kill = () => { child.kills++; now = 5000; if (closes) child.finish(); return true; };
  const writer = new WhitelistNativeWriter(wrapper, () => child, () => now);
  const result = expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "cancelled" });
  const first = writer.close(); await expect(first).rejects.toMatchObject({ reason: "cleanup" }); await result;
  expect(writer.close()).toBe(first); expect(child.kills).toBe(1);
  child.finish(); await expect(writer.close()).rejects.toMatchObject({ reason: "cleanup" });
});

it("does not include native error/output/script or cause in fixed errors", async () => {
  const child = new FakeChild(), writer = new WhitelistNativeWriter(wrapper, () => child);
  const result = writer.run("SECRET_SCRIPT").catch((error: unknown) => error);
  child.stderr.write("SECRET_STDERR"); const error = await result;
  expect(error).toBeInstanceOf(WhitelistWriterError);
  expect(JSON.stringify(error)).not.toMatch(/SECRET/u); expect(String(error)).not.toMatch(/SECRET/u);
  expect(error).not.toHaveProperty("cause");
  const drain = writer.close(); child.finish(); await drain;
});

it("publishes the one shared close promise before kill can synchronously reenter", async () => {
  const child = new FakeChild(); let reentered: Promise<void> | undefined;
  const writer = new WhitelistNativeWriter(wrapper, () => child);
  child.kill = () => { child.kills++; reentered = writer.close(); child.finish(); return true; };
  const result = expect(writer.run("FIXED_SCRIPT")).rejects.toMatchObject({ reason: "cancelled" });
  const drain = writer.close(); expect(reentered).toBe(drain); await drain; await result; expect(child.kills).toBe(1);
});
