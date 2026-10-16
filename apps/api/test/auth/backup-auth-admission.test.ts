import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { HttpAuthentication } from "../../src/auth/http-auth.js";
import { SessionCore } from "../../src/auth/session-core.js";
import { PasswordVerifier, SCRYPT_PROFILE } from "../../src/auth/password.js";
import type { LocalMinecraftServerAdapter } from "../../src/adapters/contract.js";
import { MemoryOperationStore } from "../../src/services/operation-store.js";
import { TransactionJournalStore } from "../../src/services/transaction-journal.js";
import { BackupService } from "../../src/services/backup-service.js";
it.each(["backup", "export"] as const)("rechecks real HTTP authentication after %s preflight with one business owner", async kind => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-backup-auth-"));
  const server = path.join(root, "server"), manager = path.join(root, "manager");
  let app: ReturnType<typeof buildApp> | undefined;
  let restoreSource = () => {};
  try {
    await mkdir(path.join(server, "world", "region"), { recursive: true }); await mkdir(manager);
    await writeFile(path.join(server, "world", "level.dat"), "synthetic world");
    await writeFile(path.join(server, "world", "region", "r.0.0.mca"), "synthetic region");
    await writeFile(path.join(server, "server.properties"), "level-name=world\n");
    const sessions = new SessionCore(() => 0);
    const auth = new HttpAuthentication(new PasswordVerifier({ version: 1, username: "admin", revision: randomUUID(),
      salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE }),
      { ready: () => true, record: async () => {}, close: async () => {} }, sessions);
    let revoke = false;
    const stop = vi.fn(async () => {}), start = vi.fn(async () => {});
    const adapter = { serverId: "test", mode: "local", plan: { rootPath: server, eulaAccepted: true,
      serverInfo: { id: "test", name: "Test", type: "vanilla", minecraftVersion: "26.3" } },
      getStatus: async () => { await Promise.resolve(); if (revoke) sessions.clear(); return { state: "stopped", ownership: "none", recoveryRequired: false }; },
      getCapabilities: async () => ({ backup: true }), stop, start, subscribe: () => () => {}, closeObserver: async () => {}
    } as unknown as LocalMinecraftServerAdapter;
    const store = new MemoryOperationStore(), journal = new TransactionJournalStore(manager);
    app = buildApp({ mode: "local", adapters: [adapter], authentication: auth, operationStore: store, transactionJournal: journal, managerRoot: manager });
    const token = sessions.create("local-http");
    const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui",
      cookie: `mcsm_local_session=${token.sessionToken}`, "x-csrf-token": token.csrfToken, "idempotency-key": randomUUID() };
    let url = "/api/v1/servers/test/backups";
    if (kind === "export") {
      const baseline = await app.inject({ method: "POST", url, headers, payload: { scope: "world-set", allowStop: false } });
      expect(baseline.statusCode).toBe(202);
      await vi.waitFor(async () => expect((await store.list())[0]?.operation.state).toBe("succeeded"));
      const backupList = await app.inject({ method: "GET", url, headers });
      const backupId: string = backupList.json().data.items[0].id;
      url += `/${backupId}/exports`;
      const source = BackupService.prototype.exportSource;
      const spy = vi.spyOn(BackupService.prototype, "exportSource").mockImplementationOnce(async function (this: BackupService, ...args) {
        const result = await source.apply(this, args); sessions.clear(); return result;
      });
      restoreSource = () => spy.mockRestore();
    } else revoke = true;
    const before = await store.list();
    const response = await app.inject({ method: "POST", url, headers: { ...headers, "idempotency-key": randomUUID() },
      payload: kind === "backup" ? { scope: "world-set", allowStop: false } : {} });
    expect(response.statusCode).toBe(401); expect(response.json().error.code).toBe("AUTH_REQUIRED");
    expect(await store.list()).toEqual(before); expect(stop).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
    if (kind === "export") {
      const backupRoot = path.join(manager, "backups", "test");
      const [id] = await readdir(backupRoot); expect(await readdir(path.join(backupRoot, id!))).not.toContain("world-set.zip");
    }
  } finally { restoreSource(); await app?.close(); await rm(root, { recursive: true, force: true }); }
});
