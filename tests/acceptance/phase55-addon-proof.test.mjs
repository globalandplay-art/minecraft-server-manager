import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inventoryAcceptanceTree, verifyNativeLoadProof } from './phase55-addon-flow.mjs';

test('native loader evidence is required independently of initializer marker', () => {
  assert.equal(verifyNativeLoadProof('paper', 'Plugins (1): §aP55Probe', true).loaded, true);
  assert.equal(verifyNativeLoadProof('paper', 'Plugins (0):', false).loaded, false);
  assert.equal(verifyNativeLoadProof('fabric', 'Loading 4 mods:\n\t- p55probe 1.0.0\n', true).loaded, true);
  assert.equal(verifyNativeLoadProof('fabric', 'Loading 3 mods:\n\t- fabricloader 0.19.5\n', false).loaded, false);
  for (const kind of ['paper', 'fabric']) assert.throws(() => verifyNativeLoadProof(kind, 'P55_PROBE_LOADED_run', true));
  assert.throws(() => verifyNativeLoadProof('paper', 'Plugins (0):', true));
  assert.throws(() => verifyNativeLoadProof('paper', 'Plugins (1): P55Probe', false));
  assert.throws(() => verifyNativeLoadProof('fabric', 'Loading 4 mods:\n- p55probe 1.0.0', false));
  assert.throws(() => verifyNativeLoadProof('fabric', 'Loading 4 mods:\n- p55probe 1.0.01', true));
});

test('complete snapshot includes configuration/addons/dimensions without top-level level.dat and rejects linked roots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'p55-proof-'));
  const plain = async (file, directory = false) => {
    const stat = await lstat(file);
    assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1));
    assert.equal((await realpath(file)).toLowerCase(), path.resolve(file).toLowerCase()); return stat;
  };
  try {
    const source = path.join(root, 'server'); await mkdir(source);
    await mkdir(path.join(source, 'world')); await mkdir(path.join(source, 'plugins'));
    await writeFile(path.join(source, 'world', 'level.dat'), 'world');
    await writeFile(path.join(source, 'plugins', 'probe.jar'), 'probe');
    await writeFile(path.join(source, 'server.properties'), 'secret=private');
    const files = await inventoryAcceptanceTree(source, plain);
    assert.deepEqual(files.map((file) => file.path), ['plugins/probe.jar', 'server.properties', 'world/level.dat']);
    assert.equal(files.find((file) => file.path === 'server.properties').sizeBytes, (await readFile(path.join(source, 'server.properties'))).length);
    await symlink(source, path.join(root, 'linked'), 'junction');
    await assert.rejects(inventoryAcceptanceTree(path.join(root, 'linked'), plain));
  } finally { await rm(root, { recursive: true, force: true }); }
});
