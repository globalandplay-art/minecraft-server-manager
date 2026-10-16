import { backupDirectoryIdentity } from '../../../apps/api/src/services/backup-identity.js';
import { randomUUID } from 'node:crypto';
import { HttpAuthentication } from '../../../apps/api/src/auth/http-auth.js';
import { PasswordVerifier, SCRYPT_PROFILE } from '../../../apps/api/src/auth/password.js';
import { SessionCore } from '../../../apps/api/src/auth/session-core.js';
// Isolated local HTTP fixture for the Properties browser flow. No Java or user data.
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { buildApp } from '../../../apps/api/src/app.js';
import { createMockAdapters } from '../../../apps/api/src/fixtures/servers.js';
import type { LocalMinecraftServerAdapter } from '../../../apps/api/src/adapters/contract.js';
import type { Clock } from '../../../apps/api/src/clock.js';
import { worldIdentity } from '../../../apps/api/src/services/active-world-state-store.js';
import { MemoryOperationStore } from '../../../apps/api/src/services/operation-store.js';
import { TransactionJournalStore } from '../../../apps/api/src/services/transaction-journal.js';

const clock: Clock = { now: () => new Date() };
const root = await mkdtemp(path.join(tmpdir(), 'mcsm-p43-properties-'));
const managerRoot = path.join(root, 'manager');
await mkdir(managerRoot, { recursive: true });
const mock = createMockAdapters(clock)[1]!;
const baseInfo = await mock.getServerInfo();
const adapters: LocalMinecraftServerAdapter[] = [];
const states = new Map<string, { schemaVersion: 1; serverId: string; state: 'active'; worldId: string; levelName: 'world' }>();

for (const width of [360, 768, 1440]) {
  const id = `props-${width}`;
  const serverRoot = path.join(root, id);
  const worldRoot = path.join(serverRoot, 'world');
  await mkdir(worldRoot, { recursive: true });
  await writeFile(path.join(worldRoot, 'level.dat'), 'synthetic world revision', { flag: 'wx' });
  await writeFile(path.join(serverRoot, 'server.properties'),
    'level-name=world\npvp=true\nonline-mode=true\nmotd=Isolated\nrcon.password=P43_FIXTURE_SENTINEL\n', { flag: 'wx' });

  await writeFile(path.join(serverRoot, 'whitelist.json'), JSON.stringify([{ name: 'Player_One', uuid: '123e4567-e89b-42d3-a456-426614174000' }]), { flag: 'wx' });
  const rootIdentity = await backupDirectoryIdentity(serverRoot);
  const serverInfo = { ...baseInfo, id, name: `Properties ${width}`, type: 'vanilla' as const, minecraftVersion: '26.3' };
  const plan = {
    id, name: serverInfo.name, rootPath: serverRoot,
    javaExecutable: path.join(serverRoot, 'unused-java'), jarPath: path.join(serverRoot, 'unused-server.jar'), argv: [],
    statusEndpoint: { host: '127.0.0.1' as const, port: 0 }, eulaAccepted: true, serverInfo,
    getRconConnection: async () => null,
  };
  const state = { schemaVersion: 1 as const, serverId: id, state: 'active' as const, worldId: worldIdentity(id, 'world'), levelName: 'world' as const };
  states.set(id, state);
  adapters.push({
    mode: 'local', serverId: id, plan,
    getRegisteredExecutionIdentity: () => ({ rootIdentity, javaIdentity: 'a'.repeat(64), javaSha256: 'a'.repeat(64), launcherIdentity: 'a'.repeat(64), launcherSha256: 'a'.repeat(64), fabricExecutionSha256: null }),
    getServerInfo: async () => serverInfo,
    getCapabilities: async () => ({ ...(await mock.getCapabilities()), properties: true, console: false, rcon: false }),
    getStatus: async () => ({ state: 'stopped', ownership: 'none', source: 'process', observedAt: clock.now().toISOString(), activeOperationId: null, recoveryRequired: false }),
    getMetrics: () => mock.getMetrics(), getActivity: async () => [], getAlerts: async () => [],
    getRuntime: () => { throw new Error('P43 fixture has no runtime'); },
    getCommandTransport: async () => 'unavailable',
    revalidateBeforeStart: async () => { throw new Error('P43 fixture rejects start'); },
    start: async () => { throw new Error('P43 fixture rejects start'); },
    stop: async () => { throw new Error('P43 fixture rejects stop'); },
    command: async () => { throw new Error('P43 fixture rejects command'); },
    getLogs: async () => ({ items: [], nextCursor: '', truncated: false }),
    subscribe: () => () => {}, streamSnapshot: async () => { throw new Error('P43 fixture has no stream'); },
    replayStream: async () => { throw new Error('P43 fixture has no stream'); }, closeObserver: async () => {},
  } as unknown as LocalMinecraftServerAdapter);
}

const activeWorldState = {
  snapshot: (serverId: string) => states.get(serverId) ?? null,
  initialize: async () => new Set<string>(),
  isActive: (serverId: string, worldId: string) => states.get(serverId)?.worldId === worldId,
  reconcileAfterStart: async () => {},
};
const authentication = new HttpAuthentication(new PasswordVerifier({ version: 1, username: 'fixture-admin', revision: randomUUID(), salt: 'ab'.repeat(16), hash: 'cd'.repeat(64), parameters: SCRYPT_PROFILE }, undefined, async password => Buffer.from((password === 'LC2_SYNTHETIC_LOGIN_ONLY' ? 'cd' : 'ef').repeat(64), 'hex')), { ready: () => true, record: async () => {}, close: async () => {} }, new SessionCore());
const app = buildApp({ mode: 'local', clock, adapters, managerRoot, authentication,
  transactionJournal: new TransactionJournalStore(managerRoot), operationStore: new MemoryOperationStore(),
  activeWorldState, backupSchedulerTimers: false, importAutomaticCleanup: false });

let closing: Promise<void> | undefined;
async function closeFixture() {
  if (closing) return closing;
  closing = (async () => {
    await app.close();
    await rm(root, { recursive: true });
  })();
  return closing;
}
process.on('message', message => {
  if (message !== 'LC2_SHUTDOWN') return;
  void closeFixture().then(() => {
    process.exitCode = 0;
    process.send?.('LC2_CLEANUP_COMPLETE', () => { process.disconnect?.(); });
  }, () => {
    process.exitCode = 1;
    process.send?.('LC2_CLEANUP_BLOCKED', () => { process.disconnect?.(); });
  });
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  void closeFixture().then(() => { process.exitCode = 0; }, (error) => {
    console.error('P43_FIXTURE_CLEANUP_FAILED', error);
    process.exitCode = 1;
  });
});

try {
  await app.listen({ host: '127.0.0.1', port: 8080 });
  console.log('P43_API_READY');
} catch (error) {
  await closeFixture();
  throw error;
}
