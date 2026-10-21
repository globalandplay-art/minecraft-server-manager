import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import type { MetricSource, Metrics, ServerStatus } from "@mcsm/contracts";

import { assertJavaEnvironment } from "../../services/trusted-lifecycle.js";
import type {
  MinecraftRuntime,
  PrivateRconConnection,
  RuntimeCommandResult,
  RuntimeFactory,
  RuntimeLogPage,
  RuntimeOperationContext,
  RuntimeSnapshot,
  RuntimeStreamReplay,
  RuntimeStreamSnapshot,
  RuntimeEvent,
  ValidatedLaunchPlan
} from "../runtime-contract.js";
import type { WhitelistRconSession } from "../runtime-contract.js";
import { validateMinecraftCommand } from "./command-validation.js";
import { RuntimeEventStream } from "./event-stream.js";
import { BoundedLogTailer } from "./log-tailer.js";
import { RconClient, RconError, assertSynchronousRconAdmission } from "./rcon-client.js";
import { createRedactor, type Redactor } from "./redactor.js";
import {
  probeMinecraftStatus,
  type MinecraftStatusProbeResult
} from "./status-probe.js";
import { DomainError } from "../../services/domain-errors.js";
import { ProcessResourceSampler, type ProcessCounterReader } from "./process-resources.js";
import { RuntimePortReservations, type RuntimePortLease } from './port-reservations.js';
import { verifyWindowsTcpPeer, type RconPeerVerifier, type LoopbackPeer } from './tcp-peer-owner.js';

const DONE_PATTERN = /\bDone \([^)]+\)!/;
const UNSAFE_EXECUTABLE = /\.(?:bat|cmd|ps1|sh)$/i;

export type RuntimeErrorCode =
  | "ACTION_UNAVAILABLE"
  | "COMMAND_TRANSPORT_UNAVAILABLE"
  | "EULA_NOT_ACCEPTED"
  | "OPERATION_CONFLICT"
  | "OPERATION_INTERRUPTED"
  | "OPERATION_TIMEOUT"
  | "RECOVERY_REQUIRED"
  | "RUNTIME_START_FAILED"
  | "UNSAFE_LAUNCH_PLAN";

const runtimeStatus: Record<RuntimeErrorCode, number> = {
  ACTION_UNAVAILABLE: 409,
  COMMAND_TRANSPORT_UNAVAILABLE: 503,
  EULA_NOT_ACCEPTED: 409,
  OPERATION_CONFLICT: 409,
  OPERATION_INTERRUPTED: 409,
  OPERATION_TIMEOUT: 504,
  RECOVERY_REQUIRED: 409,
  RUNTIME_START_FAILED: 500,
  UNSAFE_LAUNCH_PLAN: 409
};

const runtimeRecovery = new Set<RuntimeErrorCode>([
  "OPERATION_INTERRUPTED",
  "OPERATION_TIMEOUT",
  "RECOVERY_REQUIRED"
]);

export class RuntimeError extends DomainError {
  constructor(override readonly code: RuntimeErrorCode, message: string) {
    super(
      runtimeStatus[code],
      code,
      message,
      code.toLowerCase().replaceAll("_", "-"),
      runtimeRecovery.has(code)
    );
    this.name = "RuntimeError";
  }
}

export type RuntimeSpawn = (
  executable: string,
  argv: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export interface LocalRuntimeOptions {
  readonly tcpPeerVerifier?: RconPeerVerifier;
  readonly portReservations?: RuntimePortReservations;
  readonly processCounterReader?: ProcessCounterReader;
  readonly resourceMonotonicNow?: () => number;
  readonly spawnProcess?: RuntimeSpawn;
  readonly statusProbe?: (
    endpoint: ValidatedLaunchPlan["statusEndpoint"],
    timeoutMs: number,
    signal?: AbortSignal,
    verifyPeer?: (peer: LoopbackPeer) => Promise<() => undefined>
  ) => Promise<MinecraftStatusProbeResult>;
  readonly startTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly readinessPollMs?: number;
  readonly now?: () => Date;
}

const unavailable = (reason: string) => ({
  status: "unavailable" as const,
  value: null,
  source: null,
  sampledAt: null,
  reason
});

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new RuntimeError("OPERATION_INTERRUPTED", "操作已中断，运行状态需要重新确认。"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function safeSpawn(
  executable: string,
  argv: readonly string[],
  options: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams {
  return spawn(executable, [...argv], options);
}

export class LocalMinecraftRuntime implements MinecraftRuntime {
  private readonly portReservations: RuntimePortReservations;
  private portLease: RuntimePortLease | null = null;
  private readonly verifyTcpPeer: RconPeerVerifier;
  private readonly resourceSampler: ProcessResourceSampler;
  private readonly resourceNow: () => number;
  private resourceEarliest = 0;
  private resourcePending: Promise<Pick<Metrics, "cpu" | "ram">> | null = null;
  private resourceCache: { child: ChildProcessWithoutNullStreams; expires: number; metrics: Pick<Metrics, "cpu" | "ram"> } | null = null;
  private readonly spawnProcess: RuntimeSpawn;
  private readonly statusProbe: NonNullable<LocalRuntimeOptions["statusProbe"]>;
  private readonly startTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly readinessPollMs: number;
  private readonly now: () => Date;
  private readonly stream: RuntimeEventStream;
  private readonly tailer: BoundedLogTailer;
  private readonly redactor: Redactor;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly whitelistGenerations = new WeakMap<ChildProcessWithoutNullStreams, string>();
  private childOperationId: string | null = null;
  private childExit: Promise<void> | null = null;
  private rcon: RconClient | null = null;
  private rconSignature: string | null = null;
  private readonly knownRconSecrets: string[] = [];
  private startedAt: number | null = null;
  private expectedStop = false;
  private knownStopped = false;
  private closed = false;
  private status: ServerStatus;

  constructor(
    private readonly plan: ValidatedLaunchPlan,
    options: LocalRuntimeOptions = {}
  ) {
    this.portReservations = options.portReservations ?? new RuntimePortReservations();
    this.verifyTcpPeer = options.tcpPeerVerifier ?? verifyWindowsTcpPeer;
    this.spawnProcess = options.spawnProcess ?? safeSpawn;
    this.resourceNow = options.resourceMonotonicNow ?? (() => performance.now());
    this.resourceSampler = new ProcessResourceSampler(options.processCounterReader, this.resourceNow);
    this.statusProbe = options.statusProbe ?? probeMinecraftStatus;
    this.startTimeoutMs = options.startTimeoutMs ?? 120_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 60_000;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 2_000;
    this.readinessPollMs = options.readinessPollMs ?? 200;
    this.now = options.now ?? (() => new Date());
    this.status = this.makeStatus("unknown", "unknown", null, false, "status-query");
    this.stream = new RuntimeEventStream({ initialStatus: this.status });
    this.redactor = createRedactor({ secrets: () => this.knownRconSecrets });
    this.tailer = new BoundedLogTailer({
      filePath: join(plan.rootPath, "logs", "latest.log"),
      redactor: this.redactor,
      onEntry: (entry) => this.stream.publish({ type: "log", entry })
    });
  }

  async initialize(): Promise<void> {
    this.assertLaunchPlan();
    await this.readRconConnection();
    await this.tailer.start();
  }

  async snapshot(): Promise<RuntimeSnapshot> {
    this.assertOpen();
    await this.tailer.pollNow();
    if (
      this.child &&
      !this.status.recoveryRequired &&
      this.status.state !== "starting" &&
      this.status.state !== "stopping"
    ) {
      const childAtProbeStart = this.child;
      const statusAtProbeStart = this.status;
      const probe = await this.probeOwnedChild(childAtProbeStart);
      if (
        this.child === childAtProbeStart &&
        childAtProbeStart.exitCode === null &&
        this.status === statusAtProbeStart
      ) {
        if (probe === "running") this.updateStatus("running", "managed", null, false);
        else this.updateStatus("unknown", "managed", null, false, "status-query");
      }
    } else if (!this.child) {
      const statusAtProbeStart = this.status;
      const probe = await this.statusProbe(this.plan.statusEndpoint, this.probeTimeoutMs);
      if (this.child === null && this.status === statusAtProbeStart) {
        const recoveryRequired = statusAtProbeStart.recoveryRequired;
        if (probe === "running") {
          this.knownStopped = false;
          this.updateStatus("running", "external", null, recoveryRequired, "status-query");
        } else if (probe === "stopped") {
          this.knownStopped = true;
          this.updateStatus("stopped", "none", null, recoveryRequired);
        } else {
          this.updateStatus("unknown", "unknown", null, recoveryRequired, "status-query");
        }
      }
    }
    return {
      status: this.status,
      metrics: this.metrics(),
      commandTransport: await this.commandTransport()
    };
  }

  async getProcessResources(): Promise<Pick<Metrics, "cpu" | "ram">> {
    const child = this.child;
    const alive = () => !this.closed && this.child === child && child !== null &&
      child.exitCode === null && child.signalCode === null && this.status.state === "running" && this.status.ownership === "managed";
    if (!alive() || !child?.pid) {
      this.resourceSampler.reset(); return { cpu: unavailable("process-unavailable"), ram: unavailable("process-unavailable") };
    }
    if (this.resourcePending) {
      await this.resourcePending;
      return this.getProcessResources();
    }
    if (this.resourceCache?.child === child && this.resourceNow() < this.resourceCache.expires) return structuredClone(this.resourceCache.metrics);
    const task = this.resourceSampler.sample(child.pid, this.plan.javaExecutable, () => this.now().toISOString(), alive,
      { earliest: this.resourceEarliest, latest: this.startedAt ?? 0 });
    this.resourcePending = task;
    try {
      const metrics = await task;
      if (alive()) this.resourceCache = { child, expires: this.resourceNow() + 5000, metrics };
      return structuredClone(metrics);
    } finally { if (this.resourcePending === task) this.resourcePending = null; }
  }

  async start(context: RuntimeOperationContext): Promise<void> {
    this.assertOpen();
    this.assertLaunchPlan();
    if (!this.plan.eulaAccepted) {
      throw new RuntimeError("EULA_NOT_ACCEPTED", "需要先在本地接受 Minecraft EULA。" );
    }
    if (this.status.recoveryRequired) {
      throw new RuntimeError("RECOVERY_REQUIRED", "上次操作状态不确定，需要先完成恢复检查。" );
    }
    if (this.child && this.child.exitCode === null) {
      if (this.status.state === "running") return;
      throw new RuntimeError("OPERATION_CONFLICT", "服务器进程已有进行中的生命周期操作。" );
    }
    if (context.signal.aborted) {
      throw new RuntimeError("OPERATION_INTERRUPTED", "启动操作已中断。" );
    }

    // Drain the current file/rotation before observing this launch. A Done line
    // that predates this point can never satisfy the readiness gate.
    await this.tailer.pollNow();
    await context.onStep("spawning-process");
    const launchConnection = await this.readRconConnection();
    this.assertOpen();
    if (context.signal.aborted) throw new RuntimeError('OPERATION_INTERRUPTED', '启动操作已中断。');
    const lease = this.portReservations.acquire(this.plan.statusEndpoint.port, launchConnection?.port ?? null);
    this.portLease = lease;
    let childCreated = false;
    let doneSeen = false;
    const unsubscribe = this.stream.subscribe((event) => {
      if (event.type === "log" && event.entry.source === "latest.log" && DONE_PATTERN.test(event.entry.text)) {
        doneSeen = true;
      }
    });

    this.expectedStop = false;
    this.knownStopped = false;
    this.updateStatus("starting", "managed", context.operationId, false);
    let child: ChildProcessWithoutNullStreams;
    try {
      assertJavaEnvironment();
      this.resourceEarliest = this.now().getTime();
      this.resourceCache = null;
      this.resourceSampler.reset();
      child = this.spawnProcess(this.plan.javaExecutable, this.plan.argv, {
        cwd: this.plan.rootPath,
        shell: false,
        windowsHide: true,
        detached: true
      });
      childCreated = true;
      this.releasePortsOnExit(child, lease);
      this.attachChild(child);
      this.childOperationId = context.operationId;
      await this.waitForSpawn(child, context.signal);
      await context.onStep("waiting-for-new-done-log");
      await this.waitUntilReady(() => doneSeen, context.signal);
      this.startedAt = this.now().getTime();
      this.updateStatus("running", "managed", null, false);
      await context.onStep("running");
    } catch (error) {
      if (this.child && this.child.exitCode === null) {
        this.updateStatus("unknown", "managed", null, true);
      } else if (this.status.state !== "crashed") {
        this.updateStatus("crashed", "none", null, false);
      }
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("RUNTIME_START_FAILED", "Minecraft 进程启动失败。" );
    } finally {
      if (!childCreated) { lease.release(); if (this.portLease === lease) this.portLease = null; }
      unsubscribe();
    }
  }

  async stopOwnedForRecovery(context: RuntimeOperationContext, ownerOperationId: string): Promise<void> {
    this.assertOpen();
    if (this.childOperationId !== ownerOperationId) throw new RuntimeError("RECOVERY_REQUIRED", "不能停止其他事务或外部进程。");
    if (!this.child || this.child.exitCode !== null) {
      if (this.status.ownership !== "none") throw new RuntimeError("RECOVERY_REQUIRED", "无法确认该事务进程已退出。");
      this.knownStopped = true;
      this.updateStatus("stopped", "none", null, false);
      return;
    }
    // This permission is tied to the exact child launched by the restore. It is
    // never exposed as a general recovery bypass on lifecycle or HTTP APIs.
    this.updateStatus(this.status.state, "managed", context.operationId, false);
    await this.stop(context);
  }

  async stop(context: RuntimeOperationContext): Promise<void> {
    this.assertOpen();
    const child = this.child;
    if (!child || child.exitCode !== null) {
      if (this.knownStopped || this.status.state === "stopped") return;
      throw new RuntimeError("ACTION_UNAVAILABLE", "没有可由管理器安全停止的进程。" );
    }
    if (this.status.recoveryRequired) {
      throw new RuntimeError("RECOVERY_REQUIRED", "运行状态不确定，需要先完成恢复检查。" );
    }
    this.expectedStop = true;
    this.updateStatus("stopping", "managed", context.operationId, false);
    await context.onStep("sending-stop");
    const exitAtStart = this.childExit;
    const lease = this.portLease;
    try {
      const rcon = await this.readRconConnection();
      this.assertRconLaunch(child, lease, 'stopping');
      if (rcon) {
        try {
          const client = this.rconClient(rcon);
          await client.executeGuarded("stop", () => {
            this.assertRconLaunch(child, lease, 'stopping');
            if (this.rcon !== client) throw new RuntimeError('COMMAND_TRANSPORT_UNAVAILABLE', 'RCON 连接已变化。');
            return undefined;
          });
        } catch (error) {
          // Minecraft may close RCON before the barrier response while the stop
          // command is already taking effect. Process exit is the authority.
          if (child.exitCode !== null || this.child !== child) await exitAtStart;
          else if (error instanceof RconError && error.commandDispatched) {
            await this.waitForExit(context.signal);
          } else {
            throw error;
          }
        }
      } else {
        await this.writeStdin(child, "stop\n");
      }
      await context.onStep("waiting-for-process-exit");
      await this.waitForExit(context.signal);
      await context.onStep("stopped");
    } catch (error) {
      this.expectedStop = false;
      if (error instanceof RuntimeError && error.code === "OPERATION_TIMEOUT") {
        this.updateStatus("unknown", "managed", null, true);
        throw error;
      }
      if (context.signal.aborted) {
        this.updateStatus("unknown", "managed", null, true);
        throw new RuntimeError("OPERATION_INTERRUPTED", "停止操作已中断，进程状态需要重新确认。" );
      }
      this.updateStatus("unknown", "managed", null, true);
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("COMMAND_TRANSPORT_UNAVAILABLE", "无法向 Minecraft 发送安全停止命令。" );
    }
  }

  /** Dedicated single-use transport only. The local caller applies instance
   * exclusion, version/revision checks and response/file/log verification. */
  async openWhitelistSession(): Promise<WhitelistRconSession> {
    const child = this.child, launch = this.childOperationId;
    const lease = this.portLease;
    let revoked = false, busy = false, mutationSent = false;
    const assert = (dispatched = false) => {
      if (revoked || this.closed || !lease?.active || this.portLease !== lease || !child || !launch || this.child !== child || this.childOperationId !== launch ||
        child.exitCode !== null || child.signalCode !== null || this.status.state !== "running" ||
        this.status.ownership !== "managed" || this.status.recoveryRequired) {
        throw new RconError("RCON_DISCONNECTED", "Whitelist runtime generation is unavailable.", dispatched);
      }
    };
    assert();
    if (this.plan.serverInfo.type !== "vanilla" || this.plan.serverInfo.minecraftVersion !== "26.3") {
      throw new RuntimeError("ACTION_UNAVAILABLE", "白名单在线操作仅支持 Vanilla 26.3。");
    }
    const connection = await this.readRconConnection(); assert();
    if (!connection) throw new RconError("RCON_CONNECTION_FAILED", "Whitelist requires RCON.");
    const client = this.rconClient(connection);
    await client.connect(); assert();
    if (!this.whitelistGenerations.has(child!)) this.whitelistGenerations.set(child!, randomUUID());
    const execute = async (action: "list" | "add" | "remove", name?: string, authorize?: () => undefined) => {
      assert();
      if (busy || (action !== "list" && mutationSent)) throw new RuntimeError("OPERATION_CONFLICT", "白名单会话已有命令或已使用写入机会。");
      if (action !== "list" && (typeof name !== "string" || !/^[A-Za-z0-9_]{3,16}$/u.test(name))) {
        throw new RuntimeError("ACTION_UNAVAILABLE", "白名单玩家名称无效。");
      }
      busy = true;
      try {
        const current = await this.readRconConnection(); assert();
        if (!current || current.port !== connection.port || current.password !== connection.password || this.rcon !== client) {
          throw new RconError("RCON_DISCONNECTED", "Whitelist RCON binding changed.");
        }
        const output = await client.executeGuarded(action === "list" ? "whitelist list" : `whitelist ${action} ${name}`, () => {
          assert();
          if (this.rcon !== client) throw new RconError("RCON_DISCONNECTED", "Whitelist RCON binding changed.");
          if (action !== "list") {
            if (!authorize) throw new RconError("RCON_PROTOCOL_ERROR", "Whitelist admission is invalid.");
            assertSynchronousRconAdmission(authorize);
            assert();
            mutationSent = true;
          }
          return undefined;
        });
        assert(true);
        return output;
      } finally { busy = false; }
    };
    return Object.freeze({ runtimeId: this.whitelistGenerations.get(child!)!,
      list: () => execute("list"), add: (name: string, authorize: () => undefined) => execute("add", name, authorize),
      remove: (name: string, authorize: () => undefined) => execute("remove", name, authorize), close: () => { revoked = true; } });
  }

  async command(validatedLine: string): Promise<RuntimeCommandResult> {
    this.assertOpen();
    const line = validateMinecraftCommand(validatedLine);
    const child = this.child;
    if (!child || child.exitCode !== null || this.status.state !== "running") {
      throw new RuntimeError("ACTION_UNAVAILABLE", "只有管理器拥有且确认运行中的进程可以接收命令。" );
    }
    const lease = this.portLease;
    const rcon = await this.readRconConnection();
    this.assertRconLaunch(child, lease, 'running');
    if (rcon) {
      try {
        const client = this.rconClient(rcon);
        const output = await client.executeGuarded(line, () => {
          this.assertRconLaunch(child, lease, 'running');
          if (this.rcon !== client) throw new RuntimeError('COMMAND_TRANSPORT_UNAVAILABLE', 'RCON 连接已变化。');
          return undefined;
        });
        this.assertRconLaunch(child, lease, 'running');
        return { status: "executed", transport: "rcon", output };
      } catch (error) {
        if (error instanceof RconError) {
          throw new RuntimeError(
            "COMMAND_TRANSPORT_UNAVAILABLE",
            error.commandDispatched
              ? "命令可能已经发送，但执行结果无法确认；请查看控制台后再决定下一步。"
              : "无法连接 Minecraft 的安全命令通道。"
          );
        }
        throw error;
      }
    }
    await this.writeStdin(child, `${line}\n`);
    return { status: "submitted", transport: "stdin", output: null };
  }

  async getLogs(after: string | undefined, limit: number): Promise<RuntimeLogPage> {
    this.assertOpen();
    await this.tailer.pollNow();
    return this.tailer.page(after, limit);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.assertOpen();
    return this.stream.subscribe(listener);
  }

  async streamSnapshot(): Promise<RuntimeStreamSnapshot> {
    this.assertOpen();
    // A fresh runtime starts conservatively as unknown. WebSocket may be the
    // first consumer, so run the same authoritative process/status probe used
    // by REST before exposing the initial stream snapshot.
    await this.snapshot();
    return this.stream.snapshot();
  }

  async replayStream(streamId: string, afterSequence: number): Promise<RuntimeStreamReplay> {
    this.assertOpen();
    return this.stream.replay(streamId, afterSequence);
  }

  async closeObserver(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.tailer.stop();
    this.rcon?.close();
    this.rcon = null;
    this.stream.close();
    const child = this.child;
    if (child) {
      this.detachChildListener?.();
      child.stdout.destroy();
      child.stderr.destroy();
      const stdinWithUnref = child.stdin as typeof child.stdin & { unref?: () => void };
      stdinWithUnref.unref?.();
      child.unref();
    }
  }

  private detachChildListener: (() => void) | null = null;

  private releasePortsOnExit(child: ChildProcessWithoutNullStreams, lease: RuntimePortLease): void {
    const release = () => {
      child.off('exit', release); child.off('error', failedSpawn);
      lease.release();
      if (this.portLease === lease) this.portLease = null;
    };
    const failedSpawn = () => { if (child.pid === undefined) release(); };
    // This listener survives closeObserver: detaching UI observers cannot free
    // ports while the owned process is still alive or its exit is uncertain.
    child.once('exit', release); child.on('error', failedSpawn);
  }

  private assertRconLaunch(child: ChildProcessWithoutNullStreams, lease: RuntimePortLease | null, state: 'running' | 'stopping'): void {
    if (this.closed || this.child !== child || child.exitCode !== null || child.signalCode !== null ||
      !lease?.active || this.portLease !== lease || this.status.ownership !== 'managed' ||
      this.status.recoveryRequired || this.status.state !== state) {
      throw new RuntimeError('COMMAND_TRANSPORT_UNAVAILABLE', '目标实例运行代际或命令通道已变化。');
    }
  }

  private attachChild(child: ChildProcessWithoutNullStreams): void {
    this.child = child;
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => this.tailer.appendStderr(chunk));
    let handled = false;
    let resolveExit = () => {};
    this.childExit = new Promise<void>((resolve) => { resolveExit = resolve; });
    const finish = () => {
      if (handled) return;
      handled = true;
      this.tailer.flushStderr();
      this.rcon?.close();
      this.rcon = null;
      this.child = null;
      this.startedAt = null;
      if (this.expectedStop) {
        this.knownStopped = true;
        this.updateStatus("stopped", "none", null, false);
      } else {
        this.knownStopped = false;
        this.updateStatus("crashed", "none", null, this.status.recoveryRequired);
      }
      this.expectedStop = false;
      resolveExit();
    };
    child.once("exit", finish);
    child.once("error", finish);
    this.detachChildListener = () => {
      child.off("exit", finish);
      child.off("error", finish);
    };
  }

  private async waitForSpawn(child: ChildProcessWithoutNullStreams, signal: AbortSignal): Promise<void> {
    if (child.pid) return;
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new RuntimeError("RUNTIME_START_FAILED", "Minecraft 进程启动失败。")); };
      const onAbort = () => { cleanup(); reject(new RuntimeError("OPERATION_INTERRUPTED", "启动操作已中断。")); };
      const cleanup = () => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
        signal.removeEventListener("abort", onAbort);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async waitUntilReady(doneSeen: () => boolean, signal: AbortSignal): Promise<void> {
    const deadline = this.now().getTime() + this.startTimeoutMs;
    while (this.now().getTime() < deadline) {
      if (!this.child || this.child.exitCode !== null) {
        throw new RuntimeError("RUNTIME_START_FAILED", "Minecraft 在完成启动前退出。" );
      }
      if (doneSeen()) {
        const childAtProbeStart = this.child;
        const probe = await this.probeOwnedChild(childAtProbeStart, signal);
        if (
          this.child !== childAtProbeStart ||
          childAtProbeStart === null ||
          childAtProbeStart.exitCode !== null
        ) {
          throw new RuntimeError("RUNTIME_START_FAILED", "Minecraft 在完成启动前退出。" );
        }
        if (probe === "running") return;
      }
      await this.tailer.pollNow();
      await delay(this.readinessPollMs, signal);
    }
    throw new RuntimeError("OPERATION_TIMEOUT", "Minecraft 启动超时，进程状态需要人工确认。" );
  }

  private probeOwnedChild(child: ChildProcessWithoutNullStreams, signal?: AbortSignal): Promise<MinecraftStatusProbeResult> {
    const lease = this.portLease, pid = child.pid;
    const assert = () => {
      if (this.closed || this.child !== child || !pid || child.pid !== pid || child.exitCode !== null || child.signalCode !== null ||
        !lease?.active || this.portLease !== lease || this.status.recoveryRequired) throw new Error('status-peer-unverified');
      return undefined;
    };
    return this.statusProbe(this.plan.statusEndpoint, this.probeTimeoutMs, signal, async peer => {
      assert(); await this.verifyTcpPeer(peer, pid!); assert(); return assert;
    }).then(result => {
      if (result === 'running') { try { assert(); } catch { return 'unknown'; } }
      return result;
    });
  }

  private async waitForExit(signal: AbortSignal): Promise<void> {
    const exit = this.childExit;
    if (!exit) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new RuntimeError("OPERATION_TIMEOUT", "Minecraft 停止超时，未执行强制终止。" ));
      }, this.stopTimeoutMs);
      const onAbort = () => {
        cleanup();
        reject(new RuntimeError("OPERATION_INTERRUPTED", "停止操作已中断，进程状态需要重新确认。" ));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void exit.then(() => { cleanup(); resolve(); });
    });
  }

  private async writeStdin(child: ChildProcessWithoutNullStreams, value: string): Promise<void> {
    if (!child.stdin.writable) {
      throw new RuntimeError("COMMAND_TRANSPORT_UNAVAILABLE", "Minecraft stdin 不可用。" );
    }
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(value, "utf8", (error) => {
        if (error) reject(new RuntimeError("COMMAND_TRANSPORT_UNAVAILABLE", "Minecraft stdin 写入失败。" ));
        else resolve();
      });
    });
  }

  private async commandTransport(): Promise<RuntimeSnapshot["commandTransport"]> {
    const child = this.child;
    if (!child || child.exitCode !== null || this.status.state !== "running") return "unavailable";
    try {
      const lease = this.portLease;
      const rcon = await this.readRconConnection();
      this.assertRconLaunch(child, lease, 'running');
      if (rcon) {
        await this.rconClient(rcon).connect();
        this.assertRconLaunch(child, lease, 'running');
        return "rcon";
      }
    } catch {
      return "unavailable";
    }
    return child.stdin.writable ? "stdin" : "unavailable";
  }

  private async readRconConnection(): Promise<PrivateRconConnection | null> {
    const lease = this.portLease;
    try {
      const connection = await this.plan.getRconConnection();
      if (lease && (!lease.active || this.portLease !== lease || (connection?.port ?? null) !== lease.rconPort)) {
        throw new RuntimeError('COMMAND_TRANSPORT_UNAVAILABLE', 'RCON 配置在启动后发生变化，请停服并重新加载实例。');
      }
      if (connection?.password && !this.knownRconSecrets.includes(connection.password)) {
        this.knownRconSecrets.push(connection.password);
        if (this.knownRconSecrets.length > 8) this.knownRconSecrets.shift();
      }
      return connection;
    } catch {
      throw new RuntimeError("COMMAND_TRANSPORT_UNAVAILABLE", "RCON 配置暂时不可用。" );
    }
  }

  private rconClient(connection: PrivateRconConnection): RconClient {
    const signature = `${connection.host}:${connection.port}:${connection.password}`;
    if (!this.rcon || this.rconSignature !== signature) {
      const child = this.child, lease = this.portLease;
      const guard = () => {
        if (!child?.pid) throw new RuntimeError('COMMAND_TRANSPORT_UNAVAILABLE', '无法验证命令通道进程。');
        this.assertRconLaunch(child, lease, this.status.state === 'stopping' ? 'stopping' : 'running');
        return undefined;
      };
      guard();
      this.rcon?.close();
      this.rconSignature = signature;
      this.rcon = new RconClient({
        host: connection.host,
        port: connection.port,
        getPassword: async () => connection.password,
        verifyPeer: async peer => { guard(); await this.verifyTcpPeer(peer, child!.pid!); guard(); return guard; },
        timeoutMs: this.probeTimeoutMs,
        redactor: this.redactor
      });
    }
    return this.rcon;
  }

  private metrics(): Metrics {
    const sampledAt = this.now().toISOString();
    const uptime = this.startedAt !== null && this.child && this.status.state === "running"
      ? {
          status: "available" as const,
          value: Math.max(0, Math.floor((this.now().getTime() - this.startedAt) / 1_000)),
          source: "process" as MetricSource,
          sampledAt
        }
      : unavailable("process-unavailable");
    return {
      players: unavailable("not-collected"),
      tps: unavailable("not-collected"),
      mspt: unavailable("not-collected"),
      cpu: unavailable("not-collected"),
      ram: unavailable("not-collected"),
      disk: unavailable("not-collected"),
      uptime
    };
  }

  private makeStatus(
    state: ServerStatus["state"],
    ownership: ServerStatus["ownership"],
    operationId: string | null,
    recoveryRequired: boolean,
    source: ServerStatus["source"] = "process"
  ): ServerStatus {
    return {
      state,
      ownership,
      source,
      observedAt: this.now().toISOString(),
      activeOperationId: operationId,
      recoveryRequired
    };
  }

  private updateStatus(
    state: ServerStatus["state"],
    ownership: ServerStatus["ownership"],
    operationId: string | null,
    recoveryRequired: boolean,
    source: ServerStatus["source"] = "process"
  ): void {
    const previous = this.status;
    if (
      previous.state === state &&
      previous.ownership === ownership &&
      previous.activeOperationId === operationId &&
      previous.recoveryRequired === recoveryRequired &&
      previous.source === source
    ) return;
    this.status = this.makeStatus(state, ownership, operationId, recoveryRequired, source);
    this.stream.publish({ type: "status", status: this.status });
  }

  private assertOpen(): void {
    if (this.closed) throw new RuntimeError("ACTION_UNAVAILABLE", "运行时观察器已关闭。" );
  }

  private assertLaunchPlan(): void {
    if (UNSAFE_EXECUTABLE.test(this.plan.javaExecutable) || this.plan.argv.some((argument) => argument.includes("\0"))) {
      throw new RuntimeError("UNSAFE_LAUNCH_PLAN", "启动计划包含不安全的可执行文件或参数。" );
    }
  }
}

export class LocalRuntimeFactory implements RuntimeFactory {
  private readonly options: LocalRuntimeOptions;
  constructor(options: LocalRuntimeOptions = {}) {
    this.options = { ...options, portReservations: options.portReservations ?? new RuntimePortReservations() };
  }

  async create(plan: ValidatedLaunchPlan): Promise<MinecraftRuntime> {
    const runtime = new LocalMinecraftRuntime(plan, this.options);
    try { await runtime.initialize(); }
    catch (error) { await runtime.closeObserver(); throw error; }
    return runtime;
  }
}
