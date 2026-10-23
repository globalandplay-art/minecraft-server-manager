import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchZip } from './launch-zip.js';

export async function neoForgeLaunchFixture(root: string) {
  const anchor = path.join(root, 'run.bat');
  const template = new URL('../../../../tests/fixtures/neoforge26-run.bat.txt', import.meta.url);
  const argsTemplate = new URL('../../../../tests/fixtures/neoforge26-win-args.txt', import.meta.url);
  const batch = (await readFile(template, 'utf8')).replace(/\r?\n/gu, '\r\n');
  const args = (await readFile(argsTemplate, 'utf8')).replace(/\r\n/gu, '\n');
  const descriptor = path.join(root, 'libraries/net/neoforged/neoforge/26.3.0.95/win_args.txt');
  const classpath = args.trim().split('\n')[5]!.split(';');
  const gameRelative = 'libraries/net/neoforged/minecraft-server-patched/26.3.0.95/minecraft-server-patched-26.3.0.95.jar';
  const universalRelative = 'libraries/net/neoforged/neoforge/26.3.0.95/neoforge-26.3.0.95-universal.jar';
  for (const relative of [...classpath, gameRelative, universalRelative]) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    let manifest = 'Manifest-Version: 1.0\n';
    if (relative.includes('/fancymodloader/loader/')) manifest += 'Build-Number: 12.0.12\n';
    if (relative === gameRelative) manifest += 'Main-Class: net.minecraft.server.Main\n';
    if (relative === universalRelative) manifest += 'FML-System-Mods: neoforge\n';
    await writeFile(file, launchZip({ 'META-INF/MANIFEST.MF': manifest,
      ...(relative === gameRelative ? { 'version.json': '{"id":"26.3","java_version":25}' } : {}) }));
  }
  await writeFile(anchor, batch); await writeFile(descriptor, args);
  return { anchor, descriptor, classpath, game: path.join(root, gameRelative), universal: path.join(root, universalRelative) };
}
