// Read-only source preflight. No child process, network request, extraction or source writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDirectoryIdentity } from '../../apps/api/src/services/backup-identity.ts';
import { readPrivatePropertiesFile } from '../../apps/api/src/services/properties-private-file.ts';
import { captureFabricLaunchBinding, launchMetadata, manifestField } from '../../apps/api/src/services/fabric-launch-binding.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';

const sources = {
  paper: { root: 'C:\\Users\\29104\\Desktop\\Game\\minecraft服务端\\minecraft.peper26.2', launcher: 'paper-26.2-129.jar' },
  fabric: { root: 'C:\\Users\\29104\\Desktop\\Game\\minecraft服务端\\minecraft.fabric26.2', launcher: 'fabric-server-mc.26.2-loader.0.19.5-launcher.1.1.2.jar' }
};
const normalize = (value) => path.resolve(value).toLowerCase();
export async function sourcePreflight(kind, javaExecutable) {
  assert(process.platform === 'win32'); assert(Object.hasOwn(sources, kind));
  const source = sources[kind], directories = new Map(), files = new Map();
  async function directory(relative) {
    if (!directories.has(relative)) directories.set(relative, await backupDirectoryIdentity(path.join(source.root, relative)));
  }
  async function file(relative, expectedSha256 = null, target = relative) {
    assert(/^[a-zA-Z0-9_+.\/-]+$/u.test(relative));
    assert(relative.split('/').every((part) => part !== '..' && part !== '.' && part !== ''));
    assert(relative === source.launcher || relative === 'eula.txt' || /^(?:libraries|versions|cache|\.fabric\/server)\//u.test(relative), 'source outside exact dependency whitelist');
    const parts = relative.split('/');
    for (let n = 1; n < parts.length; n++) await directory(parts.slice(0, n).join('/'));
    const read = await readPrivatePropertiesFile(path.join(source.root, relative), 64 * 1024 ** 2);
    if (expectedSha256) assert.equal(read.checksum, expectedSha256, `source dependency checksum: ${relative}`);
    const entry = { relative, target, sha256: read.checksum, identity: read.identity, sizeBytes: read.bytes.length, expectedSha256 };
    const previous = files.get(relative); if (previous) assert.deepEqual(previous, entry); else files.set(relative, entry);
    return read.bytes;
  }
  function rows(text) {
    assert(typeof text === 'string');
    return text.trim().split('\n').map((line) => {
      const parts = line.trim().split('\t'); assert.equal(parts.length, 3); assert(/^[a-f0-9]{64}$/u.test(parts[0]));
      assert(/^[a-zA-Z0-9_+.\/-]+\.jar$/u.test(parts[2])); return parts;
    });
  }
  await directory('');
  const eula = await file('eula.txt'); assert.equal(parseProperties(eula.toString('utf8')).get('eula'), 'true', 'source EULA must already be accepted');
  const launcher = await file(source.launcher, null, 'server.jar');
  const metadata = await launchMetadata(launcher, ['META-INF/MANIFEST.MF', 'version.json', 'install.properties', 'META-INF/libraries.list', 'META-INF/versions.list', 'META-INF/download-context']);
  let fabricExecutionSha256 = null;
  if (kind === 'paper') {
    const manifest = metadata.get('META-INF/MANIFEST.MF') ?? '';
    assert.equal(manifestField(manifest, 'Main-Class'), 'io.papermc.paperclip.Main'); assert(!manifestField(manifest, 'Class-Path'));
    const version = JSON.parse(metadata.get('version.json')); assert.equal(version.id, '26.2'); assert.equal(version.java_version, 25);
    for (const [sha256, , relative] of rows(metadata.get('META-INF/libraries.list'))) await file(`libraries/${relative}`, sha256);
    for (const [sha256, versionName, relative] of rows(metadata.get('META-INF/versions.list'))) {
      assert.equal(versionName, '26.2'); await file(`versions/${relative}`, sha256);
    }
    const context = metadata.get('META-INF/download-context')?.trim().split('\t');
    assert(context?.length === 3 && /^[a-f0-9]{64}$/u.test(context[0]) && context[2] === 'mojang_26.2.jar');
    await file(`cache/${context[2]}`, context[0]);
  } else {
    const binding = await captureFabricLaunchBinding(source.root, path.join(source.root, source.launcher));
    assert.equal(binding.version, '26.2'); assert.equal(binding.requiredMajor, 25); fabricExecutionSha256 = binding.identitySha256;
    const bundle = await file('.fabric/server/26.2-server.jar');
    const bundled = await launchMetadata(bundle, ['META-INF/libraries.list', 'META-INF/versions.list']);
    for (const [sha256, , relative] of rows(bundled.get('META-INF/libraries.list'))) await file(`libraries/${relative}`, sha256);
    for (const [sha256, versionName, relative] of rows(bundled.get('META-INF/versions.list'))) {
      assert.equal(versionName, '26.2'); await file(`versions/${relative}`, sha256);
    }
    const loader = '.fabric/server/fabric-loader-server-0.19.5-minecraft-26.2.jar';
    const launch = await launchMetadata(await file(loader), ['META-INF/MANIFEST.MF']);
    for (const dependency of manifestField(launch.get('META-INF/MANIFEST.MF') ?? '', 'Class-Path').split(/\s+/u)) {
      assert(dependency.startsWith('../../libraries/')); await file(dependency.slice(6));
    }
  }
  const java = await readPrivatePropertiesFile(javaExecutable, 128 * 1024 ** 2);
  for (const [relative, identity] of directories) assert.equal(await backupDirectoryIdentity(path.join(source.root, relative)), identity);
  for (const entry of files.values()) {
    const current = await readPrivatePropertiesFile(path.join(source.root, entry.relative), 64 * 1024 ** 2);
    assert.equal(current.identity, entry.identity); assert.equal(current.checksum, entry.sha256);
  }
  const result = { schemaVersion: 1, kind, sourceRoot: source.root, sourceLauncher: source.launcher, minecraftVersion: '26.2', requiredJavaMajor: 25,
    java: { executable: javaExecutable, identity: java.identity, sha256: java.checksum }, rootIdentity: directories.get(''),
    directories: [...directories].map(([relative, identity]) => ({ relative, identity })), files: [...files.values()], fabricExecutionSha256,
    noFetchProof: kind === 'paper' ? 'Paperclip download-context cache, versions and every libraries.list SHA256 verified locally' : 'Actual unattended game bundle, loader manifest dependencies and every bundled library/version SHA256 verified locally',
    originalUserWorldAccessed: false, sourcePropertiesAccessed: false, sourceAddonDirectoriesAccessed: false, sourceWritten: false, serverLaunched: false };
  return { ...result, manifestSha256: createHash('sha256').update(JSON.stringify(result)).digest('hex') };
}
if (normalize(process.argv[1] ?? '') === normalize(fileURLToPath(import.meta.url))) {
  const kind = process.env.MCSM_P55_KIND, runId = process.env.MCSM_P55_RUN_ID;
  assert(new RegExp(`^p55-${kind}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'u').test(runId ?? ''));
  const workspace = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const managerRoot = path.join(workspace, '.manager', runId); await backupDirectoryIdentity(managerRoot);
  const file = path.join(managerRoot, 'source-manifest.json');
  await assert.rejects(lstat(file), { code: 'ENOENT' }); assert.equal(normalize(await realpath(managerRoot)), normalize(managerRoot));
  const manifest = await sourcePreflight(kind, process.env.MCSM_P55_JAVA);
  await writeFile(file, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ kind, result: 'SOURCE_PREFLIGHT_PASS', files: manifest.files.length, totalBytes: manifest.files.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    manifestSha256: manifest.manifestSha256, noFetchProof: manifest.noFetchProof, originalUserWorldAccessed: false, serverLaunched: false }, null, 2));
}
