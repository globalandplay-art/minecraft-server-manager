// Installed source is read-only; EULA in fresh test roots comes from the authorized Vanilla fixture.
import assert from 'node:assert/strict';
import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { captureNeoForgeLaunchBinding } from '../../apps/api/src/services/neoforge-launch-binding.ts';
import { readPrivatePropertiesFile } from '../../apps/api/src/services/properties-private-file.ts';

export async function neoForgeSourcePreflight() {
  const supplied = process.env.LT_NEOFORGE_TEST_SOURCE;
  assert(supplied && path.isAbsolute(supplied));
  const sourceRoot = path.resolve(supplied);
  for (let cursor = sourceRoot;; cursor = path.dirname(cursor)) {
    const stat = await lstat(cursor); assert(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal((await realpath(cursor)).toLowerCase(), cursor.toLowerCase());
    if (cursor === path.dirname(cursor)) break;
  }
  const binding = await captureNeoForgeLaunchBinding(sourceRoot, path.join(sourceRoot, 'run.bat'));
  const argsFile = 'libraries/net/neoforged/neoforge/26.3.0.95/win_args.txt';
  const descriptor = await readPrivatePropertiesFile(path.join(sourceRoot, argsFile), 65536);
  const cp = descriptor.bytes.toString('utf8').trim().split(/\r?\n/u)[5].split(';');
  const files = [];
  for (const relative of [...new Set(['run.bat', argsFile, ...cp,
    'libraries/net/neoforged/minecraft-server-patched/26.3.0.95/minecraft-server-patched-26.3.0.95.jar',
    'libraries/net/neoforged/neoforge/26.3.0.95/neoforge-26.3.0.95-universal.jar'])]) {
    assert(relative.split('/').every(part => part && part !== '.' && part !== '..'));
    const file = await readPrivatePropertiesFile(path.join(sourceRoot, relative), 64 * 1024 ** 2);
    files.push({ relative, target: relative, identity: file.identity, sha256: file.checksum });
  }
  assert.equal(files.length, 70);
  assert.deepEqual(await captureNeoForgeLaunchBinding(sourceRoot, path.join(sourceRoot, 'run.bat')), binding);
  return { kind: 'neoforge', sourceRoot, version: binding.version, files, manifestSha256: binding.identitySha256,
    noFetchProof: 'Exact installed dedicated-server descriptor and 68 identity/hash-bound runtime JARs; scripts not executed' };
}
