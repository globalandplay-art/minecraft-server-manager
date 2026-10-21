import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, rename, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ServerRegistrationService } from '../src/services/server-registration-service.js';
import { validateRegistration, loadLocalRegistrations } from '../src/config/local-config.js';
import { LocalJavaAdapter } from '../src/adapters/local.js';
import { LocalRuntimeFactory } from '../src/infra/runtime/index.js';
import { buildApp } from '../src/app.js';
import { launchZip } from './helpers/launch-zip.js';
const roots: string[] = [];
const apps: ReturnType<typeof buildApp>[] = [];
const adapters: LocalJavaAdapter[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const adapter of adapters.splice(0)) await adapter.closeObserver();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-m1-')); roots.push(root);
  const manager = path.join(root, 'manager'), first = path.join(root, 'first'), second = path.join(root, 'second');
  for (const dir of [manager, first, second]) await mkdir(dir);
  for (const dir of [first, second]) {
    await writeFile(path.join(dir, 'server.jar'), launchZip({ 'META-INF/MANIFEST.MF': 'Main-Class: net.minecraft.bundler.Main\n',
      'version.json': JSON.stringify({ id: '26.3', java_version: 25 }) }));
    await writeFile(path.join(dir, 'eula.txt'), 'eula=false\n');
    await writeFile(path.join(dir, 'server.properties'), 'server-ip=127.0.0.1\nserver-port=25565\nenable-rcon=false\n');
  }
  const original = { id: 'first', name: 'First', root: first, javaExecutable: process.execPath, jarFile: 'server.jar', jvmArgs: ['-Xms512M', '-Xmx1G'], serverArgs: ['nogui'] };
  const config = path.join(manager, 'config.json'); await writeFile(config, JSON.stringify({ schemaVersion: 1, servers: [original] }));
  const registration = await validateRegistration(original);
  const adapter = new LocalJavaAdapter(registration, await new LocalRuntimeFactory().create(registration.plan));
  adapters.push(adapter);
  const service = new ServerRegistrationService(manager, [adapter]);
  const draft = { id: 'second', name: 'Second', root: second, jarFile: 'server.jar', javaProfileId: 'first' };
  return { root, manager, first, second, original, config, adapter, service, draft };
}
it('checks without writes; saves both instances; a new Manager loads the added registration without launching', async () => {
  const f = await fixture(), before = await readFile(f.config);
  const preview = await f.service.preview(f.draft, () => {});
  expect(preview).toMatchObject({ server: { id: 'second', type: 'vanilla', minecraftVersion: '26.3' }, eulaAccepted: false, restartRequired: true });
  expect(await readFile(f.config)).toEqual(before); expect(await readdir(f.second)).toEqual(['eula.txt', 'server.jar', 'server.properties']);
  expect(await f.service.save(preview.token, () => {})).toEqual({ id: 'second', name: 'Second', restartRequired: true, loaded: false, loadErrorCode: null });
  expect(JSON.parse(await readFile(f.config, 'utf8')).servers[0]).toEqual(f.original);
  expect(await f.service.catalog()).toMatchObject({ pending: [{ id: 'second', name: 'Second' }] });
  const reopened = await loadLocalRegistrations(f.manager); expect(reopened.map(row => row.plan.id)).toEqual(['first', 'second']);
  expect(await f.adapter.getStatus()).toMatchObject({ ownership: 'none' });
  const backup = (await readdir(f.manager)).find(name => name.endsWith('.backup'))!;
  expect(await readFile(path.join(f.manager, backup))).toEqual(before);
  expect(await readdir(f.second)).toEqual(['eula.txt', 'server.jar', 'server.properties']);
});
it.each(['duplicate-id', 'same-root', 'nested-root', 'manager-root', 'jar-path', 'unknown-profile'])(
  'rejects %s with no config write', async mode => {
    const f = await fixture(), before = await readFile(f.config);
    const draft = { ...f.draft };
    if (mode === 'duplicate-id') draft.id = 'first';
    if (mode === 'same-root') draft.root = f.first;
    if (mode === 'nested-root') draft.root = path.join(f.first, 'child');
    if (mode === 'manager-root') draft.root = f.manager;
    if (mode === 'jar-path') draft.jarFile = '../server.jar';
    if (mode === 'unknown-profile') draft.javaProfileId = 'missing';
    await expect(f.service.preview(draft, () => {})).rejects.toThrow();
    expect(await readFile(f.config)).toEqual(before);
  });
it.each(['config-content', 'config-identity', 'target-properties', 'target-jar'])(
  'refuses drift of %s between preview and save', async mode => {
    const f = await fixture(), preview = await f.service.preview(f.draft, () => {});
    if (mode === 'config-content') await writeFile(f.config, (await readFile(f.config, 'utf8')) + '\n');
    if (mode === 'config-identity') { const stage = f.config + '.external'; await writeFile(stage, await readFile(f.config)); await rename(stage, f.config); }
    if (mode === 'target-properties') await writeFile(path.join(f.second, 'server.properties'), 'server-port=25566\n');
    if (mode === 'target-jar') await writeFile(path.join(f.second, 'server.jar'), launchZip({ 'version.json': '{"id":"26.4"}' }));
    const before = await readFile(f.config);
    await expect(f.service.save(preview.token, () => {})).rejects.toThrow();
    expect(await readFile(f.config)).toEqual(before);
  });
it('denies final authorization before publication, retaining the existing registry', async () => {
  const f = await fixture(), preview = await f.service.preview(f.draft, () => {}), before = await readFile(f.config);
  let calls = 0;
  await expect(f.service.save(preview.token, () => { if (++calls === 2) throw new Error('authorization-expired'); })).rejects.toThrow('authorization-expired');
  expect(await readFile(f.config)).toEqual(before);
});
it('does not follow a linked configuration file', async () => {
  const f = await fixture(), backup = f.config + '.linked'; await link(f.config, backup);
  await expect(f.service.preview(f.draft, () => {})).rejects.toThrow();
  expect(JSON.parse(await readFile(backup, 'utf8')).servers).toHaveLength(1);
});
it('serializes requests and does not permit reuse of a consumed preview', async () => {
  const f = await fixture();
  const checking = f.service.preview(f.draft, () => {});
  await expect(f.service.preview(f.draft, () => {})).rejects.toMatchObject({ code: 'REGISTRATION_BUSY' });
  const preview = await checking; await f.service.save(preview.token, () => {});
  await expect(f.service.save(preview.token, () => {})).rejects.toThrow();
  expect(JSON.parse(await readFile(f.config, 'utf8')).servers).toHaveLength(2);
});
it('HTTP enforces Origin/intent and strict input; restart-required does not expose a hot-loaded instance', async () => {
  const f = await fixture(), app = buildApp({ adapters: [f.adapter], mode: 'local', managerRoot: f.manager }); apps.push(app);
  const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
  expect((await app.inject({ method: 'POST', url: '/api/v1/server-registrations/preflight', headers: { host: headers.host }, payload: f.draft })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/v1/server-registrations/preflight', headers, payload: { ...f.draft, javaExecutable: 'attacker.exe' } })).statusCode).toBe(400);
  const preflight = await app.inject({ method: 'POST', url: '/api/v1/server-registrations/preflight', headers, payload: f.draft });
  expect(preflight.statusCode).toBe(200);
  const saved = await app.inject({ method: 'POST', url: '/api/v1/server-registrations', headers, payload: { token: preflight.json().data.token, confirm: true } });
  expect(saved.statusCode).toBe(201); expect(saved.json().data.restartRequired).toBe(true);
  expect((await app.inject({ method: 'GET', url: '/api/v1/servers', headers })).json().data.items).toHaveLength(1);
  expect((await app.inject({ method: 'GET', url: '/api/v1/server-registrations', headers })).json().data.pending).toEqual([{ id: 'second', name: 'Second' }]);
});
