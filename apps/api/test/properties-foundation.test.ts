import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { PropertiesGuardStore } from "../src/services/properties-guard.js";
import { readPrivatePropertiesFile, propertiesChecksum } from "../src/services/properties-private-file.js";
import { TransactionJournalStore, type CreateTransactionIntent } from "../src/services/transaction-journal.js";
import { assertPropertiesBootstrapSafety } from "../src/services/properties-bootstrap.js";
import { loadLocalRegistrations, type RawServerConfig } from "../src/config/local-config.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";

const roots: string[] = [];
const secret = "private-foundation-fixture";
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p4-foundation-")); roots.push(root);
  const server = path.join(root, "server"); const manager = path.join(root, "manager");
  await mkdir(server); await mkdir(manager);
  const text = `# fixture\r\npvp=true\nmotd=Hello\rrcon.password=${secret}\n`;
  await writeFile(path.join(server, "server.properties"), text);
  const source = await readPrivatePropertiesFile(path.join(server, "server.properties"));
  const operationId = randomUUID(); const guardId = randomUUID();
  const journal = new TransactionJournalStore(manager); await journal.initialize();
  const intent: CreateTransactionIntent = {
    operationId, serverId: "test-server", kind: "properties-write", scope: null,
    resourceId: guardId, allowStop: false, originalState: "stopped", createdAt: new Date().toISOString(),
    paths: [
      { role: "target", namespace: "server", relativePath: "server.properties" },
      { role: "staging", namespace: "server", relativePath: `.manager-properties-${operationId}` },
      { role: "rollback", namespace: "manager", relativePath: `properties-backups/test-server/${guardId}` }
    ],
    propertiesWrite: {
      rootIdentity: await backupDirectoryIdentity(server), worldId: "world-" + "a".repeat(24), worldRevision: "b".repeat(64),
      originalFileIdentity: source.identity, originalChecksum: source.checksum,
      preparedChecksum: propertiesChecksum(Buffer.from(text.replace("pvp=true", "pvp=false"))),
      guardId, workspaceName: `.manager-properties-${operationId}`
    }
  };
  const config: RawServerConfig = { id: "test-server", name: "Isolated fixture", root: server, javaExecutable: path.join(root, "never-execute"), jarFile: "never-read.jar", jvmArgs: ["-Xms64M", "-Xmx128M"], serverArgs: ["nogui"] };
  return { root, server, manager, source, text, journal, intent, config, store: new PropertiesGuardStore(manager, journal) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("properties durable foundation (no config cutover)", () => {
  it("stores strict schema 6 intent containing bindings/hashes and no raw settings", async () => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    expect(record.schemaVersion).toBe(6);
    expect(JSON.stringify(record)).not.toContain(secret);
    expect(JSON.stringify(record)).not.toContain("pvp=true");
    const scan = await new TransactionJournalStore(f.manager).initialize();
    expect(scan.records[0]?.intent.propertiesWrite).toEqual(f.intent.propertiesWrite);
    expect(scan.recoveryServerIds.has(f.config.id)).toBe(true);
  });
  it.each(["missing-binding", "scope", "running", "allow-stop", "foreign-kind", "extra-secret", "foreign-path", "workspace", "resource", "namespace", "array-world-id"])("rejects invalid journal %s", async (kind) => {
    const f = await fixture(); const bad = structuredClone(f.intent);
    if (kind === "missing-binding") delete bad.propertiesWrite;
    else if (kind === "scope") Object.assign(bad, { scope: "server-snapshot" });
    else if (kind === "running") Object.assign(bad, { originalState: "running" });
    else if (kind === "allow-stop") Object.assign(bad, { allowStop: true });
    else if (kind === "foreign-kind") Object.assign(bad, { kind: "backup" });
    else if (kind === "extra-secret") Object.assign(bad.propertiesWrite!, { password: secret });
    else if (kind === "foreign-path") Object.assign(bad.paths[0]!, { relativePath: "../outside" });
    else if (kind === "workspace") Object.assign(bad.propertiesWrite!, { workspaceName: ".manager-properties-foreign" });
    else if (kind === "resource") Object.assign(bad, { resourceId: randomUUID() });
    else if (kind === "namespace") Object.assign(bad.paths[0]!, { namespace: "manager" });
    else if (kind === "array-world-id") Object.assign(bad.propertiesWrite!, { worldId: [bad.propertiesWrite!.worldId] });
    await expect(f.journal.createIntent(bad)).rejects.toThrow();
    expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it("creates and verifies a pinned private guard before any source mutation", async () => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    const result = await f.store.create(f.config.id, record.transactionId, f.server);
    expect(Object.keys(result)).toEqual(["guardId"]);
    expect(JSON.stringify(result)).not.toContain(secret);
    const directory = path.join(f.manager, "properties-backups", f.config.id, result.guardId);
    expect(await readFile(path.join(directory, "original.properties"), "utf8")).toBe(f.text);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ pinned: true, rootIdentity: f.intent.propertiesWrite!.rootIdentity, originalChecksum: f.source.checksum });
    expect(JSON.stringify(manifest)).not.toContain(secret);
    await f.store.verify(record, f.server);
    expect((await f.journal.get(f.config.id, record.transactionId)).checkpoints.at(-1)?.name).toBe("properties-guard-verified");
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(f.text);
    await expect(f.store.create(f.config.id, record.transactionId, f.server)).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE" });
  });
  it.each(["guard-directory-created", "guard-file-synced", "guard-manifest-synced"])("preserves source and partial guard after interruption at %s", async (checkpoint) => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    await expect(f.store.create(f.config.id, record.transactionId, f.server, async (point) => { if (point === checkpoint) throw new Error("injected-interruption"); })).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE", requiresRecovery: true });
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(f.text);
    const scan = await new TransactionJournalStore(f.manager).initialize();
    expect(scan.records[0]?.checkpoints).toHaveLength(0);
    await expect(assertPropertiesBootstrapSafety([f.config], scan)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it.each(["hardlink", "replaced-source", "root-rebound", "parent-junction", "guard-collision"])("rejects %s without source mutation", async (kind) => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    const sourceFile = path.join(f.server, "server.properties");
    if (kind === "hardlink") await link(sourceFile, path.join(f.root, "outside-copy"));
    else if (kind === "replaced-source") { await rename(sourceFile, path.join(f.server, "old-copy")); await writeFile(sourceFile, f.text); }
    else if (kind === "root-rebound") { await rename(f.server, path.join(f.root, "old-server")); await mkdir(f.server); await writeFile(sourceFile, f.text); }
    else if (kind === "parent-junction") { const elsewhere = path.join(f.root, "elsewhere"); await mkdir(elsewhere); await symlink(elsewhere, path.join(f.manager, "properties-backups"), process.platform === "win32" ? "junction" : "dir"); }
    else await mkdir(path.join(f.manager, "properties-backups", f.config.id, f.intent.propertiesWrite!.guardId), { recursive: true });
    await expect(f.store.create(f.config.id, record.transactionId, f.server)).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE" });
    expect(await readFile(sourceFile, "utf8")).toBe(f.text);
    expect((await f.journal.get(f.config.id, record.transactionId)).checkpoints).toHaveLength(0);
  });
  it("rechecks source after async preparation and never publishes a stale guard", async () => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    await expect(f.store.create(f.config.id, record.transactionId, f.server, async (point) => {
      if (point === "guard-manifest-synced") await writeFile(path.join(f.server, "server.properties"), "pvp=false\n");
    })).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE" });
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe("pvp=false\n");
    expect((await f.journal.get(f.config.id, record.transactionId)).checkpoints).toHaveLength(0);
  });
  it("rejects a guard directory replaced by a junction before payload creation", async () => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    const directory = path.join(f.manager, "properties-backups", f.config.id, f.intent.propertiesWrite!.guardId);
    const outside = path.join(f.root, "outside"); await mkdir(outside);
    await expect(f.store.create(f.config.id, record.transactionId, f.server, async (point) => {
      if (point === "guard-directory-created") {
        await rename(directory, directory + "-retained");
        await symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
      }
    })).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE" });
    await expect(readFile(path.join(outside, "original.properties"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(f.server, "server.properties"), "utf8")).toBe(f.text);
  });
  it("rejects altered caller intent before resolving arbitrary guard destinations", async () => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    const forged = structuredClone(record);
    Object.assign(forged.intent.propertiesWrite!, { guardId: "../outside" });
    await expect(f.store.verify(forged, f.server)).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE" });
  });
  it.each(["backup-root", "instance-directory"])("never writes private guard material inside a registered server at %s", async (layout) => {
    const f = await fixture(); const base = path.join(f.manager, "properties-backups");
    if (layout === "instance-directory") await mkdir(base);
    const nestedServer = layout === "backup-root" ? base : path.join(base, f.config.id);
    await rename(f.server, nestedServer);
    const intent = structuredClone(f.intent);
    Object.assign(intent.propertiesWrite!, { rootIdentity: await backupDirectoryIdentity(nestedServer) });
    const record = await f.journal.createIntent(intent);
    await expect(f.store.create(f.config.id, record.transactionId, nestedServer)).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE" });
    await expect(readFile(path.join(nestedServer, intent.propertiesWrite!.guardId, "original.properties"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(nestedServer, "server.properties"), "utf8")).toBe(f.text);
    expect((await f.journal.get(f.config.id, record.transactionId)).checkpoints).toHaveLength(0);
    expect(await readdir(nestedServer)).toEqual(["server.properties"]);
    await expect(f.store.verify(record, nestedServer)).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE" });
  });
  it("allows normal registered instances under manager outside the private backup tree", async () => {
    const f = await fixture(); const instances = path.join(f.manager, "instances"); await mkdir(instances);
    const nestedServer = path.join(instances, f.config.id); await rename(f.server, nestedServer);
    const intent = structuredClone(f.intent);
    Object.assign(intent.propertiesWrite!, { rootIdentity: await backupDirectoryIdentity(nestedServer) });
    const record = await f.journal.createIntent(intent);
    await expect(f.store.create(f.config.id, record.transactionId, nestedServer)).resolves.toEqual({ guardId: intent.propertiesWrite!.guardId });
    await expect(f.store.verify(record, nestedServer)).resolves.toBeUndefined();
    expect(await readFile(path.join(nestedServer, "server.properties"), "utf8")).toBe(f.text);
  });
  it.each(["payload", "manifest", "hardlink"])("rejects a tampered guard %s", async (kind) => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    await f.store.create(f.config.id, record.transactionId, f.server);
    const directory = path.join(f.manager, "properties-backups", f.config.id, f.intent.propertiesWrite!.guardId);
    if (kind === "payload") await writeFile(path.join(directory, "original.properties"), "pvp=false\n");
    else if (kind === "manifest") await writeFile(path.join(directory, "manifest.json"), "{}");
    else await link(path.join(directory, "original.properties"), path.join(f.root, "private-copy"));
    await expect(f.store.verify(record, f.server)).rejects.toMatchObject({ code: "PROPERTIES_GUARD_UNSAFE" });
  });
  it.each(["active", "committed", "rolled-back"] as const)("gates bootstrap for %s before reading missing properties or executing Java", async (state) => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    if (state !== "active") await f.journal.setState(f.config.id, record.transactionId, state, new Date().toISOString());
    await rm(path.join(f.server, "server.properties"));
    await writeFile(path.join(f.manager, "config.json"), JSON.stringify({ schemaVersion: 1, servers: [f.config] }));
    await expect(loadLocalRegistrations(f.manager)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", requiresRecovery: true });
    expect(await readdir(f.manager)).not.toContain("operations");
    await expect(readFile(path.join(f.server, "server.properties"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("ordinary missing properties cannot fall back to defaults", async () => {
    const f = await fixture(); await rm(path.join(f.server, "server.properties"));
    await writeFile(path.join(f.manager, "config.json"), JSON.stringify({ schemaVersion: 1, servers: [f.config] }));
    await expect(loadLocalRegistrations(f.manager)).rejects.not.toMatchObject({ code: "RECOVERY_REQUIRED" });
    await expect(readFile(path.join(f.server, "server.properties"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reports root rebinding without reading the replacement config", async () => {
    const f = await fixture(); await f.journal.createIntent(f.intent);
    await rename(f.server, path.join(f.root, "old-server")); await mkdir(f.server);
    await expect(assertPropertiesBootstrapSafety([f.config], await f.journal.scan())).rejects.toMatchObject({ reason: "properties-root-binding-mismatch" });
  });
  it("does not classify an unrelated server as a properties recovery", async () => {
    const f = await fixture(); await f.journal.createIntent(f.intent);
    await expect(assertPropertiesBootstrapSafety([{ ...f.config, id: "other" }], await f.journal.scan())).resolves.toBeUndefined();
  });
  it("keeps a valid legacy backup journal on its existing recovery path", async () => {
    const f = await fixture(); const legacy = structuredClone(f.intent);
    delete legacy.propertiesWrite;
    Object.assign(legacy, { kind: "backup", scope: "world-set", paths: [] });
    const record = await f.journal.createIntent(legacy);
    expect(record.schemaVersion).toBe(1);
    await expect(assertPropertiesBootstrapSafety([f.config], await f.journal.scan())).resolves.toBeUndefined();
  });
  it("preserves corrupt properties binding as recovery rather than treating it as a legacy record", async () => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    const file = path.join(f.manager, "transactions", `${f.config.id}.${record.transactionId}.json`);
    const damaged = structuredClone(record); delete damaged.intent.propertiesWrite;
    await writeFile(file, JSON.stringify(damaged));
    const scan = await f.journal.scan();
    expect(scan.issues).toHaveLength(1);
    await expect(assertPropertiesBootstrapSafety([f.config], scan)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("does not report unverified committed properties as successful after OperationService restart", async () => {
    const f = await fixture(); const record = await f.journal.createIntent(f.intent);
    await f.journal.setState(f.config.id, record.transactionId, "committed", new Date().toISOString());
    const operations = new OperationService(new MemoryOperationStore(), { now: () => new Date() }, f.journal);
    await operations.initialize();
    expect(operations.getServerState(f.config.id).recoveryRequired).toBe(true);
  });
});
