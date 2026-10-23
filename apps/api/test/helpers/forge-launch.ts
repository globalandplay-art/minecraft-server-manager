import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchZip } from './launch-zip.js';

export async function forgeLaunchFixture(root: string, options: { minecraftVersion?: string; javaVersion?: number; forgeRelease?: string; classpath?: string; properties?: string; index?: string; outerFields?: string; list?: (value: string) => string } = {}) {
  const minecraftVersion = options.minecraftVersion ?? '1.21.9', javaVersion = options.javaVersion ?? 21;
  const forgeVersion = `${minecraftVersion}-${options.forgeRelease ?? (minecraftVersion === '26.3' ? '66.1.0' : '59.0.5')}`;
  const dependency = 'net/minecraftforge/bootstrap/2.1.8/bootstrap-2.1.8.jar';
  const rows: [string, string, Record<string, string>][] = [
    ['net.minecraftforge:bootstrap:2.1.8', dependency, { 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n', ...(options.index === undefined ? {} : { 'META-INF/INDEX.LIST': options.index }) }],
    [`net.minecraftforge:forge:${forgeVersion}:server`, `net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-server.jar`, {
      'META-INF/MANIFEST.MF': 'Main-Class: net.minecraft.server.Main\n', 'version.json': JSON.stringify({ id: minecraftVersion, java_version: javaVersion }) }],
    [`net.minecraftforge:forge:${forgeVersion}:universal`, `net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-universal.jar`, { 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n' }]
  ];
  const list: string[] = [];
  for (const [coordinate, relative, content] of rows) {
    const file = path.join(root, 'libraries', relative), bytes = launchZip(content);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
    list.push(`${createHash('sha256').update(bytes).digest('hex')}\t${coordinate}\t${relative}`);
  }
  const jarPath = path.join(root, 'forge-shim.jar');
  await writeFile(jarPath, launchZip({
    'META-INF/MANIFEST.MF': `Main-Class: net.minecraftforge.bootstrap.shim.Main\nClass-Path: ${options.classpath ?? `libraries/${dependency}`}\n${options.outerFields ?? ''}`,
    'bootstrap-shim.properties': options.properties ?? `Arguments=--launchTarget forge_server\nJava-Version=${javaVersion}\nMain-Class=net.minecraftforge.bootstrap.ForgeBootstrap\n`,
    'bootstrap-shim.list': options.list?.(list.join('\n')) ?? list.join('\n')
  }));
  return { jarPath, dependency: path.join(root, 'libraries', dependency), server: path.join(root, 'libraries', rows[1]![1]) };
}
