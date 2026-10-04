import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { ActiveWorldStateStore } from "../src/services/active-world-state-store.js";
import { BackupRetentionService } from "../src/services/backup-retention-service.js";
import { BackupScheduleService } from "../src/services/backup-schedule-service.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";

it("closes scheduler immediately while retention shutdown is still pending", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-policy-close-")), manager = path.join(root, "manager"); await mkdir(manager);
  let release: () => void = () => {}; const held = new Promise<void>((resolve) => { release = resolve; });
  const retentionClose = vi.spyOn(BackupRetentionService.prototype, "close").mockImplementation(async () => { await held; });
  const scheduleClose = vi.spyOn(BackupScheduleService.prototype, "close");
  const app = buildApp({ mode: "local", adapters: [], managerRoot: manager, transactionJournal: new TransactionJournalStore(manager), activeWorldState: new ActiveWorldStateStore(manager, []) });
  let closing: Promise<void> | undefined;
  try {
    await app.ready(); closing = app.close();
    await vi.waitFor(() => { expect(retentionClose).toHaveBeenCalledTimes(1); expect(scheduleClose).toHaveBeenCalledTimes(1); });
  } finally { release(); await closing; vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); }
});
