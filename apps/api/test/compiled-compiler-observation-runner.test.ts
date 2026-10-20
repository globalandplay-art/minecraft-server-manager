import { EventEmitter } from "node:events";
import { type ChildProcess, type ExecFileException, execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCompilerObservation } from "./fixtures/compiled-compiler-observation-runner.js";

function fixture() {
  const events = Object.assign(new EventEmitter(), {
    stdin: { destroy: vi.fn() }, stdout: { destroy: vi.fn() }, stderr: { destroy: vi.fn() }, unref: vi.fn(),
  });
  let callback: (error: ExecFileException | null, stdout: string, stderr: string) => void = () => { throw new Error("NOT_STARTED"); };
  const execute = vi.fn((...args: unknown[]) => {
    callback = args[3] as typeof callback;
    return events as unknown as ChildProcess;
  });
  const start = () => runCompilerObservation("fixture-root", execute as unknown as typeof execFile);
  return { events, execute, start, reply: (error: ExecFileException | null, stdout = "") => callback(error, stdout, "SECRET_STDERR") };
}
const payload = JSON.stringify({ version: 1, scope: "OFFLINE_SIGNATURE_OBSERVATION_ONLY",
  category: "offline-signature-observed", winVerifyTrustStatus: 0, compilerSha256: "a".repeat(64),
  bytes: 4096, embeddedMicrosoftName: true, embeddedCodeSigningEku: true, stateClosed: true, compilerTrust: "pending" });
afterEach(() => { vi.useRealTimers(); });

describe("compiler observation Fake CLI boundary", () => {
  it("uses fixed arguments and isolated environment, records only after close", async () => {
    const f = fixture(); const promise = f.start();
    const [command, args, options] = f.execute.mock.calls[0]!;
    expect(command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(args).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", expect.any(String)]);
    expect(options).toMatchObject({ shell: false, timeout: 15000, maxBuffer: 16384, windowsHide: true,
      env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PSModulePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules" } });
    let finished = false; void promise.then(() => { finished = true; });
    f.reply(null, payload); await Promise.resolve(); expect(finished).toBe(false);
    f.events.emit("close", 0, null);
    const result = await promise;
    expect(result).toMatchObject({ category: "observation-recorded", helperClosed: true, exitCode: 0,
      observation: { compilerTrust: "pending" } });
    expect(JSON.stringify(result)).not.toContain("SECRET_STDERR");
  });
  it("does not turn a termination request into exit proof", async () => {
    vi.useFakeTimers(); const f = fixture(); const promise = f.start();
    f.reply(Object.assign(new Error("SECRET_ERROR"), { killed: true }));
    await vi.advanceTimersByTimeAsync(20000);
    const result = await promise;
    expect(result).toMatchObject({ category: "CLEANUP_BLOCKED", helperClosed: false,
      exitCode: null, exitSignal: null, terminationRequested: true, observation: null });
    expect(f.events.unref).toHaveBeenCalledTimes(1);
    f.events.emit("close", 0, null); f.reply(null, payload);
    expect(result.helperClosed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET_ERROR");
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("accepts actual failure close without retry or leaking helper output", async () => {
    const f = fixture(); const promise = f.start();
    f.reply(Object.assign(new Error("SECRET_ERROR"), { code: 1 })); f.events.emit("close", 1, null);
    expect(await promise).toEqual({ category: "helper-failed", observation: null, exitCode: 1,
      exitSignal: null, terminationRequested: false, helperClosed: true });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed output with a fixed classification", async () => {
    const f = fixture(); const promise = f.start(); f.reply(null, "SECRET_OUTPUT"); f.events.emit("close", 0, null);
    expect(await promise).toMatchObject({ category: "helper-output-rejected", observation: null });
  });
  it("reports a launch throw as uncertain without raw errors", async () => {
    const execute = vi.fn(() => { throw new Error("SECRET_START_ERROR"); });
    const result = await runCompilerObservation("fixture-root", execute as unknown as typeof execFile);
    expect(result).toMatchObject({ category: "helper-start-failed", helperClosed: false, exitCode: null });
    expect(JSON.stringify(result)).not.toContain("SECRET_START_ERROR");
  });
  it("does not infer a callback result from close alone", async () => {
    const f = fixture(); const promise = f.start(); f.events.emit("close", 0, null);
    expect(await promise).toMatchObject({ category: "helper-unavailable", observation: null, helperClosed: true });
  });
});
