import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import {
  TransactionJournalStore,
  type CreateTransactionIntent
} from "../src/services/transaction-journal.js";

const roots: string[] = [];
const now = "2026-09-28T08:00:00.000Z";
const later = "2026-09-28T08:01:00.000Z";

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mcsm-journal-"));
  roots.push(root);
  return root;
}

function intent(overrides: Partial<CreateTransactionIntent> = {}): CreateTransactionIntent {
  return {
    transactionId: "11111111-1111-4111-8111-111111111111",
    operationId: "22222222-2222-4222-8222-222222222222",
    serverId: "vanilla-local",
    kind: "restore",
    scope: "world-set",
    resourceId: "backup-1",
    allowStop: true,
    originalState: "running",
    paths: [
      { role: "target", relativePath: "world" },
      { role: "staging", relativePath: "staging/restore-1" },
      { role: "rollback", relativePath: "rollback/restore-1" }
    ],
    createdAt: now,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TransactionJournalStore", () => {
  it("persists intent before checkpoints and recovers an active transaction after restart", async () => {
    const root = await fixtureRoot();
    const first = new TransactionJournalStore(root);
    await first.initialize();
    const created = await first.createIntent(intent());

    const raw = await readFile(join(
      root,
      "transactions",
      "vanilla-local.11111111-1111-4111-8111-111111111111.json"
    ), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      state: "active",
      checkpoints: [],
      intent: { kind: "restore", serverId: "vanilla-local" }
    });
    expect(created.checkpoints).toEqual([]);
    await expect(first.createIntent(intent())).rejects.toThrow("already exists");

    const restarted = new TransactionJournalStore(root);
    const scan = await restarted.initialize();
    expect(scan.recoveryServerIds).toEqual(new Set(["vanilla-local"]));
    expect(scan.records).toHaveLength(1);
  });

  it("assigns strictly increasing checkpoints and persists terminal state", async () => {
    const root = await fixtureRoot();
    const store = new TransactionJournalStore(root);
    await store.initialize();
    const created = await store.createIntent(intent());
    const first = await store.appendCheckpoint("vanilla-local", created.transactionId, {
      name: "staging-verified",
      recordedAt: later,
      details: { relativePath: "staging/restore-1", checksumSha256: "a".repeat(64) }
    });
    const second = await store.appendCheckpoint("vanilla-local", created.transactionId, {
      name: "world-switched",
      recordedAt: "2026-09-28T08:02:00.000Z"
    });
    expect(first.checkpoints.map((item) => item.sequence)).toEqual([1]);
    expect(second.checkpoints.map((item) => item.sequence)).toEqual([1, 2]);

    await store.setState("vanilla-local", created.transactionId, "committed", "2026-09-28T08:03:00.000Z");
    expect((await store.scan()).recoveryServerIds).toEqual(new Set());
    await expect(store.appendCheckpoint("vanilla-local", created.transactionId, {
      name: "too-late", recordedAt: "2026-09-28T08:04:00.000Z"
    })).rejects.toThrow("terminal");
  });

  it("gates only the server owning a corrupt record or orphan atomic-write temp", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "transactions");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "alpha.33333333-3333-4333-8333-333333333333.json"), "{broken", "utf8");
    await writeFile(join(
      directory,
      "beta.44444444-4444-4444-8444-444444444444.55555555-5555-4555-8555-555555555555.tmp"
    ), "partial", "utf8");
    await writeFile(
      join(directory, "gamma.88888888-8888-4888-8888-888888888888.json"),
      "x".repeat(64 * 1024 + 1),
      "utf8"
    );

    const scan = await new TransactionJournalStore(root).initialize();
    expect(scan.recoveryServerIds).toEqual(new Set(["alpha", "beta", "gamma"]));
    expect(scan.issues.map((issue) => [issue.kind, issue.serverId])).toEqual([
      ["corrupt-record", "alpha"],
      ["orphan-temp", "beta"],
      ["corrupt-record", "gamma"]
    ]);
  });

  it("fails closed on unattributable journal files and linked journal roots", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "transactions");
    await mkdir(directory);
    await writeFile(join(directory, "orphan-record.json"), "{}", "utf8");
    await expect(new TransactionJournalStore(root).initialize()).rejects.toThrow("Unattributable");
    await rm(directory, { recursive: true, force: true });

    const target = await mkdtemp(join(tmpdir(), "mcsm-journal-target-"));
    roots.push(target);
    await symlink(target, directory, process.platform === "win32" ? "junction" : "dir");
    await expect(new TransactionJournalStore(root).initialize()).rejects.toThrow("real directory");
  });

  it("rejects a manager root that resolves through a symlink", async () => {
    const parent = await fixtureRoot();
    const target = await mkdtemp(join(tmpdir(), "mcsm-journal-manager-target-"));
    roots.push(target);
    const linkedRoot = join(parent, "linked-manager");
    await symlink(target, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    await expect(new TransactionJournalStore(linkedRoot).initialize()).rejects.toThrow("real directory");
  });

  it("detects duplicate operation ownership across otherwise terminal records", async () => {
    const root = await fixtureRoot();
    const store = new TransactionJournalStore(root);
    await store.initialize();
    const first = await store.createIntent(intent());
    await store.setState("vanilla-local", first.transactionId, "committed", later);
    const second = await store.createIntent(intent({
      serverId: "vanilla-other",
      transactionId: "66666666-6666-4666-8666-666666666666",
      paths: [{ role: "target", relativePath: "world-two" }]
    }));
    await store.setState("vanilla-other", second.transactionId, "committed", later);

    const scan = await store.scan();
    expect(scan.recoveryServerIds).toEqual(new Set(["vanilla-local", "vanilla-other"]));
    expect(scan.issues).toEqual([
      expect.objectContaining({ kind: "duplicate-operation", serverId: "vanilla-other" })
    ]);
  });

  it("rejects absolute, traversing, duplicate-role, and non-UUID intent structures", async () => {
    const root = await fixtureRoot();
    const store = new TransactionJournalStore(root);
    await store.initialize();
    for (const candidate of [
      intent({ paths: [{ role: "target", relativePath: "../world" }] }),
      intent({ paths: [{ role: "target", relativePath: "C:\\server\\world" }] }),
      intent({ paths: [{ role: "target", relativePath: "world:backup" }] }),
      intent({ paths: [{ role: "target", relativePath: "world. " }] }),
      intent({ paths: [{ role: "target", relativePath: "CON/data" }] }),
      intent({ paths: [
        { role: "target", relativePath: "world" },
        { role: "target", relativePath: "world-two" }
      ] }),
      intent({ operationId: "public-operation-step-is-not-a-journal-id" })
    ]) {
      await expect(store.createIntent(candidate)).rejects.toThrow();
    }
  });

  it("feeds journal recovery into the per-server operation gate without using Operation.step", async () => {
    const root = await fixtureRoot();
    const journal = new TransactionJournalStore(root);
    await journal.initialize();
    await journal.createIntent(intent({ serverId: "journal-blocked" }));
    const operations = new OperationService(
      new MemoryOperationStore(),
      { now: () => new Date(now) },
      new TransactionJournalStore(root)
    );
    await operations.initialize();

    expect(operations.getServerState("journal-blocked")).toEqual({
      activeOperationId: null,
      recoveryRequired: true
    });
    expect(operations.getServerState("unrelated").recoveryRequired).toBe(false);
    await expect(operations.requestLifecycle(
      "journal-blocked",
      "start",
      "77777777-7777-4777-8777-777777777777",
      async () => {}
    )).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "recovery-required" });
  });

  it("makes lifecycle and other exclusive work contend on the same per-server gate", async () => {
    const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date(now) });
    await operations.initialize();
    let release: () => void = () => {};
    const held = operations.runExclusive("vanilla-local", () => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    await expect(operations.requestLifecycle(
      "vanilla-local", "start", "88888888-8888-4888-8888-888888888888", async () => {}
    )).rejects.toMatchObject({ code: "OPERATION_CONFLICT", reason: "operation-active" });
    await expect(operations.runExclusive("vanilla-local", async () => {}))
      .rejects.toMatchObject({ code: "OPERATION_CONFLICT", reason: "operation-active" });
    release();
    await held;
    expect(operations.getServerState("vanilla-local").activeOperationId).toBeNull();
  });
});
