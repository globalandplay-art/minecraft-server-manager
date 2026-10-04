import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const moduleUrl = new URL("../../../tests/acceptance/phase35-browser-cleanup.mjs", import.meta.url).href;
const { cleanupBrowserHelpers } = await import(moduleUrl);
afterEach(() => vi.useRealTimers());
it.each(["reject", "hang"])("still closes exact Vite and flushes logs when browser close %s", async (mode) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p35-cleanup-")); let closed = false;
  const chrome = { exitCode: null as number | null, signalCode: null };
  const viteKill = vi.fn(() => { closed = true; });
  const chromeKill = vi.fn(async () => { chrome.exitCode = 0; });
  const report = { browserHelper: { cleanupErrors: [] as string[], closed: false } };
  try {
    if (mode === "hang") vi.useFakeTimers();
    const run = cleanupBrowserHelpers({ browser: { close: () => mode === "reject" ? Promise.reject(new Error("SYNTHETIC_BROWSER_CLOSE_FAILURE")) : new Promise(() => {}) },
      browserServer: { close: () => Promise.reject(new Error("SYNTHETIC_CHROME_SERVER_CLOSE_FAILURE")), kill: chromeKill, process: () => chrome },
      vite: { kill: viteKill }, helperClosed: () => closed, helperLog: "synthetic helper log", report, evidenceRoot: root, wait: () => Promise.resolve() });
    const outcome = expect(run).rejects.toMatchObject({ message: "BROWSER_HELPER_CLEANUP_FAILED" });
    if (mode === "hang") await vi.advanceTimersByTimeAsync(10_001);
    await outcome;
    expect(viteKill).toHaveBeenCalledExactlyOnceWith("SIGTERM"); expect(chromeKill).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(root, "vite.log"), "utf8")).toBe("synthetic helper log");
    expect(report.browserHelper.closed).toBe(true); expect(report.browserHelper.cleanupErrors).toHaveLength(2);
  } finally { vi.useRealTimers(); await rm(root, { recursive: true, force: true }); }
});
