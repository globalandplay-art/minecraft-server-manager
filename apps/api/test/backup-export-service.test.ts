import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fromBuffer, type Entry } from "yauzl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import { BackupService } from "../src/services/backup-service.js";
import { BackupExportService } from "../src/services/backup-export-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-10-01T00:00:00Z") };
async function completed(operations: OperationService, id: string) {
  await vi.waitFor(() => expect(operations.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u));
  return operations.get(id)!;
}
async function fixture(scope: "world-set" | "server-snapshot" = "world-set", extra?: { name: string; contents: string }) {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-export-")); roots.push(parent);
  const managerRoot = path.join(parent, "manager");
  const serverRoot = path.join(parent, "server");
  await mkdir(managerRoot);
  await mkdir(path.join(serverRoot, "world", "region"), { recursive: true });
  await writeFile(path.join(serverRoot, "world", "level.dat"), "binary world fixture");
  await writeFile(path.join(serverRoot, "world", "region", "r.0.0.mca"), "rcon.password=binary sentinel not text");
  await writeFile(path.join(serverRoot, "server.properties"), "level-name=world\nrcon.password=DO_NOT_EXPORT\n");
  await writeFile(path.join(serverRoot, "server.jar"), "jar"); await writeFile(path.join(serverRoot, "eula.txt"), "eula=true");
  if (extra) {
    const destination = path.join(serverRoot, "world", extra.name);
    await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, extra.contents);
  }
  const adapter = { mode: "local", serverId: "vanilla-test",
    plan: { rootPath: serverRoot, jarPath: path.join(serverRoot, "server.jar"), serverInfo: { type: "vanilla" } },
    getStatus: async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }),
    getCapabilities: async () => ({ backup: true }), subscribe: () => () => {}, closeObserver: async () => {},
    start: vi.fn(), stop: vi.fn()
  } as unknown as LocalMinecraftServerAdapter;
  const journal = new TransactionJournalStore(managerRoot); await journal.initialize();
  const store = new MemoryOperationStore(); const operations = new OperationService(store, clock, journal); await operations.initialize();
  const backups = new BackupService(new AdapterRegistry([adapter]), operations, journal, managerRoot, clock);
  const operation = await backups.create(adapter.serverId, { scope, allowStop: false }, randomUUID());
  expect((await completed(operations, operation.id)).state).toBe("succeeded");
  const [backup] = await backups.list(adapter.serverId);
  return { parent, managerRoot, serverRoot, adapter, journal, store, operations, backups, backup: backup!,
    exports: new BackupExportService(backups, operations), directory: path.join(managerRoot, "backups", adapter.serverId, backup!.id) };
}
async function bytes(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const parts: Buffer[] = []; for await (const chunk of stream) parts.push(Buffer.from(chunk)); return Buffer.concat(parts);
}
async function entries(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error || !zip) { reject(error); return; }
    const files = new Map<string, Buffer>(); zip.on("error", reject); zip.on("end", () => resolve(files));
    zip.on("entry", (entry: Entry) => zip.openReadStream(entry, (failure, stream) => {
      if (failure || !stream) { reject(failure); return; }
      void bytes(stream).then((data) => { files.set(entry.fileName, data); zip.readEntry(); }, reject);
    })); zip.readEntry();
  }));
}
async function rewriteManifest(directory: string, change: (value: Record<string, unknown>) => void) {
  const file = path.join(directory, "manifest.json"); const value = JSON.parse(await readFile(file, "utf8"));
  change(value);
  const files = value.files as Array<{ path: string; sizeBytes: number; sha256: string }>;
  value.checksumSha256 = createHash("sha256").update(files.map((entry) => `${entry.path}\0${entry.sizeBytes}\0${entry.sha256}`).join("\n")).digest("hex");
  await writeFile(file, JSON.stringify(value));
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    // Targets are exact mkdtemp roots owned by these tests, never user server directories.
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith("mcsm-export-")) throw new Error("unsafe-test-cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

describe("secure immutable world-set export", () => {
  it("exports a readable ZIP without server secrets or live-world changes, and reuses the artifact", async () => {
    const f = await fixture();
    await writeFile(path.join(f.serverRoot, "world", "level.dat"), "live changed");
    const beforeManifest = await readFile(path.join(f.directory, "manifest.json"));
    expect((await f.exports.status(f.adapter.serverId, f.backup.id)).state).toBe("available");
    const key = randomUUID(); const op = await f.exports.request(f.adapter.serverId, f.backup.id, key);
    expect((await completed(f.operations, op.id)).state).toBe("succeeded");
    expect((await f.exports.request(f.adapter.serverId, f.backup.id, key)).id).toBe(op.id);
    const download = await f.exports.download(f.adapter.serverId, f.backup.id);
    const archive = await bytes(download.stream); const files = await entries(archive);
    expect([...files.keys()]).toEqual(["world/level.dat", "world/region/r.0.0.mca"]);
    expect(files.get("world/level.dat")?.toString()).toBe("binary world fixture");
    expect(archive.includes(Buffer.from("DO_NOT_EXPORT"))).toBe(false);
    expect(createHash("sha256").update(archive).digest("hex")).toBe(download.checksumSha256);
    const firstRecord = await readFile(path.join(f.directory, "export.json"));
    const again = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    expect((await completed(f.operations, again.id)).state).toBe("succeeded");
    expect(await readFile(path.join(f.directory, "export.json"))).toEqual(firstRecord);
    expect(await readFile(path.join(f.directory, "manifest.json"))).toEqual(beforeManifest);
    expect(await readdir(f.directory)).toEqual(expect.arrayContaining(["payload", "manifest.json", "world-set.zip", "export.json"]));
    expect(f.adapter.start).not.toHaveBeenCalled(); expect(f.adapter.stop).not.toHaveBeenCalled();
  });
  it("rejects server-snapshot before scheduling or exposing bytes", async () => {
    const f = await fixture("server-snapshot");
    await expect(f.exports.request(f.adapter.serverId, f.backup.id, randomUUID())).rejects.toMatchObject({ statusCode: 403, code: "EXPORT_NOT_SUPPORTED" });
    await expect(f.exports.download(f.adapter.serverId, f.backup.id)).rejects.toMatchObject({ code: "EXPORT_NOT_SUPPORTED" });
  });
  it.each([
    "data/minecraft/game_rules.dat",
    "dimensions/minecraft/overworld/data/minecraft/chunk_tickets.dat",
    "dimensions/minecraft/the_nether/region/r.0.0.mca",
    "dimensions/minecraft/the_end/region/r.0.0.mca",
    "players/data/123e4567-e89b-42d3-a456-426614174000.dat"
  ])("exports the observed Vanilla 26.3 layout: %s", async (name) => {
    const f = await fixture("world-set", { name, contents: "binary world storage" });
    const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    expect((await completed(f.operations, op.id)).state).toBe("succeeded");
    const download = await f.exports.download(f.adapter.serverId, f.backup.id);
    expect((await entries(await bytes(download.stream))).get("world/" + name)?.toString()).toBe("binary world storage");
  });
  it("closes a cancelled download and permits a fresh download of the same verified artifact", async () => {
    const f = await fixture(); const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    await completed(f.operations, op.id);
    const first = await f.exports.download(f.adapter.serverId, f.backup.id);
    const closed = once(first.stream, "close");
    first.stream.once("data", () => first.stream.destroy()); first.stream.resume();
    await closed; expect(first.stream.closed).toBe(true);
    const retry = await f.exports.download(f.adapter.serverId, f.backup.id);
    expect(createHash("sha256").update(await bytes(retry.stream)).digest("hex")).toBe(first.checksumSha256);
  });
  it.each(['{"rcon.password":"test"}', '{"password":"test"}', '{"s\\u0065cret":"test"}', '{"message":"apikey=test"}'])
    ("blocks textual secret candidates without leaking values: %s", async (contents) => {
      const f = await fixture("world-set", { name: "data/custom.json", contents });
      const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
      const result = await completed(f.operations, op.id);
      expect(result.state).toBe("failed"); expect(result.error?.code).toBe("SENSITIVE_ARCHIVE");
      expect(JSON.stringify(result.error)).not.toContain("test");
      expect(await readdir(f.directory)).not.toContain("export.json");
      expect(f.operations.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    });
  it("fails closed for nested configuration, even with a valid backup manifest", async () => {
    const f = await fixture("world-set", { name: "server.properties", contents: "rcon.password=test" });
    await expect(f.exports.request(f.adapter.serverId, f.backup.id, randomUUID())).rejects.toMatchObject({ code: "EXPORT_LAYOUT_UNSAFE" });
  });
  it.each(["JSON", "Json"])("scans allowed JSON files regardless of extension case: %s", async (extension) => {
    const f = await fixture("world-set", { name: `stats/${randomUUID()}.${extension}`, contents: '{"token":"test"}' });
    const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    expect((await completed(f.operations, op.id)).error?.code).toBe("SENSITIVE_ARCHIVE");
    expect(await readdir(f.directory)).not.toContain("export.json");
  });
  it("rescans mixed-case JSON inside a cached artifact even with matching forged checksums", async () => {
    const name = `world/stats/${randomUUID()}.Json`;
    const safe = Buffer.from('{"value":"safe"}'); const secret = Buffer.from('{"token":"test"}');
    expect(secret.length).toBe(safe.length);
    const f = await fixture("world-set", { name: name.slice("world/".length), contents: safe.toString() });
    const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    expect((await completed(f.operations, op.id)).state).toBe("succeeded");
    const archivePath = path.join(f.directory, "world-set.zip");
    const archive = await readFile(archivePath); const offset = archive.indexOf(safe);
    expect(offset).toBeGreaterThan(0); secret.copy(archive, offset);
    let crc = 0xffffffff;
    for (const byte of secret) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const checksum = (crc ^ 0xffffffff) >>> 0;
    archive.writeUInt32LE(checksum, offset + secret.length + 4);
    const centralName = archive.lastIndexOf(Buffer.from(name));
    archive.writeUInt32LE(checksum, centralName - 46 + 16);
    await writeFile(archivePath, archive);
    await rewriteManifest(f.directory, (value) => {
      const entry = (value.files as Array<{ path: string; sha256: string }>).find((file) => file.path === name)!;
      entry.sha256 = createHash("sha256").update(secret).digest("hex");
    });
    const manifest = JSON.parse(await readFile(path.join(f.directory, "manifest.json"), "utf8"));
    const recordPath = path.join(f.directory, "export.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    record.manifestChecksum = manifest.checksumSha256;
    record.checksumSha256 = createHash("sha256").update(archive).digest("hex");
    await writeFile(recordPath, JSON.stringify(record));
    await expect(f.exports.download(f.adapter.serverId, f.backup.id)).rejects.toMatchObject({ code: "SENSITIVE_ARCHIVE" });
    const cached = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    expect((await completed(f.operations, cached.id)).error?.code).toBe("SENSITIVE_ARCHIVE");
  });
  it.each(["../secret", "../../secret", "world/data/bad:stream.json", "world/data/name\r\n.json", "world/data/CON.json"])
    ("rejects unsafe manifest path %s", async (name) => {
      const f = await fixture();
      await rewriteManifest(f.directory, (value) => { (value.files as Array<{ path: string }>)[0]!.path = name; });
      await expect(f.exports.request(f.adapter.serverId, f.backup.id, randomUUID())).rejects.toMatchObject({ statusCode: 409 });
    });
  it("rejects a symlink/junction escape in the immutable payload", async () => {
    const f = await fixture(); const level = path.join(f.directory, "payload", "world", "region");
    await rm(level, { recursive: true });
    await symlink(path.join(f.serverRoot, "world", "region"), level, process.platform === "win32" ? "junction" : "dir");
    const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    expect((await completed(f.operations, op.id)).error?.code).toBe("EXPORT_LAYOUT_UNSAFE");
  });
  it("rejects an unlisted file in payload instead of silently adding or omitting it", async () => {
    const f = await fixture();
    await writeFile(path.join(f.directory, "payload", "world", "ops.json"), "private-sentinel");
    const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    expect((await completed(f.operations, op.id)).error?.code).toBe("EXPORT_LAYOUT_UNSAFE");
    expect(await readdir(f.directory)).not.toContain("export.json");
  });
  it("rejects exports above the explicit initial size limit without reading payload bytes", async () => {
    const f = await fixture();
    await rewriteManifest(f.directory, (manifest) => {
      const files = manifest.files as Array<{ sizeBytes: number }>;
      files[0]!.sizeBytes = 2 * 1024 ** 3 + 1;
      manifest.sizeBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    });
    await expect(f.exports.request(f.adapter.serverId, f.backup.id, randomUUID())).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE", statusCode: 413 });
  });
  it("rejects tampered payload and archive, and returns 404 for a missing backup", async () => {
    const f = await fixture();
    await expect(f.exports.request(f.adapter.serverId, randomUUID(), randomUUID())).rejects.toMatchObject({ statusCode: 404 });
    await expect(f.exports.download(f.adapter.serverId, f.backup.id)).rejects.toMatchObject({ code: "EXPORT_NOT_READY" });
    const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID()); await completed(f.operations, op.id);
    await writeFile(path.join(f.directory, "world-set.zip"), "tampered");
    await expect(f.exports.download(f.adapter.serverId, f.backup.id)).rejects.toMatchObject({ code: "EXPORT_LAYOUT_UNSAFE" });
    const other = await fixture();
    await writeFile(path.join(other.directory, "payload", "world", "level.dat"), "bad changed data");
    const changed = await other.exports.request(other.adapter.serverId, other.backup.id, randomUUID());
    expect((await completed(other.operations, changed.id)).state).toBe("failed");
  });
  it("does not trust a replaced cached ZIP even when its metadata checksum is forged to match", async () => {
    const f = await fixture(); const op = await f.exports.request(f.adapter.serverId, f.backup.id, randomUUID());
    await completed(f.operations, op.id);
    const archivePath = path.join(f.directory, "world-set.zip");
    const original = await readFile(archivePath);
    // Extra bytes must not ride outside manifest-validated entries or in ZIP comments.
    const forged = Buffer.concat([original, Buffer.from("rcon.password=hidden-sentinel")]);
    await writeFile(archivePath, forged);
    const metadataPath = path.join(f.directory, "export.json");
    const record = JSON.parse(await readFile(metadataPath, "utf8"));
    record.sizeBytes = forged.length; record.checksumSha256 = createHash("sha256").update(forged).digest("hex");
    await writeFile(metadataPath, JSON.stringify(record));
    await expect(f.exports.download(f.adapter.serverId, f.backup.id)).rejects.toMatchObject({ code: "EXPORT_LAYOUT_UNSAFE" });
  });
  it("does not gate a live server when an export operation is interrupted at manager restart", async () => {
    const f = await fixture(); const record = (await f.store.list())[0]!;
    await f.store.save({ ...record, operation: { ...record.operation, id: randomUUID(), kind: "backup-export", state: "running" } });
    const restarted = new OperationService(f.store, clock, f.journal); await restarted.initialize();
    expect(restarted.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });
  it("serves guarded asynchronous APIs and system-controlled ZIP download headers", async () => {
    const f = await fixture(); const app = buildApp({ adapters: [f.adapter], mode: "local", clock, managerRoot: f.managerRoot,
      transactionJournal: f.journal, transactionRecovery: f.journal, operationStore: f.store });
    try {
      const base = `/api/v1/servers/${f.adapter.serverId}/backups/${f.backup.id}`;
      const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui", "idempotency-key": randomUUID() };
      expect((await app.inject({ method: "POST", url: base + "/exports", headers: { host: "evil.example" }, payload: {} })).statusCode).toBe(403);
      const response = await app.inject({ method: "POST", url: base + "/exports", headers, payload: {} });
      expect(response.statusCode).toBe(202); const id = response.json().data.operation.id as string;
      await vi.waitFor(async () => expect((await app.inject({ url: `/api/v1/operations/${id}`, headers })).json().data.state).toBe("succeeded"));
      const status = await app.inject({ url: base + "/exports", headers }); expect(status.json().data.state).toBe("ready");
      const download = await app.inject({ url: base + "/download", headers });
      expect(download.statusCode).toBe(200); expect(download.headers["content-type"]).toBe("application/zip");
      expect(download.headers["content-disposition"]).toBe(`attachment; filename="world-set-${f.backup.id}.zip"`);
      expect(download.headers["cache-control"]).toBe("no-store"); expect(download.headers["x-content-type-options"]).toBe("nosniff");
      expect(download.headers["content-length"]).toBe(String(download.rawPayload.length));
      expect((await entries(download.rawPayload)).size).toBe(2);
      expect((await app.inject({ method: "POST", url: base + "/exports", headers, payload: { filename: "bad\r\n.zip" } })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
});
