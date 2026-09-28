import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Operation } from "@mcsm/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalJavaAdapter } from "../../src/adapters/local.js";
import { AdapterRegistry } from "../../src/adapters/registry.js";
import type {
  RuntimeOperationContext,
  ValidatedLaunchPlan
} from "../../src/infra/runtime-contract.js";
import {
  LocalMinecraftRuntime,
  RuntimeError,
  type RuntimeSpawn
} from "../../src/infra/runtime/local-runtime.js";
import { encodeRconPacket } from "../../src/infra/runtime/rcon-client.js";
import { OperationService } from "../../src/services/operation-service.js";
import { MemoryOperationStore } from "../../src/services/operation-store.js";
import { ServerService } from "../../src/services/server-service.js";

const directories: string[] = [];
const children = new Set<ChildProcessWithoutNullStreams>();
const servers = new Set<net.Server>();
const sockets = new Set<net.Socket>();

async function fixtureRoot(initialLog = ""): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mcsm-runtime-"));
  directories.push(root);
  await mkdir(join(root, "logs"));
  await writeFile(join(root, "logs", "latest.log"), initialLog, "utf8");
  return root;
}

function childScript(options: { exitOnStop?: boolean; stderr?: string; exitImmediately?: boolean } = {}): string {
  const statements = [
    options.stderr ? `process.stderr.write(${JSON.stringify(options.stderr)});` : "",
    options.exitImmediately ? "setTimeout(() => process.exit(2), 10);" : "",
    options.exitOnStop
      ? "process.stdin.setEncoding('utf8');process.stdin.on('data',(value)=>{if(value.includes('stop'))process.exit(0);});"
      : "",
    "setInterval(() => {}, 1000);"
  ];
  return statements.join("");
}

function trackedSpawn(): RuntimeSpawn {
  return (executable, argv, options) => {
    const child = spawn(executable, [...argv], options);
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  };
}

function plan(rootPath: string, script: string, overrides: Partial<ValidatedLaunchPlan> = {}): ValidatedLaunchPlan {
  return {
    id: "runtime-test",
    name: "Runtime test",
    rootPath,
    javaExecutable: process.execPath,
    jarPath: join(rootPath, "server.jar"),
    argv: ["-e", script],
    statusEndpoint: { host: "127.0.0.1", port: 25_565 },
    eulaAccepted: true,
    serverInfo: {
      id: "runtime-test",
      name: "Runtime test",
      type: "vanilla",
      minecraftVersion: "test",
      java: { runtimeVersion: process.version, requiredMajor: 25 },
      detection: { confidence: "high", evidence: ["test-fixture"], warnings: [] }
    },
    getRconConnection: async () => null,
    ...overrides
  };
}

function operation(kind: "start" | "stop" = "start", steps?: string[]): RuntimeOperationContext {
  const controller = new AbortController();
  return {
    operationId: `${kind}-operation`,
    signal: controller.signal,
    onStep: async (step) => {
      steps?.push(step);
      return {
        id: `${kind}-operation`,
        serverId: "runtime-test",
        kind,
        state: "running",
        step,
        progress: null,
        createdAt: "2026-09-27T00:00:00.000Z",
        updatedAt: "2026-09-27T00:00:00.000Z",
        result: null,
        error: null
      } satisfies Operation;
    }
  };
}

async function serviceFor(runtime: LocalMinecraftRuntime, runtimePlan: ValidatedLaunchPlan): Promise<ServerService> {
  const adapter = new LocalJavaAdapter({
    plan: runtimePlan,
    revalidateBeforeStart: async () => {}
  }, runtime);
  const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date() });
  await operations.initialize();
  return new ServerService(new AdapterRegistry([adapter]), operations);
}

async function waitForChild(): Promise<ChildProcessWithoutNullStreams> {
  for (let count = 0; count < 50; count += 1) {
    const child = [...children][0];
    if (child) return child;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("test child did not spawn");
}

async function stopTestChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
}

afterEach(async () => {
  await Promise.all([...children].map(stopTestChild));
  children.clear();
  for (const socket of sockets) socket.destroy();
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("LocalMinecraftRuntime", () => {
  it("does not report startup success if the child exits during the readiness probe", async () => {
    const root = await fixtureRoot();
    let resolveProbe!: (value: "running") => void;
    let enteredProbe!: () => void;
    const probeEntered = new Promise<void>((resolve) => { enteredProbe = resolve; });
    const pendingProbe = new Promise<"running">((resolve) => { resolveProbe = resolve; });
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => { enteredProbe(); return pendingProbe; },
      startTimeoutMs: 1_000,
      readinessPollMs: 5
    });
    await runtime.initialize();
    try {
      const starting = runtime.start(operation());
      const result = starting.then(() => ({ succeeded: true }), (error: unknown) => ({ succeeded: false, error }));
      const child = await waitForChild();
      await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (new)!\n");
      await probeEntered;
      await stopTestChild(child);
      resolveProbe("running");
      expect(await result).toMatchObject({ succeeded: false, error: { code: "RUNTIME_START_FAILED" } });
    } finally {
      await runtime.closeObserver();
    }
  });

  it("does not let a stale snapshot probe overwrite a newer lifecycle transition", async () => {
    const root = await fixtureRoot();
    let resolveOldProbe!: (value: "stopped") => void;
    let enterOldProbe!: () => void;
    const oldProbeEntered = new Promise<void>((resolve) => { enterOldProbe = resolve; });
    const oldProbe = new Promise<"stopped">((resolve) => { resolveOldProbe = resolve; });
    let probeCount = 0;
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => {
        probeCount += 1;
        if (probeCount === 1) {
          enterOldProbe();
          return oldProbe;
        }
        return "running";
      },
      startTimeoutMs: 500,
      readinessPollMs: 5
    });
    await runtime.initialize();
    try {
      const staleSnapshot = runtime.snapshot();
      await oldProbeEntered;

      const starting = runtime.start(operation());
      await waitForChild();
      await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (new)!\n");
      await starting;
      resolveOldProbe("stopped");

      await expect(staleSnapshot).resolves.toMatchObject({
        status: { state: "running", ownership: "managed", recoveryRequired: false }
      });
    } finally {
      await runtime.closeObserver();
    }
  });

  it("recognizes a definitively refused status port as stopped", async () => {
    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      statusProbe: async () => "stopped"
    });
    await runtime.initialize();

    await expect(runtime.snapshot()).resolves.toMatchObject({
      status: { state: "stopped", ownership: "none", recoveryRequired: false }
    });
    await runtime.closeObserver();
  });

  it("probes status before returning the first WebSocket stream snapshot", async () => {
    const root = await fixtureRoot();
    const statusProbe = vi.fn(async () => "stopped" as const);
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), { statusProbe });
    await runtime.initialize();

    await expect(runtime.streamSnapshot()).resolves.toMatchObject({
      status: { state: "stopped", ownership: "none", recoveryRequired: false }
    });
    expect(statusProbe).toHaveBeenCalledTimes(1);
    await runtime.closeObserver();
  });

  it("requires a new Done line and protocol probe before running, then stops through owned stdin", async () => {
    const root = await fixtureRoot("[Server thread/INFO]: Done (old)! For help, type help\n");
    const steps: string[] = [];
    const runtime = new LocalMinecraftRuntime(plan(root, childScript({ exitOnStop: true })), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => [...children].some((child) => child.exitCode === null) ? "running" : "stopped",
      startTimeoutMs: 500,
      stopTimeoutMs: 500,
      readinessPollMs: 5
    });
    await runtime.initialize();
    const start = operation("start", steps);

    const starting = runtime.start(start);
    await waitForChild();
    await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (new)! For help, type help\n");
    await starting;

    expect(steps).toEqual(["spawning-process", "waiting-for-new-done-log", "running"]);
    await expect(runtime.snapshot()).resolves.toMatchObject({
      status: { state: "running", ownership: "managed", recoveryRequired: false },
      commandTransport: "stdin"
    });
    await expect(runtime.command("say hello")).resolves.toEqual({
      status: "submitted",
      transport: "stdin",
      output: null
    });
    await runtime.stop(operation("stop"));
    await expect(runtime.snapshot()).resolves.toMatchObject({ status: { state: "stopped" } });
    await runtime.closeObserver();
  });

  it("does not accept an old Done line or a successful probe by itself", async () => {
    const root = await fixtureRoot("[Server thread/INFO]: Done (old)! For help, type help\n");
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => [...children].some((child) => child.exitCode === null) ? "running" : "stopped",
      startTimeoutMs: 60,
      readinessPollMs: 5
    });
    await runtime.initialize();

    await expect(runtime.start(operation())).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
    await expect(runtime.snapshot()).resolves.toMatchObject({
      status: { state: "unknown", ownership: "managed", recoveryRequired: true }
    });
    await expect(runtime.start(operation())).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await runtime.closeObserver();
  });

  it("drains an unpolled old Done line before establishing the launch baseline", async () => {
    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => "running",
      startTimeoutMs: 60,
      readinessPollMs: 5
    });
    await runtime.initialize();
    await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (old)!\n");

    await expect(runtime.start(operation())).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
    await runtime.closeObserver();
  });

  it("drains a rotated old Done line before establishing the launch baseline", async () => {
    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => "running",
      startTimeoutMs: 60,
      readinessPollMs: 5
    });
    await runtime.initialize();
    await rename(join(root, "logs", "latest.log"), join(root, "logs", "latest.log.1"));
    await writeFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (old rotation)!\n");

    await expect(runtime.start(operation())).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
    await runtime.closeObserver();
  });

  it("does not accept a new Done line when the Minecraft status protocol probe fails", async () => {
    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => "unknown",
      startTimeoutMs: 70,
      readinessPollMs: 5
    });
    await runtime.initialize();

    const starting = runtime.start(operation());
    await waitForChild();
    await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (new)! For help\n");
    await expect(starting).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
    await expect(runtime.snapshot()).resolves.toMatchObject({
      status: { state: "unknown", recoveryRequired: true }
    });
    await runtime.closeObserver();
  });

  it("marks an unexpected owned-child exit crashed and exposes only redacted stderr", async () => {
    const secret = "child-secret-value";
    const root = await fixtureRoot();
    const runtimePlan = plan(root, childScript({
      stderr: `password=${secret}\n`,
      exitImmediately: true
    }), {
      getRconConnection: async () => ({
        host: "127.0.0.1",
        port: 25_575,
        password: secret
      })
    });
    const runtime = new LocalMinecraftRuntime(runtimePlan, {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => "unknown",
      startTimeoutMs: 300,
      readinessPollMs: 5
    });
    const states: string[] = [];
    runtime.subscribe((event) => {
      if (event.type === "status") states.push(event.status.state);
    });
    await runtime.initialize();

    await expect(runtime.start(operation())).rejects.toMatchObject({ code: "RUNTIME_START_FAILED" });
    expect(states).toContain("crashed");
    await expect(runtime.snapshot()).resolves.toMatchObject({
      status: { state: "unknown", ownership: "unknown", recoveryRequired: false }
    });
    const logs = await runtime.getLogs(undefined, 200);
    expect(logs.items.some((entry) => entry.source === "stderr")).toBe(true);
    expect(logs.items.map((entry) => entry.text).join(" ")).not.toContain(secret);
    expect(logs.items.map((entry) => entry.text).join(" ")).toContain("[REDACTED]");
    await runtime.closeObserver();
  });

  it("allows a manual service start after a crash is authoritatively confirmed stopped", async () => {
    const root = await fixtureRoot();
    const runtimePlan = plan(root, childScript());
    let spawnCount = 0;
    const spawnProcess: RuntimeSpawn = (executable, argv, options) => {
      spawnCount += 1;
      const child = spawn(
        executable,
        spawnCount === 1 ? ["-e", childScript({ exitImmediately: true })] : [...argv],
        options
      );
      children.add(child);
      child.once("exit", () => children.delete(child));
      return child;
    };
    const runtime = new LocalMinecraftRuntime(runtimePlan, {
      spawnProcess,
      statusProbe: async () => [...children].some((child) => child.exitCode === null) ? "running" : "stopped",
      startTimeoutMs: 500,
      readinessPollMs: 5
    });
    await runtime.initialize();
    const service = await serviceFor(runtime, runtimePlan);

    await expect(runtime.start(operation())).rejects.toMatchObject({ code: "RUNTIME_START_FAILED" });
    await expect(service.get(runtimePlan.id)).resolves.toMatchObject({
      status: { state: "stopped", ownership: "none", recoveryRequired: false },
      readiness: { start: { allowed: true, reason: null } }
    });
    expect(spawnCount).toBe(1);

    const created = await service.requestLifecycle(
      runtimePlan.id,
      "start",
      "123e4567-e89b-42d3-a456-426614174010"
    );
    await waitForChild();
    await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (retry)!\n");
    await vi.waitFor(() => expect(service.getOperation(created.id).state).toBe("succeeded"));
    await expect(service.get(runtimePlan.id)).resolves.toMatchObject({
      status: { state: "running", ownership: "managed", recoveryRequired: false }
    });
    expect(spawnCount).toBe(2);
    await service.close();
  });

  it.each([
    ["running", "external-process", "running", "external"],
    ["unknown", "server-state-unknown", "unknown", "unknown"]
  ] as const)(
    "blocks a manual service start after a crash when the fresh probe is %s",
    async (probeResult, reason, state, ownership) => {
      const root = await fixtureRoot();
      const runtimePlan = plan(root, childScript({ exitImmediately: true }));
      let spawnCount = 0;
      const spawnProcess: RuntimeSpawn = (executable, argv, options) => {
        spawnCount += 1;
        const child = spawn(executable, [...argv], options);
        children.add(child);
        child.once("exit", () => children.delete(child));
        return child;
      };
      const runtime = new LocalMinecraftRuntime(runtimePlan, {
        spawnProcess,
        statusProbe: async () => probeResult,
        startTimeoutMs: 300,
        readinessPollMs: 5
      });
      await runtime.initialize();
      const service = await serviceFor(runtime, runtimePlan);

      await expect(runtime.start(operation())).rejects.toMatchObject({ code: "RUNTIME_START_FAILED" });
      await expect(service.get(runtimePlan.id)).resolves.toMatchObject({
        status: { state, ownership, recoveryRequired: false },
        readiness: { start: { allowed: false, reason } }
      });
      await expect(service.requestLifecycle(
        runtimePlan.id,
        "start",
        probeResult === "running"
          ? "123e4567-e89b-42d3-a456-426614174011"
          : "123e4567-e89b-42d3-a456-426614174012"
      )).rejects.toMatchObject({ code: "ACTION_UNAVAILABLE", reason });
      expect(spawnCount).toBe(1);
      await service.close();
    }
  );

  it("marks stop timeout unknown and never force-kills the child", async () => {
    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => [...children].some((child) => child.exitCode === null) ? "running" : "stopped",
      startTimeoutMs: 300,
      stopTimeoutMs: 50,
      readinessPollMs: 5
    });
    await runtime.initialize();
    const starting = runtime.start(operation());
    const child = await waitForChild();
    await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (new)! For help\n");
    await starting;

    await expect(runtime.stop(operation("stop"))).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
    expect(child.exitCode).toBeNull();
    await expect(runtime.snapshot()).resolves.toMatchObject({
      status: { state: "unknown", ownership: "managed", recoveryRequired: true }
    });
    await stopTestChild(child);
    await expect(runtime.snapshot()).resolves.toMatchObject({
      status: { state: "stopped", ownership: "none", recoveryRequired: true }
    });
    await runtime.closeObserver();
  });

  it("accepts owned-child exit when RCON closes after dispatching stop", async () => {
    let buffered = Buffer.alloc(0);
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("data", (chunk) => {
        buffered = Buffer.concat([buffered, chunk]);
        while (buffered.length >= 4) {
          const length = buffered.readInt32LE(0);
          if (buffered.length < length + 4) return;
          const packet = buffered.subarray(4, length + 4);
          buffered = buffered.subarray(length + 4);
          const requestId = packet.readInt32LE(0);
          const type = packet.readInt32LE(4);
          if (type === 3) socket.write(encodeRconPacket(requestId, 2, ""));
          else if (type === 2) socket.write(encodeRconPacket(requestId, 0, "Stopping"));
          else {
            const child = [...children][0];
            child?.kill();
            socket.destroy();
          }
        }
      });
    });
    servers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("RCON fixture did not bind");

    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript(), {
      getRconConnection: async () => ({
        host: "127.0.0.1",
        port: address.port,
        password: "stop-secret"
      })
    }), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => [...children].some((child) => child.exitCode === null) ? "running" : "stopped",
      startTimeoutMs: 300,
      stopTimeoutMs: 500,
      probeTimeoutMs: 300,
      readinessPollMs: 5
    });
    await runtime.initialize();
    const starting = runtime.start(operation());
    await waitForChild();
    await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (new)!\n");
    await starting;

    await expect(runtime.stop(operation("stop"))).resolves.toBeUndefined();
    await expect(runtime.snapshot()).resolves.toMatchObject({ status: { state: "stopped" } });
    await runtime.closeObserver();
  });

  it("closeObserver releases observers without terminating the managed child", async () => {
    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => "running",
      startTimeoutMs: 300,
      readinessPollMs: 5
    });
    await runtime.initialize();
    const starting = runtime.start(operation());
    const child = await waitForChild();
    await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (new)! For help\n");
    await starting;

    await runtime.closeObserver();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
  });

  it("reports valid external status read-only and failed probes as unknown", async () => {
    const root = await fixtureRoot();
    const reachable = vi.fn(async () => "running" as const);
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), { statusProbe: reachable });
    await runtime.initialize();

    await expect(runtime.snapshot()).resolves.toMatchObject({
      status: { state: "running", ownership: "external", source: "status-query" },
      commandTransport: "unavailable"
    });
    await expect(runtime.command("list")).rejects.toMatchObject({ code: "ACTION_UNAVAILABLE" });
    await runtime.closeObserver();

    const unknown = new LocalMinecraftRuntime(plan(root, childScript()), {
      statusProbe: async () => "unknown"
    });
    await unknown.initialize();
    await expect(unknown.snapshot()).resolves.toMatchObject({
      status: { state: "unknown", ownership: "unknown" }
    });
    await unknown.closeObserver();
  });

  it("recovers a transient managed probe failure without clearing recovery gates", async () => {
    const root = await fixtureRoot();
    let probe: "running" | "unknown" = "running";
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      spawnProcess: trackedSpawn(),
      statusProbe: async () => probe,
      startTimeoutMs: 300,
      readinessPollMs: 5
    });
    await runtime.initialize();
    const starting = runtime.start(operation());
    await waitForChild();
    await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (new)!\n");
    await starting;

    probe = "unknown";
    await expect(runtime.snapshot()).resolves.toMatchObject({ status: { state: "unknown", recoveryRequired: false } });
    probe = "running";
    await expect(runtime.snapshot()).resolves.toMatchObject({ status: { state: "running", recoveryRequired: false } });
    await runtime.closeObserver();
  });

  it("preloads and retains a bounded history of RCON secrets before reading logs", async () => {
    const oldSecret = "bare-old-rcon-secret";
    const newSecret = "bare-new-rcon-secret";
    let secret = oldSecret;
    const root = await fixtureRoot(`message ${oldSecret}\n`);
    const runtime = new LocalMinecraftRuntime(plan(root, childScript(), {
      getRconConnection: async () => ({ host: "127.0.0.1", port: 25_575, password: secret })
    }), { statusProbe: async () => "stopped" });
    await runtime.initialize();
    secret = newSecret;
    await runtime.initialize();
    await appendFile(join(root, "logs", "latest.log"), `both ${oldSecret} ${newSecret}\n`);

    const logs = await runtime.getLogs(undefined, 20);
    const text = logs.items.map((entry) => entry.text).join(" ");
    expect(text).not.toContain(oldSecret);
    expect(text).not.toContain(newSecret);
    expect(text).toContain("[REDACTED]");
    await runtime.closeObserver();
  });

  it("rejects shell launch plans before spawning", async () => {
    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript(), {
      javaExecutable: join(root, "start.bat")
    }), { spawnProcess: trackedSpawn() });

    await expect(runtime.initialize()).rejects.toBeInstanceOf(RuntimeError);
    expect(children.size).toBe(0);
  });
});
