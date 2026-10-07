// Shared physical checks only. Kind-specific wrappers own their exact profiles.
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (file) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const identity = (stat) => hash(`${stat.dev}\0${stat.ino}\0${stat.birthtimeMs}`);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

export async function verifyDiagnosticDependencies(manifest, serverRoot, baseline, expectedKind, profiles) {
  const proof = { files: {}, manifestSha256: manifest?.manifestSha256, rootIdentity: null };
  const { manifestSha256, ...content } = manifest ?? {};
  if (content.kind !== expectedKind || content.minecraftVersion !== '26.2' || content.requiredJavaMajor !== 25 ||
      hash(JSON.stringify(content)) !== manifestSha256 || !Array.isArray(content.files)) return proof;
  const root = await lstat(serverRoot);
  if (!root.isDirectory() || root.isSymbolicLink() || normalize(await realpath(serverRoot)) !== normalize(serverRoot)) return proof;
  proof.rootIdentity = identity(root);
  if (baseline && (baseline.rootIdentity !== proof.rootIdentity || baseline.manifestSha256 !== manifestSha256)) return proof;
  for (const [key, profile] of Object.entries(profiles)) {
    const entries = content.files.filter((entry) => entry.target === profile.target);
    if (entries.length !== 1 || entries[0].sha256 !== profile.sha256 || typeof entries[0].identity !== 'string' ||
        (entries[0].expectedSha256 && entries[0].expectedSha256 !== profile.sha256) || (baseline && !baseline.files[key])) continue;
    try {
      const directories = [];
      const parts = profile.target.split('/');
      for (let n = 0; n < parts.length; n++) {
        const directory = path.join(serverRoot, ...parts.slice(0, n)); const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || normalize(await realpath(directory)) !== normalize(directory)) throw new Error('noncanonical diagnostic dependency directory');
        directories.push({ directory, identity: identity(stat) });
      }
      const file = path.join(serverRoot, profile.target); const before = await lstat(file);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 64 * 1024 ** 2 || normalize(await realpath(file)) !== normalize(file)) continue;
      const handle = await open(file, 'r'); let sha256;
      try {
        if (!same(before, await handle.stat())) continue;
        sha256 = hash(await handle.readFile());
        if (!same(before, await handle.stat()) || !same(before, await lstat(file))) continue;
      } finally { await handle.close(); }
      for (const dir of directories) if (identity(await lstat(dir.directory)) !== dir.identity) throw new Error('diagnostic dependency directory changed');
      const current = { ...profile, verified: true, identity: identity(before), sourceIdentity: entries[0].identity,
        manifestSha256, fileUrl: pathToFileURL(file).href.replace(/^file:\/\//u, 'file:'), directories };
      if (sha256 !== profile.sha256 || (baseline && JSON.stringify(baseline.files[key]) !== JSON.stringify(current))) continue;
      proof.files[key] = current;
    } catch { /* Unreadable, replaced or ambiguous dependencies never authorize a diagnostic. */ }
  }
  return proof;
}

export const joml108Profile = Object.freeze({ target: 'libraries/org/joml/joml/1.10.8/joml-1.10.8.jar',
  sha256: 'bf19510145178df82cd3bd37edd514c13f411531ec5545299fd3abcbc98fe7c2' });
export function exactJoml108Block(lines, start, fileUrl) {
  const expected = ['WARNING: A terminally deprecated method in sun.misc.Unsafe has been called',
    `WARNING: sun.misc.Unsafe::objectFieldOffset has been called by org.joml.MemUtil$MemUtilUnsafe (${fileUrl})`,
    'WARNING: Please consider reporting this to the maintainers of class org.joml.MemUtil$MemUtilUnsafe',
    'WARNING: sun.misc.Unsafe::objectFieldOffset will be removed in a future release'];
  return expected.every((line, offset) => lines[start + offset] === line) ? expected : null;
}
