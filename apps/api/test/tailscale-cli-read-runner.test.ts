import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const control = vi.hoisted(() => ({ calls: [] as { file: string; args: string[]; shell: boolean }[], mode: "ok", kills: 0, linked: false }));
vi.mock("node:fs/promises", () => ({
  lstat: async () => ({ dev: 1, ino: 1, size: 256, mtimeMs: 1, nlink: 1, isFile: () => true, isSymbolicLink: () => control.linked }),
  realpath: async (file: string) => file, readFile: async () => Buffer.from("synthetic-signed-binary")
}));
vi.mock("node:child_process", () => ({ spawn: (file: string, args: string[], options: { shell: boolean }) => {
  control.calls.push({ file, args, shell: options.shell });
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => {
    control.kills++; if (control.mode !== "no-close") queueMicrotask(() => child.emit("close", null, "SIGTERM")); return true;
  } });
  queueMicrotask(() => {
    if (control.mode === "timeout" || control.mode === "no-close") return;
    if (control.mode === "spawn") { child.emit("error", new Error("SECRET PATH")); child.emit("close", -1, null); return; }
    const signature = file.endsWith("powershell.exe");
    child.stdout.emit("data", Buffer.from(signature ? JSON.stringify({ approved: control.mode !== "untrusted" }) : control.mode === "overflow" ? "x".repeat(65537) : "1.98.8"));
    child.emit("close", control.mode === "exit" ? 1 : 0, null);
  });
  return child;
} }));
import { WindowsTailscaleReadRunner } from "../src/services/tailscale-cli-read-runner.js";
afterEach(() => { vi.useRealTimers(); control.calls = []; control.mode = "ok"; control.kills = 0; control.linked = false; });
it.skipIf(process.platform !== "win32")("uses only fixed absolute executable, bounded signature query and fixed argv", async () => {
  expect(await new WindowsTailscaleReadRunner().run("version")).toBe("1.98.8");
  expect(control.calls).toHaveLength(2); expect(control.calls.every((call) => call.shell === false)).toBe(true);
  expect(control.calls[1]).toMatchObject({ file: "C:\\Program Files\\Tailscale\\tailscale.exe", args: ["version"] });
});
it.skipIf(process.platform !== "win32")("rejects unknown command without process execution", async () => {
  await expect(new WindowsTailscaleReadRunner().run("reset" as "version")).rejects.toMatchObject({ code: "TAILSCALE_CLI_UNSUPPORTED" }); expect(control.calls).toHaveLength(0);
});
it.skipIf(process.platform !== "win32")("rejects a linked executable before invoking it", async () => {
  control.linked = true; await expect(new WindowsTailscaleReadRunner().run("version")).rejects.toMatchObject({ code: "TAILSCALE_EXECUTABLE_UNTRUSTED" }); expect(control.calls).toHaveLength(0);
});
it.skipIf(process.platform !== "win32")("rejects an unsigned/untrusted executable without invoking CLI", async () => {
  control.mode = "untrusted"; await expect(new WindowsTailscaleReadRunner().run("version")).rejects.toMatchObject({ code: "TAILSCALE_EXECUTABLE_UNTRUSTED" }); expect(control.calls).toHaveLength(1);
});
it.skipIf(process.platform !== "win32")("redacts spawn and exit failures", async () => {
  control.mode = "spawn"; await expect(new WindowsTailscaleReadRunner().run("version")).rejects.toMatchObject({ code: "TAILSCALE_SPAWN_FAILED", message: "Tailscale read-only check unavailable." });
  control.mode = "exit"; await expect(new WindowsTailscaleReadRunner().run("version")).rejects.toMatchObject({ code: "TAILSCALE_EXIT_FAILED" });
});
it.skipIf(process.platform !== "win32")("bounds output and confirms owned close after termination", async () => {
  control.mode = "overflow"; await expect(new WindowsTailscaleReadRunner().run("version")).rejects.toMatchObject({ code: "TAILSCALE_OUTPUT_LIMIT" }); expect(control.kills).toBe(1);
});
it.skipIf(process.platform !== "win32")("retains timeout result after successful close", async () => {
  vi.useFakeTimers(); control.mode = "timeout"; const result = new WindowsTailscaleReadRunner().run("version").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(15001); expect(await result).toMatchObject({ code: "TAILSCALE_TIMEOUT" }); expect(control.kills).toBe(1);
});
it.skipIf(process.platform !== "win32")("cleanup uncertainty permanently blocks this runner, without killing unknown processes", async () => {
  vi.useFakeTimers(); control.mode = "no-close"; const runner = new WindowsTailscaleReadRunner(); const result = runner.run("version").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(20001); expect(await result).toMatchObject({ code: "TAILSCALE_CLEANUP_BLOCKED" });
  const calls = control.calls.length; await expect(runner.run("version")).rejects.toMatchObject({ code: "TAILSCALE_CLEANUP_BLOCKED" }); expect(control.calls).toHaveLength(calls); expect(control.kills).toBe(1);
});
