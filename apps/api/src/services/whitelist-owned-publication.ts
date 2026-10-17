import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { buildPrivateCreateScript, buildPrivatePublishNewScript } from "../auth/private-publication-scripts.js";
import type { WhitelistActionCapability } from "./whitelist-action-envelope.js";
import type { WhitelistEnvelopeAcl } from "./whitelist-envelope-acl.js";
import { WhitelistNativeWriter, whitelistNativeWriterExecutable } from "./whitelist-native-writer.js";
import { buildWhitelistGuardGroup, buildWhitelistGuardWideGroup, verifyWhitelistGuardGroupResult, whitelistGuardGroupCommandBound } from "./whitelist-guard-group-scripts.js";

interface Handle {
  stat(): Promise<BigIntStats>;
  read(bytes: Buffer, offset: number, length: number, position: number): Promise<number>;
  write(bytes: Buffer): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
interface Io {
  stat(file: string): Promise<BigIntStats>;
  realpath(file: string): Promise<string>;
  open(file: string, mode: "r" | "r+"): Promise<Handle>;
  list(file: string): Promise<string[]>;
}
type Writer = Pick<WhitelistNativeWriter, "run" | "close" | "closedConfirmed" | "closeEvidence">;
/** Internal constructor composition only. Never supplied by HTTP, config or environment. */
export interface WhitelistPublicationTestDependencies {
  io?: Io;
  writer?: (wrapper: (script: string) => string, now: () => number) => Writer;
}
export interface WhitelistGuardPublication {
  createDirectory(relativePath: string): Promise<void>;
  publishFile(relativeTarget: string, original: Uint8Array): Promise<{ sha256: string; byteLength: number }>;
}
export interface WhitelistGuardGroupedPublication extends WhitelistGuardPublication {
  publishChunkGroup(relativeDirectory: string, startIndex: number, chunks: readonly Uint8Array[]): Promise<readonly { sha256: string; byteLength: number }[]>;
}
/** Trusted store composition only; no raw paths, ACL bypass, owner or release. */
export interface WhitelistOwnedGuardAccess extends WhitelistGuardPublication {
  publishChunkGroup?: WhitelistGuardGroupedPublication["publishChunkGroup"];
  directoryIdentity(relativePath: string): Promise<string | null>;
  listDirectory(relativePath: string): Promise<string[]>;
  readFile(relativePath: string): Promise<{ bytes: Buffer; fingerprint: string }>;
}
export interface WhitelistOwnedWideGuardAccess extends WhitelistOwnedGuardAccess {
  publishChunkGroup: WhitelistGuardGroupedPublication["publishChunkGroup"];
  readChunkBatch(relativeDirectory: string, startIndex: number, count: number): Promise<readonly Readonly<{ index: number; bytes: Buffer; fingerprint: string }>[]>;
}
export class WhitelistPublicationError extends Error {
  readonly code = "WHITELIST_PUBLICATION_UNSAFE";
  constructor() { super("WHITELIST_PUBLICATION_UNSAFE"); }
}
const unsafe = () => new WhitelistPublicationError();
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const directoryPattern = new RegExp(`^whitelist-guards(?:/${uuid})?$`, "u");
const targetPattern = new RegExp(`^whitelist-guards/${uuid}/(?:[0-5][0-9]\\.bin|6[0-3]\\.bin|manifest\\.json)$`, "u");
const normalized = (file: string) => process.platform === "win32" ? file.toLowerCase() : file;
const identity = (s: BigIntStats) => `${s.dev}:${s.ino}:${s.birthtimeNs}`;
const sameFile = (a: BigIntStats, b: BigIntStats) => b.isFile() && !b.isSymbolicLink() && b.nlink === 1n &&
  identity(a) === identity(b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const defaultIo: Io = {
  stat: (file) => lstat(file, { bigint: true }), realpath, list: readdir,
  open: async (file, mode) => {
    const handle = await open(file, mode);
    return { stat: () => handle.stat({ bigint: true }),
      read: async (bytes, offset, length, position) => (await handle.read(bytes, offset, length, position)).bytesRead,
      write: (bytes) => handle.writeFile(bytes), sync: () => handle.sync(), close: () => handle.close() };
  },
};
interface Work { settled: boolean; uncertainOpens: number; handles: Set<Handle> }
interface Parents { paths: string[]; identities: string[]; acls: string[] }

/** UNWIRED trusted action composition. Only the owning action receives this controller.
 * No store/default-auth/RCON wiring, cleanup deletion, retry or cross-volume fallback. */
export class WhitelistOwnedPublicationController {
  #accepting = true; #busy = false; #poisoned = false;
  #rootIdentity: string | undefined;
  readonly #io: Io;
  readonly #writer: NonNullable<WhitelistPublicationTestDependencies["writer"]>;
  readonly facade: WhitelistGuardPublication;
  readonly groupedFacade: WhitelistGuardGroupedPublication;
  readonly storageFacade: WhitelistOwnedGuardAccess;
  readonly wideStorageFacade: WhitelistOwnedWideGuardAccess;
  constructor(private readonly root: string, private readonly cap: WhitelistActionCapability,
    private readonly acl: WhitelistEnvelopeAcl, private readonly wrapper: (script: string) => string,
    private readonly revoke: () => void, private readonly now: () => number,
    deps: WhitelistPublicationTestDependencies = {}, private readonly groupLimit: 8 | 16 = 8) {
    if (groupLimit !== 8 && groupLimit !== 16) throw unsafe();
    this.#io = deps.io ?? defaultIo;
    this.#writer = deps.writer ?? ((wrap, clock) => new WhitelistNativeWriter(wrap, undefined, clock));
    this.facade = Object.freeze({ createDirectory: (relative: string) => this.#create(relative),
      publishFile: (relative: string, bytes: Uint8Array) => this.#publish(relative, bytes) });
    this.groupedFacade = Object.freeze({ ...this.facade, publishChunkGroup: (directory: string, start: number, chunks: readonly Uint8Array[]) =>
      this.#publishGroup(directory, start, chunks) });
    this.storageFacade = Object.freeze({ ...this.facade, directoryIdentity: (relative: string) => this.#directoryIdentity(relative),
      listDirectory: (relative: string) => this.#listDirectory(relative), readFile: (relative: string) => this.#readFile(relative) });
    this.wideStorageFacade = Object.freeze({ ...this.storageFacade, publishChunkGroup: this.groupedFacade.publishChunkGroup,
      readChunkBatch: (directory: string, start: number, count: number) => this.#readChunkBatch(directory, start, count) });
  }
  poison(): void { this.#poisoned = true; this.#accepting = false; this.revoke(); }
  #fail(): never { this.poison(); throw unsafe(); }
  #gate(): void {
    if (this.#poisoned || !this.#accepting) this.#fail();
    try { this.cap.assertActive(); } catch { this.#fail(); }
  }
  finish(): void { this.#gate(); if (this.#busy) this.#fail(); this.#accepting = false; }
  #path(relative: string, directory: boolean): string {
    this.#gate();
    if (typeof relative !== "string" || !(directory ? directoryPattern : targetPattern).test(relative)) this.#fail();
    return path.join(this.root, ...relative.split("/"));
  }
  async #step<T>(action: () => Promise<T>): Promise<T> {
    this.#gate(); const value = await action(); this.#gate(); return value;
  }
  #work<T>(copy: Buffer | undefined, action: (work: Work) => Promise<T>): Promise<T> {
    try { this.#gate(); if (this.#busy) this.#fail(); } catch { copy?.fill(0); return Promise.reject(unsafe()); }
    this.#busy = true;
    const work: Work = { settled: false, uncertainOpens: 0, handles: new Set() };
    let started = false;
    const tracked = this.cap.start(() => {
      started = true;
      // No I/O before resource registration. This Promise includes every descriptor finally.
      const task = Promise.resolve().then(() => { this.#gate(); return action(work); }).catch(() => this.#fail()).finally(() => {
        work.settled = true; this.#busy = false; copy?.fill(0);
      });
      void task.catch(() => undefined);
      return { result: task,
        get closedConfirmed() { return work.settled && work.uncertainOpens === 0 && work.handles.size === 0; },
        drain: async () => {
          await task.catch(() => undefined);
          if (!work.settled || work.uncertainOpens !== 0 || work.handles.size !== 0) throw unsafe();
        } };
    });
    return tracked.catch(() => { if (!started) { this.#busy = false; copy?.fill(0); } this.#fail(); });
  }
  async #withHandle<T>(work: Work, file: string, mode: "r" | "r+", use: (handle: Handle) => Promise<T>): Promise<T> {
    this.#gate(); work.uncertainOpens++;
    let handle: Handle | undefined;
    try {
      handle = await this.#io.open(file, mode);
      // Register a late returned handle BEFORE the post-await action fence.
      work.handles.add(handle); work.uncertainOpens--; this.#gate();
      return await use(handle);
    } finally {
      if (handle) { await handle.close(); work.handles.delete(handle); }
      // No action fence here: drain-only close remains allowed after revocation.
    }
  }
  async #metadata(file: string, directory: boolean): Promise<BigIntStats> {
    const s = await this.#step(() => this.#io.stat(file));
    if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1n || s.size < 0n || s.size > 4096n) ||
      normalized(await this.#step(() => this.#io.realpath(file))) !== normalized(file)) this.#fail();
    return s;
  }
  async #parents(file: string): Promise<Parents> {
    const root = await this.#metadata(this.root, true), rootId = identity(root);
    if (this.#rootIdentity !== undefined && this.#rootIdentity !== rootId) this.#fail();
    this.#rootIdentity ??= rootId;
    const parts = path.relative(this.root, path.dirname(file)).split(path.sep).filter(Boolean);
    const paths: string[] = [], identities = [rootId]; let current = this.root;
    for (const part of parts) { current = path.join(current, part); paths.push(current); identities.push(identity(await this.#metadata(current, true))); }
    const acls = paths.length ? await this.#step(() => this.acl.verifyMany(paths)) : [];
    return { paths, identities, acls };
  }
  async #sameParents(file: string, previous: Parents): Promise<void> {
    const current = await this.#parents(file);
    if (JSON.stringify(current) !== JSON.stringify(previous)) this.#fail();
  }
  async #sameParentIdentities(file: string, previous: Parents): Promise<void> {
    if (identity(await this.#metadata(this.root, true)) !== previous.identities[0]) this.#fail();
    for (let i = 0; i < previous.paths.length; i++) {
      if (identity(await this.#metadata(previous.paths[i]!, true)) !== previous.identities[i + 1]) this.#fail();
    }
    this.#gate();
    if (path.dirname(file) !== (previous.paths.at(-1) ?? this.root)) this.#fail();
  }
  async #absent(file: string): Promise<void> {
    this.#gate(); let exists = true;
    try { await this.#io.stat(file); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") exists = false;
      else throw unsafe();
    }
    this.#gate(); if (exists) this.#fail();
  }
  async #native(payload: string, beforeDispatch: () => Promise<void>, group = false): Promise<unknown> {
    await this.acl.quiesce(); this.#gate();
    await beforeDispatch(); this.#gate();
    let writer: Writer | undefined;
    const output = await this.cap.start(() => {
      writer = this.#writer((script) => {
        this.#gate(); const wrapped = this.wrapper(script); this.#gate();
        if (group) whitelistGuardGroupCommandBound(wrapped, whitelistNativeWriterExecutable());
        return wrapped;
      }, this.now);
      this.#gate(); const result = writer.run(payload);
      return { result, get closedConfirmed() { return writer!.closedConfirmed; }, drain: (end) => writer!.close(end) };
    });
    this.#gate();
    if (!writer?.closedConfirmed || !writer.closeEvidence.actualClose || writer.closeEvidence.exitCode !== 0 || writer.closeEvidence.exitSignal !== null ||
      typeof output !== "object" || output === null || !("ok" in output) || output.ok !== true) this.#fail();
    return output;
  }
  async #privateCreate(file: string, directory: boolean): Promise<void> {
    const parents = await this.#parents(file); await this.#absent(file);
    const output = await this.#native(buildPrivateCreateScript(file, directory), async () => {
      await this.#sameParentIdentities(file, parents); await this.#absent(file);
    });
    if (typeof output !== "object" || output === null || !("snapshot" in output)) this.#fail();
    this.acl.verifyNativeSnapshot(output.snapshot); this.#gate();
    const created = await this.#metadata(file, directory);
    if (!directory && created.size !== 0n) this.#fail();
    await this.#sameParents(file, parents);
  }
  #create(relative: string): Promise<void> {
    let file: string;
    try { file = this.#path(relative, true); } catch { this.poison(); return Promise.reject(unsafe()); }
    return this.#work(undefined, () => this.#privateCreate(file, true));
  }
  async #read(work: Work, file: string, expected: Buffer): Promise<BigIntStats> {
    const parents = await this.#parents(file), before = await this.#metadata(file, false);
    const aclBefore = await this.#step(() => this.acl.verify(file));
    if (!sameFile(before, await this.#metadata(file, false))) this.#fail();
    const bytes = Buffer.alloc(Number(before.size));
    try {
      await this.#withHandle(work, file, "r", async (handle) => {
        if (!sameFile(before, await this.#step(() => handle.stat()))) this.#fail();
        let offset = 0;
        while (offset < bytes.length) {
          const count = await this.#step(() => handle.read(bytes, offset, bytes.length - offset, offset));
          if (!Number.isSafeInteger(count) || count < 1 || count > bytes.length - offset) this.#fail(); offset += count;
        }
        if (!sameFile(before, await this.#step(() => handle.stat())) || !sameFile(before, await this.#metadata(file, false))) this.#fail();
        const aclAfter = await this.#step(() => this.acl.verify(file));
        // Keep the descriptor open across ACL-after and its final physical checks.
        if (aclAfter !== aclBefore || !sameFile(before, await this.#step(() => handle.stat())) ||
          !sameFile(before, await this.#metadata(file, false)) || !bytes.equals(expected)) this.#fail();
      });
      this.#gate();
      await this.#sameParents(file, parents); return before;
    } finally { bytes.fill(0); }
  }
  #publish(relative: string, original: Uint8Array): Promise<{ sha256: string; byteLength: number }> {
    let target: string, copy: Buffer;
    try {
      target = this.#path(relative, false);
      if (!(original instanceof Uint8Array) || original.byteLength > 4096) this.#fail();
      copy = Buffer.from(original);
    } catch { this.poison(); return Promise.reject(unsafe()); }
    return this.#work(copy, async (work) => {
      const stage = target + ".stage", parents = await this.#parents(target);
      await this.#absent(target); await this.#absent(stage); await this.#privateCreate(stage, false);
      const before = await this.#metadata(stage, false);
      await this.#withHandle(work, stage, "r+", async (handle) => {
        if (before.size !== 0n || !sameFile(before, await this.#step(() => handle.stat()))) this.#fail();
        await this.#step(() => handle.write(copy)); await this.#step(() => handle.sync());
      });
      this.#gate(); const staged = await this.#read(work, stage, copy);
      await this.#sameParents(target, parents); await this.#absent(target);
      await this.#native(buildPrivatePublishNewScript(stage, target), async () => {
        await this.#sameParentIdentities(target, parents); await this.#absent(target);
        if (!sameFile(staged, await this.#metadata(stage, false))) this.#fail();
      });
      const actual = await this.#read(work, target, copy);
      if (identity(staged) !== identity(actual)) this.#fail();
      await this.#sameParents(target, parents); this.#gate();
      return { sha256: createHash("sha256").update(copy).digest("hex"), byteLength: copy.length };
    });
  }
  #publishGroup(relativeDirectory: string, startIndex: number, chunks: readonly Uint8Array[]): Promise<readonly { sha256: string; byteLength: number }[]> {
    let copy = Buffer.alloc(0), directory: string, indices: number[], lengths: number[];
    try {
      directory = this.#path(relativeDirectory, true);
      if (relativeDirectory === "whitelist-guards" || !Array.isArray(chunks) || chunks.length < 1 || chunks.length > this.groupLimit ||
        !Number.isInteger(startIndex) || startIndex < 0 || startIndex + chunks.length > 64) this.#fail();
      const captured: Uint8Array[] = [], count = chunks.length;
      for (let i = 0; i < count; i++) {
        const chunk = chunks[i];
        if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1 || chunk.byteLength > 4096) this.#fail(); captured.push(chunk);
      }
      indices = captured.map((_, index) => startIndex + index); lengths = captured.map((chunk) => chunk.byteLength);
      copy = Buffer.alloc(lengths.reduce((total, length) => total + length, 0));
      let offset = 0;
      // Capture the whole group before the first await; raw Node work owns this copy.
      for (let i = 0; i < captured.length; i++) { copy.set(captured[i]!, offset); offset += lengths[i]!; }
    } catch { copy.fill(0); this.poison(); return Promise.reject(unsafe()); }
    return this.#work(copy, async (work) => {
      const operationId = path.basename(directory);
      const build = this.groupLimit === 16 ? buildWhitelistGuardWideGroup : buildWhitelistGuardGroup;
      const create = build(this.root, operationId, indices, "create"), move = build(this.root, operationId, indices, "move");
      // Both fixed commands must fit BEFORE any Create. Rechecked at actual dispatch.
      for (const plan of [create, move]) {
        this.#gate(); const wrapped = this.wrapper(plan.script); this.#gate();
        whitelistGuardGroupCommandBound(wrapped, whitelistNativeWriterExecutable());
      }
      let offset = 0;
      const entries: { target: string; stage: string; bytes: Buffer; parents: Parents }[] = [];
      const sharedParents = await this.#parents(path.join(directory, `${String(indices[0]).padStart(2, "0")}.bin`));
      for (let i = 0; i < indices.length; i++) {
        const target = path.join(directory, `${String(indices[i]).padStart(2, "0")}.bin`), stage = target + ".stage";
        const bytes = copy.subarray(offset, offset + lengths[i]!); offset += lengths[i]!;
        await this.#absent(target); await this.#absent(stage); entries.push({ target, stage, bytes, parents: sharedParents });
      }
      const created = await this.#native(create.script, async () => {
        for (const entry of entries) {
          await this.#sameParentIdentities(entry.target, entry.parents); await this.#absent(entry.target); await this.#absent(entry.stage);
        }
      }, true);
      verifyWhitelistGuardGroupResult(create, created, (snapshot) => this.acl.verifyNativeSnapshot(snapshot)); this.#gate();
      // Every creation receipt and empty stage is checked before ANY Node write.
      const empty: BigIntStats[] = [];
      for (const entry of entries) {
        const info = await this.#metadata(entry.stage, false); if (info.size !== 0n) this.#fail();
        empty.push(info);
      }
      await this.#sameParents(entries[0]!.target, sharedParents);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        await this.#withHandle(work, entry.stage, "r+", async (handle) => {
          if (!sameFile(empty[i]!, await this.#step(() => handle.stat()))) this.#fail();
          await this.#step(() => handle.write(entry.bytes)); await this.#step(() => handle.sync());
        });
      }
      const staged = await this.#readGroup(work, entries.map((entry) => ({ file: entry.stage, expected: entry.bytes })), sharedParents);
      if (staged.some((info, index) => identity(info) !== identity(empty[index]!))) this.#fail();
      const moved = await this.#native(move.script, async () => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!;
          await this.#sameParentIdentities(entry.target, entry.parents); await this.#absent(entry.target);
          if (!sameFile(staged[i]!, await this.#metadata(entry.stage, false))) this.#fail();
        }
      }, true);
      verifyWhitelistGuardGroupResult(move, moved, (snapshot) => this.acl.verifyNativeSnapshot(snapshot)); this.#gate();
      const actual = await this.#readGroup(work, entries.map((entry) => ({ file: entry.target, expected: entry.bytes })), sharedParents);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        if (identity(staged[i]!) !== identity(actual[i]!) || !sameFile(actual[i]!, await this.#metadata(entry.target, false))) this.#fail();
        await this.#absent(entry.stage);
      }
      await this.#sameParents(entries[0]!.target, sharedParents);
      this.#gate();
      return Object.freeze(entries.map((entry) => Object.freeze({ sha256: createHash("sha256").update(entry.bytes).digest("hex"), byteLength: entry.bytes.length })));
    });
  }
  /** Grouped path only: <=6 held read descriptors + two parents fit one8-target ACL batch.
   * Every phase pins parents to the ORIGINAL whole-publication baseline, not a new cache.
   * Peak data storage:65536 input +24576 read bytes for wide mode; no new budget.
   */
  async #readGroup(work: Work, files: readonly { file: string; expected: Buffer }[], parents: Parents): Promise<BigIntStats[]> {
    const result: BigIntStats[] = [];
    for (let offset = 0; offset < files.length; offset += 6) {
      this.#gate(); const batch = files.slice(offset, offset + 6), chain = await this.#physicalChain(batch[0]!.file);
      if (chain.paths.length !== 3 || JSON.stringify(chain.paths.slice(1)) !== JSON.stringify(parents.paths) ||
        chain.stats.some((s, index) => identity(s) !== parents.identities[index]) ||
        batch.some((entry) => path.dirname(entry.file) !== chain.paths.at(-1))) this.#fail();
      const paths = [...parents.paths, ...batch.map((entry) => entry.file)];
      // Pin full file versions BEFORE ACL-before, as the original single-file path does.
      const stats: BigIntStats[] = [];
      for (const entry of batch) stats.push(await this.#metadata(entry.file, false));
      const beforeAcl = await this.#step(() => this.acl.verifyMany(paths));
      if (beforeAcl.length !== paths.length || parents.acls.some((hash, index) => hash !== beforeAcl[index])) this.#fail();
      const buffers: Buffer[] = [], held: Handle[] = [];
      try {
        for (let i = 0; i < batch.length; i++) {
          if (!sameFile(stats[i]!, await this.#metadata(batch[i]!.file, false))) this.#fail();
          buffers.push(Buffer.alloc(Number(stats[i]!.size)));
        }
        const readAt = async (index: number): Promise<void> => {
          if (index === batch.length) {
            const afterAcl = await this.#step(() => this.acl.verifyMany(paths));
            if (afterAcl.length !== beforeAcl.length || afterAcl.some((hash, i) => hash !== beforeAcl[i])) this.#fail();
            for (let i = 0; i < batch.length; i++) {
              if (!sameFile(stats[i]!, await this.#step(() => held[i]!.stat())) ||
                !sameFile(stats[i]!, await this.#metadata(batch[i]!.file, false)) || !buffers[i]!.equals(batch[i]!.expected)) this.#fail();
            }
            await this.#sameChain(chain); return;
          }
          const entry = batch[index]!, before = stats[index]!, bytes = buffers[index]!;
          // Nested finally blocks attempt every remaining close if an inner close fails.
          await this.#withHandle(work, entry.file, "r", async (handle) => {
            held[index] = handle;
            if (!sameFile(before, await this.#step(() => handle.stat()))) this.#fail();
            let position = 0;
            while (position < bytes.length) {
              const count = await this.#step(() => handle.read(bytes, position, bytes.length - position, position));
              if (!Number.isSafeInteger(count) || count < 1 || count > bytes.length - position) this.#fail(); position += count;
            }
            await readAt(index + 1);
          });
        };
        await readAt(0); this.#gate(); result.push(...stats);
      } finally { for (const bytes of buffers) bytes.fill(0); }
    }
    // Earlier partition must not silently change while the later partition is read.
    for (let i = 0; i < files.length; i++) if (!sameFile(result[i]!, await this.#metadata(files[i]!.file, false))) this.#fail();
    await this.#sameParentIdentities(files[0]!.file, parents); this.#gate(); return result;
  }
  async #physicalChain(file: string): Promise<{ paths: string[]; stats: BigIntStats[] }> {
    const paths = [this.root]; let current = this.root;
    for (const part of path.relative(this.root, path.dirname(file)).split(path.sep).filter(Boolean)) {
      current = path.join(current, part); paths.push(current);
    }
    const stats: BigIntStats[] = [];
    for (const directory of paths) stats.push(await this.#metadata(directory, true));
    const rootId = identity(stats[0]!);
    if (this.#rootIdentity !== undefined && this.#rootIdentity !== rootId) this.#fail(); this.#rootIdentity ??= rootId;
    return { paths, stats };
  }
  async #sameChain(previous: { paths: string[]; stats: BigIntStats[] }): Promise<void> {
    for (let i = 0; i < previous.paths.length; i++) {
      if (identity(await this.#metadata(previous.paths[i]!, true)) !== identity(previous.stats[i]!)) this.#fail();
    }
  }
  #directoryIdentity(relative: string): Promise<string | null> {
    let file: string;
    try { file = relative === "" ? (this.#gate(), this.root) : this.#path(relative, true); }
    catch { this.poison(); return Promise.reject(unsafe()); }
    return this.#work(undefined, async () => {
      const chain = await this.#physicalChain(relative === "" ? path.join(this.root, "00.bin") : file);
      let missing = false;
      try { await this.#step(() => this.#io.stat(file)); }
      catch (error) {
        if (relative === "whitelist-guards" && typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") missing = true;
        else throw error;
      }
      this.#gate();
      if (missing) { await this.#sameChain(chain); return null; }
      const actual = await this.#metadata(file, true); await this.#sameChain(chain);
      return createHash("sha256").update(`${actual.dev}\0${actual.ino}\0${actual.birthtimeNs}`).digest("hex");
    });
  }
  #listDirectory(relative: string): Promise<string[]> {
    let file: string;
    try { file = this.#path(relative, true); } catch { this.poison(); return Promise.reject(unsafe()); }
    return this.#work(undefined, async () => {
      const chain = await this.#physicalChain(path.join(file, "00.bin"));
      const targets = chain.paths.slice(1), before = await this.#step(() => this.acl.verifyMany(targets));
      const names = await this.#step(() => this.#io.list(file));
      if (!Array.isArray(names) || names.length > 1000 || names.some((name) => typeof name !== "string" || name.length > 255) ||
        new Set(names).size !== names.length) this.#fail();
      const after = await this.#step(() => this.acl.verifyMany(targets));
      if (JSON.stringify(before) !== JSON.stringify(after)) this.#fail(); await this.#sameChain(chain); return [...names];
    });
  }
  #readChunkBatch(relativeDirectory: string, start: number, count: number): ReturnType<WhitelistOwnedWideGuardAccess["readChunkBatch"]> {
    let directory: string, files: string[];
    try {
      directory = this.#path(relativeDirectory, true);
      if (this.groupLimit !== 16 || relativeDirectory === "whitelist-guards" || !Number.isInteger(start) || !Number.isInteger(count) ||
        start < 0 || count < 1 || count > 6 || start + count > 64) this.#fail();
      files = Array.from({ length: count }, (_, i) => path.join(directory, `${String(start + i).padStart(2, "0")}.bin`));
    } catch { this.poison(); return Promise.reject(unsafe()); }
    const copies: { index: number; bytes: Buffer; fingerprint: string }[] = [];
    const result = this.#work(undefined, async (work) => {
      const chain = await this.#physicalChain(files[0]!);
      if (chain.paths.length !== 3) this.#fail();
      const stats: BigIntStats[] = [], buffers: Buffer[] = [], held: Handle[] = [];
      for (const file of files) {
        const before = await this.#metadata(file, false); if (before.size < 1n) this.#fail(); stats.push(before);
      }
      const targets = [...chain.paths.slice(1), ...files], beforeAcl = await this.#step(() => this.acl.verifyMany(targets));
      if (beforeAcl.length !== targets.length) this.#fail();
      try {
        for (let i = 0; i < files.length; i++) {
          if (!sameFile(stats[i]!, await this.#metadata(files[i]!, false))) this.#fail();
          buffers.push(Buffer.alloc(Number(stats[i]!.size)));
        }
        const readAt = async (i: number): Promise<void> => {
          if (i === files.length) {
            const afterAcl = await this.#step(() => this.acl.verifyMany(targets));
            if (JSON.stringify(afterAcl) !== JSON.stringify(beforeAcl)) this.#fail();
            for (let j = 0; j < files.length; j++) {
              if (!sameFile(stats[j]!, await this.#step(() => held[j]!.stat())) ||
                !sameFile(stats[j]!, await this.#metadata(files[j]!, false))) this.#fail();
            }
            await this.#sameChain(chain); return;
          }
          await this.#withHandle(work, files[i]!, "r", async (handle) => {
            held[i] = handle;
            if (!sameFile(stats[i]!, await this.#step(() => handle.stat()))) this.#fail();
            const bytes = buffers[i]!; let offset = 0;
            while (offset < bytes.length) {
              const n = await this.#step(() => handle.read(bytes, offset, bytes.length - offset, offset));
              if (!Number.isSafeInteger(n) || n < 1 || n > bytes.length - offset) this.#fail(); offset += n;
            }
            await readAt(i + 1);
          });
        };
        await readAt(0); this.#gate(); await this.#sameChain(chain);
        for (let i = 0; i < files.length; i++) {
          if (!sameFile(stats[i]!, await this.#metadata(files[i]!, false))) this.#fail();
        }
        for (let i = 0; i < files.length; i++) {
          const s = stats[i]!, contentHash = createHash("sha256").update(buffers[i]!).digest("hex");
          copies.push(Object.freeze({ index: start + i, bytes: Buffer.from(buffers[i]!),
            fingerprint: createHash("sha256").update(`${s.dev}\0${s.ino}\0${s.birthtimeNs}\0${contentHash}`).digest("hex") }));
        }
        this.#gate(); return Object.freeze(copies);
      } finally { for (const buffer of buffers) buffer.fill(0); }
    });
    return result.catch(() => { for (const row of copies) row.bytes.fill(0); throw unsafe(); });
  }
  #readFile(relative: string): Promise<{ bytes: Buffer; fingerprint: string }> {
    let file: string;
    try { file = this.#path(relative, false); } catch { this.poison(); return Promise.reject(unsafe()); }
    let resultCopy: Buffer | undefined;
    const result = this.#work(undefined, async (work) => {
      // Match the original store's two three-path batches; do not charge four queries/file.
      const chain = await this.#physicalChain(file), before = await this.#metadata(file, false);
      if (before.size < 1n) this.#fail();
      const targets = [...chain.paths.slice(1), file], aclBefore = await this.#step(() => this.acl.verifyMany(targets));
      if (!sameFile(before, await this.#metadata(file, false))) this.#fail();
      const bytes = Buffer.alloc(Number(before.size));
      try {
        await this.#withHandle(work, file, "r", async (handle) => {
          if (!sameFile(before, await this.#step(() => handle.stat()))) this.#fail();
          let offset = 0;
          while (offset < bytes.length) {
            const count = await this.#step(() => handle.read(bytes, offset, bytes.length - offset, offset));
            if (!Number.isSafeInteger(count) || count < 1 || count > bytes.length - offset) this.#fail(); offset += count;
          }
          const aclAfter = await this.#step(() => this.acl.verifyMany(targets));
          if (JSON.stringify(aclBefore) !== JSON.stringify(aclAfter) || !sameFile(before, await this.#step(() => handle.stat())) ||
            !sameFile(before, await this.#metadata(file, false))) this.#fail(); await this.#sameChain(chain);
        });
        this.#gate(); await this.#sameChain(chain);
        const digest = createHash("sha256").update(bytes).digest("hex"); resultCopy = Buffer.from(bytes);
        return { bytes: resultCopy, fingerprint: createHash("sha256").update(`${before.dev}\0${before.ino}\0${before.birthtimeNs}\0${digest}`).digest("hex") };
      } finally { bytes.fill(0); }
    });
    return result.catch(() => { resultCopy?.fill(0); throw unsafe(); });
  }
}
