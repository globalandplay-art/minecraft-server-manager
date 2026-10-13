import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { AccessDisabledRecord } from "@mcsm/contracts";
import type { ManagerLifetimeLock } from "../auth/manager-lifetime-lock.js";
import { createPrivateEntry, privateEntryExists, publishPrivateStageNew, writePrivateNew } from "../auth/private-publication.js";
import { WindowsPrivateAclVerifier } from "../auth/windows-private-acl.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { decodeAccessDisabledRecord, encodeAccessDisabledRecord, decodeAccessExpectation, encodeAccessExpectation, type AccessExpectation } from "./access-record-codec.js";
import { DomainError } from "./domain-errors.js";

type Acl = Pick<WindowsPrivateAclVerifier, "verifyMany">;
type Owner = Pick<ManagerLifetimeLock, "assertHeld" | "rootIdentity" | "beginOfflineMutation">;
export interface AccessPublication {
  createDirectory(directory: string): Promise<void>;
  writeNew(file: string, bytes: Buffer): Promise<void>;
  publishNew(stage: string, target: string): Promise<void>;
}
const unsafe = () => new DomainError(503, "ACCESS_PRIVATE_UNSAFE", "Private Access storage validation failed.");
const normalize = (s: string) => process.platform === "win32" ? s.toLowerCase() : s;
async function identity(directory: string): Promise<string> {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || normalize(await realpath(directory)) !== normalize(path.resolve(directory))) throw unsafe();
  return createHash("sha256").update(`${info.dev}\0${info.ino}\0${info.birthtimeNs}`).digest("hex");
}

/** Disabled bootstrap only. Not wired to startup or HTTP; no provider/network effects. */
export class AccessPrivateStore {
  #root: string; #directory: string; #rootIdentity: string; #directoryIdentity: string | null = null;
  #owner: Owner; #acl: Acl; #publication: AccessPublication;
  #expected = new Set<AccessDisabledRecord["provider"]>();
  #blocked = false;
  #receipts = new Map<AccessDisabledRecord["provider"], AccessExpectation>();
  private constructor(root: string, owner: Owner, acl: Acl, publication: AccessPublication, rootIdentity: string) {
    this.#root = root; this.#directory = path.join(root, "access"); this.#owner = owner;
    this.#acl = acl; this.#publication = publication; this.#rootIdentity = rootIdentity;
  }
  static async open(root: string, owner: Owner, acl = new WindowsPrivateAclVerifier(), publication?: AccessPublication): Promise<AccessPrivateStore> {
    try {
      if (!path.isAbsolute(root) || root !== path.resolve(root) || root.startsWith("\\\\") || root.startsWith("//") || root.includes("\0")) throw unsafe();
      owner.assertHeld(root);
      const store = new AccessPrivateStore(root, owner, acl, publication ?? {
        createDirectory: (file) => createPrivateEntry(file, true, acl),
        writeNew: (file, bytes) => writePrivateNew(file, bytes, acl), publishNew: publishPrivateStageNew
      }, await identity(root));
      if (await privateEntryExists(store.#directory)) {
        store.#directoryIdentity = await identity(store.#directory);
        await acl.verifyMany([store.#directory]);
        await store.#noStages();
      }
      await store.#noStages();
      for (const provider of ["tailscale", "cloudflare"] as const) {
        const receipt = await store.#readReceipt(provider);
        if (receipt !== null) store.#receipts.set(provider, receipt);
        await store.read(provider);
      }
      return store;
    } catch { throw unsafe(); }
  }
  async #gate(): Promise<void> {
    if (this.#blocked) throw unsafe();
    this.#owner.assertHeld(this.#root);
    if (await identity(this.#root) !== this.#rootIdentity) throw unsafe();
    if (this.#directoryIdentity !== null && await identity(this.#directory) !== this.#directoryIdentity) throw unsafe();
  }
  #paths(provider: AccessDisabledRecord["provider"]) {
    if (provider !== "tailscale" && provider !== "cloudflare") throw unsafe();
    return { target: path.join(this.#directory, `${provider}.json`), stage: path.join(this.#directory, `${provider}.stage.json`) };
  }
  async #noStages(): Promise<void> {
    for (const provider of ["tailscale", "cloudflare"] as const) {
      if (await privateEntryExists(this.#paths(provider).stage)) throw unsafe();
      if (await privateEntryExists(this.#receiptPaths(provider).stage)) throw unsafe();
    }
  }
  #receiptPaths(provider: AccessDisabledRecord["provider"]) {
    this.#paths(provider);
    return { target: path.join(this.#root, `access-${provider}.receipt.json`), stage: path.join(this.#root, `access-${provider}.receipt.stage.json`) };
  }
  async #readReceipt(provider: AccessDisabledRecord["provider"]): Promise<AccessExpectation | null> {
    const target = this.#receiptPaths(provider).target;
    await this.#gate();
    if (!await privateEntryExists(target)) {
      if (this.#receipts.has(provider)) throw unsafe();
      return null;
    }
    const beforeAcl = await this.#acl.verifyMany([target]);
    const file = await readPrivatePropertiesFile(target, 4096);
    try {
      const receipt = decodeAccessExpectation(file.bytes, provider, this.#owner.rootIdentity());
      const afterAcl = await this.#acl.verifyMany([target]);
      const after = await readPrivatePropertiesFile(target, 4096);
      try {
        if (after.identity !== file.identity || after.checksum !== file.checksum ||
          beforeAcl.length !== afterAcl.length || afterAcl.some((v, i) => v !== beforeAcl[i])) throw unsafe();
      } finally { after.bytes.fill(0); }
      await this.#gate();
      if (receipt.directoryIdentity !== this.#directoryIdentity) throw unsafe();
      const expected = this.#receipts.get(provider);
      if (expected !== undefined && canonicalExpectation(expected) !== canonicalExpectation(receipt)) throw unsafe();
      return receipt;
    } finally { file.bytes.fill(0); }
  }
  async read(provider: AccessDisabledRecord["provider"]): Promise<AccessDisabledRecord | null> {
    try {
      const { target } = this.#paths(provider); await this.#gate();
      const receipt = await this.#readReceipt(provider);
      if (this.#directoryIdentity === null) {
        if (await privateEntryExists(this.#directory)) throw unsafe();
        return null;
      }
      await this.#noStages();
      if (!await privateEntryExists(target)) {
        if (this.#expected.has(provider) || receipt !== null) throw unsafe();
        await this.#acl.verifyMany([this.#directory]);
        await this.#gate(); await this.#noStages();
        if (await privateEntryExists(target)) throw unsafe();
        return null;
      }
      const beforeAcl = await this.#acl.verifyMany([this.#directory, target]);
      if (receipt === null) throw unsafe();
      const file = await readPrivatePropertiesFile(target, 4096);
      try {
        const result = decodeAccessDisabledRecord(file.bytes, provider, this.#owner.rootIdentity());
        if (result.revision !== receipt.revision || file.checksum !== receipt.checksum) throw unsafe();
        await this.#gate();
        const afterAcl = await this.#acl.verifyMany([this.#directory, target]);
        if (beforeAcl.length !== afterAcl.length || afterAcl.some((v, i) => v !== beforeAcl[i])) throw unsafe();
        const after = await readPrivatePropertiesFile(target, 4096);
        try { if (after.identity !== file.identity || after.checksum !== file.checksum) throw unsafe(); }
        finally { after.bytes.fill(0); }
        await this.#gate(); await this.#noStages();
        await this.#readReceipt(provider);
        this.#expected.add(provider); return result;
      } finally { file.bytes.fill(0); }
    } catch { throw unsafe(); }
  }
  /** Explicit initialization, never automatic startup. Failure retains stage and closes this store. */
  async initializeDisabled(provider: AccessDisabledRecord["provider"]): Promise<AccessDisabledRecord> {
    const paths = this.#paths(provider);
    const finish = this.#owner.beginOfflineMutation(this.#root);
    try {
      await this.#gate();
      if (this.#expected.has(provider)) throw unsafe();
      if (await privateEntryExists(this.#receiptPaths(provider).target)) throw unsafe();
      if (this.#directoryIdentity === null) {
        if (await privateEntryExists(this.#directory)) throw unsafe();
        await this.#publication.createDirectory(this.#directory);
        this.#directoryIdentity = await identity(this.#directory);
      }
      await this.#acl.verifyMany([this.#directory]); await this.#gate();
      await this.#noStages();
      if (await privateEntryExists(paths.target) || await privateEntryExists(paths.stage)) throw unsafe();
      const record: AccessDisabledRecord = { schemaVersion: 1, provider, rootIdentity: this.#owner.rootIdentity(),
        revision: randomUUID(), desiredEnabled: false, managementMode: "external", ownedRoute: null,
        operationId: null, ownershipRevision: null };
      const bytes = encodeAccessDisabledRecord(record);
      try {
        await this.#publication.writeNew(paths.stage, bytes);
        await this.#gate(); await this.#acl.verifyMany([this.#directory, paths.stage]);
        const staged = await readPrivatePropertiesFile(paths.stage, 4096);
        try { if (!staged.bytes.equals(bytes)) throw unsafe(); } finally { staged.bytes.fill(0); }
        await this.#gate();
        const receipt: AccessExpectation = { schemaVersion: 1, provider, rootIdentity: record.rootIdentity,
          directoryIdentity: this.#directoryIdentity!, revision: record.revision,
          checksum: createHash("sha256").update(bytes).digest("hex") };
        const receiptPaths = this.#receiptPaths(provider);
        const receiptBytes = encodeAccessExpectation(receipt);
        try {
          await this.#publication.writeNew(receiptPaths.stage, receiptBytes);
          await this.#gate();
          await this.#acl.verifyMany([receiptPaths.stage]);
          const check = await readPrivatePropertiesFile(receiptPaths.stage, 4096);
          try { if (!check.bytes.equals(receiptBytes)) throw unsafe(); } finally { check.bytes.fill(0); }
          await this.#gate();
          await this.#publication.publishNew(receiptPaths.stage, receiptPaths.target);
          this.#receipts.set(provider, receipt);
          await this.#readReceipt(provider);
        } finally { receiptBytes.fill(0); }
        await this.#publication.publishNew(paths.stage, paths.target);
        this.#expected.add(provider);
        const verified = await this.read(provider);
        if (verified === null || verified.revision !== record.revision) throw unsafe();
        return verified;
      } finally { bytes.fill(0); }
    } catch { this.#blocked = true; this.#expected.add(provider); throw unsafe(); }
    finally { finish(); }
  }
}

function canonicalExpectation(receipt: AccessExpectation): string {
  return encodeAccessExpectation(receipt).toString("utf8");
}
