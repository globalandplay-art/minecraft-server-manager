import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { createPrivateEntry, privateEntryExists, publishPrivateStageNew, writePrivateNew } from "../auth/private-publication.js";
import { WindowsPrivateAclVerifier } from "../auth/windows-private-acl.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import type { AccessPublication } from "./access-private-store.js";
import { accessHash, accessUnsafe, accessUuid, decodeAccessCheckpoint, decodeAdmissionReceipt, decodeNamespaceReceipt,
  encodeAccessCheckpoint, encodeAdmissionReceipt, encodeNamespaceReceipt, verifyAccessChain,
  type AccessCheckpoint, type AccessNamespaceReceipt } from "./access-operation-record.js";
import { DomainError } from "./domain-errors.js";

export type AccessOwner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation">;
export const ACCESS_SCAN_LIMIT = 10_000;
const idPattern = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const recordPattern = new RegExp(`^(${idPattern})\\.([0-9]{4})\\.json$`, "u");
const receiptPattern = new RegExp(`^access-op-(${idPattern})\\.receipt\\.json$`, "u");
const normalize = (s: string) => process.platform === "win32" ? s.toLowerCase() : s;
async function directoryIdentity(directory: string): Promise<string> {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || normalize(await realpath(directory)) !== normalize(path.resolve(directory))) throw accessUnsafe();
  return accessHash(`${info.dev}\0${info.ino}\0${info.birthtimeNs}`);
}

/** Manager-wide append-only store. Construction and scanning never write or repair. */
export class AccessOperationStore {
  #root: string; #directory: string; #physicalRoot: string; #namespace: AccessNamespaceReceipt | null = null;
  #owner: AccessOwner; #acl: WindowsPrivateAclVerifier; #publication: AccessPublication;
  #entered = false; #poisoned = false;
  #known = new Map<string, string>();
  #heads = new Map<string, { sequence: number; hash: string }>();
  private constructor(root: string, physicalRoot: string, owner: AccessOwner, acl: WindowsPrivateAclVerifier, publication: AccessPublication) {
    this.#root = root; this.#directory = path.join(root, "access-operations"); this.#physicalRoot = physicalRoot;
    this.#owner = owner; this.#acl = acl; this.#publication = publication;
  }
  static async open(root: string, owner: AccessOwner, acl = new WindowsPrivateAclVerifier(), publication?: AccessPublication): Promise<AccessOperationStore> {
    try {
      if (!path.isAbsolute(root) || root !== path.resolve(root) || root.startsWith("\\\\") || root.startsWith("//") || root.includes("\0")) throw accessUnsafe();
      owner.assertHeld(root);
      const store = new AccessOperationStore(root, await directoryIdentity(root), owner, acl, publication ?? {
        createDirectory: (file) => createPrivateEntry(file, true, acl),
        writeNew: (file, bytes) => writePrivateNew(file, bytes, acl), publishNew: publishPrivateStageNew
      });
      await store.scan(); return store;
    } catch { throw accessUnsafe(); }
  }
  async #gate(): Promise<void> {
    if (this.#poisoned) throw accessUnsafe();
    this.#owner.assertHeld(this.#root);
    if (await directoryIdentity(this.#root) !== this.#physicalRoot) throw accessUnsafe();
    if (this.#namespace !== null && (this.#namespace.rootIdentity !== this.#owner.rootIdentity() ||
      await directoryIdentity(this.#directory) !== this.#namespace.directoryIdentity)) throw accessUnsafe();
  }
  async #read(file: string, privateDirectory: boolean): Promise<Buffer> {
    const files = privateDirectory ? [this.#directory, file] : [file];
    const beforeAcl = await this.#acl.verifyMany(files);
    const first = await readPrivatePropertiesFile(file, 4096);
    try {
      const afterAcl = await this.#acl.verifyMany(files);
      const second = await readPrivatePropertiesFile(file, 4096);
      try {
        if (second.identity !== first.identity || second.checksum !== first.checksum ||
          beforeAcl.length !== afterAcl.length || afterAcl.some((v, i) => v !== beforeAcl[i])) throw accessUnsafe();
      } finally { second.bytes.fill(0); }
      await this.#gate(); return Buffer.from(first.bytes);
    } finally { first.bytes.fill(0); }
  }
  async #loadNamespace(): Promise<void> {
    const receiptPath = path.join(this.#root, "access-operations.receipt.json");
    if (await privateEntryExists(receiptPath + ".stage")) throw accessUnsafe();
    const exists = await privateEntryExists(receiptPath);
    const directoryExists = await privateEntryExists(this.#directory);
    if (exists !== directoryExists || (!exists && this.#namespace !== null)) throw accessUnsafe();
    if (!exists) return;
    const bytes = await this.#read(receiptPath, false);
    try {
      const receipt = decodeNamespaceReceipt(bytes);
      if (receipt.rootIdentity !== this.#owner.rootIdentity() || receipt.directoryIdentity !== await directoryIdentity(this.#directory)) throw accessUnsafe();
      if (this.#namespace !== null && !encodeNamespaceReceipt(this.#namespace).equals(bytes)) throw accessUnsafe();
      await this.#acl.verifyMany([this.#directory]); this.#namespace = receipt;
    } finally { bytes.fill(0); }
  }
  async scan(): Promise<AccessCheckpoint[][]> {
    try {
      await this.#gate(); await this.#loadNamespace();
      const roots = await readdir(this.#root);
      if (roots.length > ACCESS_SCAN_LIMIT) throw accessUnsafe();
      const anchors = roots.filter((name) => name.startsWith("access-op-"));
      if (anchors.some((name) => !receiptPattern.test(name))) throw accessUnsafe();
      if (this.#namespace === null) { if (anchors.length) throw accessUnsafe(); return []; }
      const names = await readdir(this.#directory);
      if (names.length + anchors.length > ACCESS_SCAN_LIMIT || names.some((name) => !recordPattern.test(name))) throw accessUnsafe();
      const groups = new Map<string, string[]>();
      for (const name of names) {
        const id = recordPattern.exec(name)![1]!;
        groups.set(id, [...(groups.get(id) ?? []), name]);
      }
      if (groups.size !== anchors.length) throw accessUnsafe();
      const chains: AccessCheckpoint[][] = [];
      for (const anchor of anchors.sort()) {
        const id = receiptPattern.exec(anchor)![1]!;
        const receiptBytes = await this.#read(path.join(this.#root, anchor), false);
        try {
          const receipt = decodeAdmissionReceipt(receiptBytes);
          if (receipt.operationId !== id || receipt.rootIdentity !== this.#owner.rootIdentity() || receipt.directoryIdentity !== this.#namespace.directoryIdentity) throw accessUnsafe();
          const fingerprint = accessHash(receiptBytes);
          if (this.#known.has(id) && this.#known.get(id) !== fingerprint) throw accessUnsafe();
          const files = groups.get(id)?.sort(); if (!files?.length || files.length > 64) throw accessUnsafe();
          const chain: AccessCheckpoint[] = [];
          for (let i = 0; i < files.length; i++) {
            if (files[i] !== `${id}.${String(i).padStart(4, "0")}.json`) throw accessUnsafe();
            const bytes = await this.#read(path.join(this.#directory, files[i]!), true);
            try {
              const record = decodeAccessCheckpoint(bytes);
              if (record.operation.id !== id || record.rootIdentity !== receipt.rootIdentity || record.directoryIdentity !== receipt.directoryIdentity ||
                (i === 0 && accessHash(bytes) !== receipt.genesisHash)) throw accessUnsafe();
              chain.push(record);
            } finally { bytes.fill(0); }
          }
          verifyAccessChain(chain);
          const knownHead = this.#heads.get(id);
          if (knownHead && (chain.length <= knownHead.sequence ||
            accessHash(encodeAccessCheckpoint(chain[knownHead.sequence]!)) !== knownHead.hash)) throw accessUnsafe();
          const head = chain.at(-1)!;
          this.#heads.set(id, { sequence: head.sequence, hash: accessHash(encodeAccessCheckpoint(head)) });
          this.#known.set(id, fingerprint); chains.push(chain);
        } finally { receiptBytes.fill(0); }
      }
      if ([...this.#known.keys()].some((id) => !groups.has(id))) throw accessUnsafe();
      if ((await readdir(this.#root)).filter((name) => name.startsWith("access-op-")).sort().join("|") !== anchors.sort().join("|") ||
        (await readdir(this.#directory)).sort().join("|") !== names.sort().join("|")) throw accessUnsafe();
      await this.#gate(); return chains;
    } catch { this.#poisoned = true; throw accessUnsafe(); }
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.#entered) throw new DomainError(409, "ACCESS_BUSY", "An Access operation is already active.");
    let release: () => void;
    try { release = this.#owner.beginOfflineMutation(this.#root); }
    catch { throw new DomainError(409, "ACCESS_BUSY", "Access admission is unavailable."); }
    this.#entered = true;
    try { await this.#gate(); return await action(); }
    finally { this.#entered = false; release(); }
  }
  async #publish(target: string, bytes: Buffer, authorize?: () => void): Promise<void> {
    const stage = target + ".stage";
    await this.#gate();
    if (await privateEntryExists(target) || await privateEntryExists(stage)) throw accessUnsafe();
    authorize?.();
    await this.#publication.writeNew(stage, bytes);
    const staged = await this.#read(stage, path.dirname(stage) === this.#directory);
    try { if (!staged.equals(bytes)) throw accessUnsafe(); } finally { staged.fill(0); }
    await this.#gate(); await this.#publication.publishNew(stage, target);
    const actual = await this.#read(target, path.dirname(target) === this.#directory);
    try { if (!actual.equals(bytes)) throw accessUnsafe(); } finally { actual.fill(0); }
  }
  /** The authorization callback is synchronous and runs after all read-only admission checks. */
  async admit(first: Omit<AccessCheckpoint, "rootIdentity" | "directoryIdentity">, authorize: () => void): Promise<AccessCheckpoint> {
    if (!this.#entered || this.#poisoned) throw accessUnsafe();
    const candidate = { ...first, rootIdentity: this.#owner.rootIdentity(), directoryIdentity: "0".repeat(64) };
    encodeAccessCheckpoint(candidate); verifyAccessChain([candidate]);
    const chains = await this.scan();
    if (chains.some((chain) => chain[0]!.idempotencyHash === first.idempotencyHash || chain[0]!.operation.id === first.operation.id)) throw accessUnsafe();
    await this.#gate(); authorize();
    try {
      if (this.#namespace === null) {
        await this.#publication.createDirectory(this.#directory);
        this.#namespace = { schemaVersion: 1, rootIdentity: this.#owner.rootIdentity(), directoryIdentity: await directoryIdentity(this.#directory) };
        await this.#acl.verifyMany([this.#directory]);
        await this.#publish(path.join(this.#root, "access-operations.receipt.json"), encodeNamespaceReceipt(this.#namespace));
      }
      const record: AccessCheckpoint = { ...first, rootIdentity: this.#owner.rootIdentity(), directoryIdentity: this.#namespace.directoryIdentity };
      verifyAccessChain([record]);
      const bytes = encodeAccessCheckpoint(record);
      await this.#publish(path.join(this.#root, `access-op-${record.operation.id}.receipt.json`), encodeAdmissionReceipt({
        schemaVersion: 1, rootIdentity: record.rootIdentity, directoryIdentity: record.directoryIdentity,
        operationId: record.operation.id, genesisHash: accessHash(bytes)
      }), authorize);
      await this.#publish(path.join(this.#directory, `${record.operation.id}.0000.json`), bytes);
      const admitted = (await this.scan()).find((chain) => chain[0]!.operation.id === record.operation.id)?.[0];
      if (!admitted) throw accessUnsafe(); return admitted;
    } catch (error) {
      if (error instanceof DomainError && (error.code.startsWith("AUTH_") || error.code === "CSRF_REJECTED")) throw error;
      this.#poisoned = true; throw accessUnsafe();
    }
  }
  async append(id: string, state: AccessCheckpoint["operation"]["state"], errorCode: AccessCheckpoint["operation"]["errorCode"], now: string,
    authorize?: () => void): Promise<AccessCheckpoint> {
    if (!this.#entered || !accessUuid(id)) throw accessUnsafe();
    try {
      const chain = (await this.scan()).find((records) => records[0]!.operation.id === id);
      if (!chain) throw accessUnsafe();
      const before = chain.at(-1)!;
      const next: AccessCheckpoint = { ...before, sequence: before.sequence + 1, previousHash: accessHash(encodeAccessCheckpoint(before)),
        operation: { ...before.operation, state, updatedAt: now, errorCode } };
      verifyAccessChain([...chain, next]);
      await this.#publish(path.join(this.#directory, `${id}.${String(next.sequence).padStart(4, "0")}.json`), encodeAccessCheckpoint(next), authorize);
      const verified = (await this.scan()).find((records) => records[0]!.operation.id === id)?.at(-1);
      if (!verified || verified.sequence !== next.sequence) throw accessUnsafe(); return verified;
    } catch (error) {
      if (error instanceof DomainError && (error.code.startsWith("AUTH_") || error.code === "CSRF_REJECTED")) throw error;
      this.#poisoned = true; throw accessUnsafe();
    }
  }
}
