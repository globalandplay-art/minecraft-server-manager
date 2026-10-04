// Independent bounded cleanup; one failing close must not strand other helpers.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
export async function bounded(action, label) {
  let timer;
  try { return await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: cleanup deadline exceeded`)), 10_000); })]); }
  finally { clearTimeout(timer); }
}
export async function cleanupBrowserHelpers(h) {
  const errors = [], { browser, browserServer, vite, report } = h;
  try { if (browser) await bounded(() => browser.close(), 'owned Chrome connection'); } catch (error) { errors.push(error); }
  try { if (browserServer) await bounded(() => browserServer.close(), 'owned Chrome server'); }
  catch (error) { errors.push(error); try { await bounded(() => browserServer.kill(), 'captured Chrome server kill'); } catch (killError) { errors.push(killError); } }
  try {
    if (vite && !h.helperClosed()) { vite.kill('SIGTERM'); const deadline = Date.now() + 10_000; while (!h.helperClosed() && Date.now() < deadline) await h.wait(100); }
    assert(!vite || h.helperClosed(), 'owned Vite child failed to close');
  } catch (error) { errors.push(error); }
  try { await writeFile(path.join(h.evidenceRoot, 'vite.log'), h.helperLog, { mode: 0o600 }); } catch (error) { errors.push(error); }
  if (h.helperError) errors.push(h.helperError);
  try {
    const socket = net.createServer();
    try { await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen({ host: '127.0.0.1', port: 3000, exclusive: true }, resolve); }); }
    finally { if (socket.listening) await new Promise((resolve) => socket.close(resolve)); }
  } catch (error) { errors.push(error); }
  if (report.browserHelper) {
    const child = browserServer?.process();
    report.browserHelper.chromeClosed = !child || child.exitCode !== null || child.signalCode !== null;
    report.browserHelper.closed = h.helperClosed() && report.browserHelper.chromeClosed;
    report.browserHelper.cleanupErrors = errors.map((error) => error.message);
    if (!report.browserHelper.chromeClosed) errors.push(new Error('owned Chrome child did not exit'));
  }
  if (errors.length) throw new AggregateError(errors, 'BROWSER_HELPER_CLEANUP_FAILED');
}
