import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

const evidence = path.resolve('test-results', `p72b-b-browser-${randomUUID()}`);
await mkdir(evidence, { recursive: true });
await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject);
  probe.listen(3001, '127.0.0.1', () => probe.close(resolve));
});
function start(args, file) {
  const child = spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let overflow = false; let isClosed = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    if (Buffer.byteLength(output) + chunk.length > 2 * 1024 * 1024) { overflow = true; child.kill(); }
    else output += chunk.toString();
  });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => { isClosed = true; resolve({ code, signal, overflow }); }));
  child.once('error', () => { overflow = true; });
  return { child, closed, isClosed: () => isClosed, save: () => writeFile(path.join(evidence, file), output), alive: () => child.exitCode === null && child.signalCode === null };
}
async function boundedClose(item, ms) {
  let timer;
  try { return await Promise.race([item.closed, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}
async function stop(item) {
  if (!item.isClosed() && item.alive()) {
    try { item.child.kill(); } catch { /* confirmation below remains mandatory */ }
  }
  return boundedClose(item, 30_000);
}
const server = start(['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts', '--host', '127.0.0.1', '--port', '3001', '--strictPort'], 'vite.log');
let runner; let result = 'BLOCKED'; let failure = null; let browserStatus; let serverStatus;
try {
  const deadline = performance.now() + 30_000; let ready = false;
  while (server.alive() && performance.now() < deadline) {
    try { ready = (await fetch('http://127.0.0.1:3001', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* bounded readiness */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready || !server.alive()) throw new Error('OWNED_VITE_NOT_READY');
  const config = path.join(evidence, 'browser.config.ts');
  await writeFile(config, `import base from ${JSON.stringify(path.resolve('tests/e2e/p72b.playwright.config.ts'))};\nexport default {...base, testDir:${JSON.stringify(path.resolve('tests/e2e'))}, outputDir:${JSON.stringify(path.join(evidence, 'artifacts'))}, webServer:undefined};\n`);
  runner = start(['node_modules/@playwright/test/cli.js', 'test', '--config', config], 'browser.log');
  // Aggregate fixture watchdog only; original per-test deadlines remain unchanged.
  browserStatus = await boundedClose(runner, 600_000); await runner.save();
  if (browserStatus === null) throw new Error('BROWSER_RUN_DEADLINE');
  if (browserStatus.code !== 0 || browserStatus.signal !== null || browserStatus.overflow) throw new Error('BROWSER_ACCEPTANCE_FAILED');
  result = 'PASS';
} catch (error) { failure = error instanceof Error ? error.message : 'UNKNOWN'; }
finally {
  if (runner && !runner.isClosed()) {
    const closed = await stop(runner);
    if (closed === null) { result = 'BLOCKED'; failure = 'CLEANUP_BLOCKED'; }
  }
  serverStatus = await stop(server); await server.save();
  if (serverStatus === null) { result = 'BLOCKED'; failure = 'CLEANUP_BLOCKED'; }
}
let released = false;
const ownedChildrenClosed = server.isClosed() && (!runner || runner.isClosed());
try {
  await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject); probe.listen(3001, '127.0.0.1', () => probe.close(resolve));
  }); released = true;
} catch { result = 'BLOCKED'; failure = 'PORT_RELEASE_UNCONFIRMED'; }
if (!ownedChildrenClosed) { result = 'BLOCKED'; failure = 'CLEANUP_BLOCKED'; }
await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result, failure, browserStatus, serverStatus,
  ownedChildrenClosed, portReleased: released,
  unchangedSpec: 'phase72b-tailscale.spec.ts', workers: 1, retries: 0 }, null, 2));
console.log(`${result}: read-only Tailscale browser spec with owned fixture cleanup; ${evidence}`);
if (!ownedChildrenClosed) process.exit(1); // Retain evidence; never hang or kill unknown descendants.
if (result !== 'PASS') process.exitCode = 1;
