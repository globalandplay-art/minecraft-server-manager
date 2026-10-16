import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { AuthCoreError } from "../auth/password.js";
import { createPrivateEntry, privateEntryExists, publishPrivateStageNew, writePrivateNew } from "../auth/private-publication.js";
import { WindowsPrivateAclVerifier } from "../auth/windows-private-acl.js";
import { DomainError } from "./domain-errors.js";
import { decodeWhitelistAnchor, decodeWhitelistCommand, decodeWhitelistNamespace, encodeWhitelistAnchor, encodeWhitelistCommand,
  encodeWhitelistNamespace, encodeWhitelistWitness, decodeWhitelistWitness, verifyWhitelistCommandChain, whitelistCommandHash, whitelistCommandUnsafe,
  type WhitelistCommandNamespace, type WhitelistCommandRecord } from "./whitelist-command-record.js";

type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation">;
type Acl = Pick<WindowsPrivateAclVerifier, "verifyMany">;
export interface WhitelistCommandPublication {
  createDirectory(file: string): Promise<void>;
  writeNew(file: string, bytes: Buffer): Promise<void>;
  publishNew(stage: string, target: string): Promise<void>;
}
const ID = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const recordName = new RegExp(`^(${ID})\\.([0-9]{4})\\.json$`, "u");
const anchorName = new RegExp(`^whitelist-command-(${ID})\\.receipt\\.json$`, "u");
const witnessName = new RegExp(`^whitelist-command-(${ID})\\.([0-9]{4})\\.receipt\\.json$`, "u");
export const WHITELIST_COMMAND_SCAN_LIMIT = 10_000;
const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
async function directoryIdentity(directory: string): Promise<string> {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || normalize(await realpath(directory)) !== normalize(path.resolve(directory))) throw whitelistCommandUnsafe();
  return whitelistCommandHash(`${info.dev}\0${info.ino}\0${info.birthtimeNs}`);
}

/** Unwired append-only command evidence. No command dispatch, TTL, deletion, repair or terminal claims. */
export class WhitelistCommandStore {
  readonly #directory: string; readonly #namespaceFile: string;
  #namespace: WhitelistCommandNamespace | null = null; #poisoned = false; #entered = false;
  readonly #known = new Map<string, string>();
  private constructor(readonly root: string, readonly physicalRoot: string, readonly owner: Owner,
    readonly acl: Acl, readonly publication: WhitelistCommandPublication, readonly scanLimit: number) {
    this.#directory = path.join(root, "whitelist-commands"); this.#namespaceFile = path.join(root, "whitelist-commands.receipt.json");
  }
  static async open(root: string, owner: Owner, acl = new WindowsPrivateAclVerifier(), publication?: WhitelistCommandPublication,
    scanLimit = WHITELIST_COMMAND_SCAN_LIMIT): Promise<WhitelistCommandStore> {
    try {
      if (!path.isAbsolute(root) || root !== path.resolve(root) || root.startsWith("\\\\") || root.startsWith("//") || root.includes("\0")) throw whitelistCommandUnsafe();
      if (!Number.isInteger(scanLimit) || scanLimit < 3 || scanLimit > WHITELIST_COMMAND_SCAN_LIMIT) throw whitelistCommandUnsafe();
      owner.assertHeld(root);
      const store = new WhitelistCommandStore(root, await directoryIdentity(root), owner, acl, publication ?? {
        createDirectory: (file) => createPrivateEntry(file, true, acl),
        writeNew: (file, bytes) => writePrivateNew(file, bytes, acl), publishNew: publishPrivateStageNew
      }, scanLimit);
      await store.scan(); return store;
    } catch (error) { if (error instanceof DomainError && error.code === "WHITELIST_COMMAND_BUSY") throw error; throw whitelistCommandUnsafe(); }
  }
  async #gate(): Promise<void> {
    if (this.#poisoned) throw whitelistCommandUnsafe();
    this.owner.assertHeld(this.root);
    if (await directoryIdentity(this.root) !== this.physicalRoot || (this.#namespace &&
      (this.#namespace.managerRootIdentity !== this.owner.rootIdentity() || await directoryIdentity(this.#directory) !== this.#namespace.directoryIdentity))) throw whitelistCommandUnsafe();
  }
  async #exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.#entered) throw new DomainError(409, "WHITELIST_COMMAND_BUSY", "白名单操作凭证正在使用");
    let release: () => void;
    try { release = this.owner.beginOfflineMutation(this.root); }
    catch (error) {
      if (error instanceof AuthCoreError && error.code === "AUTH_BUSY") throw new DomainError(409, "WHITELIST_COMMAND_BUSY", "管理器持久操作正在使用");
      throw whitelistCommandUnsafe();
    }
    this.#entered = true;
    try {
      try { await this.#gate(); } catch { this.#poisoned = true; throw whitelistCommandUnsafe(); }
      return await action();
    } catch (error) {
      if (error instanceof DomainError && ["WHITELIST_COMMAND_BUSY", "WHITELIST_COMMAND_KEY_CONFLICT",
        "WHITELIST_COMMAND_CAPACITY", "WHITELIST_COMMAND_STORAGE_UNSAFE"].includes(error.code)) throw error;
      this.#poisoned = true; throw whitelistCommandUnsafe();
    } finally {
      this.#entered = false;
      try { release(); } catch { this.#poisoned = true; throw whitelistCommandUnsafe(); }
    }
  }
  async #read(file: string): Promise<Buffer> {
    await this.#gate();
    const targets = path.dirname(file) === this.#directory ? [this.#directory, file] : [file];
    const aclBefore = await this.acl.verifyMany(targets);
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > 4096n ||
      normalize(await realpath(file)) !== normalize(file)) throw whitelistCommandUnsafe();
    const same = (info: typeof before) => info.isFile() && !info.isSymbolicLink() && info.nlink === 1n && info.dev === before.dev &&
      info.ino === before.ino && info.birthtimeNs === before.birthtimeNs && info.size === before.size && info.mtimeNs === before.mtimeNs && info.ctimeNs === before.ctimeNs;
    const handle = await open(file, "r"); const bytes = Buffer.alloc(Number(before.size));
    try {
      if (!same(await handle.stat({ bigint: true }))) throw whitelistCommandUnsafe();
      let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) throw whitelistCommandUnsafe(); offset += read.bytesRead;
      }
      const aclAfter = await this.acl.verifyMany(targets);
      if (!same(await handle.stat({ bigint: true })) || !same(await lstat(file, { bigint: true })) ||
        aclBefore.length !== targets.length || aclAfter.length !== targets.length || aclAfter.some((item, i) => item !== aclBefore[i])) throw whitelistCommandUnsafe();
      await this.#gate();
      const fingerprint = whitelistCommandHash(`${before.dev}\0${before.ino}\0${before.birthtimeNs}\0${whitelistCommandHash(bytes)}`);
      const known = this.#known.get(file);
      if (known && known !== fingerprint) throw whitelistCommandUnsafe();
      this.#known.set(file, fingerprint); return Buffer.from(bytes);
    } finally { try { await handle.close(); } finally { bytes.fill(0); } }
  }
  async #decoded<T>(file: string, decode: (bytes: Buffer) => T): Promise<T> {
    const bytes = await this.#read(file); try { return decode(bytes); } finally { bytes.fill(0); }
  }
  async #scan(): Promise<WhitelistCommandRecord[][]> {
    try {
      await this.#gate();
      if (await privateEntryExists(this.#namespaceFile + ".stage")) throw whitelistCommandUnsafe();
      const hasNamespace = await privateEntryExists(this.#namespaceFile), hasDirectory = await privateEntryExists(this.#directory);
      if (hasNamespace !== hasDirectory || (!hasNamespace && this.#namespace)) throw whitelistCommandUnsafe();
      const rootNames = await readdir(this.root);
      if (rootNames.length > this.scanLimit) throw whitelistCommandUnsafe();
      const reserved = rootNames.filter((name) => name.startsWith("whitelist-command-"));
      const anchors = reserved.filter((name) => anchorName.test(name)), witnesses = reserved.filter((name) => witnessName.test(name));
      if (anchors.length + witnesses.length !== reserved.length) throw whitelistCommandUnsafe();
      if (!hasNamespace) { if (reserved.length || this.#known.size) throw whitelistCommandUnsafe(); return []; }
      const namespace = await this.#decoded(this.#namespaceFile, decodeWhitelistNamespace);
      if (namespace.managerRootIdentity !== this.owner.rootIdentity() || namespace.directoryIdentity !== await directoryIdentity(this.#directory) ||
        (this.#namespace && JSON.stringify(this.#namespace) !== JSON.stringify(namespace))) throw whitelistCommandUnsafe();
      this.#namespace = namespace; await this.acl.verifyMany([this.#directory]);
      const names = await readdir(this.#directory);
      if (names.length + reserved.length > this.scanLimit || names.some((name) => !recordName.test(name))) throw whitelistCommandUnsafe();
      const groups = new Map<string, string[]>();
      for (const name of names) { const id = recordName.exec(name)![1]!; groups.set(id, [...(groups.get(id) ?? []), name]); }
      if (groups.size !== anchors.length) throw whitelistCommandUnsafe();
      const chains: WhitelistCommandRecord[][] = [], keys = new Set<string>(), seenFiles = new Set([this.#namespaceFile]);
      for (const name of anchors.sort()) {
        const id = anchorName.exec(name)![1]!, anchorFile = path.join(this.root, name); seenFiles.add(anchorFile);
        const anchor = await this.#decoded(anchorFile, decodeWhitelistAnchor);
        if (anchor.operationId !== id || anchor.managerRootIdentity !== namespace.managerRootIdentity || anchor.directoryIdentity !== namespace.directoryIdentity) throw whitelistCommandUnsafe();
        const files = groups.get(id)?.sort(); if (!files?.length || files.length > 32) throw whitelistCommandUnsafe();
        const chain: WhitelistCommandRecord[] = [];
        for (let i = 0; i < files.length; i++) {
          if (files[i] !== `${id}.${String(i).padStart(4, "0")}.json`) throw whitelistCommandUnsafe();
          const file = path.join(this.#directory, files[i]!); seenFiles.add(file);
          const record = await this.#decoded(file, decodeWhitelistCommand);
          if (record.operationId !== id || record.managerRootIdentity !== namespace.managerRootIdentity || record.directoryIdentity !== namespace.directoryIdentity ||
            (i === 0 && whitelistCommandHash(encodeWhitelistCommand(record)) !== anchor.genesisHash)) throw whitelistCommandUnsafe();
          if (i > 0) {
            const witnessFile = path.join(this.root, `whitelist-command-${id}.${String(i).padStart(4, "0")}.receipt.json`);
            seenFiles.add(witnessFile);
            const witness = await this.#decoded(witnessFile, decodeWhitelistWitness);
            if (witness.operationId !== id || witness.sequence !== i || witness.managerRootIdentity !== namespace.managerRootIdentity ||
              witness.directoryIdentity !== namespace.directoryIdentity || witness.checkpointHash !== whitelistCommandHash(encodeWhitelistCommand(record))) throw whitelistCommandUnsafe();
          }
          chain.push(record);
        }
        verifyWhitelistCommandChain(chain);
        const first = chain[0]!, scope = `${first.serverId}:${first.idempotencyHash}`;
        if (keys.has(scope)) throw whitelistCommandUnsafe(); keys.add(scope); chains.push(chain);
      }
      if (witnesses.some((name) => !seenFiles.has(path.join(this.root, name))) || [...this.#known.keys()].some((file) => !seenFiles.has(file)) ||
        (await readdir(this.root)).filter((name) => name.startsWith("whitelist-command-")).sort().join("|") !== reserved.sort().join("|") ||
        (await readdir(this.#directory)).sort().join("|") !== names.sort().join("|")) throw whitelistCommandUnsafe();
      await this.#gate(); return chains;
    } catch { this.#poisoned = true; throw whitelistCommandUnsafe(); }
  }
  scan(): Promise<WhitelistCommandRecord[][]> { return this.#exclusive(() => this.#scan()); }
  async #reserve(rootGrowth: number, evidenceGrowth: number): Promise<void> {
    const rootNames = await readdir(this.root);
    const records = this.#namespace ? (await readdir(this.#directory)).length : 0;
    const reserved = rootNames.filter((name) => name.startsWith("whitelist-command-")).length;
    if (rootNames.length + rootGrowth > this.scanLimit || records + reserved + evidenceGrowth > this.scanLimit) {
      throw new DomainError(409, "WHITELIST_COMMAND_CAPACITY", "操作凭证已达到保留上限，需要人工规划");
    }
  }
  async #publish(target: string, bytes: Buffer): Promise<void> {
    const stage = target + ".stage";
    try {
      await this.#gate();
      if (await privateEntryExists(target) || await privateEntryExists(stage)) throw whitelistCommandUnsafe();
      await this.publication.writeNew(stage, bytes);
      const staged = await this.#read(stage);
      try { if (!staged.equals(bytes)) throw whitelistCommandUnsafe(); } finally { staged.fill(0); }
      await this.#gate(); await this.publication.publishNew(stage, target);
      const actual = await this.#read(target);
      try { if (!actual.equals(bytes)) throw whitelistCommandUnsafe(); } finally { actual.fill(0); }
      this.#known.delete(stage);
    } catch { this.#poisoned = true; throw whitelistCommandUnsafe(); }
  }
  /** Caller must be an already-admitted trusted operation. No public route calls this store. */
  admit(input: Omit<WhitelistCommandRecord, "managerRootIdentity" | "directoryIdentity">): Promise<WhitelistCommandRecord> {
    return this.#exclusive(async () => {
      const candidate = { ...input, managerRootIdentity: this.owner.rootIdentity(), directoryIdentity: "0".repeat(64) };
      verifyWhitelistCommandChain([candidate]);
      const chains = await this.#scan();
      const existing = chains.find((chain) => chain[0]!.serverId === input.serverId && chain[0]!.idempotencyHash === input.idempotencyHash);
      if (existing) {
        if (existing[0]!.requestHash !== input.requestHash) throw new DomainError(409, "WHITELIST_COMMAND_KEY_CONFLICT", "幂等键已用于另一成员请求");
        return structuredClone(existing.at(-1)!);
      }
      if (chains.some((chain) => chain[0]!.operationId === input.operationId)) throw whitelistCommandUnsafe();
      await this.#reserve(this.#namespace ? 1 : 3, 2);
      try {
        if (!this.#namespace) {
          await this.publication.createDirectory(this.#directory);
          this.#namespace = { schemaVersion: 1, managerRootIdentity: this.owner.rootIdentity(), directoryIdentity: await directoryIdentity(this.#directory) };
          await this.acl.verifyMany([this.#directory]);
          await this.#publish(this.#namespaceFile, encodeWhitelistNamespace(this.#namespace));
        }
        const first = { ...candidate, directoryIdentity: this.#namespace.directoryIdentity };
        const bytes = encodeWhitelistCommand(first);
        await this.#publish(path.join(this.root, `whitelist-command-${first.operationId}.receipt.json`), encodeWhitelistAnchor({
          schemaVersion: 1, managerRootIdentity: first.managerRootIdentity, directoryIdentity: first.directoryIdentity,
          operationId: first.operationId, genesisHash: whitelistCommandHash(bytes)
        }));
        await this.#publish(path.join(this.#directory, `${first.operationId}.0000.json`), bytes);
        return (await this.#scan()).find((chain) => chain[0]!.operationId === first.operationId)![0]!;
      } catch { this.#poisoned = true; throw whitelistCommandUnsafe(); }
    });
  }
  append(id: string, nextState: WhitelistCommandRecord["state"], responseHash: string | null, now: string): Promise<WhitelistCommandRecord> {
    return this.#exclusive(async () => {
      const chain = (await this.#scan()).find((rows) => rows[0]!.operationId === id);
      if (!chain) throw whitelistCommandUnsafe();
      const head = chain.at(-1)!;
      const next = { ...head, sequence: head.sequence + 1, previousHash: whitelistCommandHash(encodeWhitelistCommand(head)),
        state: nextState, responseHash, updatedAt: now };
      verifyWhitelistCommandChain([...chain, next]);
      await this.#reserve(1, 2);
      const bytes = encodeWhitelistCommand(next);
      await this.#publish(path.join(this.root, `whitelist-command-${id}.${String(next.sequence).padStart(4, "0")}.receipt.json`), encodeWhitelistWitness({
        schemaVersion: 1, managerRootIdentity: next.managerRootIdentity, directoryIdentity: next.directoryIdentity,
        operationId: id, sequence: next.sequence, checkpointHash: whitelistCommandHash(bytes)
      }));
      await this.#publish(path.join(this.#directory, `${id}.${String(next.sequence).padStart(4, "0")}.json`), bytes);
      return (await this.#scan()).find((rows) => rows[0]!.operationId === id)!.at(-1)!;
    });
  }
}
