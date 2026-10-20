import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fixture, snapshot } from "./fixtures/whitelist-owned-publication.js";
import type { ManagerLifetimeLock } from "../src/auth/manager-lifetime-lock.js";
import { WhitelistGuardStore } from "../src/services/whitelist-guard-store.js";
import { whitelistMemberRevision } from "../src/services/whitelist-member-policy.js";
import { SyntheticRuntime } from "./whitelist-synthetic-fixture.js";
const id = "12345678-1234-4234-8234-123456789abc";
const source = () => { const snapshot = new SyntheticRuntime().snapshot(); return { snapshot, bytes: Buffer.from(JSON.stringify(snapshot.members)) }; };
type Node = ReturnType<typeof fixture>["nodes"] extends Map<string, infer Item> ? Item : never;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const historyStore = (f: ReturnType<typeof historyFixture>) => WhitelistGuardStore.openOwnedWide(f.root, f.owner as unknown as ManagerLifetimeLock,
  { sessionFactory: f.historySessionFactory, publication: { io: f.historyIo, writer: f.writerFactory } });
/** Seed physical identities in the existing in-memory I/O model. No publication or
 * ACL bypass enters the Store. This proves logical history handling, NOT Windows
 * ACL throughput. The indexed directory model avoids a quadratic Fake readdir. */
function historyFixture(count: number, maximumLast = false) {
  const f = fixture(false), before = source(), rows: { operationId: string; receiptHash: string; snapshot: typeof before.snapshot }[] = [];
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const nodeIdentity = (node: Node) => hash(`1\0${node.id}\0${node.id}`);
  const namespace = f.add(f.absolute("whitelist-guards"), true);
  for (let i = 0; i < count; i++) {
    const operationId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, relativeDirectory = `whitelist-guards/${operationId}`;
    const directoryNode = f.add(f.absolute(relativeDirectory), true);
    const bytes = maximumLast && i === count - 1 ? Buffer.concat([before.bytes, Buffer.alloc(262144 - before.bytes.length, 32)]) : before.bytes;
    const captured = { ...before.snapshot, fileSha256: hash(bytes) }, { members, ...source } = captured; void members;
    const chunks = Math.ceil(bytes.length / 4096);
    for (let index = 0; index < chunks; index++) {
      f.add(f.absolute(`${relativeDirectory}/${String(index).padStart(2, "0")}.bin`), false, bytes.subarray(index * 4096, (index + 1) * 4096));
    }
    const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, operationId, managerRootIdentity: f.owner.rootIdentity(),
      namespaceIdentity: nodeIdentity(namespace), directoryIdentity: nodeIdentity(directoryNode), source,
      revision: whitelistMemberRevision(captured), byteLength: bytes.length, chunks, pinned: true }));
    f.add(f.absolute(`${relativeDirectory}/manifest.json`), false, manifest);
    rows.push({ operationId, receiptHash: hash(manifest), snapshot: captured });
  }
  const children = new Map<string, string[]>();
  for (const file of f.nodes.keys()) {
    const parent = path.dirname(file); if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(path.basename(file));
  }
  f.io.list.mockImplementation(async (file) => [...(children.get(file) ?? [])]);
  // Large histories need result/count evidence, not hundreds of thousands of
  // retained vi.fn metadata call arguments. Execute the SAME metadata functions
  // directly; keep query/open/list/publication observations and all assertions.
  const historyCalls = { opens: 0 }, openFile = f.io.open.getMockImplementation()!;
  const historyIo = { stat: f.io.stat.getMockImplementation()!, realpath: f.io.realpath.getMockImplementation()!,
    open: (...args: Parameters<typeof openFile>) => { historyCalls.opens++; return openFile(...args); }, list: f.io.list.getMockImplementation()! };
  const historyQueries: string[][] = [];
  const historySessionFactory = () => {
    const session = { closedConfirmed: false, get healthyForRotation() { return !session.closedConfirmed; },
      query: async (files: readonly string[]) => { historyQueries.push([...files]); return files.map(() => snapshot()); },
      close: async () => { session.closedConfirmed = true; f.trace.push("acl-close"); } };
    return session;
  };
  return { ...f, rows, historyIo, historySessionFactory, historyQueries, historyCalls };
}

it("wide history verifies all1000 guards including the last64 chunks without publication or nested leases", async () => {
  const f = historyFixture(1000, true);
  const store = await historyStore(f);
  expect(store.ownedDiagnostic).toMatchObject({ phase: "released", primary: null, bodySettled: true, resourceCount: 0 });
  expect(f.state).toMatchObject({ leases: 1, releases: 1, mutation: false, activities: 0 });
  expect(f.handles.size).toBe(0); expect(f.state.peakHandles).toBe(6); expect(f.writerFactory).not.toHaveBeenCalled();
  const actualQueries = f.historyQueries;
  // Each small guard:manifest2 +list4 +chunk2 =8; maximum guard:2+4+22=28.
  expect(actualQueries).toHaveLength(999 * 8 + 28 + 4);
  expect(Math.max(...actualQueries.map((batch) => batch.length))).toBe(8);
  const last = f.rows.at(-1)!;
  expect(actualQueries.filter((batch) => batch.at(-1) === f.absolute(`whitelist-guards/${last.operationId}/63.bin`))).toHaveLength(2);
  // Validate returned receipts through an independent fresh scan on a smaller set below;
  // open's observed full last-chunk traversal is not a physical timing claim.
  const native = f.writerFactory.mock.calls.length;
  const before = source();
  await expect(store.create(id, before.snapshot, before.bytes)).rejects.toMatchObject({ code: "WHITELIST_GUARD_CAPACITY" });
  expect(f.writerFactory).toHaveBeenCalledTimes(native); expect(f.state.leases).toBe(2); expect(f.state.releases).toBe(2);
});

it("wide history rejects1001 directory entries before reading any manifest or creating anything", async () => {
  const f = historyFixture(1001);
  await expect(historyStore(f)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.historyCalls.opens).toBe(0); expect(f.writerFactory).not.toHaveBeenCalled();
  expect(f.state.leases).toBe(f.state.releases); expect(f.nodes.size).toBe(2 + 1001 * 3);
});

it.each([0, 7, 15])("wide history fails closed for corrupt record%d and preserves every record", async (index) => {
  const f = historyFixture(16), row = f.rows[index]!, file = f.absolute(`whitelist-guards/${row.operationId}/00.bin`);
  f.nodes.get(file)!.bytes[0] = 0;
  const count = f.nodes.size;
  await expect(historyStore(f)).rejects.toMatchObject({ code: "WHITELIST_GUARD_UNSAFE" });
  expect(f.nodes.size).toBe(count); expect(f.nodes.get(file)!.bytes[0]).toBe(0);
  expect(f.writerFactory).not.toHaveBeenCalled(); expect(f.handles.size).toBe(0); expect(f.state.leases).toBe(f.state.releases);
});

it("wide history returns exact source-bound receipts after a cold open and a fresh scan", async () => {
  const f = historyFixture(3, true), store = await historyStore(f);
  expect(await store.scan()).toEqual(f.rows); expect(f.writerFactory).not.toHaveBeenCalled();
  expect(f.handles.size).toBe(0); expect(f.state.leases).toBe(2); expect(f.state.releases).toBe(2);
});
