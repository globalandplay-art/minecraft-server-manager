import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { backupDirectoryIdentity } from './backup-identity.js';
import { DomainError } from './domain-errors.js';
import { readPrivatePropertiesFile } from './properties-private-file.js';
import { launchMetadata, manifestField } from './fabric-launch-binding.js';

const denied = () => new Error('unsupported-neoforge-launch-binding');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// Exact official 26.3.0.95 Windows descriptor. Neither file is ever executed.
const anchorSha = 'daa5720555175902c75914dd82bf8d602d39ee9a53500a27f52e99643c968c3a';
const argsSha = 'cace6e653aa57f46d99859304a74f7d01c71223ad485a1ff79490d3674e2161f';
const argsFile = 'libraries/net/neoforged/neoforge/26.3.0.95/win_args.txt';
const game = 'libraries/net/neoforged/minecraft-server-patched/26.3.0.95/minecraft-server-patched-26.3.0.95.jar';
const universal = 'libraries/net/neoforged/neoforge/26.3.0.95/neoforge-26.3.0.95-universal.jar';
const loader = 'libraries/net/neoforged/fancymodloader/loader/12.0.12/loader-12.0.12.jar';

export function assertNeoForgeEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  if (Object.entries(environment).some(([key, value]) => value && (key.toUpperCase() === 'MOD_CLASSES' || key.toUpperCase().startsWith('LOG4J')))) {
    throw new DomainError(409, 'ACTION_UNAVAILABLE', 'NeoForge 环境存在未绑定的启动覆盖', 'neoforge-environment-override');
  }
}

async function assertProductionClasspath(bytes: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? denied()); return; }
      let count = 0;
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', entry => {
        if (++count > 100000 || /^(?:META-INF\/versions\/[0-9]+\/)?(?:net\/minecraft\/(?:DetectedVersion|SharedConstants|client\/Minecraft)\.class|(?:data|assets)\/\.mcassetsroot|net\/neoforged\/neoforge\/(?:common\/NeoForgeMod|client\/ClientNeoForgeMod)\.class)$/u.test(entry.fileName)) {
          zip.close(); reject(denied()); return;
        }
        zip.readEntry();
      });
      zip.readEntry();
    });
  });
}

type ContentRole = 'game' | 'universal' | 'loader' | 'ordinary';
type ContentFacts = { readonly indexNames: readonly string[] };
type ContentCache = { readonly entries: Map<string, ContentFacts>; retainedBytes: number };

/** Pure facts about bytes only. No filesystem identity, ownership or absence proof is cached. */
async function inspectContent(bytes: Buffer, role: ContentRole, productionClasspath: boolean): Promise<ContentFacts> {
  if (productionClasspath) await assertProductionClasspath(bytes);
  const metadata = await launchMetadata(bytes, ['META-INF/MANIFEST.MF', 'META-INF/INDEX.LIST', 'version.json']);
  const manifest = metadata.get('META-INF/MANIFEST.MF') ?? '';
  if (manifestField(manifest, 'Class-Path')) throw denied();
  const indexNames: string[] = [];
  const index = metadata.get('META-INF/INDEX.LIST');
  if (index !== undefined) {
    const blocks = index.replace(/\r\n/gu, '\n').trim().split(/\n{2,}/u);
    if (blocks.shift() !== 'JarIndex-Version: 1.0' || blocks.length > 256) throw denied();
    for (const block of blocks) {
      const [name, ...packages] = block.split('\n');
      if (!name || !/^[a-zA-Z0-9_+.-]+\.jar$/u.test(name) || packages.some(value => !/^[a-zA-Z0-9_$/.-]+$/u.test(value))) throw denied();
      indexNames.push(name);
    }
  }
  if (role === 'game') {
    const version = JSON.parse(metadata.get('version.json') ?? 'null') as { id?: unknown; java_version?: unknown } | null;
    if (version?.id !== '26.3' || version.java_version !== 25 || manifestField(manifest, 'Main-Class') !== 'net.minecraft.server.Main' || manifestField(manifest, 'Multi-Release') !== undefined) throw denied();
  }
  if (role === 'universal' && manifestField(manifest, 'FML-System-Mods') !== 'neoforge') throw denied();
  if (role === 'loader' && manifestField(manifest, 'Build-Number') !== '12.0.12') throw denied();
  return Object.freeze({ indexNames: Object.freeze(indexNames) });
}

/** Private pure-content scope. Default callers dispose after one identity; an admitted install may share it until finally. */
export function createScopedNeoForgeBindingReader(): typeof captureNeoForgeLaunchBinding & { dispose(): void } {
  const cache: ContentCache = { entries: new Map(), retainedBytes: 0 };
  let disposed = false;
  return Object.assign((root: string, anchor: string) => disposed ? Promise.reject(denied()) : captureBinding(root, anchor, cache), {
    dispose() { disposed = true; cache.entries.clear(); cache.retainedBytes = 0; }
  });
}

/** Bind a selected local installation; observed JAR hashes are drift evidence, not publisher signatures. */
export async function captureNeoForgeLaunchBinding(root: string, anchor: string) {
  return captureBinding(root, anchor);
}

async function captureBinding(root: string, anchor: string, cache?: ContentCache) {
  const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (path.basename(anchor) !== 'run.bat' || normalize(path.dirname(anchor)) !== normalize(root) || root.includes(path.delimiter) || /[\r\n]/u.test(root)) throw denied();
  const rootIdentity = await backupDirectoryIdentity(root);
  const directories = new Map<string, string>();
  async function parents(relative: string) {
    const parts = relative.split('/');
    for (let index = 1; index < parts.length; index++) {
      const directory = parts.slice(0, index).join('/');
      if (!directories.has(directory)) directories.set(directory, await backupDirectoryIdentity(path.join(root, directory)));
    }
  }
  await parents(argsFile);
  const batch = await readPrivatePropertiesFile(anchor, 65536);
  const descriptor = await readPrivatePropertiesFile(path.join(root, argsFile), 65536);
  if (batch.checksum !== anchorSha || descriptor.checksum !== argsSha) throw denied();
  const lines = descriptor.bytes.toString('utf8').trim().split(/\r?\n/u);
  const classpath = lines[5]?.split(';') ?? [];
  if (lines.length !== 10 || classpath.length !== 66 || new Set(classpath.map(value => value.toLowerCase())).size !== classpath.length) throw denied();
  const relatives = [...new Set([...classpath, game, universal])];
  const files: { relative: string; identity: string; checksum: string }[] = [];
  const absentTargets = new Set<string>();
  async function absent(relative: string) {
    try { await lstat(path.join(root, relative)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    throw denied();
  }
  let total = 0;
  for (const relative of relatives) {
    if (!/^libraries\/[a-zA-Z0-9_+./-]+\.jar$/u.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw denied();
    await parents(relative);
    const file = await readPrivatePropertiesFile(path.join(root, relative), 64 * 1024 ** 2);
    total += file.bytes.length;
    if (total > 512 * 1024 ** 2) throw denied();
    const role: ContentRole = relative === game ? 'game' : relative === universal ? 'universal' : relative === loader ? 'loader' : 'ordinary';
    const productionClasspath = classpath.includes(relative);
    const key = `${role}:${productionClasspath}:${file.checksum}`;
    let facts = cache?.entries.get(key);
    if (!facts) {
      facts = await inspectContent(file.bytes, role, productionClasspath);
      const retainedBytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(facts)) + 128;
      // Saturation only disables reuse, never validation or admission.
      if (cache && cache.entries.size < 68 && cache.retainedBytes + retainedBytes <= 8 * 1024 ** 2) {
        cache.entries.set(key, facts); cache.retainedBytes += retainedBytes;
      }
    }
    // Resolve INDEX names against this file's current location; absence is always fresh.
    for (const name of facts.indexNames) {
      const target = path.posix.join(path.posix.dirname(relative), name);
      if (!relatives.includes(target)) { await absent(target); absentTargets.add(target); }
    }
    files.push({ relative, identity: file.identity, checksum: file.checksum });
  }
  for (const [relative, identity] of directories) if (await backupDirectoryIdentity(path.join(root, relative)) !== identity) throw denied();
  for (const file of files) {
    const current = await readPrivatePropertiesFile(path.join(root, file.relative), 64 * 1024 ** 2);
    if (current.identity !== file.identity || current.checksum !== file.checksum) throw denied();
  }
  for (const [file, before] of [[anchor, batch], [path.join(root, argsFile), descriptor]] as const) {
    const current = await readPrivatePropertiesFile(file, 65536);
    if (current.identity !== before.identity || current.checksum !== before.checksum) throw denied();
  }
  for (const target of absentTargets) await absent(target);
  if (await backupDirectoryIdentity(root) !== rootIdentity) throw denied();
  return {
    version: '26.3', requiredMajor: 25, fileCount: files.length + 2,
    identitySha256: hash(Buffer.from(JSON.stringify({ rootIdentity, anchor: [batch.identity, batch.checksum], args: [descriptor.identity, descriptor.checksum], directories: [...directories], files, absentTargets: [...absentTargets] }))),
    argv: ['--add-opens', 'java.base/java.lang.invoke=ALL-UNNAMED', '--add-exports', 'jdk.naming.dns/com.sun.jndi.dns=java.naming',
      '-Djava.net.preferIPv6Addresses=system', `-DlibraryDirectory=${path.join(root, 'libraries')}`, '-classpath', classpath.map(value => path.join(root, value)).join(path.delimiter),
      'net.neoforged.fml.startup.Server', '--fml.neoForgeVersion', '26.3.0.95', '--fml.mcVersion', '26.3', '--fml.neoFormVersion', '1']
  };
}
