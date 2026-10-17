// Explicit partial-data/pre-open fault probe. Not death during an actual pending syscall.
import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagerLifetimeLock } from '../../apps/api/src/auth/manager-lifetime-lock.ts';
import { WhitelistGuardStore } from '../../apps/api/src/services/whitelist-guard-store.ts';
import { WhitelistAclSession } from '../../apps/api/src/services/whitelist-acl-session.ts';

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const guard = '12345678-1234-4234-8234-123456789abc';
const members = [{ name: 'Fixture_Player', uuid: '123e4567-e89b-42d3-a456-426614174000' }];
const json = Buffer.from(JSON.stringify(members)), bytes = Buffer.concat([json, Buffer.alloc(4096 - json.length, 0x20)]);
const sha = (value) => createHash('sha256').update(value).digest('hex'), expectedHash = sha(bytes);
const snapshot = { serverId: 'isolated-fixture', rootIdentity: 'a'.repeat(64), configRevision: 'b'.repeat(64),
  fileIdentity: 'c'.repeat(64), fileSha256: expectedHash, runtimeId: guard, members };
const sourceFiles = ['tests/acceptance/lc2-owned-guard-partial-death.mjs',
  'apps/api/src/services/whitelist-guard-store.ts', 'apps/api/src/services/whitelist-command-record.ts',
  'apps/api/src/services/whitelist-member-policy.ts', 'apps/api/src/services/whitelist-reader.ts',
  'apps/api/src/services/whitelist-owned-publication.ts', 'apps/api/src/services/whitelist-envelope-acl.ts',
  'apps/api/src/services/whitelist-action-envelope.ts', 'apps/api/src/services/whitelist-action-resources.ts',
  'apps/api/src/services/whitelist-native-writer.ts', 'apps/api/src/services/whitelist-acl-session.ts',
  'apps/api/src/auth/private-publication.ts', 'apps/api/src/auth/private-publication-scripts.ts',
  'apps/api/src/auth/windows-private-acl.ts', 'apps/api/src/auth/manager-lifetime-lock.ts',
  'apps/api/src/auth/windows-owner-retention.ts', 'apps/api/src/auth/windows-native.ts', 'apps/api/src/auth/password.ts'];
const safeState = (store) => {
  const s = store.ownedDiagnostic;
  if (s?.phase !== 'released' || s.primary !== null || !s.bodySettled || s.resourceCount !== 0 ||
    s.mutation !== 'released' || s.activity !== 'released') throw new Error(); return s;
};
let retained = false, unsafeOwner = false, activeIo = 0;
const retain = () => {
  process.exitCode = 1;
  if (!retained) { retained = true; console.error('CLEANUP_BLOCKED_KNOWN_RUNNER_RETAINED'); setInterval(() => undefined, 60_000); }
};
const send = (value) => new Promise((yes, no) => {
  if (!process.connected || Buffer.byteLength(JSON.stringify(value)) > 4096) { no(new Error()); return; }
  process.send(value, (error) => error ? no(new Error()) : yes());
});
const identity = async (directory) => {
  const s = await lstat(directory, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw new Error();
  return `${s.dev}:${s.ino}:${s.birthtimeNs}`;
};
async function child(role, root, nonce) {
  if (!process.connected || !['writer', 'reader'].includes(role) || !uuidPattern.test(nonce)) throw new Error();
  const temp = await realpath(tmpdir()), parent = join(temp, `mcsm-owned-guard-partial-${nonce}`);
  if (root !== join(parent, 'manager') || await realpath(root) !== root) throw new Error();
  await identity(parent); await identity(root);
  unsafeOwner = true;
  const owner = await ManagerLifetimeLock.acquire(root), sessions = [], handles = new Set();
  const directory = join(root, 'whitelist-guards', guard), manifest = join(directory, 'manifest.json');
  let faultApplied = false, missingManifestObserved = false, fixedError = null;
  const io = {
    stat: (file) => {
      const raw = lstat(file, { bigint: true });
      // Observe only the exact synthetic missing manifest; return the original Promise.
      void raw.catch((error) => { if (role === 'reader' && file === manifest && error?.code === 'ENOENT') missingManifestObserved = true; });
      return raw;
    }, realpath, list: readdir,
    open: async (file, mode) => {
      if (role === 'writer' && file === manifest + '.stage' && mode === 'r+') {
        if (faultApplied) throw new Error(); faultApplied = true;
        // Intentional test refusal BEFORE actual fs.open; registry must retain uncertainty.
        throw new Error('ISOLATED_PREOPEN_REFUSAL');
      }
      const handle = await open(file, mode); handles.add(handle);
      return { stat: () => handle.stat({ bigint: true }),
        read: async (value, offset, length, position) => (await handle.read(value, offset, length, position)).bytesRead,
        write: (value) => handle.writeFile(value), sync: () => handle.sync(),
        close: async () => { await handle.close(); handles.delete(handle); } };
    },
  };
  const dependencies = { publication: { io }, sessionFactory: (wrapper, now) => {
    const session = new WhitelistAclSession(undefined, now, wrapper); sessions.push(session); return session;
  } };
  const states = [];
  if (role === 'writer') {
    const store = await WhitelistGuardStore.openOwned(root, owner, dependencies); states.push(safeState(store));
    try { await store.create(guard, snapshot, bytes); } catch (error) { if (error?.code === 'WHITELIST_GUARD_UNSAFE') fixedError = error.code; else throw new Error(); }
    const state = store.ownedDiagnostic;
    if (!faultApplied || fixedError !== 'WHITELIST_GUARD_UNSAFE' || state?.phase !== 'retained' || state.primary !== 'cancelled' ||
      !state.bodySettled || state.mutation !== 'held' || state.activity !== 'held' || state.resourceCount < 1 || state.resourceCount > 8) throw new Error();
    states.push(state);
  } else {
    try { await WhitelistGuardStore.openOwned(root, owner, dependencies); }
    catch (error) { if (error?.code === 'WHITELIST_GUARD_UNSAFE') fixedError = error.code; else throw new Error(); }
    if (fixedError !== 'WHITELIST_GUARD_UNSAFE' || !missingManifestObserved || faultApplied) throw new Error();
  }
  if (sha(await readFile(join(directory, '00.bin'))) !== expectedHash ||
    (await readFile(manifest + '.stage')).length !== 0 || !sessions.length || sessions.some((session) => !session.closedConfirmed) || handles.size !== 0) throw new Error();
  let targetMissing = false;
  try { await lstat(manifest); } catch (error) { if (error?.code === 'ENOENT') targetMissing = true; else throw new Error(); }
  if (!targetMissing) throw new Error();
  const state = { nonce, role, runnerPid: process.pid, parentPid: process.ppid, states,
    stageHash: sha(Buffer.alloc(0)), sourceHash: expectedHash, errorCode: fixedError, faultApplied,
    missingManifestObserved, helpersClosed: true, handlesClosed: true };
  if (role === 'writer') {
    // All real child/descriptor work settled; only the conservative unknown-open lease remains.
    await send({ ...state, event: 'partial', ownerReleased: false }); setInterval(() => undefined, 60_000); return;
  }
  await owner.release(); unsafeOwner = false;
  let rejected = false; try { owner.assertHeld(root); } catch { rejected = true; }
  if (!rejected) throw new Error();
  await send({ ...state, event: 'rejected', ownerReleased: true }); process.disconnect();
}
async function main() {
  const args = process.argv.slice(2);
  if (process.platform !== 'win32') throw new Error();
  if (args[0] === '--owned-guard-child' && args.length === 4) return child(args[1], args[2], args[3]);
  if (args.join('|') !== '--confirm-isolated-guard-partial-death') {
    console.error('ISOLATED_PARTIAL_GUARD_DEATH_CONFIRMATION_REQUIRED'); process.exitCode = 2; return;
  }
  const started = performance.now(), end = started + 50_000;
  const within = async (task, deadline = end) => {
    const observed = Promise.resolve(task); void observed.catch(() => undefined); let timer;
    try {
      if (performance.now() >= deadline) throw new Error();
      const result = await Promise.race([observed, new Promise((_, no) => {
        timer = setTimeout(() => no(new Error()), Math.max(1, deadline - performance.now()));
      })]);
      if (performance.now() >= deadline) throw new Error(); return result;
    } finally { clearTimeout(timer); }
  };
  const io = (operation, deadline = end) => {
    if (performance.now() >= deadline) return Promise.reject(new Error()); activeIo++;
    const task = Promise.resolve(operation()).finally(() => { activeIo--; }); return within(task, deadline);
  };
  const project = await io(() => realpath(fileURLToPath(new URL('../..', import.meta.url))));
  const evidence = join(project, 'test-results'); if (await io(() => realpath(evidence)) !== evidence) throw new Error();
  const temp = await io(() => realpath(tmpdir())), nonce = randomUUID(), runId = `lc2-owned-guard-partial-${nonce}`;
  const parent = join(temp, `mcsm-owned-guard-partial-${nonce}`), root = join(parent, 'manager');
  console.log('PLANNED_FRESH_CANONICAL_FIXTURE:', root);
  let parentId, rootId, parentCreated = false, primary = null, stage = 'preparation';
  let beforeTree, afterTree, hashes = [], unchanged = false, fixtureRemoved = false, killRequested = false, removalAttempted = false;
  let writerProof, readerProof, lockFileVerifiedAfterRelease = false; const children = [];
  const hashSources = async () => {
    const rows = await Promise.allSettled(sourceFiles.map(async (file) => ({ file, sha256: sha(await readFile(join(project, file))) })));
    if (rows.some((row) => row.status !== 'fulfilled')) throw new Error(); return rows.map((row) => row.value);
  };
  const tree = async () => {
    if (await identity(parent) !== parentId || await identity(root) !== rootId ||
      (await readdir(parent)).join('|') !== 'manager' || (await readdir(root)).sort().join('|') !== 'manager.lifetime.lock|whitelist-guards' ||
      (await readdir(join(root, 'whitelist-guards'))).join('|') !== guard ||
      (await readdir(join(root, 'whitelist-guards', guard))).sort().join('|') !== '00.bin|manifest.json.stage') throw new Error();
    const result = { namespace: await identity(join(root, 'whitelist-guards')), directory: await identity(join(root, 'whitelist-guards', guard)), files: [] };
    // The active owner's share0 lock is control state, not readable Guard data.
    // Its name is checked above; strict file inspection follows reader release/exit.
    for (const relative of [`whitelist-guards/${guard}/00.bin`, `whitelist-guards/${guard}/manifest.json.stage`]) {
      const file = join(root, ...relative.split('/')), a = await lstat(file, { bigint: true });
      if (!a.isFile() || a.isSymbolicLink() || a.nlink !== 1n || a.size < 0n || a.size > 4096n || await realpath(file) !== file) throw new Error();
      const buffer = await readFile(file), digest = sha(buffer); buffer.fill(0); const b = await lstat(file, { bigint: true });
      if (a.dev !== b.dev || a.ino !== b.ino || a.birthtimeNs !== b.birthtimeNs || a.size !== b.size || a.mtimeNs !== b.mtimeNs || a.ctimeNs !== b.ctimeNs) throw new Error();
      result.files.push({ relative, identity: `${a.dev}:${a.ino}:${a.birthtimeNs}`, bytes: Number(a.size), sha256: digest });
    }
    const source = result.files.find((row) => row.relative === `whitelist-guards/${guard}/00.bin`);
    const stage = result.files.find((row) => row.relative === `whitelist-guards/${guard}/manifest.json.stage`);
    if (source?.sha256 !== expectedHash || source.bytes !== 4096 || stage?.bytes !== 0 || stage.sha256 !== sha(Buffer.alloc(0))) throw new Error(); return result;
  };
  const launch = (role) => {
    if (performance.now() >= end) throw new Error();
    const entry = { role, closed: false, code: null, signal: null, messages: 0, stdoutBytes: 0, stderrBytes: 0, protocolFailed: false };
    // Register creation before fork. Unknown creation prevents release/cleanup/parent exit.
    children.push(entry);
    const childProcess = fork(fileURLToPath(import.meta.url), ['--owned-guard-child', role, root, nonce],
      { execPath: process.execPath, execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    entry.child = childProcess;
    entry.close = new Promise((yes) => childProcess.once('close', (code, signal) => {
      entry.closed = true; entry.code = code; entry.signal = signal; yes();
    }));
    entry.message = new Promise((yes, no) => {
      const reject = () => { entry.protocolFailed = true; no(new Error()); };
      childProcess.on('error', reject);
      childProcess.on('message', (value) => {
        entry.messages++;
        if (entry.messages !== 1 || !value || typeof value !== 'object' || Buffer.byteLength(JSON.stringify(value)) > 4096 ||
          Object.keys(value).sort().join('|') !== 'errorCode|event|faultApplied|handlesClosed|helpersClosed|missingManifestObserved|nonce|ownerReleased|parentPid|role|runnerPid|sourceHash|stageHash|states' ||
          value.nonce !== nonce || value.role !== role || value.runnerPid !== childProcess.pid || value.parentPid !== process.pid ||
          value.event !== (role === 'writer' ? 'partial' : 'rejected') || value.sourceHash !== expectedHash || value.stageHash !== sha(Buffer.alloc(0)) ||
          value.errorCode !== 'WHITELIST_GUARD_UNSAFE' || value.helpersClosed !== true || value.handlesClosed !== true ||
          value.faultApplied !== (role === 'writer') || value.missingManifestObserved !== (role === 'reader') || value.ownerReleased !== (role === 'reader') ||
          !Array.isArray(value.states) || value.states.length !== (role === 'writer' ? 2 : 0)) { reject(); return; }
        if (role === 'writer') {
          const [first, last] = value.states;
          if (JSON.stringify(first) !== JSON.stringify({ phase: 'released', primary: null, activity: 'released', mutation: 'released', bodySettled: true, resourceCount: 0 }) ||
            !last || Object.keys(last).sort().join('|') !== 'activity|bodySettled|mutation|phase|primary|resourceCount' ||
            last.phase !== 'retained' || last.primary !== 'cancelled' || last.activity !== 'held' || last.mutation !== 'held' ||
            last.bodySettled !== true || !Number.isSafeInteger(last.resourceCount) || last.resourceCount < 1 || last.resourceCount > 8) { reject(); return; }
        }
        yes(value);
      });
      childProcess.stdout.on('data', (data) => { entry.stdoutBytes += data.length; reject(); });
      childProcess.stderr.on('data', (data) => { entry.stderrBytes += data.length; reject(); });
      // Pipe errors are failed observations, never proof that a child/owner has closed.
      childProcess.stdout.on('error', reject); childProcess.stderr.on('error', reject);
      childProcess.once('close', () => { if (entry.messages === 0) reject(); });
    });
    void entry.message.catch(() => undefined); return entry;
  };
  try {
    hashes = await io(hashSources); await io(() => mkdir(parent)); parentCreated = true; await io(() => mkdir(root));
    parentId = await io(() => identity(parent)); rootId = await io(() => identity(root));
    if ((await io(() => readdir(root))).length) throw new Error(); console.log('CONFIRMED_FRESH_CANONICAL_FIXTURE:', root);
    stage = 'writer'; const writer = launch('writer'); writerProof = await within(writer.message);
    beforeTree = await io(tree);
    if (beforeTree.files.find((row) => row.relative === `whitelist-guards/${guard}/manifest.json.stage`)?.sha256 !== writerProof.stageHash ||
      writer.closed || writer.child.exitCode !== null || writer.child.signalCode !== null || writer.protocolFailed) throw new Error();
    stage = 'known-writer-termination'; if (performance.now() >= end) throw new Error();
    killRequested = writer.child.kill('SIGTERM'); if (!killRequested) throw new Error(); await within(writer.close);
    if (!writer.closed || (writer.code === null && writer.signal === null) || writer.protocolFailed) throw new Error();
    stage = 'fresh-reader'; const reader = launch('reader'); readerProof = await within(reader.message); await within(reader.close);
    if (reader.code !== 0 || reader.signal !== null || reader.protocolFailed || readerProof.stageHash !== writerProof.stageHash) throw new Error();
    stage = 'physical-verification'; afterTree = await io(tree);
    if (JSON.stringify(beforeTree) !== JSON.stringify(afterTree)) throw new Error();
    const after = await io(hashSources); unchanged = hashes.every((row, index) => row.sha256 === after[index].sha256);
    if (!unchanged) throw new Error();
  } catch { primary = `PARTIAL_GUARD_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`; }
  const childrenClosed = children.every((entry) => entry.closed), safe = childrenClosed && activeIo === 0;
  if (primary === null && safe && parentCreated && readerProof?.ownerReleased === true) {
    const cleanupEnd = performance.now() + 5000;
    try {
      stage = 'fixture-cleanup'; await io(async () => {
        if (resolve(parent) !== parent || dirname(parent).toLowerCase() !== temp.toLowerCase() || !parent.startsWith(temp + sep) ||
          basename(parent) !== `mcsm-owned-guard-partial-${nonce}` || JSON.stringify(await tree()) !== JSON.stringify(beforeTree) || performance.now() >= cleanupEnd) throw new Error();
        const lockFile = join(root, 'manager.lifetime.lock'), lock = await lstat(lockFile, { bigint: true });
        if (!lock.isFile() || lock.isSymbolicLink() || lock.nlink !== 1n || lock.size !== 0n || await realpath(lockFile) !== lockFile ||
          (await readFile(lockFile)).length !== 0) throw new Error();
        const after = await lstat(lockFile, { bigint: true });
        if (after.dev !== lock.dev || after.ino !== lock.ino || after.birthtimeNs !== lock.birthtimeNs || after.size !== 0n ||
          after.nlink !== 1n || !after.isFile() || after.isSymbolicLink() || performance.now() >= cleanupEnd) throw new Error();
        lockFileVerifiedAfterRelease = true;
        removalAttempted = true; await rm(parent, { recursive: true, force: false });
      }, cleanupEnd); fixtureRemoved = true;
    } catch { primary = 'CLEANUP_BLOCKED'; }
  }
  const report = { runId, scope: 'PARTIAL_MANIFEST_PREOPEN_FAULT_FRESH_PROCESS_FAIL_CLOSED_ONLY', result: primary === null && fixtureRemoved ? 'COMPONENT_CHECKS_PASS' : 'BLOCKED',
    primary, stage, root, runnerPid: process.pid, runnerActualClose: 'EXTERNAL_VERIFICATION_REQUIRED', killRequested, lockFileVerifiedAfterRelease,
    writerProof, readerProof, beforeTree, afterTree, sourceUnchanged: unchanged, hashes,
    children: children.map((entry) => ({ role: entry.role, pid: entry.child?.pid ?? null, closed: entry.closed, code: entry.code, signal: entry.signal,
      messages: entry.messages, stdoutBytes: entry.stdoutBytes, stderrBytes: entry.stderrBytes, protocolFailed: entry.protocolFailed })),
    childrenClosed, activeIo, fixtureRemoved, fixtureRetained: fixtureRemoved ? false : parentCreated && !removalAttempted ? true : null,
    cleanupBlocked: !childrenClosed || activeIo > 0 || primary === 'CLEANUP_BLOCKED', elapsedMs: Math.floor(performance.now() - started) };
  try { await io(() => writeFile(join(evidence, `${runId}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }), performance.now() + 5000); }
  catch { console.error('GUARD_DEATH_EVIDENCE_SAVE_FAILED'); process.exitCode = 1; }
  console.log(JSON.stringify({ runId, result: report.result, primary, root, childrenClosed, fixtureRemoved }));
  if (report.result !== 'COMPONENT_CHECKS_PASS') process.exitCode = 1;
  if (!childrenClosed || activeIo > 0) retain();
}
main().catch(() => { console.error('GUARD_DEATH_FIXED_SETUP_OR_CHILD_FAILURE'); process.exitCode = 1; if (unsafeOwner || activeIo > 0) retain(); });
