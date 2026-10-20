import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { timingKinds } from "./fixtures/whitelist-native-timing.js";

const cleanupLimit = 5000;
const closedChildren = new WeakSet<ChildProcess>();
const checkpointChildren = new WeakSet<ChildProcess>();
const readerChildren = new WeakSet<ChildProcess>();
let priorFailure = false;
function validTiming(row: Record<string, unknown>): boolean {
  if (Object.keys(row).sort().join(",") !== "active,elapsedMs,observerFailed,overflow,phase,recent,timeMeaning,totals" ||
    row.timeMeaning !== "inclusive-not-additive" || typeof row.overflow !== "boolean" || typeof row.observerFailed !== "boolean" ||
    !Number.isSafeInteger(row.elapsedMs) || Number(row.elapsedMs) < 0 || Number(row.elapsedMs) > 86400000 ||
    !Array.isArray(row.totals) || row.totals.length !== timingKinds.length || !Array.isArray(row.active) || row.active.length > 8 ||
    !Array.isArray(row.recent) || row.recent.length > 4) return false;
  const integer = (value: unknown, max: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
  return row.totals.every((value: Record<string, unknown>, index: number) => value && typeof value === "object" &&
    Object.keys(value).sort().join(",") === "calls,completed,inclusiveMs,kind,rejected" && value.kind === timingKinds[index] &&
    [value.calls, value.completed, value.rejected].every((item) => integer(item, 256)) && integer(value.inclusiveMs, 86400000)) &&
    [...row.active, ...row.recent].every((value: Record<string, unknown>) => value && typeof value === "object" &&
      Object.keys(value).sort().join(",") === "elapsedMs,id,kind,parentId,state" && integer(value.id, 256) && Number(value.id) > 0 &&
      (value.parentId === null || (integer(value.parentId, 256) && Number(value.parentId) < Number(value.id))) &&
      timingKinds.some((kind) => kind === value.kind) && ["active", "completed", "rejected"].includes(String(value.state)) && integer(value.elapsedMs, 86400000));
}
async function boundedClose(child: ChildProcess) {
  if (closedChildren.has(child)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([once(child, "close"), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CLEANUP_BLOCKED")), cleanupLimit); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function fixture(action: (root: string, children: ChildProcess[]) => Promise<void>) {
  if (priorFailure) throw new Error("PRIOR_NATIVE_FAILURE_STOP");
  const parent = await mkdtemp(join(tmpdir(), "mcsm-whitelist-native-")), root = join(parent, "manager");
  await mkdir(root); const children: ChildProcess[] = [];
  let primary: unknown;
  try {
   try { await action(root, children); } catch (error) { primary = error; throw error; }
   finally {
    try {
    // Only exact child objects created by this fixture; no process enumeration or broad kill.
    for (const child of children) {
      if (!checkpointChildren.has(child) && !readerChildren.has(child)) { priorFailure = true; throw new Error("CLEANUP_BLOCKED"); }
      if (child.exitCode === null && child.signalCode === null) {
        // Killing before a drained checkpoint could orphan an unconfirmed native helper.
        if (!checkpointChildren.has(child)) throw new Error("CLEANUP_BLOCKED");
        child.kill();
      }
      await boundedClose(child);
      if (readerChildren.has(child) && (child.exitCode !== 0 || child.signalCode !== null)) throw new Error("CLEANUP_BLOCKED");
    }
    if (!resolve(parent).startsWith(resolve(tmpdir()) + sep) || !parent.includes("mcsm-whitelist-native-")) throw new Error("CLEANUP_BLOCKED");
    await rm(parent, { recursive: true, force: true });
    } catch (cleanup) {
      console.info("LC2_NATIVE_CLEANUP", "CLEANUP_BLOCKED");
      if (primary) throw new AggregateError([primary, cleanup], "CLEANUP_BLOCKED_WITH_PRIMARY_ERROR");
      throw cleanup;
    }
   }
  } catch (error) {
    priorFailure = true; throw error;
  }
}
function probe(root: string, mode: string, key: string, children: ChildProcess[], deadline: number) {
  if (performance.now() >= deadline) throw new Error("NATIVE_OBSERVATION_DEADLINE");
  const child = spawn(process.execPath, ["--import", "tsx", resolve("test/fixtures/whitelist-native-probe.ts"), root, mode, key],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  children.push(child);
  console.info("LC2_NATIVE_PROCESS", JSON.stringify({ mode, pid: child.pid }));
  child.once("close", () => { closedChildren.add(child); });
  const stages = new Set(["owner-acquire", "stores-open", "stores-opened", "operations-ready", "guard-opened", "commands-opened", "reconciled", "replayed", "guard-create", "guard-created", "owner-release",
    "owner-reacquire", "guard-reopen", "guard-verify", "owner-final-release", "restart-reconcile", "intent-publish", "dispatch-intent-publish",
    "command-admit-scan-complete", "command-directory-created", "command-namespace-acl-verified", "command-namespace-published",
    "command-anchor-published", "command-record-published", "command-admit-readback-complete",
    "command-namespace-stage-written", "command-namespace-stage-readback", "command-namespace-atomic-publish", "command-namespace-target-readback",
    "command-anchor-stage-written", "command-anchor-stage-readback", "command-anchor-atomic-publish", "command-anchor-target-readback",
    "command-record-stage-written", "command-record-stage-readback", "command-record-atomic-publish", "command-record-target-readback",
    "command-witness-stage-written", "command-witness-stage-readback", "command-witness-atomic-publish", "command-witness-target-readback"]);
  let observationCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listener: (value: unknown) => void;
  const terminal = new Promise<Record<string, unknown>>((done) => {
    listener = (value: unknown) => {
      if (!value || typeof value !== "object" || !("phase" in value)) return;
      const row = value as Record<string, unknown>;
      if (row.phase === "timing") {
        if (observationCount++ < 32 && validTiming(row)) console.info("LC2_NATIVE_TIMING", JSON.stringify({ mode, ...row }));
        return;
      }
      if (row.phase === "stage") {
        if (observationCount++ < 32 && Object.keys(row).sort().join(",") === "elapsedMs,phase,stage" && typeof row.stage === "string" && stages.has(row.stage) &&
          typeof row.elapsedMs === "number" && Number.isInteger(row.elapsedMs) && row.elapsedMs >= 0) console.info("LC2_NATIVE_STAGE", JSON.stringify({ mode, ...row }));
        return;
      }
      if (row.phase !== mode && row.phase !== "failed") return;
      if (row.phase === mode) {
        if (["guard", "dispatch"].includes(mode)) checkpointChildren.add(child);
        if (["read", "roundtrip"].includes(mode)) readerChildren.add(child);
      }
      done(row);
    };
    child.on("message", listener);
  });
  const message = Promise.race([terminal,
    once(child, "close").then(() => { throw new Error("NATIVE_PROBE_EARLY_CLOSE"); }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("NATIVE_OBSERVATION_DEADLINE")), Math.max(1, deadline - performance.now())); })])
    .finally(() => { if (timer) clearTimeout(timer); child.off("message", listener!); });
  const observed = message.then((value) => {
    // The owned fixture emits fixed diagnostic fields only, never native stdout/stderr.
    console.info("LC2_NATIVE_OBSERVATION", JSON.stringify({ mode, ...value })); return value;
  });
  return { child, message: observed };
}
describe.skipIf(process.platform !== "win32")("native isolated whitelist evidence", () => {
  it("publishes exact private guard bytes and verifies them after actual owner reacquisition", async () => fixture(async (root, children) => {
    const reader = probe(root, "roundtrip", randomUUID(), children, performance.now() + 50_000);
    expect(await reader.message).toMatchObject({ phase: "roundtrip", exactBytes: true, equalReceipt: true, calls: 0 });
    await boundedClose(reader.child); expect(reader.child.exitCode).toBe(0); expect(reader.child.signalCode).toBeNull();
  }), 60_000);
  it.each(["guard", "dispatch"])("retains %s checkpoint after owned process death; new process blocks recovery and never resends", async (mode) => fixture(async (root, children) => {
    const deadline = performance.now() + 50_000;
    const key = randomUUID(), writer = probe(root, mode, key, children, deadline), checkpoint = await writer.message;
    expect(checkpoint.phase).toBe(mode); expect(checkpoint.calls).toBe(0);
    expect(writer.child.kill()).toBe(true); await boundedClose(writer.child);
    const reader = probe(root, "read", key, children, deadline), result = await reader.message; await boundedClose(reader.child);
    expect(reader.child.exitCode).toBe(0); expect(reader.child.signalCode).toBeNull();
    expect(result).toMatchObject({ phase: "read", originalId: checkpoint.operationId, replayId: checkpoint.operationId,
      state: "interrupted", recoveryRequired: true, recoveryCode: "RECOVERY_REQUIRED", calls: 0,
      states: mode === "guard" ? [] : ["intent-persisted", "dispatch-intent"] });
    expect(await readdir(join(root, "whitelist-guards", String(checkpoint.operationId)))).toContain("manifest.json");
  }), 60_000);
});
