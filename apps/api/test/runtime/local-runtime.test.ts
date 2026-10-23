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
  LocalRuntimeFactory,
  RuntimeError,
  type RuntimeSpawn
} from "../../src/infra/runtime/local-runtime.js";
import { encodeRconPacket, RconClient } from "../../src/infra/runtime/rcon-client.js";
import { RuntimePortReservations } from '../../src/infra/runtime/port-reservations.js';
import { minecraftStatusProtocol } from '../../src/infra/runtime/status-probe.js';
import { OperationService } from "../../src/services/operation-service.js";
import { MemoryOperationStore } from "../../src/services/operation-store.js";
import type { ProcessCounters } from "../../src/infra/runtime/process-resources.js";
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
  vi.restoreAllMocks();
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
  async function ready(runtime: Awaited<ReturnType<LocalRuntimeFactory['create']>>, root: string) {
    const before = new Set(children), starting = runtime.start(operation());
    await vi.waitFor(() => expect([...children].some(child => !before.has(child))).toBe(true));
    await appendFile(join(root, 'logs/latest.log'), '[Server thread/INFO]: Done (new child)!\n');
    await starting;
    return [...children].find(child => !before.has(child))!;
  }

  it('shares factory game-port reservations until owned child exit, then permits the next instance', async () => {
    const firstRoot = await fixtureRoot(), secondRoot = await fixtureRoot();
    const factory = new LocalRuntimeFactory({ spawnProcess: trackedSpawn(), statusProbe: async () => 'running', readinessPollMs: 5 });
    const first = await factory.create(plan(firstRoot, childScript({ exitOnStop: true }), { id: 'first' }));
    const second = await factory.create(plan(secondRoot, childScript({ exitOnStop: true }), { id: 'second' }));
    try {
      const child = await ready(first, firstRoot);
      await expect(second.start(operation())).rejects.toMatchObject({ code: 'INSTANCE_PORT_CONFLICT' });
      expect([...children]).toEqual([child]);
      expect((await first.snapshot()).status.state).toBe('running');
      await first.stop(operation('stop')); await ready(second, secondRoot);
      await second.stop(operation('stop'));
    } finally { await first.closeObserver(); await second.closeObserver(); }
  });

  it('does not free ports when readiness times out or the observer closes with a live child', async () => {
    const root = await fixtureRoot(), ports = new RuntimePortReservations();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      portReservations: ports, spawnProcess: trackedSpawn(), statusProbe: async () => 'running', startTimeoutMs: 60, readinessPollMs: 5
    });
    await runtime.initialize();
    await expect(runtime.start(operation())).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    const child = await waitForChild(); await runtime.closeObserver();
    expect(() => ports.acquire(25565, null)).toThrow();
    await stopTestChild(child); expect(ports.acquire(25565, null).active).toBe(true);
  });

  it('permits distinct ports concurrently and stopping one child leaves the other running', async () => {
    const firstRoot = await fixtureRoot(), secondRoot = await fixtureRoot();
    const factory = new LocalRuntimeFactory({ spawnProcess: trackedSpawn(), statusProbe: async () => 'running', readinessPollMs: 5 });
    const first = await factory.create(plan(firstRoot, childScript({ exitOnStop: true }), { id: 'first' }));
    const second = await factory.create(plan(secondRoot, childScript({ exitOnStop: true }), {
      id: 'second', statusEndpoint: { host: '127.0.0.1', port: 25566 }
    }));
    try {
      const firstChild = await ready(first, firstRoot); await ready(second, secondRoot);
      expect(children.size).toBe(2); await second.stop(operation('stop'));
      expect(firstChild.exitCode).toBeNull();
      expect((await first.snapshot()).status).toMatchObject({ state: 'running', ownership: 'managed' });
      await first.stop(operation('stop')); expect(children.size).toBe(0);
    } finally { await first.closeObserver(); await second.closeObserver(); }
  });

  it('releases reservations after a synchronous spawn failure', async () => {
    const root = await fixtureRoot(), ports = new RuntimePortReservations();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      portReservations: ports, spawnProcess: () => { throw new Error('injected spawn failure'); }
    });
    await runtime.initialize();
    try {
      await expect(runtime.start(operation())).rejects.toMatchObject({ code: 'RUNTIME_START_FAILED' });
      expect(ports.acquire(25565, null).active).toBe(true);
    } finally { await runtime.closeObserver(); }
  });

  it('does not treat a live-child error as proof of exit for releasing ports', async () => {
    const root = await fixtureRoot(), ports = new RuntimePortReservations();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript()), {
      portReservations: ports, spawnProcess: trackedSpawn(), statusProbe: async () => 'running', readinessPollMs: 5
    });
    await runtime.initialize();
    try {
      const child = await ready(runtime, root);
      expect(child.pid).toBeGreaterThan(0); child.emit('error', new Error('injected live-child error'));
      expect(() => ports.acquire(25565, null)).toThrow();
      await stopTestChild(child); expect(ports.acquire(25565, null).active).toBe(true);
    } finally { await runtime.closeObserver(); }
  });

  it.each(['port', 'disabled'] as const)('blocks RCON %s configuration drift without falling back to stdin', async change => {
    const root = await fixtureRoot(); let port: number | null = 26000;
    const runtime = new LocalMinecraftRuntime(plan(root, childScript(), {
      getRconConnection: async () => port === null ? null : ({ host: '127.0.0.1', port, password: 'fixture-only' })
    }), { spawnProcess: trackedSpawn(), statusProbe: async () => 'running', readinessPollMs: 5 });
    await runtime.initialize();
    try {
      const child = await ready(runtime, root), write = vi.spyOn(child.stdin, 'write'); port = change === 'port' ? 26001 : null;
      await expect(runtime.command('say scoped')).rejects.toMatchObject({ code: 'COMMAND_TRANSPORT_UNAVAILABLE' });
      expect(write).not.toHaveBeenCalled();
    } finally { await runtime.closeObserver(); }
  });

  it.each(['console', 'stop', 'whitelist'] as const)('rechecks %s at the send boundary after another launch takes the old RCON port', async channel => {
    const firstRoot = await fixtureRoot(), secondRoot = await fixtureRoot();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const writes: string[] = [];
    vi.spyOn(RconClient.prototype, 'connect').mockResolvedValue();
    vi.spyOn(RconClient.prototype, 'executeGuarded').mockImplementation(async (line, authorize) => {
      enter(); await held; authorize(); writes.push(line); return 'fixture-response';
    });
    const factory = new LocalRuntimeFactory({ spawnProcess: trackedSpawn(), statusProbe: async () => 'running', readinessPollMs: 5 });
    const makePlan = (root: string, id: string, port: number) => {
      const base = plan(root, childScript(), { id, statusEndpoint: { host: '127.0.0.1', port },
        getRconConnection: async () => ({ host: '127.0.0.1' as const, port: 26000, password: 'fixture-only' }) });
      return { ...base, serverInfo: { ...base.serverInfo, minecraftVersion: '26.3' } };
    };
    const first = await factory.create(makePlan(firstRoot, 'first', 25565));
    const second = await factory.create(makePlan(secondRoot, 'second', 25566));
    let pending: Promise<unknown> | undefined;
    try {
      const child = await ready(first, firstRoot);
      await expect(second.start(operation())).rejects.toMatchObject({ code: 'INSTANCE_PORT_CONFLICT' });
      const session = channel === 'whitelist' ? await first.openWhitelistSession!() : undefined;
      pending = (channel === 'console' ? first.command('say stale') : channel === 'stop' ? first.stop(operation('stop')) : session!.add('Player_One', () => undefined));
      const result = pending.then(() => 'resolved', () => 'rejected');
      await entered; await stopTestChild(child); await ready(second, secondRoot); release();
      expect(await result).toBe(channel === 'stop' ? 'resolved' : 'rejected');
      expect(writes).toEqual([]);
      expect((await second.snapshot()).status).toMatchObject({ state: 'running', ownership: 'managed' });
      session?.close();
    } finally { release(); await pending?.catch(() => {}); await first.closeObserver(); await second.closeObserver(); }
  });

  it('does not send a password or command to an RCON port owned by the parent instead of the managed child', async () => {
    let receivedBytes = 0;
    const server = net.createServer(socket => { sockets.add(socket); socket.on('data', bytes => { receivedBytes += bytes.length; }); });
    servers.add(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture-port-unavailable');
    const root = await fixtureRoot(), base = plan(root, childScript(), {
      getRconConnection: async () => ({ host: '127.0.0.1', port: address.port, password: 'same-fixture-password' })
    });
    const runtime = new LocalMinecraftRuntime({ ...base, serverInfo: { ...base.serverInfo, minecraftVersion: '26.3' } }, {
      spawnProcess: trackedSpawn(), statusProbe: async () => 'running', readinessPollMs: 5
    });
    await runtime.initialize();
    try {
      const child = await ready(runtime, root), write = vi.spyOn(child.stdin, 'write');
      await expect(runtime.command('say never-sent')).rejects.toMatchObject({ code: 'COMMAND_TRANSPORT_UNAVAILABLE' });
      await expect(runtime.openWhitelistSession()).rejects.toMatchObject({ code: 'RCON_PEER_UNVERIFIED', commandDispatched: false });
      expect(receivedBytes).toBe(0); expect(write).not.toHaveBeenCalled();
      expect(child.exitCode).toBeNull();
    } finally { await runtime.closeObserver(); }
  });
  it('cannot complete readiness using a valid Minecraft status server owned by another process', async () => {
    let handshakes = 0;
    const server = net.createServer(socket => {
      sockets.add(socket); socket.on('data', () => {
        handshakes++;
        const json = minecraftStatusProtocol.encodeString(JSON.stringify({ version: { name: 'fixture', protocol: 1 }, players: { online: 0, max: 20 } }));
        socket.write(minecraftStatusProtocol.frame(Buffer.concat([Buffer.from([0]), json])));
      });
    });
    servers.add(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture-port-unavailable');
    const root = await fixtureRoot(), runtime = new LocalMinecraftRuntime(plan(root, childScript(), {
      statusEndpoint: { host: '127.0.0.1', port: address.port }
    }), { spawnProcess: trackedSpawn(), startTimeoutMs: 300, readinessPollMs: 5 });
    await runtime.initialize();
    try {
      const starting = runtime.start(operation()), denied = expect(starting).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
      await waitForChild(); await appendFile(join(root, 'logs/latest.log'), '[Server thread/INFO]: Done (wrong owner)!\n');
      await denied; expect(handshakes).toBe(0);
    } finally { await runtime.closeObserver(); }
  });

  it("offers fixed generation-bound whitelist RCON commands without stdin or mutation replay", async () => {
    const root = await fixtureRoot(); const commands: string[] = [];
    let onCommand: (() => void) | undefined;
    const server = net.createServer(socket => {
      sockets.add(socket); let buffer = Buffer.alloc(0);
      socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
          const length = buffer.readInt32LE(0), packet = buffer.subarray(4, length + 4);
          buffer = buffer.subarray(length + 4);
          const id = packet.readInt32LE(0), type = packet.readInt32LE(4), body = packet.subarray(8, length - 2).toString();
          if (type === 2) { commands.push(body); onCommand?.(); }
          socket.write(encodeRconPacket(id, type === 3 ? 2 : 0, type === 2 ? "fake-response" : ""));
        }
      });
    });
    servers.add(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("no port");
    const base = plan(root, childScript({ exitOnStop: true }));
    const runtime = new LocalMinecraftRuntime({ ...base, serverInfo: { ...base.serverInfo, minecraftVersion: "26.3" },
      getRconConnection: async () => ({ host: "127.0.0.1", port: address.port, password: "test-secret" }) }, {
      // Protocol fixture lives in the parent, not the inert managed child.
      tcpPeerVerifier: async () => {},
      spawnProcess: trackedSpawn(), statusProbe: async () => children.size ? "running" : "stopped", readinessPollMs: 5
    });
    await runtime.initialize();
    try {
      await expect(runtime.openWhitelistSession()).rejects.toMatchObject({ commandDispatched: false });
      const starting = runtime.start(operation()); await waitForChild();
      await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (whitelist)!\n"); await starting;
      const session = await runtime.openWhitelistSession();
      expect(session.runtimeId).toMatch(/^[a-f0-9-]{36}$/u);
      await expect(session.add("bad;stop", () => undefined)).rejects.toMatchObject({ code: "ACTION_UNAVAILABLE" });
      await expect(session.add("Player_One", () => { throw new Error("auth-expired"); })).rejects.toThrow("auth-expired");
      await expect(session.add("Player_One", (() => Promise.reject(new Error("invalid-async-permit"))) as unknown as () => undefined))
        .rejects.toMatchObject({ code: "RCON_PROTOCOL_ERROR", commandDispatched: false });
      expect(commands).toEqual([]);
      const listing = session.list();
      await expect(session.add("Player_Two", () => undefined)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      await expect(listing).resolves.toBe("fake-response");
      await expect(session.add("Player_One", () => undefined)).resolves.toBe("fake-response");
      await expect(session.remove("Player_One", () => undefined)).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      expect(commands).toEqual(["whitelist list", "whitelist add Player_One"]);
      const another = await runtime.openWhitelistSession(); expect(another.runtimeId).toBe(session.runtimeId);
      onCommand = () => another.close();
      await expect(another.remove("Player_One", () => undefined)).rejects.toMatchObject({ commandDispatched: true });
      expect(commands.at(-1)).toBe("whitelist remove Player_One");
      session.close();
      await expect(session.list()).rejects.toMatchObject({ commandDispatched: false });
      const old = await runtime.openWhitelistSession();
      const child = await waitForChild(); await stopTestChild(child);
      await expect(old.list()).rejects.toMatchObject({ commandDispatched: false });
      onCommand = undefined;
      const restarting = runtime.start(operation()); await waitForChild();
      await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (whitelist restart)!\n"); await restarting;
      const fresh = await runtime.openWhitelistSession();
      expect(fresh.runtimeId).not.toBe(old.runtimeId);
      await expect(old.add("Player_Two", () => undefined)).rejects.toMatchObject({ commandDispatched: false });
      fresh.close(); old.close();
    } finally { await runtime.closeObserver(); }
  });

  it("does not fall back to stdin when a whitelist session has no RCON", async () => {
    const root = await fixtureRoot(); const base = plan(root, childScript());
    const runtime = new LocalMinecraftRuntime({ ...base, serverInfo: { ...base.serverInfo, minecraftVersion: "26.3" } }, {
      spawnProcess: trackedSpawn(), statusProbe: async () => children.size ? "running" : "stopped", readinessPollMs: 5
    });
    await runtime.initialize();
    try {
      const starting = runtime.start(operation()); const child = await waitForChild();
      await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (whitelist)!\n"); await starting;
      const write = vi.spyOn(child.stdin, "write");
      await expect(runtime.openWhitelistSession()).rejects.toMatchObject({ code: "RCON_CONNECTION_FAILED", commandDispatched: false });
      expect(write).not.toHaveBeenCalled();
    } finally { await runtime.closeObserver(); }
  });

  it("coalesces resource reads and preserves cache timestamps across stop/restart", async () => {
    const root = await fixtureRoot(); let nowMs = 10000; let startMs = 10000; let monotonic = 0;
    const reader = vi.fn(async (pid: number): Promise<ProcessCounters> => ({ pid,
      startTicks: (621355968000000000n + BigInt(startMs) * 10000n).toString(), cpuMs: 100, rssBytes: 2048, executable: process.execPath }));
    const runtime = new LocalMinecraftRuntime(plan(root, childScript({ exitOnStop: true })), {
      spawnProcess: trackedSpawn(), statusProbe: async () => children.size ? "running" : "stopped",
      processCounterReader: reader, resourceMonotonicNow: () => monotonic, now: () => new Date(nowMs), readinessPollMs: 5
    });
    await runtime.initialize();
    try {
      const starting = runtime.start(operation()); await waitForChild();
      await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (resource)!\n"); await starting;
      const values = await Promise.all(Array.from({ length: 20 }, () => runtime.getProcessResources()));
      expect(reader).toHaveBeenCalledTimes(1);
      expect(values.every((value) => value.ram.status === "available")).toBe(true);
      nowMs = 20000;
      expect((await runtime.getProcessResources()).ram).toMatchObject({ sampledAt: new Date(10000).toISOString() });
      monotonic = 5000;
      expect((await runtime.getProcessResources()).cpu).toMatchObject({ status: "available", value: 0 });
      expect(reader).toHaveBeenCalledTimes(2);
      await runtime.stop(operation("stop"));
      expect((await runtime.getProcessResources()).ram.status).toBe("unavailable");
      startMs = 20000; const restarting = runtime.start(operation()); await waitForChild();
      await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (resource restart)!\n"); await restarting;
      const next = await runtime.getProcessResources();
      expect(reader).toHaveBeenCalledTimes(3);
      expect(next.cpu.status).toBe("unavailable");
      expect(next.ram).toMatchObject({ sampledAt: new Date(20000).toISOString() });
      await runtime.stop(operation("stop"));
    } finally { await runtime.closeObserver(); }
  });

  it("does not publish resource readings if the owned child exits during the probe", async () => {
    const root = await fixtureRoot(); let resolve!: (counters: ProcessCounters) => void;
    let entered!: () => void; const ready = new Promise<void>((done) => { entered = done; });
    const runtime = new LocalMinecraftRuntime(plan(root, childScript({ exitOnStop: true })), {
      spawnProcess: trackedSpawn(), statusProbe: async () => children.size ? "running" : "stopped",
      now: () => new Date(10000), readinessPollMs: 5,
      processCounterReader: () => { entered(); return new Promise<ProcessCounters>((done) => { resolve = done; }); }
    });
    await runtime.initialize();
    try {
      const starting = runtime.start(operation()); const child = await waitForChild();
      await appendFile(join(root, "logs", "latest.log"), "[Server thread/INFO]: Done (resource)!\n"); await starting;
      const pending = runtime.getProcessResources(); await ready;
      await runtime.stop(operation("stop"));
      resolve({ pid: child.pid!, startTicks: "621355968100000000", cpuMs: 100, rssBytes: 2048, executable: process.execPath });
      expect(await pending).toMatchObject({ cpu: { status: "unavailable" }, ram: { status: "unavailable" } });
    } finally { await runtime.closeObserver(); }
  });
  it("only gracefully stops the exact transaction-owned child after failed readiness", async () => {
    const root = await fixtureRoot();
    const runtime = new LocalMinecraftRuntime(plan(root, childScript({ exitOnStop: true })), {
      spawnProcess: trackedSpawn(), statusProbe: async () => "stopped", startTimeoutMs: 120, stopTimeoutMs: 1000, readinessPollMs: 5
    });
    await runtime.initialize();
    try {
      await expect(runtime.start(operation())).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
      await expect(runtime.snapshot()).resolves.toMatchObject({ status: { recoveryRequired: true, ownership: "managed" } });
      await expect(runtime.stop(operation("stop"))).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      await expect(runtime.stopOwnedForRecovery(operation("stop"), "another-operation")).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
      await runtime.stopOwnedForRecovery(operation("stop"), "start-operation");
      await expect(runtime.snapshot()).resolves.toMatchObject({ status: { state: "stopped", ownership: "none", recoveryRequired: false } });
    } finally { await runtime.closeObserver(); }
  });

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
      // This test exercises stop framing; ownership has its own native tests.
      tcpPeerVerifier: async () => {},
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
  it('rejects a late NeoForge environment override at the actual spawn boundary', async () => {
    const root = await fixtureRoot(); const base = plan(root, childScript());
    const spawnProcess = vi.fn(() => { throw new Error('must not spawn'); });
    const runtime = new LocalMinecraftRuntime({ ...base, serverInfo: { ...base.serverInfo, type: 'neoforge' } }, { spawnProcess, statusProbe: async () => 'stopped' });
    await runtime.initialize();
    vi.stubEnv('MOD_CLASSES', 'external-path');
    try {
      await expect(runtime.start(operation())).rejects.toMatchObject({ code: 'RUNTIME_START_FAILED' });
      expect(spawnProcess).not.toHaveBeenCalled();
      expect((await runtime.snapshot()).status).toMatchObject({ ownership: 'none', recoveryRequired: false });
    }
    finally { vi.unstubAllEnvs(); await runtime.closeObserver(); }
  });
});
