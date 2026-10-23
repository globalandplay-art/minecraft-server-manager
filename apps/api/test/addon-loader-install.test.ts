import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import type { LocalMinecraftServerAdapter } from '../src/adapters/contract.js';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { AddonInstallService } from '../src/services/addon-install-service.js';
import { AddonUploadService } from '../src/services/addon-upload-service.js';
import { AddonInventory } from '../src/services/addon-inventory.js';
import { BackupService } from '../src/services/backup-service.js';
import { TransactionJournalStore } from '../src/services/transaction-journal.js';
import { OperationService } from '../src/services/operation-service.js';
import { MemoryOperationStore } from '../src/services/operation-store.js';
import { backupDirectoryIdentity } from '../src/services/backup-identity.js';
import { addonZip } from './helpers/addon-zip.js';
const roots: string[] = [], loaders = ['forge', 'neoforge'] as const;
const clock = { now: () => new Date('2026-10-23T15:00:00.000Z') };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const raw = 'modLoader="javafml"\n[[mods]]\nmodId="incoming_mod"\nversion="${file.jarVersion}"\n';
async function fixture(type: typeof loaders[number], inject?: (point: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-loader-install-')); roots.push(root);
  const serverRoot = path.join(root, 'server'), managerRoot = path.join(root, 'manager');
  for (const relative of ['', 'mods', 'disabled-mods', 'libraries', 'world']) await mkdir(path.join(serverRoot, relative), { recursive: true });
  await mkdir(managerRoot);
  await writeFile(path.join(serverRoot, 'server.properties'), 'level-name=world\n'); await writeFile(path.join(serverRoot, 'eula.txt'), 'eula=false\n');
  await writeFile(path.join(serverRoot, 'world/marker'), 'unchanged world'); await writeFile(path.join(serverRoot, 'libraries/dependency.jar'), 'bound dependency');
  const jarPath = path.join(serverRoot, type === 'neoforge' ? 'run.bat' : 'forge.jar'); await writeFile(jarPath, 'inert descriptor');
  const adapter = { mode: 'local', serverId: 'test', plan: { rootPath: serverRoot, jarPath, serverInfo: { type, minecraftVersion: '26.3' } },
    getStatus: async () => ({ state: 'stopped', ownership: 'none', recoveryRequired: false, activeOperationId: null }) } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), journal = new TransactionJournalStore(managerRoot); await journal.initialize();
  const store = new MemoryOperationStore(), operations = new OperationService(store, clock, journal); await operations.initialize();
  const identity = { schemaVersion: 1 as const, serverId: 'test', serverType: type, minecraftVersion: '26.3', javaMajor: 25, requiredJavaMajor: 25,
    rootIdentity: await backupDirectoryIdentity(serverRoot), addonRootIdentity: await backupDirectoryIdentity(path.join(serverRoot, 'mods')),
    disabledAddonRootIdentity: await backupDirectoryIdentity(path.join(serverRoot, 'disabled-mods')), launchJarIdentity: 'a'.repeat(64),
    launchJarSha256: 'b'.repeat(64), executionBindingSha256: 'c'.repeat(64), launchPlanSha256: 'd'.repeat(64), identitySha256: 'e'.repeat(64) };
  Object.assign(adapter, { getRegisteredExecutionIdentity: () => ({ rootIdentity: identity.rootIdentity,
    launcherIdentity: identity.launchJarIdentity, launcherSha256: identity.launchJarSha256, javaIdentity: 'f'.repeat(64),
    javaSha256: '1'.repeat(64), fabricExecutionSha256: null, ...(type === 'neoforge' ? { neoforgeExecutionSha256: identity.executionBindingSha256 } : {}) }) });
  const capture = vi.fn(async () => identity), uploads = new AddonUploadService(registry, operations, managerRoot, clock, capture);
  const bytes = addonZip(type === 'forge' ? 'META-INF/mods.toml' : 'META-INF/neoforge.mods.toml', raw);
  const upload = await uploads.upload('test', 'incoming.jar', Readable.from([bytes]));
  const inventory = new AddonInventory(), backups = new BackupService(registry, operations, journal, managerRoot, clock);
  const service = new AddonInstallService(registry, operations, journal, backups, uploads, inventory, managerRoot, clock, inject, capture);
  const listing = await inventory.read('test', serverRoot, type);
  const request = { uploadId: upload.id, uploadRevision: upload.revision, inventoryRevision: listing.revision, confirmUnknownCompatibility: true as const };
  return { root, serverRoot, managerRoot, adapter, registry, journal, store, operations, identity, capture, uploads, upload, bytes, inventory, backups, service, request };
}
async function settle(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  await vi.waitFor(() => expect(f.operations.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u)); return f.operations.get(id)!;
}
it.each(loaders)('%s installs exactly one validated JAR behind a complete pinned guard, without starting Minecraft', async type => {
  const f = await fixture(type), key = randomUUID(), operation = await f.service.install('test', f.request, key);
  expect((await settle(f, operation.id)).state).toBe('succeeded'); expect(await readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).toEqual(f.bytes);
  const record = (await f.journal.scan()).records.find(record => record.intent.addonInstall)!;
  expect(record.intent.addonInstall?.confirmUnknownCompatibility).toBe(true); expect(record.state).toBe('committed');
  const guard = await f.backups.privateSnapshot('test', record.intent.addonInstall!.guardBackupId);
  expect(guard.pinned).toBe(true); expect(guard.includedRoots).toEqual(expect.arrayContaining(['libraries', 'mods', 'disabled-mods', 'world', path.basename(f.adapter.plan.jarPath)]));
  expect(guard.files.map(file => file.path)).toEqual(expect.arrayContaining(['libraries/dependency.jar', 'world/marker']));
  expect(await f.uploads.verifyConsumed('test', f.upload.id, f.upload.revision, 'mod', operation.id)).toBe(true);
  expect((await f.service.install('test', f.request, key)).id).toBe(operation.id);
  await expect(f.service.install('test', { ...f.request, confirmUnknownCompatibility: undefined } as typeof f.request, key)).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
  expect(await readFile(path.join(f.serverRoot, 'world/marker'), 'utf8')).toBe('unchanged world');
});
it.each(loaders)('%s refuses missing unknown-compatibility consent before operation or backup creation', async type => {
  const f = await fixture(type), { confirmUnknownCompatibility: _ignored, ...request } = f.request; void _ignored;
  await expect(f.service.install('test', request, randomUUID())).rejects.toMatchObject({ code: 'ADDON_COMPATIBILITY_CONFIRMATION_REQUIRED' });
  expect((await f.journal.scan()).records).toHaveLength(0); expect(await readdir(path.join(f.serverRoot, 'mods'))).toEqual([]);
});
it.each(loaders)('%s refuses a duplicate declared ID in disabled mods without creating a protection snapshot', async type => {
  const f = await fixture(type);
  await writeFile(path.join(f.serverRoot, 'disabled-mods/old.jar'), f.bytes);
  const list = await f.inventory.read('test', f.serverRoot, type);
  await expect(f.service.install('test', { ...f.request, inventoryRevision: list.revision }, randomUUID())).rejects.toMatchObject({ code: 'ADDON_MOD_ID_CONFLICT' });
  expect((await f.journal.scan()).records).toHaveLength(0);
});
it.each(['staging-validated', 'target-installed', 'committed'] as const)('preserves new-loader failure evidence at %s and only observes on restart', async point => {
  let fired = false; const f = await fixture('neoforge', async reached => { if (point === reached && !fired) { fired = true; throw new Error('controlled interruption'); } });
  const operation = await f.service.install('test', f.request, randomUUID()); await settle(f, operation.id);
  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(f.store, clock, journal);
  const service = new AddonInstallService(f.registry, operations, journal, new BackupService(f.registry, operations, journal, f.managerRoot, clock),
    f.uploads, f.inventory, f.managerRoot, clock, undefined, f.capture);
  await service.reconcileStartup(); await operations.initialize();
  expect(operations.getServerState('test').recoveryRequired).toBe(point === 'target-installed');
  expect(operations.get(operation.id)?.state).toBe(point === 'committed' ? 'succeeded' : point === 'target-installed' ? 'interrupted' : 'failed');
  if (point === 'staging-validated') await expect(readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).rejects.toMatchObject({ code: 'ENOENT' });
  else expect(await readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).toEqual(f.bytes);
});
it('refuses late identity drift before installation, retaining the guard and recovery gate', async () => {
  const f = await fixture('forge', async point => { if (point === 'staging-validated') f.capture.mockImplementation(async () => ({ ...f.identity, launchPlanSha256: '0'.repeat(64), identitySha256: 'f'.repeat(64) })); });
  const op = await f.service.install('test', f.request, randomUUID()); expect((await settle(f, op.id)).state).toBe('interrupted');
  expect(f.operations.getServerState('test').recoveryRequired).toBe(true);
  await expect(readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await f.backups.list('test'))[0]?.pinned).toBe(true);
});
it('reacquires source identity after the guard instead of reusing pre-backup proof', async () => {
  const f = await fixture('neoforge');
  const create = f.backups.createAddonProtectionSnapshot.bind(f.backups);
  vi.spyOn(f.backups, 'createAddonProtectionSnapshot').mockImplementation(async (...args) => {
    const guard = await create(...args);
    f.capture.mockResolvedValue({ ...f.identity, executionBindingSha256: '0'.repeat(64), identitySha256: 'f'.repeat(64) });
    return guard;
  });
  const operation = await f.service.install('test', f.request, randomUUID());
  expect((await settle(f, operation.id)).state).toBe('failed');
  await expect(readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await f.journal.scan()).records.some(record => record.intent.addonInstall)).toBe(false);
  expect((await f.backups.list('test'))[0]?.pinned).toBe(true);
});
it.each(['inactive', 'wrong-operation', 'recovery', 'abort'] as const)('new-loader install refuses %s before publishing prepared content', async mode => {
  let drift = false, armed = false;
  const controller = new AbortController();
  const f = await fixture('neoforge', async point => {
    if (point === 'staging-validated') armed = true;
  });
  f.capture.mockImplementation(async () => {
    await Promise.resolve();
    if (armed) { drift = true; if (mode === 'abort') controller.abort(); }
    return f.identity;
  });
  const originalGet = f.operations.get.bind(f.operations), originalState = f.operations.getServerState.bind(f.operations);
  if (mode === 'inactive') vi.spyOn(f.operations, 'get').mockImplementation(id => {
    const op = originalGet(id); return drift && op?.state === 'running' ? { ...op, state: 'queued' } : op;
  });
  if (mode === 'wrong-operation') vi.spyOn(f.operations, 'getServerState').mockImplementation(id => {
    const state = originalState(id); return drift ? { ...state, activeOperationId: '00000000-0000-4000-8000-000000000000' } : state;
  });
  if (mode === 'recovery') {
    const status = f.adapter.getStatus.bind(f.adapter);
    vi.spyOn(f.adapter, 'getStatus').mockImplementation(async () => { const current = await status(); return drift ? { ...current, recoveryRequired: true } : current; });
  }
  if (mode === 'abort') {
    const request = f.operations.requestBackup.bind(f.operations);
    vi.spyOn(f.operations, 'requestBackup').mockImplementation((id, key, body, run, ...rest) =>
      request(id, key, body, ctx => run({ ...ctx, signal: controller.signal }), ...rest));
  }
  const operation = await f.service.install('test', f.request, randomUUID());
  expect((await settle(f, operation.id)).state).toBe('interrupted');
  vi.restoreAllMocks();
  expect(f.operations.getServerState('test').recoveryRequired).toBe(true);
  await expect(readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).rejects.toMatchObject({ code: 'ENOENT' });
  const record = (await f.journal.scan()).records.find(record => record.intent.addonInstall)!;
  expect(record.state).toBe('recovery-required'); expect(record.checkpoints.some(point => point.name === 'committed')).toBe(false);
});
it.each([false, true])('disposes the execution scope after completion or interruption=%s', async interrupted => {
  const f = await fixture('neoforge', async point => { if (interrupted && point === 'staging-validated') throw new Error('controlled interruption'); });
  const validated = f.uploads.validatedSource.bind(f.uploads);
  let dispose: ReturnType<typeof vi.fn> | undefined;
  vi.spyOn(f.uploads, 'validatedSource').mockImplementation(async (...args) => {
    if (args[4] && !dispose) dispose = vi.spyOn(args[4], 'dispose');
    return validated(...args);
  });
  const operation = await f.service.install('test', f.request, randomUUID());
  expect((await settle(f, operation.id)).state).toBe(interrupted ? 'interrupted' : 'succeeded');
  expect(dispose).toHaveBeenCalledTimes(1);
});
it('keeps a formerly succeeded install gated when its committed identity drifts on restart', async () => {
  const f = await fixture('neoforge'), operation = await f.service.install('test', f.request, randomUUID());
  expect((await settle(f, operation.id)).state).toBe('succeeded');
  f.capture.mockResolvedValue({ ...f.identity, disabledAddonRootIdentity: '0'.repeat(64), identitySha256: 'f'.repeat(64) });
  const journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
  const operations = new OperationService(f.store, clock, journal);
  const service = new AddonInstallService(f.registry, operations, journal, new BackupService(f.registry, operations, journal, f.managerRoot, clock),
    f.uploads, f.inventory, f.managerRoot, clock, undefined, f.capture);
  await service.reconcileStartup(); await operations.initialize();
  expect(operations.getServerState('test').recoveryRequired).toBe(true);
  expect(await readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).toEqual(f.bytes);
});
it.each(loaders.flatMap(loader => (['paper', 'fabric', null] as const).map(replacement => ({ loader, replacement }))))(
  'retains $loader committed recovery verification after registration changes to $replacement', async ({ loader, replacement }) => {
    const f = await fixture(loader), operation = await f.service.install('test', f.request, randomUUID());
    expect((await settle(f, operation.id)).state).toBe('succeeded');
    const originalJournal = await f.journal.scan();
    const adapters = replacement === null ? [] : [{ ...f.adapter, plan: { ...f.adapter.plan,
      serverInfo: { ...f.adapter.plan.serverInfo, type: replacement } } } as LocalMinecraftServerAdapter];
    const registry = new AdapterRegistry(adapters), journal = new TransactionJournalStore(f.managerRoot); await journal.initialize();
    const operations = new OperationService(f.store, clock, journal);
    const capture = vi.fn(async () => ({ ...f.identity, identitySha256: 'f'.repeat(64) }));
    const service = new AddonInstallService(registry, operations, journal, new BackupService(registry, operations, journal, f.managerRoot, clock),
      f.uploads, f.inventory, f.managerRoot, clock, undefined, capture);
    await service.reconcileStartup(); await operations.initialize();
    expect(operations.getServerState('test').recoveryRequired).toBe(true);
    expect(capture).toHaveBeenCalledTimes(replacement === null ? 0 : 1);
    expect(operations.get(operation.id)).toMatchObject({ id: operation.id, state: 'interrupted', step: 'physical-recovery-required',
      error: { code: 'RECOVERY_REQUIRED' } });
    expect((await f.journal.scan()).records).toEqual(originalJournal.records);
    expect(await readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).toEqual(f.bytes);
  });
it('refuses identity drift after target publication but before consumption/commit', async () => {
  const f = await fixture('forge', async point => { if (point === 'before-commit') f.capture.mockResolvedValue({ ...f.identity,
    launchPlanSha256: '0'.repeat(64), identitySha256: 'f'.repeat(64) }); });
  const operation = await f.service.install('test', f.request, randomUUID()); expect((await settle(f, operation.id)).state).toBe('interrupted');
  const record = (await f.journal.scan()).records.find(record => record.intent.addonInstall)!;
  expect(record.state).toBe('recovery-required'); expect(record.checkpoints.some(point => point.name === 'committed')).toBe(false);
  expect(await readdir(path.join(f.managerRoot, 'addon-uploads', f.upload.id))).not.toContain('consumed.json');
  expect(await readFile(path.join(f.serverRoot, 'mods/incoming.jar'))).toEqual(f.bytes);
});
