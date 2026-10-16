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

type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation">;
type Acl = Pick<WindowsPrivateAclVerifier, "verifyMany">;
type Source = Omit<WhitelistMemberSnapshot, "members">;
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
  readonly #directory: string; #namespace: string | null = null; #busy = false; #poisoned = false;
  readonly #known = new Map<string, string>();
  private constructor(readonly root: string, readonly owner: Owner, readonly acl: Acl,
    readonly publication: WhitelistCommandPublication, readonly rootIdentity: string) { this.#directory = path.join(root, "whitelist-guards"); }
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
  async #gate(): Promise<void> {
    if (this.#poisoned) throw unsafe(); this.owner.assertHeld(this.root);
    if (await identity(this.root) !== this.rootIdentity || (this.#namespace !== null && await identity(this.#directory) !== this.#namespace)) throw unsafe();
  }
  async #exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.#busy) throw new DomainError(409, "WHITELIST_GUARD_BUSY", "保护数据正在使用");
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
  async #read(file: string, directory: string): Promise<Buffer> {
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
  async #verify(operationId: string): Promise<{ receiptHash: string; snapshot: WhitelistMemberSnapshot }> {
    if (!id.test(operationId) || !this.#namespace) throw unsafe(); const directory = path.join(this.#directory, operationId);
    const bytes = await this.#read(path.join(directory, "manifest.json"), directory); let all: Buffer | undefined;
    try {
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !==
        "byteLength,chunks,directoryIdentity,managerRootIdentity,namespaceIdentity,operationId,pinned,revision,schemaVersion,source") throw unsafe();
      const manifest = value as Manifest;
      if (manifest.schemaVersion !== 1 || manifest.pinned !== true || manifest.operationId !== operationId ||
        manifest.managerRootIdentity !== this.owner.rootIdentity() || manifest.namespaceIdentity !== this.#namespace ||
        manifest.directoryIdentity !== await identity(directory) || !Number.isInteger(manifest.byteLength) || manifest.byteLength < 1 || manifest.byteLength > WHITELIST_BYTES ||
        manifest.chunks !== Math.ceil(manifest.byteLength / 4096) || !digest.test(manifest.revision)) throw unsafe();
      const expected = ["manifest.json", ...Array.from({ length: manifest.chunks }, (_, i) => `${String(i).padStart(2, "0")}.bin`)];
      if ((await readdir(directory)).sort().join("|") !== expected.sort().join("|")) throw unsafe();
      all = Buffer.alloc(manifest.byteLength);
      for (let i = 0; i < manifest.chunks; i++) { const chunk = await this.#read(path.join(directory, `${String(i).padStart(2, "0")}.bin`), directory);
        try { if (chunk.length !== Math.min(4096, all.length - i * 4096)) throw unsafe(); chunk.copy(all, i * 4096); } finally { chunk.fill(0); } }
      const snapshot = parsed(all, manifest.source);
      if (whitelistMemberRevision(snapshot) !== manifest.revision || (await readdir(directory)).sort().join("|") !== expected.sort().join("|")) throw unsafe();
      await this.#gate(); return { receiptHash: whitelistCommandHash(bytes), snapshot };
    } finally { bytes.fill(0); all?.fill(0); }
  }
  async #scan() {
    if (!this.#namespace) return [];
    await this.acl.verifyMany([this.#directory]);
    const names = await readdir(this.#directory); if (names.length > 1000 || names.some((name) => !id.test(name))) throw unsafe();
    const result = [];
    for (const name of names) result.push({ operationId: name, ...await this.#verify(name) });
    if ([...this.#known.keys()].some((file) => !names.some((name) => file.startsWith(path.join(this.#directory, name) + path.sep)))) throw unsafe();
    if ((await readdir(this.#directory)).sort().join("|") !== names.sort().join("|")) throw unsafe(); return result;
  }
  scan() { return this.#exclusive(() => this.#scan()); }
  verify(operationId: string) { return this.#exclusive(() => this.#verify(operationId)); }
  create(operationId: string, before: WhitelistMemberSnapshot, original: Buffer) {
    // Copy synchronously: later caller mutation cannot alter the captured source.
    const bytes = Buffer.from(original);
    const captured = structuredClone(before);
    return this.#exclusive(async () => {
      try {
        if (!id.test(operationId) || bytes.length > WHITELIST_BYTES) throw unsafe();
        const revision = whitelistMemberRevision(captured), source: Source = { serverId: captured.serverId, rootIdentity: captured.rootIdentity,
          configRevision: captured.configRevision, fileIdentity: captured.fileIdentity, fileSha256: captured.fileSha256, runtimeId: captured.runtimeId };
        if (whitelistMemberRevision(parsed(bytes, source)) !== revision) throw unsafe();
        const previous = await this.#scan();
        if (previous.length >= 1000) throw new DomainError(409, "WHITELIST_GUARD_CAPACITY", "保护记录达到保留上限");
        if (previous.some((row) => row.operationId === operationId)) throw new DomainError(409, "WHITELIST_GUARD_CONFLICT", "保护记录已存在");
        if (!this.#namespace) { await this.publication.createDirectory(this.#directory); this.#namespace = await identity(this.#directory); }
        const directory = path.join(this.#directory, operationId); await this.publication.createDirectory(directory);
        const publish = async (name: string, value: Buffer) => {
          const target = path.join(directory, name), stage = target + ".stage"; await this.#gate();
          await this.publication.writeNew(stage, value); const staged = await this.#read(stage, directory);
          try { if (!staged.equals(value)) throw unsafe(); } finally { staged.fill(0); }
          await this.publication.publishNew(stage, target); const actual = await this.#read(target, directory);
          try { if (!actual.equals(value)) throw unsafe(); } finally { actual.fill(0); } this.#known.delete(stage);
        };
        const chunks = Math.ceil(bytes.length / 4096);
        for (let i = 0; i < chunks; i++) await publish(`${String(i).padStart(2, "0")}.bin`, bytes.subarray(i * 4096, Math.min(bytes.length, (i + 1) * 4096)));
        const manifest: Manifest = { schemaVersion: 1, operationId, managerRootIdentity: this.owner.rootIdentity(), namespaceIdentity: this.#namespace,
          directoryIdentity: await identity(directory), source, revision, byteLength: bytes.length, chunks, pinned: true };
        await publish("manifest.json", Buffer.from(JSON.stringify(manifest))); return await this.#verify(operationId);
      } finally { bytes.fill(0); }
    }).finally(() => bytes.fill(0));
  }
}
