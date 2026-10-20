import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compilerVerifiedSignerScript } from "./fixtures/compiled-verified-signer.js";

describe("verified signer evidence wrapper", () => {
  it("serializes the actual wrapper write expression as valid JSON plus one LF", () => {
    const source = readFileSync(new URL("../../../tests/acceptance/lc2-verified-signer-observation.mjs", import.meta.url), "utf8");
    const expression = /reportFile\.writeFile\((.+), "utf8"\)/u.exec(source)?.[1];
    expect(expression).toBeDefined();
    const report = { version: 1, compilerTrust: "pending", compilerExecuted: false };
    const serialized: unknown = runInNewContext(expression!, { report }, { timeout: 1000 });
    expect(typeof serialized).toBe("string");
    expect(JSON.parse(serialized as string)).toEqual(report);
    expect((serialized as string).endsWith(String.fromCharCode(10))).toBe(true);
    expect((serialized as string).endsWith("\\n")).toBe(false);
  });
  it("keeps the real assembled EncodedCommand within the Windows limit", () => {
    const executable = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(compilerVerifiedSignerScript(), "utf16le").toString("base64")];
    const units = executable.length + 3 + args.reduce((sum, arg) => sum + arg.length + 3, 0);
    expect(units).toBeLessThanOrEqual(32767);
  });
});
