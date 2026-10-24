import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ManagerStartupRecovery } from '../src/services/manager-startup-recovery.js';
import { buildApp } from '../src/app.js';
import { TransactionJournalStore } from '../src/services/transaction-journal.js';
import { AddonInstallService } from '../src/services/addon-install-service.js';
import { AddonLifecycleService } from '../src/services/addon-lifecycle-service.js';
import { BackupRetentionService } from '../src/services/backup-retention-service.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('Manager startup recovery admission', () => {
  it('starts closed, shares one task and opens only after final verification', async () => {
    const recovery = new ManagerStartupRecovery(); let release!: () => void;
    expect(recovery.available).toBe(false);
    const task = recovery.start(() => recovery.stage('proof', () => new Promise<void>(resolve => { release = resolve; })), true);
    expect(recovery.start(async () => { throw new Error('duplicate'); })).toBe(task);
    await Promise.resolve(); expect(recovery.available).toBe(false); release(); await task;
    await expect(recovery.wait()).resolves.toBeUndefined(); expect(recovery.stages[0]?.result).toBe('PASS'); await recovery.close();
  });
  it('keeps a timed-out task closed even if it swallows cancellation and completes late', async () => {
    vi.useFakeTimers(); const recovery = new ManagerStartupRecovery(50); let release!: () => void;
    const task = recovery.start(() => new Promise<void>(resolve => { release = resolve; }), true);
    const activate = vi.fn(); void task.then(() => { if (recovery.available) activate(); });
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(50);
    expect(recovery.state).toBe('failed'); expect(() => recovery.check()).toThrow('MANAGER_RECOVERY_ABORTED');
    release(); await task; expect(recovery.available).toBe(false); await expect(recovery.wait()).rejects.toThrow('MANAGER_RECOVERY_UNAVAILABLE');
    expect(activate).not.toHaveBeenCalled();
  });
  it('joins in-flight proof before allowing resource disposal and prevents late publication', async () => {
    const recovery = new ManagerStartupRecovery(); let release!: () => void; const published = vi.fn();
    recovery.start(async () => { await new Promise<void>(resolve => { release = resolve; }); recovery.check(); published(); }, true);
    await Promise.resolve(); let closed = false; const close = recovery.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); release(); await close;
    expect(closed).toBe(true); expect(published).not.toHaveBeenCalled(); expect(recovery.available).toBe(false);
  });
  it('rejects elapsed monotonic deadlines even before a delayed timer callback can run', async () => {
    let now = 0, release!: () => void; const recovery = new ManagerStartupRecovery(50, () => now);
    const task = recovery.start(() => new Promise<void>(resolve => { release = resolve; }), true);
    const activate = vi.fn(); void task.then(() => { if (recovery.available) activate(); });
    await Promise.resolve(); now = 51; release(); await task;
    expect(recovery.available).toBe(false); expect(recovery.state).toBe('failed');
    expect(activate).not.toHaveBeenCalled();
  });
  it('guards HTTP writes, reads and WebSocket upgrades while deferred recovery is pending', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-startup-'));
    const journal = new TransactionJournalStore(root), initial = await journal.initialize();
    const initialize = journal.initialize.bind(journal); let first = true;
    vi.spyOn(journal, 'initialize').mockImplementation(async () => {
      if (!first) return initialize(); first = false;
      return { ...initial, records: [{ intent: { addonInstall: { confirmUnknownCompatibility: true } } } as unknown as typeof initial.records[number]] };
    });
    let release!: () => void;
    vi.spyOn(AddonInstallService.prototype, 'reconcileStartup').mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    vi.spyOn(AddonLifecycleService.prototype, 'reconcileStartup').mockResolvedValue();
    const timers = vi.spyOn(BackupRetentionService.prototype, 'start').mockImplementation(() => {});
    const app = buildApp({ mode: 'mock', managerRoot: root, transactionJournal: journal, backupSchedulerTimers: false });
    try {
      await app.ready();
      expect(app.managerRecovery.state).toBe('verifying');
      expect(timers).not.toHaveBeenCalled();
      for (const [method, url] of [['GET', '/api/v1/servers'], ['POST', '/api/v1/servers/test/actions/start'], ['POST', '/api/v1/server-registrations'], ['GET', '/api/v1/operations/test'], ['GET', '/api/v1/events'], ['GET', '/api/v1/health']] as const) {
        const response = await app.inject({ method, url, headers: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:3000', 'x-manager-intent': 'local-ui', ...(url.endsWith('/events') ? { connection: 'Upgrade', upgrade: 'websocket' } : {}) } });
        expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe('MANAGER_RECOVERY_PENDING');
      }
      expect((await app.inject({ url: '/api/v1/auth/status', headers: { host: '127.0.0.1:8080' } })).statusCode).toBe(200);
      await vi.waitFor(() => expect(release).toBeTypeOf('function')); release(); await app.managerRecovery.wait();
      expect(timers).toHaveBeenCalledOnce();
      expect((await app.inject({ url: '/api/v1/health', headers: { host: '127.0.0.1:8080' } })).statusCode).toBe(200);
    } finally { release?.(); await app.close(); await rm(root, { recursive: true, force: true }); }
  });
});
