import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { AuthCoreError } from "./password.js";
import { createPrivateEntry, privateEntryExists } from "./private-publication.js";
import { WindowsPrivateAclVerifier } from "./windows-private-acl.js";

const LIMIT = 10 * 1024 ** 2;
const EVENTS = ["login-success", "login-failure", "logout", "session-expiry", "auth-denial", "csrf-denial", "reauth-success", "reauth-failure", "mutation-admission", "ws-denial", "ws-ticket", "ws-open", "ws-close", "ws-revocation"] as const;
export type AuthAuditEvent = Readonly<{ event: typeof EVENTS[number]; requestId: string; operationId?: string }>;
export interface AuthAudit { ready(): boolean; record(event: AuthAuditEvent): Promise<void>; close(): Promise<void> }
const fail = () => new AuthCoreError("AUTH_PRIVATE_UNSAFE");
const identity = (info: Awaited<ReturnType<typeof lstat>>) => `${info.dev}:${info.ino}:${info.birthtimeMs}`;
type AuditSlot = { file: string; handle: FileHandle; identity: string; size: number };
export function encodeAuditEvent(event: AuthAuditEvent, sequence = 1, generatedAt = new Date().toISOString()): Buffer {
  // Copy only the approved fields, never serialize caller-provided objects or error text.
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(generatedAt) ||
    !EVENTS.includes(event.event) || !id.test(event.requestId) ||
    (event.operationId !== undefined && !id.test(event.operationId))) throw fail();
  const bytes = Buffer.from(JSON.stringify({ version: 1, sequence, generatedAt, event: event.event, requestId: event.requestId,
    ...(event.operationId === undefined ? {} : { operationId: event.operationId }) }) + "\n");
  if (bytes.length > 1024) throw fail();
  return bytes;
}

/** Fixed three-slot circular retention, pinned handles and one bounded writer; no directory rename/delete. */
export class PrivateAuthAudit implements AuthAudit {
  #directory: string; #directoryIdentity: string; #acl: WindowsPrivateAclVerifier;
  #slots: AuditSlot[];
  #slot = 0; #sequence = 0; #pending = 0; #healthy = true; #tail: Promise<void> = Promise.resolve();
  private constructor(directory: string, directoryIdentity: string, acl: WindowsPrivateAclVerifier,
    slots: AuditSlot[]) {
    this.#directory = directory; this.#directoryIdentity = directoryIdentity; this.#acl = acl; this.#slots = slots;
  }
  static async open(managerRoot: string, acl = new WindowsPrivateAclVerifier(),
    create = createPrivateEntry): Promise<PrivateAuthAudit> {
    const directory = path.join(managerRoot, "auth");
    const slots: { file: string; handle: FileHandle; identity: string; size: number }[] = [];
    try {
      const info = await lstat(directory);
      if (!path.isAbsolute(managerRoot) || managerRoot !== path.resolve(managerRoot) || !info.isDirectory() || info.isSymbolicLink() ||
        (await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw fail();
      await acl.verify(directory);
      let latestSequence = 0; let latestSlot = 0;
      for (let index = 0; index < 3; index++) {
        const file = path.join(directory, `audit.${index}.jsonl`);
        if (!await privateEntryExists(file)) await create(file, false, acl);
        const beforeAcl = await acl.verifyMany([directory, file]);
        const before = await lstat(file);
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > LIMIT ||
          (await realpath(file)).toLowerCase() !== file.toLowerCase()) throw fail();
        const handle = await open(file, "r+");
        slots.push({ file, handle, identity: identity(before), size: before.size });
        if (identity(await handle.stat()) !== identity(before)) throw fail();
        // Bounded startup scan validates the private ring and resumes the newest slot,
        // so a restart cannot retain old slots while overwriting newer events first.
        const bytes = Buffer.alloc(before.size);
        try {
          let offset = 0;
          while (offset < bytes.length) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (!bytesRead) throw fail(); offset += bytesRead;
          }
          const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
          if (text && !text.endsWith("\n")) throw fail();
          let prior = 0;
          for (const line of text.split("\n").slice(0, -1)) {
            if (Buffer.byteLength(line) >= 1024) throw fail();
            const value = JSON.parse(line) as AuthAuditEvent & { sequence: number; generatedAt: string; version: number };
            if (value.version !== 1 || !encodeAuditEvent(value, value.sequence, value.generatedAt).equals(Buffer.from(line + "\n")) || value.sequence <= prior) throw fail();
            prior = value.sequence;
          }
          if (prior > latestSequence) { latestSequence = prior; latestSlot = index; }
        } finally { bytes.fill(0); }
        const afterInfo = await lstat(file); const opened = await handle.stat();
        if (identity(afterInfo) !== identity(before) || afterInfo.nlink !== 1 || afterInfo.size !== before.size ||
          opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || afterInfo.mtimeMs !== before.mtimeMs) throw fail();
        const afterAcl = await acl.verifyMany([directory, file]);
        if (afterAcl.some((value, i) => value !== beforeAcl[i])) throw fail();
      }
      if (identity(await lstat(directory)) !== identity(info)) throw fail();
      const audit = new PrivateAuthAudit(directory, identity(info), acl, slots);
      audit.#slot = latestSlot; audit.#sequence = latestSequence; return audit;
    } catch {
      await Promise.allSettled(slots.map(({ handle }) => handle.close())); throw fail();
    }
  }
  ready(): boolean { return this.#healthy; }
  async #check(slot: AuditSlot): Promise<string[]> {
    const directory = await lstat(this.#directory);
    const info = await lstat(slot.file); const opened = await slot.handle.stat();
    if (!directory.isDirectory() || directory.isSymbolicLink() || identity(directory) !== this.#directoryIdentity ||
      !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || opened.nlink !== 1 ||
      identity(info) !== slot.identity || identity(opened) !== slot.identity || info.size !== slot.size || opened.size !== slot.size) throw fail();
    return this.#acl.verifyMany([this.#directory, slot.file]);
  }
  async #append(bytes: Buffer): Promise<void> {
    if (!this.#healthy) throw fail();
    let slot = this.#slots[this.#slot]!;
    let before = await this.#check(slot);
    if (slot.size + bytes.length > LIMIT) {
      this.#slot = (this.#slot + 1) % 3; slot = this.#slots[this.#slot]!;
      before = await this.#check(slot);
      await slot.handle.truncate(0); slot.size = 0;
    }
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await slot.handle.write(bytes, offset, bytes.length - offset, slot.size + offset);
      if (!bytesWritten) throw fail(); offset += bytesWritten;
    }
    slot.size += bytes.length; await slot.handle.sync();
    const after = await this.#check(slot);
    if (after.some((value, i) => value !== before[i])) throw fail();
  }
  record(event: AuthAuditEvent): Promise<void> {
    let bytes: Buffer;
    try { bytes = encodeAuditEvent(event, ++this.#sequence); } catch { this.#healthy = false; return Promise.reject(fail()); }
    if (!this.#healthy || this.#pending >= 64) { this.#healthy = false; return Promise.reject(fail()); }
    this.#pending++;
    const result = this.#tail.then(() => this.#append(bytes)).catch(() => { this.#healthy = false; throw fail(); })
      .finally(() => { this.#pending--; bytes.fill(0); });
    this.#tail = result.catch(() => {}); return result;
  }
  async close(): Promise<void> {
    this.#healthy = false; await this.#tail;
    await Promise.allSettled(this.#slots.map(({ handle }) => handle.close()));
  }
}
