import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const activation = process.argv[2] === '--activation';
const runId = `worlds-v2-${activation ? 'activation' : 'import'}-crash-${randomUUID()}`;
const evidence = path.resolve('test-results', runId);
await mkdir(evidence, { recursive: true });
const children = new Set(); const results = [];
const sourceFiles = ['apps/api/src/services/world-library-import-service.ts', 'apps/api/src/services/world-library-store.ts',
  'apps/api/src/services/transaction-journal.ts', 'apps/api/src/services/operation-service.ts', 'apps/api/src/services/world-import-upload-service.ts',
  'apps/api/src/services/backup-identity.ts', 'apps/api/src/services/restore-files.ts', 'packages/contracts/src/index.ts',
  'tests/acceptance/worlds-v2-import-child.ts', 'tests/acceptance/worlds-v2-import-process-crash.mjs',
  'apps/api/src/services/world-activation-service.ts', 'apps/api/src/services/world-activation-plan-service.ts',
  'apps/api/src/services/world-activation-reconciler.ts', 'apps/api/src/services/active-world-state-store.ts',
  'apps/api/src/services/backup-service.ts', 'apps/api/src/services/world-compatibility.ts', 'apps/api/src/config/properties.ts'];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
async function child(root, mode, boundary, nonce) {
  const startedAt = new Date().toISOString(), started = performance.now();
  const owned = spawn(process.execPath, ['--import', 'tsx', 'tests/acceptance/worlds-v2-import-child.ts', root, mode, boundary, nonce, activation ? 'activation' : 'import'],
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
const knownBoundaries = activation ? ['activation-intent-persisted', 'activation-guard-verified', 'activation-config-installed',
  'activation-state-installed', 'activation-commit-persisted', 'activation-after-commit'] : ['identity-intent-persisted', 'independent-workspace-created', 'independent-world-staged',
  'independent-world-install-intent', 'independent-world-installed', 'independent-identity-installed', 'independent-after-commit'];
const selected = process.argv.slice(activation ? 3 : 2);
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
