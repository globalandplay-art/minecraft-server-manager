import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';

/** Shell-free owned children; IPC permits graceful Windows fixture shutdown. */
export default async function setup() {
  return startWorldsBrowserFixture('tests/e2e/fixtures/worlds-v2-activation-api.ts');
}
export async function startWorldsBrowserFixture(apiEntry: string) {
  const cwd = fileURLToPath(new URL('../../../', import.meta.url));
  for (const port of [3000, 8080]) {
    try {
      await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
      throw new Error('BROWSER_FIXTURE_PORT_IN_USE');
    } catch (error) { if (error instanceof Error && error.message === 'BROWSER_FIXTURE_PORT_IN_USE') throw error; }
  }
  const api = spawn(process.execPath, ['--import', 'tsx', apiEntry],
    { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts'],
    { cwd, shell: false, windowsHide: true, stdio: 'ignore' });
  const owned = [api, vite].map(child => ({ child, closed: false, code: null as number | null,
    signal: null as NodeJS.Signals | null, error: false }));
  for (const state of owned) {
    state.child.once('close', (code, signal) => { state.closed = true; state.code = code; state.signal = signal; });
    state.child.once('error', () => { state.error = true; });
  }
  const cleanup = async () => {
    if (api.connected) api.send({ type: 'close' });
    if (!owned[1]!.closed) vite.kill();
    let deadline = Date.now() + 8000;
    while (owned.some(state => !state.closed) && Date.now() < deadline) await delay(50);
    const forced = owned.filter(state => !state.closed);
    for (const state of forced) state.child.kill();
    deadline = Date.now() + 5000;
    while (owned.some(state => !state.closed) && Date.now() < deadline) await delay(50);
    await mkdir('test-results', { recursive: true });
    const cleanupFile = `test-results/worlds-v2-browser-cleanup-${randomUUID()}.json`;
    await writeFile(cleanupFile, JSON.stringify({
      forcedOwnedChildren: forced.length, children: owned.map(state => ({ pid: state.child.pid, closed: state.closed, code: state.code, signal: state.signal, spawnError: state.error })) }));
    console.log(`Owned browser cleanup evidence: ${cleanupFile}`);
    if (owned.some(state => !state.closed)) throw new Error('CLEANUP_BLOCKED');
  };
  try {
    const deadline = Date.now() + 30_000;
    while (true) {
      if (owned.some(state => state.closed || state.error)) throw new Error('BROWSER_FIXTURE_EXITED');
      let ready = false;
      try {
        const responses = await Promise.all([fetch('http://127.0.0.1:8080/api/v1/health', { signal: AbortSignal.timeout(1000) }),
          fetch('http://127.0.0.1:3000', { signal: AbortSignal.timeout(1000) })]);
        ready = responses.every(response => response.ok);
      } catch { /* Bound readiness retries only; no write request is replayed. */ }
      if (ready) break;
      if (Date.now() >= deadline) throw new Error('BROWSER_FIXTURE_START_DEADLINE');
      await delay(100);
    }
  } catch (error) { await cleanup(); throw error; }
  return cleanup;
}
