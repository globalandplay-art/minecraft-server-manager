import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActiveWorldStateStore } from "../src/services/active-world-state-store.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { WorldLibraryStore } from "../src/services/world-library-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { proposeWorldGenerationReservation } from "../src/services/world-generation-reservation.js";

const roots: string[] = [], clock = { now: () => new Date("2026-10-27T10:00:00.000Z") };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(transformActive?: (text: string) => string) {
  const root = await mkdtemp(path.join(tmpdir(), "lt-generation-catalog-")); roots.push(root);
  const manager = path.join(root, "manager"), server = path.join(root, "server"), serverId = "generation-test";
  await mkdir(manager); await mkdir(path.join(server, "world"), { recursive: true });
  await writeFile(path.join(server, "world", "level.dat"), "isolated world");
  const properties = "level-name=world\n"; await writeFile(path.join(server, "server.properties"), properties);
  const adapter = { serverId, plan: { rootPath: server, serverInfo: { type: "vanilla" } } } as LocalMinecraftServerAdapter;
  const states = new ActiveWorldStateStore(manager, [adapter]); await states.initialize();
  const library = new WorldLibraryStore(manager, clock), binding = { serverId, rootPath: server };
  await library.migrateLegacy(binding, states.snapshot(serverId)!);
  const list = await library.list(binding, states.snapshot(serverId));
  const file = path.join(manager, "world-library", serverId, "state.json"), before = await readFile(file);
  const catalog = JSON.parse(before.toString("utf8"));
  const activeFile = path.join(manager, "active-worlds", `${serverId}.json`);
  if (transformActive) await writeFile(activeFile, transformActive(await readFile(activeFile, "utf8")));
  const generation = proposeWorldGenerationReservation({ serverId, operationId: randomUUID(), transactionId: randomUUID(),
    previousWorldId: list.activeWorldId!, catalogId: catalog.catalogId, catalogRevision: list.revision!, rootIdentity: catalog.rootIdentity,
    previousName: "world", nextName: "NewWorld", propertiesBefore: hash(Buffer.from(properties)), propertiesAfter: "f".repeat(64),
    activeStateRevision: hash(await readFile(activeFile)), guardBackupId: randomUUID() });
  const journal = new TransactionJournalStore(manager); await journal.initialize();
  const record = await journal.createIntent({ serverId, operationId: generation.operationId, transactionId: generation.transactionId,
    kind: "world-create", scope: "world-set", resourceId: generation.worldId, allowStop: false, originalState: "stopped", createdAt: clock.now().toISOString(),
    paths: [{ role: "source", namespace: "server", relativePath: "world" }, { role: "target", namespace: "server", relativePath: "NewWorld" },
      { role: "staging", namespace: "server", relativePath: `.manager-world-create-${generation.operationId}` }],
    worldChange: { generation, rootIdentity: generation.rootIdentity, previousName: "world", nextName: "NewWorld", approvedRevision: "a".repeat(64),
      guardBackupId: generation.guardBackupId, propertiesBefore: generation.propertiesBefore, propertiesAfter: generation.propertiesAfter,
      workspaceName: `.manager-world-create-${generation.operationId}` } });
  return { manager, server, binding, states, library, list, file, before, activeFile, generation, journal, record };
}
describe("unmounted first generation catalog reservation", () => {
  it("reloads the same UUID through dedicated metadata readback without releasing old consumer gates", async () => {
    const f = await fixture(); await f.library.reserveGeneration(f.binding, f.list.revision!, f.record, f.journal);
    const before = await readFile(f.file), record = await f.journal.get(f.binding.serverId, f.record.transactionId);
    const restarted = new WorldLibraryStore(f.manager, clock);
    const value = await restarted.readGenerationReservation(f.binding, new TransactionJournalStore(f.manager));
    expect(value.reservation).toEqual(f.generation); expect(value.catalogRevision).toBe(hash(before));
    expect(value.recordDigest).toBe(hash(Buffer.from(JSON.stringify(record))));
    value.reservation.nextName = "ChangedReturnedCopy";
    expect((await restarted.readGenerationReservation(f.binding, f.journal)).reservation).toEqual(f.generation);
    expect((await restarted.list(f.binding, f.states.snapshot(f.binding.serverId))).state).toBe("inspection-required");
    expect(await readFile(f.file)).toEqual(before); expect(await f.journal.get(f.binding.serverId, record.transactionId)).toEqual(record);
  });
  it.each(["checkpoint", "committed", "missing"])("rejects metadata readback after journal %s", async scenario => {
    const f = await fixture(); await f.library.reserveGeneration(f.binding, f.list.revision!, f.record, f.journal);
    const before = await readFile(f.file);
    if (scenario === "checkpoint") await f.journal.appendCheckpoint(f.binding.serverId, f.record.transactionId,
      { name: "config-ready", recordedAt: clock.now().toISOString() });
    if (scenario === "committed") await f.journal.setState(f.binding.serverId, f.record.transactionId, "committed", clock.now().toISOString());
    if (scenario === "missing") await rm(path.join(f.manager, "transactions", `${f.binding.serverId}.${f.record.transactionId}.json`));
    await expect(new WorldLibraryStore(f.manager, clock).readGenerationReservation(f.binding, f.journal)).rejects.toThrow();
    expect(await readFile(f.file)).toEqual(before);
  });
  it("persists the same UUID as pending evidence without publishing a world or granting mutations", async () => {
    const f = await fixture();
    await f.library.reserveGeneration(f.binding, f.list.revision!, f.record, f.journal);
    const saved = JSON.parse(await readFile(f.file, "utf8"));
    expect(saved.schemaVersion).toBe(4); expect(saved.generation.reservation).toEqual(f.generation);
    expect(saved.entries).toEqual(JSON.parse(f.before.toString("utf8")).entries);
    expect(saved.entries.some((entry: { worldId: string }) => entry.worldId === f.generation.worldId)).toBe(false);
    const restarted = new WorldLibraryStore(f.manager, clock);
    expect(await restarted.list(f.binding, f.states.snapshot(f.binding.serverId))).toMatchObject({ state: "inspection-required", mutationsAvailable: false });
    const revision = hash(await readFile(f.file));
    await expect(restarted.resolve(f.binding, f.generation.previousWorldId, revision)).rejects.toThrow();
    await expect(restarted.activationBinding(f.binding, f.generation.previousWorldId, revision)).rejects.toThrow();
    await expect(restarted.migrateLegacy(f.binding, f.states.snapshot(f.binding.serverId)!)).rejects.toThrow();
    await expect(restarted.auditImportBindings(f.binding, [], true)).rejects.toThrow();
    await expect(restarted.recordInstalled(f.binding, { worldId: `worldv2-${randomUUID()}`, levelName: "NewWorld", operationId: randomUUID(), expectedRevision: hash(await readFile(f.file)) })).rejects.toThrow();
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe("level-name=world\n");
    expect(await readFile(path.join(f.server, "world", "level.dat"), "utf8")).toBe("isolated world");
  });
  it.each(["schema", "extra", "duplicate"])("rejects correct-digest but malformed active state: %s", async scenario => {
    const f = await fixture(text => {
      if (scenario === "duplicate") return text.trimEnd().replace("{", '{"state":"pending-generation",');
      const state = JSON.parse(text);
      if (scenario === "schema") state.schemaVersion = 2;
      else state.archiveTransactionId = randomUUID();
      return JSON.stringify(state) + "\n";
    });
    await expect(f.library.reserveGeneration(f.binding, f.list.revision!, f.record, f.journal)).rejects.toThrow();
    expect(await readFile(f.file)).toEqual(f.before);
  });
  it("keeps reservation closed when its journal is missing after reload", async () => {
    const f = await fixture(); await f.library.reserveGeneration(f.binding, f.list.revision!, f.record, f.journal);
    const bytes = await readFile(f.file);
    await rm(path.join(f.manager, "transactions", `${f.binding.serverId}.${f.record.transactionId}.json`));
    const restarted = new WorldLibraryStore(f.manager, clock);
    await expect(restarted.auditImportBindings(f.binding, (await new TransactionJournalStore(f.manager).initialize()).records, true)).rejects.toThrow();
    expect((await restarted.list(f.binding, f.states.snapshot(f.binding.serverId))).state).toBe("inspection-required");
    expect(await readFile(f.file)).toEqual(bytes);
  });
  it.each(["mixed-head", "wrong-previous"])("rejects corrupt reservation %s without rewriting evidence", async scenario => {
    const f = await fixture(); await f.library.reserveGeneration(f.binding, f.list.revision!, f.record, f.journal);
    const value = JSON.parse(await readFile(f.file, "utf8"));
    if (scenario === "mixed-head") value.activationHead = { sequence: 1, transactionId: randomUUID(), intentDigest: "a".repeat(64), previousDigest: "b".repeat(64), state: "pending", recordDigest: null };
    else value.generation.reservation.previousWorldId = `worldv2-${randomUUID()}`;
    const text = JSON.stringify(value) + "\n"; await writeFile(f.file, text);
    const restarted = new WorldLibraryStore(f.manager, clock);
    expect((await restarted.list(f.binding, f.states.snapshot(f.binding.serverId))).state).toBe("inspection-required");
    await expect(restarted.auditImportBindings(f.binding, [], true)).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(text);
  });
  it.each(["target", "properties", "active", "journal", "revision", "unpersisted"])("rejects %s changes without catalog mutation", async scenario => {
    const f = await fixture(); let record = f.record, revision = f.list.revision!;
    if (scenario === "target") await mkdir(path.join(f.server, "newworld"));
    if (scenario === "properties") await writeFile(path.join(f.server, "server.properties"), "level-name=Other\n");
    if (scenario === "active") await writeFile(f.activeFile, "{}");
    if (scenario === "journal") await f.journal.setState(f.binding.serverId, f.record.transactionId, "committed", clock.now().toISOString());
    if (scenario === "revision") revision = "0".repeat(64);
    if (scenario === "unpersisted") record = { ...record, updatedAt: "2026-10-28T10:00:00.000Z" };
    await expect(f.library.reserveGeneration(f.binding, revision, record, f.journal)).rejects.toThrow();
    expect(await readFile(f.file)).toEqual(f.before);
  });
});
