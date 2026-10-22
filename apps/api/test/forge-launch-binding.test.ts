import { mkdtemp, rm, writeFile, readFile, link, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { captureForgeLaunchBinding } from '../src/services/forge-launch-binding.js';
import { forgeLaunchFixture } from './helpers/forge-launch.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(options: Parameters<typeof forgeLaunchFixture>[1] = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-forge-binding-')); roots.push(root);
  return { root, ...await forgeLaunchFixture(root, options) };
}
it('binds exact installed shim, three dependencies, Minecraft version and Java requirement', async () => {
  const f = await fixture(), a = await captureForgeLaunchBinding(f.root, f.jarPath), b = await captureForgeLaunchBinding(f.root, f.jarPath);
  expect(a).toMatchObject({ version: '1.21.9', requiredMajor: 21, fileCount: 4 }); expect(b).toEqual(a);
});
it('binds the verified 26.3 release format with matching server metadata and Java requirement', async () => {
  const f = await fixture({ minecraftVersion: '26.3', javaVersion: 25 });
  await expect(captureForgeLaunchBinding(f.root, f.jarPath)).resolves.toMatchObject({ version: '26.3', requiredMajor: 25, fileCount: 4 });
});
it.each(['26.4', '27.1', '26.3-pre1'])('rejects unverified release format %s', async minecraftVersion => {
  const f = await fixture({ minecraftVersion, javaVersion: 25 });
  await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it('rejects 26.3 when shim and server Java requirements differ', async () => {
  const f = await fixture({ minecraftVersion: '26.3', javaVersion: 25,
    properties: 'Arguments=--launchTarget forge_server\nJava-Version=21\nMain-Class=net.minecraftforge.bootstrap.ForgeBootstrap\n' });
  await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it.each(['../outside.jar', 'https://example.com/code.jar', 'libraries/extra.jar', 'file:C:/elsewhere.jar'])('rejects unbound Class-Path %s', async classpath => {
  const f = await fixture({ classpath }); await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it('rejects Multi-Release outer shims rather than validating different resources from Java', async () => {
  const f = await fixture({ outerFields: 'Multi-Release: true\n' });
  await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it.each(['duplicate', 'maven-path', 'traversal', 'wrong-sha', 'missing-server'])('rejects %s in dependency evidence', async change => {
  const f = await fixture({ list: value => {
    if (change === 'duplicate') return `${value}\n${value.split('\n')[0]}`;
    if (change === 'maven-path') return value.replace('net.minecraftforge:bootstrap', 'wrong.group:bootstrap');
    if (change === 'traversal') return value.replace('\tnet/minecraftforge/bootstrap/', '\t../net/minecraftforge/bootstrap/');
    if (change === 'wrong-sha') return '0'.repeat(64) + value.slice(64);
    return value.split('\n').filter(line => !line.includes(':server\t')).join('\n');
  } }); await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it.each(['Java-Version=25', 'Arguments=--launchTarget forge_client', 'Main-Class=attacker.Main'])('rejects config conflict %s', async invalid => {
  const f = await fixture({ properties: ['Arguments=--launchTarget forge_server', 'Java-Version=21', 'Main-Class=net.minecraftforge.bootstrap.ForgeBootstrap'].map(line => line.startsWith(invalid.split('=')[0]! + '=') ? invalid : line).join('\n') });
  await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it('rejects hardlinked dependencies and binds replacement inode even with identical bytes', async () => {
  const f = await fixture(), original = await captureForgeLaunchBinding(f.root, f.jarPath), bytes = await readFile(f.dependency);
  await link(f.dependency, f.dependency + '.alias'); await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
  await rm(f.dependency + '.alias'); await rename(f.dependency, f.dependency + '.old'); await writeFile(f.dependency, bytes);
  expect((await captureForgeLaunchBinding(f.root, f.jarPath)).identitySha256).not.toBe(original.identitySha256);
});
it('accepts a self index but refuses a newly present unbound index target', async () => {
  const f = await fixture({ index: 'JarIndex-Version: 1.0\n\nbootstrap-2.1.8.jar\nnet/minecraftforge\n\nmissing.jar\nother/package\n' });
  await expect(captureForgeLaunchBinding(f.root, f.jarPath)).resolves.toMatchObject({ version: '1.21.9' });
  await writeFile(path.join(path.dirname(f.dependency), 'missing.jar'), 'unbound');
  await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it.each(['../escape.jar', 'https://example.test/code.jar', 'C:/external.jar'])('rejects unsafe index target %s', async target => {
  const f = await fixture({ index: `JarIndex-Version: 1.0\n\n${target}\npackage\n` });
  await expect(captureForgeLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
