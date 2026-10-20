import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { WINDOWS_OWNER_RETENTION_NATIVE } from "../../src/auth/windows-owner-retention-native.js";
import { wrapWithNativeOwnerRetention } from "../../src/auth/windows-owner-retention.js";

it("preserves the native source and all 32 full scripts captured before extraction", async () => {
  const baseline = JSON.parse(await readFile(new URL("../fixtures/windows-owner-retention-parity.json", import.meta.url), "utf8")) as {
    scope: string; sourceBytes: number; sourceSha256: string;
    wrappers: { variant: number; bytes: number; sha256: string }[];
  };
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  expect(baseline.scope).toBe("SYNTHETIC_PROOFS_BEFORE_SOURCE_EXTRACTION");
  expect(Buffer.byteLength(WINDOWS_OWNER_RETENTION_NATIVE)).toBe(baseline.sourceBytes);
  expect(hash(WINDOWS_OWNER_RETENTION_NATIVE)).toBe(baseline.sourceSha256);
  expect(baseline.wrappers).toHaveLength(32);
  for (let i = 0; i < 32; i++) {
    const proof = {
      root: `C:\\isolated-retention-parity\\case-${i}`, nodePid: 100 + i,
      directoryHandle: String(1000 + i), fileHandle: String(2000 + i),
      processIdentity: (i + 1).toString(16).toUpperCase().padStart(16, "0"),
      directoryIdentity: (i + 2).toString(16).toUpperCase().padStart(40, "0"),
      fileIdentity: (i + 3).toString(16).toUpperCase().padStart(40, "0")
    };
    const script = wrapWithNativeOwnerRetention(`# FIXED_PARITY_${i}`, proof);
    expect(baseline.wrappers[i]?.variant).toBe(i);
    expect(Buffer.byteLength(script)).toBe(baseline.wrappers[i]?.bytes);
    expect(hash(script)).toBe(baseline.wrappers[i]?.sha256);
    expect(script.match(/Add-Type -TypeDefinition @'\n([\s\S]*?)\n'@\n/u)?.[1]).toBe(WINDOWS_OWNER_RETENTION_NATIVE);
  }
});
