import { expect, vi } from "vitest";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { AuthCoreError } from "../../src/auth/password.js";
import { WhitelistEnvelopeAclAction } from "../../src/services/whitelist-envelope-acl.js";
import type { WhitelistOwnedWideGuardAccess } from "../../src/services/whitelist-owned-publication.js";
import type { ManagerLifetimeLock } from "../../src/auth/manager-lifetime-lock.js";
const id = "12345678-1234-4234-8234-123456789abc", directory = `whitelist-guards/${id}`;
const sid = "S-1-5-21-1-2-3-1001";
export const snapshot = () => ({ userSid: sid, ownerSid: sid, protected: true, aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 0 }] });
interface Deferred { promise: Promise<void>; resolve(): void }
interface Node { id: bigint; dir: boolean; bytes: Buffer; links: bigint; version: bigint; symlink?: boolean }
export function fixture(withDirectories = true) {
  const root = path.resolve("isolated-owned-publication-fixture"), nodes = new Map<string, Node>(); let nextId = 0n;
  const add = (file: string, dir: boolean, bytes = Buffer.alloc(0)) => { const node = { id: ++nextId, dir, bytes: Buffer.from(bytes), links: 1n, version: 1n }; nodes.set(file, node); return node; };
  const absolute = (file: string) => path.join(root, ...file.split("/"));
  add(root, true); if (withDirectories) { add(absolute("whitelist-guards"), true); add(absolute(directory), true); }
  const info = (node: Node): BigIntStats => ({ dev: 1n, ino: node.id, birthtimeNs: node.id, size: BigInt(node.bytes.length),
    mtimeNs: node.version, ctimeNs: node.version, nlink: node.links, isFile: () => !node.dir, isDirectory: () => node.dir, isSymbolicLink: () => node.symlink === true } as BigIntStats);
  const lookup = (file: string) => { const node = nodes.get(file); if (!node) throw Object.assign(new Error("FIXED_MISSING"), { code: "ENOENT" }); return node; };
  const state = { tick: 0, mutation: false, activities: 0, leases: 0, releases: 0,
    openGate: undefined as Deferred | undefined, writeGate: undefined as Deferred | undefined,
    syncGate: undefined as Deferred | undefined, closeGate: undefined as Deferred | undefined,
    closeFails: false, openFails: false, corruptSnapshot: false, writerUnknown: false, collideOnMove: false,
    writeReference: undefined as Buffer | undefined,
    groupFailCreateAt: undefined as number | undefined, groupFailMoveAt: undefined as number | undefined,
    groupGate: undefined as Deferred | undefined, groupPauseAfter: undefined as number | undefined,
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