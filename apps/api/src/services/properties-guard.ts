import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { missingFile, syncRestoreDirectory } from "./restore-files.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";

const unsafe = () => new DomainError(409, "PROPERTIES_GUARD_UNSAFE", "配置保护备份未通过核验，保留现场并禁止配置切换", "properties-guard-invalid", true);
function assertPrivateLayout(managerRoot: string, registeredRoot: string): void {
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  const contains = (parent: string, child: string) => {
    const relative = path.relative(normalize(parent), normalize(child));
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  const privateRoot = path.join(managerRoot, "properties-backups");
  if (contains(registeredRoot, managerRoot) || contains(registeredRoot, privateRoot) || contains(privateRoot, registeredRoot)) throw unsafe();
}

/** Private preparation only: never changes server.properties or returns its contents. */
export class PropertiesGuardStore {
  constructor(readonly managerRoot: string, readonly journal: TransactionJournalStore) {}

  async create(serverId: string, transactionId: string, registeredRoot: string, inject?: (point: string) => Promise<void>): Promise<{ guardId: string }> {
    try {
      assertPrivateLayout(this.managerRoot, registeredRoot);
      const record = await this.journal.get(serverId, transactionId);
      const p = record.intent.propertiesWrite;
      if (!p || record.state !== "active" || record.checkpoints.some((c) => c.name === "properties-guard-verified")) throw unsafe();
      const serverIdentity = await backupDirectoryIdentity(registeredRoot);
      if (serverIdentity !== p.rootIdentity) throw unsafe();
      const managerIdentity = await backupDirectoryIdentity(this.managerRoot);
      const source = await readPrivatePropertiesFile(path.join(registeredRoot, "server.properties"));
      if (source.identity !== p.originalFileIdentity || source.checksum !== p.originalChecksum) throw unsafe();
      const parents = [this.managerRoot];
      const identities = [managerIdentity];
      const check = async () => {
        if (await backupDirectoryIdentity(registeredRoot) !== serverIdentity) throw unsafe();
        for (let i = 0; i < parents.length; i++) if (await backupDirectoryIdentity(parents[i]!) !== identities[i]) throw unsafe();
      };
      for (const segment of ["properties-backups", serverId]) {
        await check();
        const next = path.join(parents.at(-1)!, segment);
        try { await backupDirectoryIdentity(next); }
        catch (error) { if (!missingFile(error)) throw error; await mkdir(next, { mode: 0o700 }); await syncRestoreDirectory(parents.at(-1)!); }
        parents.push(next); identities.push(await backupDirectoryIdentity(next));
      }
      await check();
      const directory = path.join(parents.at(-1)!, p.guardId);
      await mkdir(directory, { mode: 0o700 }); // Existing/partial guards are retained, never overwritten.
      parents.push(directory); identities.push(await backupDirectoryIdentity(directory));
      await syncRestoreDirectory(path.dirname(directory));
      await inject?.("guard-directory-created");
      await check();
      const file = path.join(directory, "original.properties");
      const output = await open(file, "wx", 0o600);
      try { await output.writeFile(source.bytes); await output.sync(); } finally { await output.close(); }
      await syncRestoreDirectory(directory);
      await inject?.("guard-file-synced");
      await check();
      const guard = await readPrivatePropertiesFile(file);
      if (guard.checksum !== p.originalChecksum || !guard.bytes.equals(source.bytes)) throw unsafe();
      const current = await readPrivatePropertiesFile(path.join(registeredRoot, "server.properties"));
      if (current.identity !== source.identity || current.checksum !== source.checksum) throw unsafe();
      const manifest = {
        schemaVersion: 1, serverId, transactionId, operationId: record.intent.operationId,
        guardId: p.guardId, rootIdentity: p.rootIdentity, originalFileIdentity: p.originalFileIdentity,
        originalChecksum: p.originalChecksum, sizeBytes: source.bytes.length,
        directoryIdentity: identities.at(-1), guardFileIdentity: guard.identity, pinned: true
      };
      await check();
      const metadata = await open(path.join(directory, "manifest.json"), "wx", 0o600);
      try { await metadata.writeFile(JSON.stringify(manifest) + "\n", "utf8"); await metadata.sync(); } finally { await metadata.close(); }
      await syncRestoreDirectory(directory);
      await inject?.("guard-manifest-synced");
      await check();
      await this.verify(record, registeredRoot);
      const finalSource = await readPrivatePropertiesFile(path.join(registeredRoot, "server.properties"));
      if (finalSource.identity !== source.identity || finalSource.checksum !== source.checksum) throw unsafe();
      await check();
      const latest = await this.journal.get(serverId, transactionId);
      if (latest.state !== "active" || JSON.stringify(latest.intent) !== JSON.stringify(record.intent)) throw unsafe();
      await this.journal.appendCheckpoint(serverId, transactionId, {
        name: "properties-guard-verified", recordedAt: new Date().toISOString(),
        details: { resourceId: p.guardId, checksumSha256: p.originalChecksum }
      });
      return { guardId: p.guardId };
    } catch { throw unsafe(); }
  }

  async verify(record: TransactionJournalRecord, registeredRoot: string): Promise<void> {
    try {
      assertPrivateLayout(this.managerRoot, registeredRoot);
      const stored = await this.journal.get(record.intent.serverId, record.transactionId);
      if (JSON.stringify(stored.intent) !== JSON.stringify(record.intent)) throw unsafe();
      const p = record.intent.propertiesWrite;
      if (!p || await backupDirectoryIdentity(registeredRoot) !== p.rootIdentity) throw unsafe();
      const chain = [this.managerRoot, path.join(this.managerRoot, "properties-backups"), path.join(this.managerRoot, "properties-backups", record.intent.serverId)];
      const identities = await Promise.all(chain.map(backupDirectoryIdentity));
      const directory = path.join(chain.at(-1)!, p.guardId);
      const directoryIdentity = await backupDirectoryIdentity(directory);
      const metadata = await readPrivatePropertiesFile(path.join(directory, "manifest.json"), 8192);
      const guard = await readPrivatePropertiesFile(path.join(directory, "original.properties"));
      const expected = {
        schemaVersion: 1, serverId: record.intent.serverId, transactionId: record.transactionId,
        operationId: record.intent.operationId, guardId: p.guardId, rootIdentity: p.rootIdentity,
        originalFileIdentity: p.originalFileIdentity, originalChecksum: p.originalChecksum,
        sizeBytes: guard.bytes.length, directoryIdentity, guardFileIdentity: guard.identity, pinned: true
      };
      if (JSON.stringify(JSON.parse(metadata.bytes.toString("utf8"))) !== JSON.stringify(expected) || guard.checksum !== p.originalChecksum) throw unsafe();
      if (await backupDirectoryIdentity(registeredRoot) !== p.rootIdentity || await backupDirectoryIdentity(directory) !== directoryIdentity) throw unsafe();
      for (let i = 0; i < chain.length; i++) if (await backupDirectoryIdentity(chain[i]!) !== identities[i]) throw unsafe();
    } catch { throw unsafe(); }
  }
}
