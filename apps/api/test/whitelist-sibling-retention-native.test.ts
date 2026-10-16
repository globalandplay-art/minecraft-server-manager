import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { SiblingRetentionFrames } from "./fixtures/whitelist-sibling-retention.js";

/** Native primitive only: controller owns both siblings. Not a product transport/deadline test. */
it.skipIf(process.platform !== "win32")("keeps a fresh owner excluded while a surviving sibling is accepted-before-inspection after original owner death", async () => {
  const started = performance.now(), workEnd = started + 50_000;
  let temp: string, parent: string, root: string;
  try {
    temp = await realpath(tmpdir()); parent = await mkdtemp(join(temp, "mcsm-sibling-retention-")); root = join(parent, "manager");
    await mkdir(root); console.info("LC2_SIBLING_CANONICAL_FIXTURE", await realpath(root));
  } catch { throw new Error("RETENTION_FIXTURE_PREPARATION_FAILED"); }
  let owner: ChildProcess | undefined, ownerClosed = false, ownerPrepared = false, ownerRow: unknown;
  let helper: ChildProcess | undefined, helperClosed = false, helperExited = false;
  let contender: ChildProcess | undefined, contenderClosed = false, contenderDrained = false, contenderResult: string | undefined;
  let primary: unknown, fault: string | undefined, cleanupEnd: number | undefined;
  const frames = new SiblingRetentionFrames();
  const setFault = (code: string) => { fault ??= code; };
  const wait = async (condition: () => boolean, end: number, code: string, checkFault = true): Promise<void> => {
    while (!condition()) {
      if (checkFault && fault) throw new Error(fault);
      if (performance.now() >= end) throw new Error(code);
      await delay(10);
    }
    if (performance.now() >= end) throw new Error(code);
    if (checkFault && fault) throw new Error(fault);
  };
  const assertWork = () => { if (performance.now() >= workEnd) throw new Error("NATIVE_OBSERVATION_DEADLINE"); };
  const helperAlive = () => {
    if (!helper?.pid || helperClosed || helperExited || helper.killed) throw new Error("RETENTION_HELPER_NOT_LIVE");
    try { process.kill(helper.pid, 0); } catch { throw new Error("RETENTION_HELPER_NOT_LIVE"); }
  };
  const compete = async (): Promise<string> => {
    assertWork(); contenderClosed = false; contenderDrained = false; contenderResult = undefined;
    contender = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/whitelist-owner-contender.ts", import.meta.url)), root],
      { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const current = contender;
    let received = false;
    current.once("close", () => { contenderClosed = true; });
    current.on("error", () => setFault("RETENTION_CONTENDER_START"));
    current.on("message", (value: unknown) => {
      if (received || !value || typeof value !== "object" || Array.isArray(value)) { setFault("RETENTION_CONTENDER_PROTOCOL"); return; }
      received = true; const row = value as Record<string, unknown>;
      if (Object.keys(row).sort().join(",") !== "drained,result" || row.drained !== true || !["BUSY", "ACQUIRED"].includes(String(row.result))) {
        setFault("RETENTION_CONTENDER_PROTOCOL"); return;
      }
      contenderDrained = true; contenderResult = String(row.result);
    });
    await wait(() => contenderClosed, workEnd, "NATIVE_OBSERVATION_DEADLINE");
    if (!received || !contenderDrained || current.exitCode !== 0 || current.signalCode !== null) throw new Error("RETENTION_CONTENDER_EXIT");
    return contenderResult!;
  };
  try {
    assertWork();
    owner = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/whitelist-sibling-owner.ts", import.meta.url)), root],
      { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    owner.once("close", () => { ownerClosed = true; }); owner.on("error", () => setFault("RETENTION_OWNER_START"));
    let received = false;
    owner.on("message", (row: unknown) => {
      if (received) { setFault("RETENTION_OWNER_PROTOCOL"); return; }
      received = true; ownerRow = row;
    });
    await wait(() => received || ownerClosed, workEnd, "NATIVE_OBSERVATION_DEADLINE");
    if (ownerClosed || !ownerRow || typeof ownerRow !== "object" || Array.isArray(ownerRow)) throw new Error("RETENTION_OWNER_PREPARATION");
    const prepared = ownerRow as Record<string, unknown>;
    if (Object.keys(prepared).sort().join(",") !== "phase,script" || prepared.phase !== "prepared" ||
      typeof prepared.script !== "string" || prepared.script.length > 11000) throw new Error("RETENTION_OWNER_PREPARATION");
    ownerPrepared = true;
    assertWork(); const bootstrapEnd = Math.min(workEnd, performance.now() + 5000);
    const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    helper = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(prepared.script, "utf16le").toString("base64")],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    // Drop the script capability from retained metadata; never include it in an assertion/log.
    prepared.script = null; ownerRow = undefined;
    helper.once("exit", () => { helperExited = true; }); helper.once("close", () => { helperClosed = true; });
    helper.on("error", () => setFault("RETENTION_HELPER_START")); helper.stdin!.on("error", () => setFault("RETENTION_HELPER_INPUT"));
    helper.stdout!.on("error", () => setFault("RETENTION_HELPER_PROTOCOL")); helper.stderr!.on("error", () => setFault("RETENTION_HELPER_STDERR"));
    helper.stdout!.on("data", (bytes: Buffer) => { frames.push(bytes); if (frames.fault) setFault("RETENTION_HELPER_PROTOCOL"); });
    helper.stderr!.on("data", () => setFault("RETENTION_HELPER_STDERR"));
    await wait(() => frames.phase === 1 || helperClosed, bootstrapEnd, "RETENTION_BOOTSTRAP_DEADLINE");
    if (frames.phase !== 1) throw new Error("RETENTION_HELPER_EARLY_CLOSE");
    helperAlive(); helper.stdin!.write("ACTIVE\n");
    await wait(() => frames.phase === 2 || helperClosed, workEnd, "NATIVE_OBSERVATION_DEADLINE");
    if (frames.phase !== 2) throw new Error("RETENTION_HELPER_EARLY_CLOSE");
    helperAlive(); assertWork();
    if (!owner.kill()) throw new Error("RETENTION_OWNER_STOP");
    await wait(() => ownerClosed, workEnd, "NATIVE_OBSERVATION_DEADLINE");
    helperAlive(); if (await compete() !== "BUSY") throw new Error("RETENTION_EXPECTED_BUSY_OBSERVED_ACQUIRED"); helperAlive();
    helper.stdin!.end("RELEASE\n");
    await wait(() => helperClosed, workEnd, "NATIVE_OBSERVATION_DEADLINE"); frames.finish();
    if (frames.fault || frames.phase !== 3 || helper.exitCode !== 0 || helper.signalCode !== null) throw new Error("RETENTION_HELPER_EXIT");
    if (await compete() !== "ACQUIRED") throw new Error("RETENTION_EXPECTED_ACQUIRED_OBSERVED_BUSY");
    console.info("LC2_SIBLING_RETENTION_RESULT", JSON.stringify({ scope: "OWNER_RETENTION_PRIMITIVE_ONLY", ownerActualClose: ownerClosed,
      helperActualClose: helperClosed, helperExitCode: helper.exitCode, helperExitSignal: helper.signalCode,
      beforeAfterAclVerified: true, pendingStage: "accepted-before-inspection", newOwnerWhilePending: "BUSY", newOwnerAfterClose: "ACQUIRED",
      elapsedMs: Math.floor(performance.now() - started) }));
  } catch (error) {
    console.info("LC2_SIBLING_RETENTION_FAILURE", JSON.stringify({ ownerActualClose: ownerClosed,
      ownerExitCode: owner?.exitCode ?? null, ownerExitSignal: owner?.signalCode ?? null, ownerPrepared,
      helperCreated: helper !== undefined, helperActualClose: helperClosed, helperExitCode: helper?.exitCode ?? null,
      helperExitSignal: helper?.signalCode ?? null, protocolPhase: frames.phase, elapsedMs: Math.floor(performance.now() - started) }));
    primary = new Error(error instanceof Error && /^(?:RETENTION_[A-Z_]+|NATIVE_OBSERVATION_DEADLINE|CLEANUP_BLOCKED)$/u.test(error.message)
      ? error.message : "RETENTION_UNEXPECTED_FAILURE");
    throw primary;
  }
  finally {
    cleanupEnd ??= performance.now() + 5000;
    // Exact owned objects only. On uncertainty retain the directory and primary failure.
    if (helper && !helperClosed) { try { helper.kill(); } catch { /* No guessed close. */ } }
    if (owner && !ownerClosed && ownerPrepared) { try { owner.kill(); } catch { /* No guessed close. */ } }
    try {
      await wait(() => (!helper || helperClosed) && (!owner || ownerClosed) && (!contender || contenderClosed), cleanupEnd, "CLEANUP_BLOCKED", false);
      if (contender && !contenderDrained) throw new Error("CLEANUP_BLOCKED");
      if (!resolve(parent).startsWith(temp + sep) || !parent.includes("mcsm-sibling-retention-")) throw new Error("CLEANUP_BLOCKED");
      if (!primary) {
        if (performance.now() >= cleanupEnd) throw new Error("CLEANUP_BLOCKED");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([rm(parent, { recursive: true, force: true }), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("CLEANUP_BLOCKED")), Math.max(1, cleanupEnd! - performance.now()));
          })]);
          if (performance.now() >= cleanupEnd) throw new Error("CLEANUP_BLOCKED");
        } finally { if (timer) clearTimeout(timer); }
      } else console.info("LC2_SIBLING_RETENTION_CLEANUP", "failed-fixture-retained");
    } catch { throw new Error(primary ? "CLEANUP_BLOCKED_WITH_PRIMARY_ERROR" : "CLEANUP_BLOCKED"); }
  }
}, 60_000);
