// Explicit isolated normal component probe; never imported by production or Vitest.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagerLifetimeLock } from '../../apps/api/src/auth/manager-lifetime-lock.ts';
import { WhitelistEnvelopeAclAction } from '../../apps/api/src/services/whitelist-envelope-acl.ts';

const sourceFiles = ['tests/acceptance/lc2-owned-publication-native.mjs',
  'apps/api/src/services/whitelist-owned-publication.ts', 'apps/api/src/services/whitelist-envelope-acl.ts',
  'apps/api/src/services/whitelist-action-envelope.ts', 'apps/api/src/services/whitelist-action-resources.ts',
  'apps/api/src/services/whitelist-native-writer.ts', 'apps/api/src/services/whitelist-acl-session.ts',
  'apps/api/src/auth/private-publication-scripts.ts', 'apps/api/src/auth/windows-private-acl.ts',
  'apps/api/src/auth/manager-lifetime-lock.ts', 'apps/api/src/auth/windows-owner-retention.ts',
  'apps/api/src/auth/windows-native.ts', 'apps/api/src/auth/password.ts'];
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
  if (process.platform !== 'win32' || process.argv.slice(2).join('|') !== '--confirm-isolated-owned-publication') {
    console.error('ISOLATED_PUBLICATION_CONFIRMATION_REQUIRED'); process.exitCode = 2; return;
  }
  const started = performance.now(), workEnd = started + 50_000;
  const bounded = async (operation, end = workEnd) => {
    if (performance.now() >= end) throw new Error(); activeSteps++;
    // A synchronous throw after side effects is uncertainty, not proof of drain.
    const task = Promise.resolve(operation()).finally(() => { activeSteps--; }); return within(task, end);
  };
  const project = await bounded(() => realpath(fileURLToPath(new URL('../..', import.meta.url))));
  const evidenceDirectory = join(project, 'test-results');
  if ((await bounded(() => realpath(evidenceDirectory))).toLowerCase() !== evidenceDirectory.toLowerCase()) throw new Error();
  const uuid = randomUUID(), runId = `lc2-owned-publication-${uuid}`, guard = randomUUID();
  const reportFile = join(evidenceDirectory, `${runId}.json`);
  const temp = await bounded(() => realpath(tmpdir())), parent = join(temp, `mcsm-owned-publication-${uuid}`), root = join(parent, 'manager');
  const namespace = join(root, 'whitelist-guards'), directory = join(namespace, guard), target = join(directory, '00.bin');
  console.log('PLANNED_FRESH_CANONICAL_FIXTURE:', root);
  const bytes = Buffer.alloc(4096, 0x35), expectedHash = createHash('sha256').update(bytes).digest('hex');
  let parentIdentity, rootIdentity, namespaceIdentity, directoryIdentity, owner, action;
  let parentCreated = false, rootCreated = false, ownerAttempted = false, ownerAcquired = false;
  let ownerRelease = 'not-dispatched', ownerAssertRejected = false, receipt = null;
  let physicalVerified = false, sourceUnchanged = false, fixtureRemoved = false, removalAttempted = false;
  let primary = null, stage = 'preparation', hashes = []; const steps = [];
  const mark = (name) => { stage = name; steps.push({ stage: name, elapsedMs: Math.floor(performance.now() - started) }); };
  const sourceHashes = async () => {
    const rows = await Promise.allSettled(sourceFiles.map(async (file) => ({ file,
      sha256: createHash('sha256').update(await readFile(join(project, file))).digest('hex') })));
    if (rows.some((row) => row.status !== 'fulfilled')) throw new Error(); return rows.map((row) => row.value);
  };
  try {
    hashes = await bounded(sourceHashes);
    await bounded(() => mkdir(parent)); parentCreated = true;
    await bounded(() => mkdir(root)); rootCreated = true;
    parentIdentity = await bounded(() => identity(parent)); rootIdentity = await bounded(() => identity(root));
    if ((await bounded(() => readdir(root))).length) throw new Error();
    console.log('CONFIRMED_FRESH_CANONICAL_FIXTURE:', root);
    mark('owner-acquire'); ownerAttempted = true; exitSafe = false;
    owner = await bounded(() => ManagerLifetimeLock.acquire(root)); ownerAcquired = true; exitSafe = true;
    // Reserve the original15s owner-release helper within the original50s work budget.
    const actionEnd = workEnd - 15_000;
    if (performance.now() >= actionEnd) throw new Error();
    action = new WhitelistEnvelopeAclAction(owner, root); exitSafe = false;
    await bounded(() => action.runPublication(actionEnd, async (publication) => {
      mark('create-namespace'); await publication.createDirectory('whitelist-guards');
      mark('create-directory'); await publication.createDirectory(`whitelist-guards/${guard}`);
      mark('publish-exact-bytes'); receipt = await publication.publishFile(`whitelist-guards/${guard}/00.bin`, bytes);
      mark('publication-returned');
    }));
    const state = action.diagnostic;
    if (state.phase !== 'released' || state.primary !== null || state.mutation !== 'released' || state.activity !== 'released' ||
      !state.bodySettled || state.resourceCount !== 0 || receipt?.sha256 !== expectedHash || receipt?.byteLength !== bytes.length) throw new Error();
    exitSafe = true; mark('physical-verification');
    namespaceIdentity = await bounded(() => identity(namespace)); directoryIdentity = await bounded(() => identity(directory));
    const file = await bounded(() => lstat(target, { bigint: true }));
    const actual = await bounded(() => readFile(target));
    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1n || !actual.equals(bytes) ||
      (await bounded(() => realpath(target))).toLowerCase() !== target.toLowerCase() ||
      (await bounded(() => readdir(directory))).join('|') !== '00.bin') throw new Error();
    physicalVerified = true;
    mark('source-verification'); const after = await bounded(sourceHashes);
    sourceUnchanged = hashes.every((row, index) => row.sha256 === after[index].sha256);
    if (!sourceUnchanged) throw new Error();
  } catch { primary = `NATIVE_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`; }
  const state = action?.diagnostic ?? null;
  const actionDrained = !action || (state.phase === 'released' && state.bodySettled && state.resourceCount === 0 &&
    state.mutation === 'released' && state.activity === 'released');
  if (ownerAcquired && actionDrained && activeSteps === 0 && performance.now() + 15_000 <= workEnd) {
    try {
      mark('owner-release'); ownerRelease = 'uncertain'; exitSafe = false;
      await bounded(() => owner.release()); ownerRelease = 'released'; exitSafe = true;
      try { owner.assertHeld(root); } catch { ownerAssertRejected = true; }
      if (!ownerAssertRejected) throw new Error();
    } catch { primary ??= 'NATIVE_OWNER_RELEASE_FAILED'; }
  }
  const drained = activeSteps === 0 && (!ownerAttempted || (ownerAcquired && ownerRelease === 'released' && actionDrained));
  exitSafe = drained;
  if (primary === null && drained && physicalVerified && sourceUnchanged) {
    const cleanupEnd = performance.now() + 5000;
    try {
      mark('fixture-cleanup');
      await bounded(async () => {
        if (resolve(parent) !== parent || dirname(parent).toLowerCase() !== temp.toLowerCase() || !parent.startsWith(temp + sep) ||
          basename(parent) !== `mcsm-owned-publication-${uuid}` || await identity(parent) !== parentIdentity ||
          await identity(root) !== rootIdentity || await identity(namespace) !== namespaceIdentity || await identity(directory) !== directoryIdentity ||
          (await readdir(parent)).join('|') !== 'manager' ||
          (await readdir(root)).sort().join('|') !== 'manager.lifetime.lock|whitelist-guards' ||
          (await readdir(namespace)).join('|') !== guard || (await readdir(directory)).join('|') !== '00.bin') throw new Error();
        for (const file of [target, join(root, 'manager.lifetime.lock')]) {
          const s = await lstat(file, { bigint: true });
          if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1n) throw new Error();
        }
        if (createHash('sha256').update(await readFile(target)).digest('hex') !== expectedHash || performance.now() >= cleanupEnd) throw new Error();
        removalAttempted = true; await rm(parent, { recursive: true, force: false });
      }, cleanupEnd);
      fixtureRemoved = true;
    } catch { primary = 'CLEANUP_BLOCKED'; }
  } else if (primary === null) primary = 'CLEANUP_BLOCKED';
  const finalDrained = drained && activeSteps === 0; exitSafe = finalDrained; bytes.fill(0);
  const report = { runId, scope: 'NORMAL_OWNED_PRIVATE_PUBLICATION_ONLY', result: primary === null ? 'COMPONENT_CHECKS_PASS' : 'BLOCKED',
    primary, stage, root, runnerPid: process.pid, runnerActualClose: 'EXTERNAL_VERIFICATION_REQUIRED',
    ownerAttempted, ownerAcquired, ownerRelease, ownerAssertRejected, envelope: state, receipt,
    nativeClosePolicy: 'WRITER_REQUIRES_ACTUAL_CLOSE_0_NULL_NO_TEST_INJECTION',
    physicalVerified, sourceUnchanged, drained: finalDrained, cleanupBlocked: !finalDrained || primary === 'CLEANUP_BLOCKED',
    fixtureRemoved, fixtureRetained: fixtureRemoved ? false : !removalAttempted && parentCreated && rootCreated ? true : null,
    parentCreated, rootCreated, activeSteps, elapsedMs: Math.floor(performance.now() - started), steps, hashes };
  try { await bounded(() => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }), performance.now() + 5000); }
  catch { console.error('NATIVE_EVIDENCE_SAVE_FAILED'); process.exitCode = 1; }
  console.log(JSON.stringify({ result: report.result, primary, reportFile, root, runnerPid: process.pid, drained: finalDrained, fixtureRemoved }));
  if (primary !== null) process.exitCode = 1;
  if (!finalDrained || activeSteps > 0) retainNode();
}
main().catch(() => { console.error('NATIVE_PROBE_SETUP_FAILED'); process.exitCode = 1; if (!exitSafe || activeSteps > 0) retainNode(); });
