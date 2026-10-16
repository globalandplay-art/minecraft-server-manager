import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

let stopped = false;
let inFlight = false;
async function absent(pid: number, deadline: number): Promise<void> {
  while (performance.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
      throw new Error("CLEANUP_BLOCKED");
    }
    await delay(20);
  }
  throw new Error("CLEANUP_BLOCKED");
}
async function nativeCase(mode: "normal" | "parent" | "guard" | "scope" | "rotation" | "retention" | "retained-parent" | "retained-parent-auto" | "retained-handoff") {
  if (stopped || inFlight) throw new Error("PRIOR_NATIVE_FAILURE_STOP");
  inFlight = true;
  const parent = await mkdtemp(join(tmpdir(), "mcsm-acl-prototype-")), root = join(parent, "manager"); await mkdir(root);
  let child: ChildProcess | undefined, closed = false, drained = false, readyToKill = false, helperPid: number | undefined, primary: unknown;
  let cleanupEnd: number | undefined;
  const workEnd = performance.now() + 50_000;
  let contender: ChildProcess | undefined, contenderClosed = false, contenderDrained = false;
  let readyToClose = false, closeRequest: Promise<void> | undefined;
  const requestClose = (): Promise<void> => closeRequest ??= new Promise<void>((resolve, reject) => {
    child!.send("close", (error) => error ? reject(new Error("CLEANUP_BLOCKED")) : resolve());
  });
  const withinWork = async <T>(action: () => Promise<T>): Promise<T> => {
    const remaining = workEnd - performance.now();
    if (remaining <= 0) throw new Error("NATIVE_OBSERVATION_DEADLINE");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([action(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("NATIVE_OBSERVATION_DEADLINE")), remaining); })]);
      if (performance.now() >= workEnd) throw new Error("NATIVE_OBSERVATION_DEADLINE");
      return result;
    }
    finally { if (timer) clearTimeout(timer); }
  };
  const compete = async (): Promise<string> => {
    if (performance.now() >= workEnd) throw new Error("NATIVE_OBSERVATION_DEADLINE");
    contenderClosed = false; contenderDrained = false;
    contender = spawn(process.execPath, ["--import", "tsx", resolve("test/fixtures/whitelist-owner-contender.ts"), root],
      { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    contender.once("close", () => { contenderClosed = true; });
    const current = contender;
    const row = await withinWork(() => Promise.race([
      once(current, "message").then(([value]) => value as Record<string, unknown>),
      once(current, "close").then(() => { throw new Error("NATIVE_CONTENDER_EARLY_CLOSE"); })
    ]));
    if (row.drained === true && ["ACQUIRED", "BUSY"].includes(String(row.result))) contenderDrained = true;
    if (!contenderClosed) await withinWork(() => once(current, "close"));
    expect(current.exitCode).toBe(0); expect(current.signalCode).toBeNull();
    if (!contenderDrained) throw new Error("CLEANUP_BLOCKED");
    return String(row.result);
  };
  const cleanupDeadline = () => cleanupEnd ??= performance.now() + 5000;
  const cleanup = async <T>(action: () => Promise<T>): Promise<T> => {
    const remaining = cleanupDeadline() - performance.now();
    if (remaining <= 0) throw new Error("CLEANUP_BLOCKED");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([action(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CLEANUP_BLOCKED")), remaining); })]);
      if (performance.now() >= cleanupDeadline()) throw new Error("CLEANUP_BLOCKED");
      return result;
    }
    finally { if (timer) clearTimeout(timer); }
  };
  const waitClosed = async () => {
    if (closed) return;
    await cleanup(() => once(child!, "close"));
  };
  try {
    try {
      const started = performance.now();
      if (started >= workEnd) throw new Error("NATIVE_OBSERVATION_DEADLINE");
      child = spawn(process.execPath, ["--import", "tsx", resolve("test/fixtures/whitelist-acl-session-probe.ts"), root, mode],
        { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
      child.once("close", () => { closed = true; });
      console.info("LC2_ACL_PROTOTYPE_PROCESS", JSON.stringify({ mode, pid: child.pid }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      let row: Record<string, unknown>;
      try { row = await Promise.race([once(child, "message").then(([value]) => value as Record<string, unknown>),
        once(child, "close").then(() => { throw new Error("NATIVE_PROBE_EARLY_CLOSE"); }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("NATIVE_OBSERVATION_DEADLINE")), Math.max(1, workEnd - performance.now())); })]); }
      finally { if (timer) clearTimeout(timer); }
      if (performance.now() >= workEnd) throw new Error("NATIVE_OBSERVATION_DEADLINE");
      console.info("LC2_ACL_PROTOTYPE_RESULT", JSON.stringify({ mode, elapsedMs: Math.floor(performance.now() - started), ...row }));
      // A failed ACK never changes FAIL into PASS. Confirm actual Node close before
      // adopting its successful owned-resource drain; retain the failed fixture.
      if (row.phase === "failed" && row.drained === true) { await waitClosed(); drained = closed; }
      expect(row.phase).toBe(mode);
      if (mode === "retained-handoff") {
        expect(row).toMatchObject({ batches: 1, aclConsistent: true, idle: true, originalOwnerReleased: true });
        expect(Number.isSafeInteger(row.helperPid)).toBe(true); expect(Number(row.helperPid)).toBeGreaterThan(0);
        helperPid = Number(row.helperPid); readyToClose = true;
        expect(closed).toBe(false); process.kill(helperPid, 0);
        expect(await compete()).toBe("BUSY"); process.kill(helperPid, 0); expect(closed).toBe(false);
        const ack = once(child, "message").then(([value]) => value as Record<string, unknown>);
        await withinWork(requestClose);
        const terminal = await withinWork(() => Promise.race([ack,
          once(child!, "close").then(() => { throw new Error("NATIVE_PROBE_EARLY_CLOSE"); })]));
        expect(terminal).toMatchObject({ phase: "handoff-closed", closed: true });
        if (!closed) await withinWork(() => once(child!, "close"));
        expect(child.exitCode).toBe(0); expect(child.signalCode).toBeNull();
        await withinWork(() => absent(helperPid!, Math.min(workEnd, performance.now() + 5000))); drained = true;
        expect(await compete()).toBe("ACQUIRED");
        console.info("LC2_ACL_OWNER_HANDOFF", "actual-owner-released-helper-held-exclusion-until-close");
      } else if (mode === "retained-parent" || mode === "retained-parent-auto") {
        expect(row).toMatchObject({ pending: true, marker: true, detachedTest: mode === "retained-parent" });
        expect(Number.isSafeInteger(row.helperPid)).toBe(true); expect(Number(row.helperPid)).toBeGreaterThan(0);
        helperPid = Number(row.helperPid); readyToKill = true;
        expect(child.kill()).toBe(true);
        if (!closed) await withinWork(() => once(child!, "close"));
        if (mode === "retained-parent") {
          // Both sides of the BUSY observation require an actually surviving helper.
          // If an outer Job kills it anyway this strict injection test fails, no fallback.
          process.kill(helperPid, 0); // Existence only, never terminate a helper PID.
          expect(await compete()).toBe("BUSY");
          process.kill(helperPid, 0);
          await withinWork(() => writeFile(join(root, "test-active.release"), "RELEASE", { flag: "wx" }));
        }
        // Default spawn must disappear BEFORE any contender acquisition starts.
        await withinWork(() => absent(helperPid!, Math.min(workEnd, performance.now() + 5000))); drained = true;
        expect(await compete()).toBe("ACQUIRED");
        console.info("LC2_ACL_RETAINED_PARENT", mode === "retained-parent" ? "new-owner-busy-until-owned-helper-exit" : "default-child-absent-before-new-owner");
      } else if (mode !== "parent") {
        drained = row.closed === true;
        if (mode === "normal") expect(row).toMatchObject({ batches: 3, oneProcess: true, aclConsistent: true, closed: true });
        else if (mode === "retention") {
          expect(row).toMatchObject({ batches: 3, oneProcess: true, aclConsistent: true, closed: true, ownerReacquired: true });
          expect(typeof row.firstQueryMs).toBe("number"); expect(Number(row.firstQueryMs)).toBeGreaterThanOrEqual(0);
          expect(Number(row.firstQueryMs)).toBeLessThan(5000);
        }
        else if (mode === "scope") expect(row).toMatchObject({ aclConsistent: true, leaseBlocked: true, closed: true });
        else if (mode === "rotation") {
          expect(row).toMatchObject({ aclConsistent: true, leaseBlocked: true, closed: true, targets: 68 });
          expect(Array.isArray(row.queryCounts)).toBe(true);
          const counts = row.queryCounts as unknown[];
          expect(counts.every((count) => Number.isSafeInteger(count) && Number(count) > 0 && Number(count) <= 32)).toBe(true);
          expect(counts.reduce<number>((sum, count) => sum + Number(count), 0)).toBe(35);
          expect(counts.length).toBeGreaterThanOrEqual(3); expect(counts.length).toBeLessThanOrEqual(35);
          expect(row.actualChildren).toBe(counts.length);
        }
        else expect(row).toMatchObject({ exactBytes: true, equalReceipt: true, calls: 0, closed: true,
          statistics: { queries: 23, targets: 63, sessions: 2, creates: 2, writes: 2, publishes: 2 } });
        await waitClosed(); expect(child.exitCode).toBe(0); expect(child.signalCode).toBeNull();
      } else {
        expect(row.aclConsistent).toBe(true);
        expect(Number.isSafeInteger(row.helperPid)).toBe(true); expect(Number(row.helperPid)).toBeGreaterThan(0);
        helperPid = Number(row.helperPid); readyToKill = true;
        expect(child.kill()).toBe(true); await waitClosed(); await absent(helperPid, cleanupDeadline()); drained = true;
        console.info("LC2_ACL_PROTOTYPE_PARENT_EXIT", "owned-helper-absent");
      }
    } catch (error) { stopped = true; primary = error; throw error; }
    finally {
      try {
        if (child) {
          if (!closed && readyToClose) { await cleanup(requestClose); await waitClosed(); }
          if (!closed && readyToKill) { child.kill(); await waitClosed(); }
          if (mode === "retained-parent" && readyToKill && closed && !drained) {
            // Release only our deterministic test hold, never force a directory deletion.
            await cleanup(async () => {
              try { await writeFile(join(root, "test-active.release"), "RELEASE", { flag: "wx" }); }
              catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
            });
          }
          if (helperPid && !drained && closed) { await absent(helperPid, cleanupDeadline()); drained = true; }
          if (!closed || !drained) throw new Error("CLEANUP_BLOCKED");
        }
        if (contender && (!contenderClosed || !contenderDrained)) throw new Error("CLEANUP_BLOCKED");
        if (!resolve(parent).startsWith(resolve(tmpdir()) + sep) || !parent.includes("mcsm-acl-prototype-")) throw new Error("CLEANUP_BLOCKED");
        if (!primary) await cleanup(() => rm(parent, { recursive: true, force: true }));
        else console.info("LC2_ACL_PROTOTYPE_CLEANUP", "failed-fixture-retained");
      } catch (cleanup) { stopped = true; if (primary) throw new AggregateError([primary, cleanup], "CLEANUP_BLOCKED_WITH_PRIMARY_ERROR"); throw cleanup; }
    }
  } catch (error) { stopped = true; throw error; }
  finally { inFlight = false; }
}
describe.skipIf(process.platform !== "win32")("isolated native ACL session prototype", () => {
  it("matches actual legacy ACL fingerprints for three batches through one owned session and closes normally", () => nativeCase("normal"), 60_000);
  it("exits its idle owned read-only helper after controlled parent death without killing another process", () => nativeCase("parent"), 60_000);
  it("roundtrips actual private guard bytes with scoped queries and actual owner reacquisition", () => nativeCase("guard"), 60_000);
  it("closes a real scope child before releasing native mutation ownership", () => nativeCase("scope"), 60_000);
  it("rotates healthy native children with real batches and quiesces before publication", () => nativeCase("rotation"), 60_000);
  it("retains verified owner duplicates through normal actual child exit", () => nativeCase("retention"), 60_000);
  it("keeps a fresh Manager blocked during an owned active helper after parent death", () => nativeCase("retained-parent"), 60_000);
  it("confirms the default active helper exits before fresh Manager acquisition after parent death", () => nativeCase("retained-parent-auto"), 60_000);
  it("retains exclusive root ownership in an idle helper after original owner release", () => nativeCase("retained-handoff"), 60_000);
});
