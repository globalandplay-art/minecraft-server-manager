import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { join } from "node:path";

import type { MetricSource, Metrics, ServerStatus } from "@mcsm/contracts";

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
import { validateMinecraftCommand } from "./command-validation.js";
import { RuntimeEventStream } from "./event-stream.js";
import { BoundedLogTailer } from "./log-tailer.js";
import { RconClient, RconError } from "./rcon-client.js";
import { createRedactor, type Redactor } from "./redactor.js";
import {
  probeMinecraftStatus,
  type MinecraftStatusProbeResult
} from "./status-probe.js";
import { DomainError } from "../../services/domain-errors.js";

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
  readonly spawnProcess?: RuntimeSpawn;
  readonly statusProbe?: (
    endpoint: ValidatedLaunchPlan["statusEndpoint"],
    timeoutMs: number,
    signal?: AbortSignal
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
    this.spawnProcess = options.spawnProcess ?? safeSpawn;
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
      const probe = await this.statusProbe(this.plan.statusEndpoint, this.probeTimeoutMs);
      if (
        this.child === childAtProbeStart &&
        childAtProbeStart.exitCode === null &&
        this.status === statusAtProbeStart
      ) {
        if (probe === "running") this.updateStatus("running", "managed", null, false);
        else this.updateStatus("unknown", "managed", null, false, "status-query");
      }
    } else if (!this.child && this.status.state !== "crashed") {
      const statusAtProbeStart = this.status;
      const probe = await this.statusProbe(this.plan.statusEndpoint, this.probeTimeoutMs);
      if (this.child === null && this.status === statusAtProbeStart) {
        if (probe === "running") {
          this.knownStopped = false;
          this.updateStatus("running", "external", null, false, "status-query");
        } else if (probe === "stopped") {
          this.knownStopped = true;
          this.updateStatus("stopped", "none", null, false);
        } else {
          this.updateStatus("unknown", "unknown", null, this.status.recoveryRequired, "status-query");
        }
      }
    }
    return {
      status: this.status,
      metrics: this.metrics(),
      commandTransport: await this.commandTransport()
    };
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
      child = this.spawnProcess(this.plan.javaExecutable, this.plan.argv, {
        cwd: this.plan.rootPath,
        shell: false,
        windowsHide: true,
        detached: true
      });
      this.attachChild(child);
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
      unsubscribe();
    }
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
    try {
      const rcon = await this.readRconConnection();
      if (rcon) {
        try {
          await this.rconClient(rcon).execute("stop");
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

  async command(validatedLine: string): Promise<RuntimeCommandResult> {
    this.assertOpen();
    const line = validateMinecraftCommand(validatedLine);
    const child = this.child;
    if (!child || child.exitCode !== null || this.status.state !== "running") {
      throw new RuntimeError("ACTION_UNAVAILABLE", "只有管理器拥有且确认运行中的进程可以接收命令。" );
    }
    const rcon = await this.readRconConnection();
    if (rcon) {
      try {
        const output = await this.rconClient(rcon).execute(line);
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
        this.updateStatus("crashed", "none", null, false);
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
        const probe = await this.statusProbe(this.plan.statusEndpoint, this.probeTimeoutMs, signal);
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
      const rcon = await this.readRconConnection();
      if (rcon) {
        await this.rconClient(rcon).connect();
        return "rcon";
      }
    } catch {
      return "unavailable";
    }
    return child.stdin.writable ? "stdin" : "unavailable";
  }

  private async readRconConnection(): Promise<PrivateRconConnection | null> {
    try {
      const connection = await this.plan.getRconConnection();
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
      this.rcon?.close();
      this.rconSignature = signature;
      this.rcon = new RconClient({
        host: connection.host,
        port: connection.port,
        getPassword: async () => connection.password,
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
  constructor(private readonly options: LocalRuntimeOptions = {}) {}

  async create(plan: ValidatedLaunchPlan): Promise<MinecraftRuntime> {
    const runtime = new LocalMinecraftRuntime(plan, this.options);
    await runtime.initialize();
    return runtime;
  }
}
