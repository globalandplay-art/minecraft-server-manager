// Explicit normal native-component probe. Never loaded by production or the full test suite.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagerLifetimeLock } from '../../apps/api/src/auth/manager-lifetime-lock.ts';
import { WhitelistActionEnvelope } from '../../apps/api/src/services/whitelist-action-envelope.ts';
import { WhitelistNativeWriter, WhitelistWriterError } from '../../apps/api/src/services/whitelist-native-writer.ts';
import { envelopeWriterPayload, validEnvelopeWriterPayload } from '../../apps/api/test/fixtures/whitelist-envelope-writer-payload.ts';

const sourceFiles = ['tests/acceptance/lc2-envelope-writer-native.mjs',
  'apps/api/test/fixtures/whitelist-envelope-writer-payload.ts',
  'apps/api/src/services/whitelist-action-envelope.ts', 'apps/api/src/services/whitelist-action-resources.ts',
  'apps/api/src/services/whitelist-native-writer.ts', 'apps/api/src/services/whitelist-acl-session.ts',
  'apps/api/src/auth/manager-lifetime-lock.ts', 'apps/api/src/auth/windows-owner-retention.ts',
  'apps/api/src/auth/windows-native.ts', 'apps/api/src/auth/password.ts'];
let exitSafe = true, retained = false, activeSteps = 0;
const retainNode = () => {
  process.exitCode = 1;
  if (!retained) { retained = true; console.error('CLEANUP_BLOCKED_OWNED_NODE_RETAINED'); console.log(JSON.stringify({ ownedRunnerPid: process.pid })); setInterval(() => undefined, 60_000); }
};
const identity = async (file) => {
  const s = await lstat(file, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(file)).toLowerCase() !== file.toLowerCase()) throw new Error();
  return `${s.dev}:${s.ino}:${s.birthtimeNs}`;
};
const within = async (task, end) => {
  let timer;
  const observed = Promise.resolve(task);
  try {
    if (performance.now() >= end) { void observed.catch(() => undefined); throw new Error(); }
    const value = await Promise.race([observed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error()), Math.max(1, end - performance.now()));
    })]);
    if (performance.now() >= end) throw new Error(); return value;
  } finally { clearTimeout(timer); }
};
async function main() {
  if (process.platform !== 'win32' || process.argv.slice(2).join('|') !== '--confirm-isolated-whitelist-writer') {
    console.error('ISOLATED_WRITER_CONFIRMATION_REQUIRED'); process.exitCode = 2; return;
  }
  const started = performance.now(), workEnd = started + 50_000;
  const bounded = async (action, end = workEnd) => {
    if (performance.now() >= end) throw new Error();
    activeSteps++;
    // A synchronous throw may have started work; retain that uncertainty.
    const task = Promise.resolve(action()).finally(() => { activeSteps--; });
    return within(task, end);
  };
  const project = await bounded(() => realpath(fileURLToPath(new URL('../..', import.meta.url))));
  const evidenceDirectory = join(project, 'test-results');
  if ((await bounded(() => realpath(evidenceDirectory))).toLowerCase() !== evidenceDirectory.toLowerCase()) throw new Error();
  const uuid = randomUUID(), runId = `lc2-envelope-writer-${uuid}`;
  const reportFile = join(evidenceDirectory, `${runId}.json`);
  const temp = await bounded(() => realpath(tmpdir())), parent = join(temp, `mcsm-envelope-writer-${uuid}`), root = join(parent, 'manager');
  console.log('PLANNED_FRESH_CANONICAL_FIXTURE:', root);
  let parentIdentity, rootIdentity, owner, envelope, writer, parentCreated = false, rootCreated = false;
  let stage = 'preparation', primary = null, ownerAttempted = false, ownerAcquired = false;
  let ownerRelease = 'not-dispatched', ownerAssertRejected = false, writerAttempted = false, writerFailure = null;
  let payloadVerified = false, sourceUnchanged = false, fixtureRemoved = false, removalAttempted = false;
  let hashes = [];
  const fence = () => { if (performance.now() >= workEnd) throw new Error(); };
  const sourceHashes = async () => {
    const rows = await Promise.allSettled(sourceFiles.map(async (file) => ({ file,
      sha256: createHash('sha256').update(await readFile(join(project, file))).digest('hex') })));
    if (rows.some((row) => row.status !== 'fulfilled')) throw new Error();
    return rows.map((row) => row.value);
  };
  try {
    fence();
    hashes = await bounded(sourceHashes);
    await bounded(() => mkdir(parent)); parentCreated = true;
    await bounded(() => mkdir(root)); rootCreated = true;
    parentIdentity = await bounded(() => identity(parent)); rootIdentity = await bounded(() => identity(root));
    if ((await bounded(() => readdir(root))).length) throw new Error();
    console.log('CONFIRMED_FRESH_CANONICAL_FIXTURE:', root);
    stage = 'owner-acquire'; fence(); ownerAttempted = true; exitSafe = false;
    owner = await bounded(() => ManagerLifetimeLock.acquire(root)); ownerAcquired = true; exitSafe = true; fence();
    // Reserve the original15s owner-release helper budget within the same50s work.
    stage = 'work-budget'; const actionEnd = workEnd - 15_000;
    if (performance.now() >= actionEnd) throw new Error();
    stage = 'envelope-setup'; envelope = new WhitelistActionEnvelope(owner, root);
    stage = 'envelope-writer'; exitSafe = false;
    await bounded(() => envelope.run(actionEnd, async (capability) => {
      const value = await capability.start(() => {
        writer = new WhitelistNativeWriter(owner.nativeAclChildWrapper(root));
        writerAttempted = true;
        const result = writer.run(envelopeWriterPayload).catch((error) => {
          writerFailure = error instanceof WhitelistWriterError ? error.reason : 'unknown'; throw new Error();
        });
        return { result, get closedConfirmed() { return writer.closedConfirmed; }, drain: (end) => writer.close(end) };
      });
      capability.assertActive();
      if (!validEnvelopeWriterPayload(value)) throw new Error(); payloadVerified = true;
    }));
    const state = envelope.diagnostic;
    if (state.phase !== 'released' || state.primary !== null || state.mutation !== 'released' || state.activity !== 'released' ||
      !state.bodySettled || state.resourceCount !== 0 || !writer.closeEvidence.actualClose ||
      writer.closeEvidence.exitCode !== 0 || writer.closeEvidence.exitSignal !== null) throw new Error();
    exitSafe = true;
    stage = 'owner-release';
    if (performance.now() + 15_000 > workEnd) throw new Error();
    ownerRelease = 'uncertain'; exitSafe = false;
    await bounded(() => owner.release()); ownerRelease = 'released'; exitSafe = true; fence();
    try { owner.assertHeld(root); } catch { ownerAssertRejected = true; }
    if (!ownerAssertRejected) throw new Error();
    stage = 'source-verification';
    const after = await bounded(sourceHashes);
    sourceUnchanged = hashes.every((row, index) => row.sha256 === after[index].sha256);
    if (!sourceUnchanged) throw new Error(); fence();
  } catch { primary = `NATIVE_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`; }

  const state = envelope?.diagnostic ?? null;
  const drained = activeSteps === 0 && (!ownerAttempted || (ownerAcquired && ownerRelease !== 'uncertain' &&
    (!envelope || (state.phase === 'released' && state.bodySettled && state.resourceCount === 0)) &&
    (!writerAttempted || writer?.closeEvidence.actualClose === true)));
  exitSafe = drained;
  if (primary === null) {
    const cleanupEnd = performance.now() + 5000;
    try {
      stage = 'fixture-cleanup';
      await bounded(async () => {
        if (!drained || ownerRelease !== 'released' || !payloadVerified || !sourceUnchanged ||
          resolve(parent) !== parent || dirname(parent).toLowerCase() !== temp.toLowerCase() || !parent.startsWith(temp + sep) ||
          basename(parent) !== `mcsm-envelope-writer-${uuid}` || await identity(parent) !== parentIdentity || await identity(root) !== rootIdentity ||
          (await readdir(parent)).join('|') !== 'manager' || (await readdir(root)).join('|') !== 'manager.lifetime.lock') throw new Error();
        const file = await lstat(join(root, 'manager.lifetime.lock'), { bigint: true });
        if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1n || performance.now() >= cleanupEnd) throw new Error();
        removalAttempted = true; await rm(parent, { recursive: true, force: false });
      }, cleanupEnd);
      fixtureRemoved = true;
    } catch { primary = 'CLEANUP_BLOCKED'; }
  }
  const finalDrained = drained && activeSteps === 0;
  exitSafe = finalDrained;
  const report = { runId, scope: 'NORMAL_OWNER_ENVELOPE_INERT_WRITER_ONLY', result: primary === null ? 'COMPONENT_CHECKS_PASS' : 'BLOCKED',
    primary, stage, root, runnerPid: process.pid, runnerActualClose: 'EXTERNAL_VERIFICATION_REQUIRED',
    ownerAttempted, ownerAcquired, ownerRelease, ownerAssertRejected, writerAttempted, writerFailure,
    writerClose: writer?.closeEvidence ?? null, envelope: state, payloadVerified, sourceUnchanged,
    drained: finalDrained, cleanupBlocked: !finalDrained || primary === 'CLEANUP_BLOCKED', fixtureRemoved,
    fixtureRetained: fixtureRemoved ? false : !removalAttempted && parentCreated && rootCreated ? true : null,
    parentCreated, rootCreated, activeSteps,
    elapsedMs: Math.floor(performance.now() - started), hashes };
  // Bounded evidence-only phase; does not extend work or restart any resource cleanup.
  try { await bounded(() => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }), performance.now() + 5000); }
  catch { console.error('NATIVE_EVIDENCE_SAVE_FAILED'); process.exitCode = 1; }
  console.log(JSON.stringify({ result: report.result, primary, reportFile, root, runnerPid: process.pid, drained: finalDrained, fixtureRemoved }));
  if (primary !== null) process.exitCode = 1;
  // Unknown child/body/ownership state: preserve this exact known Node, no new work/release/retry.
  if (!finalDrained || activeSteps > 0) retainNode();
}
main().catch(() => { console.error('NATIVE_PROBE_SETUP_FAILED'); process.exitCode = 1; if (!exitSafe || activeSteps > 0) retainNode(); });
