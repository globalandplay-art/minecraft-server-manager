import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { createPrivateEntry, publishPrivateStageNew, writePrivateNew } from "../auth/private-publication.js";
import { WindowsPrivateAclVerifier } from "../auth/windows-private-acl.js";
import { AuthCoreError } from "../auth/password.js";
import { DomainError } from "./domain-errors.js";
import { whitelistCommandHash } from "./whitelist-command-record.js";
import { whitelistMemberRevision, type WhitelistMemberSnapshot } from "./whitelist-member-policy.js";
import { WHITELIST_BYTES } from "./whitelist-reader.js";
import type { WhitelistCommandPublication } from "./whitelist-command-store.js";
import { WhitelistEnvelopeAclAction } from "./whitelist-envelope-acl.js";
import type { WhitelistOwnedGuardAccess, WhitelistOwnedWideGuardAccess } from "./whitelist-owned-publication.js";

type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation">;
type Acl = Pick<WindowsPrivateAclVerifier, "verifyMany">;
type Source = Omit<WhitelistMemberSnapshot, "members">;
type OwnedExecutor = ReturnType<typeof WhitelistEnvelopeAclAction.guardStoreExecutor>;
type OwnedDependencies = Parameters<typeof WhitelistEnvelopeAclAction.guardStoreExecutor>[2];
interface Manifest { schemaVersion: 1; operationId: string; managerRootIdentity: string; namespaceIdentity: string;
  directoryIdentity: string; source: Source; revision: string; byteLength: number; chunks: number; pinned: true }
const id = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const digest = /^[a-f0-9]{64}$/u;
const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
const unsafe = () => new DomainError(503, "WHITELIST_GUARD_UNSAFE", "白名单保护数据不可安全确认", "whitelist-guard-unsafe", true);
async function identity(directory: string): Promise<string> {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || normalized(await realpath(directory)) !== normalized(directory)) throw unsafe();
  return whitelistCommandHash(`${info.dev}\0${info.ino}\0${info.birthtimeNs}`);
}
function parsed(bytes: Buffer, source: Source): WhitelistMemberSnapshot {
  if (!bytes.length || bytes.length > WHITELIST_BYTES || whitelistCommandHash(bytes) !== source.fileSha256) throw unsafe();
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.startsWith("\ufeff") || text.includes("\0")) throw unsafe();
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw unsafe();
  const members = value.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "name,uuid") throw unsafe();
    const item = row as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.uuid !== "string") throw unsafe();
    return { name: item.name, uuid: item.uuid.toLowerCase() };
  });
  const snapshot = { ...source, members }; whitelistMemberRevision(snapshot); return snapshot;
}
export function verifyWhitelistSourceBytes(snapshot: WhitelistMemberSnapshot, bytes: Buffer): void {
  const source: Source = { serverId: snapshot.serverId, rootIdentity: snapshot.rootIdentity, configRevision: snapshot.configRevision,
    fileIdentity: snapshot.fileIdentity, fileSha256: snapshot.fileSha256, runtimeId: snapshot.runtimeId };
  if (whitelistMemberRevision(parsed(bytes, source)) !== whitelistMemberRevision(snapshot)) throw unsafe();
}

/** Private exact-byte protection only. No member-file write, restore or automatic deletion. */
export class WhitelistGuardStore {
  readonly #wide: boolean;
  readonly #directory: string; #namespace: string | null = null; #busy = false; #poisoned = false;
  readonly #known = new Map<string, string>();
  private constructor(readonly root: string, readonly owner: Owner, readonly acl: Acl,
    readonly publication: WhitelistCommandPublication, readonly rootIdentity: string,
    private readonly owned?: OwnedExecutor, wide = false) { this.#directory = path.join(root, "whitelist-guards"); this.#wide = wide; }
  get ownedDiagnostic() { return this.owned?.diagnostic ?? null; }
  /** UNWIRED alternative. Test dependencies are trusted construction, never HTTP/config. */
  static async openOwned(root: string, owner: ManagerLifetimeLock, testDependencies?: OwnedDependencies) {
    return this.#openOwned(root, owner, testDependencies, false);
  }
  /** Separate UNWIRED capacity composition. No production caller or mutable mode. */
  static async openOwnedWide(root: string, owner: ManagerLifetimeLock, testDependencies?: OwnedDependencies) {
    return this.#openOwned(root, owner, testDependencies, true);
  }
  static async #openOwned(root: string, owner: ManagerLifetimeLock, testDependencies: OwnedDependencies, wide: boolean) {
    try {
      if (!path.isAbsolute(root) || root !== path.resolve(root) || root.startsWith("\\\\") || root.startsWith("//")) throw unsafe();
      const owned = WhitelistEnvelopeAclAction.guardStoreExecutor(owner, root, testDependencies, wide);
      return await owned.run(performance.now() + 50_000, async (access) => {
        const rootIdentity = await access.directoryIdentity(""); if (rootIdentity === null) throw unsafe();
        const deny = async (): Promise<never> => { throw unsafe(); };
        // Preserve legacy open's public shape without attaching usable legacy helpers here.
        const store = new WhitelistGuardStore(root, owner, Object.freeze({ verifyMany: deny }),
          Object.freeze({ createDirectory: deny, writeNew: deny, publishNew: deny }), rootIdentity, owned, wide);
        store.#namespace = await access.directoryIdentity("whitelist-guards");
        await store.#scan(access); await store.#gate(access); return store;
      });
    } catch { throw unsafe(); }
  }
  static async open(root: string, owner: Owner, acl = new WindowsPrivateAclVerifier(), publication?: WhitelistCommandPublication) {
    try {
      if (!path.isAbsolute(root) || root !== path.resolve(root) || root.startsWith("\\\\") || root.startsWith("//")) throw unsafe();
      owner.assertHeld(root);
      const store = new WhitelistGuardStore(root, owner, acl, publication ?? { createDirectory: (file) => createPrivateEntry(file, true, acl),
        writeNew: (file, bytes) => writePrivateNew(file, bytes, acl), publishNew: publishPrivateStageNew }, await identity(root));
      try { store.#namespace = await identity(store.#directory); } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }
      await store.scan(); return store;
    } catch { throw unsafe(); }
  }
  async #identity(directory: string, access?: WhitelistOwnedGuardAccess): Promise<string> {
    if (!access) return identity(directory);
    const result = await access.directoryIdentity(this.#relative(directory)); if (result === null) throw unsafe(); return result;
  }
  #relative(file: string): string {
    const relative = path.relative(this.root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw unsafe(); return relative.split(path.sep).join("/");
  }
  #list(directory: string, access?: WhitelistOwnedGuardAccess): Promise<string[]> {
    return access ? access.listDirectory(this.#relative(directory)) : readdir(directory);
  }
  async #gate(access?: WhitelistOwnedGuardAccess): Promise<void> {
    if (this.#poisoned) throw unsafe(); this.owner.assertHeld(this.root);
    if (access) {
      if (await this.#identity(this.root, access) !== this.rootIdentity ||
        await access.directoryIdentity("whitelist-guards") !== this.#namespace) throw unsafe(); return;
    }
    if (await identity(this.root) !== this.rootIdentity || (this.#namespace !== null && await identity(this.#directory) !== this.#namespace)) throw unsafe();
  }
  async #ownedExclusive<T>(action: (access?: WhitelistOwnedGuardAccess) => Promise<T>): Promise<T> {
    if (this.#poisoned) throw unsafe(); this.#busy = true;
    let outcome: { value?: T; expected?: DomainError };
    try {
      outcome = await this.owned!.run(performance.now() + 50_000, async (access) => {
        await this.#gate(access);
        let result: { value?: T; expected?: DomainError };
        try { result = { value: await action(access) }; }
        catch (error) {
          // Only locally generated pre-mutation outcomes may leave a HEALTHY action.
          if (error instanceof DomainError && ["WHITELIST_GUARD_CAPACITY", "WHITELIST_GUARD_CONFLICT"].includes(error.code)) result = { expected: error };
          else throw error;
        }
        await this.#gate(access); return result;
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "WHITELIST_ACTION_BUSY") {
        throw new DomainError(409, "WHITELIST_GUARD_BUSY", "保护数据正在使用");
      }
      this.#poisoned = true; throw unsafe();
    } finally { this.#busy = false; }
    if (outcome.expected) throw outcome.expected; return outcome.value as T;
  }
  async #exclusive<T>(action: (access?: WhitelistOwnedGuardAccess) => Promise<T>): Promise<T> {
    if (this.#busy) throw new DomainError(409, "WHITELIST_GUARD_BUSY", "保护数据正在使用");
    if (this.owned) return this.#ownedExclusive(action);
    let release: () => void;
    try { release = this.owner.beginOfflineMutation(this.root); } catch (error) {
      if (error instanceof AuthCoreError && error.code === "AUTH_BUSY") throw new DomainError(409, "WHITELIST_GUARD_BUSY", "保护数据正在使用");
      throw unsafe();
    }
    this.#busy = true;
    try { await this.#gate(); return await action(); } catch (error) {
      if (error instanceof DomainError && ["WHITELIST_GUARD_CAPACITY", "WHITELIST_GUARD_CONFLICT"].includes(error.code)) throw error;
      this.#poisoned = true; throw unsafe();
    }
    finally { this.#busy = false; try { release(); } catch { this.#poisoned = true; throw unsafe(); } }
  }
  async #read(file: string, directory: string, access?: WhitelistOwnedGuardAccess): Promise<Buffer> {
    if (access) {
      const record = await access.readFile(this.#relative(file));
      try {
        if (this.#known.has(file) && this.#known.get(file) !== record.fingerprint) throw unsafe();
        await this.#gate(access); this.#known.set(file, record.fingerprint); return record.bytes;
      } catch (error) { record.bytes.fill(0); throw error; }
    }
    const parent = await identity(directory), beforeAcl = await this.acl.verifyMany([this.#directory, directory, file]);
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > 4096n || normalized(await realpath(file)) !== normalized(file)) throw unsafe();
    const same = (info: typeof before) => info.isFile() && !info.isSymbolicLink() && info.nlink === 1n && info.dev === before.dev && info.ino === before.ino &&
      info.birthtimeNs === before.birthtimeNs && info.size === before.size && info.mtimeNs === before.mtimeNs && info.ctimeNs === before.ctimeNs;
    const handle = await open(file, "r"), bytes = Buffer.alloc(Number(before.size));
    try {
      if (!same(await handle.stat({ bigint: true }))) throw unsafe(); let offset = 0;
      while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) throw unsafe(); offset += result.bytesRead; }
      const afterAcl = await this.acl.verifyMany([this.#directory, directory, file]);
      if (beforeAcl.length !== 3 || afterAcl.length !== 3 || afterAcl.some((value, i) => value !== beforeAcl[i]) ||
        !same(await handle.stat({ bigint: true })) || !same(await lstat(file, { bigint: true })) || await identity(directory) !== parent) throw unsafe();
      await this.#gate();
      const fingerprint = whitelistCommandHash(`${before.dev}\0${before.ino}\0${before.birthtimeNs}\0${whitelistCommandHash(bytes)}`);
      if (this.#known.has(file) && this.#known.get(file) !== fingerprint) throw unsafe(); this.#known.set(file, fingerprint);
      return Buffer.from(bytes);
    } finally { try { await handle.close(); } finally { bytes.fill(0); } }
  }
  async #readChunkBatch(directory: string, start: number, count: number, totalLength: number,
    access?: WhitelistOwnedGuardAccess, expected?: Buffer): Promise<Buffer[]> {
    if (!this.#wide || !access || !("readChunkBatch" in access) || typeof access.readChunkBatch !== "function") throw unsafe();
    const read = (access as WhitelistOwnedWideGuardAccess).readChunkBatch;
    const rows = await read(this.#relative(directory), start, count);
    const records: { file: string; bytes: Buffer; fingerprint: string }[] = [];
    try {
      if (!Array.isArray(rows) || rows.length !== count) throw unsafe();
      for (let i = 0; i < count; i++) {
        const row = rows[i], index = start + i, file = path.join(directory, `${String(index).padStart(2, "0")}.bin`);
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "bytes,fingerprint,index" || row.index !== index ||
          !Buffer.isBuffer(row.bytes) || row.bytes.length !== Math.min(4096, totalLength - index * 4096) || row.bytes.length < 1 ||
          typeof row.fingerprint !== "string" || !digest.test(row.fingerprint) ||
          this.#known.has(file) && this.#known.get(file) !== row.fingerprint ||
          expected && !row.bytes.equals(expected.subarray(index * 4096, Math.min(expected.length, (index + 1) * 4096)))) throw unsafe();
        records.push({ file, bytes: row.bytes, fingerprint: row.fingerprint });
      }
      await this.#gate(access);
      for (const row of records) this.#known.set(row.file, row.fingerprint);
      return records.map((row) => row.bytes);
    } catch (error) {
      if (Array.isArray(rows)) for (const row of rows) if (row && Buffer.isBuffer(row.bytes)) row.bytes.fill(0);
      throw error;
    }
  }
  async #verify(operationId: string, access?: WhitelistOwnedGuardAccess): Promise<{ receiptHash: string; snapshot: WhitelistMemberSnapshot }> {
    if (!id.test(operationId) || !this.#namespace) throw unsafe(); const directory = path.join(this.#directory, operationId);
    const bytes = await this.#read(path.join(directory, "manifest.json"), directory, access); let all: Buffer | undefined;
    try {
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !==
        "byteLength,chunks,directoryIdentity,managerRootIdentity,namespaceIdentity,operationId,pinned,revision,schemaVersion,source") throw unsafe();
      const manifest = value as Manifest;
      if (manifest.schemaVersion !== 1 || manifest.pinned !== true || manifest.operationId !== operationId ||
        manifest.managerRootIdentity !== this.owner.rootIdentity() || manifest.namespaceIdentity !== this.#namespace ||
        manifest.directoryIdentity !== await this.#identity(directory, access) || !Number.isInteger(manifest.byteLength) || manifest.byteLength < 1 || manifest.byteLength > WHITELIST_BYTES ||
        manifest.chunks !== Math.ceil(manifest.byteLength / 4096) || !digest.test(manifest.revision)) throw unsafe();
      const expected = ["manifest.json", ...Array.from({ length: manifest.chunks }, (_, i) => `${String(i).padStart(2, "0")}.bin`)];
      if ((await this.#list(directory, access)).sort().join("|") !== expected.sort().join("|")) throw unsafe();
      all = Buffer.alloc(manifest.byteLength);
      if (this.#wide) {
        for (let i = 0; i < manifest.chunks; i += 6) {
          const chunks = await this.#readChunkBatch(directory, i, Math.min(6, manifest.chunks - i), all.length, access);
          try { for (let j = 0; j < chunks.length; j++) chunks[j]!.copy(all, (i + j) * 4096); }
          finally { for (const chunk of chunks) chunk.fill(0); }
        }
      } else {
        for (let i = 0; i < manifest.chunks; i++) { const chunk = await this.#read(path.join(directory, `${String(i).padStart(2, "0")}.bin`), directory, access);
          try { if (chunk.length !== Math.min(4096, all.length - i * 4096)) throw unsafe(); chunk.copy(all, i * 4096); } finally { chunk.fill(0); } }
      }
      const snapshot = parsed(all, manifest.source);
      if (whitelistMemberRevision(snapshot) !== manifest.revision || (await this.#list(directory, access)).sort().join("|") !== expected.sort().join("|")) throw unsafe();
      await this.#gate(access); return { receiptHash: whitelistCommandHash(bytes), snapshot };
    } finally { bytes.fill(0); all?.fill(0); }
  }
  async #scan(access?: WhitelistOwnedGuardAccess) {
    if (!this.#namespace) return [];
    if (!access) await this.acl.verifyMany([this.#directory]);
    const names = await this.#list(this.#directory, access); if (names.length > 1000 || names.some((name) => !id.test(name))) throw unsafe();
    const result = [];
    for (const name of names) result.push({ operationId: name, ...await this.#verify(name, access) });
    if ([...this.#known.keys()].some((file) => !names.some((name) => file.startsWith(path.join(this.#directory, name) + path.sep)))) throw unsafe();
    if ((await this.#list(this.#directory, access)).sort().join("|") !== names.sort().join("|")) throw unsafe(); return result;
  }
  scan() { return this.#exclusive((access) => this.#scan(access)); }
  verify(operationId: string) { return this.#exclusive((access) => this.#verify(operationId, access)); }
  create(operationId: string, before: WhitelistMemberSnapshot, original: Buffer) {
    // Copy synchronously: later caller mutation cannot alter the captured source.
    const bytes = Buffer.from(original);
    const captured = structuredClone(before);
    return this.#exclusive(async (access) => {
      try {
        if (!id.test(operationId) || bytes.length > WHITELIST_BYTES) throw unsafe();
        const revision = whitelistMemberRevision(captured), source: Source = { serverId: captured.serverId, rootIdentity: captured.rootIdentity,
          configRevision: captured.configRevision, fileIdentity: captured.fileIdentity, fileSha256: captured.fileSha256, runtimeId: captured.runtimeId };
        if (whitelistMemberRevision(parsed(bytes, source)) !== revision) throw unsafe();
        const previous = await this.#scan(access);
        if (previous.length >= 1000) throw new DomainError(409, "WHITELIST_GUARD_CAPACITY", "保护记录达到保留上限");
        if (previous.some((row) => row.operationId === operationId)) throw new DomainError(409, "WHITELIST_GUARD_CONFLICT", "保护记录已存在");
        if (!this.#namespace) {
          if (access) await access.createDirectory("whitelist-guards"); else await this.publication.createDirectory(this.#directory);
          this.#namespace = await this.#identity(this.#directory, access);
        }
        const directory = path.join(this.#directory, operationId);
        if (access) await access.createDirectory(this.#relative(directory)); else await this.publication.createDirectory(directory);
        const publish = async (name: string, value: Buffer) => {
          const target = path.join(directory, name), stage = target + ".stage"; await this.#gate(access);
          if (access) {
            await access.publishFile(this.#relative(target), value);
            const actual = await this.#read(target, directory, access);
            try { if (!actual.equals(value)) throw unsafe(); } finally { actual.fill(0); } return;
          }
          await this.publication.writeNew(stage, value); const staged = await this.#read(stage, directory);
          try { if (!staged.equals(value)) throw unsafe(); } finally { staged.fill(0); }
          await this.publication.publishNew(stage, target); const actual = await this.#read(target, directory);
          try { if (!actual.equals(value)) throw unsafe(); } finally { actual.fill(0); } this.#known.delete(stage);
        };
        const chunks = Math.ceil(bytes.length / 4096);
        if (this.#wide) {
          if (!access?.publishChunkGroup) throw unsafe();
          const publishChunks = access.publishChunkGroup;
          for (let start = 0; start < chunks; start += 16) {
            await this.#gate(access);
            const count = Math.min(16, chunks - start), values = Array.from({ length: count }, (_, offset) =>
              bytes.subarray((start + offset) * 4096, Math.min(bytes.length, (start + offset + 1) * 4096)));
            const receipts = await publishChunks(this.#relative(directory), start, values);
            if (receipts.length !== count) throw unsafe();
            for (let offset = 0; offset < count; offset++) {
              const expected = values[offset]!, row = receipts[offset]!;
              if (row.byteLength !== expected.length || row.sha256 !== whitelistCommandHash(expected)) throw unsafe();
            }
            for (let offset = 0; offset < count; offset += 6) {
              const actual = await this.#readChunkBatch(directory, start + offset, Math.min(6, count - offset), bytes.length, access, bytes);
              for (const chunk of actual) chunk.fill(0);
            }
          }
        } else {
          for (let i = 0; i < chunks; i++) await publish(`${String(i).padStart(2, "0")}.bin`, bytes.subarray(i * 4096, Math.min(bytes.length, (i + 1) * 4096)));
        }
        const manifest: Manifest = { schemaVersion: 1, operationId, managerRootIdentity: this.owner.rootIdentity(), namespaceIdentity: this.#namespace,
          directoryIdentity: await this.#identity(directory, access), source, revision, byteLength: bytes.length, chunks, pinned: true };
        await publish("manifest.json", Buffer.from(JSON.stringify(manifest))); return await this.#verify(operationId, access);
      } finally { bytes.fill(0); }
    }).finally(() => bytes.fill(0));
  }
}
