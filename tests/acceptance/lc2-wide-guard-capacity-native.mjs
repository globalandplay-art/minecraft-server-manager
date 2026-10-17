// Explicit MAX64_CREATE_ONLY probe. No production import, real credentials or server.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagerLifetimeLock } from '../../apps/api/src/auth/manager-lifetime-lock.ts';
import { WhitelistGuardStore } from '../../apps/api/src/services/whitelist-guard-store.ts';

const sourceFiles = ['tests/acceptance/lc2-wide-guard-capacity-native.mjs',
  'apps/api/src/services/whitelist-guard-group-scripts.ts',
  'apps/api/src/services/whitelist-guard-store.ts', 'apps/api/src/services/whitelist-command-record.ts',
  'apps/api/src/services/whitelist-member-policy.ts', 'apps/api/src/services/whitelist-reader.ts',
  'apps/api/src/auth/private-publication.ts',
  'apps/api/src/services/whitelist-owned-publication.ts', 'apps/api/src/services/whitelist-envelope-acl.ts',
  'apps/api/src/services/whitelist-action-envelope.ts', 'apps/api/src/services/whitelist-action-resources.ts',
  'apps/api/src/services/whitelist-native-writer.ts', 'apps/api/src/services/whitelist-acl-session.ts',
  'apps/api/src/auth/private-publication-scripts.ts', 'apps/api/src/auth/windows-private-acl.ts',
  'apps/api/src/auth/manager-lifetime-lock.ts', 'apps/api/src/auth/windows-owner-retention.ts',
  'apps/api/src/auth/windows-native.ts', 'apps/api/src/auth/password.ts'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let exitSafe = true, retained = false, activeSteps = 0;
const retainNode = () => {
  process.exitCode = 1;
  if (!retained) {
    retained = true; console.error('CLEANUP_BLOCKED_OWNED_NODE_RETAINED');
    console.log(JSON.stringify({ ownedRunnerPid: process.pid })); setInterval(() => undefined, 60_000);
  }
};
const identity = async (file) => {
  const s = await lstat(file, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(file)).toLowerCase() !== file.toLowerCase()) throw new Error();
  return `${s.dev}:${s.ino}:${s.birthtimeNs}`;
};
const within = async (task, end) => {
  let timer; const observed = Promise.resolve(task);
  try {
    if (performance.now() >= end) { void observed.catch(() => undefined); throw new Error(); }
    const value = await Promise.race([observed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error()), Math.max(1, end - performance.now()));
    })]);
    if (performance.now() >= end) throw new Error(); return value;
  } finally { clearTimeout(timer); }
};
async function main() {
  if (process.platform !== 'win32' || process.argv.slice(2).join('|') !== '--confirm-isolated-max64-create') {
    console.error('ISOLATED_MAX64_CONFIRMATION_REQUIRED'); process.exitCode = 2; return;
  }
  // Administrative clock starts BEFORE source hashing or fixture creation.
  // 20s setup +55s observation (original create50 + shared drain5) +5s readback +15s release.
  const started = performance.now(), workEnd = started + 95_000, setupEnd = started + 20_000;
  const bounded = async (operation, end) => {
    if (performance.now() >= end) throw new Error(); activeSteps++;
    // A synchronous throw after possible side effects is not proof of drain.
    const task = Promise.resolve(operation()).finally(() => { activeSteps--; }); return within(task, end);
  };
  const project = await bounded(() => realpath(fileURLToPath(new URL('../..', import.meta.url))), setupEnd);
  const evidenceDirectory = join(project, 'test-results');
  if ((await bounded(() => realpath(evidenceDirectory), setupEnd)).toLowerCase() !== evidenceDirectory.toLowerCase()) throw new Error();
  const uuid = randomUUID(), runId = `lc2-wide-capacity-${uuid}`, guard = randomUUID();
  const reportFile = join(evidenceDirectory, `${runId}.json`);
  const temp = await bounded(() => realpath(tmpdir()), setupEnd), parent = join(temp, `mcsm-wide-capacity-${uuid}`), root = join(parent, 'manager');
  const namespace = join(root, 'whitelist-guards'), directory = join(namespace, guard);
  const names = [...Array.from({ length: 64 }, (_, i) => `${String(i).padStart(2, '0')}.bin`), 'manifest.json'].sort();
  const expectedNames = names.join('|');
  console.log('PLANNED_FRESH_CANONICAL_FIXTURE:', root);
  const members = [{ name: 'Fixture_Player', uuid: '123e4567-e89b-42d3-a456-426614174000' }];
  const json = Buffer.from(JSON.stringify(members)), bytes = Buffer.concat([json, Buffer.alloc(262144 - json.length, 0x20)]);
  const expectedHash = hash(bytes), chunkHashes = Array.from({ length: 64 }, (_, i) => hash(bytes.subarray(i * 4096, (i + 1) * 4096)));
  const snapshot = { serverId: 'isolated-fixture', rootIdentity: 'a'.repeat(64), configRevision: 'b'.repeat(64),
    fileIdentity: 'c'.repeat(64), fileSha256: expectedHash, runtimeId: randomUUID(), members };
  let parentIdentity, rootIdentity, namespaceIdentity, directoryIdentity, owner, store, opening = false;
  const actionChecks = [], steps = [], physicalFiles = [];
  let parentCreated = false, rootCreated = false, ownerAttempted = false, ownerAcquired = false;
  let ownerRelease = 'not-dispatched', ownerAssertRejected = false, receipt = null, createElapsedMs = null;
  let physicalVerified = false, sourceUnchanged = false, fixtureRemoved = false, removalAttempted = false, pinned = false;
  let primary = null, operationErrorCode = null, stage = 'preparation', hashes = [];
  const mark = (name) => { stage = name; steps.push({ stage: name, elapsedMs: Math.floor(performance.now() - started) }); };
  const checkAction = (name) => {
    const state = store.ownedDiagnostic; actionChecks.push({ name, state });
    if (state?.phase !== 'released' || state.primary !== null || state.mutation !== 'released' || state.activity !== 'released' ||
      !state.bodySettled || state.resourceCount !== 0) throw new Error();
  };
  const sourceHashes = async () => {
    const rows = await Promise.allSettled(sourceFiles.map(async (file) => ({ file, sha256: hash(await readFile(join(project, file))) })));
    if (rows.some((row) => row.status !== 'fulfilled')) throw new Error(); return rows.map((row) => row.value);
  };
  const regular = async (file) => {
    const s = await lstat(file, { bigint: true });
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1n || (await realpath(file)).toLowerCase() !== file.toLowerCase()) throw new Error();
    return `${s.dev}:${s.ino}:${s.birthtimeNs}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  };
  try {
    hashes = await bounded(sourceHashes, setupEnd);
    await bounded(() => mkdir(parent), setupEnd); parentCreated = true;
    await bounded(() => mkdir(root), setupEnd); rootCreated = true;
    parentIdentity = await bounded(() => identity(parent), setupEnd); rootIdentity = await bounded(() => identity(root), setupEnd);
    if ((await bounded(() => readdir(root), setupEnd)).length) throw new Error();
    console.log('CONFIRMED_FRESH_CANONICAL_FIXTURE:', root);
    mark('owner-acquire'); ownerAttempted = true; exitSafe = false;
    owner = await bounded(() => ManagerLifetimeLock.acquire(root), setupEnd); ownerAcquired = true;
    mark('store-open'); opening = true;
    store = await bounded(() => WhitelistGuardStore.openOwnedWide(root, owner), setupEnd); opening = false; checkAction(stage);
    if ((await bounded(() => readdir(root), setupEnd)).sort().join('|') !== 'manager.lifetime.lock') throw new Error();
    mark('guard-create'); const createStart = performance.now(), observeEnd = Math.min(createStart + 55_000, workEnd - 20_000);
    try { receipt = await bounded(() => store.create(guard, snapshot, bytes), observeEnd); }
    finally { createElapsedMs = performance.now() - createStart; }
    checkAction(stage);
    if (createElapsedMs >= 50_000 || JSON.stringify(receipt.snapshot) !== JSON.stringify(snapshot)) throw new Error();
    mark('physical-verification'); const physicalEnd = Math.min(performance.now() + 5000, workEnd - 15_000);
    namespaceIdentity = await bounded(() => identity(namespace), physicalEnd); directoryIdentity = await bounded(() => identity(directory), physicalEnd);
    if ((await bounded(() => readdir(directory), physicalEnd)).sort().join('|') !== expectedNames) throw new Error();
    const aggregate = createHash('sha256');
    for (let i = 0; i < 64; i++) {
      const file = join(directory, `${String(i).padStart(2, '0')}.bin`), before = await bounded(() => regular(file), physicalEnd);
      const actual = await bounded(() => readFile(file), physicalEnd);
      try {
        if (actual.length !== 4096 || hash(actual) !== chunkHashes[i] || !actual.equals(bytes.subarray(i * 4096, (i + 1) * 4096)) ||
          await bounded(() => regular(file), physicalEnd) !== before) throw new Error();
        aggregate.update(actual); physicalFiles.push({ name: basename(file), fingerprint: before, sha256: chunkHashes[i] });
      } finally { actual.fill(0); }
    }
    const manifestFile = join(directory, 'manifest.json'), manifestBefore = await bounded(() => regular(manifestFile), physicalEnd);
    const manifestBytes = await bounded(() => readFile(manifestFile), physicalEnd);
    try {
      const manifest = JSON.parse(manifestBytes.toString('utf8'));
      pinned = manifest.pinned === true && manifest.chunks === 64 && manifest.byteLength === 262144 && manifest.operationId === guard;
      if (!pinned || hash(manifestBytes) !== receipt.receiptHash || aggregate.digest('hex') !== expectedHash ||
        await bounded(() => regular(manifestFile), physicalEnd) !== manifestBefore) throw new Error();
      physicalFiles.push({ name: 'manifest.json', fingerprint: manifestBefore, sha256: receipt.receiptHash });
    } finally { manifestBytes.fill(0); }
    physicalVerified = true;
    mark('source-verification'); const after = await bounded(sourceHashes, physicalEnd);
    sourceUnchanged = hashes.every((row, index) => row.sha256 === after[index].sha256); if (!sourceUnchanged) throw new Error();
  } catch (error) {
    primary = `NATIVE_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`;
    if (error && typeof error === 'object' && ['WHITELIST_GUARD_UNSAFE', 'WHITELIST_ACTION_TIMEOUT', 'AUTH_PRIVATE_UNSAFE'].includes(error.code)) operationErrorCode = error.code;
    if (store) actionChecks.push({ name: 'failure-observation', state: store.ownedDiagnostic });
  }
  const state = store?.ownedDiagnostic;
  // An attempted open with no returned Store is explicitly NOT evidence of drain.
  const actionDrained = !opening && (!store || state?.phase === 'released' && state.bodySettled && state.resourceCount === 0 &&
    state.mutation === 'released' && state.activity === 'released');
  if (ownerAcquired && actionDrained && activeSteps === 0 && performance.now() + 15_000 <= workEnd) {
    try {
      mark('owner-release'); ownerRelease = 'uncertain';
      await bounded(() => owner.release(), Math.min(performance.now() + 15_000, workEnd)); ownerRelease = 'released';
      try { owner.assertHeld(root); } catch { ownerAssertRejected = true; } if (!ownerAssertRejected) throw new Error();
    } catch { primary ??= 'NATIVE_OWNER_RELEASE_FAILED'; }
  }
  const drained = activeSteps === 0 && (!ownerAttempted || ownerAcquired && ownerRelease === 'released' && actionDrained);
  exitSafe = drained;
  if (primary === null && drained && physicalVerified && sourceUnchanged && pinned) {
    const cleanupEnd = performance.now() + 5000;
    try {
      mark('fixture-cleanup');
      await bounded(async () => {
        if (resolve(parent) !== parent || dirname(parent).toLowerCase() !== temp.toLowerCase() || !parent.startsWith(temp + sep) ||
          basename(parent) !== `mcsm-wide-capacity-${uuid}` || await identity(parent) !== parentIdentity ||
          await identity(root) !== rootIdentity || await identity(namespace) !== namespaceIdentity || await identity(directory) !== directoryIdentity ||
          (await readdir(parent)).join('|') !== 'manager' ||
          (await readdir(root)).sort().join('|') !== 'manager.lifetime.lock|whitelist-guards' ||
          (await readdir(namespace)).join('|') !== guard || (await readdir(directory)).sort().join('|') !== expectedNames) throw new Error();
        await regular(join(root, 'manager.lifetime.lock'));
        for (const row of physicalFiles) {
          const file = join(directory, row.name);
          if (await regular(file) !== row.fingerprint || hash(await readFile(file)) !== row.sha256 || performance.now() >= cleanupEnd) throw new Error();
        }
        removalAttempted = true; await rm(parent, { recursive: true, force: false });
      }, cleanupEnd);
      fixtureRemoved = true;
    } catch { primary = 'CLEANUP_BLOCKED'; }
  } else if (primary === null) primary = 'CLEANUP_BLOCKED';
  const finalDrained = drained && activeSteps === 0; exitSafe = finalDrained;
  if (finalDrained) bytes.fill(0); // Pending action may still legitimately own this buffer.
  const report = { runId, scope: 'MAX64_CREATE_ONLY_EMPTY_HISTORY_NOT_END_TO_END_50S',
    result: primary === null ? 'COMPONENT_CHECKS_PASS' : 'BLOCKED', primary, operationErrorCode, stage, root,
    runnerPid: process.pid, runnerActualClose: 'EXTERNAL_VERIFICATION_REQUIRED',
    budgetsMs: { setup: 20000, originalProductCreate: 50000, observationIncludingDrain: 55000, physical: 5000, ownerRelease: 15000, administrative: 95000, cleanup: 5000, evidence: 5000 },
    historyCountBefore: 0, byteLength: 262144, chunks: 64, createElapsedMs,
    ownerAttempted, ownerAcquired, ownerRelease, ownerAssertRejected, actionChecks, opening, receipt, pinned,
    nativeClosePolicy: 'WRITER_REQUIRES_ACTUAL_CLOSE_0_NULL_NO_TEST_INJECTION',
    originalUserWorldAccessed: false, serverLaunched: false, physicalVerified, physicalFiles, expectedHash,
    sourceUnchanged, drained: finalDrained, cleanupBlocked: !finalDrained || primary === 'CLEANUP_BLOCKED', fixtureRemoved,
    fixtureRetained: fixtureRemoved ? false : !removalAttempted && parentCreated && rootCreated ? true : null,
    parentCreated, rootCreated, activeSteps, elapsedMs: Math.floor(performance.now() - started), steps, hashes };
  try { await bounded(() => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }), performance.now() + 5000); }
  catch { console.error('NATIVE_EVIDENCE_SAVE_FAILED'); process.exitCode = 1; }
  console.log(JSON.stringify({ result: report.result, primary, reportFile, root, runnerPid: process.pid, drained: finalDrained, fixtureRemoved }));
  if (primary !== null) process.exitCode = 1;
  if (!finalDrained || activeSteps > 0) retainNode();
}
main().catch(() => { console.error('NATIVE_PROBE_SETUP_FAILED'); process.exitCode = 1; if (!exitSafe || activeSteps > 0) retainNode(); });
