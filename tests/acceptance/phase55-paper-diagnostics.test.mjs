// Synthetic diagnostics only: never start Java or read original server files.
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDiagnosticText, diagnosticsAllowed, readinessRequirements, paperFinalDiagnosticsAllowed } from './import-diagnostics.mjs';
import { paperDiagnosticProfile, verifyPaperDiagnosticFiles } from './phase55-paper-diagnostics.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, rename, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const frames = [
  'sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:277)', 'sun.nio.ch.NioSocketImpl.implRead(NioSocketImpl.java:302)',
  'sun.nio.ch.NioSocketImpl.read(NioSocketImpl.java:354)', 'sun.nio.ch.NioSocketImpl$1.read(NioSocketImpl.java:798)',
  'java.net.Socket$SocketInputStream.implRead(Socket.java:974)', 'java.net.Socket$SocketInputStream.read(Socket.java:964)',
  'sun.security.ssl.SSLSocketInputRecord.read(SSLSocketInputRecord.java:489)', 'sun.security.ssl.SSLSocketInputRecord.readHeader(SSLSocketInputRecord.java:483)',
  'sun.security.ssl.SSLSocketInputRecord.decode(SSLSocketInputRecord.java:160)', 'sun.security.ssl.SSLTransport.decode(SSLTransport.java:111)',
  'sun.security.ssl.SSLSocketImpl.decode(SSLSocketImpl.java:1506)', 'sun.security.ssl.SSLSocketImpl.readHandshakeRecord(SSLSocketImpl.java:1421)',
  'sun.security.ssl.SSLSocketImpl.startHandshake(SSLSocketImpl.java:455)', 'sun.security.ssl.SSLSocketImpl.startHandshake(SSLSocketImpl.java:426)',
  'sun.net.www.protocol.https.HttpsClient.afterConnect(HttpsClient.java:490)',
  'sun.net.www.protocol.https.AbstractDelegateHttpsURLConnection.connect(AbstractDelegateHttpsURLConnection.java:190)',
  'sun.net.www.protocol.http.HttpURLConnection.getInputStream0(HttpURLConnection.java:1379)',
  'sun.net.www.protocol.http.HttpURLConnection.getInputStream(HttpURLConnection.java:1305)',
  'sun.net.www.protocol.https.HttpsURLConnectionImpl.getInputStream(HttpsURLConnectionImpl.java:223)'
];
const suffix = ['java.util.concurrent.CompletableFuture$AsyncRun.run(CompletableFuture.java:1825)',
  'java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1090)',
  'java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:614)', 'java.lang.Thread.run(Thread.java:1474)'];
const frame = (text) => '\tat java.base/' + text + ' ~[?:?]';
const head = '[19:46:08] [Paper Async Task Handler Thread - 1/ERROR]: [PaperVersionFetcher] Error while parsing version list';
const stack = ['java.net.SocketTimeoutException: Read timed out', ...frames.map(frame),
  '\tat com.destroystokyo.paper.PaperVersionFetcher.fetchMinecraftVersionList(PaperVersionFetcher.java:150) ~[paper-26.2.jar:?]',
  '\tat com.destroystokyo.paper.PaperVersionFetcher.getUpdateStatusStartupMessage(PaperVersionFetcher.java:74) ~[paper-26.2.jar:?]',
  ...suffix.map(frame)].join('\n');
const query = head + '\n' + stack;
const tail = '[19:46:13] [Paper Async Task Handler Thread - 1/ERROR]: *** Error obtaining version information! Cannot fetch version info ***';
const terminal = '2026-10-07T11:45:53.170239Z ServerMain WARN Advanced terminal features are not available in this environment';
const jarUrl = 'file:/isolation/libraries/org/joml/joml/1.10.8/joml-1.10.8.jar';
const jomlLines = ['WARNING: A terminally deprecated method in sun.misc.Unsafe has been called',
  `WARNING: sun.misc.Unsafe::objectFieldOffset has been called by org.joml.MemUtil$MemUtilUnsafe (${jarUrl})`,
  'WARNING: Please consider reporting this to the maintainers of class org.joml.MemUtil$MemUtilUnsafe',
  'WARNING: sun.misc.Unsafe::objectFieldOffset will be removed in a future release'];
const context = () => ({ kind: 'paper', javaMajor: 25, launchId: 'fresh:1234', manifestSha256: 'a'.repeat(64),
  startupWindow: { spawnedAt: '2026-10-07T11:45:52.000Z', doneAt: '2026-10-07T11:46:03.000Z' },
  files: Object.fromEntries(Object.entries(paperDiagnosticProfile).map(([key, value]) => [key,
    { ...value, verified: true, manifestSha256: 'a'.repeat(64), identity: key + '-identity', fileUrl: key === 'joml' ? jarUrl : 'file:/isolation/' + value.target }])) });
const ready = { ...Object.fromEntries(readinessRequirements.map((key) => [key, true])), ownedChildIdentityValid: true };
const classify = (log = query + '\n' + tail, stderr = '', paperContext = context(), extra = {}) =>
  classifyDiagnosticText({ log, stderr, paperContext, ...extra });
const allowed = (result, readiness = ready) => diagnosticsAllowed(result, readiness);

// Terminal timestamp precision: only the two observed forms are supported.
for (const precision of ['170239', '170239900']) test(`terminal accepts observed ${precision.length}-digit precision and preserves raw text`, () => {
  const text = terminal.replace('170239', precision);
  const result = classify('', text);
  assert.equal(allowed(result), true);
  assert.equal(result.classifiedPaperDiagnostics[0].text, text);
  assert(result.rawDiagnosticEvents.some((event) => event.text === text));
});
for (const precision of ['', '1', '17023', '1702399', '17023990', '1702399000', '170239abc']) test(`terminal rejects unsupported precision ${JSON.stringify(precision)}`, () => {
  assert.equal(allowed(classify('', terminal.replace('170239', precision))), false);
});
test('nine-digit terminal retains stage, dependency, thread, message and readiness gates', () => {
  const text = terminal.replace('170239', '170239900');
  for (const altered of [text + '!', text.replace('ServerMain', 'Worker'), text.replace(' WARN ', ' ERROR '), text.replace('11:45:53', '11:46:04')])
    assert.equal(allowed(classify('', altered)), false);
  const ctx = context(); ctx.files.terminal.sha256 = 'b'.repeat(64);
  assert.equal(allowed(classify('', text, ctx)), false);
  assert.equal(allowed(classify('', text), { ...ready, freshDone: false }), false);
});

// Attempt #2: canonical association cases are specified BEFORE its implementation.
const pair = query + '\n' + tail;
const copySurface = (text) => text.replaceAll('[19:46:08] [Paper Async Task Handler Thread - 1/ERROR]:', '[19:46:08 ERROR]:')
  .replaceAll('[19:46:13] [Paper Async Task Handler Thread - 1/ERROR]:', '[19:46:13 ERROR]:');
const recognizedQueries = (result) => result.classifiedPaperDiagnostics.filter((event) => event.classification === 'paper-version-check-tls-read-timeout');
const recognizedTails = (result) => result.classifiedPaperDiagnostics.filter((event) => event.classification === 'paper-version-check-correlated-result');
test('one-shot CASE 2: one query never authorizes two identical tails', () => {
  const result = classify(pair + '\n' + tail); assert.equal(allowed(result), false);
  assert.equal(recognizedTails(result).length, 1);
});
test('one-shot CASE 4: copied query does not authorize surplus tail', () => {
  assert.equal(allowed(classify(pair + '\n' + tail, '', context(), { stdout: copySurface(pair + '\n' + tail) })), false);
});
test('one-shot CASE 6: two actual queries never authorize a third tail', () => {
  const result = classify(pair + '\n' + pair + '\n' + tail);
  assert.equal(allowed(result), false); assert.equal(recognizedTails(result).length, 2);
});
test('one-shot CASE 7: orphan tail blocks', () => assert.equal(allowed(classify(tail)), false));
test('one-shot CASE 8: tail cannot associate forward', () => assert.equal(allowed(classify(tail + '\n' + query)), false));
test('one-shot CASE 9: prior launch evidence cannot authorize another session', () => {
  const a = context(); a.launchId = 'launch-A'; const first = classify(query, '', a);
  const b = context(); b.launchId = 'launch-B'; const second = classify(tail, '', b);
  assert.equal(allowed(first), true); assert.equal(allowed(second), false);
});
test('one-shot CASE 10: incomplete exception cannot authorize tail', () => assert.equal(allowed(classify(head + '\njava.net.SocketTimeoutException: Read timed out\n' + tail)), false));
test('one-shot CASE 13: later isolated tail remains blocking after a valid pair', () => {
  assert.equal(allowed(classify(pair + '\n[19:46:14] [Server thread/INFO]: unrelated\n' + tail)), false);
});
test('one-shot CASE 14: unrelated error after pair stays blocking', () => assert.equal(allowed(classify(pair + '\n[19:46:14] [Server thread/ERROR]: actual failure')), false));
test('one-shot inspected list/build invocation closes both query evidences with its one root tail', () => {
  const builds = query.replace('version list', 'version').replace('fetchMinecraftVersionList(PaperVersionFetcher.java:150)', 'fetchDistanceFromSiteApi(PaperVersionFetcher.java:209)').replace('PaperVersionFetcher.java:74', 'PaperVersionFetcher.java:76').replaceAll('19:46:08', '19:46:13');
  const result = classify(query + '\n' + builds + '\n' + tail + '\n' + tail);
  assert.equal(allowed(result), false); assert.equal(recognizedTails(result).length, 1);
});
for (const source of ['stdout', 'stderr']) test('one-shot surplus query/tail copies on ' + source + ' cannot mint evidence', () => {
  const copy = source === 'stdout' ? copySurface(pair + '\n' + pair) : pair + '\n' + pair;
  const result = classify(pair, '', context(), { [source]: copy });
  assert.equal(allowed(result), false);
});
test('one-shot alias tail before its query copy stays blocking', () => {
  assert.equal(allowed(classify(pair, '', context(), { stdout: copySurface(tail + '\n' + query) })), false);
});
test('one-shot aliases cannot reorder two distinct canonical events', () => {
  const second = pair.replaceAll('Thread - 1', 'Thread - 2').replaceAll('19:46:08', '19:46:09').replaceAll('19:46:13', '19:46:14');
  assert.equal(allowed(classify(pair + '\n' + second, '', context(), { stdout: copySurface(second).replaceAll('[19:46:09] [Paper Async Task Handler Thread - 2/ERROR]:', '[19:46:09 ERROR]:').replaceAll('[19:46:14] [Paper Async Task Handler Thread - 2/ERROR]:', '[19:46:14 ERROR]:') + '\n' + copySurface(pair) })), false);
});
test('one-shot CASE 1: one verified query authorizes exactly one tail', () => {
  const result = classify(pair); assert.equal(allowed(result), true);
  assert.equal(recognizedQueries(result)[0].consumed, true);
  assert.equal(recognizedTails(result)[0].queryEventId, recognizedQueries(result)[0].eventId);
});
test('one-shot CASE 3: stdout and log copies share one canonical event', () => {
  const result = classify(pair, '', context(), { stdout: copySurface(pair) }); assert.equal(allowed(result), true);
  assert.equal(new Set(recognizedQueries(result).map((event) => event.eventId)).size, 1);
});
test('one-shot CASE 5: two actual query/tail events are consumed one-to-one', () => {
  const second = pair.replaceAll('19:46:08', '19:46:09').replaceAll('19:46:13', '19:46:14');
  const result = classify(pair + '\n' + second); assert.equal(allowed(result), true);
  assert.equal(new Set(recognizedQueries(result).map((event) => event.eventId)).size, 2);
  assert.equal(new Set(recognizedTails(result).map((event) => event.queryEventId)).size, 2);
});
test('one-shot CASE 11: identical texts at distinct source occurrence indexes remain distinct real events', () => {
  const result = classify(pair + '\n' + pair, '', context(), { stdout: copySurface(pair + '\n' + pair) });
  assert.equal(allowed(result), true);
  assert.equal(new Set(recognizedQueries(result).map((event) => event.eventId)).size, 2);
  assert.equal(new Set(recognizedTails(result).map((event) => event.queryEventId)).size, 2);
});
test('one-shot CASE 12: three capture sources do not triple canonical evidence', () => {
  const result = classify(pair, pair, context(), { stdout: copySurface(pair) }); assert.equal(allowed(result), true);
  assert.equal(new Set(recognizedQueries(result).map((event) => event.eventId)).size, 1);
  assert.equal(new Set(recognizedTails(result).map((event) => event.eventId)).size, 1);
});

// Negatives are specified before the implementation and positives.
for (const [label, log] of [
  ['generic error', 'ERROR timeout'], ['wrong logger', query.replace('[PaperVersionFetcher]', '[Other]')],
  ['wrong exception', query.replace('java.net.SocketTimeoutException', 'java.net.UnknownHostException')],
  ['missing stack', head + '\njava.net.SocketTimeoutException: Read timed out'],
  ['unrelated method', query.replace('fetchMinecraftVersionList', 'unrelatedMethod')],
  ['orphan root tail', tail], ['wrong thread', query.replace('Paper Async Task Handler Thread - 1', 'Server thread')],
  ['extra cause', query + '\nCaused by: javax.net.ssl.SSLHandshakeException: bad certificate'],
  ['incomplete stack', query.split('\n').slice(0, -1).join('\n')],
  ['tail on another thread', query + '\n' + tail.replace('Thread - 1', 'Thread - 2')],
  ['crash', query + '\nA crash report has been saved'], ['early stop', query + '\nStopping server']
]) test('Paper blocks ' + label, () => assert.equal(allowed(classify(log)), false));
test('Paper orphan tail on another capture surface remains blocking', () => assert.equal(allowed(classify(query, '', context(), { stdout: '[19:46:13 ERROR]: *** Error obtaining version information! Cannot fetch version info ***' })), false));
test('Paper absent opt-in / Fabric remains blocked', () => {
  assert.equal(allowed(classify(query, '', null)), false);
  assert.equal(allowed(classify(query, '', { ...context(), kind: 'fabric' })), false);
});
for (const key of [...readinessRequirements, 'ownedChildIdentityValid']) test('Paper requires health ' + key, () => {
  assert.equal(allowed(classify(), { ...ready, [key]: false }), false);
  const incomplete = { ...ready }; delete incomplete[key]; assert.equal(allowed(classify(), incomplete), false);
});
test('Paper rejects captured premature exit and overflow', () => {
  assert.equal(allowed(classify(query, '', context(), { prematureExit: true })), false);
  assert.equal(allowed(classify(query, '', context(), { captureOverflow: true })), false);
});
for (const [label, text] of [
  ['near text', terminal + '!'], ['failed initialize', terminal.replace('Advanced terminal features are not available in this environment', 'Failed to initialize terminal. Falling back to standard console')],
  ['late phase', terminal.replace('11:45:53.170239', '11:46:04.170239')], ['wrong thread', terminal.replace('ServerMain', 'Worker')],
  ['terminal error', terminal.replace(' WARN ', ' ERROR ')]
]) test('Terminal blocks ' + label, () => assert.equal(allowed(classify('', text)), false));
test('Terminal needs health and exact dependency', () => {
  assert.equal(allowed(classify('', terminal), { ...ready, freshDone: false }), false);
  const ctx = context(); ctx.files.terminal.sha256 = 'b'.repeat(64); assert.equal(allowed(classify('', terminal, ctx)), false);
});
for (const count of [1, 2, 3]) test('JOML blocks partial ' + count, () => assert.equal(allowed(classify('', jomlLines.slice(0, count).join('\n'))), false));
for (const [label, text] of [
  ['reordered', [jomlLines[1], jomlLines[0], ...jomlLines.slice(2)].join('\n')],
  ['wrong version', jomlLines.join('\n').replaceAll('1.10.8', '1.10.7')],
  ['wrong method', jomlLines.join('\n').replaceAll('objectFieldOffset', 'allocateMemory')],
  ['wrong caller', jomlLines.join('\n').replaceAll('MemUtilUnsafe', 'OtherUnsafe')],
  ['JVM failure', jomlLines.join('\n') + '\nERROR java.lang.UnsupportedOperationException'],
  ['wrong file URL', jomlLines.join('\n').replace('file:/isolation/', 'file:/other/')]
]) test('JOML blocks ' + label, () => assert.equal(allowed(classify('', text)), false));
for (const alteration of ['unverified', 'missing', 'wrong hash', 'wrong Java', 'wrong manifest']) test('JOML blocks evidence ' + alteration, () => {
  const ctx = context();
  if (alteration === 'unverified') ctx.files.joml.verified = false;
  if (alteration === 'missing') delete ctx.files.joml;
  if (alteration === 'wrong hash') ctx.files.joml.sha256 = 'b'.repeat(64);
  if (alteration === 'wrong Java') ctx.javaMajor = 24;
  if (alteration === 'wrong manifest') ctx.files.joml.manifestSha256 = 'b'.repeat(64);
  assert.equal(allowed(classify('', jomlLines.join('\n'), ctx)), false);
});
const final = { explicitManagerNormalStop: true, exitCode: 0, exitSignal: null, outputPipesClosed: true, finalStopped: true, recoveryRequired: false };
for (const key of Object.keys(final)) test('Final lifecycle requires ' + key, () => {
  const bad = { ...final }; delete bad[key]; assert.equal(paperFinalDiagnosticsAllowed(classify(), ready, bad), false);
});
test('recognizes exact diagnostics conditionally and preserves raw occurrences', () => {
  const input = { log: query + '\n' + tail, stderr: terminal + '\n' + jomlLines.join('\n'), paperContext: context() };
  const before = JSON.stringify(input); const result = classifyDiagnosticText(input);
  assert.equal(JSON.stringify(input), before); assert.equal(allowed(result), true);
  assert.equal(result.errors.length, 2); assert.equal(result.rawDiagnosticEvents.some((event) => event.text === terminal), true);
  assert.equal(result.classifiedPaperDiagnostics.length, 4);
  assert.equal(paperFinalDiagnosticsAllowed(result, ready, final), true);
});
test('exact alternate stdout duplicates require matching current latest.log blocks', () => {
  const stdout = (query + '\n' + tail).replaceAll('[19:46:08] [Paper Async Task Handler Thread - 1/ERROR]:', '[19:46:08 ERROR]:').replaceAll('[19:46:13] [Paper Async Task Handler Thread - 1/ERROR]:', '[19:46:13 ERROR]:');
  assert.equal(allowed(classify(query + '\n' + tail, '', context(), { stdout })), true);
  assert.equal(allowed(classify('', '', context(), { stdout })), false);
});
test('second precise Paper query binds only to inspected builds endpoint', () => {
  const builds = query.replace('version list', 'version').replace('fetchMinecraftVersionList(PaperVersionFetcher.java:150)', 'fetchDistanceFromSiteApi(PaperVersionFetcher.java:209)').replace('PaperVersionFetcher.java:74', 'PaperVersionFetcher.java:76');
  const result = classify(builds);
  assert.equal(allowed(result), true);
  assert.equal(result.classifiedPaperDiagnostics[0].endpoint, 'https://fill.papermc.io/v3/projects/paper/versions/26.2/builds');
});
test('JOML accompanying real JVM exception without ERROR stays blocking', () => {
  assert.equal(allowed(classify('', jomlLines.join('\n') + '\njava.lang.UnsupportedOperationException: denied')), false);
});
test('recognized warning does not remove an identical unknown stdout occurrence', () => {
  assert.equal(allowed(classify('', terminal, context(), { stdout: terminal })), false);
});
test('final health and all nonzero exit/signal cases stay blocking', () => {
  for (const delta of [{ exitCode: 1 }, { exitSignal: 'SIGTERM' }, { explicitManagerNormalStop: false }, { finalStopped: false }, { recoveryRequired: true }, { outputPipesClosed: false }])
    assert.equal(paperFinalDiagnosticsAllowed(classify(), ready, { ...final, ...delta }), false);
  assert.equal(paperFinalDiagnosticsAllowed(classify(), { ...ready, rconReady: false }, final), false);
});
test('current isolated identity/manifest evidence rejects missing entry and replacement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'p55-diagnostic-'));
  try {
    const target = 'libraries/org/joml/joml/1.10.8/joml-1.10.8.jar'; await mkdir(path.dirname(path.join(root, target)), { recursive: true });
    const bytes = Buffer.from('synthetic-safe-file'); await writeFile(path.join(root, target), bytes);
    const manifest = { kind: 'paper', minecraftVersion: '26.2', requiredJavaMajor: 25,
      files: [{ target, sha256: createHash('sha256').update(bytes).digest('hex'), identity: 'source-identity' }] };
    manifest.manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    // Production known hashes are mandatory, so arbitrary synthetic bytes are never trusted.
    const evidence = await verifyPaperDiagnosticFiles(manifest, root);
    assert.deepEqual(evidence.files, {});
    await rename(path.join(root, target), path.join(root, target + '.old')); await writeFile(path.join(root, target), bytes);
    assert.deepEqual((await verifyPaperDiagnosticFiles(manifest, root, evidence)).files, {});
    assert.deepEqual((await verifyPaperDiagnosticFiles({ ...manifest, files: [] }, root)).files, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('known artifact proof binds physical copy identity, exact SHA and manifest across refresh', async () => {
  // Read only three known dependency artifacts from the preserved ISOLATED run.
  // All writes/replacements below are disposable synthetic fixture copies.
  const workspace = new URL('../../', import.meta.url);
  const preserved = 'p55-paper-68f01331-b651-455f-b990-7adbdf8fb8dd';
  const source = JSON.parse(await readFile(new URL(`.manager/${preserved}/source-manifest.json`, workspace), 'utf8'));
  const root = await mkdtemp(path.join(tmpdir(), 'p55-verified-diagnostic-'));
  try {
    for (const profile of Object.values(paperDiagnosticProfile)) {
      const destination = path.join(root, profile.target); await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(new URL(`runtime/${preserved}/${profile.target}`, workspace), destination);
    }
    const baseline = await verifyPaperDiagnosticFiles(source, root);
    assert.deepEqual(Object.keys(baseline.files).sort(), ['joml', 'paper', 'terminal']);
    assert.deepEqual(await verifyPaperDiagnosticFiles(source, root, baseline), baseline);
    const file = path.join(root, paperDiagnosticProfile.joml.target);
    await rename(file, file + '.old'); await copyFile(file + '.old', file);
    assert.equal((await verifyPaperDiagnosticFiles(source, root, baseline)).files.joml, undefined, 'same bytes, replaced inode must reject');
    const changed = structuredClone(source); delete changed.manifestSha256; changed.files = changed.files.filter((entry) => entry.target !== paperDiagnosticProfile.joml.target);
    changed.manifestSha256 = createHash('sha256').update(JSON.stringify(changed)).digest('hex');
    assert.equal((await verifyPaperDiagnosticFiles(changed, root)).files.joml, undefined, 'exact manifest entry required');
    assert.deepEqual((await verifyPaperDiagnosticFiles(changed, root, baseline)).files, {}, 'manifest rebinding rejects all proofs');
    await writeFile(file, 'changed bytes');
    assert.equal((await verifyPaperDiagnosticFiles(source, root)).files.joml, undefined, 'wrong SHA cannot authorize');
  } finally { await rm(root, { recursive: true, force: true }); }
});
