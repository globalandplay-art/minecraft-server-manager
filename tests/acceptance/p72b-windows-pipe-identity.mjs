import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolated Windows transport investigation only, NEVER a Tailscale pipe.
const pipeName = `mcsm-identity-probe-${randomUUID()}`;
const powershell = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const children = [];
const sockets = new Set();
let closing = false;
const allowedLevels = new Set(['None', 'Anonymous', 'Identification', 'Impersonation', 'Delegation']);
const allowedConnectErrors = new Set(['ENOENT', 'EACCES', 'EPERM', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EBUSY', 'EINVAL']);
let nodeConnectErrorCode = 'NOT_OBSERVED';
class ProbeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => new ProbeError(code);

function classifyStderr(text) {
  if (!text) return { format: 'NONE', streams: [] };
  if (!text.startsWith('#< CLIXML')) return { format: 'UNCLASSIFIED', streams: [] };
  const allowed = new Set(['progress', 'error', 'warning', 'verbose', 'debug', 'information']);
  const streams = new Set();
  for (const match of text.matchAll(/\bS="([^"]*)"/gu)) streams.add(allowed.has(match[1]) ? match[1] : 'UNKNOWN_STREAM');
  // Format and stream labels are observations only, never permission to ignore stderr.
  return { format: 'POWERSHELL_CLIXML_PREFIX', streams: [...streams].sort() };
}

function launch(script, role) {
  if (closing) throw fail('PROBE_CLOSING');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const record = { child, role, closed: false, bytes: 0, stderrBytes: 0, stderrText: '', lines: [], waiters: [] };
  children.push(record);
  record.done = new Promise((resolve) => {
    child.once('error', () => { record.error = 'OWNED_HELPER_SPAWN_FAILED'; });
    child.once('close', (exitCode, exitSignal) => {
      record.closed = true; record.exitCode = exitCode; record.exitSignal = exitSignal;
      for (const waiter of record.waiters.splice(0)) waiter.reject(fail(record.error ?? 'OWNED_HELPER_EARLY_EXIT'));
      resolve();
    });
  });
  let partial = '';
  child.stdout.on('data', (chunk) => {
    record.bytes += chunk.length;
    if (record.bytes > 4096) { record.error = 'HELPER_OUTPUT_LIMIT'; child.kill(); return; }
    partial += chunk.toString('utf8');
    let index;
    while ((index = partial.indexOf('\n')) !== -1) {
      const line = partial.slice(0, index).trim().replace(/^\uFEFF/u, ''); partial = partial.slice(index + 1);
      if (line) {
        const waiter = record.waiters.shift();
        if (waiter) waiter.resolve(line); else record.lines.push(line);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    record.stderrBytes += chunk.length;
    if (record.bytes + chunk.length <= 4096) record.stderrText += chunk.toString('utf8');
    record.bytes += chunk.length; record.error ??= 'OWNED_HELPER_DIAGNOSTIC';
    if (record.bytes > 4096) { record.error = 'HELPER_OUTPUT_LIMIT'; child.kill(); }
  });
  record.next = () => {
    if (record.lines.length) return Promise.resolve(record.lines.shift());
    if (record.closed) return Promise.reject(fail(record.error ?? 'OWNED_HELPER_EARLY_EXIT'));
    return new Promise((resolve, reject) => record.waiters.push({ resolve, reject }));
  };
  return record;
}

const serverScript = String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$levels=@()
for($i=1;$i -le 2;$i++){
  $p=[IO.Pipes.NamedPipeServerStream]::new('${pipeName}',[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,[IO.Pipes.PipeOptions]::Asynchronous)
  try{
    [Console]::WriteLine('READY'+$i)
    $p.WaitForConnection()
    if($p.ReadByte() -ne 1){throw 'PROTOCOL'}
    $script:level='UNKNOWN'
    $p.RunAsClient([IO.Pipes.PipeStreamImpersonationWorker]{
      $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
      try{$script:level=$identity.ImpersonationLevel.ToString()}finally{$identity.Dispose()}
    })
    $levels+= $script:level
    $p.WriteByte(2);$p.Flush()
  }finally{$p.Dispose()}
}
[Console]::WriteLine((@{levels=$levels}|ConvertTo-Json -Compress))`;

async function work() {
  const server = launch(serverScript, 'MOCK_SERVER');
  assert.equal(await server.next(), 'READY1');
  if (closing) throw fail('PROBE_CLOSING');
  const socket = net.connect('\\\\.\\pipe\\' + pipeName);
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  await new Promise((resolve, reject) => {
    socket.on('error', (error) => {
      nodeConnectErrorCode = allowedConnectErrors.has(error.code) ? error.code : 'UNCLASSIFIED_NODE_ERROR';
      reject(fail('MOCK_NODE_CONNECT_FAILED'));
    });
    socket.once('connect', () => socket.write(Buffer.from([1])));
    socket.once('data', (data) => data.length === 1 && data[0] === 2 ? resolve() : reject(fail('MOCK_PIPE_PROTOCOL_INVALID')));
  });
  socket.destroy();
  assert.equal(await server.next(), 'READY2');
  assert(Number.isSafeInteger(server.child.pid) && server.child.pid > 0);
  const clientScript = String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MockPipeIdentity {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetNamedPipeServerProcessId(IntPtr h,out uint p);
}
'@
$p=[IO.Pipes.NamedPipeClientStream]::new('.','${pipeName}',[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::None,[Security.Principal.TokenImpersonationLevel]::Identification)
try{
 $p.Connect(5000)
 $serverPid=[uint32]0
 $matched=([MockPipeIdentity]::GetNamedPipeServerProcessId($p.SafePipeHandle.DangerousGetHandle(),[ref]$serverPid) -and $serverPid -eq ${server.child.pid})
 if(-not $matched){throw 'PEER_IDENTITY'}
 $p.WriteByte(1);$p.Flush()
 if($p.ReadByte() -ne 2){throw 'PROTOCOL'}
 [Console]::WriteLine((@{mockServerPidMatched=$matched}|ConvertTo-Json -Compress))
}finally{$p.Dispose()}`;
  const client = launch(clientScript, 'IDENTIFICATION_CLIENT');
  const observed = JSON.parse(await server.next());
  const identity = JSON.parse(await client.next());
  await Promise.all([server.done, client.done]);
  for (const record of children) {
    if (record.error || record.exitCode !== 0 || record.exitSignal !== null) throw fail(record.error ?? 'OWNED_HELPER_EXIT_FAILED');
  }
  assert.deepEqual(Object.keys(observed), ['levels']);
  assert(Array.isArray(observed.levels) && observed.levels.length === 2 && observed.levels.every((level) => allowedLevels.has(level)));
  assert.deepEqual(identity, { mockServerPidMatched: true });
  // Only the explicit Identification client must exhibit that level. The Node
  // result is evidence, not an assertion forcing a preselected diagnosis.
  assert.equal(observed.levels[1], 'Identification');
  return { nodeDefaultLevel: observed.levels[0], explicitClientLevel: observed.levels[1],
    mockServerPidMatched: true, ownedHelpers: children.length };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const report = { kind: 'ISOLATED_MOCK_PIPE_IDENTITY_NOT_TAILSCALE_ACCEPTANCE',
  node: process.versions.node, libuv: process.versions.uv, productionMutations: 0,
  realDaemonCalled: false, realEndpointIdentity: 'NOT_VERIFIED' };
let workTimer;
const deadline = new Promise((_, reject) => { workTimer = setTimeout(() => reject(fail('PROBE_TIMEOUT')), 30_000); });
deadline.catch(() => {});
try {
  if (process.platform !== 'win32') throw fail('WINDOWS_REQUIRED');
  Object.assign(report, await Promise.race([work(), deadline]), { result: 'PASS' });
} catch (error) {
  report.result = 'BLOCKED'; report.errorCode = error instanceof ProbeError ? error.code : 'PROBE_ASSERTION_OR_PARSE_FAILED';
  process.exitCode = 1;
} finally {
  closing = true; clearTimeout(workTimer);
  const socketClosures = [...sockets].map((socket) => new Promise((resolve) => {
    socket.once('close', resolve); socket.destroy();
  }));
  for (const record of children) if (!record.closed) record.child.kill();
  let cleanupTimer;
  await Promise.race([Promise.all([...children.map((record) => record.done), ...socketClosures]),
    new Promise((resolve) => { cleanupTimer = setTimeout(resolve, 5000); })]);
  clearTimeout(cleanupTimer);
  report.helpersClosed = children.every((record) => record.closed);
  report.nodeConnectErrorCode = nodeConnectErrorCode;
  report.remainingOwnedSockets = sockets.size;
  report.helperExits = children.map((record) => ({ closed: record.closed, exitCode: record.exitCode ?? null, exitSignal: record.exitSignal ?? null }));
  report.helperDiagnostics = children.map((record) => ({ role: record.role, stderrBytes: record.stderrBytes,
    classification: record.error ?? 'NONE', ...classifyStderr(record.stderrText) }));
  for (const record of children) record.stderrText = '';
  if (!report.helpersClosed || sockets.size !== 0) { report.result = 'BLOCKED'; report.cleanupCode = 'CLEANUP_BLOCKED'; process.exitCode = 1; }
}
await mkdir(path.join(root, 'test-results'), { recursive: true });
const reportFile = path.join(root, 'test-results', `p72b-pipe-identity-${randomUUID()}.json`);
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
console.log(`Report: ${path.relative(root, reportFile)}`);
if (report.cleanupCode === 'CLEANUP_BLOCKED') process.exit(1);
