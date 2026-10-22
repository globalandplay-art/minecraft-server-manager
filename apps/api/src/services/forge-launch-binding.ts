import { createHash } from 'node:crypto';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { backupDirectoryIdentity } from './backup-identity.js';
import { readPrivatePropertiesFile } from './properties-private-file.js';
import { launchMetadata, manifestField } from './fabric-launch-binding.js';

const denied = () => new Error('unsupported-forge-launch-binding');
const wanted = ['META-INF/MANIFEST.MF', 'META-INF/INDEX.LIST', 'bootstrap-shim.properties', 'bootstrap-shim.list', 'version.json'];
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Forge Bootstrap shim only. Reads installed artifacts, never executes scripts or installers. */
export async function captureForgeLaunchBinding(root: string, launcher: string) {
  const rootIdentity = await backupDirectoryIdentity(root);
  const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(path.dirname(launcher)) !== normalize(root)) throw denied();
  const outer = await readPrivatePropertiesFile(launcher, 64 * 1024 ** 2);
  const metadata = await launchMetadata(outer.bytes, wanted), manifest = metadata.get('META-INF/MANIFEST.MF') ?? '';
  if (manifestField(manifest, 'Main-Class') !== 'net.minecraftforge.bootstrap.shim.Main' || manifestField(manifest, 'Multi-Release') !== undefined || metadata.has('META-INF/INDEX.LIST')) throw denied();
  const properties = (metadata.get('bootstrap-shim.properties') ?? '').replace(/\r\n/gu, '\n').split('\n').filter(Boolean);
  if (properties.length !== 3 || new Set(properties.map(line => line.split('=')[0])).size !== 3 ||
    !properties.includes('Arguments=--launchTarget forge_server') || !properties.includes('Main-Class=net.minecraftforge.bootstrap.ForgeBootstrap')) throw denied();
  const java = /^Java-Version=([1-9][0-9]?)$/u.exec(properties.find(line => line.startsWith('Java-Version=')) ?? '');
  if (!java || Number(java[1]) < 21) throw denied();
  const entries = (metadata.get('bootstrap-shim.list') ?? '').replace(/\r\n/gu, '\n').split('\n').filter(Boolean);
  if (!entries.length || entries.length > 256) throw denied();
  const parsed = entries.map(line => {
    const match = /^([a-f0-9]{64})\t([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.+-]+)(?::([a-zA-Z0-9_.+-]+))?\t([a-zA-Z0-9_+./-]+\.jar)$/u.exec(line);
    if (!match) throw denied();
    const [, checksum, group, artifact, version, classifier, relative] = match;
    if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..') ||
      relative !== `${group!.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`) throw denied();
    return { checksum: checksum!, group: group!, artifact: artifact!, version: version!, classifier, relative: `libraries/${relative}` };
  });
  if (new Set(parsed.map(row => row.relative.toLowerCase())).size !== parsed.length) throw denied();
  const cp = (manifestField(manifest, 'Class-Path') ?? '').split(/\s+/u);
  if (!cp.length || new Set(cp).size !== cp.length || cp.some(item => !parsed.some(row => row.relative === item))) throw denied();
  const server = parsed.filter(row => row.group === 'net.minecraftforge' && row.artifact === 'forge' && row.classifier === 'server');
  const forge = parsed.filter(row => row.group === 'net.minecraftforge' && row.artifact === 'forge');
  if (server.length !== 1 || forge.length !== 2 || !forge.some(row => row.version === server[0]!.version && row.classifier === 'universal')) throw denied();
  const mc = /^((?:1\.[0-9]{1,3}(?:\.[0-9]{1,3})?|26\.3))-[0-9]+\.[0-9]+\.[0-9]+$/u.exec(server[0]!.version)?.[1];
  if (!mc || !parsed.some(row => row.group === 'net.minecraftforge' && row.artifact === 'bootstrap')) throw denied();
  const directories = new Map<string, string>(), files: { relative: string; identity: string; checksum: string }[] = [];
  const absentIndexTargets = new Set<string>();
  async function absent(relative: string) {
    try { await lstat(path.join(root, relative)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    throw denied();
  }
  let totalBytes = 0, versionVerified = false;
  for (const row of parsed) {
    const parts = row.relative.split('/');
    for (let index = 1; index < parts.length; index++) {
      const relative = parts.slice(0, index).join('/');
      if (!directories.has(relative)) directories.set(relative, await backupDirectoryIdentity(path.join(root, relative)));
    }
    const file = await readPrivatePropertiesFile(path.join(root, row.relative), 64 * 1024 ** 2);
    totalBytes += file.bytes.length;
    if (totalBytes > 512 * 1024 ** 2 || file.checksum !== row.checksum) throw denied();
    const content = await launchMetadata(file.bytes, ['META-INF/MANIFEST.MF', 'META-INF/INDEX.LIST', 'version.json']);
    if (manifestField(content.get('META-INF/MANIFEST.MF') ?? '', 'Class-Path')) throw denied();
    const index = content.get('META-INF/INDEX.LIST');
    if (index !== undefined) {
      const blocks = index.replace(/\r\n/gu, '\n').trim().split(/\n{2,}/u);
      if (blocks.shift() !== 'JarIndex-Version: 1.0' || blocks.length > 256) throw denied();
      for (const block of blocks) {
        const [name, ...packages] = block.split('\n');
        if (!name || !/^[a-zA-Z0-9_+.-]+\.jar$/u.test(name) || packages.some(item => !/^[a-zA-Z0-9_$/.-]+$/u.test(item))) throw denied();
        const relative = path.posix.join(path.posix.dirname(row.relative), name);
        if (!parsed.some(item => item.relative === relative)) { await absent(relative); absentIndexTargets.add(relative); }
      }
    }
    if (row === server[0]) {
      const version = JSON.parse(content.get('version.json') ?? 'null') as { id?: unknown; java_version?: unknown } | null;
      if (version?.id !== mc || version.java_version !== Number(java[1]) || manifestField(content.get('META-INF/MANIFEST.MF') ?? '', 'Main-Class') !== 'net.minecraft.server.Main') throw denied();
      versionVerified = true;
    }
    files.push({ relative: row.relative, identity: file.identity, checksum: file.checksum });
  }
  if (!versionVerified) throw denied();
  for (const [relative, identity] of directories) if (await backupDirectoryIdentity(path.join(root, relative)) !== identity) throw denied();
  for (const row of files) {
    const current = await readPrivatePropertiesFile(path.join(root, row.relative), 64 * 1024 ** 2);
    if (current.identity !== row.identity || current.checksum !== row.checksum) throw denied();
  }
  const final = await readPrivatePropertiesFile(launcher, 64 * 1024 ** 2);
  for (const relative of absentIndexTargets) await absent(relative);
  if (final.identity !== outer.identity || final.checksum !== outer.checksum || await backupDirectoryIdentity(root) !== rootIdentity) throw denied();
  return { version: mc, forgeVersion: server[0]!.version, requiredMajor: Number(java[1]), fileCount: files.length + 1,
    identitySha256: sha(Buffer.from(JSON.stringify({ rootIdentity, outer: [outer.identity, outer.checksum], directories: [...directories], files, absentIndexTargets: [...absentIndexTargets] }))) };
}
