import { mkdtemp, rm, writeFile, readFile, link, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { assertNeoForgeEnvironment, captureNeoForgeLaunchBinding, createScopedNeoForgeBindingReader } from '../src/services/neoforge-launch-binding.js';
import { neoForgeLaunchFixture } from './helpers/neoforge-launch.js';
import { launchZip } from './helpers/launch-zip.js';
import { detectServer } from '../src/services/detection-service.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-neo-')); roots.push(root);
  return { root, ...await neoForgeLaunchFixture(root) };
}
it('binds fixed server descriptor and all68 files, generating direct arguments with no script execution', async () => {
  const f = await fixture(), binding = await captureNeoForgeLaunchBinding(f.root, f.anchor);
  expect(binding).toMatchObject({ version: '26.3', requiredMajor: 25, fileCount: 70 });
  expect(binding.argv).toContain('net.neoforged.fml.startup.Server');
  expect(binding.argv).not.toContain('-jar'); expect(binding.argv.some(value => value.startsWith('@'))).toBe(false);
  expect(binding.argv[binding.argv.indexOf('-classpath') + 1]!.split(path.delimiter)).toEqual(f.classpath.map(relative => path.join(f.root, relative)));
  expect(await captureNeoForgeLaunchBinding(f.root, f.anchor)).toEqual(binding);
});
it.each(['script', 'client', 'agent', 'traversal', 'version'])('rejects modified descriptor: %s', async mode => {
  const f = await fixture();
  if (mode === 'script') await writeFile(f.anchor, '@echo off\njava attacker.Main\n');
  else { const text = await readFile(f.descriptor, 'utf8'); await writeFile(f.descriptor, mode === 'client' ? text.replace('startup.Server', 'startup.Client') : mode === 'agent' ? text + '\n-javaagent:evil.jar' : mode === 'traversal' ? text.replace('libraries/', '../libraries/') : text.replace('26.3.0.95', '26.3.0.96')); }
  await expect(captureNeoForgeLaunchBinding(f.root, f.anchor)).rejects.toThrow();
});
it('rejects a missing game artifact even with the whole classpath present', async () => {
  const f = await fixture(); await rm(f.game);
  await expect(captureNeoForgeLaunchBinding(f.root, f.anchor)).rejects.toThrow();
});
it.each([['27.1', 25], ['26.3', 21]] as const)('rejects game metadata %s Java%d', async (version, java) => {
  const f = await fixture(); await writeFile(f.game, launchZip({ 'META-INF/MANIFEST.MF': 'Main-Class: net.minecraft.server.Main\n', 'version.json': JSON.stringify({ id: version, java_version: java }) }));
  await expect(captureNeoForgeLaunchBinding(f.root, f.anchor)).rejects.toThrow();
});
it('rejects a hidden manifest Class-Path', async () => {
  const f = await fixture(); await writeFile(path.join(f.root, f.classpath[0]!), launchZip({ 'META-INF/MANIFEST.MF': 'Class-Path: ../outside.jar\n' }));
  await expect(captureNeoForgeLaunchBinding(f.root, f.anchor)).rejects.toThrow();
});
it.each(['MOD_CLASSES', 'LOG4J_CONFIGURATION_FILE', 'LOG4J2_CONFIGURATION_FILE', 'log4j2_context_selector'])('rejects unbound environment %s without exposing its value', key => {
  expect(() => assertNeoForgeEnvironment({ [key]: 'private-value-never-in-errors' })).toThrow('NeoForge 环境存在未绑定的启动覆盖');
});
it('allows ordinary or empty environment values', () => {
  expect(() => assertNeoForgeEnvironment({ PATH: 'normal', MOD_CLASSES: '', CI: 'true' })).not.toThrow();
});
it.each(['net/minecraft/DetectedVersion.class', 'net/minecraft/client/Minecraft.class', 'assets/.mcassetsroot', 'net/neoforged/neoforge/client/ClientNeoForgeMod.class']
  .flatMap(entry => [entry, `META-INF/versions/25/${entry}`]))('refuses alternate game discovery via %s', async entry => {
  const f = await fixture(); await writeFile(path.join(f.root, f.classpath[0]!), launchZip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n', [entry]: 'unexpected game class' }));
  await expect(captureNeoForgeLaunchBinding(f.root, f.anchor)).rejects.toThrow();
});
it('rejects hardlinks and binds a same-bytes dependency replacement to its new physical identity', async () => {
  const f = await fixture(), original = await captureNeoForgeLaunchBinding(f.root, f.anchor), file = path.join(f.root, f.classpath[0]!);
  await link(file, file + '.alias'); await expect(captureNeoForgeLaunchBinding(f.root, f.anchor)).rejects.toThrow();
  await rm(file + '.alias'); const bytes = await readFile(file); await rename(file, file + '.old'); await writeFile(file, bytes);
  expect((await captureNeoForgeLaunchBinding(f.root, f.anchor)).identitySha256).not.toBe(original.identitySha256);
});
it('scoped content reuse produces the same complete binding as cold validation', async () => {
  const f = await fixture(), read = createScopedNeoForgeBindingReader();
  const cold = await captureNeoForgeLaunchBinding(f.root, f.anchor);
  expect(await read(f.root, f.anchor)).toEqual(cold);
  expect(await read(f.root, f.anchor)).toEqual(cold);
});
it('warm content reuse cannot hide changed bytes or alternate game classes', async () => {
  const f = await fixture(), read = createScopedNeoForgeBindingReader();
  await read(f.root, f.anchor);
  await writeFile(path.join(f.root, f.classpath[0]!), launchZip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n',
    'net/minecraft/DetectedVersion.class': 'untrusted class' }));
  await expect(read(f.root, f.anchor)).rejects.toThrow();
});
it('warm content reuse still rejects hardlinks and observes byte-identical physical replacement', async () => {
  const f = await fixture(), read = createScopedNeoForgeBindingReader(), file = path.join(f.root, f.classpath[0]!);
  const original = await read(f.root, f.anchor);
  await link(file, file + '.alias'); await expect(read(f.root, f.anchor)).rejects.toThrow();
  await rm(file + '.alias'); const bytes = await readFile(file);
  await rename(file, file + '.old'); await writeFile(file, bytes);
  expect((await read(f.root, f.anchor)).identitySha256).not.toBe(original.identitySha256);
});
it('warm INDEX facts still resolve and check absence relative to every current JAR', async () => {
  const f = await fixture(), read = createScopedNeoForgeBindingReader();
  const bytes = launchZip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\nBuild-Number: 12.0.12\n',
    'META-INF/INDEX.LIST': 'JarIndex-Version: 1.0\n\nextra.jar\nsample/package\n' });
  const first = path.join(f.root, f.classpath[0]!), second = path.join(f.root, f.classpath[1]!);
  await writeFile(first, bytes); await writeFile(second, bytes);
  await read(f.root, f.anchor);
  await writeFile(path.join(path.dirname(second), 'extra.jar'), 'unbound index target');
  await expect(read(f.root, f.anchor)).rejects.toThrow();
});
it.each(['game', 'universal'] as const)('warm ordinary content facts cannot authorize the %s validation role', async role => {
  const f = await fixture(), read = createScopedNeoForgeBindingReader();
  await read(f.root, f.anchor);
  await writeFile(f[role], await readFile(path.join(f.root, f.classpath[0]!)));
  await expect(read(f.root, f.anchor)).rejects.toThrow();
});
it('detection fails closed after a warm reader observes invalid current bytes', async () => {
  const f = await fixture(), read = createScopedNeoForgeBindingReader();
  const input = { id: 'test', name: 'test', rootPath: f.root, jarPath: f.anchor, javaExecutable: process.execPath };
  expect((await detectServer(input, read)).type).toBe('neoforge');
  await writeFile(f.universal, 'invalid current artifact');
  expect((await detectServer(input, read)).type).toBe('unknown');
});
