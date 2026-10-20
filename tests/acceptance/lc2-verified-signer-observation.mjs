// SOURCE CANDIDATE ONLY until independent pre-run review. No compiler is run.
import { randomUUID } from "node:crypto";
import { mkdir, open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runVerifiedSignerObservation } from "../../apps/api/test/fixtures/compiled-verified-signer-runner.ts";

const confirmation = "--confirm-verified-signer-observation-only";
if (process.argv.length !== 3 || process.argv[2] !== confirmation) {
  console.error("COMPILER_OBSERVATION_CONFIRMATION_REQUIRED");
  process.exitCode = 2;
} else if (process.platform !== "win32" || process.arch !== "x64") {
  console.error("COMPILER_OBSERVATION_PLATFORM_UNSUPPORTED");
  process.exitCode = 2;
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const evidence = join(root, "test-results");
  const runId = `lc2-verified-signer-observation-${randomUUID()}`;
  // Only writes an exclusive ignored report, never a native artifact/config.
  // Output report paths are internal; the CLI cannot choose a compiler/path.
  const canonicalRoot = await realpath(root);
  await mkdir(evidence, { recursive: true });
  const canonicalEvidence = await realpath(evidence);
  if (canonicalEvidence.toLowerCase() !== join(canonicalRoot, "test-results").toLowerCase()) {
    throw new Error("COMPILER_OBSERVATION_EVIDENCE_BOUNDARY_UNSAFE");
  }
  console.log(`CONFIRMED EVIDENCE CANONICAL PATH: ${canonicalEvidence}`);
  const outcome = await runVerifiedSignerObservation(canonicalRoot);
  const report = { version: 1, runId, scope: "VERIFIED_SIGNER_OBSERVATION_ONLY",
    ...outcome,
    compilerTrust: "pending", compilerExecuted: false, artifactCreated: false,
    originalUserWorldAccessed: false };
  const reportFile = await open(join(canonicalEvidence, `${runId}.json`), "wx", 0o600);
  try { await reportFile.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8"); await reportFile.sync(); }
  finally { await reportFile.close(); }
  console.log(JSON.stringify(report, null, 2));
  // Observations never make D3 or LC2 PASS. Nonzero for any diagnostic uncertainty.
  if (outcome.category !== "observation-recorded" || outcome.observation?.category !== "offline-signature-observed" ||
    outcome.observation?.stateClosed !== true || outcome.observation?.policyObservationComplete !== true || outcome.exitCode !== 0 || outcome.exitSignal !== null) process.exitCode = 1;
}
