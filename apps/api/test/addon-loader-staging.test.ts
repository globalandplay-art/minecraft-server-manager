import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import type { LocalMinecraftServerAdapter } from '../src/adapters/contract.js';
import type { AddonAdapterIdentity } from '../src/services/addon-adapter-identity.js';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { OperationService } from '../src/services/operation-service.js';
import { MemoryOperationStore } from '../src/services/operation-store.js';
import { AddonUploadService } from '../src/services/addon-upload-service.js';
import { backupDirectoryIdentity } from '../src/services/backup-identity.js';
import { registerAddonUploadRoutes } from '../src/routes/addons.js';
import { installLocalRequestGuard, errorResponse } from '../src/infra/http.js';
import { parseAddonUploadMetadata } from '../src/services/addon-upload-metadata.js';
import { addonZip } from './helpers/addon-zip.js';
import { DomainError } from '../src/services/domain-errors.js';

const roots: string[] = [];
const loaders = ['forge', 'neoforge'] as const;
const clock = { now: () => new Date('2026-10-23T07:30:00.000Z') };
const declaration = 'modLoader="javafml"\nloaderVersion="[1,)"\n[[mods]]\nmodId="sample_mod"\ndisplayName="示例模组"\nversion="${file.jarVersion}"\n[[mods]]\nmodId="second_mod"\nversion="2.0"\n';
const descriptor = (type: typeof loaders[number]) => type === 'forge' ? 'META-INF/mods.toml' : 'META-INF/neoforge.mods.toml';
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(type: typeof loaders[number]) {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-mod-stage-')); roots.push(root);
  const serverRoot = path.join(root, 'server'), managerRoot = path.join(root, 'manager');
  await mkdir(serverRoot); await mkdir(managerRoot); await mkdir(path.join(serverRoot, 'mods'));
  await writeFile(path.join(serverRoot, 'mods', 'keep.jar'), 'unchanged marker');
  const identity: AddonAdapterIdentity = { schemaVersion: 1, serverId: 'test', serverType: type, minecraftVersion: '26.3',
    javaMajor: 25, requiredJavaMajor: 25, rootIdentity: await backupDirectoryIdentity(serverRoot),
    addonRootIdentity: await backupDirectoryIdentity(path.join(serverRoot, 'mods')), launchJarIdentity: 'b'.repeat(64),
    launchJarSha256: 'c'.repeat(64), executionBindingSha256: 'd'.repeat(64), identitySha256: 'e'.repeat(64) };
  const adapter = { mode: 'local', serverId: 'test', plan: { rootPath: serverRoot, serverInfo: { type, minecraftVersion: '26.3' } },
    getStatus: async () => ({ state: 'stopped', ownership: 'none', recoveryRequired: false, activeOperationId: null }) } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]), operations = new OperationService(new MemoryOperationStore(), clock);
  await operations.initialize(); const capture = vi.fn(async () => identity);
  const createService = () => new AddonUploadService(registry, operations, managerRoot, clock, capture);
  return { serverRoot, managerRoot, registry, operations, capture, identity, createService, service: createService() };
}
it.each(loaders)('%s stages multiple declarations without installing, resolving versions or changing server files', async type => {
  const f = await fixture(type), bytes = addonZip(descriptor(type), declaration);
  const result = await f.service.upload('test', 'multiple.jar', Readable.from([bytes]));
  expect(result).toMatchObject({ loader: type, kind: 'mod', name: null, version: null, compatibility: 'unknown', executionAvailable: false,
    declaredMetadata: { mods: [{ id: 'sample_mod', version: '${file.jarVersion}', versionStatus: 'unresolved' }, { id: 'second_mod', version: '2.0' }] } });
  expect(JSON.stringify(result)).not.toContain(f.serverRoot); expect(JSON.stringify(result)).not.toContain('executionBindingSha256');
  const staged = await f.service.validatedSource('test', result.id, result.revision, 'mod');
  expect(await readFile(staged.filePath)).toEqual(bytes);
  expect((await f.createService().validatedSource('test', result.id, result.revision, 'mod')).validated.metadata).toEqual(staged.validated.metadata);
  await expect(f.service.markConsumed('test', result.id, result.revision, 'mod', randomUUID())).rejects.toMatchObject({ code: 'ADDON_STAGING_UNSAFE' });
  expect(await f.service.verifyConsumed('test', result.id, result.revision, 'mod', randomUUID())).toBe(false);
  expect(await readdir(staged.directory)).not.toContain('consumed.json');
  expect(await readdir(path.join(f.serverRoot, 'mods'))).toEqual(['keep.jar']);
  expect(await readFile(path.join(f.serverRoot, 'mods', 'keep.jar'), 'utf8')).toBe('unchanged marker');
  const saved = await readFile(path.join(staged.directory, 'validated.json')); expect(saved.length).toBeLessThanOrEqual(128 * 1024);
});
it.each(loaders)('%s refuses cross-loader and malformed declarations, retaining failed evidence', async type => {
  const f = await fixture(type);
  for (const bytes of [addonZip(descriptor(type === 'forge' ? 'neoforge' : 'forge'), declaration), addonZip(descriptor(type), 'not = valid = toml')]) {
    await expect(f.service.upload('test', `${randomUUID()}.jar`, Readable.from([bytes]))).rejects.toMatchObject({ code: 'ADDON_METADATA_INVALID' });
  }
  for (const id of await readdir(path.join(f.managerRoot, 'addon-uploads'))) {
    expect(JSON.parse(await readFile(path.join(f.managerRoot, 'addon-uploads', id, 'lifecycle.json'), 'utf8')).state).toBe('failed');
  }
});
it('returns only the freshly checked identity and reacquires it on every validation', async () => {
  const f = await fixture('neoforge');
  const uploaded = await f.service.upload('test', 'sample.jar', Readable.from([addonZip(descriptor('neoforge'), declaration)]));
  const fresh = { ...f.identity };
  f.capture.mockResolvedValueOnce(fresh);
  const source = await f.service.validatedSource('test', uploaded.id, uploaded.revision, 'mod');
  expect(source.liveIdentity).toBe(fresh);
  expect(source.liveIdentity).not.toBe(source.validated.adapterIdentity);
  f.capture.mockResolvedValueOnce({ ...f.identity, executionBindingSha256: '0'.repeat(64) });
  await expect(f.service.validatedSource('test', uploaded.id, uploaded.revision, 'mod')).rejects.toMatchObject({ code: 'ADDON_STAGING_UNSAFE' });
});
it.each(loaders)('%s reparses the complete declaration instead of trusting a recomputed receipt hash', async type => {
  const f = await fixture(type), result = await f.service.upload('test', 'sample.jar', Readable.from([addonZip(descriptor(type), declaration)]));
  const file = path.join(f.managerRoot, 'addon-uploads', result.id, 'validated.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.metadata.declaredMetadata.mods[1].dependencies.push({ id: 'minecraft', versionRange: '[99,)', requirement: 'required', side: 'SERVER' });
  const { revision: _old, ...body } = saved; void _old;
  saved.revision = createHash('sha256').update(JSON.stringify(body)).digest('hex'); await writeFile(file, JSON.stringify(saved));
  await expect(f.service.validatedSource('test', result.id, saved.revision, 'mod')).rejects.toMatchObject({ code: 'ADDON_STAGING_UNSAFE' });
});
it.each(loaders)('%s refuses payload drift, identity drift, cross-instance access and plugin-kind reuse', async type => {
  const f = await fixture(type), result = await f.service.upload('test', 'sample.jar', Readable.from([addonZip(descriptor(type), declaration)]));
  await expect(f.service.validatedSource('other', result.id, result.revision, 'mod')).rejects.toMatchObject({ code: 'SERVER_NOT_FOUND' });
  await expect(f.service.validatedSource('test', result.id, result.revision, 'plugin')).rejects.toMatchObject({ code: 'ADDON_STAGING_UNSAFE' });
  f.capture.mockResolvedValueOnce({ ...f.identity, executionBindingSha256: '0'.repeat(64) });
  await expect(f.service.validatedSource('test', result.id, result.revision, 'mod')).rejects.toMatchObject({ code: 'ADDON_STAGING_UNSAFE' });
  await writeFile(path.join(f.managerRoot, 'addon-uploads', result.id, 'payload.jar'), 'replacement');
  await expect(f.service.validatedSource('test', result.id, result.revision, 'mod')).rejects.toMatchObject({ code: 'ADDON_STAGING_UNSAFE' });
});
it('rejects declarations above the private metadata budget without expanding the JSON reader limit', () => {
  let raw = 'modLoader="javafml"\n';
  for (let owner = 0; owner < 8; owner++) {
    raw += `[[mods]]\nmodId="owner_${owner}"\n`;
    for (let dep = 0; dep < 64; dep++) raw += `[[dependencies.owner_${owner}]]\nmodId="dep_${dep}"\nversionRange="${'1'.repeat(120)}"\n`;
  }
  expect(Buffer.byteLength(raw)).toBeLessThan(256 * 1024);
  expect(parseAddonUploadMetadata(new Map([[descriptor('neoforge'), Buffer.from(raw)]]), 'neoforge')).toBeNull();
});
it('serializes staging through the real upload HTTP route and retains the local-origin guard', async () => {
  const f = await fixture('neoforge'), app = fastify(); app.addHook('onRequest', installLocalRequestGuard(clock, 'local'));
  app.setErrorHandler((error, request, reply) => {
    const domain = error instanceof DomainError ? error : new DomainError(400, 'VALIDATION_ERROR', 'invalid');
    void reply.code(domain.statusCode).send(errorResponse(request.id, clock, domain.code, domain.safeMessage, 'local', domain.reason));
  });
  registerAddonUploadRoutes(app, f.service, clock, 'local');
  const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui', 'x-upload-filename': 'test.jar', 'content-type': 'application/java-archive' };
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/servers/test/addons/uploads', headers, payload: addonZip(descriptor('neoforge'), declaration) });
    expect(response.statusCode).toBe(201); expect(response.json().data).toMatchObject({ loader: 'neoforge', version: null, compatibility: 'unknown', executionAvailable: false });
    expect(response.body).not.toContain(f.managerRoot);
    expect((await app.inject({ method: 'POST', url: '/api/v1/servers/test/addons/uploads', headers: { ...headers, origin: 'https://evil.invalid' }, payload: Buffer.from('invalid') })).statusCode).toBe(403);
    expect(await readdir(path.join(f.managerRoot, 'addon-uploads'))).toHaveLength(1);
  } finally { await app.close(); }
});
