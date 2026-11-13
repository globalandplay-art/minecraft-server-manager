import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const activation = process.argv[2] === '--activation';
const generation = process.argv[2] === '--generation';
const repeated = process.argv[2] === '--repeated';
const replacementImportRecovery = process.argv[2] === '--replacement-import-recovery';
const replacementRecovery = process.argv[2] === '--replacement-recovery' || replacementImportRecovery;
const replacement = process.argv[2] === '--replacement' || replacementRecovery;
const runId = `worlds-v2-${generation ? 'generation' : replacementImportRecovery ? 'replacement-import-recovery' : replacementRecovery ? 'replacement-recovery' : replacement ? 'replacement' : repeated ? 'repeated' : activation ? 'activation' : 'import'}-crash-${randomUUID()}`;
const evidence = path.resolve('test-results', runId);
await mkdir(evidence, { recursive: true });
const children = new Set(); const results = [];
const sourceFiles = ['apps/api/src/services/world-library-import-service.ts', 'apps/api/src/services/world-library-store.ts',
  'apps/api/src/services/transaction-journal.ts', 'apps/api/src/services/operation-service.ts', 'apps/api/src/services/operation-store.ts', 'apps/api/src/services/world-import-upload-service.ts',
  'apps/api/src/services/backup-identity.ts', 'apps/api/src/services/restore-files.ts', 'packages/contracts/src/index.ts',
  'tests/acceptance/worlds-v2-import-child.ts', 'tests/acceptance/worlds-v2-import-process-crash.mjs',
  'apps/api/src/services/world-activation-service.ts', 'apps/api/src/services/world-activation-plan-service.ts',
  'apps/api/src/services/world-activation-reconciler.ts', 'apps/api/src/services/active-world-state-store.ts',
  'apps/api/src/services/backup-service.ts', 'apps/api/src/services/world-compatibility.ts', 'apps/api/src/config/properties.ts',
  'apps/api/src/services/world-activation-live-history.ts', 'apps/api/src/services/world-activation-history-protection.ts',
  'apps/api/src/services/world-activation-protection.ts', 'apps/api/src/services/world-activation-source.ts', 'apps/api/src/services/world-activation-history.ts',
  'apps/api/src/services/world-transition-history.ts', 'apps/api/src/services/world-replacement-service.ts',
  'apps/api/src/services/world-replacement-journal-proof.ts', 'apps/api/src/services/world-replacement-installed.ts',
  'apps/api/src/services/world-replacement-approval.ts', 'apps/api/src/services/world-replacement-protection.ts',
  'apps/api/src/services/world-transition-records.ts', 'apps/api/src/services/world-replacement-live.ts',
  'apps/api/src/services/world-create-service.ts', 'apps/api/src/services/world-create-plan-service.ts',
  'apps/api/src/services/world-generation-reservation.ts', 'apps/api/src/services/world-inventory-service.ts'];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
async function child(root, mode, boundary, nonce) {
  const startedAt = new Date().toISOString(), started = performance.now();
  const owned = spawn(process.execPath, ['--import', 'tsx', 'tests/acceptance/worlds-v2-import-child.ts', root, mode, boundary, nonce, generation ? 'generation' : replacementImportRecovery ? 'replacement-import-recovery' : replacementRecovery ? 'replacement-recovery' : replacement ? 'replacement' : repeated ? 'repeated' : activation ? 'activation' : 'import'],
    { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.add(owned);
  owned.on('error', () => {}); // close/status remain the authoritative launch evidence.
  let message, timeout = false, stopping = false;
  const closed = new Promise(resolve => owned.once('close', (code, signal) => { children.delete(owned); resolve({ code, signal }); }));
  const stopOwned = () => { if (!stopping) { stopping = true; owned.kill(); } };
  const timer = setTimeout(() => { timeout = true; stopOwned(); }, 30_000);
  owned.on('message', value => { message = value; if (mode === 'run' && value.kind === 'boundary') stopOwned(); });
  const status = await Promise.race([closed, new Promise((_, reject) => {
    const cleanup = setTimeout(() => reject(new Error('CLEANUP_BLOCKED: owned child close not confirmed')), 38_000);
    closed.then(() => clearTimeout(cleanup));
  })]).finally(() => clearTimeout(timer));
  assert.equal(timeout, false, 'owned process exceeded bounded acceptance deadline');
  assert.ok(message, 'NO_CHILD_EVIDENCE');
  if (mode === 'probe') { assert.equal(status.code, 0); assert.equal(status.signal, null); }
  else assert.ok(status.signal !== null || status.code !== 0, 'boundary child must actually be interrupted');
  assert.notEqual(owned.pid, process.pid);
  return { message, status, pid: owned.pid, parentPid: process.pid, startedAt, durationMs: performance.now() - started, closed: true };
}
const knownBoundaries = generation ? ['generation-reserved', 'active-state-installed', 'after-commit'] : replacement ? ['replacement-intent-persisted', 'replacement-old-world-renamed', 'replacement-new-world-renamed', 'replacement-commit-persisted', 'replacement-head-completed'] : repeated ? ['activation-head-reserved', 'activation-commit-persisted', 'activation-head-completed', 'activation-after-commit'] : activation ? ['activation-intent-persisted', 'activation-guard-verified', 'activation-config-installed',
  'activation-state-installed', 'activation-commit-persisted', 'activation-after-commit'] : ['identity-intent-persisted', 'independent-workspace-created', 'independent-world-staged',
  'independent-world-install-intent', 'independent-world-installed', 'independent-identity-installed', 'independent-after-commit'];
const selected = process.argv.slice(activation || repeated || replacement || generation ? 3 : 2);
assert.ok(selected.every(boundary => knownBoundaries.includes(boundary)) && new Set(selected).size === selected.length, 'invalid bounded phase selection');
const boundaries = selected.length ? selected : knownBoundaries;
try {
  for (const [index, boundary] of boundaries.entries()) {
    const root = path.join(evidence, `fixture-${index}`), nonce = randomUUID(); await mkdir(root);
    await writeFile(path.join(root, 'test-owner.json'), JSON.stringify({ kind: 'lt-worlds-v2-owned-fixture', nonce }));
    const interrupted = await child(root, 'run', boundary, nonce);
    assert.equal(interrupted.message.kind, 'boundary'); assert.equal(interrupted.message.point, boundary);
    const probe = await child(root, 'probe', boundary, nonce);
    assert.equal(probe.message.kind, 'probe'); assert.equal(probe.message.worldId, interrupted.message.worldId);
    assert.equal(probe.message.operationId, interrupted.message.operationId);
    if (generation) {
      assert.equal(probe.message.operationState, 'interrupted'); assert.equal(probe.message.recoveryRequired, true);
      assert.equal(probe.message.activeStateUnchanged, true); assert.equal(probe.message.replaySameOperation, true);
      assert.equal(probe.message.serverBytesUnchanged, true); assert.equal(probe.message.transactionCount, 1); assert.equal(probe.message.javaStarts, 0);
      assert.equal(probe.message.journalState, boundary === 'after-commit' ? 'committed' : 'active');
      results.push({ boundary, interrupted, probe, retainedFixture: `fixture-${index}` });
      await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'IN_PROGRESS', sourceSha256, results }, null, 2));
      console.log(`PASS ${boundary}: independent generation preparation restart gated, UUID retained, no replay`);
      continue;
    }
    if (replacement) {
      const verified = replacementRecovery && boundary === 'replacement-head-completed';
      assert.equal(probe.message.recoveryRequired, !verified); assert.equal(probe.message.physicalRecoveryAccepted, verified);
      assert.equal(probe.message.operationState, verified ? 'succeeded' : 'interrupted'); assert.equal(probe.message.replaySameOperation, true);
      assert.equal(probe.message.transactionCount, replacementImportRecovery ? 2 : 1); assert.equal(probe.message.javaStarts, 0); assert.equal(probe.message.serverBytesUnchanged, true);
      if (replacementImportRecovery) {
        assert.equal(probe.message.importOperationState, verified ? 'succeeded' : 'interrupted');
        assert.equal(probe.message.importOperationId, interrupted.message.importOperationId);
        assert.equal(probe.message.importWorldId, interrupted.message.importWorldId);
      }
      assert.equal(probe.message.journalState, ['replacement-commit-persisted', 'replacement-head-completed'].includes(boundary) ? 'committed' : 'active');
      results.push({ boundary, interrupted, probe, retainedFixture: `fixture-${index}` });
      await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'IN_PROGRESS', sourceSha256, results }, null, 2));
      console.log(`PASS ${boundary}: replacement bytes retained, independent restart ${verified ? 'explicitly verified' : 'gated'}, no replay`);
      continue;
    }
    if (repeated) {
      assert.equal(probe.message.serverBytesUnchanged, true); assert.equal(probe.message.transactionCount, 4);
      const complete = ['activation-head-completed', 'activation-after-commit'].includes(boundary);
      assert.equal(probe.message.javaStarts, 0); assert.equal(probe.message.recoveryRequired, !complete);
      assert.equal(probe.message.physicalVerified, complete);
      assert.equal(probe.message.operationState, complete ? 'succeeded' : 'interrupted');
      if (complete) assert.equal(probe.message.operationResourceId, interrupted.message.worldId);
      results.push({ boundary, interrupted, probe, retainedFixture: `fixture-${index}` });
      await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'IN_PROGRESS', sourceSha256, results }, null, 2));
      console.log(`PASS ${boundary}: independent restart; complete evidence confirmed, partial evidence gated`);
      continue;
    }
    assert.equal(probe.message.replaySameOperation, true); assert.equal(probe.message.serverBytesUnchanged, true);
    assert.equal(probe.message.transactionCount, activation ? 2 : 1); assert.equal(probe.message.javaStarts, 0);
    const verifiedCommit = activation ? ['activation-commit-persisted', 'activation-after-commit'].includes(boundary) : boundary === 'independent-after-commit';
    assert.equal(probe.message.recoveryRequired, !verifiedCommit);
    assert.equal(probe.message.operationState, verifiedCommit ? 'succeeded' : 'interrupted');
    if (activation && verifiedCommit) assert.equal(probe.message.operationResourceId, interrupted.message.worldId);
    if (activation && boundary === 'activation-after-commit') assert.equal(probe.message.postCommitWorldChangeSimulated, true);
    results.push({ boundary, interrupted, probe, retainedFixture: `fixture-${index}` });
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'IN_PROGRESS', sourceSha256, results }, null, 2));
    console.log(`PASS ${boundary}: independent Node restart, stable ID, no replay, original world retained`);
  }
  assert.equal(children.size, 0);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', scope: 'isolated Fake Minecraft adapter with real OS processes/filesystem',
    originalUserDataAccessed: false, childrenClosed: true, javaStarts: 0, nodeVersion: process.version, platform: process.platform, sourceSha256, results }, null, 2));
  console.log(`Evidence: test-results/${runId}/result.json`);
} catch (error) {
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'FAIL', failureCode: error.message?.startsWith('CLEANUP_BLOCKED') ? 'CLEANUP_BLOCKED' : 'ACCEPTANCE_FAILED',
    ownedChildrenStillOpen: children.size, sourceSha256, results }, null, 2));
  throw error;
}
