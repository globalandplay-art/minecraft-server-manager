// Explicit active Create-loop retention PRIMITIVE, not product transport/crash integration.
import { fork, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ManagerLifetimeLock } from '../../apps/api/src/auth/manager-lifetime-lock.ts';
import { AuthCoreError } from '../../apps/api/src/auth/password.ts';
import { WindowsPrivateAclVerifier } from '../../apps/api/src/auth/windows-private-acl.ts';
import { WhitelistEnvelopeAclAction } from '../../apps/api/src/services/whitelist-envelope-acl.ts';
import { whitelistNativeWriterExecutable } from '../../apps/api/src/services/whitelist-native-writer.ts';
import { verifyWhitelistGuardGroupResult, whitelistGuardGroupCommandBound } from '../../apps/api/src/services/whitelist-guard-group-scripts.ts';
import { GuardGroupRetentionFrames, pausedGuardCreateGroup } from '../../apps/api/test/fixtures/whitelist-group-retention.ts';

const guard = '12345678-1234-4234-8234-123456789abc';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const sourceFiles = ['tests/acceptance/lc2-group-retention-native.mjs', 'apps/api/test/fixtures/whitelist-group-retention.ts',
  'apps/api/src/services/whitelist-guard-group-scripts.ts', 'apps/api/src/services/whitelist-owned-publication.ts',
  'apps/api/src/services/whitelist-envelope-acl.ts', 'apps/api/src/services/whitelist-action-envelope.ts',
  'apps/api/src/services/whitelist-action-resources.ts', 'apps/api/src/services/whitelist-native-writer.ts',
  'apps/api/src/services/whitelist-acl-session.ts', 'apps/api/src/auth/private-publication-scripts.ts',
  'apps/api/src/auth/windows-private-acl.ts', 'apps/api/src/auth/manager-lifetime-lock.ts',
  'apps/api/src/auth/windows-owner-retention.ts', 'apps/api/src/auth/windows-native.ts', 'apps/api/src/auth/password.ts'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let uncertainOwner = false, activeIo = 0, retained = false;
const retain = () => { process.exitCode = 1; if (!retained) { retained = true; console.error('CLEANUP_BLOCKED_KNOWN_RETENTION_RUNNER'); setInterval(() => undefined, 60000); } };
const send = (row) => new Promise((yes, no) => {
  if (!process.connected || Buffer.byteLength(JSON.stringify(row)) > 16384) { no(new Error()); return; }
  process.send(row, (error) => error ? no(new Error()) : yes());
});
const identity = async (file) => {
  const s = await lstat(file, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(file)).toLowerCase() !== file.toLowerCase()) throw new Error();
  return `${s.dev}:${s.ino}:${s.birthtimeNs}`;
};
async function child(role, root, nonce) {
  if (!process.connected || !['owner', 'contender'].includes(role) || !uuid.test(nonce)) throw new Error();
  const temp = await realpath(tmpdir()), parent = join(temp, `mcsm-group-retention-${nonce}`);
  if (root !== join(parent, 'manager') || await realpath(root) !== root) throw new Error(); await identity(parent); await identity(root);
  if (role === 'contender') {
    let result;
    try { uncertainOwner = true; const owner = await ManagerLifetimeLock.acquire(root); await owner.release(); uncertainOwner = false; result = 'ACQUIRED'; }
    catch (error) { if (!(error instanceof AuthCoreError) || error.code !== 'AUTH_BUSY') throw new Error(); uncertainOwner = false; result = 'BUSY'; }
    await send({ event: 'contended', nonce, role, pid: process.pid, parentPid: process.ppid, result, drained: true }); process.disconnect(); return;
  }
  uncertainOwner = true; const owner = await ManagerLifetimeLock.acquire(root), action = new WhitelistEnvelopeAclAction(owner, root);
  await action.runPublication(performance.now() + 25000, async (publication) => {
    await publication.createDirectory('whitelist-guards'); await publication.createDirectory(`whitelist-guards/${guard}`);
  });
  const state = action.diagnostic;
  if (state.phase !== 'released' || state.primary !== null || !state.bodySettled || state.resourceCount !== 0 ||
    state.mutation !== 'released' || state.activity !== 'released') throw new Error();
  // Fresh live epoch; never reuse the wrapper revoked by the completed directory action.
  owner.beginOfflineMutation(root);
  const { script } = pausedGuardCreateGroup(root, guard), wrapped = owner.nativeAclChildWrapper(root)(script);
  whitelistGuardGroupCommandBound(wrapped, whitelistNativeWriterExecutable());
  await send({ event: 'prepared', nonce, role, pid: process.pid, parentPid: process.ppid, state, script: wrapped });
  // No file/query work after this proof. Driver intentionally terminates this exact fork.
  setInterval(() => undefined, 60000);
}
async function main() {
  const args = process.argv.slice(2);
  if (process.platform !== 'win32') throw new Error();
  if (args[0] === '--group-retention-child' && args.length === 4) return child(args[1], args[2], args[3]);
  if (args.join('|') !== '--confirm-isolated-group-retention') { console.error('ISOLATED_GROUP_RETENTION_CONFIRMATION_REQUIRED'); process.exitCode = 2; return; }
  const started = performance.now(), end = started + 50000;
  const within = async (task, deadline = end) => {
    const observed = Promise.resolve(task); void observed.catch(() => undefined); let timer;
    try {
      if (performance.now() >= deadline) throw new Error();
      const value = await Promise.race([observed, new Promise((_, no) => { timer = setTimeout(() => no(new Error()), Math.max(1, deadline - performance.now())); })]);
      if (performance.now() >= deadline) throw new Error(); return value;
    } finally { clearTimeout(timer); }
  };
  const io = (factory, deadline = end) => {
    if (performance.now() >= deadline) return Promise.reject(new Error()); activeIo++;
    const task = Promise.resolve(factory()).finally(() => { activeIo--; }); return within(task, deadline);
  };
  const project = await io(() => realpath(fileURLToPath(new URL('../..', import.meta.url)))), evidence = join(project, 'test-results');
  if (await io(() => realpath(evidence)) !== evidence) throw new Error();
  const temp = await io(() => realpath(tmpdir())), nonce = randomUUID(), runId = `lc2-group-retention-${nonce}`;
  const parent = join(temp, `mcsm-group-retention-${nonce}`), root = join(parent, 'manager'), namespace = join(root, 'whitelist-guards'), directory = join(namespace, guard);
  console.log('PLANNED_FRESH_CANONICAL_FIXTURE:', root);
  let parentId, rootId, namespaceId, directoryId, primary = null, stage = 'preparation', fault = null, hashes = [], sourceUnchanged = false;
  let parentCreated = false, removed = false, removalAttempted = false, ownerKilled = false, busy = false, acquired = false, helperEnd = 0, helperTimer;
  let pausedTree, completeTree, aclHashes = []; const children = [], frames = new GuardGroupRetentionFrames();
  const fail = (code) => { fault ??= code; };
  const sources = async () => {
    const rows = await Promise.allSettled(sourceFiles.map(async (file) => ({ file, sha256: sha(await readFile(join(project, file))) })));
    if (rows.some((r) => r.status !== 'fulfilled')) throw new Error(); return rows.map((r) => r.value);
  };
  const observe = (entry) => {
    const current = entry.child;
    entry.close = new Promise((yes) => current.once('close', (code, signal) => { entry.closed = true; entry.code = code; entry.signal = signal; yes(); }));
    current.once('exit', () => { entry.exited = true; }); current.on('error', () => fail('CHILD_START_FAILED'));
    current.stdout.on('error', () => fail('CHILD_OUTPUT_FAILED')); current.stderr.on('error', () => fail('CHILD_OUTPUT_FAILED'));
    current.stderr.on('data', (data) => { entry.stderrBytes += data.length; fail('CHILD_STDERR'); });
  };
  const launch = (role) => {
    if (performance.now() >= end || fault) throw new Error();
    const entry = { role, closed: false, exited: false, code: null, signal: null, stdoutBytes: 0, stderrBytes: 0, messages: 0 }; children.push(entry);
    entry.child = fork(fileURLToPath(import.meta.url), ['--group-retention-child', role, root, nonce],
      { execPath: process.execPath, execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    observe(entry); entry.child.stdout.on('data', (data) => { entry.stdoutBytes += data.length; fail('CHILD_STDOUT'); });
    entry.message = new Promise((yes, no) => {
      entry.child.on('message', (value) => {
        entry.messages++;
        const keys = role === 'owner' ? 'event,nonce,parentPid,pid,role,script,state' : 'drained,event,nonce,parentPid,pid,result,role';
        if (entry.messages !== 1 || typeof value !== 'object' || value === null || Array.isArray(value) ||
          Buffer.byteLength(JSON.stringify(value)) > (role === 'owner' ? 16384 : 1024) || Object.keys(value).sort().join(',') !== keys ||
          value.nonce !== nonce || value.role !== role || value.pid !== entry.child.pid || value.parentPid !== process.pid ||
          (role === 'owner' ? value.event !== 'prepared' || typeof value.script !== 'string' || value.script.length > 16000 ||
            JSON.stringify(value.state) !== JSON.stringify({ phase: 'released', primary: null, activity: 'released', mutation: 'released', bodySettled: true, resourceCount: 0 }) :
            value.event !== 'contended' || value.drained !== true || !['BUSY', 'ACQUIRED'].includes(value.result))) { fail('CHILD_PROTOCOL'); no(new Error()); return; }
        yes(value);
      });
      entry.child.once('close', () => { if (entry.messages === 0) { fail('CHILD_EARLY_CLOSE'); no(new Error()); } });
    }); void entry.message.catch(() => undefined); return entry;
  };
  const wait = async (condition) => {
    while (!condition()) { if (fault || performance.now() >= end) throw new Error(); await delay(10); }
    if (fault || performance.now() >= end) throw new Error();
  };
  const alive = (entry) => {
    if (!entry?.child?.pid || entry.closed || entry.exited || entry.child.exitCode !== null || entry.child.signalCode !== null ||
      performance.now() >= helperEnd || fault) throw new Error();
    process.kill(entry.child.pid, 0);
  };
  const contend = async () => {
    const entry = launch('contender'), result = await within(entry.message); await within(entry.close);
    if (entry.code !== 0 || entry.signal !== null || fault) throw new Error(); return result.result;
  };
  const tree = async (count) => {
    if (await identity(parent) !== parentId || await identity(root) !== rootId || await identity(namespace) !== namespaceId || await identity(directory) !== directoryId ||
      (await readdir(parent)).join('|') !== 'manager' || (await readdir(root)).sort().join('|') !== 'manager.lifetime.lock|whitelist-guards' ||
      (await readdir(namespace)).join('|') !== guard) throw new Error();
    const names = Array.from({ length: count }, (_, index) => `${String(index).padStart(2, '0')}.bin.stage`);
    if ((await readdir(directory)).sort().join('|') !== names.join('|')) throw new Error();
    const rows = [];
    for (const name of names) {
      const file = join(directory, name), a = await lstat(file, { bigint: true });
      if (!a.isFile() || a.isSymbolicLink() || a.nlink !== 1n || a.size !== 0n || await realpath(file) !== file || (await readFile(file)).length !== 0) throw new Error();
      const b = await lstat(file, { bigint: true });
      if (a.dev !== b.dev || a.ino !== b.ino || a.birthtimeNs !== b.birthtimeNs || a.mtimeNs !== b.mtimeNs || a.ctimeNs !== b.ctimeNs || b.size !== 0n) throw new Error();
      rows.push({ name, identity: `${a.dev}:${a.ino}:${a.birthtimeNs}`, sha256: sha(Buffer.alloc(0)) });
    } return rows;
  };
  let owner, helper;
  try {
    hashes = await io(sources); await io(() => mkdir(parent)); parentCreated = true; await io(() => mkdir(root));
    parentId = await io(() => identity(parent)); rootId = await io(() => identity(root));
    if ((await io(() => readdir(root))).length) throw new Error(); console.log('CONFIRMED_FRESH_CANONICAL_FIXTURE:', root);
    stage = 'owner-preparation'; owner = launch('owner'); const prepared = await within(owner.message);
    namespaceId = await io(() => identity(namespace)); directoryId = await io(() => identity(directory));
    const executable = whitelistNativeWriterExecutable(); whitelistGuardGroupCommandBound(prepared.script, executable);
    stage = 'helper-bootstrap'; helper = { role: 'helper', closed: false, exited: false, code: null, signal: null, stdoutBytes: 0, stderrBytes: 0 }; children.push(helper);
    helperEnd = performance.now() + 15000;
    helper.child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prepared.script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    prepared.script = null; observe(helper); helper.child.stdin.on('error', () => fail('HELPER_INPUT_FAILED'));
    helperTimer = setTimeout(() => { fail('HELPER_15000MS_DEADLINE'); try { helper.child.kill(); } catch { /* Actual close still required. */ } }, 15000);
    helper.child.once('close', () => clearTimeout(helperTimer));
    helper.child.stdout.on('data', (data) => {
      helper.stdoutBytes += data.length;
      if (performance.now() >= helperEnd) fail('HELPER_15000MS_DEADLINE');
      frames.push(data); if (frames.fault) fail('HELPER_PROTOCOL');
    });
    await wait(() => frames.phase === 1 || helper.closed); if (frames.phase !== 1) throw new Error(); alive(helper);
    stage = 'paused-first-create'; pausedTree = await io(() => tree(1));
    if (owner.closed || owner.exited) throw new Error();
    stage = 'known-owner-death'; ownerKilled = owner.child.kill('SIGTERM'); if (!ownerKilled) throw new Error(); await within(owner.close);
    if (!owner.closed || (owner.code === null && owner.signal === null)) throw new Error(); alive(helper);
    stage = 'compete-while-live'; busy = (await contend()) === 'BUSY'; if (!busy) throw new Error(); alive(helper);
    stage = 'complete-issued-create-loop'; helper.child.stdin.end('RELEASE\n'); await within(helper.close); frames.finish();
    if (fault || performance.now() >= helperEnd || helper.code !== 0 || helper.signal !== null || frames.fault) throw new Error();
    const { plan } = pausedGuardCreateGroup(root, guard), verifier = new WindowsPrivateAclVerifier();
    aclHashes = [...verifyWhitelistGuardGroupResult(plan, frames.result, (snapshot) => verifier.verifyNativeSnapshot(snapshot))];
    stage = 'compete-after-close'; acquired = (await contend()) === 'ACQUIRED'; if (!acquired) throw new Error();
    stage = 'physical-verification'; completeTree = await io(() => tree(8));
    if (JSON.stringify(completeTree[0]) !== JSON.stringify(pausedTree[0])) throw new Error();
    const after = await io(sources); sourceUnchanged = hashes.every((row, index) => row.sha256 === after[index].sha256); if (!sourceUnchanged) throw new Error();
  } catch { primary = fault ?? `GROUP_RETENTION_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`; }
  // Failures retain evidence. Exact known helper/owner may be stopped; unknown contender/creation retains driver.
  const cleanupEnd = performance.now() + 5000;
  if (primary !== null) {
    if (helper?.child && !helper.closed) { try { helper.child.kill(); } catch { /* no guessed closure */ } }
    if (owner?.child && !owner.closed && owner.messages === 1) { try { owner.child.kill(); } catch { /* no guessed closure */ } }
    try { await within(Promise.all(children.filter((entry) => entry.close).map((entry) => entry.close)), cleanupEnd); } catch { /* retained below */ }
  }
  const childrenClosed = children.every((entry) => entry.closed), safe = childrenClosed && activeIo === 0;
  if (primary === null && safe && busy && acquired && parentCreated) {
    try {
      stage = 'fixture-cleanup'; await io(async () => {
        if (resolve(parent) !== parent || dirname(parent) !== temp || !parent.startsWith(temp + sep) || basename(parent) !== `mcsm-group-retention-${nonce}` ||
          JSON.stringify(await tree(8)) !== JSON.stringify(completeTree)) throw new Error();
        const lock = join(root, 'manager.lifetime.lock'), s = await lstat(lock, { bigint: true });
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1n || s.size !== 0n || await realpath(lock) !== lock || (await readFile(lock)).length !== 0 || performance.now() >= cleanupEnd) throw new Error();
        removalAttempted = true; await rm(parent, { recursive: true, force: false });
      }, cleanupEnd); removed = true;
    } catch { primary = 'CLEANUP_BLOCKED'; }
  }
  const report = { runId, scope: 'LIVE_CREATE_LOOP_OWNER_RETENTION_PRIMITIVE_ONLY', result: primary === null && removed ? 'COMPONENT_CHECKS_PASS' : 'BLOCKED',
    primary, stage, root, runnerPid: process.pid, runnerActualClose: 'EXTERNAL_VERIFICATION_REQUIRED', ownerKilled, busyWhileHelperLive: busy,
    acquiredAfterHelperClose: acquired, helperFramePhase: frames.phase, helperProtocolFailed: frames.fault, aclHashes,
    pausedTree, completeTree, sourceUnchanged, hashes, childrenClosed, activeIo, fixtureRemoved: removed,
    fixtureRetained: removed ? false : parentCreated && !removalAttempted ? true : null, cleanupBlocked: !safe || primary === 'CLEANUP_BLOCKED',
    children: children.map((entry) => ({ role: entry.role, pid: entry.child?.pid ?? null, closed: entry.closed, code: entry.code, signal: entry.signal,
      stdoutBytes: entry.stdoutBytes, stderrBytes: entry.stderrBytes, messages: entry.messages ?? 0 })), elapsedMs: Math.floor(performance.now() - started) };
  try { await io(() => writeFile(join(evidence, `${runId}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }), performance.now() + 5000); }
  catch { console.error('GROUP_RETENTION_EVIDENCE_SAVE_FAILED'); process.exitCode = 1; }
  console.log(JSON.stringify({ runId, result: report.result, primary, childrenClosed, fixtureRemoved: removed }));
  if (report.result !== 'COMPONENT_CHECKS_PASS') process.exitCode = 1;
  if (!childrenClosed || activeIo > 0) retain();
}
main().catch(() => { console.error('GROUP_RETENTION_FIXED_SETUP_OR_CHILD_FAILURE'); process.exitCode = 1; if (uncertainOwner || activeIo > 0) retain(); });
