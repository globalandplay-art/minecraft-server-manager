// Separate Fabric opt-in; no Paper-only classifier is broadened here.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exactJoml108Block, joml108Profile, verifyDiagnosticDependencies } from './phase55-diagnostic-dependencies.mjs';
export const fabricDiagnosticProfile = Object.freeze({ joml: joml108Profile,
  loader: Object.freeze({ target: '.fabric/server/fabric-loader-server-0.19.5-minecraft-26.2.jar',
    sha256: '20605fd4fb6ffa5e5aab7c81522f390f27bf3b0b8d15a0a25d54e8b331cd545a' }) });
export async function verifyFabricDiagnosticFiles(manifest, serverRoot, baseline) {
  if (!/^[a-f0-9]{64}$/u.test(manifest?.fabricExecutionSha256 ?? '')) return { files: {}, rootIdentity: null, manifestSha256: manifest?.manifestSha256 };
  return verifyDiagnosticDependencies(manifest, serverRoot, baseline, 'fabric', fabricDiagnosticProfile);
}
const sha = (value) => /^[a-f0-9]{64}$/u.test(value ?? '');
const javaUrl = (file) => pathToFileURL(file).href.replace(/^file:\/\//u, 'file:');
function trustedFabric(context) {
  if (context?.kind !== 'fabric' || context.javaMajor !== 25 || context.minecraftVersion !== '26.2' || context.loaderVersion !== '0.19.5' ||
      typeof context.launchId !== 'string' || !context.launchId || context.captureSessionId !== context.launchId ||
      typeof context.serverRoot !== 'string' || !path.isAbsolute(context.serverRoot) || !sha(context.manifestSha256) ||
      !sha(context.rootIdentity) || context.isolationRootIdentity !== context.rootIdentity) return false;
  return Object.entries(fabricDiagnosticProfile).every(([key, profile]) => {
    const file = context.files?.[key]; const parts = profile.target.split('/');
    return file?.verified === true && file.target === profile.target && file.sha256 === profile.sha256 &&
      sha(file.identity) && sha(file.sourceIdentity) && file.manifestSha256 === context.manifestSha256 &&
      file.fileUrl === javaUrl(path.join(context.serverRoot, profile.target)) && Array.isArray(file.directories) &&
      file.directories.length === parts.length && file.directories.every((directory, n) =>
        directory.directory === path.join(context.serverRoot, ...parts.slice(0, n)) && sha(directory.identity) &&
        (n !== 0 || directory.identity === context.rootIdentity));
  });
}
export function recognizeFabricDiagnostics(surfaces, context) {
  const recognized = []; const covered = new Set();
  if (!trustedFabric(context)) return { recognized, covered };
  const lines = surfaces.stderr.split(/\r?\n/u);
  for (let n = 0; n < lines.length; n++) {
    const block = exactJoml108Block(lines, n, context.files.joml.fileUrl); if (!block) continue;
    recognized.push({ classification: 'fabric-java25-joml-1.10.8-unsafe-deprecation', status: 'conditionally-recognized',
      launchId: context.launchId, source: 'stderr', line: n + 1, text: block.join('\n'),
      manifestSha256: context.manifestSha256, rootIdentity: context.rootIdentity,
      dependencyIdentity: context.files.joml.identity, dependencySha256: context.files.joml.sha256 });
    block.forEach((_, offset) => covered.add(`stderr:${n + offset + 1}`));
  }
  return { recognized, covered };
}
