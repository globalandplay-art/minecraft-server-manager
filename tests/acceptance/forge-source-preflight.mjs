// Read-only, exact installed Forge shim source; never inspect/copy a source world.
import assert from 'node:assert/strict';
import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { captureForgeLaunchBinding } from '../../apps/api/src/services/forge-launch-binding.ts';
import { readPrivatePropertiesFile } from '../../apps/api/src/services/properties-private-file.ts';
import { launchMetadata } from '../../apps/api/src/services/fabric-launch-binding.ts';
import { parseProperties } from '../../apps/api/src/config/properties.ts';

export async function forgeSourcePreflight() {
  const sourceRoot = process.env.LT_FORGE_TEST_SOURCE, jar = process.env.LT_FORGE_TEST_JAR;
  assert(sourceRoot && path.isAbsolute(sourceRoot)); assert(jar && path.basename(jar) === jar && jar.endsWith('.jar'));
  for (let cursor = path.resolve(sourceRoot);; cursor = path.dirname(cursor)) {
    const stat = await lstat(cursor); assert(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal((await realpath(cursor)).toLowerCase(), cursor.toLowerCase());
    if (cursor === path.dirname(cursor)) break;
  }
  const source = path.resolve(sourceRoot), binding = await captureForgeLaunchBinding(source, path.join(source, jar));
  const launcher = await readPrivatePropertiesFile(path.join(source, jar), 64 * 1024 ** 2);
  const metadata = await launchMetadata(launcher.bytes, ['bootstrap-shim.list']);
  const dependencies = metadata.get('bootstrap-shim.list').trim().split(/\r?\n/u).map(line => 'libraries/' + line.split('\t')[2]);
  const files = [];
  for (const relative of [jar, 'eula.txt', ...dependencies]) {
    assert(relative.split('/').every(part => part && part !== '.' && part !== '..'));
    const file = await readPrivatePropertiesFile(path.join(source, relative), 64 * 1024 ** 2);
    if (relative === 'eula.txt') assert.equal(parseProperties(file.bytes.toString('utf8')).get('eula'), 'true', 'source EULA must already be accepted');
    files.push({ relative, target: relative === jar ? 'server.jar' : relative, identity: file.identity, sha256: file.checksum });
  }
  assert.deepEqual(await captureForgeLaunchBinding(source, path.join(source, jar)), binding);
  assert.equal((await readPrivatePropertiesFile(path.join(source, jar), 64 * 1024 ** 2)).checksum, launcher.checksum);
  return { kind: 'forge', sourceRoot: source, version: binding.version, binding: binding.identitySha256, files,
    manifestSha256: binding.identitySha256, noFetchProof: 'Installed shim Maven-coordinate closure and every dependency SHA256 verified locally' };
}
