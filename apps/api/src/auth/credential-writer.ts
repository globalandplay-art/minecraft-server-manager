import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { readPrivatePropertiesFile } from "../services/properties-private-file.js";
import { ManagerLifetimeLock } from "./manager-lifetime-lock.js";
import { AuthCoreError, parseCredentialRecord, prepareCredentialRecord, type CredentialRecord } from "./password.js";
import { createPrivateEntry, deleteVerifiedPrivate, privateEntryExists, publishPrivateStage, writePrivateNew } from "./private-publication.js";
import { WindowsPrivateAclVerifier } from "./windows-private-acl.js";

type Journal = { version: 1; managerIdentity: string; oldRevision: string | null; nextRevision: string; oldChecksum: string | null; nextChecksum: string; backup: string | null };
const fail = () => new AuthCoreError("AUTH_PRIVATE_UNSAFE");
const checksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n", "utf8");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Only explicit offline callers holding Manager's OS lifetime exclusion may publish. */
export class CredentialWriter {
  #root: string; #directory: string; #credential: string; #pending: string; #stage: string;
  #lock: ManagerLifetimeLock; #acl = new WindowsPrivateAclVerifier();
  #identity: string | undefined;
  constructor(managerRoot: string, lock: ManagerLifetimeLock) {
    lock.assertHeld(managerRoot); this.#root = managerRoot; this.#lock = lock;
    this.#directory = path.join(managerRoot, "auth"); this.#credential = path.join(this.#directory, "credential.json");
    this.#pending = path.join(this.#directory, "credential.pending.json"); this.#stage = path.join(this.#directory, "credential.staged.json");
  }
  async #gate(checkAcl = true): Promise<void> {
    this.#lock.assertHeld(this.#root);
    if (!await privateEntryExists(this.#directory)) await createPrivateEntry(this.#directory, true, this.#acl);
    const info = await lstat(this.#directory, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(this.#directory)).toLowerCase() !== this.#directory.toLowerCase()) throw fail();
    const identity = `${info.dev}\0${info.ino}\0${info.birthtimeNs}`;
    if (this.#identity !== undefined && this.#identity !== identity) throw fail();
    this.#identity = identity; if (checkAcl) await this.#acl.verify(this.#directory);
  }
  async #record(file: string): Promise<{ record: CredentialRecord; checksum: string; bytes: Buffer }> {
    await this.#gate(false);
    const beforeAcls = await this.#acl.verifyMany([this.#directory, file]);
    const read = await readPrivatePropertiesFile(file, 4096);
    try {
      const record = parseCredentialRecord(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(read.bytes)));
      await this.#gate(false);
      const afterAcls = await this.#acl.verifyMany([this.#directory, file]);
      if (afterAcls.some((value, index) => value !== beforeAcls[index])) throw fail();
      const after = await readPrivatePropertiesFile(file, 4096);
      try { if (after.identity !== read.identity || after.checksum !== read.checksum) throw fail(); }
      finally { after.bytes.fill(0); }
      await this.#gate(false);
      return { record, checksum: read.checksum, bytes: read.bytes };
    } catch { read.bytes.fill(0); throw fail(); }
  }
  async #expectCurrent(revision: string | null, expectedChecksum: string | null): Promise<void> {
    if (revision === null) { if (await privateEntryExists(this.#credential)) throw fail(); return; }
    const current = await this.#record(this.#credential);
    try { if (current.record.revision !== revision || current.checksum !== expectedChecksum) throw fail(); }
    finally { current.bytes.fill(0); }
  }
  async publish(action: "init" | "reset", username: string, password: string, expectedRevision?: string): Promise<{ revision: string }> {
    const finish = this.#lock.beginOfflineMutation(this.#root);
    try { return await this.#publish(action, username, password, expectedRevision); }
    finally { finish(); }
  }
  async #publish(action: "init" | "reset", username: string, password: string, expectedRevision?: string): Promise<{ revision: string }> {
    await this.#gate();
    if (!["init", "reset"].includes(action) || await privateEntryExists(this.#pending) || await privateEntryExists(this.#stage)) throw fail();
    let old: { record: CredentialRecord; checksum: string; bytes: Buffer } | undefined;
    if (action === "init") { if (expectedRevision !== undefined || await privateEntryExists(this.#credential)) throw fail(); }
    else {
      if (!expectedRevision || !UUID.test(expectedRevision)) throw fail();
      old = await this.#record(this.#credential);
      if (old.record.revision !== expectedRevision) { old.bytes.fill(0); throw fail(); }
    }
    try {
      const next = await prepareCredentialRecord(username, password); const bytes = encode(next);
      try {
        const journal: Journal = { version: 1, managerIdentity: this.#lock.rootIdentity(), oldRevision: old?.record.revision ?? null, nextRevision: next.revision, oldChecksum: old?.checksum ?? null, nextChecksum: checksum(bytes), backup: old ? `credential.backup.${old.record.revision}.json` : null };
        if (old && journal.backup) {
          const backupFile = path.join(this.#directory, journal.backup);
          if (!await privateEntryExists(backupFile)) await writePrivateNew(backupFile, old.bytes, this.#acl);
          const backup = await this.#record(backupFile);
          try { if (backup.checksum !== old.checksum || backup.record.revision !== old.record.revision || !backup.bytes.equals(old.bytes)) throw fail(); }
          finally { backup.bytes.fill(0); }
        }
        await this.#expectCurrent(journal.oldRevision, journal.oldChecksum);
        const pendingBytes = encode(journal);
        try {
          await writePrivateNew(this.#pending, pendingBytes, this.#acl);
          await writePrivateNew(this.#stage, bytes, this.#acl);
          await this.#commit(journal);
          await deleteVerifiedPrivate(this.#pending, checksum(pendingBytes), this.#acl);
        } finally { pendingBytes.fill(0); }
        return { revision: next.revision };
      } finally { bytes.fill(0); }
    } finally { old?.bytes.fill(0); }
  }
  async #commit(journal: Journal): Promise<void> {
    await this.#gate(); await this.#expectCurrent(journal.oldRevision, journal.oldChecksum);
    const staged = await this.#record(this.#stage);
    try { if (staged.record.revision !== journal.nextRevision || staged.checksum !== journal.nextChecksum) throw fail(); }
    finally { staged.bytes.fill(0); }
    await publishPrivateStage(this.#stage, this.#credential);
    const current = await this.#record(this.#credential);
    try { if (current.checksum !== journal.nextChecksum || current.record.revision !== journal.nextRevision) throw fail(); }
    finally { current.bytes.fill(0); }
  }
  /** Explicit recovery only; never guessing, deleting an unknown stage, or auto-overwriting credentials. */
  async recover(): Promise<{ revision: string | null; outcome: "committed" | "prior-preserved" }> {
    const finish = this.#lock.beginOfflineMutation(this.#root);
    try { return await this.#recover(); }
    finally { finish(); }
  }
  async #recover(): Promise<{ revision: string | null; outcome: "committed" | "prior-preserved" }> {
    await this.#gate();
    await this.#acl.verify(this.#pending); const pending = await readPrivatePropertiesFile(this.#pending, 4096);
    try {
      const value: unknown = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(pending.bytes));
      if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).sort().join(",") !== "backup,managerIdentity,nextChecksum,nextRevision,oldChecksum,oldRevision,version") throw fail();
      const journal = value as Journal;
      if (journal.version !== 1 || journal.managerIdentity !== this.#lock.rootIdentity() || typeof journal.nextRevision !== "string" || !UUID.test(journal.nextRevision) || !/^[0-9a-f]{64}$/u.test(journal.nextChecksum) ||
        (journal.oldRevision === null ? journal.oldChecksum !== null || journal.backup !== null : typeof journal.oldRevision !== "string" || !UUID.test(journal.oldRevision) || !/^[0-9a-f]{64}$/u.test(journal.oldChecksum ?? "") || journal.backup !== `credential.backup.${journal.oldRevision}.json`)) throw fail();
      if (journal.backup) {
        const backup = await this.#record(path.join(this.#directory, journal.backup));
        try { if (backup.record.revision !== journal.oldRevision || backup.checksum !== journal.oldChecksum) throw fail(); }
        finally { backup.bytes.fill(0); }
      }
      let currentRevision: string | null = null; let currentChecksum: string | null = null;
      if (await privateEntryExists(this.#credential)) {
        const current = await this.#record(this.#credential);
        currentRevision = current.record.revision; currentChecksum = current.checksum; current.bytes.fill(0);
      }
      if (currentRevision === journal.nextRevision && currentChecksum === journal.nextChecksum) {
        if (await privateEntryExists(this.#stage)) await deleteVerifiedPrivate(this.#stage, journal.nextChecksum, this.#acl);
      } else {
        await this.#expectCurrent(journal.oldRevision, journal.oldChecksum);
        if (await privateEntryExists(this.#stage)) { await this.#commit(journal); currentRevision = journal.nextRevision; }
        // Journal durable but stage absent: no replacement occurred; retain verified prior credential.
      }
      await deleteVerifiedPrivate(this.#pending, pending.checksum, this.#acl);
      return { revision: currentRevision, outcome: currentRevision === journal.nextRevision ? "committed" : "prior-preserved" };
    } catch { throw fail(); }
    finally { pending.bytes.fill(0); }
  }
}
