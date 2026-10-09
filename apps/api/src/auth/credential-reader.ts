import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { readPrivatePropertiesFile } from "../services/properties-private-file.js";
import { AuthCoreError, parseCredentialRecord, type CredentialRecord } from "./password.js";
import { WindowsPrivateAclVerifier } from "./windows-private-acl.js";
import type { ManagerLifetimeLock } from "./manager-lifetime-lock.js";

const fail = () => new AuthCoreError("AUTH_PRIVATE_UNSAFE");
const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
async function directoryIdentity(directory: string): Promise<string> {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || normalized(await realpath(directory)) !== normalized(path.resolve(directory))) throw fail();
  return createHash("sha256").update(`${info.dev}\0${info.ino}\0${info.birthtimeNs}`).digest("hex");
}

/** Read-only backend boundary. There is deliberately no credential publish/reset method yet. */
export class CredentialReader {
  #managerIdentity: string;
  #authIdentity: string;
  #authDirectory: string;
  #file: string;
  #managerRoot: string;
  #acl: WindowsPrivateAclVerifier;
  private constructor(managerRoot: string, managerIdentity: string, authIdentity: string, acl: WindowsPrivateAclVerifier) {
    this.#managerRoot = managerRoot; this.#acl = acl;
    this.#managerIdentity = managerIdentity; this.#authIdentity = authIdentity;
    this.#authDirectory = path.join(managerRoot, "auth"); this.#file = path.join(this.#authDirectory, "credential.json");
  }
  static async open(managerRoot: string, acl = new WindowsPrivateAclVerifier()): Promise<CredentialReader> {
    try {
      if (!path.isAbsolute(managerRoot) || managerRoot.startsWith("\\\\") || managerRoot.startsWith("//") ||
        managerRoot !== path.resolve(managerRoot) || managerRoot.includes("\0") ||
        (process.platform === "win32" && (managerRoot.slice(2).includes(":") || managerRoot.split(/[\\/]/u).slice(1).some((part) => /[. ]$/u.test(part))))) throw fail();
      const managerIdentity = await directoryIdentity(managerRoot);
      const authDirectory = path.join(managerRoot, "auth");
      const authIdentity = await directoryIdentity(authDirectory);
      await acl.verify(authDirectory);
      const reader = new CredentialReader(managerRoot, managerIdentity, authIdentity, acl);
      await reader.#identities();
      return reader;
    } catch { throw fail(); }
  }
  async #identities(): Promise<void> {
    if (await directoryIdentity(this.#managerRoot) !== this.#managerIdentity || await directoryIdentity(this.#authDirectory) !== this.#authIdentity) throw fail();
  }
  /** Secret-bearing result must stay in the backend verifier; never serialize/log/backup it. */
  async #noPending(): Promise<void> {
    try { await lstat(path.join(this.#authDirectory, "credential.pending.json")); }
    catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return; throw fail(); }
    throw fail();
  }
  async read(): Promise<CredentialRecord> { return this.#read(false); }
  /** Only an offline owner of the same OS lifetime lock may inspect interrupted publication. */
  async readForOffline(lock: ManagerLifetimeLock): Promise<CredentialRecord> {
    lock.assertHeld(this.#managerRoot); return this.#read(true);
  }
  async #read(offline: boolean): Promise<CredentialRecord> {
    try {
      if (!offline) await this.#noPending();
      await this.#identities();
      const beforeAcls = await this.#acl.verifyMany([this.#authDirectory, this.#file]);
      const file = await readPrivatePropertiesFile(this.#file, 4096);
      try {
        // Fatal decoding rejects malformed bytes rather than silently repairing private records.
        const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
        const record = parseCredentialRecord(JSON.parse(text));
        await this.#identities();
        const afterAcls = await this.#acl.verifyMany([this.#authDirectory, this.#file]);
        if (afterAcls.some((value, index) => value !== beforeAcls[index])) throw fail();
        const after = await readPrivatePropertiesFile(this.#file, 4096);
        try { if (after.identity !== file.identity || after.checksum !== file.checksum) throw fail(); }
        finally { after.bytes.fill(0); }
        await this.#identities();
        if (!offline) await this.#noPending();
        return record;
      } finally { file.bytes.fill(0); }
    } catch { throw fail(); }
  }
}
