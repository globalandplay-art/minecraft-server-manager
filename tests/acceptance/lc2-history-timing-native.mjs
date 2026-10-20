// Exactly one read-only observed open of the preserved synthetic1000-history root.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagerLifetimeLock } from '../../apps/api/src/auth/manager-lifetime-lock.ts';
import { WhitelistGuardStore } from '../../apps/api/src/services/whitelist-guard-store.ts';
import { WhitelistEnvelopeAclAction } from '../../apps/api/src/services/whitelist-envelope-acl.ts';
import { WhitelistAclSession } from '../../apps/api/src/services/whitelist-acl-session.ts';
import { historySessionTimings } from '../../apps/api/test/fixtures/whitelist-history-timing.ts';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baselineHash = '7b1c5e3b3854c47ff60a814d8d05c0480e72b340c4dcc35d1388ddfed1c5d1ea';
let active = 0, retainOwner = false;
const hold = () => { process.exitCode = 1; console.error('CLEANUP_BLOCKED_OWNED_NODE_RETAINED');
  console.log(JSON.stringify({ ownedRunnerPid: process.pid })); setInterval(() => undefined, 60000); };
async function main() {
  if (process.platform !== 'win32' || process.argv.slice(2).join('|') !== '--confirm-readonly-preserved-history') {
    console.error('PRESERVED_SYNTHETIC_HISTORY_CONFIRMATION_REQUIRED'); process.exitCode = 2; return;
  }
  const started = performance.now(), setupEnd = started + 30000, adminEnd = started + 110000;
  const bounded = async (action, end) => {
    if (performance.now() >= end) throw new Error(); active++; let timer;
    const raw = Promise.resolve().then(() => { if (performance.now() >= end) throw new Error(); return action(); }).finally(() => { active--; });
    void raw.catch(() => undefined);
    try {
      const value = await Promise.race([raw, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), Math.max(1, end - performance.now())); })]);
      if (performance.now() >= end) throw new Error(); return value;
    } finally { clearTimeout(timer); }
  };
  const project = await bounded(() => realpath(fileURLToPath(new URL('../..', import.meta.url))), setupEnd), evidence = join(project, 'test-results');
  if ((await bounded(() => realpath(evidence), setupEnd)).toLowerCase() !== evidence.toLowerCase()) throw new Error();
  const baselineBytes = await bounded(() => readFile(join(evidence, 'lc2-history-open-bca9b9d1-70ac-40d1-984d-e07e548e63b3.json')), setupEnd);
  if (hash(baselineBytes) !== baselineHash) throw new Error('BASELINE_REPORT_CHANGED');
  const baseline = JSON.parse(baselineBytes.toString('utf8')), root = baseline.root, parent = dirname(root), namespace = join(root, 'whitelist-guards');
  const temp = await bounded(() => realpath(tmpdir()), setupEnd);
  if (basename(root) !== 'manager' || dirname(parent).toLowerCase() !== temp.toLowerCase() || !root.startsWith(temp + sep) ||
    basename(parent) !== 'mcsm-history-open-bca9b9d1-70ac-40d1-984d-e07e548e63b3' || baseline.rows.length !== 1000 || baseline.result !== 'BLOCKED') throw new Error();
  console.log('CONFIRMED_READONLY_PRESERVED_CANONICAL_FIXTURE:', root);
  const frozen = JSON.parse((await bounded(() => readFile(join(evidence, 'lc2-history-frozen-v3.json'), 'utf8'), setupEnd)).replace(/^\uFEFF/u, ''));
  const sources = [...frozen.files, ...await Promise.all(['tests/acceptance/lc2-history-timing-native.mjs',
    'apps/api/test/fixtures/whitelist-history-timing.ts', 'apps/api/test/whitelist-history-timing.test.ts'].map(async (file) => ({ file, sha256: hash(await bounded(() => readFile(join(project, file)), setupEnd)) })))];
  const identity = async (file, end) => {
    const s = await bounded(() => lstat(file, { bigint: true }), end);
    if (!s.isDirectory() || s.isSymbolicLink() || (await bounded(() => realpath(file), end)).toLowerCase() !== file.toLowerCase()) throw new Error();
    return hash(`${s.dev}\0${s.ino}\0${s.birthtimeNs}`);
  };
  const regular = async (file, end) => {
    const s = await bounded(() => lstat(file, { bigint: true }), end);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1n || s.size > 4096n || (await bounded(() => realpath(file), end)).toLowerCase() !== file.toLowerCase()) throw new Error();
    return `${s.dev}:${s.ino}:${s.birthtimeNs}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  };
  const inventory = async (end) => {
    if (await identity(parent, end) !== baseline.parentIdentity || await identity(root, end) !== baseline.rootIdentity ||
      (await bounded(() => readdir(parent), end)).join('|') !== 'manager' ||
      (await bounded(() => readdir(root), end)).sort().join('|') !== 'manager.lifetime.lock|whitelist-guards' ||
      (await bounded(() => readdir(namespace), end)).sort().join('|') !== baseline.rows.map((r) => r.operationId).sort().join('|')) throw new Error();
    const sum = createHash('sha256');
    for (const row of baseline.rows) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(row.operationId) || row.files.map((r) => r.name).sort().join('|') !== '00.bin|manifest.json') throw new Error();
      const dir = join(namespace, row.operationId);
      if (await identity(dir, end) !== row.directoryIdentity || (await bounded(() => readdir(dir), end)).sort().join('|') !== '00.bin|manifest.json') throw new Error();
      for (const record of row.files) {
        const file = join(dir, record.name), before = await regular(file, end), bytes = await bounded(() => readFile(file), end);
        try {
          if (before !== record.fingerprint || hash(bytes) !== record.sha256 || await regular(file, end) !== before) throw new Error();
          if (record.name === 'manifest.json' && JSON.parse(bytes).namespaceIdentity !== await identity(namespace, end)) throw new Error();
        } finally { bytes.fill(0); }
        sum.update(JSON.stringify([row.operationId, record]));
      }
    }
    const value = sum.digest('hex'); if (value !== baseline.beforeInventory) throw new Error(); return value;
  };
  let owner, captured, ownerAttempted = false, ownerReleased = false, ownerAssertRejected = false, captureRestored = true, captureCount = 0;
  let beforeInventory, afterInventory, lockBefore, lockAfter, openElapsedMs = null, openSucceeded = false, stage = 'preflight';
  let primary = null, operationErrorCode = null, sourceUnchanged = false;
  const observer = historySessionTimings((wrapper, now) => new WhitelistAclSession(undefined, now, wrapper));
  const deps = Object.freeze({ sessionFactory: observer.factory });
  try {
    for (const row of sources) if (hash(await bounded(() => readFile(join(project, row.file)), setupEnd)) !== row.sha256) throw new Error();
    beforeInventory = await inventory(setupEnd); lockBefore = await regular(join(root, 'manager.lifetime.lock'), setupEnd);
    stage = 'owner-acquire'; ownerAttempted = true; retainOwner = true;
    owner = await bounded(() => ManagerLifetimeLock.acquire(root), setupEnd);
    if (await identity(root, setupEnd) !== baseline.rootIdentity) throw new Error();
    stage = 'observed-cold-open'; const original = WhitelistEnvelopeAclAction.guardStoreExecutor;
    const capture = function (...args) {
      if (++captureCount !== 1 || args.length !== 4 || args[0] !== owner || args[1] !== root || args[2] !== deps || args[3] !== true) throw new Error();
      captured = original.apply(this, args); return captured;
    };
    let promise; const begin = performance.now();
    WhitelistEnvelopeAclAction.guardStoreExecutor = capture; captureRestored = false;
    try { promise = WhitelistGuardStore.openOwnedWide(root, owner, deps); }
    finally { WhitelistEnvelopeAclAction.guardStoreExecutor = original; captureRestored = WhitelistEnvelopeAclAction.guardStoreExecutor === original; }
    try { await bounded(() => promise, Math.min(begin + 55000, adminEnd - 25000)); openSucceeded = true; }
    finally { openElapsedMs = performance.now() - begin; }
  } catch (error) {
    primary = `TIMING_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`;
    if (error && typeof error === 'object' && ['WHITELIST_GUARD_UNSAFE', 'AUTH_PRIVATE_UNSAFE'].includes(error.code)) operationErrorCode = error.code;
  }
  const state = captured?.diagnostic ?? null;
  const actionDrained = Boolean(stage !== 'observed-cold-open' && !captured || captured && state.phase === 'released' && state.bodySettled && state.resourceCount === 0 && state.activity === 'released' && state.mutation === 'released');
  let physicalError = null;
  if (actionDrained && active === 0 && owner) {
    try {
      afterInventory = await inventory(Math.min(performance.now() + 10000, adminEnd - 15000));
      await bounded(() => owner.release(), Math.min(performance.now() + 15000, adminEnd)); ownerReleased = true;
      try { owner.assertHeld(root); } catch { ownerAssertRejected = true; }
      lockAfter = await regular(join(root, 'manager.lifetime.lock'), Math.min(performance.now() + 5000, adminEnd));
      if (lockAfter !== lockBefore) throw new Error();
    } catch { physicalError = 'TIMING_POST_OR_OWNER_RELEASE_UNCONFIRMED'; }
  }
  const observation = observer.snapshot(), sessionsClosed = observation.rows.every((r) => r.closed && r.pending === 0 && r.closePending === 0);
  const safe = actionDrained && active === 0 && (!ownerAttempted || ownerReleased && ownerAssertRejected) && captureRestored && sessionsClosed;
  retainOwner = !safe;
  try {
    const sourceEnd = Math.min(performance.now() + 5000, adminEnd);
    sourceUnchanged = true;
    for (const row of sources) if (hash(await bounded(() => readFile(join(project, row.file)), sourceEnd)) !== row.sha256) sourceUnchanged = false;
    if (hash(await bounded(() => readFile(join(evidence, 'lc2-history-open-bca9b9d1-70ac-40d1-984d-e07e548e63b3.json')), sourceEnd)) !== baselineHash) sourceUnchanged = false;
  } catch { sourceUnchanged = false; }
  const runId = `lc2-history-timing-${randomUUID()}`, reportFile = join(evidence, runId + '.json');
  const report = { runId, scope: 'READ_ONLY_REAL_SESSION_COST_OBSERVATION_NOT_CAPACITY_PASS', baselineRun: baseline.runId, baselineHash, root,
    runnerPid: process.pid, runnerActualClose: 'EXTERNAL_VERIFICATION_REQUIRED', primary, operationErrorCode, physicalError, stage,
    openSucceeded, openElapsedMs, originalProductWorkMs: 50000, setupBudgetMs: 30000, administrativeBudgetMs: 110000,
    action: state, observation, captureCount, captureRestored, ownerReleased, ownerAssertRejected, lockIdentityPreserved: lockBefore !== undefined && lockBefore === lockAfter,
    beforeInventory, afterInventory, fixtureUnchanged: beforeInventory !== undefined && beforeInventory === afterInventory,
    sourceUnchanged, activeSteps: active, drained: safe, cleanupBlocked: !safe, fixtureRetained: true,
    originalUserWorldAccessed: false, serverLaunched: false, noGuardWrites: true, sources, elapsedMs: performance.now() - started,
    timingMeaning: 'NODE_MONOTONIC_QUERY_BOUNDARIES_FIRST_IS_NOT_PURE_STARTUP_CLOSE_MAY_OVERLAP_DRAIN_NONSESSION_IS_NOT_NODE_IO' };
  try { await bounded(() => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }), performance.now() + 5000); }
  catch { console.error('TIMING_EVIDENCE_SAVE_FAILED'); process.exitCode = 1; }
  console.log(JSON.stringify({ runId, reportFile, primary, drained: safe, fixtureUnchanged: report.fixtureUnchanged }));
  if (!safe || physicalError || !sourceUnchanged || observation.incomplete || primary) process.exitCode = 1;
  if (!safe || active) hold();
}
main().catch(() => { console.error('TIMING_PREFLIGHT_FAILED'); process.exitCode = 1; if (retainOwner || active) hold(); });
