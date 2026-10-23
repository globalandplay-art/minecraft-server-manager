import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { ServerStatus, LogEntry } from '@mcsm/contracts';
import type { MinecraftRuntime, RuntimeEvent, RuntimeFactory, ValidatedLaunchPlan } from '../src/infra/runtime-contract.js';
import { LocalJavaAdapter } from '../src/adapters/local.js';
import { validateRegistration } from '../src/config/local-config.js';
import { ActiveWorldStateStore } from '../src/services/active-world-state-store.js';
import { TransactionJournalStore } from '../src/services/transaction-journal.js';
import { createMockAdapters } from '../src/fixtures/servers.js';
import { buildApp } from '../src/app.js';
import { launchZip } from './helpers/launch-zip.js';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { OperationService } from '../src/services/operation-service.js';
import { MemoryOperationStore } from '../src/services/operation-store.js';
import { EventStreamService } from '../src/services/event-stream-service.js';
import { activateInstance } from '../src/services/instance-activation.js';
import { ServerRegistrationService } from '../src/services/server-registration-service.js';
import { RuntimeError } from '../src/infra/runtime/local-runtime.js';
import { fabricLaunchFixture } from './helpers/fabric-launch.js';
import { forgeLaunchFixture } from './helpers/forge-launch.js';
import { neoForgeLaunchFixture } from './helpers/neoforge-launch.js';

// Detection is deterministic; no Java/Minecraft process is spawned by this suite.
vi.mock('../src/services/detection-service.js', () => ({ detectServer: async (input: { id: string; name: string }) => ({
  id: input.id, name: input.name, type: input.name === 'NeoForge' ? 'neoforge' : input.name === 'Paper' ? 'paper' : input.name === 'Fabric' ? 'fabric' : input.name === 'Forge' ? 'forge' : 'vanilla',
  minecraftVersion: input.name === 'Fabric' ? '26.2' : '26.3', java: { runtimeVersion: '25', requiredMajor: 25 },
  detection: { confidence: 'high', evidence: input.name === 'NeoForge' ? ['neoforge-server-descriptor', 'neoforge-execution-binding'] : input.name === 'Forge' ? ['forge-shim-main-class', 'forge-execution-binding'] : input.name === 'Fabric' ? ['fabric-launcher-main-class', 'fabric-execution-binding'] : ['jar-version-json', ...(input.name === 'Paper' ? ['paperclip-main-class'] : [])], warnings: [] }
}) }));
const roots: string[] = [], apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const app of apps.splice(0)) await app.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
const clock = { now: () => new Date() };
const removeRegistration = (app: ReturnType<typeof buildApp>, id: string) => app.inject({ method: 'DELETE', url: `/api/v1/server-registrations/${id}`, headers, payload: { confirm: true } });
async function fixture(secondType: 'vanilla' | 'paper' | 'fabric' | 'forge' | 'neoforge' = 'vanilla', sharedFactory = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-hot-')); roots.push(root);
  const manager = path.join(root, 'manager'), first = path.join(root, 'first'), second = path.join(root, 'second');
  for (const dir of [manager, first, second]) { await mkdir(dir); }
  for (const [index, dir] of [first, second].entries()) {
    await writeFile(path.join(dir, 'server.jar'), launchZip({ 'META-INF/MANIFEST.MF': 'Main-Class: net.minecraft.bundler.Main\n', 'version.json': '{"id":"26.3","java_version":25}' }));
    await writeFile(path.join(dir, 'eula.txt'), 'eula=true\n');
    await writeFile(path.join(dir, 'server.properties'), `server-ip=127.0.0.1\nserver-port=${25565 + index}\nlevel-name=world\nwhite-list=false\nmotd=Instance${index}\n`);
    await writeFile(path.join(dir, 'whitelist.json'), JSON.stringify([{ name: index ? 'Player_Two' : 'Player_One', uuid: index ? '123e4567-e89b-42d3-a456-426614174001' : '123e4567-e89b-42d3-a456-426614174000' }]));
    await mkdir(path.join(dir, 'logs')); await writeFile(path.join(dir, 'logs/latest.log'), '');
  }
  if (secondType === 'fabric') await fabricLaunchFixture(second);
  if (secondType === 'forge') await forgeLaunchFixture(second, { minecraftVersion: '26.3', javaVersion: 25 });
  if (secondType === 'neoforge') await neoForgeLaunchFixture(second);
  if (secondType === 'paper') await writeFile(path.join(second, 'server.jar'), launchZip({
    'META-INF/MANIFEST.MF': 'Main-Class: io.papermc.paperclip.Main\n', 'version.json': '{"id":"26.3","java_version":25}'
  }));
  // This Fake factory/detector never executes Java. Exercise real identity/hash
  // checks on small inert bytes instead of repeatedly hashing the large Node EXE.
  const javaExecutable = path.join(root, 'fixture-java.exe'); await writeFile(javaExecutable, 'inert identity fixture; never executed');
  const config = { id: 'first', name: 'First', root: first, jarFile: 'server.jar', javaExecutable, jvmArgs: ['-Xms512M', '-Xmx1G'], serverArgs: ['nogui'] };
  await writeFile(path.join(manager, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [config] }));
  const metrics = await createMockAdapters(clock)[0]!.getMetrics();
  const runtimes = new Map<string, { runtime: MinecraftRuntime; listeners: Set<(event: RuntimeEvent) => void>; close: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; status: ServerStatus }>();
  const factory: RuntimeFactory = { async create(plan: ValidatedLaunchPlan) {
    const listeners = new Set<(event: RuntimeEvent) => void>();
    const status: ServerStatus = { state: 'stopped', ownership: 'none', source: 'status-query', observedAt: clock.now().toISOString(), activeOperationId: null, recoveryRequired: false };
    const logs: LogEntry[] = [{ id: 'entry-1', cursor: 'cursor-1', timestamp: clock.now().toISOString(), level: 'info', source: 'latest.log', text: `${plan.id} ONLY` }];
    const start = vi.fn(async () => { status.state = 'running'; status.ownership = 'managed'; });
    const close = vi.fn(async () => { listeners.clear(); });
    const streamId = randomUUID();
    const runtime: MinecraftRuntime = {
      snapshot: async () => ({ status: { ...status }, metrics, commandTransport: 'unavailable' }), start,
      stop: vi.fn(async () => { status.state = 'stopped'; status.ownership = 'none'; }),
      command: async () => { throw new Error('No command channel'); }, getLogs: async () => ({ items: logs, nextCursor: '1', truncated: false }),
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      streamSnapshot: async () => ({ streamId, latestSequence: 1, status: { ...status }, logs }),
      replayStream: async () => ({ streamId, latestSequence: 0, events: [], gap: false, reason: null }), closeObserver: close
    };
    runtimes.set(plan.id, { runtime, listeners, close, start, status }); return runtime;
  } };
  const registration = await validateRegistration(config), adapter = new LocalJavaAdapter(registration, await factory.create(registration.plan));
  const active = new ActiveWorldStateStore(manager, [adapter]), journal = new TransactionJournalStore(manager);
  const app = buildApp({ mode: 'local', managerRoot: manager, adapters: [adapter], ...(sharedFactory ? { localRuntimeFactory: factory } : {}),
    activeWorldState: active, transactionJournal: journal, transactionRecovery: journal, backupSchedulerTimers: false });
  apps.push(app); await app.ready();
  const draft = { id: 'second', name: secondType === 'neoforge' ? 'NeoForge' : secondType === 'vanilla' ? 'Second' : secondType === 'paper' ? 'Paper' : secondType === 'forge' ? 'Forge' : 'Fabric', root: second,
    jarFile: secondType === 'neoforge' ? 'run.bat' : secondType === 'forge' ? 'forge-shim.jar' : secondType === 'fabric' ? 'launcher.jar' : 'server.jar', javaProfileId: 'first' };
  const add = async () => {
    const preview = await app.inject({ method: 'POST', url: '/api/v1/server-registrations/preflight', headers, payload: draft });
    expect(preview.statusCode).toBe(200);
    return app.inject({ method: 'POST', url: '/api/v1/server-registrations', headers, payload: { token: preview.json().data.token, confirm: true } });
  };
  return { app, root, manager, first, second, active, runtimes, add, adapter, factory, config };
}
it.each(['vanilla', 'paper', 'fabric'] as const)('removes only the stopped %s registration, observer and streams; preserves files and peer', async kind => {
  const f = await fixture(kind); await f.add();
  const files = await readFile(path.join(f.second, 'server.properties'));
  const response = await removeRegistration(f.app, 'second'); expect(response.statusCode).toBe(200);
  expect(response.json().data).toMatchObject({ removed: true, unloaded: true, filesPreserved: true, restartRequired: false });
  expect(JSON.parse(await readFile(path.join(f.manager, 'config.json'), 'utf8')).servers.map((row: {id:string}) => row.id)).toEqual(['first']);
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers', headers })).json().data.items.map((row: {server:{id:string}}) => row.server.id)).toEqual(['first']);
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/second', headers })).statusCode).toBe(404);
  expect((await f.app.inject({ method: 'POST', url: '/api/v1/servers/second/actions/start', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {} })).statusCode).toBe(404);
  expect(await readFile(path.join(f.second, 'server.properties'))).toEqual(files);
  expect(f.runtimes.get('second')!.close).toHaveBeenCalledOnce(); expect(f.runtimes.get('second')!.listeners.size).toBe(0);
  expect(f.runtimes.get('first')!.close).not.toHaveBeenCalled(); expect(f.runtimes.get('first')!.start).not.toHaveBeenCalled();
  expect((await removeRegistration(f.app, 'second')).statusCode).toBe(404);
});
it('rejects running removal and unknown/unconfirmed writes without changing config', async () => {
  const f = await fixture(); await f.add(); const before = await readFile(path.join(f.manager, 'config.json'));
  f.runtimes.get('second')!.status.state = 'running'; f.runtimes.get('second')!.status.ownership = 'managed';
  const response = await removeRegistration(f.app, 'second'); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('REGISTRATION_INSTANCE_ACTIVE');
  expect((await removeRegistration(f.app, 'missing')).statusCode).toBe(404);
  expect((await f.app.inject({ method: 'DELETE', url: '/api/v1/server-registrations/first', headers, payload: { confirm: true, root: f.first } })).statusCode).toBe(400);
  expect((await f.app.inject({ method: 'DELETE', url: '/api/v1/server-registrations/first', headers: { host: headers.host }, payload: { confirm: true } })).statusCode).toBe(403);
  expect(await readFile(path.join(f.manager, 'config.json'))).toEqual(before);
});
it('removes the last instance while retaining its verified Java for a new registration', async () => {
  const f = await fixture(); expect((await removeRegistration(f.app, 'first')).statusCode).toBe(200);
  const catalog = (await f.app.inject({ method: 'GET', url: '/api/v1/server-registrations', headers })).json().data;
  expect(catalog.profiles).toEqual([{ id: 'first', name: 'First' }]);
  const result = await f.add(); expect(result.statusCode).toBe(201); expect(result.json().data.loaded).toBe(true);
  expect(JSON.parse(await readFile(path.join(f.manager, 'config.json'), 'utf8')).javaProfiles).toHaveLength(1);
});
it('rejects reuse of a removed instance ID before saving or creating another runtime', async () => {
  const f = await fixture(); await f.add(); expect((await removeRegistration(f.app, 'second')).statusCode).toBe(200);
  const before = await readFile(path.join(f.manager, 'config.json'));
  const response = await f.app.inject({ method: 'POST', url: '/api/v1/server-registrations/preflight', headers,
    payload: { id: 'second', name: 'Second again', root: f.second, jarFile: 'server.jar', javaProfileId: 'first' } });
  expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('REGISTRATION_ID_RETIRED');
  expect(await readFile(path.join(f.manager, 'config.json'))).toEqual(before);
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/second', headers })).statusCode).toBe(404);
  expect(f.runtimes.get('second')!.close).toHaveBeenCalledOnce();
});
it('quarantines a removed adapter even if closing its observer fails', async () => {
  const f = await fixture(); await f.add(); f.runtimes.get('second')!.close.mockRejectedValueOnce(new Error('close failed'));
  const response = await removeRegistration(f.app, 'second'); expect(response.statusCode).toBe(200);
  expect(response.json().data).toMatchObject({ removed: true, unloaded: false, restartRequired: true, unloadErrorCode: 'REGISTRATION_UNLOAD_REQUIRES_RESTART' });
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/second', headers })).statusCode).toBe(404);
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/first', headers })).statusCode).toBe(200);
});
it('quarantines a published but unconfirmed removal and preserves its config evidence', async () => {
  const f = await fixture(); await f.add(); let reads = 0;
  const original = ServerRegistrationService.prototype.snapshot;
  vi.spyOn(ServerRegistrationService.prototype, 'snapshot').mockImplementation(async function(this: ServerRegistrationService) {
    const value = await original.call(this); if (++reads === 3) throw new Error('injected post-publication read failure'); return value;
  });
  const response = await removeRegistration(f.app, 'second'); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('REGISTRATION_RESULT_UNKNOWN');
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/second', headers })).statusCode).toBe(404);
  expect(JSON.parse(await readFile(path.join(f.manager, 'config.json'), 'utf8')).servers.map((row: {id:string}) => row.id)).toEqual(['first']);
  expect(f.runtimes.get('second')!.close).toHaveBeenCalledOnce();
});
it('removes a pending stopped registration without deleting its retained history', async () => {
  const f = await fixture();
  await writeFile(path.join(f.manager, 'active-worlds/second.json'), 'retained unknown history');
  const saved = await f.add(); expect(saved.json().data.loaded).toBe(false);
  const removed = await removeRegistration(f.app, 'second'); expect(removed.statusCode).toBe(200); expect(removed.json().data.unloaded).toBe(true);
  expect(await readFile(path.join(f.manager, 'active-worlds/second.json'), 'utf8')).toBe('retained unknown history');
  expect(f.runtimes.get('first')!.close).not.toHaveBeenCalled();
});
it('closes existing WebSocket subscriptions when its instance is removed', async () => {
  const f = await fixture(); await f.add();
  const socket = await f.app.injectWS('/ws/v1/servers/second/events', { headers });
  const closed = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
  expect((await removeRegistration(f.app, 'second')).statusCode).toBe(200); expect(await closed).toBe(1001);
});
it('rejects recovery-required removal with config untouched', async () => {
  const f = await fixture(); await f.add(); const before = await readFile(path.join(f.manager, 'config.json'));
  f.runtimes.get('second')!.status.recoveryRequired = true;
  expect((await removeRegistration(f.app, 'second')).statusCode).toBe(409);
  expect(await readFile(path.join(f.manager, 'config.json'))).toEqual(before);
});
it('loads instantly without recreating first runtime, starting either server or changing its active-world state', async () => {
  const f = await fixture(), firstState = f.active.snapshot('first');
  const result = await f.add(); expect(result.statusCode).toBe(201);
  expect(result.json().data).toMatchObject({ loaded: true, restartRequired: false, loadErrorCode: null });
  const servers = (await f.app.inject({ method: 'GET', url: '/api/v1/servers', headers })).json().data.items;
  expect(servers.map((row: {server:{id:string}}) => row.server.id)).toEqual(['first', 'second']);
  expect(f.active.snapshot('first')).toEqual(firstState); expect(f.active.snapshot('second')?.state).toBe('pending-generation');
  expect(f.runtimes.size).toBe(2);
  for (const runtime of f.runtimes.values()) { expect(runtime.start).not.toHaveBeenCalled(); expect(runtime.listeners.size).toBe(1); }
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/server-registrations', headers })).json().data.pending).toEqual([]);
});
it('keeps registration pending when the initial shared factory was not supplied', async () => {
  const f = await fixture('vanilla', false), result = await f.add();
  expect(result.statusCode).toBe(201);
  expect(result.json().data).toMatchObject({ loaded: false, restartRequired: true });
  expect(f.runtimes.size).toBe(1); expect(f.runtimes.get('first')!.start).not.toHaveBeenCalled();
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/second', headers })).statusCode).toBe(404);
});
it('isolates configuration, whitelist and log reads before and after immediate addition', async () => {
  const f = await fixture(); await f.add();
  for (const [id, marker, name] of [['first', 'Instance0', 'Player_One'], ['second', 'Instance1', 'Player_Two']]) {
    const base = `/api/v1/servers/${id}`;
    expect((await f.app.inject({ method: 'GET', url: `${base}/properties`, headers })).json().data.fields.motd).toBe(marker);
    const list = (await f.app.inject({ method: 'GET', url: `${base}/whitelist`, headers })).json().data;
    expect(list.items.map((row: {name:string}) => row.name)).toEqual([name]); expect(list.membershipWritable).toBe(false);
    const logs = await f.app.inject({ method: 'GET', url: `${base}/logs`, headers });
    expect(logs.statusCode).toBe(200); expect(logs.json().data.items[0].text).toBe(`${id} ONLY`);
  }
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/missing/whitelist', headers })).statusCode).toBe(404);
});
it('admits the new performance ID without resetting the existing instance samples', async () => {
  const metrics = await createMockAdapters(clock)[0]!.getMetrics();
  vi.spyOn(LocalJavaAdapter.prototype, 'getMetrics').mockResolvedValue(metrics);
  const f = await fixture();
  const before = await f.app.inject({ method: 'GET', url: '/api/v1/servers/first/performance', headers });
  expect(before.statusCode).toBe(200); expect(before.json().data.samples).toHaveLength(1);
  await f.add();
  const second = await f.app.inject({ method: 'GET', url: '/api/v1/servers/second/performance', headers });
  expect(second.statusCode).toBe(200); expect(second.json().data.samples).toHaveLength(1);
  const after = await f.app.inject({ method: 'GET', url: '/api/v1/servers/first/performance', headers });
  expect(after.json().data.samples).toEqual(before.json().data.samples);
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/missing/performance', headers })).statusCode).toBe(404);
});
it.each(['active-worlds', 'backup-schedules', 'world-imports'])('preserves pending registration and does not attach an ID with old %s evidence', async namespace => {
  const f = await fixture(); await mkdir(path.join(f.manager, namespace), { recursive: true });
  if (namespace === 'world-imports') {
    const entry = path.join(f.manager, namespace, randomUUID()); await mkdir(entry); await writeFile(path.join(entry, 'owner.json'), JSON.stringify({ serverId: 'second' }));
  } else await writeFile(path.join(f.manager, namespace, 'second.json'), '{}');
  const result = await f.add(); expect(result.json().data).toMatchObject({ loaded: false, restartRequired: true });
  expect(f.runtimes.has('second')).toBe(false); expect(f.runtimes.get('first')!.close).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(path.join(f.manager, 'config.json'), 'utf8')).servers).toHaveLength(2);
});
it('closes an unexposed adapter on subscription failure, retains evidence and leaves first untouched', async () => {
  const f = await fixture(); const spy = vi.spyOn(EventStreamService.prototype, 'add');
  spy.mockImplementation(() => { throw new Error('injected subscription failure'); });
  const result = await f.add(); expect(result.json().data.loaded).toBe(false);
  expect(f.runtimes.get('second')!.close).toHaveBeenCalledOnce();
  expect(f.active.snapshot('second')).toBeNull(); expect(f.runtimes.get('first')!.close).not.toHaveBeenCalled();
});
it('keeps per-instance operation exclusion and recovery independent', async () => {
  const operations = new OperationService(new MemoryOperationStore(), clock); await operations.initialize();
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const held = operations.runExclusive('first', async () => { entered(); await waiting; }); await started;
  await expect(operations.runExclusive('first', async () => {})).rejects.toThrow();
  operations.requireRecovery(['first']);
  await expect(operations.runExclusive('second', async () => 'second-only')).resolves.toBe('second-only');
  expect(operations.getServerState('second').recoveryRequired).toBe(false); release(); await held;
});
it('retains a saved but pending registration when runtime initialization fails', async () => {
  const f = await fixture(); vi.spyOn(f.factory, 'create').mockRejectedValueOnce(new Error('injected initialize failure'));
  const result = await f.add(); expect(result.json().data).toMatchObject({ loaded: false, restartRequired: true });
  expect(f.runtimes.get('first')!.close).not.toHaveBeenCalled(); expect(f.active.snapshot('second')).toBeNull();
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/second', headers })).statusCode).toBe(404);
});
it('does not publish if shutdown starts while the new runtime initializes', async () => {
  const f = await fixture(), registry = new AdapterRegistry([f.adapter]);
  const operations = new OperationService(new MemoryOperationStore(), clock); await operations.initialize();
  const streams = new EventStreamService(registry, operations);
  const registration = await validateRegistration({ ...f.config, id: 'second', root: f.second });
  let closing = false;
  await expect(activateInstance(registration, { root: f.manager, registry, operations, streams, active: f.active,
    factory: { create: async plan => { const runtime = await f.factory.create(plan); closing = true; return runtime; } }, closing: () => closing }, () => {})).rejects.toThrow();
  expect(registry.get('second')).toBeUndefined(); expect(streams.has('second')).toBe(false);
  expect(f.runtimes.get('second')!.close).toHaveBeenCalledOnce(); expect(f.active.snapshot('second')).toBeNull();
  streams.close();
});
it('keeps streams and replay cursors scoped when adding another adapter', async () => {
  const f = await fixture(), registry = new AdapterRegistry([f.adapter]);
  const operations = new OperationService(new MemoryOperationStore(), clock); await operations.initialize();
  const streams = new EventStreamService(registry, operations); const firstId = streams.hello('first').streamId;
  await f.add();
  const secondRuntime = f.runtimes.get('second')!.runtime;
  const second = { ...f.adapter, serverId: 'third', subscribe: secondRuntime.subscribe.bind(secondRuntime) };
  // An independent stream registration must not reset first's stream/replay identity.
  streams.add(second as unknown as LocalJavaAdapter);
  expect(streams.hello('first').streamId).toBe(firstId);
  expect(streams.hello('third').streamId).not.toBe(firstId);
  expect(streams.replay('third', firstId, 0).gap).toBe(true); streams.close();
});

async function action(f: Awaited<ReturnType<typeof fixture>>, kind: 'start' | 'stop' | 'restart', key = randomUUID()) {
  return f.app.inject({ method: 'POST', url: `/api/v1/servers/second/actions/${kind}`,
    headers: { ...headers, 'idempotency-key': key }, payload: {} });
}
async function terminal(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  let operation: { id: string; serverId: string; state: string; error?: unknown } | undefined;
  await vi.waitFor(async () => {
    const response = await f.app.inject({ method: 'GET', url: `/api/v1/operations/${id}`, headers });
    expect(response.statusCode).toBe(200); operation = response.json().data;
    expect(['succeeded', 'failed', 'interrupted']).toContain(operation!.state);
  });
  return operation!;
}
it.each(['paper', 'fabric', 'forge', 'neoforge'] as const)('M2: newly loaded %s uses the existing start/stop/restart API with scoped idempotency', async type => {
  const f = await fixture(type); expect((await f.add()).json().data.loaded).toBe(true);
  const key = randomUUID(), started = await action(f, 'start', key);
  expect(started.statusCode).toBe(202);
  const id = started.json().data.operation.id;
  expect(await terminal(f, id)).toMatchObject({ serverId: 'second', state: 'succeeded' });
  expect(f.runtimes.get('second')!.status).toMatchObject({ state: 'running', ownership: 'managed' });
  const replay = await action(f, 'start', key);
  expect(replay.statusCode).toBe(202); expect(replay.json().data.operation.id).toBe(id);
  expect(f.runtimes.get('second')!.start).toHaveBeenCalledOnce();
  const restarted = await action(f, 'restart'); expect(restarted.statusCode).toBe(202);
  expect((await terminal(f, restarted.json().data.operation.id)).state).toBe('succeeded');
  expect(f.runtimes.get('second')!.start).toHaveBeenCalledTimes(2);
  expect(f.runtimes.get('second')!.runtime.stop).toHaveBeenCalledOnce();
  const stopped = await action(f, 'stop'); expect(stopped.statusCode).toBe(202);
  expect((await terminal(f, stopped.json().data.operation.id)).state).toBe('succeeded');
  expect(f.runtimes.get('second')!.runtime.stop).toHaveBeenCalledTimes(2);
  expect(f.runtimes.get('second')!.status).toMatchObject({ state: 'stopped', ownership: 'none' });
  expect(f.runtimes.get('first')!.start).not.toHaveBeenCalled();
  expect(f.runtimes.get('first')!.runtime.stop).not.toHaveBeenCalled();
  expect(f.runtimes.get('first')!.close).not.toHaveBeenCalled();
  expect(f.runtimes.get('first')!.status.state).toBe('stopped');
});
it('M2.1: an unexited Forge stop blocks restart, new admission and duplicate sends', async () => {
  const f = await fixture('forge'); await f.add();
  const started = await action(f, 'start'); expect((await terminal(f, started.json().data.operation.id)).state).toBe('succeeded');
  const runtime = f.runtimes.get('second')!;
  vi.mocked(runtime.runtime.stop).mockRejectedValueOnce(new RuntimeError('OPERATION_TIMEOUT', 'Minecraft stop did not exit'));
  const key = randomUUID(), restarted = await action(f, 'restart', key), id = restarted.json().data.operation.id;
  expect(await terminal(f, id)).toMatchObject({ state: 'interrupted', error: { code: 'RECOVERY_REQUIRED' } });
  expect(runtime.start).toHaveBeenCalledOnce(); expect(runtime.runtime.stop).toHaveBeenCalledOnce();
  expect((await action(f, 'start')).statusCode).toBe(409);
  const replay = await action(f, 'restart', key);
  expect(replay.statusCode).toBe(202);
  expect(replay.json().data.operation).toMatchObject({ id, state: 'interrupted', error: { code: 'RECOVERY_REQUIRED' } });
  expect(runtime.start).toHaveBeenCalledOnce(); expect(runtime.runtime.stop).toHaveBeenCalledOnce();
  expect(f.runtimes.get('first')!.start).not.toHaveBeenCalled();
});
it('M2.1: changed Forge dependency prevents runtime start without affecting the old instance', async () => {
  const f = await fixture('forge'); await f.add();
  await writeFile(path.join(f.second, 'libraries/net/minecraftforge/bootstrap/2.1.8/bootstrap-2.1.8.jar'), 'changed bound code');
  const started = await action(f, 'start'); expect(started.statusCode).toBe(202);
  expect(await terminal(f, started.json().data.operation.id)).toMatchObject({ state: 'failed', error: { code: 'ACTION_UNAVAILABLE' } });
  for (const runtime of f.runtimes.values()) expect(runtime.start).not.toHaveBeenCalled();
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/first', headers })).json().data.status.recoveryRequired).toBe(false);
});
it.each(['paper', 'fabric'] as const)('M2: %s launch identity drift never reaches runtime start', async type => {
  const f = await fixture(type); await f.add();
  await writeFile(path.join(f.second, type === 'fabric' ? 'launcher.jar' : 'server.jar'), 'replaced launch artifact');
  const response = await action(f, 'start'); expect(response.statusCode).toBe(202);
  const result = await terminal(f, response.json().data.operation.id);
  // An unparseable Fabric bundle raises outside DomainError: the existing
  // executor conservatively retains recovery, unlike a Paper identity mismatch.
  expect(result.state).toBe(type === 'fabric' ? 'interrupted' : 'failed');
  if (type === 'fabric') {
    expect(result.error).toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect((await action(f, 'start')).statusCode).toBe(409);
  }
  for (const runtime of f.runtimes.values()) expect(runtime.start).not.toHaveBeenCalled();
});
it.each(['paper', 'fabric'] as const)('M2: %s EULA withdrawal never reaches runtime start', async type => {
  const f = await fixture(type); await f.add(); await writeFile(path.join(f.second, 'eula.txt'), 'eula=false\n');
  const response = await action(f, 'start'); expect(response.statusCode).toBe(202);
  expect((await terminal(f, response.json().data.operation.id)).state).toBe('failed');
  for (const runtime of f.runtimes.values()) expect(runtime.start).not.toHaveBeenCalled();
});
it('M2: a Fabric bound library changed after load prevents execution', async () => {
  const f = await fixture('fabric'); await f.add();
  await writeFile(path.join(f.second, 'libraries/test/loader.jar'), 'changed bound library');
  const response = await action(f, 'start'); expect(response.statusCode).toBe(202);
  expect(await terminal(f, response.json().data.operation.id)).toMatchObject({ state: 'interrupted', error: { code: 'RECOVERY_REQUIRED' } });
  const blocked = await action(f, 'start'); expect(blocked.statusCode).toBe(409);
  expect(blocked.json().error.code).toBe('RECOVERY_REQUIRED');
  expect((await f.app.inject({ method: 'GET', url: '/api/v1/servers/first', headers })).json().data.status.recoveryRequired).toBe(false);
  for (const runtime of f.runtimes.values()) expect(runtime.start).not.toHaveBeenCalled();
});
