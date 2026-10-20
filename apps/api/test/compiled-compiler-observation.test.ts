import { describe, expect, it } from "vitest";
import { compilerObservationScript, parseCompilerObservation } from "./fixtures/compiled-compiler-observation.js";

const observation = () => ({ version: 1, scope: "OFFLINE_SIGNATURE_OBSERVATION_ONLY",
  category: "offline-signature-observed", winVerifyTrustStatus: 0,
  compilerSha256: "a".repeat(64), bytes: 4096, embeddedMicrosoftName: true,
  embeddedCodeSigningEku: true, stateClosed: true, compilerTrust: "pending" });
const encode = (row: unknown) => Buffer.from(JSON.stringify(row));

describe("unwired compiler observation", () => {
  it("cannot elevate even fully positive observations into compiler trust", () => {
    const value = parseCompilerObservation(encode(observation()));
    expect(value.compilerTrust).toBe("pending");
    expect(Object.isFrozen(value)).toBe(true);
  });
  it.each([
    { compilerTrust: "trusted" }, { winVerifyTrustStatus: 1 }, { stateClosed: false },
    { embeddedMicrosoftName: null }, { bytes: 0 }, { bytes: 33554433 },
    { compilerSha256: "A".repeat(64) }, { category: "success" },
    { rawStderr: "secret" }, { winVerifyTrustStatus: 2147483648 },
  ])("rejects unsafe observations without echoing data: %j", (patch) => {
    expect(() => parseCompilerObservation(encode({ ...observation(), ...patch }))).toThrow("COMPILER_OBSERVATION_UNSAFE");
  });
  it("retains exact signed LONG failure without changing it into success", () => {
    const value = parseCompilerObservation(encode({ ...observation(), category: "signature-rejected", winVerifyTrustStatus: -2146762487 }));
    expect(value.winVerifyTrustStatus).toBe(-2146762487);
    expect(value.compilerTrust).toBe("pending");
  });
  it.each([Buffer.from("secret"), Buffer.alloc(16385), Buffer.from([0xff])])("redacts malformed helper output", (bytes) => {
    expect(() => parseCompilerObservation(bytes)).toThrow(/^COMPILER_OBSERVATION_UNSAFE$/u);
  });
  it("has fixed offline read-only payload and no compiler invocation", () => {
    const source = compilerObservationScript();
    expect(source).toContain("WriteInt32($data, 72, 0x3010)");
    expect(source).toContain("[IO.FileShare]::Read");
    expect(source).toContain("WriteInt32($data, 48, 2)");
    expect(source).toContain("if (-not $stateMayReferenceBuffers)");
    expect(source).not.toMatch(/Add-Type|Start-Process|Invoke-Expression|Invoke-WebRequest|DownloadString/u);
    expect(source.match(/compilerTrust='pending'/gu)).toHaveLength(1);
    expect(source).not.toContain("$_.Exception");
    expect(compilerObservationScript()).toBe(source);
  });
});
