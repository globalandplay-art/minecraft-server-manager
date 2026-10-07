// Only called by the reviewed fresh-isolation harness. Probe sources merely log a marker.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { TransactionJournalStore } from '../../apps/api/src/services/transaction-journal.ts';
import { inventoryRestoreTree, restoreFilesChecksum, verifyRestoreTree } from '../../apps/api/src/services/restore-files.ts';
import { backupDirectoryIdentity } from '../../apps/api/src/services/backup-identity.ts';
import { readPrivatePropertiesFile } from '../../apps/api/src/services/properties-private-file.ts';
import { assertJavaEnvironment } from '../../apps/api/src/services/trusted-lifecycle.ts';

// Complete stopped-server snapshot; the world-only helper requires level.dat at its root.
export async function inventoryAcceptanceTree(root, plain) {
  const files = []; let entries = 0;
  async function visit(directory, prefix = '') {
    await plain(directory, true);
    for (const name of await readdir(directory)) {
      assert(++entries <= 100000 && !/[\\:\u0000-\u001f]/u.test(name));
      const file = path.join(directory, name), relative = prefix + name;
      const stat = await lstat(file); await plain(file, stat.isDirectory());
      if (stat.isDirectory()) await visit(file, relative + '/');
      else {
        const contents = await readPrivatePropertiesFile(file, 64 * 1024 ** 2);
        files.push({ path: relative, sizeBytes: contents.bytes.length, sha256: contents.checksum });
      }
    }
  }
  await visit(root); return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function verifyNativeLoadProof(kind, native, expected) {
  assert(kind === 'paper' || kind === 'fabric');
  const text = native.replace(/\u001b\[[0-9;]*m|§[0-9a-fk-or]/giu, '');
  if (kind === 'paper') assert.match(text, /Plugins|Bukkit Plugins|Paper Plugins/u, 'Paper registry response missing');
  else assert.match(text, /Loading \d+ mods/u, 'Fabric native loader listing missing');
  const loaded = kind === 'paper' ? /\bP55Probe\b/u.test(text) : /(?:^|\n)[^\n]*- p55probe 1\.0\.0(?:\s|$)/u.test(text);
  assert.equal(loaded, expected, 'native current-session load proof mismatch');
  return { source: kind === 'paper' ? 'rcon-plugins' : 'fabric-loader-list', loaded,
    excerpt: kind === 'paper' ? text : text.split('\n').filter((line) => /Loading \d+ mods|p55probe/u.test(line)).join('\n') };
}

export async function buildProbe({ kind, runId, java, serverRoot, managerRoot, manifest, report, plain }) {
  const marker = `P55_PROBE_LOADED_${runId}`;
  const root = path.join(managerRoot, 'probe-build'); await mkdir(root); await plain(root, true);
  const classes = path.join(root, 'classes'), metadata = path.join(root, 'metadata'); await mkdir(classes); await mkdir(metadata);
  const name = kind === 'paper' ? 'PaperProbe' : 'FabricProbe';
  const source = kind === 'paper'
    ? `package p55; public final class PaperProbe extends org.bukkit.plugin.java.JavaPlugin { @Override public void onEnable() { getLogger().info("${marker}"); } }\n`
    : `package p55; public final class FabricProbe implements net.fabricmc.api.ModInitializer { @Override public void onInitialize() { System.out.println("${marker}"); } }\n`;
  const sourceFile = path.join(root, name + '.java'); await writeFile(sourceFile, source, { flag: 'wx' });
  const library = manifest.files.find((entry) => kind === 'paper' ? /\/paper-api\/[^/]+\/paper-api-[^/]+\.jar$/u.test(entry.target) : /\/fabric-loader\/0\.19\.5\/fabric-loader-0\.19\.5\.jar$/u.test(entry.target));
  assert(library, 'compiler API library absent from verified whitelist');
  const executable = (tool) => path.join(path.dirname(java), tool + '.exe');
  const toolHashes = {};
  for (const tool of ['javac', 'jar']) {
    await plain(executable(tool)); const file = await readPrivatePropertiesFile(executable(tool), 128 * 1024 ** 2); toolHashes[tool] = file.checksum;
  }
  const classpath = manifest.files.filter((entry) => entry.target.startsWith('libraries/') && entry.target.endsWith('.jar')).map((entry) => path.join(serverRoot, entry.target)).join(path.delimiter);
  const compileArguments = ['-proc:none', '--release', '25', '-encoding', 'UTF-8', '-classpath', classpath, '-d', classes, sourceFile];
  assertJavaEnvironment();
  const compiled = await promisify(execFile)(executable('javac'), compileArguments, { cwd: root, shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(compiled.stdout, ''); assert.equal(compiled.stderr, '');
  assert.deepEqual(await readdir(classes), ['p55']); assert.deepEqual(await readdir(path.join(classes, 'p55')), [name + '.class']); await plain(path.join(classes, 'p55', name + '.class'));
  const metadataName = kind === 'paper' ? 'plugin.yml' : 'fabric.mod.json';
  const descriptor = kind === 'paper' ? "name: P55Probe\nversion: '1.0.0'\nmain: p55.PaperProbe\napi-version: '26.2'\n"
    : JSON.stringify({ schemaVersion: 1, id: 'p55probe', version: '1.0.0', name: 'P55Probe', environment: 'server', entrypoints: { main: ['p55.FabricProbe'] }, depends: { fabricloader: '>=0.19.5', minecraft: '26.2', java: '>=25' } });
  await writeFile(path.join(metadata, metadataName), descriptor, { flag: 'wx' });
  const output = path.join(root, 'p55-probe.jar');
  assertJavaEnvironment();
  const packed = await promisify(execFile)(executable('jar'), ['--create', '--file', output, '-C', classes, '.', '-C', metadata, metadataName], { cwd: root, shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(packed.stdout, ''); assert.equal(packed.stderr, ''); await plain(output);
  const probe = await readPrivatePropertiesFile(output, 1024 * 1024);
  report.probe = { marker, sha256: probe.checksum, generatedLocally: true, source, metadata: descriptor, toolHashes, compilerArguments: compileArguments,
    annotationProcessing: false, networkUsed: false, thirdPartyAddonExecuted: false };
  return { bytes: probe.bytes, marker };
}

export async function addonFlow(context) {
  const { kind, runId, java, serverRoot, managerRoot, manifest, report, plain, request, operation, start, stop, command, closeApp, openApp, stopped, check, getApp, headers, base, setPhase } = context;
  const probe = await buildProbe({ kind, runId, java, serverRoot, managerRoot, manifest, report, plain });
  const launches = () => report.launches.length;
  async function launch(expected, label) {
    await start('generated-world', label);
    const last = report.launches.at(-1); const present = [last.stdout, last.stderr].join('\n').includes(probe.marker);
    assert.equal(present, expected, `${label}: real fresh-process addon marker mismatch`);
    const native = kind === 'paper' ? await command('plugins') : [last.stdout, last.stderr].join('\n');
    last.addonExpected = expected; last.addonMarkerPresent = present;
    last.nativeLoadProof = verifyNativeLoadProof(kind, native, expected);
    await stop();
  }
  async function mutate(url, payload, label) {
    setPhase(label); const key = randomUUID(), beforeLaunches = launches();
    const worldDirectories = (await readdir(serverRoot)).filter((name) => /^generated-world(?:_nether|_the_end)?$/u.test(name));
    const worlds = await Promise.all(worldDirectories.map(async (name) => [name, await inventoryRestoreTree(path.join(serverRoot, name))]));
    const beforeTree = await inventoryAcceptanceTree(serverRoot, plain), beforeRoots = (await readdir(serverRoot)).sort();
    const completed = await operation(url, payload, key); assert.equal(completed.kind, 'addon-change');
    assert.equal(completed.result?.restartRequired, true, 'addon mutation must require explicit restart');
    assert.equal(launches(), beforeLaunches, 'addon file operation started Java implicitly');
    for (const [name, tree] of worlds) await verifyRestoreTree(path.join(serverRoot, name), tree);
    const journal = await new TransactionJournalStore(managerRoot).scan(); assert.deepEqual(journal.issues, []);
    const record = journal.records.find((item) => item.intent.operationId === completed.id); assert.equal(record?.state, 'committed');
    const details = record.intent.addonInstall ?? record.intent.addonLifecycle;
    assert(details, 'operation missing addon transaction binding');
    assert.equal(details.rootIdentity, await backupDirectoryIdentity(serverRoot));
    assert.equal(details.kind, kind === 'paper' ? 'plugin' : 'mod');
    const guardRoot = path.join(managerRoot, 'backups', record.intent.serverId, details.guardBackupId);
    async function verifyTransaction() {
      await plain(guardRoot, true); await plain(path.join(guardRoot, 'manifest.json')); await plain(path.join(guardRoot, 'owner.json'));
      const guard = JSON.parse(await readFile(path.join(guardRoot, 'manifest.json'), 'utf8'));
      const owner = JSON.parse(await readFile(path.join(guardRoot, 'owner.json'), 'utf8'));
      assert.equal(owner.id, details.guardBackupId); assert.equal(owner.serverId, record.intent.serverId);
      assert.equal(owner.rootIdentity, details.rootIdentity);
      assert.equal(owner.directoryIdentity, await backupDirectoryIdentity(guardRoot));
      assert.equal(guard.id, details.guardBackupId); assert.equal(guard.serverId, record.intent.serverId);
      assert.equal(guard.scope, 'server-snapshot'); assert.equal(guard.pinned, true); assert.equal(guard.state, 'complete');
      assert.equal(guard.serverType, kind); assert.equal(guard.minecraftVersion, '26.2');
      assert.deepEqual([...guard.includedRoots].sort(), beforeRoots);
      assert.deepEqual(guard.files, beforeTree); assert.equal(guard.fileCount, beforeTree.length);
      assert.equal(guard.checksumSha256, restoreFilesChecksum(beforeTree)); assert.equal(guard.checksumSha256, details.guardChecksum);
      assert.deepEqual(await inventoryAcceptanceTree(path.join(guardRoot, 'payload'), plain), beforeTree);
      const source = record.intent.paths.find((item) => item.role === 'source');
      const target = record.intent.paths.find((item) => item.role === 'target');
      assert(source && target && target.namespace === 'server');
      const resolveBound = (item) => {
        const root = item.namespace === 'server' ? serverRoot : managerRoot;
        const resolved = path.resolve(root, item.relativePath), relative = path.relative(root, resolved);
        assert(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); return resolved;
      };
      if (record.intent.addonLifecycle) await assert.rejects(plain(resolveBound(source)), { code: 'ENOENT' });
      else {
        assert.equal((await readPrivatePropertiesFile(resolveBound(source), 64 * 1024 ** 2)).checksum, details.uploadSha256);
        const uploadDirectory = path.dirname(resolveBound(source));
        const consumed = JSON.parse(await readFile(path.join(uploadDirectory, 'consumed.json'), 'utf8'));
        const lifecycle = JSON.parse(await readFile(path.join(uploadDirectory, 'lifecycle.json'), 'utf8'));
        assert.equal(consumed.operationId, completed.id); assert.equal(consumed.id, details.uploadId);
        assert.equal(consumed.revision, details.uploadRevision); assert.equal(consumed.checksumSha256, details.uploadSha256);
        assert.equal(consumed.directoryIdentity, await backupDirectoryIdentity(uploadDirectory)); assert.equal(lifecycle.state, 'consumed');
      }
      const installed = await readPrivatePropertiesFile(resolveBound(target), 64 * 1024 ** 2);
      assert.equal(installed.checksum, report.probe.sha256);
      if (record.intent.addonLifecycle) assert.equal(installed.physicalIdentity, details.sourcePhysicalIdentity);
      const afterTree = await inventoryAcceptanceTree(serverRoot, plain);
      const allowed = new Set([source.namespace === 'server' ? source.relativePath : '', target.relativePath]);
      if (details.action === 'trash') allowed.add(path.posix.join(path.posix.dirname(target.relativePath), 'receipt.json'));
      if (details.action === 'restore') allowed.add(path.posix.join(path.posix.dirname(source.relativePath), 'restored.json'));
      assert.deepEqual(afterTree.filter((file) => !allowed.has(file.path)), beforeTree.filter((file) => !allowed.has(file.path)), 'unrelated server files changed');
      if (details.action === 'trash' || details.action === 'restore') {
        const directory = path.dirname(resolveBound(details.action === 'trash' ? target : source));
        const receipt = JSON.parse(await readFile(path.join(directory, 'receipt.json'), 'utf8'));
        assert.equal(receipt.id, details.trashId); assert.equal(receipt.serverId, record.intent.serverId);
        assert.equal(receipt.rootIdentity, details.rootIdentity); assert.equal(receipt.kind, details.kind);
        assert.equal(receipt.filename, details.filename); assert.equal(receipt.addonId, details.addonId);
        assert.equal(receipt.adapterIdentitySha256, details.adapterIdentitySha256);
        assert.equal(receipt.sha256, installed.checksum); assert.equal(receipt.physicalIdentity, installed.physicalIdentity);
        assert.equal(receipt.originalState, details.action === 'trash' ? details.sourceState : details.targetState);
        if (details.action === 'restore') {
          const consumed = JSON.parse(await readFile(path.join(directory, 'restored.json'), 'utf8'));
          assert.equal(consumed.operationId, completed.id); assert.equal(consumed.targetState, details.targetState);
          assert.equal(consumed.serverId, record.intent.serverId); assert.equal(consumed.rootIdentity, details.rootIdentity);
          assert.equal(consumed.filename, details.filename); assert.equal(consumed.trashId, details.trashId);
          assert.equal(consumed.addonId, details.addonId);
          assert.equal(consumed.physicalIdentity, installed.physicalIdentity); assert.equal(consumed.sha256, installed.checksum);
        }
      }
      return guard.checksumSha256;
    }
    await verifyTransaction();
    assert.equal((await request(url, payload, key)).operation.id, completed.id);
    await closeApp(); await openApp(); await stopped();
    assert.equal((await request(base)).status.recoveryRequired, false);
    const replay = (await request(url, payload, key)).operation;
    assert.equal(replay.id, completed.id, 'manager restart changed replay operation');
    assert.equal(replay.state, 'succeeded'); assert.equal(replay.result?.restartRequired, true);
    await verifyTransaction();
    const freshJournal = await new TransactionJournalStore(managerRoot).scan(); assert.deepEqual(freshJournal.issues, []);
    assert.equal(freshJournal.records.length, journal.records.length);
    const freshRecord = freshJournal.records.find((item) => item.intent.operationId === completed.id);
    assert.equal(freshRecord?.state, 'committed'); assert.equal(freshRecord.transactionId, record.transactionId);
    assert.deepEqual(freshRecord.intent, record.intent);
    assert.equal(launches(), beforeLaunches);
    report.addonOperations ??= []; report.addonOperations.push({ label, operationId: completed.id, idempotencyKey: key, state: completed.state,
      approvedRevision: payload.revision ?? payload.inventoryRevision, guardId: details.guardBackupId, guardChecksum: details.guardChecksum,
      committedJournal: true, pinnedCompleteGuardVerified: true, exactFileEffectsVerified: true, restartRequired: true,
      worldFilesUnchanged: true, unrelatedFilesUnchanged: true, replayAfterManagerRestart: true });
    check(label); return completed;
  }
  setPhase('baseline'); await launch(false, `${kind}: clean fresh baseline without addon`);
  const listing = await request(base + '/addons'); assert.equal(listing.writeSupported, true); assert.deepEqual(listing.items, []);
  const upload = await getApp().inject({ method: 'POST', url: base + '/addons/uploads', headers: { ...headers, 'content-type': 'application/java-archive', 'x-upload-filename': 'p55-probe.jar' }, payload: probe.bytes });
  assert.equal(upload.statusCode, 201, upload.body); const receipt = upload.json().data;
  await mutate(base + '/addons/install', { uploadId: receipt.id, uploadRevision: receipt.revision, inventoryRevision: listing.revision }, 'install');
  const entry = async (state) => { const current = await request(base + '/addons'); assert.equal(current.items.length, 1); assert.equal(current.items[0].state, state); assert.equal(current.items[0].sha256, report.probe.sha256); return { current, addon: current.items[0] }; };
  const action = async (name, state) => { const { current, addon } = await entry(state); return mutate(base + '/addons/' + addon.id + '/' + name, { revision: current.revision }, name); };
  await entry('enabled'); await launch(true, `${kind}: installed probe actually loaded`);
  await action('disable', 'enabled'); await entry('disabled'); await launch(false, `${kind}: disabled probe omitted from fresh load`);
  await action('enable', 'disabled'); await entry('enabled'); await launch(true, `${kind}: explicitly re-enabled probe loaded`);
  await action('trash', 'enabled'); assert.deepEqual((await request(base + '/addons')).items, []);
  await launch(false, `${kind}: trashed probe omitted from fresh load`);
  let trash = await request(base + '/addons/trash'); assert.equal(trash.items.length, 1);
  await mutate(base + '/addons/trash/' + trash.items[0].id + '/restore', { revision: trash.revision }, 'restore-enabled');
  await entry('enabled'); await launch(true, `${kind}: restored enabled probe loaded`);
  await action('disable', 'enabled'); await action('trash', 'disabled');
  trash = await request(base + '/addons/trash'); assert.equal(trash.items.length, 1);
  await mutate(base + '/addons/trash/' + trash.items[0].id + '/restore', { revision: trash.revision }, 'restore-disabled');
  await entry('disabled'); await launch(false, `${kind}: restored disabled probe remains omitted`);
  assert.deepEqual((await request(base + '/addons/trash')).items, []);
  report.addons = 'PASS'; report.result = 'PASS';
  check(`${kind}: real install/disable/enable/trash/restore, actual load/omission and manager restart replay complete`);
}
