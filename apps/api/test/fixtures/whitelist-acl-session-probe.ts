import { join, relative, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ManagerLifetimeLock } from "../../src/auth/manager-lifetime-lock.js";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";
import { createPrivateEntry, writePrivateNew, publishPrivateStageNew } from "../../src/auth/private-publication.js";
import { PrototypeAclSession, AclSessionError } from "./whitelist-acl-session.js";
import { WhitelistGuardStore } from "../../src/services/whitelist-guard-store.js";
import { SyntheticRuntime } from "../whitelist-synthetic-fixture.js";
import { WhitelistAclScope } from "../../src/services/whitelist-acl-scope.js";
import { nativePathData } from "../../src/auth/windows-native.js";
import { setTimeout as delay } from "node:timers/promises";
import { detachedAclFactory } from './whitelist-detached-factory.js';

const [root, mode] = process.argv.slice(2);
if (!root || !["normal", "parent", "guard", "scope", "rotation", "retention", "retained-parent", "retained-parent-auto", "retained-handoff"].includes(mode ?? "") || !process.send) process.exit(2);
let session = new PrototypeAclSession();
const ownedSessions: PrototypeAclSession[] = [];
const acl = new WindowsPrivateAclVerifier();
let owner: ManagerLifetimeLock | undefined, release: (() => void) | undefined;
let ownershipUncertain = false;
let bridgePid: number | undefined;
let stage: "owner-acquire" | "fixture-directory" | "fixture-file" | "legacy-baseline" | "active-query" | "active-checkpoint" | "normal-query" | "normal-close" | "owner-release" | "other" = "owner-acquire";
const activeState: { settled: boolean; marked: boolean; queryFault: string | null } = { settled: false, marked: false, queryFault: null };
async function acquireOwner() {
  ownershipUncertain = true; owner = await ManagerLifetimeLock.acquire(root!); ownershipUncertain = false;
}
async function closeOwner() {
  ownershipUncertain = true; await owner!.release(); ownershipUncertain = false; owner = undefined;
}
try {
  await acquireOwner();
  if (mode === "scope" || mode === "rotation") {
    const queryCounts: number[] = [];
    let targets = 0;
    const scoped = new WhitelistAclScope(owner!, root!, () => {
      const current = new PrototypeAclSession(), index = ownedSessions.length;
      session = current; ownedSessions.push(current); queryCounts.push(0);
      // Exact arguments and ORIGINAL promises forwarded, no query/result substitution.
      return { get closedConfirmed() { return current.closedConfirmed; }, get healthyForRotation() { return current.healthyForRotation; },
        query: (files, deadline) => { targets += files.length; queryCounts[index] = queryCounts[index]! + 1; return current.query(files, deadline); },
        close: () => current.close() };
    });
    let aclConsistent = false, leaseBlocked = false;
    await scoped.run(async (verifier) => {
      const directory = join(root!, "protected"), file = join(directory, "fixture.json");
      await verifier.quiesce();
      await createPrivateEntry(directory, true, verifier);
      await verifier.quiesce();
      const bytes = Buffer.from("[]"); try { await writePrivateNew(file, bytes, verifier); } finally { bytes.fill(0); }
      const paths = [directory, file], baseline = await acl.verifyMany(paths);
      aclConsistent = true;
      for (let i = 0; i < (mode === "rotation" ? 33 : 1); i++) {
        const actual = await verifier.verifyMany(paths);
        if (JSON.stringify(actual) !== JSON.stringify(baseline)) { aclConsistent = false; throw new Error("prototype-scope-mismatch"); }
      }
      if (mode === "rotation") {
        await verifier.quiesce();
        const second = join(directory, "second.json"); await createPrivateEntry(second, false, verifier);
        const actual = await verifier.verify(second), expected = await acl.verify(second);
        if (actual !== expected) throw new Error("prototype-scope-mismatch");
      }
      try { await owner!.release(); }
      catch (error) { leaseBlocked = error !== null && typeof error === "object" && "code" in error && error.code === "AUTH_BUSY"; }
      if (!aclConsistent || !leaseBlocked) throw new Error("prototype-scope-mismatch");
    });
    if (!session.closedConfirmed || !ownedSessions.every((item) => item.closedConfirmed)) throw new Error("prototype-unclosed");
    await closeOwner();
    process.send!({ phase: mode, aclConsistent, leaseBlocked, closed: true, queryCounts, targets,
      actualChildren: ownedSessions.filter((item) => Number.isSafeInteger(item.pid) && Number(item.pid) > 0).length }); process.disconnect();
  } else if (mode === "guard") {
    const statistics = { queries: 0, targets: 0, sessions: 0, aclElapsedMs: 0, creates: 0, writes: 0, publishes: 0 };
    let phase = 'open';
    const queryTrace: { phase: string; targets: string[] }[] = [];
    const role = (file: string): string => {
      const parts = relative(root!, file).split(sep);
      if (parts[0] !== 'whitelist-guards') throw new Error('prototype-unexpected-acl-target');
      if (parts.length === 1) return 'namespace';
      if (!/^[a-f0-9-]{36}$/u.test(parts[1]!)) throw new Error('prototype-unexpected-acl-target');
      if (parts.length === 2) return 'guard';
      if (parts.length === 3 && ['00.bin.stage','00.bin','manifest.json.stage','manifest.json'].includes(parts[2]!)) return parts[2]!;
      throw new Error('prototype-unexpected-acl-target');
    };
    const started = performance.now();
    // Test-only injection: actual ACL queries and all inherited snapshot checks remain.
    class ScopedAcl extends WindowsPrivateAclVerifier {
      override async verify(file: string) { return (await this.verifyMany([file]))[0]!; }
      override async verifyMany(files: readonly string[]) {
        statistics.queries++; statistics.targets += files.length;
        if (session.pid === undefined) statistics.sessions++;
        const begin = performance.now();
        try {
          const targets = files.map(role);
          const result = (await session.query(files)).map((snapshot) => this.verifyNativeSnapshot(snapshot));
          if (queryTrace.length >= 32) throw new Error('prototype-acl-trace-overflow');
          queryTrace.push({ phase, targets }); return result;
        }
        finally { statistics.aclElapsedMs += performance.now() - begin; }
      }
    }
    const scoped = new ScopedAcl(), publication = {
      createDirectory: (file: string) => { statistics.creates++; return createPrivateEntry(file, true, scoped); },
      writeNew: (file: string, bytes: Buffer) => { statistics.writes++; return writePrivateNew(file, bytes, scoped); },
      publishNew: (stage: string, target: string) => { statistics.publishes++; return publishPrivateStageNew(stage, target); },
    };
    release = owner!.beginActivity(root!);
    const runtime = new SyntheticRuntime(), captured = await runtime.capture("test"), operationId = randomUUID();
    try {
      const guards = await WhitelistGuardStore.open(root!, owner!, scoped, publication);
      phase = 'create';
      const receipt = await guards.create(operationId, captured.snapshot, captured.bytes);
      const exactBytes = (await readFile(join(root!, "whitelist-guards", operationId, "00.bin"))).equals(captured.bytes);
      await session.close(); if (!session.closedConfirmed) throw new Error("prototype-unclosed");
      release(); release = undefined; await closeOwner();
      await acquireOwner(); release = owner!.beginActivity(root!);
      session = new PrototypeAclSession();
      phase = 'reopen';
      const reopened = await WhitelistGuardStore.open(root!, owner!, scoped, publication);
      phase = 'verify';
      const equalReceipt = JSON.stringify(await reopened.verify(operationId)) === JSON.stringify(receipt);
      await session.close(); if (!session.closedConfirmed) throw new Error("prototype-unclosed");
      release(); release = undefined; await closeOwner();
      process.send!({ phase: "guard", exactBytes, equalReceipt, calls: runtime.calls, closed: true,
        queryTrace, statistics: { ...statistics, aclElapsedMs: Math.floor(statistics.aclElapsedMs), elapsedMs: Math.floor(performance.now() - started) } }); process.disconnect();
    } finally { captured.bytes.fill(0); }
  } else {
  release = owner!.beginOfflineMutation(root!);
  const directory = join(root!, "protected"), file = join(directory, "fixture.json");
  stage = "fixture-directory";
  await createPrivateEntry(directory, true, acl);
  stage = "fixture-file";
  const bytes = Buffer.from("[]"); try { await writePrivateNew(file, bytes, acl); } finally { bytes.fill(0); }
  stage = "legacy-baseline";
  const paths = [directory, file], baseline = await acl.verifyMany(paths);
  if (mode === "retention" || mode === "retained-handoff") session = new PrototypeAclSession(undefined, undefined, owner!.nativeAclChildWrapper(root!));
  if (mode === "retained-parent" || mode === "retained-parent-auto") {
    const marker = join(root!, "test-active.marker"), gate = join(root!, "test-active.release");
    const wrap = owner!.nativeAclChildWrapper(root!);
    // Explicit fixture-only orphan injection skips libuv's ordinary child job.
    // It does not alter production spawn or request flags, create a Job, request
    // breakaway, or guarantee escape from an independently imposed outer Job.
    const factory = mode === "retained-parent" ? (script: string) => detachedAclFactory(script,pid => { bridgePid = pid; }) : undefined;
    session = new PrototypeAclSession(factory, undefined, (script) => {
      const needle = "  $rows=@(foreach($target in $targets) { Read-AuthPrivateAcl $target })";
      if (script.split(needle).length !== 2) throw new Error("prototype-instrumentation-shape");
      // Test-only bounded hold INSIDE a pending request, before actual ACL read.
      // Real retention bootstrap runs first; target frames/JSON/deadline are unchanged.
      const hold = `  $hold=[Diagnostics.Stopwatch]::StartNew()\n` +
        `  [IO.File]::WriteAllText(${nativePathData(marker)},'ACTIVE')\n` +
        `  while(-not [IO.File]::Exists(${nativePathData(gate)})) { if($hold.ElapsedMilliseconds -ge 12000) { throw 'TEST_HOLD_EXPIRED' }; [Threading.Thread]::Sleep(20) }\n`;
      return wrap(script.replace(needle, hold + needle));
    });
    stage = "active-query";
    void session.query(paths).then(() => { activeState.settled = true; }, (error: unknown) => {
      activeState.settled = true; activeState.queryFault = error instanceof AclSessionError ? error.reason : "unknown";
    });
    stage = "active-checkpoint";
    const markedUntil = performance.now() + 5000;
    let marked = false;
    while (!activeState.settled && performance.now() < markedUntil) {
      try { marked = (await readFile(marker, "utf8")) === "ACTIVE"; } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }
      if (marked) { activeState.marked = true; break; } await delay(10);
    }
    if (!marked || activeState.settled || activeState.queryFault || !session.pid) throw new Error("prototype-active-checkpoint-unavailable");
    process.channel?.ref(); process.send!({ phase: mode, helperPid: session.pid, pending: true, marker: true,
      detachedTest: mode === "retained-parent", ...(bridgePid === undefined ? {} : {bridgePid}) });
    await new Promise<void>(() => {});
  }
  let pid: number | undefined; const batches = mode === "normal" || mode === "retention" ? 3 : 1;
  let firstQueryMs = 0;
  stage = "normal-query";
  for (let index = 0; index < batches; index++) {
    const queryStarted = performance.now();
    const snapshots = await session.query(paths), actual = snapshots.map((snapshot) => acl.verifyNativeSnapshot(snapshot));
    if (index === 0) firstQueryMs = performance.now() - queryStarted;
    if (JSON.stringify(actual) !== JSON.stringify(baseline) || (pid !== undefined && pid !== session.pid)) throw new Error("prototype-mismatch");
    pid = session.pid;
  }
  if (!pid) throw new Error("prototype-no-owned-pid");
  if (mode === "retained-handoff") {
    // Test-only lifecycle fault: raw session idle, no production scope involved.
    // After successful original-owner release, NEVER issue another ACL query.
    stage = "owner-release"; release(); release = undefined; await closeOwner();
    const requested = new Promise<void>((resolve, reject) => {
      process.once("message", (value) => value === "close" ? resolve() : reject(new Error("prototype-control-rejected")));
    });
    process.channel?.ref(); process.send!({ phase: mode, helperPid: pid, batches, aclConsistent: true,
      idle: true, originalOwnerReleased: true });
    await requested; stage = "normal-close";
    await session.close(); if (!session.closedConfirmed) throw new Error("prototype-unclosed");
    process.send!({ phase: "handoff-closed", closed: true }); process.disconnect();
  } else if (mode === "parent") {
    // All creators finished; the exactly identified read-only helper is idle on this Node's stdin pipe.
    process.channel?.ref(); process.send!({ phase: "parent", helperPid: pid, batches, aclConsistent: true });
    await new Promise<void>(() => {});
  } else {
    stage = "normal-close";
    await session.close(); if (!session.closedConfirmed) throw new Error("prototype-unclosed");
    stage = "owner-release";
    release(); release = undefined; await closeOwner();
    if (mode === "retention") { await acquireOwner(); await closeOwner(); }
    process.send!({ phase: mode, batches, aclConsistent: true, oneProcess: true, closed: true,
      ...(mode === "retention" ? { firstQueryMs: Math.floor(firstQueryMs), ownerReacquired: true } : {}) }); process.disconnect();
  }
  }
} catch (error) {
  let drained = false;
  try { await session.close(); } catch { /* Fixed fault below; closed proof is separate. */ }
  if (session.closedConfirmed && ownedSessions.every((item) => item.closedConfirmed) && !ownershipUncertain) {
    try { release?.(); if (owner) await closeOwner(); drained = true; } catch { /* No cleanup permission. */ }
  }
  process.send!({ phase: "failed", code: error instanceof AclSessionError ? error.code : "NATIVE_PROBE_FAILED",
    reason: error instanceof AclSessionError ? error.reason : "native", stage, activeState,
    pidCreated: Number.isSafeInteger(session.pid), drained, ...session.diagnostic });
  process.exitCode = 1; process.disconnect();
}
