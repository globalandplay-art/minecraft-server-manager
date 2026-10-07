// Acceptance diagnostics only. Original worlds are never read or modified.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyDiagnosticText, diagnosticsAllowed, fabricFinalDiagnosticsAllowed, readinessRequirements } from './import-diagnostics.mjs';
import { paperDiagnosticProfile } from './phase55-paper-diagnostics.mjs';

const profile = paperDiagnosticProfile.joml;
const root = path.resolve('synthetic-fabric-isolation');
const loader = { target: '.fabric/server/fabric-loader-server-0.19.5-minecraft-26.2.jar', sha256: '20605fd4fb6ffa5e5aab7c81522f390f27bf3b0b8d15a0a25d54e8b331cd545a' };
const javaUrl = (file) => pathToFileURL(file).href.replace(/^file:\/\//u, 'file:');
const lines = (url = javaUrl(path.join(root, profile.target))) => [
  'WARNING: A terminally deprecated method in sun.misc.Unsafe has been called',
  `WARNING: sun.misc.Unsafe::objectFieldOffset has been called by org.joml.MemUtil$MemUtilUnsafe (${url})`,
  'WARNING: Please consider reporting this to the maintainers of class org.joml.MemUtil$MemUtilUnsafe',
  'WARNING: sun.misc.Unsafe::objectFieldOffset will be removed in a future release'
];
const context = () => ({ kind: 'fabric', minecraftVersion: '26.2', loaderVersion: '0.19.5', javaMajor: 25,
  launchId: 'fresh-fabric:123', captureSessionId: 'fresh-fabric:123', serverRoot: root,
  rootIdentity: 'd'.repeat(64), isolationRootIdentity: 'd'.repeat(64), manifestSha256: 'a'.repeat(64),
  files: Object.fromEntries(Object.entries({ joml: profile, loader }).map(([key, value]) => [key,
    { ...value, verified: true, identity: 'b'.repeat(64), sourceIdentity: 'c'.repeat(64), manifestSha256: 'a'.repeat(64),
      fileUrl: javaUrl(path.join(root, value.target)), directories: value.target.split('/').map((_, n, parts) =>
        ({ directory: path.join(root, ...parts.slice(0, n)), identity: 'd'.repeat(64) })) }])) });
const ready = { ...Object.fromEntries(readinessRequirements.map((key) => [key, true])), ownedChildIdentityValid: true };
const classify = (stderr = lines().join('\n'), ctx = context(), extra = {}) => classifyDiagnosticText({ stderr, fabricContext: ctx, ...extra });
const allowed = (value, readiness = ready) => diagnosticsAllowed(value, readiness);
const final = { explicitManagerNormalStop: true, exitCode: 0, exitSignal: null, outputPipesClosed: true, finalStopped: true, recoveryRequired: false };
const resultEvents = (value) => value.classifiedFabricDiagnostics ?? [];

// Negative cases are authored before implementation.
for (const [name, text] of [
  ['1.10.7 CASE5', lines().join('\n').replaceAll('1.10.8', '1.10.7')],
  ['one line CASE9', lines().slice(0, 1).join('\n')], ['two lines CASE10', lines().slice(0, 2).join('\n')],
  ['three lines CASE11', lines().slice(0, 3).join('\n')], ['reordered CASE12', [lines()[1], lines()[0], ...lines().slice(2)].join('\n')],
  ['other method CASE13', lines().join('\n').replaceAll('objectFieldOffset', 'allocateMemory')],
  ['other caller CASE14', lines().join('\n').replaceAll('MemUtilUnsafe', 'OtherUnsafe')],
  ['unknown WARN CASE20', lines().join('\n') + '\nWARNING: unknown warning'],
  ['unknown ERROR CASE20', lines().join('\n') + '\nERROR unknown failure'],
  ['real JVM exception', lines().join('\n') + '\njava.lang.UnsupportedOperationException: denied']
]) test('Fabric blocks ' + name, () => assert.equal(allowed(classify(text)), false));
for (const source of ['stdout', 'log']) test('Fabric blocks non-stderr source CASE15 ' + source, () => {
  assert.equal(allowed(classify('', context(), { [source]: lines().join('\n') })), false);
});
for (const [name, mutate] of [
  ['bad SHA CASE7', (ctx) => { ctx.files.joml.sha256 = 'e'.repeat(64); }],
  ['missing identity CASE8', (ctx) => { delete ctx.files.joml.identity; }],
  ['missing entry CASE8', (ctx) => { delete ctx.files.joml; }],
  ['Java24 CASE16', (ctx) => { ctx.javaMajor = 24; }],
  ['wrong kind CASE17', (ctx) => { ctx.kind = 'paper'; }],
  ['unverified SHA', (ctx) => { ctx.files.joml.verified = false; }],
  ['wrong current manifest', (ctx) => { ctx.files.joml.manifestSha256 = 'e'.repeat(64); }],
  ['missing source identity', (ctx) => { delete ctx.files.joml.sourceIdentity; }],
  ['missing directory identities', (ctx) => { delete ctx.files.joml.directories; }],
  ['changed directory binding', (ctx) => { ctx.files.joml.directories[0].identity = 'e'.repeat(64); }],
  ['missing loader proof', (ctx) => { delete ctx.files.loader; }],
  ['wrong isolated root', (ctx) => { ctx.isolationRootIdentity = 'e'.repeat(64); }],
  ['another launch/session', (ctx) => { ctx.captureSessionId = 'other-session'; }],
  ['wrong file URL', (ctx) => { ctx.files.joml.fileUrl = 'file:/outside/joml-1.10.8.jar'; }],
  ['wrong Minecraft', (ctx) => { ctx.minecraftVersion = 'other'; }],
  ['wrong loader', (ctx) => { ctx.loaderVersion = 'other'; }]
]) test('Fabric rejects evidence ' + name, () => { const ctx = context(); mutate(ctx); assert.equal(allowed(classify(undefined, ctx)), false); });
for (const key of [...readinessRequirements, 'ownedChildIdentityValid']) test('Fabric requires health CASE18 ' + key, () => {
  assert.equal(allowed(classify(), { ...ready, [key]: false }), false);
  const missing = { ...ready }; delete missing[key]; assert.equal(allowed(classify(), missing), false);
});
for (const key of Object.keys(final)) test('Fabric final requires CASE19 ' + key, () => {
  const missing = { ...final }; delete missing[key]; assert.equal(fabricFinalDiagnosticsAllowed(classify(), ready, missing), false);
});
test('Fabric blocks premature exit, unauthorized stop and capture overflow', () => {
  for (const extra of [{ prematureExit: true }, { captureOverflow: true }, { log: 'Stopping server' }]) assert.equal(allowed(classify(undefined, context(), extra)), false);
});
test('Fabric baseline expected recognition CASE1', () => {
  const input = { stderr: lines().join('\n'), fabricContext: context() }; const before = JSON.stringify(input);
  const result = classifyDiagnosticText(input);
  assert.equal(allowed(result), true); assert.equal(resultEvents(result).length, 1);
  assert.equal(resultEvents(result)[0].text, input.stderr); assert.equal(resultEvents(result)[0].source, 'stderr');
  assert.equal(result.rawDiagnosticEvents.length, 4); assert.equal(JSON.stringify(input), before);
  assert.equal(fabricFinalDiagnosticsAllowed(result, ready, final), true);
});
test('Fabric preserved real four-line block CASE2 recognizes without rewriting evidence', async () => {
  const workspace = new URL('../../', import.meta.url);
  const run = 'p55-fabric-c9b8f711-4c1a-45ca-afc7-9ca6132f360b';
  const raw = await readFile(new URL(`.manager/${run}/evidence/launch-1-stderr.log`, workspace), 'utf8');
  const ctx = context(); ctx.serverRoot = path.resolve(new URL(`runtime/${run}`, workspace).pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
  for (const file of Object.values(ctx.files)) {
    file.fileUrl = javaUrl(path.join(ctx.serverRoot, file.target));
    file.directories = file.target.split('/').map((_, n, parts) => ({ directory: path.join(ctx.serverRoot, ...parts.slice(0, n)), identity: 'd'.repeat(64) }));
  }
  const result = classify(raw, ctx); assert.equal(allowed(result), true); assert.equal(resultEvents(result).length, 1);
  assert.equal(resultEvents(result)[0].text, raw.trimEnd());
});
test('Paper1.10.8 existing rule CASE3 remains recognized', () => {
  const fabric = context(); const paper = { kind: 'paper', javaMajor: 25, launchId: 'paper:123', manifestSha256: fabric.manifestSha256,
    files: { ...fabric.files, paper: { ...paperDiagnosticProfile.paper, verified: true, identity: 'paper-identity', manifestSha256: fabric.manifestSha256 } } };
  const result = classifyDiagnosticText({ stderr: lines().join('\n'), paperContext: paper });
  assert.equal(allowed(result), true); assert.equal(result.classifiedPaperDiagnostics.length, 1); assert.equal(resultEvents(result).length, 0);
});
test('shared1.10.9 CASE4 remains exact and does not enter Fabric1.10.8 CASE6', () => {
  const result = classify(lines().join('\n').replaceAll('1.10.8', '1.10.9'));
  assert.equal(allowed(result), true); assert.equal(resultEvents(result).length, 0);
  assert.equal(result.classifiedJavaWarnings[0].classification, 'java25-joml-unsafe-deprecation');
});
test('Fabric physical manifest proof rejects replacement, SHA changes and root rebinding', async () => {
  const { verifyFabricDiagnosticFiles } = await import('./phase55-fabric-diagnostics.mjs');
  const workspace = new URL('../../', import.meta.url); const run = 'p55-fabric-c9b8f711-4c1a-45ca-afc7-9ca6132f360b';
  const manifest = JSON.parse(await readFile(new URL(`.manager/${run}/source-manifest.json`, workspace), 'utf8'));
  const fixture = await mkdtemp(path.join(tmpdir(), 'p55-fabric-proof-'));
  try {
    for (const entry of [profile, loader]) {
      const destination = path.join(fixture, entry.target); await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(new URL(`runtime/${run}/${entry.target}`, workspace), destination);
    }
    const file = path.join(fixture, profile.target);
    const baseline = await verifyFabricDiagnosticFiles(manifest, fixture); assert.equal(baseline.files.joml.verified, true);
    assert.deepEqual(await verifyFabricDiagnosticFiles(manifest, fixture, baseline), baseline);
    await rename(file, file + '.old'); await copyFile(file + '.old', file);
    assert.equal((await verifyFabricDiagnosticFiles(manifest, fixture, baseline)).files.joml, undefined);
    const nextBaseline = await verifyFabricDiagnosticFiles(manifest, fixture);
    const directory = path.dirname(file); await rename(directory, directory + '.old'); await mkdir(directory);
    await rename(path.join(directory + '.old', path.basename(file)), file);
    assert.equal((await verifyFabricDiagnosticFiles(manifest, fixture, nextBaseline)).files.joml, undefined, 'directory replaced, original file inode preserved');
    const rebound = path.join(fixture, 'another-isolated-root'); await mkdir(rebound);
    for (const entry of [profile, loader]) {
      const destination = path.join(rebound, entry.target); await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(new URL(`runtime/${run}/${entry.target}`, workspace), destination);
    }
    assert.deepEqual((await verifyFabricDiagnosticFiles(manifest, rebound, baseline)).files, {}, 'different canonical root rejected');
    await writeFile(file, 'wrong bytes'); assert.equal((await verifyFabricDiagnosticFiles(manifest, fixture)).files.joml, undefined);
    const altered = structuredClone(manifest); delete altered.manifestSha256;
    altered.files = altered.files.filter((entry) => entry.target !== profile.target);
    altered.manifestSha256 = createHash('sha256').update(JSON.stringify(altered)).digest('hex');
    assert.equal((await verifyFabricDiagnosticFiles(altered, fixture)).files.joml, undefined);
    assert.deepEqual((await verifyFabricDiagnosticFiles(altered, fixture, baseline)).files, {});
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
test('Fabric final gate rejects unsuccessful stop/exit/recovery even with recognized text', () => {
  for (const delta of [{ explicitManagerNormalStop: false }, { exitCode: 1 }, { exitSignal: 'SIGTERM' },
    { outputPipesClosed: false }, { finalStopped: false }, { recoveryRequired: true }])
    assert.equal(fabricFinalDiagnosticsAllowed(classify(), ready, { ...final, ...delta }), false);
});
test('Fabric exact block plus unknown duplicate on stdout remains blocking', () => {
  assert.equal(allowed(classify(undefined, context(), { stdout: lines().join('\n') })), false);
});
