import { EventEmitter } from "node:events";
import { execFile, type ChildProcess, type ExecFileException } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVerifiedSignerObservation } from "./fixtures/compiled-verified-signer-runner.js";

function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: { destroy: vi.fn() }, stdout: { destroy: vi.fn() }, stderr: { destroy: vi.fn() }, unref: vi.fn() });
  let callback: (error: ExecFileException | null, stdout: string, stderr: string) => void = () => { throw new Error("NOT_STARTED"); };
  const execute = vi.fn((...args: unknown[]) => { callback = args[3] as typeof callback; return child as unknown as ChildProcess; });
  return { child, execute, start: () => runVerifiedSignerObservation("fixture-root", execute as unknown as typeof execFile),
    reply: (output: string) => callback(null, output, "PRIVATE_HELPER_STDERR") };
}
const failure = JSON.stringify({ version: 1, scope: "VERIFIED_SIGNER_OBSERVATION_ONLY", category: "verified-signer-unavailable",
  winVerifyTrustStatus: 0, compilerSha256: "a".repeat(64), bytes: 4096,
  embeddedMicrosoftName: null, embeddedCodeSigningEku: null, stateClosed: true, compilerTrust: "pending",
  verifiedSignatureIndex: 0, verifiedSignerObserved: false, microsoftRootPolicyChecked: false,
  microsoftRootPolicyStatus: null, subjectDer: null, ekuDer: [] });
afterEach(() => { vi.useRealTimers(); });

describe("unwired verified-signer Fake runner", () => {
  it("dispatches only the new fixed script, redacts internal fields and waits for close", async () => {
    const f = fixture(); const promise = f.start();
    const [command, args, options] = f.execute.mock.calls[0]!;
    expect(command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    const argv = args as string[];
    const source = Buffer.from(argv[4]!, "base64").toString("utf16le");
    expect(source).toContain("VERIFIED_SIGNER_OBSERVATION_ONLY");
    expect(source).not.toContain("CreateFromSignedFile");
    expect(options).toMatchObject({ shell: false, timeout: 15000, maxBuffer: 16384 });
    f.reply(failure); f.child.emit("close", 0, null);
    const result = await promise;
    expect(result).toMatchObject({ helperClosed: true, observation: { compilerTrust: "pending", policyObservationComplete: false } });
    expect(JSON.stringify(result)).not.toMatch(/subjectDer|ekuDer|PRIVATE_HELPER_STDERR/u);
  });
  it("retains uncertainty after no close and a late successful-looking callback", async () => {
    vi.useFakeTimers(); const f = fixture(); const promise = f.start();
    await vi.advanceTimersByTimeAsync(20000);
    const result = await promise;
    f.reply(failure); f.child.emit("close", 0, null);
    expect(result).toMatchObject({ category: "CLEANUP_BLOCKED", helperClosed: false, exitCode: null, observation: null });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.child.unref).toHaveBeenCalledTimes(1);
  });
  it("rejects raw output with fixed metadata and no retry", async () => {
    const f = fixture(); const promise = f.start(); f.reply("PRIVATE_RAW_OUTPUT"); f.child.emit("close", 0, null);
    expect(await promise).toMatchObject({ category: "helper-output-rejected", observation: null });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
});
