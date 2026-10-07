import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPrivatePropertiesFile } from '../../apps/api/src/services/properties-private-file.ts';
import { sourcePreflight } from './phase55-source-preflight.mjs';

export async function prepareIsolation({ kind, runId, serverRoot, managerRoot, id, secret, report, plain, absent, selectPorts, assertFreePorts }) {
  await plain(path.join(managerRoot, 'source-manifest.json'));
  const manifest = JSON.parse(await readFile(path.join(managerRoot, 'source-manifest.json'), 'utf8'));
  assert.equal(manifest.kind, kind); assert.equal(manifest.originalUserWorldAccessed, false);
  assert.equal(manifest.sourcePropertiesAccessed, false); assert.equal(manifest.sourceAddonDirectoriesAccessed, false);
  assert.equal(manifest.sourceWritten, false); assert.equal(manifest.serverLaunched, false);
  assert.deepEqual(await sourcePreflight(kind, manifest.java.executable), manifest, 'source inputs changed since read-only preflight');
  await absent(serverRoot);
  report.canonicalPath = serverRoot; report.canonicalManagerPath = managerRoot;
  report.sourceManifestSha256 = manifest.manifestSha256; report.sourceInputs = manifest;
  console.log(`CONFIRMED FRESH TEST CANONICAL PATH: ${serverRoot}`);
  console.log(`CONFIRMED FRESH MANAGER CANONICAL PATH: ${managerRoot}`);
  console.log(`READ-ONLY EXACT DEPENDENCY SOURCE: ${manifest.sourceRoot}`);
  await selectPorts(); await assertFreePorts();
  await mkdir(serverRoot); await plain(serverRoot, true);
  for (const entry of manifest.files) {
    assert(entry.target === 'server.jar' || entry.target === 'eula.txt' || /^(?:libraries|versions|cache|\.fabric\/server)\/[a-zA-Z0-9_+.\/-]+\.jar$/u.test(entry.target));
    assert(entry.target.split('/').every((part) => part !== '..' && part !== '.' && part !== ''));
    const destination = path.join(serverRoot, entry.target), relative = path.relative(serverRoot, destination);
    assert(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    const parts = entry.target.split('/');
    for (let n = 1; n < parts.length; n++) {
      const directory = path.join(serverRoot, ...parts.slice(0, n));
      await mkdir(directory).catch((error) => { if (error.code !== 'EEXIST') throw error; }); await plain(directory, true);
    }
    const source = await readPrivatePropertiesFile(path.join(manifest.sourceRoot, entry.relative), 64 * 1024 ** 2);
    assert.equal(source.identity, entry.identity); assert.equal(source.checksum, entry.sha256);
    await writeFile(destination, source.bytes, { flag: 'wx', mode: 0o600 }); await plain(destination);
    assert.equal((await readPrivatePropertiesFile(destination, 64 * 1024 ** 2)).checksum, entry.sha256);
  }
  await mkdir(path.join(serverRoot, kind === 'paper' ? 'plugins' : 'mods'));
  await writeFile(path.join(serverRoot, 'server.properties'), [
    'server-ip=127.0.0.1', `server-port=${report.gamePort}`, 'enable-rcon=true', `rcon.port=${report.rconPort}`, `rcon.password=${secret}`,
    'level-name=generated-world', 'level-seed=314159265', 'view-distance=2', 'simulation-distance=2', 'spawn-protection=0',
    'online-mode=true', 'max-players=2', 'enable-query=false', 'management-server-enabled=false', ''
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(managerRoot, 'config.json'), JSON.stringify({ schemaVersion: 1, servers: [{ id,
    name: 'Fresh isolated ' + kind + ' addon acceptance', root: serverRoot, javaExecutable: manifest.java.executable, jarFile: 'server.jar',
    jvmArgs: ['-Xms512M', '-Xmx1G'], serverArgs: ['nogui'] }] }), { flag: 'wx', mode: 0o600 });
  report.isolation = { runId, serverRoot, managerRoot, freshUuidInstance: true, originalUserWorldTouched: false };
  return manifest;
}
