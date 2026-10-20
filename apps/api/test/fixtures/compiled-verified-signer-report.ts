import { TextDecoder } from "node:util";
import { parseCompilerObservation } from "./compiled-compiler-observation.js";
import { matchesCompiledCodeSigningEku, matchesCompiledPublisherSubject } from "./compiled-publisher-subject.js";

const names = ["version", "scope", "category", "winVerifyTrustStatus", "compilerSha256", "bytes",
  "embeddedMicrosoftName", "embeddedCodeSigningEku", "stateClosed", "compilerTrust",
  "verifiedSignatureIndex", "verifiedSignerObserved", "microsoftRootPolicyChecked",
  "microsoftRootPolicyStatus", "subjectDer", "ekuDer"].sort();
const categories = ["unavailable", "signature-rejected", "offline-signature-observed",
  "identity-uncertain", "observation-unavailable", "cleanup-uncertain", "verified-signer-unavailable"];
const fail = (): never => { throw new Error("VERIFIED_SIGNER_OBSERVATION_UNSAFE"); };
const decode = (value: unknown, maximum: number): Buffer => {
  if (typeof value !== "string" || value.length === 0 || value.length > 4 * Math.ceil(maximum / 3)) return fail();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maximum || bytes.toString("base64") !== value) return fail();
  return bytes;
};

/** UNWIRED. Consumes bounded internal certificate fields but returns no DER,
 * names, pointers, paths, raw output or errors. Shape/policy observations remain
 * forgeable supplied data and can never grant compiler trust or build authority. */
export function parseVerifiedSignerReport(bytes: Buffer) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > 16384) return fail();
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (decoded.includes("\ufeff")) return fail();
    const text = decoded.endsWith("\r\n") ? decoded.slice(0, -2) : decoded.endsWith("\n") ? decoded.slice(0, -1) : decoded;
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value) !== text) return fail();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== names.join(",") || row.scope !== "VERIFIED_SIGNER_OBSERVATION_ONLY" ||
      typeof row.category !== "string" || !categories.includes(row.category) ||
      row.embeddedMicrosoftName !== null || row.embeddedCodeSigningEku !== null ||
      (row.verifiedSignatureIndex !== null && row.verifiedSignatureIndex !== 0) ||
      typeof row.verifiedSignerObserved !== "boolean" || typeof row.microsoftRootPolicyChecked !== "boolean" ||
      (row.microsoftRootPolicyStatus !== null && (typeof row.microsoftRootPolicyStatus !== "string" ||
        !/^[0-9a-f]{8}$/u.test(row.microsoftRootPolicyStatus))) ||
      !Array.isArray(row.ekuDer) || row.ekuDer.length > 4) return fail();
    // Reuse the frozen base SHAPE checks only. The synthetic failure category
    // avoids importing its independent embedded-certificate success semantics.
    const base = parseCompilerObservation(Buffer.from(JSON.stringify({
      version: row.version, scope: "OFFLINE_SIGNATURE_OBSERVATION_ONLY", category: "observation-unavailable",
      winVerifyTrustStatus: row.winVerifyTrustStatus, compilerSha256: row.compilerSha256, bytes: row.bytes,
      embeddedMicrosoftName: null, embeddedCodeSigningEku: null, stateClosed: row.stateClosed, compilerTrust: row.compilerTrust,
    })));
    let subjectMatches = false; let ekuMatches = false;
    if (row.subjectDer !== null) {
      const subject = decode(row.subjectDer, 4096);
      const eku = row.ekuDer.map((item) => decode(item, 128));
      subjectMatches = matchesCompiledPublisherSubject(subject);
      ekuMatches = matchesCompiledCodeSigningEku(eku);
    } else if (row.ekuDer.length !== 0 || row.verifiedSignerObserved) return fail();
    const complete = row.category === "offline-signature-observed" && base.winVerifyTrustStatus === 0 &&
      base.stateClosed && row.verifiedSignatureIndex === 0 && row.verifiedSignerObserved &&
      row.microsoftRootPolicyChecked && row.microsoftRootPolicyStatus === "00000000" &&
      base.compilerSha256 !== null && base.bytes !== null;
    return Object.freeze({ version: 1 as const, scope: "VERIFIED_SIGNER_OBSERVATION_ONLY" as const,
      category: row.category, winVerifyTrustStatus: base.winVerifyTrustStatus,
      compilerSha256: base.compilerSha256, bytes: base.bytes, stateClosed: base.stateClosed,
      verifiedSignatureIndex: row.verifiedSignatureIndex, verifiedSignerObserved: row.verifiedSignerObserved,
      microsoftRootPolicyChecked: row.microsoftRootPolicyChecked, microsoftRootPolicyStatus: row.microsoftRootPolicyStatus,
      subjectMatches, ekuMatches, policyObservationComplete: Boolean(complete && subjectMatches && ekuMatches),
      compilerTrust: "pending" as const });
  } catch { return fail(); }
}
