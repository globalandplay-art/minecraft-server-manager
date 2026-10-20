// Synthetic self-owned memory only. No real signature/compiler/worker operation.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compiledSignerMemoryScript } from "../../apps/api/test/fixtures/compiled-signer-memory.ts";

if (process.argv.length !== 3 || process.argv[2] !== "--confirm-synthetic-memory-only" || process.platform !== "win32" || process.arch !== "x64") {
  console.error("SYNTHETIC_MEMORY_CONFIRMATION_OR_PLATFORM_UNSAFE");
  process.exitCode = 2;
} else {
  const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const evidence = await realpath(join(root, "test-results"));
  if (evidence.toLowerCase() !== join(root, "test-results").toLowerCase()) throw new Error("MEMORY_EVIDENCE_BOUNDARY_UNSAFE");
  console.log("CONFIRMED SYNTHETIC EVIDENCE CANONICAL PATH: " + evidence);
  const runId = "lc2-signer-memory-" + randomUUID();
  const scriptFile = join(evidence, runId + ".ps1");
  const source = compiledSignerMemoryScript();
  const handle = await open(scriptFile, "wx", 0o600);
  try { await handle.writeFile(source, "utf8"); await handle.sync(); } finally { await handle.close(); }
  let category = "helper-unavailable";
  let summary = null;
  let exitCode = null;
  let exitSignal = null;
  let helperClosed = false;
  let helperFailed = false;
  const caseNames = ["valid","index-unwritten","index-other","state-null","provider-null","signer-null","signer-size","signer-error","chain-zero","chain-over","chain-null","leaf-null","leaf-size","leaf-error","context-null","policy-false","policy-error","policy-unwritten","subject-over","eku-over","eku-count","close-failure"];
  const classifications = ["NONE","UNEXPECTED","signature-index-unknown","provider-unknown","signer-unknown","chain-unknown","leaf-unknown","root-policy-rejected","subject-unsupported","eku-unsupported"];
  let settled = false;
  await new Promise((done) => {
    const child = execFile("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",scriptFile], {
        cwd: root, windowsHide: true, shell: false, timeout: 15000, maxBuffer: 16384, encoding: "utf8",
        env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PSModulePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules" },
      }, (error, stdout) => {
        if (settled) return;
        helperFailed = error !== null;
        try {
          const row = JSON.parse(stdout);
          if (row.scope !== "SYNTHETIC_MEMORY_ONLY" || row.compilerExecuted !== false || row.signatureVerified !== false || row.compilerTrust !== "pending" ||
            !Array.isArray(row.summaries) || row.caseCount !== row.summaries.length || row.caseCount < 1 || row.caseCount > caseNames.length ||
            typeof row.passed !== "boolean") throw 0;
          const rows = row.summaries.map((item, index) => {
            if (item.case !== caseNames[index] || typeof item.passed !== "boolean" || !classifications.includes(item.classification) ||
              ![0,1].includes(item.managedDisposed) || ![0,1].includes(item.disposedAtClose) || item.closeCalls !== 1 ||
              ![0,5,7].includes(item.ownedFreed) || ![0,1].includes(item.fileDisposed) || typeof item.retainedUntilProcessExit !== "boolean") throw 0;
            return { case: item.case, passed: item.passed, classification: item.classification, managedDisposed: item.managedDisposed,
              disposedAtClose: item.disposedAtClose, closeCalls: item.closeCalls, ownedFreed: item.ownedFreed,
              fileDisposed: item.fileDisposed, retainedUntilProcessExit: item.retainedUntilProcessExit };
          });
          const passed = rows.length === caseNames.length && rows.every((item) => item.passed);
          if (row.passed !== passed) throw 0;
          summary = { scope: "SYNTHETIC_MEMORY_ONLY", caseCount: rows.length, passed, summaries: rows,
            compilerExecuted: false, signatureVerified: false, compilerTrust: "pending" };
          category = helperFailed ? "synthetic-helper-failed" : "synthetic-result-recorded";
        } catch { category = "synthetic-output-rejected"; }
      });
    const drain = setTimeout(() => {
      if (settled) return;
      settled = true; category = "CLEANUP_BLOCKED"; summary = null;
      child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); done();
    }, 20000);
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true; clearTimeout(drain); exitCode = code; exitSignal = signal; helperClosed = true; done();
    });
  });
  const report = { runId, category, summary, exitCode, exitSignal, helperClosed, helperFailed,
    compilerExecuted: false, signatureVerified: false, compilerTrust: "pending" };
  const output = await open(join(evidence, runId + ".json"), "wx", 0o600);
  try { await output.writeFile(JSON.stringify(report, null, 2) + String.fromCharCode(10), "utf8"); await output.sync(); }
  finally { await output.close(); }
  console.log(JSON.stringify(report, null, 2));
  if (helperFailed || !helperClosed || exitCode !== 0 || exitSignal !== null || summary?.passed !== true) process.exitCode = 1;
}
