import { ManagerLifetimeLock } from "../../src/auth/manager-lifetime-lock.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";
import { createPrivateEntry, writePrivateNew, publishPrivateStageNew } from "../../src/auth/private-publication.js";
import { NativeTiming } from "./whitelist-native-timing.js";
import { OperationService } from "../../src/services/operation-service.js";
import { JsonOperationStore } from "../../src/services/operation-store.js";
import { WhitelistCommandStore } from "../../src/services/whitelist-command-store.js";
import { WhitelistGuardStore } from "../../src/services/whitelist-guard-store.js";
import { SyntheticWhitelistCoordinator } from "../../src/services/whitelist-synthetic-coordinator.js";
import { whitelistCommandHash, whitelistCommandRequestHash } from "../../src/services/whitelist-command-record.js";
import { parseWhitelistMemberIntent, whitelistMemberRevision } from "../../src/services/whitelist-member-policy.js";
import { SyntheticRuntime } from "../whitelist-synthetic-fixture.js";

// Test-only IPC. No raw errors, private bytes, paths or ACL snapshots leave this process.
const [root, mode, key] = process.argv.slice(2);
if (!root || !["guard", "dispatch", "read", "roundtrip"].includes(mode ?? "") || !key || !process.send) process.exit(2);
const runtime = new SyntheticRuntime();
runtime.runtimeId = "12345678-1234-4234-8234-123456789abc";
const request = parseWhitelistMemberIntent({ action: "add", name: "Player_Two", confirm: true, revision: whitelistMemberRevision(runtime.snapshot()) });
const clock = { now: () => new Date(mode === "read" ? "2030-01-01T00:00:00.000Z" : "2026-10-14T00:00:00.000Z") };
let owner: ManagerLifetimeLock | undefined;
let stage = "owner-acquire";
const started = performance.now();
let marks = 0;
const timing = new NativeTiming();
function emitObservation(row: object) {
  if (marks++ >= 32) return;
  try { if (process.connected) process.send!(row, () => undefined); }
  catch { /* Observation loss cannot alter native ACL/publication results. */ }
}
function mark(value: string) {
  stage = value;
  // Independent, bounded test IPC. Never writes to native ACL helper stdout/stderr.
  emitObservation({ phase: "stage", stage: value, elapsedMs: Math.floor(performance.now() - started) });
}
const timer = setInterval(() => {
  try { emitObservation({ phase: "timing", elapsedMs: Math.floor(performance.now() - started), ...timing.snapshot() }); }
  catch { /* Observation failure cannot affect awaited native primitives. */ }
}, 4000); timer.unref();
const observationLimit = setTimeout(() => clearInterval(timer), 50_000); observationLimit.unref();
const stopTiming = () => { clearInterval(timer); clearTimeout(observationLimit); };
class ObservedAcl extends WindowsPrivateAclVerifier {
  override verify(file: string) { return timing.invoke("acl-one", () => super.verify(file)); }
  override verifyMany(files: readonly string[]) { return timing.invoke("acl-many", () => super.verifyMany(files)); }
}
const acl = new ObservedAcl();
const publication = {
  createDirectory: (file: string) => timing.invoke("create-directory", () => createPrivateEntry(file, true, acl)),
  writeNew: (file: string, bytes: Buffer) => timing.invoke("write-new", () => writePrivateNew(file, bytes, acl)),
  publishNew: (source: string, target: string) => timing.invoke("publish-new", () => publishPrivateStageNew(source, target))
};
try {
  mark("owner-acquire");
  owner = await ManagerLifetimeLock.acquire(root!);
  mark("stores-open");
  const operations = new OperationService(new JsonOperationStore(root!), clock); await operations.initialize(); mark("operations-ready");
  // Exercise the real default GuardStore composition, not a test-injected ACL.
  const guards = await WhitelistGuardStore.open(root!, owner); mark("guard-opened");
  // Dispatch recovery must exercise the production default ACL scope. Other
  // probe modes keep the timing-injected collaborators for stage diagnostics.
  const commands = mode === "dispatch"
    ? await WhitelistCommandStore.open(root!, owner, undefined, undefined, undefined, event => mark(`command-${event}`))
    : await WhitelistCommandStore.open(root!, owner, acl, publication);
  mark("commands-opened");
  mark("stores-opened");
  if (mode === "roundtrip") {
    const captured = await runtime.capture("test"), operationId = randomUUID();
    try {
      mark("guard-create");
      const receipt = await guards.create(operationId, captured.snapshot, captured.bytes);
      mark("guard-created");
      const exactBytes = (await readFile(join(root!, "whitelist-guards", operationId, "00.bin"))).equals(captured.bytes);
      mark("owner-release"); await owner.release(); mark("owner-reacquire"); owner = await ManagerLifetimeLock.acquire(root!);
      mark("guard-reopen");
      const reopened = await WhitelistGuardStore.open(root!, owner);
      mark("guard-verify"); const equalReceipt = JSON.stringify(await reopened.verify(operationId)) === JSON.stringify(receipt);
      mark("owner-final-release");
      await owner.release(); owner = undefined;
      stopTiming();
      process.send!({ phase: "roundtrip", exactBytes, equalReceipt, calls: runtime.calls }); process.disconnect();
    } finally { captured.bytes.fill(0); }
  } else if (mode === "read") {
    mark("restart-reconcile");
    const service = new SyntheticWhitelistCoordinator(operations, commands, guards, runtime, clock, owner);
    await service.initialize(); mark("reconciled");
    const stored = (await operations.storedOutcomes())[0];
    if (!stored) throw new Error("probe-missing-operation");
    const replay = await service.submit("test", request, key!, () => undefined); mark("replayed");
    let recoveryCode = "NO_ERROR";
    try { await service.recover("test", replay.id, () => undefined); }
    catch (error) { recoveryCode = error && typeof error === "object" && "code" in error && error.code === "RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : "UNEXPECTED"; }
    const guard = await guards.verify(replay.id), chains = await commands.scan();
    service.close(); await owner.release(); owner = undefined;
    stopTiming();
    process.send!({ phase: "read", originalId: stored.id, replayId: replay.id, state: replay.state,
      recoveryRequired: operations.getServerState("test").recoveryRequired, recoveryCode,
      calls: runtime.calls, guardRevision: whitelistMemberRevision(guard.snapshot),
      states: chains[0]?.map((record) => record.state) ?? [] });
    process.disconnect();
  } else {
    process.channel?.ref(); // Controlled writer stays alive until the parent's explicit abrupt kill.
    await operations.requestBackup("test", key!, JSON.stringify(request), async (context) => {
      const captured = await runtime.capture("test");
      try {
        mark("guard-create");
        const guard = await guards.create(context.operationId, captured.snapshot, captured.bytes);
        if (mode === "dispatch") {
          mark("intent-publish");
          await commands.admit({ schemaVersion: 1, sequence: 0, previousHash: null, operationId: context.operationId, serverId: "test",
            idempotencyHash: whitelistCommandHash(key!), requestHash: whitelistCommandRequestHash("test", request), request,
            serverRootIdentity: captured.snapshot.rootIdentity, runtimeId: captured.snapshot.runtimeId, guardReceiptHash: guard.receiptHash,
            state: "intent-persisted", responseHash: null, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() });
          mark("dispatch-intent-publish"); await commands.append(context.operationId, "dispatch-intent", null, clock.now().toISOString());
        }
      } finally { captured.bytes.fill(0); }
      // All publication/ACL helpers have returned. Parent may now terminate THIS Node owner.
      stopTiming();
      process.send!({ phase: mode, operationId: context.operationId, calls: runtime.calls });
      await new Promise<void>(() => {});
    }, undefined, "whitelist-change", undefined, () => undefined, () => owner!.beginActivity(root!));
  }
} catch (error) {
  stopTiming();
  if (owner) { try { await owner.release(); } catch { /* Never delete a live fixture. */ } }
  const allowed = ["AUTH_PRIVATE_UNSAFE", "AUTH_BUSY", "WHITELIST_GUARD_UNSAFE", "WHITELIST_COMMAND_STORAGE_UNSAFE", "RECOVERY_REQUIRED"];
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && allowed.includes(error.code) ? error.code : "NATIVE_PROBE_FAILED";
  process.send!({ phase: "failed", code, stage });
  process.exitCode = 1; process.disconnect();
}
