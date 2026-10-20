// N1000_C1_PHYSICAL_OPEN_ONLY. Test-only fixed seeding, no real server/credentials.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagerLifetimeLock } from '../../apps/api/src/auth/manager-lifetime-lock.ts';
import { WhitelistGuardStore } from '../../apps/api/src/services/whitelist-guard-store.ts';
import { WhitelistEnvelopeAclAction } from '../../apps/api/src/services/whitelist-envelope-acl.ts';
import { WhitelistNativeWriter, whitelistNativeWriterExecutable } from '../../apps/api/src/services/whitelist-native-writer.ts';
import { whitelistGuardGroupCommandBound } from '../../apps/api/src/services/whitelist-guard-group-scripts.ts';
import { whitelistMemberRevision } from '../../apps/api/src/services/whitelist-member-policy.ts';
import { buildWhitelistHistorySeed } from '../../apps/api/test/fixtures/whitelist-history-seed.ts';

const sourceFiles = ['tests/acceptance/lc2-history-open-native.mjs', 'apps/api/test/fixtures/whitelist-history-seed.ts',
  'apps/api/src/services/whitelist-guard-store.ts', 'apps/api/src/services/whitelist-command-record.ts',
  'apps/api/src/services/whitelist-member-policy.ts', 'apps/api/src/services/whitelist-reader.ts',
  'apps/api/src/services/whitelist-owned-publication.ts', 'apps/api/src/services/whitelist-envelope-acl.ts',
  'apps/api/src/services/whitelist-action-envelope.ts', 'apps/api/src/services/whitelist-action-resources.ts',
  'apps/api/src/services/whitelist-native-writer.ts', 'apps/api/src/services/whitelist-acl-session.ts',
  'apps/api/src/auth/private-publication-scripts.ts', 'apps/api/src/auth/windows-private-acl.ts',
  'apps/api/src/auth/manager-lifetime-lock.ts', 'apps/api/src/auth/windows-owner-retention.ts',
  'apps/api/src/auth/windows-native.ts', 'apps/api/src/auth/password.ts'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
let active = 0, mustRetain = false;
const hold = () => { mustRetain = true; process.exitCode = 1; console.error('CLEANUP_BLOCKED_OWNED_NODE_RETAINED');
  console.log(JSON.stringify({ ownedRunnerPid: process.pid })); setInterval(() => undefined, 60000); };
async function main() {
  if (process.platform !== 'win32' || process.argv.slice(2).join('|') !== '--confirm-isolated-history-open') {
    console.error('ISOLATED_HISTORY_CONFIRMATION_REQUIRED'); process.exitCode = 2; return;
  }
  const started = performance.now(), setupEnd = started + 150000, adminEnd = started + 230000;
  let stopping = false;
  const bounded = async (action, end, closing = false) => {
    if (performance.now() >= end || stopping && !closing) throw new Error('HISTORY_OBSERVATION_DEADLINE');
    active++; let timer;
    const raw = Promise.resolve().then(() => {
      if (performance.now() >= end || stopping && !closing) throw new Error('HISTORY_OBSERVATION_DEADLINE');
      return action();
    }).finally(() => { active--; });
    void raw.catch(() => undefined);
    try {
      const value = await Promise.race([raw, new Promise((_, reject) => {
        timer = setTimeout(() => { stopping = true; reject(new Error('HISTORY_OBSERVATION_DEADLINE')); }, Math.max(1, end - performance.now()));
      })]);
      if (performance.now() >= end) { stopping = true; throw new Error('HISTORY_OBSERVATION_DEADLINE'); } return value;
    } finally { clearTimeout(timer); }
  };
  const project = await bounded(() => realpath(fileURLToPath(new URL('../..', import.meta.url))), setupEnd);
  const evidence = join(project, 'test-results');
  if ((await bounded(() => realpath(evidence), setupEnd)).toLowerCase() !== evidence.toLowerCase()) throw new Error();
  const temp = await bounded(() => realpath(tmpdir()), setupEnd), uuid = randomUUID(), runId = `lc2-history-open-${uuid}`;
  const parent = join(temp, `mcsm-history-open-${uuid}`), root = join(parent, 'manager'), namespace = join(root, 'whitelist-guards');
  console.log('PLANNED_FRESH_CANONICAL_FIXTURE:', root);
  const ids = Array.from({ length: 1000 }, () => randomUUID()), rows = [], writers = [], handles = new Set();
  const source = Buffer.from(JSON.stringify([{ name: 'Fixture_Player', uuid: '123e4567-e89b-42d3-a456-426614174000' }]));
  const snapshot = { serverId: 'isolated-history-fixture', rootIdentity: 'a'.repeat(64), configRevision: 'b'.repeat(64),
    fileIdentity: 'c'.repeat(64), fileSha256: hash(source), runtimeId: randomUUID(), members: JSON.parse(source.toString('utf8')) };
  const { members, ...provenance } = snapshot; void members;
  let owner, captured, hashes, beforeInventory, afterInventory, parentId, rootId, nsId;
  let ownerAttempted = false, ownerReleased = false, leaseReleased = false, ownerAssertRejected = false;
  let releaseLease, releaseActivity, activityReleased = false, openElapsedMs = null, openReturned = false, captureCount = 0;
  let primary = null, operationErrorCode = null, stage = 'setup', sourceUnchanged = false, captureRestored = true;
  const steps = [], mark = (next) => { stage = next; steps.push({ stage, elapsedMs: performance.now() - started }); };
  const identity = async (file, end) => {
    const s = await bounded(() => lstat(file, { bigint: true }), end);
    if (!s.isDirectory() || s.isSymbolicLink() || (await bounded(() => realpath(file), end)).toLowerCase() !== file.toLowerCase()) throw new Error();
    return hash(`${s.dev}\0${s.ino}\0${s.birthtimeNs}`);
  };
  const regular = async (file, end) => {
    const s = await bounded(() => lstat(file, { bigint: true }), end);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1n || s.size > 4096n ||
      (await bounded(() => realpath(file), end)).toLowerCase() !== file.toLowerCase()) throw new Error();
    return `${s.dev}:${s.ino}:${s.birthtimeNs}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  };
  const sourceHashes = async (end) => {
    const result = [];
    for (const file of sourceFiles) result.push({ file, sha256: hash(await bounded(() => readFile(join(project, file)), end)) }); return result;
  };
  const createGroup = async (input) => {
    owner.assertHeld(root);
    const plan = buildWhitelistHistorySeed(root, input), wrapper = owner.nativeAclChildWrapper(root);
    // Check COMPLETE wrapped command before the writer may create its native child.
    whitelistGuardGroupCommandBound(wrapper(plan.script), whitelistNativeWriterExecutable());
    const writer = new WhitelistNativeWriter(wrapper); writers.push(writer);
    let result;
    try { result = await bounded(() => writer.run(plan.script), setupEnd); }
    finally {
      if (!writer.closedConfirmed) await bounded(() => writer.close(Math.min(performance.now() + 5000, adminEnd)), Math.min(performance.now() + 5000, adminEnd), true);
    }
    if (!writer.closeEvidence.actualClose || writer.closeEvidence.exitCode !== 0 || writer.closeEvidence.exitSignal !== null ||
      !result || Object.keys(result).sort().join(',') !== 'entries,ok' || result.ok !== true || result.entries !== plan.entries) throw new Error();
  };
  const fillFile = async (file, bytes) => {
    const before = await regular(file, setupEnd);
    const handle = await bounded(async () => { const h = await open(file, 'r+'); handles.add(h); return h; }, setupEnd);
    try {
      const s = await bounded(() => handle.stat({ bigint: true }), setupEnd);
      if (!s.isFile() || s.nlink !== 1n || s.size !== 0n || before !== `${s.dev}:${s.ino}:${s.birthtimeNs}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`) throw new Error();
      await bounded(() => handle.writeFile(bytes), setupEnd); await bounded(() => handle.sync(), setupEnd);
    } finally {
      // Close-only, even after timeout; no successful result from cleanup can repair failure.
      await bounded(async () => { await handle.close(); handles.delete(handle); }, Math.min(performance.now() + 5000, adminEnd), true);
    }
    const version = await regular(file, setupEnd), actual = await bounded(() => readFile(file), setupEnd);
    try { if (!actual.equals(bytes) || await regular(file, setupEnd) !== version) throw new Error(); }
    finally { actual.fill(0); }
    return { name: basename(file), fingerprint: version, sha256: hash(bytes) };
  };
  const inventory = async (end) => {
    if (resolve(parent) !== parent || dirname(parent).toLowerCase() !== temp.toLowerCase() || !parent.startsWith(temp + sep) ||
      basename(parent) !== `mcsm-history-open-${uuid}` || await identity(parent, end) !== parentId || await identity(root, end) !== rootId ||
      await identity(namespace, end) !== nsId || (await bounded(() => readdir(parent), end)).join('|') !== 'manager' ||
      (await bounded(() => readdir(root), end)).sort().join('|') !== 'manager.lifetime.lock|whitelist-guards' ||
      (await bounded(() => readdir(namespace), end)).sort().join('|') !== [...ids].sort().join('|')) throw new Error();
    const sum = createHash('sha256');
    for (const row of rows) {
      const dir = join(namespace, row.operationId);
      if (await identity(dir, end) !== row.directoryIdentity || (await bounded(() => readdir(dir), end)).sort().join('|') !== '00.bin|manifest.json') throw new Error();
      for (const record of row.files) {
        const file = join(dir, record.name), before = await regular(file, end);
        const bytes = await bounded(() => readFile(file), end);
        try { if (before !== record.fingerprint || hash(bytes) !== record.sha256 || await regular(file, end) !== before) throw new Error(); }
        finally { bytes.fill(0); }
        sum.update(JSON.stringify([row.operationId, record]));
      }
    }
    return sum.digest('hex');
  };
  try {
    hashes = await sourceHashes(setupEnd);
    await bounded(() => mkdir(parent), setupEnd); await bounded(() => mkdir(root), setupEnd);
    parentId = await identity(parent, setupEnd); rootId = await identity(root, setupEnd);
    if ((await bounded(() => readdir(root), setupEnd)).length) throw new Error();
    console.log('CONFIRMED_FRESH_CANONICAL_FIXTURE:', root);
    mark('owner-acquire'); ownerAttempted = true; mustRetain = true;
    owner = await bounded(() => ManagerLifetimeLock.acquire(root), setupEnd);
    if (await identity(root, setupEnd) !== rootId) throw new Error();
    releaseActivity = owner.beginActivity(root); releaseLease = owner.beginOfflineMutation(root);
    mark('seed-empty-private-entries'); await createGroup(null); nsId = await identity(namespace, setupEnd);
    for (let offset = 0; offset < ids.length; offset += 32) await createGroup(ids.slice(offset, offset + 32));
    mark('seed-exact-fsynced-content');
    for (const operationId of ids) {
      const dir = join(namespace, operationId), directoryIdentity = await identity(dir, setupEnd);
      const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, operationId, managerRootIdentity: owner.rootIdentity(), namespaceIdentity: nsId,
        directoryIdentity, source: provenance, revision: whitelistMemberRevision(snapshot), byteLength: source.length, chunks: 1, pinned: true }));
      const files = [await fillFile(join(dir, '00.bin'), source), await fillFile(join(dir, 'manifest.json'), manifest)];
      rows.push({ operationId, directoryIdentity, files }); manifest.fill(0);
    }
    mark('seed-inventory'); beforeInventory = await inventory(setupEnd);
    if (active || handles.size || writers.some((writer) => !writer.closedConfirmed)) throw new Error();
    releaseLease(); leaseReleased = true; releaseActivity(); activityReleased = true;
    mark('cold-open');
    const original = WhitelistEnvelopeAclAction.guardStoreExecutor;
    const capture = function (...args) {
      if (++captureCount !== 1 || args.length !== 4 || args[0] !== owner || args[1] !== root || args[2] !== undefined || args[3] !== true) throw new Error();
      captured = original.apply(this, args); return captured;
    };
    let promise; const openStart = performance.now();
    WhitelistEnvelopeAclAction.guardStoreExecutor = capture; captureRestored = false;
    try { promise = WhitelistGuardStore.openOwnedWide(root, owner); }
    finally { WhitelistEnvelopeAclAction.guardStoreExecutor = original; captureRestored = WhitelistEnvelopeAclAction.guardStoreExecutor === original; }
    try { await bounded(() => promise, Math.min(openStart + 55000, adminEnd - 25000)); openReturned = true; }
    finally { openElapsedMs = performance.now() - openStart; }
    if (!captureRestored || captureCount !== 1 || openElapsedMs >= 50000 || captured.diagnostic.primary !== null) throw new Error();
    mark('post-open-inventory'); afterInventory = await inventory(Math.min(performance.now() + 10000, adminEnd - 15000));
    if (beforeInventory !== afterInventory) throw new Error();
  } catch (error) {
    primary = `HISTORY_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`;
    if (error && typeof error === 'object' && ['WHITELIST_GUARD_UNSAFE', 'WHITELIST_WRITER_UNSAFE', 'AUTH_PRIVATE_UNSAFE', 'CLEANUP_BLOCKED'].includes(error.code)) operationErrorCode = error.code;
  }
  const state = captured?.diagnostic ?? null;
  const actionDrained = Boolean(stage !== 'cold-open' && !captured || captured && state.phase === 'released' && state.bodySettled && state.resourceCount === 0 && state.mutation === 'released' && state.activity === 'released');
  const drained = active === 0 && handles.size === 0 && writers.every((writer) => writer.closedConfirmed) && actionDrained && captureRestored;
  if (drained && owner && performance.now() < adminEnd) {
    try {
      if (!leaseReleased && releaseLease) { releaseLease(); leaseReleased = true; }
      if (!activityReleased && releaseActivity) { releaseActivity(); activityReleased = true; }
      await bounded(() => owner.release(), Math.min(performance.now() + 15000, adminEnd), true); ownerReleased = true;
      try { owner.assertHeld(root); } catch { ownerAssertRejected = true; }
      if (!ownerAssertRejected) throw new Error();
    } catch { primary ??= 'HISTORY_OWNER_RELEASE_FAILED'; }
  }
  const safe = drained && (!ownerAttempted || ownerReleased && ownerAssertRejected);
  mustRetain = !safe;
  if (safe) source.fill(0);
  // Source verification never touches retained fixture/credentials, and is read-only.
  if (safe && hashes) {
    try { const after = await sourceHashes(performance.now() + 5000); sourceUnchanged = JSON.stringify(after) === JSON.stringify(hashes); }
    catch { /* unavailable evidence is not PASS */ }
  }
  if (!sourceUnchanged || !safe || !openReturned || beforeInventory !== afterInventory) primary ??= 'HISTORY_FINAL_EVIDENCE_INCOMPLETE';
  const report = { runId, scope: 'N1000_C1_PHYSICAL_OPEN_ONLY', result: primary === null ? 'COMPONENT_CHECKS_PASS' : 'BLOCKED', primary, operationErrorCode,
    stage, runnerPid: process.pid, runnerActualClose: 'EXTERNAL_VERIFICATION_REQUIRED', root, parentIdentity: parentId, rootIdentity: rootId,
    historyCount: 1000, chunksPerHistory: 1, memberCountPerHistory: 1, seedEntries: 3001, seededHistories: rows.length,
    seedWriterCount: writers.length, seedCloseEvidence: writers.map((writer) => writer.closeEvidence),
    setupAcknowledgementIsAclReceipt: false, originalProductWorkMs: 50000, setupBudgetMs: 150000, administrativeBudgetMs: 230000,
    openElapsedMs, openReturned, captureCount, captureRestored, action: state, activeSteps: active, openHandles: handles.size,
    beforeInventory, afterInventory, leaseReleased, activityReleased, ownerReleased, ownerAssertRejected, sourceUnchanged,
    drained: safe, cleanupBlocked: !safe, fixtureRetained: true, fixtureRemovalAttempted: false,
    originalUserWorldAccessed: false, serverLaunched: false, elapsedMs: performance.now() - started, steps, hashes, rows };
  const reportFile = join(evidence, `${runId}.json`);
  try { await bounded(() => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }), performance.now() + 5000, true); }
  catch { process.exitCode = 1; console.error('HISTORY_EVIDENCE_SAVE_FAILED'); }
  console.log(JSON.stringify({ result: report.result, primary, reportFile, runnerPid: process.pid, drained: safe, fixtureRetained: true }));
  if (primary !== null) process.exitCode = 1;
  if (!safe || active) hold();
}
main().catch(() => { console.error('HISTORY_PROBE_SETUP_FAILED'); process.exitCode = 1; if (mustRetain || active) hold(); });
