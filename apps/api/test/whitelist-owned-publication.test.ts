import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AuthCoreError } from "../src/auth/password.js";
import { WhitelistEnvelopeAclAction } from "../src/services/whitelist-envelope-acl.js";
import type { WhitelistGuardPublication, WhitelistOwnedGuardAccess, WhitelistOwnedWideGuardAccess } from "../src/services/whitelist-owned-publication.js";
import type { ManagerLifetimeLock } from "../src/auth/manager-lifetime-lock.js";
import { WhitelistGuardStore } from "../src/services/whitelist-guard-store.js";
import { SyntheticRuntime } from "./whitelist-synthetic-fixture.js";

const chunkRelative = (index: number) => `${directory}/${String(index).padStart(2, "0")}.bin`;

const id = "12345678-1234-4234-8234-123456789abc", directory = `whitelist-guards/${id}`, relative = `${directory}/00.bin`;
const sid = "S-1-5-21-1-2-3-1001";
const snapshot = () => ({ userSid: sid, ownerSid: sid, protected: true, aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 0 }] });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
interface Node { id: bigint; dir: boolean; bytes: Buffer; links: bigint; version: bigint; symlink?: boolean }
function fixture(withDirectories = true) {
  const root = path.resolve("isolated-owned-publication-fixture"), nodes = new Map<string, Node>(); let nextId = 0n;
  const add = (file: string, dir: boolean, bytes = Buffer.alloc(0)) => { const node = { id: ++nextId, dir, bytes: Buffer.from(bytes), links: 1n, version: 1n }; nodes.set(file, node); return node; };
  const absolute = (file: string) => path.join(root, ...file.split("/"));
  add(root, true); if (withDirectories) { add(absolute("whitelist-guards"), true); add(absolute(directory), true); }
  const info = (node: Node): BigIntStats => ({ dev: 1n, ino: node.id, birthtimeNs: node.id, size: BigInt(node.bytes.length),
    mtimeNs: node.version, ctimeNs: node.version, nlink: node.links, isFile: () => !node.dir, isDirectory: () => node.dir, isSymbolicLink: () => node.symlink === true } as BigIntStats);
  const lookup = (file: string) => { const node = nodes.get(file); if (!node) throw Object.assign(new Error("FIXED_MISSING"), { code: "ENOENT" }); return node; };
  const state = { tick: 0, mutation: false, activities: 0, leases: 0, releases: 0,
    openGate: undefined as ReturnType<typeof deferred> | undefined, writeGate: undefined as ReturnType<typeof deferred> | undefined,
    syncGate: undefined as ReturnType<typeof deferred> | undefined, closeGate: undefined as ReturnType<typeof deferred> | undefined,
    closeFails: false, openFails: false, corruptSnapshot: false, writerUnknown: false, collideOnMove: false,
    writeReference: undefined as Buffer | undefined,
    groupFailCreateAt: undefined as number | undefined, groupFailMoveAt: undefined as number | undefined,
    groupGate: undefined as ReturnType<typeof deferred> | undefined, groupPauseAfter: undefined as number | undefined,
    groupPauseKind: undefined as "create" | "move" | undefined, peakHandles: 0,
    closeFailAt: undefined as string | undefined };
  const trace: string[] = [], handles = new Set<object>();
  const owner = {
    assertHeld: (file: string) => { if (file !== root) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE"); }, rootIdentity: () => "a".repeat(64),
    beginActivity: () => { state.activities++; return () => { state.activities--; }; },
    beginOfflineMutation: () => { if (state.mutation) throw new AuthCoreError("AUTH_BUSY"); state.mutation = true; state.leases++; return () => { state.mutation = false; state.releases++; }; },
    nativeAclChildWrapper: () => (script: string) => { expect(state.mutation).toBe(true); return "OWNED\n" + script; },
  };
  const sessionFactory = vi.fn(() => {
    const session = { closedConfirmed: false, get healthyForRotation() { return !session.closedConfirmed; },
      query: vi.fn(async (files: readonly string[]) => files.map(() => snapshot())),
      close: vi.fn(async () => { session.closedConfirmed = true; trace.push("acl-close"); }) };
    return session;
  });
  const io = {
    stat: vi.fn(async (file: string) => info(lookup(file))), realpath: vi.fn(async (file: string) => file),
    list: vi.fn(async (file: string) => [...nodes.keys()].filter((name) => path.dirname(name) === file).map((name) => path.basename(name))),
    open: vi.fn(async (file: string, mode: "r" | "r+") => {
      trace.push("open-" + mode); if (state.openFails) throw new Error("PRIVATE_OPEN");
      const node = lookup(file), handle = {
        stat: async () => info(node),
        read: async (bytes: Buffer, offset: number, length: number, position: number) => node.bytes.copy(bytes, offset, position, position + length),
        write: async (bytes: Buffer) => { trace.push("write-start"); state.writeReference = bytes; await state.writeGate?.promise;
          node.bytes = Buffer.from(bytes); node.version++; trace.push("write-end"); },
        sync: async () => { trace.push("sync"); await state.syncGate?.promise; },
        close: async () => { trace.push("close"); await state.closeGate?.promise; if (state.closeFails || state.closeFailAt === file) throw new Error("PRIVATE_CLOSE"); handles.delete(handle); },
      };
      handles.add(handle); state.peakHandles = Math.max(state.peakHandles, handles.size); await state.openGate?.promise; return handle;
    }),
  };
  const writerFactory = vi.fn((wrapper: (script: string) => string) => {
    const writer = { closedConfirmed: false, closeEvidence: { actualClose: false, exitCode: null as number | null, exitSignal: null as string | null },
      run: vi.fn(async (script: string): Promise<unknown> => {
        expect(wrapper(script)).toBe("OWNED\n" + script);
        // Fixed payload parser, not script execution; all paths/data are synthetic.
        const files = [...script.matchAll(/FromBase64String\('([^']+)'\)/gu)].map((m) => Buffer.from(m[1]!, "base64").toString("utf8"));
        try {
          if (script.includes("$indices=@(")) {
            const indices = script.match(/\$indices=@\(([0-9,]+)\)/u)![1]!.split(",").map(Number);
            const create = script.includes("[AuthPrivateNative]::Create($stage,$false)");
            trace.push(create ? "native-group-create" : "native-group-move");
            const entries = [];
            for (const index of indices) {
              const target = path.join(files[0]!, `${String(index).padStart(2, "0")}.bin`), stage = target + ".stage";
              if (index === (create ? state.groupFailCreateAt : state.groupFailMoveAt)) throw new Error("FIXED_GROUP_ITEM_FAILURE");
              if (create) {
                if (nodes.has(stage)) throw new Error("FIXED_COLLISION"); add(stage, false);
                const value = { ...snapshot(), aces: [sid, "S-1-5-18", "S-1-5-32-544"].map((principal) => ({ sid: principal, kind: "allow", mask: 0x1f01ff, flags: 0 })) };
                entries.push({ index, snapshot: value });
              } else {
                if (nodes.has(target)) throw new Error("FIXED_COLLISION"); const node = lookup(stage); nodes.delete(stage); nodes.set(target, node); entries.push({ index });
              }
              if (index === state.groupPauseAfter && (!state.groupPauseKind || state.groupPauseKind === (create ? "create" : "move"))) await state.groupGate?.promise;
            }
            return { ok: true, entries };
          }
          if (script.includes("[AuthPrivateNative]::Create(")) {
            trace.push("native-create"); if (nodes.has(files[0]!)) throw new Error("FIXED_COLLISION");
            add(files[0]!, script.includes("::Create($target,$true)"));
          } else {
            trace.push("native-move"); if (state.collideOnMove) add(files[1]!, false, Buffer.from("existing"));
            if (nodes.has(files[1]!)) throw new Error("FIXED_COLLISION"); const node = lookup(files[0]!); nodes.delete(files[0]!); nodes.set(files[1]!, node);
          }
          return { ok: true, snapshot: state.corruptSnapshot ? { ...snapshot(), protected: false } : snapshot() };
        } finally {
          if (!state.writerUnknown) { writer.closedConfirmed = true; writer.closeEvidence = { actualClose: true, exitCode: 0, exitSignal: null }; }
        }
      }), close: vi.fn(async () => { if (!state.writerUnknown) writer.closedConfirmed = true; }),
    };
    return writer;
  });
  const action = new WhitelistEnvelopeAclAction(owner, root, sessionFactory, () => state.tick, 262_144, { io, writer: writerFactory });
  const storageAction = WhitelistEnvelopeAclAction.guardStoreExecutor(owner as unknown as ManagerLifetimeLock, root,
    { sessionFactory, publication: { io, writer: writerFactory } }, true);
  return { root, owner, state, action, storageAction, nodes, absolute, add, trace, handles, io, writerFactory, sessionFactory,
    read: <T>(body: (access: WhitelistOwnedWideGuardAccess) => Promise<T>) =>
      storageAction.run(performance.now() + 50_000, (access) => body(access as WhitelistOwnedWideGuardAccess)),
    grouped: <T>(body: Parameters<typeof action.runGroupedPublication<T>>[1], deadline = 100_000) => action.runGroupedPublication(deadline, body),
    wide: <T>(body: Parameters<typeof action.runWideGroupedPublication<T>>[1], deadline = 100_000) => action.runWideGroupedPublication(deadline, body),
    run: <T>(body: Parameters<typeof action.runPublication<T>>[1], deadline = 100_000) => action.runPublication(deadline, body) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("reads six stored chunks with two8-target ACL queries, six held descriptors and original fingerprints", async () => {
  const f = fixture(), held: number[] = [], factory = f.sessionFactory.getMockImplementation()!;
  for (let i = 0; i < 6; i++) f.add(f.absolute(chunkRelative(i)), false, Buffer.alloc(4096, i + 1));
  f.sessionFactory.mockImplementation(() => { const session = factory(); session.query.mockImplementation(async (files) => {
    held.push(f.handles.size); return files.map(() => snapshot());
  }); return session; });
  const rows = await f.read(async (access) => {
    expect(Object.keys(access)).toEqual(["createDirectory", "publishFile", "directoryIdentity", "listDirectory", "readFile", "publishChunkGroup", "readChunkBatch"]);
    expect(Object.isFrozen(access)).toBe(true); return access.readChunkBatch(directory, 0, 6);
  });
  expect(held).toEqual([0, 6]); expect(f.state.peakHandles).toBe(6); expect(f.handles.size).toBe(0);
  expect(Object.isFrozen(rows)).toBe(true); expect(queries(f).map((files) => files.length)).toEqual([8, 8]);
  for (let i = 0; i < 6; i++) {
    const node = f.nodes.get(f.absolute(chunkRelative(i)))!, digest = createHash("sha256").update(node.bytes).digest("hex");
    expect(rows[i]).toEqual({ index: i, bytes: node.bytes,
      fingerprint: createHash("sha256").update(`1\0${node.id}\0${node.id}\0${digest}`).digest("hex") });
    expect(Object.isFrozen(rows[i])).toBe(true); rows[i]!.bytes.fill(0); expect(node.bytes.every((b) => b === i + 1)).toBe(true);
  }
  expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.storageAction.diagnostic).toMatchObject({ phase: "released", primary: null, resourceCount: 0 });
});
it.each([[0, 0], [0, 7], [-1, 1], [64, 1], [63, 2], [0.5, 1], [0, 1.5], [NaN, 1], [0, Infinity]])("rejects stored batch bounds %s/%s before I/O", async (start, count) => {
  const f = fixture(); await expect(f.read((access) => access.readChunkBatch(directory, start, count)))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.stat).not.toHaveBeenCalled(); expect(f.io.open).not.toHaveBeenCalled(); expect(f.writerFactory).not.toHaveBeenCalled();
});
it.each(["whitelist-guards", relative, `${directory}/manifest.json`, `${directory}/../other`, "C:/outside"])("rejects stored batch directory %s without I/O", async (where) => {
  const f = fixture(); await expect(f.read((access) => access.readChunkBatch(where, 0, 1))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.stat).not.toHaveBeenCalled(); expect(f.io.open).not.toHaveBeenCalled();
});
it.each(["before", "after"] as const)("rejects same-inode version drift at cohort ACL-%s", async (phase) => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!; let calls = 0;
  for (let i = 0; i < 6; i++) f.add(f.absolute(chunkRelative(i)), false, Buffer.from("kept"));
  f.sessionFactory.mockImplementation(() => { const session = factory(); session.query.mockImplementation(async (files) => {
    if (++calls === (phase === "before" ? 1 : 2)) f.nodes.get(f.absolute(relative))!.version++;
    return files.map(() => snapshot());
  }); return session; });
  await expect(f.read((access) => access.readChunkBatch(directory, 0, 6))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.open).toHaveBeenCalledTimes(phase === "before" ? 0 : 6); expect(f.handles.size).toBe(0);
});
it.each(["root", "namespace", "directory", "identity", "link", "symlink", "parent-acl", "sid"] as const)("rejects held-cohort %s drift with no native mutation", async (change) => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!; let calls = 0;
  for (let i = 0; i < 6; i++) f.add(f.absolute(chunkRelative(i)), false, Buffer.from("kept"));
  f.sessionFactory.mockImplementation(() => { const session = factory(); session.query.mockImplementation(async (files) => {
    if (++calls === 2) {
      expect(f.handles.size).toBe(6);
      if (change === "root") f.nodes.get(f.root)!.id += 100n;
      else if (change === "namespace") f.nodes.get(f.absolute("whitelist-guards"))!.id += 100n;
      else if (change === "directory") f.nodes.get(f.absolute(directory))!.id += 100n;
      else if (change === "identity") f.nodes.get(f.absolute(relative))!.id += 100n;
      else if (change === "link") f.nodes.get(f.absolute(relative))!.links = 2n;
      else if (change === "symlink") f.nodes.get(f.absolute(relative))!.symlink = true;
      else if (change === "parent-acl") return files.map((_, i) => i === 0 ? { ...snapshot(), protected: false } : snapshot());
      else return files.map(() => ({ ...snapshot(), userSid: "S-1-5-21-4-5-6-1001" }));
    }
    return files.map(() => snapshot());
  }); return session; });
  await expect(f.read((access) => access.readChunkBatch(directory, 0, 6))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(calls).toBe(2); expect(f.handles.size).toBe(0); expect(f.writerFactory).not.toHaveBeenCalled();
});
it.each([0, 3, 5])("attempts all descriptor closes when stored batch close%d rejects and retains ownership", async (index) => {
  const f = fixture(); for (let i = 0; i < 6; i++) f.add(f.absolute(chunkRelative(i)), false, Buffer.from("kept"));
  f.state.closeFailAt = f.absolute(chunkRelative(index));
  await expect(f.read((access) => access.readChunkBatch(directory, 0, 6))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.trace.filter((row) => row === "close")).toHaveLength(6); expect(f.handles.size).toBe(1);
  expect(f.storageAction.diagnostic?.phase).toBe("retained"); expect(f.state.releases).toBe(0);
});
it.each(["open", "read", "close"] as const)("retains raw stored %s work past50s and shared5s without returning buffers or dispatching new work", async (phase) => {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
  const f = fixture(), gate = deferred(), original = f.io.open.getMockImplementation()!; let destination: Buffer | undefined;
  for (let i = 0; i < 6; i++) f.add(f.absolute(chunkRelative(i)), false, Buffer.alloc(4096, 7));
  if (phase === "open") f.state.openGate = gate;
  else f.io.open.mockImplementation(async (file, mode) => {
    const handle = await original(file, mode); if (file !== f.absolute(chunkRelative(5))) return handle;
    return { ...handle, read: async (...args: Parameters<typeof handle.read>) => {
      destination = args[0]; if (phase === "read") { destination.fill(0x7f); await gate.promise; } return handle.read(...args);
    }, close: async () => { if (phase === "close") await gate.promise; await handle.close(); } };
  });
  const task = f.read(async (access) => { await access.readChunkBatch(directory, 0, 6); await access.createDirectory("whitelist-guards"); });
  const failed = expect(task).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(50000); await vi.advanceTimersByTimeAsync(5001); await failed;
  expect(f.state.releases).toBe(0); expect(f.writerFactory).not.toHaveBeenCalled();
  if (phase === "read") expect(destination!.every((b) => b === 0x7f)).toBe(true);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); expect(f.handles.size).toBe(0);
  if (destination) expect(destination.every((b) => b === 0)).toBe(true); expect(f.state.releases).toBe(0);
});
it("binds a captured batch reader and rejects escaped/caught failure facades without later I/O", async () => {
  const f = fixture(); f.add(f.absolute(chunkRelative(63)), false, Buffer.from("last")); let escaped!: WhitelistOwnedWideGuardAccess;
  const rows = await f.read(async (access) => { escaped = access; const read = access.readChunkBatch; return read(directory, 63, 1); });
  expect(rows[0]!.bytes.toString()).toBe("last"); rows[0]!.bytes.fill(0); const opened = f.io.open.mock.calls.length;
  await expect(escaped.readChunkBatch(directory, 63, 1)).rejects.toMatchObject({ code: "WHITELIST_PUBLICATION_UNSAFE" });
  expect(f.io.open).toHaveBeenCalledTimes(opened);
  const other = fixture(); await expect(other.read(async (access) => {
    await access.readChunkBatch(directory, 64, 1).catch(() => undefined); await access.publishFile(relative, Buffer.from("no"));
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" }); expect(other.writerFactory).not.toHaveBeenCalled();
});
it.each(["empty", "oversize", "hardlink", "symlink", "canonical", "short-read", "oversized-read"] as const)("rejects stored batch %s with exact fail-closed side effects", async (fault) => {
  const f = fixture(); for (let i = 0; i < 6; i++) f.add(f.absolute(chunkRelative(i)), false, Buffer.from("kept"));
  const node = f.nodes.get(f.absolute(relative))!;
  if (fault === "empty") node.bytes = Buffer.alloc(0);
  else if (fault === "oversize") node.bytes = Buffer.alloc(4097);
  else if (fault === "hardlink") node.links = 2n;
  else if (fault === "symlink") node.symlink = true;
  else if (fault === "canonical") f.io.realpath.mockImplementation(async (file) => file === f.absolute(relative) ? f.absolute(chunkRelative(1)) : file);
  else {
    const open = f.io.open.getMockImplementation()!;
    f.io.open.mockImplementation(async (file, mode) => ({ ...await open(file, mode), read: async () => fault === "short-read" ? 0 : 4097 }));
  }
  await expect(f.read((access) => access.readChunkBatch(directory, 0, 6))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.handles.size).toBe(0); expect(f.writerFactory).not.toHaveBeenCalled();
  expect(f.io.open).toHaveBeenCalledTimes(fault.endsWith("read") ? 1 : 0);
});
it("rejects an earlier held file changing during the last read and forbids overlapping methods", async () => {
  const f = fixture(), open = f.io.open.getMockImplementation()!;
  for (let i = 0; i < 6; i++) f.add(f.absolute(chunkRelative(i)), false, Buffer.from("kept"));
  f.io.open.mockImplementation(async (file, mode) => {
    const handle = await open(file, mode); return { ...handle, read: async (...args: Parameters<typeof handle.read>) => {
      if (file === f.absolute(chunkRelative(5))) { expect(f.handles.size).toBe(6); f.nodes.get(f.absolute(relative))!.version++; }
      return handle.read(...args);
    } };
  });
  await expect(f.read((access) => access.readChunkBatch(directory, 0, 6))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.handles.size).toBe(0);
  const other = fixture(), gate = deferred(); other.add(other.absolute(relative), false, Buffer.from("kept")); other.state.openGate = gate;
  const task = other.read(async (access) => {
    const pending = access.readChunkBatch(directory, 0, 1).catch(() => undefined);
    await vi.waitFor(() => expect(other.handles.size).toBe(1));
    await expect(access.listDirectory(directory)).rejects.toMatchObject({ code: "WHITELIST_PUBLICATION_UNSAFE" });
    gate.resolve(); await pending;
  });
  await expect(task).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" }); expect(other.handles.size).toBe(0); expect(other.writerFactory).not.toHaveBeenCalled();
});

it("publishes wide16 only through its separate trusted entry, bounded to six read handles and fifteen ACL queries", async () => {
  const f = fixture(), chunks = Array.from({ length: 16 }, (_, i) => Buffer.alloc(4096, i + 1));
  const result = await f.wide((pub) => pub.publishChunkGroup(directory, 48, chunks));
  expect(result).toHaveLength(16); expect(f.state.peakHandles).toBe(6); expect(f.handles.size).toBe(0);
  for (let i = 0; i < 16; i++) expect(f.nodes.get(f.absolute(chunkRelative(48 + i)))!.bytes).toEqual(chunks[i]);
  const calls = f.sessionFactory.mock.results.flatMap((row) => row.value.query.mock.calls);
  expect(calls).toHaveLength(15); expect(f.writerFactory).toHaveBeenCalledTimes(2);
  expect(f.action.diagnostic).toMatchObject({ phase: "released", primary: null, resourceCount: 0 });
  const original = fixture();
  await expect(original.grouped((pub) => pub.publishChunkGroup(directory, 0, chunks.slice(0, 9))))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(original.writerFactory).not.toHaveBeenCalled(); expect(original.io.stat).not.toHaveBeenCalled();
});
it.each(Array.from({ length: 16 }, (_, i) => i))("wide Create failure%d retains only created stages and forbids every later publication", async (stop) => {
  const f = fixture(); f.state.groupFailCreateAt = stop;
  await expect(f.wide(async (pub) => {
    await pub.publishChunkGroup(directory, 0, Array.from({ length: 16 }, () => Buffer.from("wide"))).catch(() => undefined);
    await pub.publishFile(`${directory}/manifest.json`, Buffer.from("no"));
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  for (let i = 0; i < 16; i++) expect(f.nodes.has(f.absolute(chunkRelative(i)) + ".stage")).toBe(i < stop);
  expect(f.io.open).not.toHaveBeenCalled(); expect(f.writerFactory).toHaveBeenCalledTimes(1);
  expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false);
});
it.each(Array.from({ length: 16 }, (_, i) => i))("wide Move failure%d preserves exact bytes on both sides without retry", async (stop) => {
  const f = fixture(); f.state.groupFailMoveAt = stop;
  await expect(f.wide((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 16 }, () => Buffer.from("wide")))))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  for (let i = 0; i < 16; i++) {
    const target = f.absolute(chunkRelative(i)); expect(f.nodes.has(target)).toBe(i < stop);
    expect(f.nodes.has(target + ".stage")).toBe(i >= stop); expect(f.nodes.get(i < stop ? target : target + ".stage")!.bytes.toString()).toBe("wide");
  }
  expect(f.writerFactory).toHaveBeenCalledTimes(2); expect(f.handles.size).toBe(0);
});
it.each(["stage", "target"] as const)("wide third-partition %s ACL-after cannot hide first-file identity drift", async (phase) => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!; let later = 0;
  const suffix = phase === "stage" ? ".stage" : "";
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); session.query.mockImplementation(async (files) => {
      if (files.length === 6 && files.at(-1) === f.absolute(chunkRelative(15)) + suffix && ++later === 2) f.nodes.get(f.absolute(chunkRelative(0)) + suffix)!.id += 100n;
      return files.map(() => snapshot());
    }); return session;
  });
  await expect(f.wide((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 16 }, () => Buffer.from("wide")))))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(later).toBe(2); expect(f.handles.size).toBe(0); expect(f.trace.filter((row) => row === "native-group-move")).toHaveLength(phase === "stage" ? 0 : 1);
});
it("wide final-partition pending raw read retains90112-byte-bounded task until actual settlement", async () => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred(), original = f.io.open.getMockImplementation()!; let destination: Buffer | undefined;
  f.io.open.mockImplementation(async (file, mode) => {
    const handle = await original(file, mode);
    if (mode !== "r" || file !== f.absolute(chunkRelative(15)) + ".stage") return handle;
    return { ...handle, read: async (...args: Parameters<typeof handle.read>) => {
      destination = args[0]; destination.fill(0x7f); await gate.promise; return handle.read(...args);
    } };
  });
  const task = f.wide((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 16 }, () => Buffer.alloc(4096, 1))), 100);
  const failed = expect(task).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(0); expect(destination).toHaveLength(4096); expect(f.handles.size).toBe(4); expect(f.state.peakHandles).toBe(6);
  f.state.tick = 100; await vi.advanceTimersByTimeAsync(100); f.state.tick = 5101; await vi.advanceTimersByTimeAsync(5001); await failed;
  expect(destination!.every((byte) => byte === 0x7f)).toBe(true); expect(f.state.writeReference!.every((byte) => byte === 1)).toBe(true); expect(f.state.releases).toBe(0);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); expect(destination!.every((byte) => byte === 0)).toBe(true);
  expect(f.state.writeReference!.every((byte) => byte === 0)).toBe(true); expect(f.handles.size).toBe(0);
  expect(f.io.open).toHaveBeenCalledTimes(32); expect(f.trace).not.toContain("native-group-move"); expect(f.state.releases).toBe(0);
});

it("publishes eight exact chunks with two finite native groups and no implicit manifest", async () => {
  const f = fixture(), chunks = Array.from({ length: 8 }, (_, i) => Buffer.alloc(4096, i + 1));
  const result = await f.grouped((pub) => {
    expect(Object.isFrozen(pub)).toBe(true); expect(Object.keys(pub)).toEqual(["createDirectory", "publishFile", "publishChunkGroup"]);
    return pub.publishChunkGroup(directory, 0, chunks);
  });
  expect(result).toEqual(chunks.map((bytes) => ({ sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length })));
  expect(Object.isFrozen(result)).toBe(true);
  for (let i = 0; i < chunks.length; i++) {
    expect(f.nodes.get(f.absolute(chunkRelative(i)))!.bytes).toEqual(chunks[i]); expect(f.nodes.has(f.absolute(chunkRelative(i)) + ".stage")).toBe(false);
  }
  expect(f.trace.filter((row) => row.startsWith("native-group"))).toEqual(["native-group-create", "native-group-move"]);
  expect(f.writerFactory).toHaveBeenCalledTimes(2); expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false);
  expect(f.handles.size).toBe(0); expect(f.action.diagnostic).toMatchObject({ phase: "released", resourceCount: 0, primary: null });
});
it("uses pinned collective six-plus-two ACL batches while holding every corresponding read handle", async () => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!; const held: number[] = [];
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); let pending = false;
    session.query.mockImplementation(async (files) => {
      if (files.length > 3) { if (pending) held.push(f.handles.size); pending = !pending; }
      return files.map(() => snapshot());
    }); return session;
  });
  await f.grouped((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.alloc(4096, 7))));
  expect(held).toEqual([6, 2, 6, 2]); expect(f.state.peakHandles).toBe(6); expect(f.handles.size).toBe(0);
  const all = f.sessionFactory.mock.results.flatMap((row) => row.value.query.mock.calls.map(([files]) => files));
  expect(all).toHaveLength(11); expect(all.filter((files) => files.length > 3).map((files) => files.length)).toEqual([8, 8, 4, 4, 8, 8, 4, 4]);
});
it.each(["stage", "target"] as const)("detects first-partition %s identity replacement during later-partition ACL-after", async (phase) => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!; let laterQueries = 0, held = 0;
  const suffix = phase === "stage" ? ".stage" : "";
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); session.query.mockImplementation(async (files) => {
      if (files.length === 4 && files.at(-1) === f.absolute(chunkRelative(7)) + suffix && ++laterQueries === 2) {
        held = f.handles.size; f.nodes.get(f.absolute(chunkRelative(0)) + suffix)!.id += 100n;
      }
      return files.map(() => snapshot());
    }); return session;
  });
  await expect(f.grouped((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("fixed")))))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(held).toBe(2); expect(f.handles.size).toBe(0);
  expect(f.trace.filter((row) => row === "native-group-move")).toHaveLength(phase === "stage" ? 0 : 1);
  expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false);
});
it.each(["stage", "target"] as const)("rejects same-inode %s version drift during its ACL-before query", async (phase) => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!; let mutated = false;
  const suffix = phase === "stage" ? ".stage" : "";
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); session.query.mockImplementation(async (files) => {
      if (!mutated && files.length === 8 && files.at(-1) === f.absolute(chunkRelative(5)) + suffix) {
        mutated = true; f.nodes.get(f.absolute(chunkRelative(0)) + suffix)!.version++;
      }
      return files.map(() => snapshot());
    }); return session;
  });
  await expect(f.grouped((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("fixed")))))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(mutated).toBe(true); expect(f.handles.size).toBe(0);
  expect(f.trace.filter((row) => row === "native-group-move")).toHaveLength(phase === "stage" ? 0 : 1);
});
it.each(["stage", "target"] as const)("refuses a stable new parent ACL baseline between %s partitions", async (phase) => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!; let changed = false;
  const suffix = phase === "stage" ? ".stage" : "";
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); session.query.mockImplementation(async (files) => {
      if (files.length === 4 && files.at(-1) === f.absolute(chunkRelative(7)) + suffix) changed = true;
      return files.map((_, index) => changed && index < 2 ? { ...snapshot(), aces: [...snapshot().aces, { sid: "S-1-5-18", kind: "allow", mask: 0x1f01ff, flags: 0 }] } : snapshot());
    }); return session;
  });
  await expect(f.grouped((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("fixed")))))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(changed).toBe(true); expect(f.handles.size).toBe(0);
  expect(f.trace.filter((row) => row === "native-group-move")).toHaveLength(phase === "stage" ? 0 : 1);
});
it.each([0, 3, 5])("attempts every remaining batch close if stage%d close rejects, retaining only uncertain ownership", async (index) => {
  const f = fixture(); let readPhase = false;
  const originalOpen = f.io.open.getMockImplementation()!;
  f.io.open.mockImplementation(async (file, mode) => {
    if (mode === "r") { readPhase = true; f.state.closeFailAt = f.absolute(chunkRelative(index)) + ".stage"; }
    return originalOpen(file, mode);
  });
  await expect(f.grouped((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("fixed")))))
    .rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(readPhase).toBe(true); expect(f.state.peakHandles).toBe(6); expect(f.handles.size).toBe(1);
  expect(f.state.releases).toBe(0); expect(f.trace).not.toContain("native-group-move");
});
it.each([0, 3, 5])("tracks a late returned read handle at batch index%d and closes it after revocation", async (index) => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred(), original = f.io.open.getMockImplementation()!;
  f.io.open.mockImplementation(async (file, mode) => {
    const handle = await original(file, mode);
    if (mode === "r" && file === f.absolute(chunkRelative(index)) + ".stage") await gate.promise;
    return handle;
  });
  const task = f.grouped((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("fixed"))), 100);
  const failed = expect(task).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  await vi.advanceTimersByTimeAsync(0); expect(f.handles.size).toBe(index + 1);
  f.state.tick = 100; await vi.advanceTimersByTimeAsync(100); expect(f.state.releases).toBe(0);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); await failed;
  expect(f.handles.size).toBe(0); expect(f.state.releases).toBe(1); expect(f.trace).not.toContain("native-group-move");
});
it.each([0, 3, 5])("holds group bytes and owner while batch index%d read close outlives cleanup", async (index) => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred(), original = f.io.open.getMockImplementation()!; let closing = false;
  f.io.open.mockImplementation(async (file, mode) => {
    const handle = await original(file, mode);
    if (mode !== "r" || file !== f.absolute(chunkRelative(index)) + ".stage") return handle;
    return { ...handle, close: async () => { closing = true; await gate.promise; await handle.close(); } };
  });
  const task = f.grouped((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("still-owned"))), 100);
  const failed = expect(task).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(0); expect(closing).toBe(true); expect(f.state.peakHandles).toBe(6);
  f.state.tick = 100; await vi.advanceTimersByTimeAsync(100); f.state.tick = 5101; await vi.advanceTimersByTimeAsync(5001); await failed;
  expect(f.state.releases).toBe(0); expect(f.state.writeReference!.toString()).toBe("still-owned");
  gate.resolve(); await vi.advanceTimersByTimeAsync(0);
  expect(f.handles.size).toBe(0); expect(f.state.writeReference!.every((byte) => byte === 0)).toBe(true);
  expect(f.state.releases).toBe(0); expect(f.action.diagnostic.phase).toBe("retained"); expect(f.trace).not.toContain("native-group-move");
});
it.each([0, 5, 7])("retains pending raw read buffer at index%d through timeout and shared cleanup", async (index) => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred(), original = f.io.open.getMockImplementation()!;
  let destination: Buffer | undefined;
  f.io.open.mockImplementation(async (file, mode) => {
    const handle = await original(file, mode);
    if (mode !== "r" || file !== f.absolute(chunkRelative(index)) + ".stage") return handle;
    return { ...handle, read: async (...args: Parameters<typeof handle.read>) => {
      destination = args[0]; destination.fill(0x7f); await gate.promise; return handle.read(...args);
    } };
  });
  const task = f.grouped((pub) => pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("owned"))), 100);
  const failed = expect(task).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(0); expect(destination).toBeDefined(); expect(f.handles.size).toBe(index === 7 ? 2 : index + 1);
  const reads = () => f.sessionFactory.mock.results.flatMap((row) => row.value.query.mock.calls.map(([files]) => files)).filter((files) => files.length > 3);
  expect(reads()).toHaveLength(index === 7 ? 3 : 1);
  f.state.tick = 100; await vi.advanceTimersByTimeAsync(100); f.state.tick = 5101; await vi.advanceTimersByTimeAsync(5001); await failed;
  expect(destination!.every((byte) => byte === 0x7f)).toBe(true); expect(f.state.writeReference!.toString()).toBe("owned"); expect(f.state.releases).toBe(0);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0);
  expect(destination!.every((byte) => byte === 0)).toBe(true); expect(f.state.writeReference!.every((byte) => byte === 0)).toBe(true);
  expect(f.handles.size).toBe(0); expect(f.io.open).toHaveBeenCalledTimes(8 + index + 1); expect(reads()).toHaveLength(index === 7 ? 3 : 1);
  expect(f.state.releases).toBe(0); expect(f.action.diagnostic.phase).toBe("retained"); expect(f.trace).not.toContain("native-group-move");
});
it.each(Array.from({ length: 8 }, (_, i) => i))("preserves partial creation at item%d without Node writes, next group or manifest", async (stop) => {
  const f = fixture(); f.state.groupFailCreateAt = stop;
  await expect(f.grouped(async (pub) => {
    await pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("fixed"))).catch(() => undefined);
    await pub.publishFile(`${directory}/manifest.json`, Buffer.from("must-not-publish"));
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.writerFactory).toHaveBeenCalledTimes(1); expect(f.io.open).not.toHaveBeenCalled();
  for (let i = 0; i < 8; i++) {
    expect(f.nodes.has(f.absolute(chunkRelative(i)))).toBe(false);
    expect(f.nodes.has(f.absolute(chunkRelative(i)) + ".stage")).toBe(i < stop);
  }
  expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false); expect(f.state.releases).toBe(1);
});
it.each(Array.from({ length: 8 }, (_, i) => i))("preserves both sides of a partial move at item%d, with no retry or manifest", async (stop) => {
  const f = fixture(); f.state.groupFailMoveAt = stop;
  await expect(f.grouped(async (pub) => {
    await pub.publishChunkGroup(directory, 0, Array.from({ length: 8 }, () => Buffer.from("exact-chunk"))).catch(() => undefined);
    await pub.publishChunkGroup(directory, 8, [Buffer.from("no-next-group")]);
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.writerFactory).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 8; i++) {
    const target = f.absolute(chunkRelative(i)); expect(f.nodes.has(target)).toBe(i < stop); expect(f.nodes.has(target + ".stage")).toBe(i >= stop);
    expect(f.nodes.get(i < stop ? target : target + ".stage")!.bytes.toString()).toBe("exact-chunk");
  }
  expect(f.handles.size).toBe(0); expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false);
});
it("captures all group bytes synchronously and wipes only after actual raw writes finish", async () => {
  const f = fixture(), gate = deferred(); f.state.writeGate = gate;
  const originals = [Buffer.from("first"), Buffer.from("second")], expected = originals.map((b) => Buffer.from(b));
  const result = f.grouped((pub) => { const task = pub.publishChunkGroup(directory, 0, originals); originals.forEach((b) => b.fill(0)); return task; });
  await vi.waitFor(() => expect(f.state.writeReference).toBeDefined()); expect(f.state.writeReference).toEqual(expected[0]);
  expect(f.state.releases).toBe(0); gate.resolve(); await result;
  expect(f.nodes.get(f.absolute(chunkRelative(0)))!.bytes).toEqual(expected[0]); expect(f.nodes.get(f.absolute(chunkRelative(1)))!.bytes).toEqual(expected[1]);
  expect(f.state.writeReference!.every((byte) => byte === 0)).toBe(true);
});
it.each(["open", "write", "sync", "close"])("group deadline during %s closes only exact handles and prevents move/next item", async (phase) => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred();
  if (phase === "open") f.state.openGate = gate; else if (phase === "write") f.state.writeGate = gate;
  else if (phase === "sync") f.state.syncGate = gate; else f.state.closeGate = gate;
  const task = f.grouped((pub) => pub.publishChunkGroup(directory, 0, [Buffer.from("one"), Buffer.from("two")]), 100);
  const failed = expect(task).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  await vi.advanceTimersByTimeAsync(0); expect(f.handles.size).toBe(1);
  f.state.tick = 100; await vi.advanceTimersByTimeAsync(100); expect(f.state.releases).toBe(0);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); await failed;
  expect(f.io.open).toHaveBeenCalledTimes(1); expect(f.trace).not.toContain("native-group-move");
  expect(f.handles.size).toBe(0); expect(f.state.releases).toBe(1);
});
it("does not confuse in-flight finite native group work with admission of another group", async () => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred(); f.state.groupGate = gate; f.state.groupPauseAfter = 0;
  const task = f.grouped((pub) => pub.publishChunkGroup(directory, 0, [Buffer.from("one"), Buffer.from("two")]), 100);
  const failed = expect(task).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  await vi.advanceTimersByTimeAsync(0); expect(f.nodes.has(f.absolute(chunkRelative(0)) + ".stage")).toBe(true);
  f.state.tick = 100; await vi.advanceTimersByTimeAsync(100); expect(f.state.releases).toBe(0);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); await failed;
  // The already-dispatched finite fake loop may finish. It cannot return a success receipt or admit Node writes/Move.
  expect(f.nodes.has(f.absolute(chunkRelative(1)) + ".stage")).toBe(true); expect(f.writerFactory).toHaveBeenCalledTimes(1);
  expect(f.io.open).not.toHaveBeenCalled(); expect(f.state.releases).toBe(1);
});
it("rejects an overlong exact wrapped command before any group I/O or native factory", async () => {
  const f = fixture(); f.owner.nativeAclChildWrapper = () => () => "x".repeat(20000);
  await expect(f.grouped((pub) => pub.publishChunkGroup(directory, 0, [Buffer.from("fixed")])))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.stat).not.toHaveBeenCalled(); expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.io.open).not.toHaveBeenCalled();
});
it("rejects cancellation during already-issued Move even if that finite loop physically finishes", async () => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred(); f.state.groupGate = gate; f.state.groupPauseAfter = 0; f.state.groupPauseKind = "move";
  const task = f.grouped(async (pub) => {
    await pub.publishChunkGroup(directory, 0, [Buffer.from("first"), Buffer.from("second")]).catch(() => undefined);
    await pub.publishFile(`${directory}/manifest.json`, Buffer.from("no-manifest"));
  }, 100);
  const failed = expect(task).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  await vi.advanceTimersByTimeAsync(0); expect(f.nodes.has(f.absolute(chunkRelative(0)))).toBe(true);
  expect(f.nodes.has(f.absolute(chunkRelative(1)) + ".stage")).toBe(true);
  f.state.tick = 100; await vi.advanceTimersByTimeAsync(100); expect(f.state.releases).toBe(0);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); await failed;
  expect(f.nodes.get(f.absolute(chunkRelative(1)))!.bytes.toString()).toBe("second");
  expect(f.writerFactory).toHaveBeenCalledTimes(2); expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false);
  expect(f.handles.size).toBe(0); expect(f.state.releases).toBe(1);
});
it("retains owner and bytes when a grouped write outlives the shared cleanup deadline", async () => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred(); f.state.writeGate = gate;
  const task = f.grouped((pub) => pub.publishChunkGroup(directory, 0, [Buffer.from("retained"), Buffer.from("second")]), 100);
  const failed = expect(task).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(0); f.state.tick = 100; await vi.advanceTimersByTimeAsync(100);
  f.state.tick = 5101; await vi.advanceTimersByTimeAsync(5001); await failed;
  expect(f.state.writeReference!.toString()).toBe("retained"); expect(f.state.releases).toBe(0);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); expect(f.state.writeReference!.every((b) => b === 0)).toBe(true);
  expect(f.action.diagnostic.phase).toBe("retained"); expect(f.trace).not.toContain("native-group-move");
});
it("requires actual child close for the entire creation group before descriptor writes", async () => {
  const f = fixture(); f.state.writerUnknown = true;
  await expect(f.grouped((pub) => pub.publishChunkGroup(directory, 0, [Buffer.from("fixed")]))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.io.open).not.toHaveBeenCalled(); expect(f.state.releases).toBe(0);
});
it("rejects collisions and malformed groups before the first native mutation", async () => {
  const collision = fixture(); collision.add(collision.absolute(chunkRelative(1)), false, Buffer.from("preserve"));
  await expect(collision.grouped((pub) => pub.publishChunkGroup(directory, 0, [Buffer.from("one"), Buffer.from("two")])))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(collision.writerFactory).not.toHaveBeenCalled(); expect(collision.nodes.get(collision.absolute(chunkRelative(1)))!.bytes.toString()).toBe("preserve");
  const malformed = fixture();
  await expect(malformed.grouped((pub) => pub.publishChunkGroup(directory, 63, [Buffer.from("one"), Buffer.from("two")])))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(malformed.io.stat).not.toHaveBeenCalled(); expect(malformed.writerFactory).not.toHaveBeenCalled();
});

it("creates private guard directories and publishes a complete exact-byte file under one lease", async () => {
  const f = fixture(false), original = Buffer.from("synthetic-whitelist-data");
  await expect(f.run(async (pub) => {
    expect(Object.isFrozen(pub)).toBe(true); expect(Object.keys(pub)).toEqual(["createDirectory", "publishFile"]);
    await pub.createDirectory("whitelist-guards"); await pub.createDirectory(directory); return pub.publishFile(relative, original);
  })).resolves.toEqual({ sha256: createHash("sha256").update(original).digest("hex"), byteLength: original.length });
  expect(f.nodes.get(f.absolute(relative))!.bytes).toEqual(original); expect(f.nodes.has(f.absolute(relative) + ".stage")).toBe(false);
  expect(f.state).toMatchObject({ leases: 1, releases: 1, mutation: false, activities: 0 });
  expect(f.handles.size).toBe(0); expect(f.action.diagnostic.resourceCount).toBe(0); expect(f.writerFactory).toHaveBeenCalledTimes(4);
  for (let i = 0; i < f.trace.length; i++) if (f.trace[i] === "native-move") expect(f.trace.slice(0, i)).toContain("acl-close");
});

const ownedStore = (f: ReturnType<typeof fixture>) => WhitelistGuardStore.openOwned(f.root, f.owner as unknown as ManagerLifetimeLock,
  { sessionFactory: f.sessionFactory, publication: { io: f.io, writer: f.writerFactory } });
const wideStore = (f: ReturnType<typeof fixture>) => WhitelistGuardStore.openOwnedWide(f.root, f.owner as unknown as ManagerLifetimeLock,
  { sessionFactory: f.sessionFactory, publication: { io: f.io, writer: f.writerFactory } });
const source = () => { const snapshot = new SyntheticRuntime().snapshot(); return { snapshot, bytes: Buffer.from(JSON.stringify(snapshot.members)) }; };
const queries = (f: ReturnType<typeof fixture>) => f.sessionFactory.mock.results.flatMap((entry) => entry.value.query.mock.calls.map((call) => call[0]));

it.each(["count", "order", "index", "extra", "array", "buffer", "length", "fingerprint"] as const)("Store rejects malformed stored batch %s and wipes delivered buffers before any manifest", async (fault) => {
  const original = WhitelistEnvelopeAclAction.guardStoreExecutor;
  const captured: Buffer[] = [];
  vi.spyOn(WhitelistEnvelopeAclAction, "guardStoreExecutor").mockImplementation((...args) => {
    const executor = original(...args);
    return Object.freeze({ get diagnostic() { return executor.diagnostic; },
      run: <T>(deadline: number, body: (access: WhitelistOwnedGuardAccess) => Promise<T>) => executor.run(deadline, async (access) => {
        const wide = access as WhitelistOwnedWideGuardAccess, read = wide.readChunkBatch;
        return body(Object.freeze({ ...access, readChunkBatch: async (where: string, start: number, count: number) => {
          const rows = await read(where, start, count); captured.push(...rows.map((row) => row.bytes));
          let altered: unknown = rows;
          if (fault === "count") altered = rows.slice(1);
          else if (fault === "order") altered = [...rows].reverse();
          else {
            const first = rows[0]!;
            const changed = fault === "array" ? Object.assign([], first) : fault === "index" ? { ...first, index: first.index + 1 } : fault === "extra" ? { ...first, path: "forbidden" } :
              fault === "buffer" ? { ...first, bytes: new Uint8Array(first.bytes) } : fault === "length" ? { ...first, bytes: first.bytes.subarray(1) } :
                { ...first, fingerprint: "not-a-fingerprint" };
            altered = [changed, ...rows.slice(1)];
          }
          return altered as Awaited<ReturnType<WhitelistOwnedWideGuardAccess["readChunkBatch"]>>;
        } }));
      }) });
  });
  const f = fixture(false), before = source(), padded = Buffer.concat([before.bytes, Buffer.alloc(24576 - before.bytes.length, 0x20)]);
  const snapshot = { ...before.snapshot, fileSha256: createHash("sha256").update(padded).digest("hex") }, store = await wideStore(f);
  try {
    await expect(store.create(id, snapshot, padded)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
    expect(captured).toHaveLength(6);
    // A deliberately omitted/replaced Buffer remains owned by this injecting fixture.
    const delivered = fault === "count" || fault === "buffer" ? captured.slice(1) : fault === "length" ? captured.slice(1) : captured;
    expect(delivered.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false); expect(f.handles.size).toBe(0);
    const calls = f.writerFactory.mock.calls.length;
    await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" }); expect(f.writerFactory).toHaveBeenCalledTimes(calls);
  } finally { for (const bytes of captured) bytes.fill(0); }
});

it("creates a complete256KiB wide Guard through four groups, then one manifest and unchanged full verification", async () => {
  const f = fixture(false), before = source(), padded = Buffer.concat([before.bytes, Buffer.alloc(262144 - before.bytes.length, 0x20)]);
  const snapshot = { ...before.snapshot, fileSha256: createHash("sha256").update(padded).digest("hex") }, store = await wideStore(f);
  const receipt = await store.create(id, snapshot, padded); expect(receipt.snapshot).toEqual(snapshot);
  const chunks = Array.from({ length: 64 }, (_, i) => f.nodes.get(f.absolute(chunkRelative(i)))!.bytes);
  expect(Buffer.concat(chunks)).toEqual(padded); expect(await store.verify(id)).toEqual(receipt);
  expect(await store.scan()).toEqual([{ operationId: id, ...receipt }]);
  expect(f.writerFactory).toHaveBeenCalledTimes(12); expect(f.trace.filter((row) => row === "native-group-create")).toHaveLength(4);
  expect(f.trace.filter((row) => row === "native-group-move")).toHaveLength(4); expect(f.trace.at(-1)).not.toBe("native-group-move");
  const lastGroup = f.trace.lastIndexOf("native-group-move"), manifest = f.trace.lastIndexOf("native-create"); expect(manifest).toBeGreaterThan(lastGroup);
  expect(f.nodes.has(f.absolute(`${directory}/manifest.json.stage`))).toBe(false); expect(f.handles.size).toBe(0);
  expect(f.state).toMatchObject({ leases: 4, releases: 4, mutation: false, activities: 0 });
  const reopened = await wideStore(f); expect(await reopened.verify(id)).toEqual(receipt);
});
it("preserves the first group and second partial stages on wide Store item17 failure without manifest", async () => {
  const f = fixture(false), before = source(), padded = Buffer.concat([before.bytes, Buffer.alloc(262144 - before.bytes.length, 0x20)]);
  const snapshot = { ...before.snapshot, fileSha256: createHash("sha256").update(padded).digest("hex") }, store = await wideStore(f);
  f.state.groupFailCreateAt = 17;
  await expect(store.create(id, snapshot, padded)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  for (let i = 0; i < 16; i++) expect(f.nodes.get(f.absolute(chunkRelative(i)))!.bytes).toEqual(padded.subarray(i * 4096, (i + 1) * 4096));
  expect(f.nodes.get(f.absolute(chunkRelative(16)) + ".stage")!.bytes).toHaveLength(0);
  expect(f.nodes.has(f.absolute(chunkRelative(17)) + ".stage")).toBe(false); expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false);
  const count = f.writerFactory.mock.calls.length; await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.writerFactory).toHaveBeenCalledTimes(count); expect(count).toBe(5);
});
it("does not use a group receipt in place of original Store physical read and known fingerprints", async () => {
  const f = fixture(false), before = source(), factory = f.sessionFactory.getMockImplementation()!; let mutated = false, calls = 0;
  const padded = Buffer.concat([before.bytes, Buffer.alloc(65536 - before.bytes.length, 0x20)]);
  const captured = { ...before.snapshot, fileSha256: createHash("sha256").update(padded).digest("hex") };
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); session.query.mockImplementation(async (files) => {
      if (!mutated && files.length === 8 && files.at(-1) === f.absolute(chunkRelative(5)) && f.nodes.has(f.absolute(relative)) && ++calls === 3) {
        mutated = true; f.nodes.get(f.absolute(relative))!.bytes = Buffer.from("changed"); f.nodes.get(f.absolute(relative))!.version++;
      }
      return files.map(() => snapshot());
    }); return session;
  });
  const store = await wideStore(f);
  await expect(store.create(id, captured, padded)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(mutated).toBe(true); expect(f.nodes.get(f.absolute(relative))!.bytes.toString()).toBe("changed");
  expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false); expect(f.handles.size).toBe(0);
});
it("copies caller bytes before a wide Store action and retains the publication copy through late write cleanup", async () => {
  const f = fixture(false), before = source(), store = await wideStore(f), original = Buffer.from(before.bytes), expected = Buffer.from(original);
  const gate = deferred(); f.state.writeGate = gate;
  const task = store.create(id, before.snapshot, original); original.fill(0);
  await vi.waitFor(() => expect(f.state.writeReference).toBeDefined()); expect(f.state.writeReference).toEqual(expected);
  gate.resolve(); expect((await task).snapshot).toEqual(before.snapshot);
  expect(f.nodes.get(f.absolute(relative))!.bytes).toEqual(expected); expect(f.state.writeReference!.every((byte) => byte === 0)).toBe(true);
});
it("keeps wide Store quarantined if raw write outlives its original50s action and shared cleanup", async () => {
  const f = fixture(false), before = source(), store = await wideStore(f);
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] }); const gate = deferred(); f.state.writeGate = gate;
  const task = store.create(id, before.snapshot, before.bytes), failed = expect(task).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  await vi.advanceTimersByTimeAsync(0); expect(f.state.writeReference).toBeDefined(); const releases = f.state.releases;
  await vi.advanceTimersByTimeAsync(50000); await vi.advanceTimersByTimeAsync(5001); await failed;
  expect(f.state.releases).toBe(releases); expect(f.state.writeReference).toEqual(before.bytes); expect(store.ownedDiagnostic?.phase).toBe("retained");
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); expect(f.handles.size).toBe(0); expect(f.state.writeReference!.every((byte) => byte === 0)).toBe(true);
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" }); expect(f.nodes.has(f.absolute(`${directory}/manifest.json`))).toBe(false);
});
it("preserves wide Store conflict and rejects unsafe ACL without attaching usable legacy helpers", async () => {
  const f = fixture(false), before = source(), factory = f.sessionFactory.getMockImplementation()!; let changed = false;
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); session.query.mockImplementation(async (files) => files.map(() => changed ? { ...snapshot(), protected: false } : snapshot())); return session;
  });
  const store = await wideStore(f); await store.create(id, before.snapshot, before.bytes);
  await expect(store.create(id, before.snapshot, before.bytes)).rejects.toMatchObject({ code: "WHITELIST_GUARD_CONFLICT" });
  await expect(store.publication.createDirectory(f.absolute("whitelist-guards"))).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.state.leases).toBe(f.state.releases); changed = true;
  await expect(store.verify(id)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" }); expect(f.handles.size).toBe(0);
});
it.each(["root", "namespace", "sid", "known-file", "extra-stage"] as const)("wide Store rejects %s drift across actions while preserving files", async (change) => {
  const f = fixture(false), before = source(), factory = f.sessionFactory.getMockImplementation()!; let changedSid = false;
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); session.query.mockImplementation(async (files) => files.map(() => {
      if (!changedSid) return snapshot(); const other = "S-1-5-21-4-5-6-1001";
      return { userSid: other, ownerSid: other, protected: true, aces: [{ sid: other, kind: "allow", mask: 0x1f01ff, flags: 0 }] };
    })); return session;
  });
  const store = await wideStore(f); await store.create(id, before.snapshot, before.bytes);
  if (change === "root") f.nodes.get(f.root)!.id += 100n;
  else if (change === "namespace") f.nodes.get(f.absolute("whitelist-guards"))!.id += 100n;
  else if (change === "sid") changedSid = true;
  else if (change === "known-file") f.nodes.get(f.absolute(relative))!.id += 100n;
  else f.add(f.absolute(relative) + ".stage", false, Buffer.from("preserve"));
  const native = f.writerFactory.mock.calls.length;
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.writerFactory).toHaveBeenCalledTimes(native); expect(f.nodes.get(f.absolute(relative))!.bytes).toEqual(before.bytes);
  expect(f.handles.size).toBe(0); expect(f.state.leases).toBe(f.state.releases);
});

it("opens and creates/verifies/reopens an owned guard without nested mutation locks or the legacy publication path", async () => {
  const f = fixture(false), before = source(), store = await ownedStore(f);
  expect(f.state.leases).toBe(1); expect(f.writerFactory).not.toHaveBeenCalled();
  const receipt = await store.create(id, before.snapshot, before.bytes);
  expect(receipt.snapshot).toEqual(before.snapshot); expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(await store.verify(id)).toEqual(receipt); expect(await store.scan()).toEqual([{ operationId: id, ...receipt }]);
  expect(f.state).toMatchObject({ leases: 4, releases: 4, mutation: false, activities: 0 }); expect(f.handles.size).toBe(0);
  const reopened = await ownedStore(f); expect(await reopened.verify(id)).toEqual(receipt);
  expect(f.nodes.get(f.absolute(relative))!.bytes).toEqual(before.bytes); expect(f.nodes.has(f.absolute(relative) + ".stage")).toBe(false);
});
it("preserves the exact two three-path batches per stored file and the full-action accounting formulas", async () => {
  const f = fixture(false), before = source(), store = await ownedStore(f);
  await store.create(id, before.snapshot, before.bytes); expect(queries(f)).toHaveLength(40);
  const start = queries(f).length; await store.verify(id); const actual = queries(f).slice(start);
  expect(actual).toHaveLength(8);
  for (const name of [relative, `${directory}/manifest.json`]) {
    expect(actual.filter((batch) => batch.at(-1) === f.absolute(name))).toEqual([
      [f.absolute("whitelist-guards"), f.absolute(directory), f.absolute(name)],
      [f.absolute("whitelist-guards"), f.absolute(directory), f.absolute(name)],
    ]);
  }
  // Source-bound arithmetic, not an assertion that a physical 65000-file scan completes in50s.
  const openQueries = 1000 * (65 * 2 + 4) + 4, createQueries = 999 * (65 * 2 + 4) + 4 + 2 + 65 * 13 + 130 + 130 + 4;
  expect(openQueries).toBe(134004); expect(createQueries).toBe(134981);
  expect(openQueries + Math.ceil(openQueries / 32) + 2).toBeLessThan(150000);
  expect(createQueries + Math.ceil(createQueries / 32) + 2 + 131).toBeLessThan(150000);
  expect(150000).toBeLessThan(262144);
});
it("returns guard conflict only after healthy release and leaves the same store reusable", async () => {
  const f = fixture(false), before = source(), store = await ownedStore(f); await store.create(id, before.snapshot, before.bytes);
  const native = f.writerFactory.mock.calls.length;
  await expect(store.create(id, before.snapshot, before.bytes)).rejects.toMatchObject({ code: "WHITELIST_GUARD_CONFLICT" });
  expect(f.writerFactory).toHaveBeenCalledTimes(native); expect(f.state.leases).toBe(f.state.releases);
  expect(await store.scan()).toHaveLength(1);
});
it("pins one verifier SID across separate store actions", async () => {
  const f = fixture(false), factory = f.sessionFactory.getMockImplementation()!; let other = false;
  f.sessionFactory.mockImplementation(() => { const session = factory(); session.query.mockImplementation(async (files) => files.map(() => {
    if (!other) return snapshot(); const userSid = "S-1-5-21-1-2-3-1002";
    return { userSid, ownerSid: userSid, protected: true, aces: [{ sid: userSid, kind: "allow", mask: 0x1f01ff, flags: 0 }] };
  })); return session; });
  const before = source(), store = await ownedStore(f); await store.create(id, before.snapshot, before.bytes); other = true;
  await expect(store.verify(id)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.state.leases).toBe(f.state.releases); expect(f.handles.size).toBe(0);
  const count = f.state.leases; await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" }); expect(f.state.leases).toBe(count);
});
it.each(["root", "namespace", "known-file", "extra-stage"] as const)("rejects %s drift without rewriting or deleting stored evidence", async (change) => {
  const f = fixture(false), before = source(), store = await ownedStore(f); await store.create(id, before.snapshot, before.bytes);
  if (change === "root") f.nodes.get(f.root)!.id += 100n;
  else if (change === "namespace") f.nodes.get(f.absolute("whitelist-guards"))!.id += 100n;
  else if (change === "known-file") f.nodes.get(f.absolute(relative))!.id += 100n;
  else f.add(f.absolute(relative) + ".stage", false, Buffer.from("preserved"));
  const native = f.writerFactory.mock.calls.length;
  await expect(store.verify(id)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.writerFactory).toHaveBeenCalledTimes(native); expect(f.nodes.get(f.absolute(relative))!.bytes).toEqual(before.bytes);
  if (change === "extra-stage") expect(f.nodes.get(f.absolute(relative) + ".stage")!.bytes.toString()).toBe("preserved");
  expect(f.state.leases).toBe(f.state.releases); expect(f.handles.size).toBe(0);
});
it("does not adopt a namespace created externally after an empty open", async () => {
  const f = fixture(false), before = source(), store = await ownedStore(f); f.add(f.absolute("whitelist-guards"), true);
  await expect(store.create(id, before.snapshot, before.bytes)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.nodes.has(f.absolute("whitelist-guards"))).toBe(true);
});
it("holds the stored-read descriptor across its batched ACL-after and detects replacement", async () => {
  const f = fixture(false), before = source(), store = await ownedStore(f); await store.create(id, before.snapshot, before.bytes);
  const factory = f.sessionFactory.getMockImplementation()!; let checks = 0, descriptorHeld = false;
  f.sessionFactory.mockImplementation(() => { const session = factory(); session.query.mockImplementation(async (files) => {
    if (files.length === 3 && files.at(-1) === f.absolute(relative) && ++checks === 2) {
      descriptorHeld = f.handles.size === 1; f.nodes.get(f.absolute(relative))!.id += 100n;
    }
    return files.map(() => snapshot());
  }); return session; });
  await expect(store.verify(id)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(checks).toBe(2); expect(descriptorHeld).toBe(true); expect(f.handles.size).toBe(0); expect(f.state.leases).toBe(f.state.releases);
});
it("does not attach callable legacy publication or ACL helpers to owned stores", async () => {
  const f = fixture(false), store = await ownedStore(f), calls = f.io.stat.mock.calls.length;
  await expect(store.publication.createDirectory(f.absolute("whitelist-guards"))).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  await expect(store.publication.writeNew(f.absolute(relative), Buffer.from("denied"))).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  await expect(store.publication.publishNew(f.absolute(relative) + ".stage", f.absolute(relative))).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  await expect(store.acl.verifyMany([f.root])).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.io.stat).toHaveBeenCalledTimes(calls); expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.state.leases).toBe(1);
});
it("rejects an empty namespace replaced between the entry gate and first list snapshot", async () => {
  const f = fixture(false); f.add(f.absolute("whitelist-guards"), true);
  const store = await ownedStore(f), original = f.io.stat.getMockImplementation()!; let changed = false;
  f.io.list.mockClear();
  // A scan's entry gate consumes the namespace stat twice; replacing on its third stat
  // makes both list snapshots individually consistent with the new empty namespace.
  let namespaceChecks = 0;
  f.io.stat.mockImplementation(async (file) => {
    if (file === f.absolute("whitelist-guards") && ++namespaceChecks === 3) { f.nodes.get(file)!.id += 100n; changed = true; }
    return original(file);
  });
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(changed).toBe(true); expect(f.io.list).toHaveBeenCalledTimes(2);
  expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.state.leases).toBe(f.state.releases);
});
it("preserves a full256KiB exact-byte source across64 chunks in the Fake store path", async () => {
  const f = fixture(false), before = source(), padded = Buffer.concat([before.bytes, Buffer.alloc(262144 - before.bytes.length, 0x20)]);
  const snapshot = { ...before.snapshot, fileSha256: createHash("sha256").update(padded).digest("hex") };
  const store = await ownedStore(f); expect((await store.create(id, snapshot, padded)).snapshot).toEqual(snapshot);
  const chunks = Array.from({ length: 64 }, (_, i) => f.nodes.get(f.absolute(`${directory}/${String(i).padStart(2, "0")}.bin`))!.bytes);
  expect(Buffer.concat(chunks)).toEqual(padded); expect((await store.verify(id)).snapshot).toEqual(snapshot);
  expect(f.handles.size).toBe(0); expect(f.state.leases).toBe(f.state.releases);
});
it("closes a stored-read handle returned after the original action deadline without resuming reads", async () => {
  const f = fixture(false), before = source(), store = await ownedStore(f); await store.create(id, before.snapshot, before.bytes);
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
  const gate = deferred(); f.state.openGate = gate;
  const operation = store.verify(id), failed = expect(operation).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  await vi.advanceTimersByTimeAsync(0); expect(f.handles.size).toBe(1); const releases = f.state.releases;
  await vi.advanceTimersByTimeAsync(50_000); expect(f.state.releases).toBe(releases);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); await failed;
  expect(f.handles.size).toBe(0); expect(store.ownedDiagnostic).toMatchObject({ phase: "released", primary: "deadline" });
  expect(f.state.leases).toBe(f.state.releases);
});
it("keeps a failed stored-read close in retained cleanup and blocks later store admission", async () => {
  const f = fixture(false), before = source(), store = await ownedStore(f); await store.create(id, before.snapshot, before.bytes);
  f.state.closeFails = true;
  await expect(store.verify(id)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(store.ownedDiagnostic).toMatchObject({ phase: "retained", mutation: "held", activity: "held" });
  expect(f.handles.size).toBe(1); expect(f.state.mutation).toBe(true); const leases = f.state.leases;
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" }); expect(f.state.leases).toBe(leases);
});
it("rejects overlapping store operations and an already-held owner without nesting acquisitions", async () => {
  const f = fixture(false), before = source(), store = await ownedStore(f); await store.create(id, before.snapshot, before.bytes);
  const gate = deferred(); f.state.openGate = gate;
  const current = store.verify(id); await vi.waitFor(() => expect(f.handles.size).toBe(1));
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_BUSY" }); gate.resolve(); await current;
  f.state.openGate = undefined;
  const release = f.owner.beginOfflineMutation();
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_GUARD_BUSY" }); release();
  expect(await store.scan()).toHaveLength(1); expect(f.state.leases).toBe(f.state.releases);
});
it.each(["../auth/x", "whitelist-guards/../x", `whitelist-guards\\${id}\\00.bin`, `${directory}/64.bin`, `${directory}/00.bin:stream`, `${directory}/00.bin.stage`, `${directory.toUpperCase()}/00.bin`])("refuses non-contract path %s before any IO and cannot be caught to continue", async (input) => {
  const f = fixture();
  await expect(f.run(async (pub) => {
    await expect(pub.publishFile(input, Buffer.from("fixed"))).rejects.toMatchObject({ code: "WHITELIST_PUBLICATION_UNSAFE" });
    await expect(pub.createDirectory("whitelist-guards")).rejects.toMatchObject({ code: "WHITELIST_PUBLICATION_UNSAFE" });
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.stat).not.toHaveBeenCalled(); expect(f.writerFactory).not.toHaveBeenCalled();
});
it("refuses over4096 input and a known target collision without native mutation", async () => {
  const f = fixture();
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.alloc(4097)))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.stat).not.toHaveBeenCalled();
  const collision = fixture(); collision.add(collision.absolute(relative), false, Buffer.from("existing"));
  await expect(collision.run((pub) => pub.publishFile(relative, Buffer.from("new")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(collision.nodes.get(collision.absolute(relative))!.bytes.toString()).toBe("existing"); expect(collision.writerFactory).not.toHaveBeenCalled();
});
it("preserves both target and stage after a no-replace collision at actual publication", async () => {
  const f = fixture(); f.state.collideOnMove = true;
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("new")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.nodes.get(f.absolute(relative))!.bytes.toString()).toBe("existing");
  expect(f.nodes.get(f.absolute(relative) + ".stage")!.bytes.toString()).toBe("new"); expect(f.handles.size).toBe(0);
});
it("keeps a private copy despite caller wipe and retires it only after actual write/readback completion", async () => {
  const f = fixture(), gate = deferred(); f.state.writeGate = gate;
  const original = Buffer.from("private-task-copy"), expected = Buffer.from(original);
  const result = f.run(async (pub) => { const task = pub.publishFile(relative, original); original.fill(0); return task; });
  await vi.waitFor(() => expect(f.state.writeReference).toBeDefined());
  expect(f.state.writeReference).toEqual(expected); expect(f.state.releases).toBe(0);
  gate.resolve(); await result; expect(f.nodes.get(f.absolute(relative))!.bytes).toEqual(expected);
  expect(f.state.writeReference!.every((byte) => byte === 0)).toBe(true);
});
it("shares busy state across directory creation and file publication", async () => {
  const f = fixture(), gate = deferred(); f.state.writeGate = gate;
  const result = f.run(async (pub) => {
    const first = pub.publishFile(relative, Buffer.from("fixed")).catch(() => undefined);
    await vi.waitFor(() => expect(f.state.writeReference).toBeDefined());
    await expect(pub.createDirectory("whitelist-guards")).rejects.toMatchObject({ code: "WHITELIST_PUBLICATION_UNSAFE" });
    gate.resolve(); await first;
  });
  await expect(result).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.trace).not.toContain("native-move"); expect(f.handles.size).toBe(0);
});
it.each(["open", "write", "sync", "close"])("after a deadline during %s does not start the next write/sync/move and closes exact returned handles", async (phase) => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred();
  if (phase === "open") f.state.openGate = gate; else if (phase === "write") f.state.writeGate = gate;
  else if (phase === "sync") f.state.syncGate = gate; else f.state.closeGate = gate;
  const operation = f.run((pub) => pub.publishFile(relative, Buffer.from("fixed-copy")), 100);
  const failed = expect(operation).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  await vi.advanceTimersByTimeAsync(0); expect(f.handles.size).toBe(1);
  f.state.tick = 100; await vi.advanceTimersByTimeAsync(100);
  if (phase === "write") expect(f.state.writeReference!.toString()).toBe("fixed-copy");
  expect(f.state.releases).toBe(0); gate.resolve(); await vi.advanceTimersByTimeAsync(0); await failed;
  expect(f.trace).not.toContain("native-move"); if (phase === "open") expect(f.trace).not.toContain("write-start");
  if (phase === "write") expect(f.trace).not.toContain("sync"); expect(f.handles.size).toBe(0); expect(f.state.releases).toBe(1);
});
it("retains the owner on unknown open or rejected descriptor close even after the task settled", async () => {
  for (const phase of ["open", "close"] as const) {
    const f = fixture(); if (phase === "open") f.state.openFails = true; else f.state.closeFails = true;
    await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("fixed")))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
    expect(f.state).toMatchObject({ mutation: true, activities: 1, releases: 0 }); expect(f.trace).not.toContain("native-move");
  }
});
it("does not claim success when native JSON is returned but actual child close is unknown", async () => {
  const f = fixture(); f.state.writerUnknown = true;
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("fixed")))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.state.releases).toBe(0); expect(f.io.open).not.toHaveBeenCalled();
});
it("fails closed after native creation returns an unsafe ACL snapshot", async () => {
  const f = fixture(); f.state.corruptSnapshot = true;
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("fixed")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.nodes.has(f.absolute(relative) + ".stage")).toBe(true); expect(f.trace).not.toContain("write-start"); expect(f.state.releases).toBe(1);
});
it("retains the owner and private write bytes when raw I/O outlives the shared5s cleanup", async () => {
  vi.useFakeTimers(); const f = fixture(), gate = deferred(); f.state.writeGate = gate;
  const operation = f.run((pub) => pub.publishFile(relative, Buffer.from("still-in-flight")), 100), failed = expect(operation).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  await vi.advanceTimersByTimeAsync(0); f.state.tick = 100; await vi.advanceTimersByTimeAsync(100);
  f.state.tick = 5101; await vi.advanceTimersByTimeAsync(5001); await failed;
  expect(f.state.writeReference!.toString()).toBe("still-in-flight"); expect(f.state.releases).toBe(0);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0); expect(f.state.writeReference!.every((byte) => byte === 0)).toBe(true);
  expect(f.state.releases).toBe(0); expect(f.action.diagnostic.phase).toBe("retained");
});
it("rejects the reverse cross-method overlap before either resource can reach filesystem IO", async () => {
  const f = fixture(false);
  await expect(f.run(async (pub) => {
    const first = pub.createDirectory("whitelist-guards").catch(() => undefined);
    await expect(pub.publishFile(relative, Buffer.from("fixed"))).rejects.toMatchObject({ code: "WHITELIST_PUBLICATION_UNSAFE" });
    await first;
  })).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.stat).not.toHaveBeenCalled(); expect(f.writerFactory).not.toHaveBeenCalled();
});
it("rejects early body return with publication work still outstanding", async () => {
  const f = fixture();
  await expect(f.run(async (pub) => { void pub.publishFile(relative, Buffer.from("fixed")).catch(() => undefined); return "not-a-success"; }))
    .rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.state.releases).toBe(1); expect(f.handles.size).toBe(0); expect(f.trace).not.toContain("native-move");
});
it("preserves an unknown existing stage without create/write/move or cleanup deletion", async () => {
  const f = fixture(); f.add(f.absolute(relative) + ".stage", false, Buffer.from("preserved-stage"));
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("new")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.io.open).not.toHaveBeenCalled();
  expect(f.nodes.get(f.absolute(relative) + ".stage")!.bytes.toString()).toBe("preserved-stage");
});
it("refuses a noncanonical private parent before native dispatch", async () => {
  const f = fixture(); f.io.realpath.mockImplementation(async (file) => file === f.absolute(directory) ? path.resolve("outside-synthetic-root") : file);
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("new")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.io.open).not.toHaveBeenCalled();
});
it("rechecks parent identity after ACL quiesce before native creation", async () => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!;
  f.sessionFactory.mockImplementation(() => { const session = factory(); session.close.mockImplementation(async () => {
    session.closedConfirmed = true; f.nodes.get(f.absolute(directory))!.id += 100n;
  }); return session; });
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("fixed")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.state.releases).toBe(1);
});
it("rejects hardlinked created stages and does not begin descriptor writes", async () => {
  const f = fixture(), factory = f.writerFactory.getMockImplementation()!;
  f.writerFactory.mockImplementation((wrapper) => { const writer = factory(wrapper), run = writer.run.getMockImplementation()!;
    writer.run.mockImplementation(async (script) => { const result = await run(script); f.nodes.get(f.absolute(relative) + ".stage")!.links = 2n; return result; });
    return writer;
  });
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("fixed")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.open).not.toHaveBeenCalled(); expect(f.nodes.get(f.absolute(relative) + ".stage")!.links).toBe(2n);
});
it("rejects a successful native receipt with a nonzero close code", async () => {
  const f = fixture(), factory = f.writerFactory.getMockImplementation()!;
  f.writerFactory.mockImplementation((wrapper) => { const writer = factory(wrapper), run = writer.run.getMockImplementation()!;
    writer.run.mockImplementation(async (script) => { const result = await run(script); writer.closeEvidence.exitCode = 37; return result; });
    return writer;
  });
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("fixed")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(f.io.open).not.toHaveBeenCalled(); expect(f.state.releases).toBe(1);
});
it("tracks readback descriptor closure rather than treating read completion as drain", async () => {
  const f = fixture(), original = f.io.open.getMockImplementation()!;
  f.io.open.mockImplementation(async (file, mode) => {
    const handle = await original(file, mode);
    if (mode === "r") handle.close = async () => { throw new Error("PRIVATE_READ_CLOSE"); };
    return handle;
  });
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("fixed")))).rejects.toMatchObject({ code: "CLEANUP_BLOCKED" });
  expect(f.state.releases).toBe(0); expect(f.handles.size).toBe(1); expect(f.trace).not.toContain("native-move");
});
it("preserves the4096-byte boundary and permits guard63 plus manifest within the same action", async () => {
  const f = fixture(), original = Buffer.alloc(4096, 7);
  await f.run(async (pub) => {
    await pub.publishFile(`${directory}/63.bin`, original); await pub.publishFile(`${directory}/manifest.json`, Buffer.from("{}"));
  });
  expect(f.nodes.get(f.absolute(`${directory}/63.bin`))!.bytes).toEqual(original);
  expect(f.nodes.get(f.absolute(`${directory}/manifest.json`))!.bytes.toString()).toBe("{}");
  expect(f.state).toMatchObject({ leases: 1, releases: 1 }); expect(f.handles.size).toBe(0);
});
it("shares the same one-shot envelope between ACL-only and publication entry points", async () => {
  const first = fixture(); await first.action.run(100_000, async () => undefined);
  await expect(first.run(async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(first.state.leases).toBe(1); expect(first.writerFactory).not.toHaveBeenCalled();
  const second = fixture(); await second.run(async () => undefined);
  await expect(second.action.run(100_000, async () => undefined)).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(second.state.leases).toBe(1);
});
it("rejects an escaped completed publication facade without re-opening the envelope", async () => {
  const f = fixture(); let escaped!: WhitelistGuardPublication;
  await f.run(async (pub) => { escaped = pub; await pub.publishFile(relative, Buffer.from("fixed")); });
  const before = f.action.diagnostic, count = f.writerFactory.mock.calls.length;
  await expect(escaped.publishFile(`${directory}/01.bin`, Buffer.from("later"))).rejects.toMatchObject({ code: "WHITELIST_PUBLICATION_UNSAFE" });
  expect(f.writerFactory).toHaveBeenCalledTimes(count); expect(f.action.diagnostic).toEqual(before);
});
it.each(["content", "identity", "version"] as const)("retains the read descriptor and rejects %s drift during target ACL-after", async (change) => {
  const f = fixture(), factory = f.sessionFactory.getMockImplementation()!; let targetChecks = 0, observedOpenHandle = false;
  f.sessionFactory.mockImplementation(() => {
    const session = factory(); session.query.mockImplementation(async (files) => {
      if (files.length === 1 && files[0] === f.absolute(relative) && ++targetChecks === 2) {
        observedOpenHandle = f.handles.size === 1;
        const node = f.nodes.get(f.absolute(relative))!;
        if (change === "identity") node.id += 100n;
        else if (change === "version") node.version++;
        else { node.bytes = Buffer.from("other"); node.version++; }
      }
      return files.map(() => snapshot());
    }); return session;
  });
  await expect(f.run((pub) => pub.publishFile(relative, Buffer.from("fixed")))).rejects.toMatchObject({ code: "WHITELIST_ACTION_UNSAFE" });
  expect(targetChecks).toBe(2); expect(observedOpenHandle).toBe(true); expect(f.handles.size).toBe(0);
  expect(f.nodes.has(f.absolute(relative))).toBe(true); expect(f.trace.filter((item) => item === "native-move")).toHaveLength(1);
  expect(f.state).toMatchObject({ releases: 1, mutation: false, activities: 0 });
});
