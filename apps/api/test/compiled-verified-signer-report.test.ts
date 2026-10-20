import { describe, expect, it } from "vitest";
import { parseVerifiedSignerReport } from "./fixtures/compiled-verified-signer-report.js";

const tlv = (tag: number, bytes: Buffer) => Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
const subject = () => {
  const fields = [["550403", "Microsoft Corporation"], ["55040a", "Microsoft Corporation"], ["550407", "Redmond"], ["550408", "Washington"], ["550406", "US"]];
  const bytes = Buffer.concat(fields.map(([oid, value]) => tlv(0x31, tlv(0x30,
    Buffer.concat([tlv(6, Buffer.from(oid!, "hex")), tlv(0x0c, Buffer.from(value!, "ascii"))])))));
  return (bytes.length < 128 ? tlv(0x30, bytes) : Buffer.concat([Buffer.from([0x30, 0x81, bytes.length]), bytes])).toString("base64");
};
const report = () => ({ version: 1, scope: "VERIFIED_SIGNER_OBSERVATION_ONLY", category: "offline-signature-observed",
  winVerifyTrustStatus: 0, compilerSha256: "a".repeat(64), bytes: 4096,
  embeddedMicrosoftName: null, embeddedCodeSigningEku: null, stateClosed: true, compilerTrust: "pending",
  verifiedSignatureIndex: 0, verifiedSignerObserved: true, microsoftRootPolicyChecked: true,
  microsoftRootPolicyStatus: "00000000", subjectDer: subject(), ekuDer: [Buffer.from("300a06082b06010505070303", "hex").toString("base64")] });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("unwired verified-signer redacting consumer", () => {
  it("redacts DER even for a fully positive forged observation and never grants trust", () => {
    const row = report(); const result = parseVerifiedSignerReport(encode(row));
    expect(result).toMatchObject({ policyObservationComplete: true, subjectMatches: true, ekuMatches: true, compilerTrust: "pending" });
    expect(result).not.toHaveProperty("subjectDer"); expect(result).not.toHaveProperty("ekuDer");
    expect(JSON.stringify(result)).not.toContain(row.subjectDer);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each([{ stateClosed: false }, { winVerifyTrustStatus: 1 }, { microsoftRootPolicyChecked: false },
    { microsoftRootPolicyStatus: "800b0109" }, { verifiedSignatureIndex: null },
    { category: "cleanup-uncertain" }, { ekuDer: [] }])("cannot complete with missing gate %j", (patch) => {
    expect(parseVerifiedSignerReport(encode({ ...report(), ...patch })).policyObservationComplete).toBe(false);
  });
  it.each([{ compilerTrust: "trusted" }, { verifiedSignatureIndex: 1 }, { rawStderr: "SECRET" },
    { subjectDer: "%%%" }, { subjectDer: "YQ" }, { subjectDer: Buffer.alloc(4097).toString("base64") },
    { embeddedMicrosoftName: true }, { microsoftRootPolicyStatus: "0" },
    { verifiedSignerObserved: "true" }, { ekuDer: ["%%%"] }])("rejects unsupported evidence %j", (patch) => {
    expect(() => parseVerifiedSignerReport(encode({ ...report(), ...patch }))).toThrow("VERIFIED_SIGNER_OBSERVATION_UNSAFE");
  });
  it("accepts fixed failure metadata without revealing internal fields", () => {
    const result = parseVerifiedSignerReport(encode({ ...report(), category: "verified-signer-unavailable",
      verifiedSignerObserved: false, subjectDer: null, ekuDer: [] }));
    expect(result).toMatchObject({ policyObservationComplete: false, compilerTrust: "pending", subjectMatches: false });
  });
  it("rejects duplicate JSON keys, BOM and malformed UTF8 without returning raw data", () => {
    const valid = JSON.stringify(report());
    for (const bytes of [Buffer.from(`{"version":1,${valid.slice(1)}`), Buffer.from(`\ufeff${valid}`),
      Buffer.from(` \ufeff${valid}`), Buffer.from(`${valid}\ufeff`), Buffer.from(` ${valid}`),
      Buffer.from(`${valid} `), Buffer.from(`${valid}\n\n`), Buffer.from([0xff]), Buffer.alloc(16385)]) {
      expect(() => parseVerifiedSignerReport(bytes)).toThrow(/^VERIFIED_SIGNER_OBSERVATION_UNSAFE$/u);
    }
  });
  it("accepts only the optional single PowerShell LF/CRLF terminator", () => {
    for (const suffix of ["", "\n", "\r\n"]) {
      expect(parseVerifiedSignerReport(Buffer.from(`${JSON.stringify(report())}${suffix}`)).policyObservationComplete).toBe(true);
    }
  });
});
