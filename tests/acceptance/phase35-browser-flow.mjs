// Called only after the host wrapper and fresh real-instance isolation checks.
// No product endpoints or transaction bypasses are added by this browser harness.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { chromium, expect } from '@playwright/test';
import { bounded, cleanupBrowserHelpers } from './phase35-browser-cleanup.mjs';

export const widths = Object.freeze([360, 768, 1440]);
export const faultCheckpoint = 'new-installed';
const dimensions = ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'];
async function free(port) {
  const socket = net.createServer();
  try { await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); }); }
  finally { if (socket.listening) await new Promise((resolve) => socket.close(resolve)); }
}
export async function assertHTTPPortsFree() { await free(3000); await free(8080); }
export async function runBrowserAcceptance(h) {
  const { workspace, serverRoot, managerRoot, evidenceRoot, id, base, report, request, terminal, start, stop, command,
    manifest, verifyRestoreTree, openApp, closeApp, getJournal, armFault, wait, check } = h;
  const worldName = 'generated-world';
  const worldRoot = path.join(serverRoot, worldName);
  const verify = async (backupId) => {
    const m = await manifest(backupId);
    assert.deepEqual(m.includedRoots, [worldName]);
    await verifyRestoreTree(worldRoot, m.files.map((f) => ({ ...f, path: f.path.slice(worldName.length + 1) })));
    return m;
  };
  const blocks = async (block, set = false) => {
    for (const dimension of dimensions) {
      if (set) { await command(`execute in ${dimension} run forceload add 0 0`); await command(`execute in ${dimension} run setblock 0 80 0 ${block}`); }
      assert.match(await command(`execute in ${dimension} if block 0 80 0 ${block}`), /Test passed/u);
    }
  };
  await free(3000); await free(8080);
  await h.listen();
  let browser, browserServer, vite;
  let helperClosed = false, helperError;
  let helperLog = '';
  try {
    vite = spawn(process.execPath, [path.join(workspace, 'node_modules/vite/bin/vite.js'), 'apps/web', '--config', 'apps/web/vite.config.ts'],
      { cwd: workspace, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    report.browserHelper = { pid: vite.pid, executable: process.execPath, cwd: workspace };
    vite.once('close', () => { helperClosed = true; }); vite.once('error', (error) => { helperError = error; });
    for (const stream of [vite.stdout, vite.stderr]) stream.on('data', (chunk) => {
      if (helperLog.length + chunk.length > 1024 * 1024) helperError ??= new Error('VITE_CAPTURE_OVERFLOW');
      else helperLog += chunk.toString('utf8');
    });
    const readyDeadline = Date.now() + 30_000;
    while (true) {
      if (helperError) throw helperError; assert(!helperClosed, 'owned Vite helper exited before readiness');
      try { const r = await fetch('http://127.0.0.1:3000', { signal: AbortSignal.timeout(1500) }); if (r.ok) break; } catch { /* Bound readiness, never repair/restart helpers. */ }
      assert(Date.now() < readyDeadline, 'Vite readiness deadline exceeded'); await wait(250);
    }
    browserServer = await chromium.launchServer({ channel: 'chrome', host: '127.0.0.1' });
    report.browserHelper.chromePid = browserServer.process().pid;
    browser = await chromium.connect(browserServer.wsEndpoint());
    report.browserRuns = [];
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); const row = { width, result: 'RUNNING' }; report.browserRuns.push(row);
      try {
        // A is the source snapshot. B proves successful restore; C proves rollback.
        await start(worldName, `P3.5 ${width}: baseline fresh Done/RCON`); await blocks('minecraft:gold_block', true); await stop();
        const beforeBackup = (await request(`${base}/backups`)).items.map((b) => b.id);
        await page.goto(`http://127.0.0.1:3000/backups?server=${id}`);
        await expect(page.getByLabel('启用每日备份')).not.toBeChecked();
        await expect(page.getByLabel('启用安全保留清理')).not.toBeChecked();
        const label = `P3.5 browser ${width}`; await page.getByLabel('备份备注').fill(label);
        let firstKey, firstBody, acceptedId, dropped = false;
        await page.route(`**${base}/backups`, async (route) => {
          if (route.request().method() !== 'POST' || dropped) { await route.continue(); return; }
          firstKey = route.request().headers()['idempotency-key']; assert(firstKey); firstBody = route.request().postDataJSON();
          const response = await route.fetch(); assert.equal(response.status(), 202);
          acceptedId = (await response.json()).data.operation.id; dropped = true;
          await route.abort('failed'); // Actual accepted response is lost; no backend mock.
        });
        await page.getByRole('button', { name: '创建备份', exact: true }).click();
        await expect(page.getByRole('button', { name: '用相同请求确认备份状态' })).toBeVisible();
        await page.reload();
        const retryResponse = page.waitForResponse((r) => r.url().endsWith(`${base}/backups`) && r.request().method() === 'POST');
        await page.getByRole('button', { name: '用相同请求确认备份状态' }).click();
        const retried = await retryResponse; assert.equal(retried.request().headers()['idempotency-key'], firstKey);
        assert.deepEqual(retried.request().postDataJSON(), firstBody);
        assert.equal((await retried.json()).data.operation.id, acceptedId);
        assert.equal((await terminal((op) => request(`/api/v1/operations/${op}`), acceptedId)).state, 'succeeded');
        const backups = (await request(`${base}/backups`)).items;
        const added = backups.filter((b) => !beforeBackup.includes(b.id)); assert.equal(added.length, 1);
        const backup = added[0]; row.backup = { id: backup.id, operationId: acceptedId, requestKey: firstKey, checksumSha256: backup.checksumSha256 };
        assert.equal((await getJournal().scan()).records.filter((r) => r.intent.kind === 'backup' && r.intent.operationId === acceptedId).length, 1);
        await verify(backup.id); row.sameKeyAndDisconnect = true;
        await page.unroute(`**${base}/backups`);
        await start(worldName, `P3.5 ${width}: B modification startup`); await blocks('minecraft:diamond_block', true); await stop();
        await page.reload();
        const card = page.locator('.backup-row').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
        const submit = async (target, rollback) => {
          await target.getByRole('button', { name: rollback ? '显式回滚' : '恢复世界', exact: true }).click();
          const dialog = target.getByRole('dialog', { name: rollback ? '回滚确认' : '恢复确认' });
          const input = dialog.getByLabel('输入世界名确认覆盖'); await expect(input).toBeFocused();
          const button = dialog.getByRole('button', { name: rollback ? '确认回滚' : '确认恢复', exact: true });
          await expect(button).toBeDisabled(); await input.fill(worldName); await expect(button).toBeDisabled();
          await dialog.getByLabel('我确认覆盖此世界，并允许必要的停服').check();
          await expect(dialog.getByLabel(rollback ? /回滚后启动服务器/ : /恢复后启动服务器/)).not.toBeChecked();
          const suffix = rollback ? '/rollback' : '/restore';
          const accepted = page.waitForResponse((r) => r.url().endsWith(suffix) && r.request().method() === 'POST');
          await button.click(); const response = await accepted; assert.equal(response.status(), 202);
          return (await response.json()).data.operation;
        };
        const restored = await submit(card, false);
        assert.equal((await terminal((op) => request(`/api/v1/operations/${op}`), restored.id)).state, 'succeeded');
        await expect(card.getByRole('button', { name: '重新确认恢复', exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), `mcsm.restore.${id}.restore.${backup.id}`)).toBeNull();
        await verify(backup.id); // Full hash BEFORE Minecraft legitimately rewrites files.
        const restoreJournal = (await getJournal().scan()).records.find((r) => r.intent.operationId === restored.id);
        const firstGuard = await manifest(restoreJournal.intent.restore.guardBackupId); assert(firstGuard.pinned);
        assert.notEqual(firstGuard.checksumSha256, backup.checksumSha256); row.restore = { id: restored.id, guardId: firstGuard.id, guardPinned: true, physicalHashes: true };
        await closeApp(); await openApp(); await h.listen(); await page.reload();
        await start(worldName, `P3.5 ${width}: restored A startup`); await blocks('minecraft:gold_block');
        await blocks('minecraft:emerald_block', true); await stop();
        const beforeFailure = await h.inventoryRestoreTree(worldRoot); await page.reload();
        armFault(backup.id); const failed = await submit(card, false);
        const outcome = await terminal((op) => request(`/api/v1/operations/${op}`), failed.id);
        assert.equal(outcome.state, 'interrupted'); assert.equal(outcome.error.code, 'RECOVERY_REQUIRED'); assert.equal((await request(base)).status.recoveryRequired, true);
        const failedRecord = (await getJournal().scan()).records.find((r) => r.intent.operationId === failed.id);
        assert.equal(failedRecord.state, 'recovery-required'); assert.equal(h.faultCount(), report.browserRuns.length);
        const guard = await manifest(failedRecord.intent.restore.guardBackupId); assert(guard.pinned); assert.notEqual(guard.checksumSha256, backup.checksumSha256);
        await closeApp(); await openApp(); await h.listen(); await page.reload();
        assert.equal((await request(base)).status.recoveryRequired, true);
        const blocked = await h.rejectStart(); assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error.code, 'RECOVERY_REQUIRED');
        await page.getByRole('button', { name: '刷新恢复记录' }).click();
        // Select the failed transaction, never a previous successful restore's rollback.
        const failedRow = page.getByText(`恢复操作 ${failed.id} · recovery-required`, { exact: true }).locator('..');
        await expect(failedRow).toHaveCount(1); const rolledBack = await submit(failedRow, true);
        assert.equal((await terminal((op) => request(`/api/v1/operations/${op}`), rolledBack.id)).state, 'succeeded');
        await verify(guard.id); await verifyRestoreTree(worldRoot, beforeFailure);
        await closeApp(); await openApp(); await h.listen(); assert.equal((await request(base)).status.recoveryRequired, false);
        await page.reload(); await start(worldName, `P3.5 ${width}: rolled-back C startup`); await blocks('minecraft:emerald_block'); await stop();
        row.recovery = { failedId: failed.id, rollbackId: rolledBack.id, guardId: guard.id, physicalHashes: true, semanticMarkers: true, managerRestart: true };
        assert((await request(`${base}/worlds`)).items.some((w) => w.active && w.name.value === worldName));
        assert.equal((await getJournal().scan()).issues.length, 0);
        assert.equal((await request(base)).status.activeOperationId, null);
        assert((await request(`${base}/backups`)).items.filter((b) => b.pinned).length >= 2);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: path.join(evidenceRoot, `browser-${width}.png`), fullPage: true });
        row.result = 'PASS'; check(`P3.5 ${width}: browser backup/disconnect/same-key/restore/interruption/explicit rollback/hash/markers`);
      } catch (error) {
        row.error = error.message;
        await page.screenshot({ path: path.join(evidenceRoot, `browser-${width}-failure.png`), fullPage: true }).catch(() => {});
        await writeFile(path.join(evidenceRoot, `browser-${width}-failure.html`), await page.content(), { mode: 0o600 });
        throw error;
      } finally { await bounded(() => context.close(), 'owned browser context'); }
    }
    assert(report.browserRuns.every((r) => r.result === 'PASS')); report.browser = 'PASS';
  } finally {
    await cleanupBrowserHelpers({ browser, browserServer, vite, helperClosed: () => helperClosed, helperLog, helperError,
      report, evidenceRoot, wait });
  }
}
