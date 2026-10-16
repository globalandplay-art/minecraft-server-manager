// Test-only capability investigation. No ACL, credentials, files or network in
// either PowerShell process; not an ACL transport or a production launcher.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

export class InertBridgeFrames {
  buffer = Buffer.alloc(0); bytes = 0; startedPid = null; targetClosed = false; completed = false; fault = null;
  stdout(chunk) {
    if (this.fault) return;
    this.bytes += chunk.length;
    if (this.bytes > 4096) { this.fault = "OUTPUT_LIMIT"; return; }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (let split; (split = this.buffer.indexOf(10)) >= 0;) {
      const line = this.buffer.subarray(0, split); this.buffer = this.buffer.subarray(split + 1);
      try {
        const row = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
        if (!row || typeof row !== "object" || Array.isArray(row) || this.completed) throw new Error();
        const keys = Object.keys(row).sort().join(",");
        if (row.phase === "started" && keys === "phase,pid" && this.startedPid === null && Number.isSafeInteger(row.pid) && row.pid > 0 && row.pid <= 0x7fffffff) this.startedPid = row.pid;
        else if (row.phase === "closed" && keys === "exitCode,phase,silent" && this.startedPid !== null && row.exitCode === 37 && row.silent === true) {
          this.targetClosed = true; this.completed = true;
        } else if (row.phase === "failed" && keys === "phase,stage,targetClosed" && ["start", "wait", "streams"].includes(row.stage) && typeof row.targetClosed === "boolean") {
          this.targetClosed = this.startedPid !== null && row.targetClosed; this.fault = "BROKER_FAILED";
        } else throw new Error();
      } catch { this.fault = "BROKER_PROTOCOL"; }
      if (this.fault) return;
    }
  }
  finish() { if (this.buffer.length || !this.completed) this.fault ??= "BROKER_PROTOCOL"; }
}

export function inertBrokerScript(executable) {
  const encodedPath = Buffer.from(executable, "utf8").toString("base64");
  const inner = Buffer.from("[Threading.Thread]::Sleep(250); exit 37", "utf16le").toString("base64");
  return `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$writer=[IO.StreamWriter]::new([Console]::OpenStandardOutput(),[Text.UTF8Encoding]::new($false,$true),4096,$true)
$writer.AutoFlush=$true
$p=[Diagnostics.Process]::new();$started=$false;$stage='start'
try {
 $p.StartInfo.FileName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
 $p.StartInfo.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand ${inner}'
 $p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true
 $p.StartInfo.RedirectStandardInput=$true;$p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true
 if(-not $p.Start()) { throw 'INERT_START' };$started=$true
 $writer.WriteLine((@{phase='started';pid=$p.Id}|ConvertTo-Json -Compress))
 $p.StandardInput.Close()
 # One-byte reads bound both inner streams: ANY child output is unexpected.
 $ob=[byte[]]::new(1);$eb=[byte[]]::new(1)
 $ot=$p.StandardOutput.BaseStream.ReadAsync($ob,0,1);$et=$p.StandardError.BaseStream.ReadAsync($eb,0,1)
 $clock=[Diagnostics.Stopwatch]::StartNew();$stage='wait'
 while(-not $p.WaitForExit(20)) {
  if(($ot.IsCompleted -and $ot.Result -ne 0) -or ($et.IsCompleted -and $et.Result -ne 0) -or $clock.ElapsedMilliseconds -ge 5000) { throw 'INERT_WAIT' }
 }
 $stage='streams'
 while(-not ($ot.IsCompleted -and $et.IsCompleted)) { if($clock.ElapsedMilliseconds -ge 5000) { throw 'INERT_STREAMS' };[Threading.Thread]::Sleep(10) }
 if($ot.Result -ne 0 -or $et.Result -ne 0 -or $p.ExitCode -ne 37) { throw 'INERT_OUTPUT' }
 $writer.WriteLine((@{phase='closed';exitCode=$p.ExitCode;silent=$true}|ConvertTo-Json -Compress))
 exit 0
} catch {
 $closed=$false;if($started) { try { $closed=$p.HasExited } catch {} }
 $writer.WriteLine((@{phase='failed';stage=$stage;targetClosed=$closed}|ConvertTo-Json -Compress));exit 1
} finally { $p.Dispose();$writer.Dispose() }
`;
}

async function main() {
  if (process.platform !== "win32" || process.argv.slice(2).join(" ") !== "--confirm-inert-bridge") throw new Error("INERT_ARGUMENTS_REJECTED");
  const prefix = "lc2-inert-bridge-" + randomUUID(), started = performance.now(), deadline = started + 5000;
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = inertBrokerScript(executable), frames = new InertBridgeFrames();
  let child, actualClose = false, exitCode = null, exitSignal = null, failure = null, killRequested = false, timer;
  let wakeFault;
  const fault = new Promise((resolve) => { wakeFault = resolve; });
  const reject = (code) => { failure ??= code; wakeFault(); };
  let closed;
  try {
    if (performance.now() >= deadline) throw new Error();
    child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    closed = new Promise((resolve) => child.once("close", (code, signal) => { actualClose = true; exitCode = code; exitSignal = signal; resolve(); }));
    child.on("error", () => reject("BROKER_SPAWN")); child.stdin.on("error", () => reject("BROKER_INPUT"));
    child.stdout.on("error", () => reject("BROKER_PROTOCOL")); child.stderr.on("error", () => reject("BROKER_STDERR"));
    child.stdout.on("data", (chunk) => { frames.stdout(chunk); if (frames.fault) reject(frames.fault); });
    child.stderr.on("data", () => reject("BROKER_STDERR"));
    child.stdin.end();
    await Promise.race([closed, fault, new Promise((resolve) => { timer = setTimeout(() => { reject("WORK_TIMEOUT"); resolve(); }, Math.max(1, deadline - performance.now())); })]);
    if (performance.now() >= deadline) reject("WORK_TIMEOUT");
  } catch { reject("BROKER_SPAWN"); }
  finally { if (timer) clearTimeout(timer); }

  const cleanupDeadline = performance.now() + 5000;
  if (!actualClose && child) {
    killRequested = true; try { child.kill(); } catch { /* Exact owned broker only, never a metadata PID. */ }
  }
  if (!actualClose && closed) {
    await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(resolve, Math.max(1, cleanupDeadline - performance.now())); })]);
    if (timer) clearTimeout(timer);
  }
  frames.finish(); failure ??= frames.fault;
  if (exitCode !== 0 || exitSignal !== null) failure ??= "BROKER_EXIT";
  // Lost started/closed events or a terminated broker NEVER prove target closure.
  const cleanupBlocked = !actualClose || !frames.targetClosed || performance.now() >= cleanupDeadline;
  const report = { prefix, scope: "INERT_BRIDGE_LAUNCH_ONLY", result: cleanupBlocked ? "CLEANUP_BLOCKED" : failure ? "FAIL" : "PASS",
    failure, elapsedMs: Math.floor(performance.now() - started), brokerActualClose: actualClose, exitCode, exitSignal,
    targetPid: frames.startedPid, targetCloseProven: frames.targetClosed, stdoutBytes: frames.bytes, killRequested };
  const evidence = new URL("../../../../test-results/" + prefix + ".json", import.meta.url);
  await writeFile(evidence, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report)); process.exitCode = report.result === "PASS" ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch { console.error("INERT_PROBE_UNEXPECTED_OR_EVIDENCE_FAILED; CLEANUP_UNCONFIRMED"); process.exitCode = 1; }
}
