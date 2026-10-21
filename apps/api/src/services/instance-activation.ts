import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { LocalJavaAdapter } from '../adapters/local.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { ValidatedRegistration } from '../config/local-config.js';
import type { RuntimeFactory } from '../infra/runtime-contract.js';
import type { ActiveWorldStateStore } from './active-world-state-store.js';
import type { OperationService } from './operation-service.js';
import type { EventStreamService } from './event-stream-service.js';
import type { TransactionJournalStore } from './transaction-journal.js';
import { DomainError } from './domain-errors.js';
import { backupDirectoryIdentity } from './backup-identity.js';
import { readPrivatePropertiesFile } from './properties-private-file.js';

/** Prepare one fresh ID. Never rerun reconciliation or disturb live instances. */
export async function activateInstance(registration: ValidatedRegistration, context: {
  root: string; registry: AdapterRegistry; operations: OperationService; streams: EventStreamService;
  factory: RuntimeFactory; active?: Pick<ActiveWorldStateStore, 'register'>; journal?: TransactionJournalStore;
  closing: () => boolean;
}, authorize: () => void): Promise<void> {
  const id = registration.plan.id;
  const blocked = () => new DomainError(409, 'REGISTRATION_LOAD_REQUIRES_REVIEW', '登记已保存，但历史状态或关闭状态需要重新检查；未启动新实例');
  if (context.closing() || context.registry.get(id)) throw blocked();
  if (context.operations.getServerState(id).recoveryRequired || (await context.operations.storedOutcomes()).some(row => row.serverId === id)) throw blocked();
  const scan = await context.journal?.scan();
  if (scan?.records.some(row => row.intent.serverId === id) || scan?.issues.some(row => !row.serverId || row.serverId === id)) throw blocked();
  for (const name of ['active-worlds', 'backup-schedules', 'backup-retention', 'backups', 'properties-backups', 'world-imports', 'addon-staging', 'addon-trash']) {
    for (const suffix of [id, `${id}.json`]) {
      try { await lstat(path.join(context.root, name, suffix)); throw blocked(); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
  }
  // These bounded stores use random entry IDs, not server IDs in their paths.
  for (const namespace of ['world-imports', 'addon-uploads', 'world-import-discard-owners']) {
    const directory = path.join(context.root, namespace);
    try { await lstat(directory); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue; throw error; }
    await backupDirectoryIdentity(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > 128) throw blocked();
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw blocked();
      const ownerFile = namespace === 'world-import-discard-owners'
        ? path.join(directory, entry.name) : path.join(directory, entry.name, 'owner.json');
      if (namespace !== 'world-import-discard-owners') await backupDirectoryIdentity(path.join(directory, entry.name));
      const file = await readPrivatePropertiesFile(ownerFile, 128 * 1024);
      const owner: unknown = JSON.parse(file.bytes.toString('utf8')); file.bytes.fill(0);
      if (!owner || typeof owner !== 'object' || !('serverId' in owner) || typeof owner.serverId !== 'string' || owner.serverId === id) throw blocked();
    }
  }
  const adapter = new LocalJavaAdapter(registration, await context.factory.create(registration.plan));
  let published = false, detachState: (() => void) | undefined, detachStream: (() => void) | undefined;
  try {
    if (adapter.plan.serverInfo.type === 'vanilla' && !context.active) throw blocked();
    detachState = await context.active?.register(adapter);
    authorize();
    if (context.closing() || context.registry.get(id)) throw blocked();
    // No await between the two publications: HTTP/WS cannot observe a half-published ID.
    detachStream = context.streams.add(adapter); context.registry.add(adapter); published = true;
  } finally { if (!published) { detachStream?.(); detachState?.(); await adapter.closeObserver(); } }
}
