import { describe, expect, it } from "vitest";
import { compilerObservationScript } from "./fixtures/compiled-compiler-observation.js";
import { compilerVerifiedSignerScript } from "./fixtures/compiled-verified-signer.js";

describe("unexecuted verified-signer source candidate", () => {
  it("selects and verifies actual primary signer instead of unrelated embedded certificate", () => {
    const source = compilerVerifiedSignerScript();
    expect(source).toContain("WriteInt32($signatureSettings, 16, -1)");
    expect(source).toContain("ReadInt32($signatureSettings, 16) -ne 0");
    expect(source).toContain("WTHelperGetProvSignerFromChain");
    expect(source).toContain("WriteInt32($policyPara, 4, 0x60000)");
    expect(source).toContain("$checked -eq 0 -or $result.microsoftRootPolicyStatus -cne '00000000'");
    expect(source).not.toContain("CreateFromSignedFile");
    expect(source).not.toContain("GetNameInfo");
    expect(source).not.toMatch(/Add-Type|Start-Process|Invoke-Expression|CertGetCertificateChain/u);
  });
  it("retains offline flags, lifetime cleanup and original source unchanged", () => {
    const original = compilerObservationScript(); const source = compilerVerifiedSignerScript();
    expect(source).toContain("WriteInt32($data, 72, 0x3010)");
    expect(source).toContain("@($policyPara, $policyStatus, $signatureSettings, $action, $data, $fileInfo, $pathBuffer)");
    expect(source).toContain("GCHandle]::Alloc($file");
    expect(source).toContain("compilerTrust='pending'");
    expect(compilerObservationScript()).toBe(original);
    expect(compilerVerifiedSignerScript()).toBe(source);
  });
});
