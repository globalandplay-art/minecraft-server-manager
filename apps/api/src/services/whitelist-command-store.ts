import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { AuthCoreError } from "../auth/password.js";
import { createPrivateEntry, privateEntryExists, publishPrivateStageNew, writePrivateNew } from "../auth/private-publication.js";
import { WindowsPrivateAclVerifier } from "../auth/windows-private-acl.js";
import { WhitelistAclScope, WhitelistAclScopeError, type WhitelistScopedAcl } from "./whitelist-acl-scope.js";
import { DomainError } from "./domain-errors.js";
import { decodeWhitelistAnchor, decodeWhitelistCommand, decodeWhitelistNamespace, encodeWhitelistAnchor, encodeWhitelistCommand,
  encodeWhitelistNamespace, encodeWhitelistWitness, decodeWhitelistWitness, verifyWhitelistCommandChain, whitelistCommandHash, whitelistCommandUnsafe,
  type WhitelistCommandNamespace, type WhitelistCommandRecord } from "./whitelist-command-record.js";

type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation"> &
  Partial<Pick<ManagerLifetimeLock, "nativeAclChildWrapper">>;
type Acl = WindowsPrivateAclVerifier & Partial<Pick<WhitelistScopedAcl, "quiesce">>;
export interface WhitelistCommandPublication {
  createDirectory(file: string): Promise<void>;
  writeNew(file: string, bytes: Buffer): Promise<void>;
  publishNew(stage: string, target: string): Promise<void>;
}
export type WhitelistCommandStoreDiagnosticStage =
  | "admit-scan-complete" | "directory-created" | "namespace-acl-verified" | "namespace-published"
  | "anchor-published" | "record-published" | "admit-readback-complete"
  | "namespace-stage-written" | "namespace-stage-readback" | "namespace-atomic-publish" | "namespace-target-readback"
  | "anchor-stage-written" | "anchor-stage-readback" | "anchor-atomic-publish" | "anchor-target-readback"
  | "record-stage-written" | "record-stage-readback" | "record-atomic-publish" | "record-target-readback"
  | "witness-stage-written" | "witness-stage-readback" | "witness-atomic-publish" | "witness-target-readback";
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
    readonly acl: Acl, readonly publication: WhitelistCommandPublication, readonly scanLimit: number,
    readonly scope?: WhitelistAclScope, readonly observeStage?: (stage: WhitelistCommandStoreDiagnosticStage) => void) {
    this.#directory = path.join(root, "whitelist-commands"); this.#namespaceFile = path.join(root, "whitelist-commands.receipt.json");
  }
  static async open(root: string, owner: Owner, acl?: Acl, publication?: WhitelistCommandPublication,
    scanLimit = WHITELIST_COMMAND_SCAN_LIMIT, observeStage?: (stage: WhitelistCommandStoreDiagnosticStage) => void): Promise<WhitelistCommandStore> {
    try {
      if (!path.isAbsolute(root) || root !== path.resolve(root) || root.startsWith("\\\\") || root.startsWith("//") || root.includes("\0")) throw whitelistCommandUnsafe();
      if (!Number.isInteger(scanLimit) || scanLimit < 3 || scanLimit > WHITELIST_COMMAND_SCAN_LIMIT) throw whitelistCommandUnsafe();
      owner.assertHeld(root);
      const verifier = acl ?? new WindowsPrivateAclVerifier();
      const scope = !acl && !publication && owner.nativeAclChildWrapper ? new WhitelistAclScope(owner, root) : undefined;
      const store = new WhitelistCommandStore(root, await directoryIdentity(root), owner, verifier, publication ?? {
        createDirectory: (file) => createPrivateEntry(file, true, verifier),
        writeNew: (file, bytes) => writePrivateNew(file, bytes, verifier), publishNew: publishPrivateStageNew
      }, scanLimit, scope, observeStage);
      await store.scan(); return store;
    } catch (error) { if (error instanceof DomainError && error.code === "WHITELIST_COMMAND_BUSY") throw error; throw whitelistCommandUnsafe(); }
  }
  #mark(stage: WhitelistCommandStoreDiagnosticStage): void {
    try { this.observeStage?.(stage); } catch { /* Diagnostics cannot change storage decisions. */ }
  }
  async #gate(): Promise<void> {
    if (this.#poisoned) throw whitelistCommandUnsafe();
    this.owner.assertHeld(this.root);
    if (await directoryIdentity(this.root) !== this.physicalRoot || (this.#namespace &&
      (this.#namespace.managerRootIdentity !== this.owner.rootIdentity() || await directoryIdentity(this.#directory) !== this.#namespace.directoryIdentity))) throw whitelistCommandUnsafe();
  }
  async #exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.#entered) throw new DomainError(409, "WHITELIST_COMMAND_BUSY", "白名单操作凭证正在使用");
    if (this.scope) {
      this.#entered = true;
      try {
        return await this.scope.run(async scopedAcl => {
          await this.#gate();
          let aclTail: Promise<void> = Promise.resolve();
          const verifyMany = (files: readonly string[]) => {
            const result = aclTail.then(() => scopedAcl.verifyMany(files));
            aclTail = result.then(() => undefined, () => undefined);
            return result;
          };
          const drain = async () => { await aclTail; await scopedAcl.quiesce(); };
          class SerializedActionAcl extends WindowsPrivateAclVerifier {
            override verifyMany(files: readonly string[]) { return verifyMany(files); }
            quiesce() { return drain(); }
          }
          const actionAcl = new SerializedActionAcl();
          const publication: WhitelistCommandPublication = {
            createDirectory: async file => { await drain(); await createPrivateEntry(file, true, actionAcl); },
            writeNew: async (file, bytes) => { await drain(); await writePrivateNew(file, bytes, actionAcl); },
            publishNew: async (stage, target) => { await drain(); await publishPrivateStageNew(stage, target); }
          };
          const result = await this.#withAcl(actionAcl, publication, action);
          await drain(); await this.#gate(); return result;
        });
      } catch (error) {
        if (error instanceof WhitelistAclScopeError && error.code === "WHITELIST_ACL_SCOPE_BUSY") {
          throw new DomainError(409, "WHITELIST_COMMAND_BUSY", "白名单操作凭证正在使用");
        }
        if (error instanceof DomainError && ["WHITELIST_COMMAND_BUSY", "WHITELIST_COMMAND_KEY_CONFLICT",
          "WHITELIST_COMMAND_CAPACITY", "WHITELIST_COMMAND_STORAGE_UNSAFE"].includes(error.code)) throw error;
        this.#poisoned = true; throw whitelistCommandUnsafe();
      } finally { this.#entered = false; }
    }
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
  #activeAcl = new AsyncLocalStorage<{ acl: Acl; publication: WhitelistCommandPublication }>();
  async #withAcl<T>(acl: Acl, publication: WhitelistCommandPublication, action: () => Promise<T>): Promise<T> {
    return this.#activeAcl.run({ acl, publication }, action);
  }
  #currentAcl(): Acl { return this.#activeAcl.getStore()?.acl ?? this.acl; }
  #currentPublication(): WhitelistCommandPublication { return this.#activeAcl.getStore()?.publication ?? this.publication; }
  async #read(file: string, scanGate?: () => void, acl: Acl = this.#currentAcl()): Promise<Buffer> {
    if (scanGate) scanGate(); else await this.#gate();
    const targets = path.dirname(file) === this.#directory ? [this.#directory, file] : [file];
    const aclBefore = await acl.verifyMany(targets);
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
      const aclAfter = await acl.verifyMany(targets);
      if (!same(await handle.stat({ bigint: true })) || !same(await lstat(file, { bigint: true })) ||
        aclBefore.length !== targets.length || aclAfter.length !== targets.length || aclAfter.some((item, i) => item !== aclBefore[i])) throw whitelistCommandUnsafe();
      if (scanGate) scanGate(); else await this.#gate();
      const fingerprint = whitelistCommandHash(`${before.dev}\0${before.ino}\0${before.birthtimeNs}\0${whitelistCommandHash(bytes)}`);
      const known = this.#known.get(file);
      if (known && known !== fingerprint) throw whitelistCommandUnsafe();
      this.#known.set(file, fingerprint); return Buffer.from(bytes);
    } finally { try { await handle.close(); } finally { bytes.fill(0); } }
  }
  async #decoded<T>(file: string, decode: (bytes: Buffer) => T, scanGate?: () => void, acl: Acl = this.#currentAcl()): Promise<T> {
    const bytes = await this.#read(file, scanGate, acl); try { return decode(bytes); } finally { bytes.fill(0); }
  }
  async #scan(acl: Acl = this.#currentAcl()): Promise<WhitelistCommandRecord[][]> {
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
      const namespace = await this.#decoded(this.#namespaceFile, decodeWhitelistNamespace, undefined, acl);
      if (namespace.managerRootIdentity !== this.owner.rootIdentity() || namespace.directoryIdentity !== await directoryIdentity(this.#directory) ||
        (this.#namespace && JSON.stringify(this.#namespace) !== JSON.stringify(namespace))) throw whitelistCommandUnsafe();
      this.#namespace = namespace; await acl.verifyMany([this.#directory]);
      const names = await readdir(this.#directory);
      if (names.length + reserved.length > this.scanLimit || names.some((name) => !recordName.test(name))) throw whitelistCommandUnsafe();
      const groups = new Map<string, string[]>();
      for (const name of names) { const id = recordName.exec(name)![1]!; groups.set(id, [...(groups.get(id) ?? []), name]); }
      if (groups.size !== anchors.length) throw whitelistCommandUnsafe();
      const chains: WhitelistCommandRecord[][] = [], keys = new Set<string>(), seenFiles = new Set([this.#namespaceFile]);
      const readChain = async (name: string, scanGate: () => void): Promise<WhitelistCommandRecord[]> => {
        const id = anchorName.exec(name)![1]!, anchorFile = path.join(this.root, name); seenFiles.add(anchorFile);
        const anchor = await this.#decoded(anchorFile, decodeWhitelistAnchor, scanGate, acl);
        if (anchor.operationId !== id || anchor.managerRootIdentity !== namespace.managerRootIdentity || anchor.directoryIdentity !== namespace.directoryIdentity) throw whitelistCommandUnsafe();
        const files = groups.get(id)?.sort(); if (!files?.length || files.length > 32) throw whitelistCommandUnsafe();
        const chain: WhitelistCommandRecord[] = [];
        for (let i = 0; i < files.length; i++) {
          if (files[i] !== `${id}.${String(i).padStart(4, "0")}.json`) throw whitelistCommandUnsafe();
          const file = path.join(this.#directory, files[i]!); seenFiles.add(file);
          const record = await this.#decoded(file, decodeWhitelistCommand, scanGate, acl);
          if (record.operationId !== id || record.managerRootIdentity !== namespace.managerRootIdentity || record.directoryIdentity !== namespace.directoryIdentity ||
            (i === 0 && whitelistCommandHash(encodeWhitelistCommand(record)) !== anchor.genesisHash)) throw whitelistCommandUnsafe();
          if (i > 0) {
            const witnessFile = path.join(this.root, `whitelist-command-${id}.${String(i).padStart(4, "0")}.receipt.json`);
            seenFiles.add(witnessFile);
            const witness = await this.#decoded(witnessFile, decodeWhitelistWitness, scanGate, acl);
            if (witness.operationId !== id || witness.sequence !== i || witness.managerRootIdentity !== namespace.managerRootIdentity ||
              witness.directoryIdentity !== namespace.directoryIdentity || witness.checkpointHash !== whitelistCommandHash(encodeWhitelistCommand(record))) throw whitelistCommandUnsafe();
          }
          chain.push(record);
        }
        verifyWhitelistCommandChain(chain);
        const first = chain[0]!, scope = `${first.serverId}:${first.idempotencyHash}`;
        if (keys.has(scope)) throw whitelistCommandUnsafe(); keys.add(scope); return chain;
      };
      const ordered = anchors.sort();
      // At most eight independent read chains. Retain every descriptor/ACL/hash check;
      // drain all reads before failing or releasing the mutation lease. No writes
      // or later batches can start after an observed failure.
      for (let start = 0; start < ordered.length; start += this.scope ? 1 : 8) {
        await this.#gate();
        let active = true;
        // Private batch capability: cannot escape a drained batch or suppress any
        // file ACL/descriptor/path/hash check. Writes never receive this capability.
        const scanGate = () => {
          if (!active || this.#poisoned) throw whitelistCommandUnsafe();
          this.owner.assertHeld(this.root);
          if (namespace.managerRootIdentity !== this.owner.rootIdentity()) throw whitelistCommandUnsafe();
        };
        try {
          const results = this.scope
            ? await Promise.allSettled([readChain(ordered[start]!, scanGate)])
            : await Promise.allSettled(ordered.slice(start, start + 8).map(name => readChain(name, scanGate)));
          await this.#gate();
          for (const result of results) if (result.status === "rejected") throw result.reason;
          for (const result of results) if (result.status === "fulfilled") chains.push(result.value);
        } finally { active = false; }
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
  async #publish(target: string, bytes: Buffer, kind: "namespace" | "anchor" | "record" | "witness"): Promise<void> {
    const stage = target + ".stage";
    try {
      await this.#gate();
      if (await privateEntryExists(target) || await privateEntryExists(stage)) throw whitelistCommandUnsafe();
      await this.#currentPublication().writeNew(stage, bytes);
      this.#mark(`${kind}-stage-written`);
      const staged = await this.#read(stage);
      try { if (!staged.equals(bytes)) throw whitelistCommandUnsafe(); } finally { staged.fill(0); }
      this.#mark(`${kind}-stage-readback`);
      await this.#gate(); await this.#currentPublication().publishNew(stage, target);
      this.#mark(`${kind}-atomic-publish`);
      const actual = await this.#read(target);
      try { if (!actual.equals(bytes)) throw whitelistCommandUnsafe(); } finally { actual.fill(0); }
      this.#mark(`${kind}-target-readback`);
      this.#known.delete(stage);
    } catch { this.#poisoned = true; throw whitelistCommandUnsafe(); }
  }
  /** Caller must be an already-admitted trusted operation. No public route calls this store. */
  admit(input: Omit<WhitelistCommandRecord, "managerRootIdentity" | "directoryIdentity">): Promise<WhitelistCommandRecord> {
    return this.#exclusive(async () => {
      const candidate = { ...input, managerRootIdentity: this.owner.rootIdentity(), directoryIdentity: "0".repeat(64) };
      verifyWhitelistCommandChain([candidate]);
      const chains = await this.#scan();
      this.#mark("admit-scan-complete");
      const existing = chains.find((chain) => chain[0]!.serverId === input.serverId && chain[0]!.idempotencyHash === input.idempotencyHash);
      if (existing) {
        if (existing[0]!.requestHash !== input.requestHash) throw new DomainError(409, "WHITELIST_COMMAND_KEY_CONFLICT", "幂等键已用于另一成员请求");
        return structuredClone(existing.at(-1)!);
      }
      if (chains.some((chain) => chain[0]!.operationId === input.operationId)) throw whitelistCommandUnsafe();
      await this.#reserve(this.#namespace ? 1 : 3, 2);
      try {
        if (!this.#namespace) {
          await this.#currentPublication().createDirectory(this.#directory);
          this.#mark("directory-created");
          this.#namespace = { schemaVersion: 1, managerRootIdentity: this.owner.rootIdentity(), directoryIdentity: await directoryIdentity(this.#directory) };
          await this.#currentAcl().verifyMany([this.#directory]);
          this.#mark("namespace-acl-verified");
          await this.#publish(this.#namespaceFile, encodeWhitelistNamespace(this.#namespace), "namespace");
          this.#mark("namespace-published");
        }
        const first = { ...candidate, directoryIdentity: this.#namespace.directoryIdentity };
        const bytes = encodeWhitelistCommand(first);
        await this.#publish(path.join(this.root, `whitelist-command-${first.operationId}.receipt.json`), encodeWhitelistAnchor({
          schemaVersion: 1, managerRootIdentity: first.managerRootIdentity, directoryIdentity: first.directoryIdentity,
          operationId: first.operationId, genesisHash: whitelistCommandHash(bytes)
        }), "anchor");
        this.#mark("anchor-published");
        await this.#publish(path.join(this.#directory, `${first.operationId}.0000.json`), bytes, "record");
        this.#mark("record-published");
        const verified = (await this.#scan()).find((chain) => chain[0]!.operationId === first.operationId)![0]!;
        this.#mark("admit-readback-complete"); return verified;
      } catch { this.#poisoned = true; throw whitelistCommandUnsafe(); }
    });
  }
  append(id: string, nextState: WhitelistCommandRecord["state"], responseHash: string | null, now: string,
    rconEvidence?: WhitelistCommandRecord["rconEvidence"]): Promise<WhitelistCommandRecord> {
    return this.#exclusive(async () => {
      const chain = (await this.#scan()).find((rows) => rows[0]!.operationId === id);
      if (!chain) throw whitelistCommandUnsafe();
      const head = chain.at(-1)!;
      const next = { ...head, sequence: head.sequence + 1, previousHash: whitelistCommandHash(encodeWhitelistCommand(head)),
        state: nextState, responseHash, updatedAt: now,
        ...(rconEvidence ? { rconEvidence } : {}) };
      verifyWhitelistCommandChain([...chain, next]);
      await this.#reserve(1, 2);
      const bytes = encodeWhitelistCommand(next);
      await this.#publish(path.join(this.root, `whitelist-command-${id}.${String(next.sequence).padStart(4, "0")}.receipt.json`), encodeWhitelistWitness({
        schemaVersion: 1, managerRootIdentity: next.managerRootIdentity, directoryIdentity: next.directoryIdentity,
        operationId: id, sequence: next.sequence, checkpointHash: whitelistCommandHash(bytes)
      }), "witness");
      await this.#publish(path.join(this.#directory, `${id}.${String(next.sequence).padStart(4, "0")}.json`), bytes, "record");
      return (await this.#scan()).find((rows) => rows[0]!.operationId === id)!.at(-1)!;
    });
  }
}
