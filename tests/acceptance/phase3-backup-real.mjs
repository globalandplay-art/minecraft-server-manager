// Opt-in only: node --import tsx tests/acceptance/phase3-backup-real.mjs
// Copies only the registered Vanilla JAR and already-accepted EULA; never its world.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { fromBuffer } from 'yauzl';
import { buildApp } from '../../apps/api/src/app.ts';
import { createLocalAdapters } from '../../apps/api/src/config/bootstrap.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';
import { LocalRuntimeFactory } from '../../apps/api/src/infra/runtime/index.ts';
import { JsonOperationStore } from '../../apps/api/src/services/operation-store.ts';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { ActiveWorldStateStore } from '../../apps/api/src/services/active-world-state-store.ts';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), checks: [], result: 'RUNNING' };
const runId = `p31-real-${randomUUID()}`;
const serverRoot = path.join(workspace, 'runtime', runId);
const managerRoot = path.join(workspace, '.manager', runId);
const id = 'p31-acceptance';
const base = `/api/v1/servers/${id}`;
const headers = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui' };
let app;
let adapters = [];
let vite;
let browser;
let secret;
const check = (name) => { report.checks.push(name); console.log(`PASS: ${name}`); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function sha(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function request(url, payload, key = randomUUID()) {
  const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
    headers: { ...headers, 'idempotency-key': key }, ...(payload === undefined ? {} : { payload }) });
  // Never print response bodies, since a failed assertion may contain private data.
  if (response.statusCode >= 300) {
    assert.fail(`API ${url.split('/').at(-1)} rejected (${response.statusCode}, ${response.json().error?.code})`);
  }
  return response;
}
async function operation(url, payload, key = randomUUID()) {
  const response = await request(url, payload, key);
  const accepted = response.json().data.operation;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const op = (await request(`/api/v1/operations/${accepted.id}`)).json().data;
    if (['succeeded', 'failed', 'interrupted'].includes(op.state)) {
      assert.equal(op.state, 'succeeded', `operation ${op.kind}: ${op.state} (${op.error?.code ?? 'no error'})`);
      report.operationIds ??= []; report.operationIds.push(op.id);
      return op;
    }
    await wait(300);
  }
  throw new Error('acceptance operation timeout');
}
async function status() { return (await request(base)).json().data.status; }
async function command(commandText) {
  await wait(3500); // Respect the production command rate limiter.
  const response = await request(base + '/commands', { command: commandText });
  assert.equal(response.json().data.transport, 'rcon', 'expected real RCON transport');
  assert(!response.body.includes(secret), 'secret appeared in command response');
  return response.json().data.output;
}
async function latestBackup(scope) {
  const items = (await request(base + '/backups')).json().data.items;
  return items.filter((item) => item.scope === scope).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}
async function verifyManifest(backup) {
  const directory = path.join(managerRoot, 'backups', id, backup.id);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.state, 'complete');
  for (const file of manifest.files) {
    assert(!file.path.split('/').includes('..'));
    assert.equal(await sha(path.join(directory, 'payload', ...file.path.split('/'))), file.sha256, 'manifest payload hash');
  }
  assert(manifest.files.some((entry) => /\/(?:DIM-1|dimensions\/minecraft\/the_nether)\/region\//u.test(entry.path)), 'missing saved Nether region');
  assert(manifest.files.some((entry) => /\/(?:DIM1|dimensions\/minecraft\/the_end)\/region\//u.test(entry.path)), 'missing saved End region');
  return manifest;
}
async function verifyZip(buffer, manifest) {
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry]));
  await new Promise((resolve, reject) => fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error || !zip) { reject(error ?? new Error('no ZIP')); return; }
    zip.on('error', reject);
    zip.on('end', () => { try { assert.equal(expected.size, 0, 'missing ZIP entries'); resolve(); } catch (failure) { reject(failure); } });
    zip.on('entry', (entry) => zip.openReadStream(entry, (failure, stream) => {
      if (failure || !stream) { reject(failure ?? new Error('no ZIP stream')); return; }
      void (async () => {
        const item = expected.get(entry.fileName); assert(item, 'unexpected ZIP entry'); expected.delete(entry.fileName);
        let bytes = 0; const hash = createHash('sha256');
        for await (const chunk of stream) { bytes += chunk.length; hash.update(chunk); }
        assert.equal(bytes, item.sizeBytes); assert.equal(hash.digest('hex'), item.sha256);
        zip.readEntry();
      })().catch(reject);
    })); zip.readEntry();
  }));
}

try {
  const sourceConfig = JSON.parse(await readFile(path.join(workspace, '.manager', 'config.json'), 'utf8'));
  const source = sourceConfig.servers.find((entry) => entry.id === 'vanilla-26-3');
  assert(source, 'registered Vanilla test JAR not found');
  const sourceJar = path.join(source.root, source.jarFile);
  const sourceEula = path.join(source.root, 'eula.txt');
  for (const file of [sourceJar, sourceEula]) {
    assert((await lstat(file)).isFile() && !(await lstat(file)).isSymbolicLink(), 'source must be a regular file');
    assert.equal((await realpath(file)).toLowerCase(), path.resolve(file).toLowerCase(), 'linked source rejected');
  }
  assert.equal(parseProperties(await readFile(sourceEula, 'utf8')).get('eula'), 'true', 'EULA must already be accepted; test never accepts it');
  const inputHashes = { jar: await sha(sourceJar), eula: await sha(sourceEula) };
  await mkdir(serverRoot, { recursive: true }); await mkdir(managerRoot, { recursive: true });
  await copyFile(sourceJar, path.join(serverRoot, 'server.jar'));
  await copyFile(sourceEula, path.join(serverRoot, 'eula.txt'));
  secret = randomBytes(32).toString('base64url');
  const ports = [await freePort(), await freePort()]; assert.notEqual(...ports);
  await writeFile(path.join(serverRoot, 'server.properties'), [
    'server-ip=127.0.0.1', `server-port=${ports[0]}`, 'enable-rcon=true', `rcon.port=${ports[1]}`,
    `rcon.password=${secret}`, 'level-name=p31-test', 'level-seed=12345', 'view-distance=2',
    'simulation-distance=2', 'spawn-protection=0', 'online-mode=true', 'max-players=2',
    'enable-query=false', 'management-server-enabled=false', 'sync-chunk-writes=true', ''
  ].join('\n'), { mode: 0o600 });
  await writeFile(path.join(managerRoot, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [{
    id, name: 'Isolated real P3.1 acceptance', root: serverRoot, javaExecutable: source.javaExecutable,
    jarFile: 'server.jar', jvmArgs: ['-Xms512M', '-Xmx1G'], serverArgs: ['nogui']
  }] }), { mode: 0o600 });
  report.runId = runId; report.inputJarSha256 = inputHashes.jar;
  adapters = await createLocalAdapters(managerRoot, new LocalRuntimeFactory());
  const journal = new TransactionJournalStore(managerRoot);
  app = buildApp({ adapters, mode: 'local', managerRoot, transactionJournal: journal, transactionRecovery: journal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
  await app.ready();
  const info = (await request(base)).json().data.server;
  assert.equal(info.type, 'vanilla'); assert.equal(info.minecraftVersion, '26.3');
  assert.match(info.java.runtimeVersion, /^25\./);
  report.minecraftVersion = info.minecraftVersion; report.javaVersion = info.java.runtimeVersion;
  check('isolated Vanilla 26.3 / Java 25, existing EULA retained');
  await operation(base + '/actions/start', {});
  assert.equal((await status()).ownership, 'managed'); check('real Minecraft started by manager');
  for (const dimension of ['minecraft:the_nether', 'minecraft:the_end']) {
    await command(`execute in ${dimension} run forceload add 0 0`);
    await wait(2000);
    await command(`execute in ${dimension} run setblock 0 80 0 minecraft:diamond_block`);
  }
  await command('forceload add 0 0'); await wait(1000);
  await command('setblock 0 80 0 minecraft:diamond_block');
  const forbidden = await app.inject({ method: 'POST', url: base + '/backups', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { scope: 'world-set', allowStop: false } });
  assert.equal(forbidden.statusCode, 409); assert.equal((await status()).state, 'running');
  check('running backup rejected without allowStop; server remains running');
  const key = randomUUID();
  const runningOperation = await operation(base + '/backups', { scope: 'world-set', allowStop: true, label: 'Real running acceptance' }, key);
  assert.equal((await status()).state, 'running'); assert.equal((await status()).recoveryRequired, false);
  const repeated = (await request(base + '/backups', { scope: 'world-set', allowStop: true, label: 'Real running acceptance' }, key)).json().data.operation;
  assert.equal(repeated.id, runningOperation.id);
  const backup = await latestBackup('world-set'); assert(backup.restarted);
  const manifest = await verifyManifest(backup);
  check('running backup stops, saves three dimensions, validates hashes, restarts, and same-key retry reuses operation');
  await operation(`${base}/backups/${backup.id}/exports`, {});
  const download = await request(`${base}/backups/${backup.id}/download`);
  assert.equal(download.headers['content-type'], 'application/zip');
  assert.equal(download.headers['cache-control'], 'no-store');
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  assert.equal(download.headers['content-disposition'], `attachment; filename="world-set-${backup.id}.zip"`);
  assert(!download.rawPayload.includes(Buffer.from(secret)), 'RCON secret in ZIP');
  await verifyZip(download.rawPayload, manifest);
  report.zipSha256 = createHash('sha256').update(download.rawPayload).digest('hex');
  assert.equal(download.headers['x-archive-sha256'], report.zipSha256);
  report.fileCount = manifest.fileCount; report.worldBytes = manifest.sizeBytes;
  check('real immutable backup downloads as independently parsed ZIP, hashes match, secret absent');
  await command('setblock 0 80 0 minecraft:gold_block');
  await operation(base + '/actions/stop', {});
  const region = manifest.files.find((entry) => /p31-test\/(?:dimensions\/minecraft\/overworld\/)?region\/r\.0\.0\.mca$/u.test(entry.path)); assert(region);
  assert.notEqual(await sha(path.join(serverRoot, ...region.path.split('/'))), region.sha256, 'live region must change');
  const repeatDownload = await request(`${base}/backups/${backup.id}/download`);
  assert.equal(createHash('sha256').update(repeatDownload.rawPayload).digest('hex'), report.zipSha256);
  await verifyManifest(backup);
  check('changing live test world leaves existing backup and downloaded ZIP unchanged');
  await operation(base + '/backups', { scope: 'world-set', allowStop: false, label: 'Real stopped acceptance' });
  assert.equal((await status()).state, 'stopped');
  const stoppedBackup = await latestBackup('world-set'); assert.equal(stoppedBackup.restarted, false);
  await verifyManifest(stoppedBackup);
  check('stopped backup stays stopped and all payload hashes match');
  await operation(base + '/backups', { scope: 'server-snapshot', allowStop: false, label: 'Private acceptance snapshot' });
  const snapshot = await latestBackup('server-snapshot');
  const denied = await app.inject({ method: 'POST', url: `${base}/backups/${snapshot.id}/exports`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(denied.statusCode, 403); assert.equal(denied.json().error.code, 'EXPORT_NOT_SUPPORTED');
  const deniedDownload = await app.inject({ url: `${base}/backups/${snapshot.id}/download`, headers }); assert.equal(deniedDownload.statusCode, 403);
  for (const endpoint of [base, base + '/backups', base + '/worlds', base + '/logs']) {
    assert(!(await request(endpoint)).body.includes(secret), 'private secret in public API');
  }
  check('private snapshot export and download rejected; public APIs do not expose RCON secret');
  await app.close(); app = undefined; adapters = [];
  adapters = await createLocalAdapters(managerRoot, new LocalRuntimeFactory());
  const restartedJournal = new TransactionJournalStore(managerRoot);
  app = buildApp({ adapters, mode: 'local', managerRoot, transactionJournal: restartedJournal, transactionRecovery: restartedJournal,
    operationStore: new JsonOperationStore(managerRoot), activeWorldState: new ActiveWorldStateStore(managerRoot, adapters) });
  await app.ready();
  assert.equal((await status()).state, 'stopped'); assert.equal((await status()).recoveryRequired, false);
  assert.equal((await request(base + '/backups')).json().data.items.length, 3);
  assert.equal((await request(`/api/v1/operations/${runningOperation.id}`)).json().data.state, 'succeeded');
  assert.equal(createHash('sha256').update((await request(`${base}/backups/${backup.id}/download`)).rawPayload).digest('hex'), report.zipSha256);
  check('manager restart retains backups, operation result and verified download without recovery gate');
  await app.listen({ host: '127.0.0.1', port: 8080 });
  vite = await createServer({ root: path.join(workspace, 'apps/web'), configFile: path.join(workspace, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 3000, strictPort: true }, logLevel: 'error' });
  await vite.listen(); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, acceptDownloads: true });
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:3000/backups?server=${id}`);
  const selected = page.locator('.backup-row').filter({ hasText: 'Real running acceptance' });
  const browserDownload = page.waitForEvent('download', { timeout: 60_000 });
  await selected.getByRole('button', { name: 'Download World Set' }).click();
  const browserFile = await browserDownload; assert.equal(await browserFile.failure(), null);
  const downloaded = await readFile(await browserFile.path());
  assert.equal(createHash('sha256').update(downloaded).digest('hex'), report.zipSha256);
  await verifyZip(downloaded, await verifyManifest(backup));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
  assert.deepEqual(pageErrors, []);
  await browser.close(); browser = undefined; await vite.close(); vite = undefined;
  await app.close(); app = undefined; adapters = [];
  report.finalStatus = 'stopped';
  check('real Vanilla backup and download completed from responsive browser UI at 360px');
  assert.equal(await sha(sourceJar), inputHashes.jar); assert.equal(await sha(sourceEula), inputHashes.eula);
  check('original server JAR and EULA unchanged; original world never opened');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  // Assertions print no expected/actual private values or raw server logs.
  report.error = String(error?.message ?? 'acceptance failed').replaceAll(secret ?? '\0', '<redacted>');
  console.error(`FAIL: ${report.error}`); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  for (const adapter of adapters) {
    if (adapter.plan.rootPath !== serverRoot) throw new Error('cleanup refuses non-test adapter');
    const current = await adapter.getStatus();
    if (current.ownership === 'managed' && current.state !== 'stopped') {
      console.log('Stopping only the isolated managed test process.');
      try { await adapter.stop({ operationId: randomUUID(), signal: new AbortController().signal, onStep: async () => ({}) }); }
      catch { report.cleanupError = 'Isolated test stop was not confirmed; retained files for manual inspection'; report.result = 'FAIL'; process.exitCode = 1; }
    }
  }
  if (adapters.length) report.finalStatus = (await adapters[0].getStatus()).state;
  if (app) await app.close();
  report.finishedAt = new Date().toISOString();
  await mkdir(managerRoot, { recursive: true });
  await writeFile(path.join(managerRoot, 'acceptance-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Evidence: .manager/${runId}/acceptance-report.json`);
}
