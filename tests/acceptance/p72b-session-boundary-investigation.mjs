import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Investigation only: no Tailscale endpoint, production adapter or real config.
// Abstract the pinned daemon's mutex sections; this is not daemon execution.
function schedule(order, cleanupWriteFails = false) {
  let watcher = true;
  const foreground = new Set();
  const userConfiguration = 'preserved-user-config';
  const trace = [];
  for (const event of order) {
    if (event === 'publish') {
      foreground.add('owned-session');
      // The pinned reload drops inactive sessions while reading config.
      if (!watcher) foreground.delete('owned-session');
    } else if (event === 'delete') {
      if (!cleanupWriteFails) foreground.delete('owned-session');
    } else if (event === 'unregister') watcher = false;
    else throw new Error('UNKNOWN_MODEL_EVENT');
    trace.push({ event, watcher, routePresent: foreground.has('owned-session') });
  }
  return { trace, routePresent: foreground.has('owned-session'), watcher, userConfiguration };
}

const schedules = [
  ['publish', 'delete', 'unregister'],
  ['delete', 'publish', 'unregister'],
  ['delete', 'unregister', 'publish']
].map((order) => ({ order, ...schedule(order) }));
assert.deepEqual(schedules.map((item) => item.routePresent), [false, true, false]);
assert(schedules.every((item) => !item.watcher && item.userConfiguration === 'preserved-user-config'));
const cleanupFailure = schedule(['publish', 'delete', 'unregister'], true);
assert.equal(cleanupFailure.routePresent, true);

async function pipeBoundary() {
  if (process.platform !== 'win32') return { result: 'NOT_RUN', reason: 'WINDOWS_REQUIRED' };
  const pipe = String.raw`\\.\pipe\mcsm-session-investigation-${randomUUID()}`;
  const server = net.createServer();
  const sockets = new Set();
  let closing = false;
  let socket;
  let child;
  let childClosed = false;
  let serverClosed = false;
  let childResult;
  let result;
  let timeout;
  server.on('connection', (value) => {
    sockets.add(value);
    value.on('error', () => {});
    value.once('close', () => sockets.delete(value));
    if (closing || socket) value.destroy();
  });
  const connected = new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('MOCK_PIPE_LISTEN_FAILED')));
    server.once('connection', (value) => {
      socket = value;
      value.on('error', () => {});
      let received = '';
      value.on('data', (data) => {
        received += data.toString();
        if (!'READY'.startsWith(received)) reject(new Error('MOCK_PIPE_PROTOCOL_INVALID'));
        else if (received === 'READY') resolve();
      });
    });
  });
  // Every promise has a handler before any process or listener is created.
  connected.catch(() => {});
  let closed;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('OWNED_PIPE_PROBE_TIMEOUT')), 10_000);
  });
  deadline.catch(() => {});
  try {
    const work = async () => {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipe, resolve);
      });
      if (closing) throw new Error('OWNED_PIPE_PROBE_TIMEOUT');
      const source = `const net=require('node:net');const s=net.connect(process.argv[1],()=>s.write('READY'));s.on('error',()=>process.exit(2));s.resume();`;
      child = spawn(process.execPath, ['--eval', source, pipe], {
        shell: false, windowsHide: true, stdio: 'ignore'
      });
      closed = new Promise((resolve) => {
        child.once('error', () => { childResult = { errorCode: 'OWNED_CHILD_SPAWN_FAILED' }; });
        child.once('close', (exitCode, exitSignal) => {
          childClosed = true; childResult = { ...childResult, exitCode, exitSignal }; resolve();
        });
      });
      await Promise.race([connected, closed.then(() => { throw new Error('OWNED_CHILD_EARLY_EXIT'); })]);
      const peerClosed = new Promise((resolve) => { socket.once('close', resolve); socket.resume(); });
      // Deliberately terminate only the ChildProcess created above, representing
      // Manager directly owning a pipe. No PID lookup or unknown process kill.
      if (!child.kill()) throw new Error('OWNED_CHILD_TERMINATION_UNCONFIRMED');
      await Promise.all([closed, peerClosed]);
      result = { result: 'PASS', childClosed, peerClosed: socket.destroyed, ...childResult };
      return result;
    };
    return await Promise.race([work(), deadline]);
  } finally {
    closing = true;
    clearTimeout(timeout);
    for (const value of sockets) value.destroy();
    if (child && !childClosed) {
      child.kill();
    }
    let cleanupTimer;
    const listenerClosed = new Promise((resolve) => {
      server.close(() => { serverClosed = true; resolve(); });
    });
    const cleanupComplete = await Promise.race([
      Promise.all([listenerClosed, closed ?? Promise.resolve()]).then(() => true),
      new Promise((resolve) => { cleanupTimer = setTimeout(() => resolve(false), 5000); })
    ]);
    clearTimeout(cleanupTimer);
    if (!cleanupComplete || !serverClosed || sockets.size !== 0 || (child && !childClosed)) throw new Error('CLEANUP_BLOCKED');
    if (result) { result.listenerClosed = serverClosed; result.remainingOwnedSockets = sockets.size; }
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const report = {
  schemaVersion: 1, kind: 'ISOLATED_INVESTIGATION_NOT_TAILSCALE_ACCEPTANCE',
  node: process.versions.node, libuv: process.versions.uv,
  abstractSchedules: schedules, abstractCleanupFailure: cleanupFailure,
  realDaemonCalled: false, productionMutations: 0,
  conclusion: 'ABSTRACT_RACE_WITNESS_NOT_NATIVE_REPRODUCTION',
  windowsTokenSemantics: 'UNKNOWN', daemonIdentity: 'NOT_VERIFIED'
};
try { report.mockNamedPipe = await pipeBoundary(); }
catch (error) {
  // Fixed errors only; never serialize an exception, path or native output.
  const allowed = new Set(['MOCK_PIPE_LISTEN_FAILED', 'MOCK_PIPE_PROTOCOL_INVALID',
    'OWNED_PIPE_PROBE_TIMEOUT', 'OWNED_CHILD_EARLY_EXIT',
    'OWNED_CHILD_TERMINATION_UNCONFIRMED', 'CLEANUP_BLOCKED']);
  report.mockNamedPipe = { result: 'BLOCKED', errorCode: allowed.has(error?.message) ? error.message : 'PROBE_FAILED' };
  process.exitCode = 1;
}
await mkdir(path.join(root, 'test-results'), { recursive: true });
const reportFile = path.join(root, 'test-results', `p72b-session-investigation-${randomUUID()}.json`);
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
console.log(`Report: ${path.relative(root, reportFile)}`);
// If cleanup could not be confirmed, close this probe's own OS handles by
// exiting after its report. Never search for or kill another process.
if (report.mockNamedPipe.errorCode === 'CLEANUP_BLOCKED') process.exit(1);
