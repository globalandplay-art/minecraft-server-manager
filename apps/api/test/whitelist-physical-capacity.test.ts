import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, realpath, readFile, writeFile, link, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { AuthCoreError } from "../src/auth/password.js";
import { WindowsPrivateAclVerifier } from "../src/auth/windows-private-acl.js";
import { WhitelistGuardStore } from "../src/services/whitelist-guard-store.js";
import { WhitelistCommandStore, type WhitelistCommandPublication } from "../src/services/whitelist-command-store.js";
import { encodeWhitelistNamespace, encodeWhitelistAnchor, encodeWhitelistCommand, whitelistCommandHash, whitelistCommandRequestHash,
  type WhitelistCommandRecord } from "../src/services/whitelist-command-record.js";
import { whitelistMemberRevision, type WhitelistMemberSnapshot } from "../src/services/whitelist-member-policy.js";

// REAL filesystem layouts with FakeACL/publication only. No native security/throughput PASS claim.
const stamp = "2026-10-16T00:00:00.000Z";
let stopped = false, inFlight = false;
async function directoryIdentity(directory: string) {
  const s = await lstat(directory, { bigint: true });
  return whitelistCommandHash(`${s.dev}\0${s.ino}\0${s.birthtimeNs}`);
}
function snapshot(bytes: Buffer, members: WhitelistMemberSnapshot["members"] = []): WhitelistMemberSnapshot {
  return { serverId: "test", rootIdentity: "a".repeat(64), configRevision: "b".repeat(64), fileIdentity: "c".repeat(64),
    fileSha256: whitelistCommandHash(bytes), runtimeId: "123e4567-e89b-42d3-a456-426614174000", members };
}
function command(): Omit<WhitelistCommandRecord, "managerRootIdentity" | "directoryIdentity"> {
  const request = { action: "add" as const, name: "Player_One", revision: "a".repeat(64), confirm: true as const };
  return { schemaVersion: 1, sequence: 0, previousHash: null, operationId: randomUUID(), serverId: "test", request,
    idempotencyHash: whitelistCommandHash(randomUUID()), requestHash: whitelistCommandRequestHash("test", request),
    serverRootIdentity: "b".repeat(64), runtimeId: randomUUID(), guardReceiptHash: "c".repeat(64), state: "intent-persisted",
    responseHash: null, createdAt: stamp, updatedAt: stamp };
}
class FakeAcl extends WindowsPrivateAclVerifier {
  queries = 0;
  constructor(private readonly fence: () => void) { super(); }
  override async verifyMany(files: readonly string[]) { this.fence(); this.queries++; return files.map(() => "synthetic-acl"); }
}
async function physicalCase(action: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  if (stopped || inFlight) throw new Error("PRIOR_PHYSICAL_CAPACITY_FAILURE_STOP");
  inFlight = true;
  let f: Awaited<ReturnType<typeof fixture>>;
  try { f = await fixture(); } catch { stopped = true; inFlight = false; throw new Error("PHYSICAL_CAPACITY_PREPARATION_FAILED"); }
  let succeeded = false, settled = false, workTimer: ReturnType<typeof setTimeout> | undefined;
  const task = Promise.resolve().then(() => { f.fence(); return action(f); }).finally(() => { settled = true; });
  try {
    f.fence();
    await Promise.race([task, new Promise<never>((_, reject) => {
      workTimer = setTimeout(() => reject(new Error("PHYSICAL_CAPACITY_OBSERVATION_DEADLINE")), Math.max(1, f.end - performance.now()));
    })]);
    f.fence(); succeeded = true;
  }
  catch (error) { stopped = true; throw error; }
  finally {
    if (workTimer) clearTimeout(workTimer);
    void task.catch(() => undefined);
    try {
    const end = performance.now() + 5000;
    while (!settled && performance.now() < end) await new Promise<void>((resolve) => setTimeout(resolve, 10));
    if (!settled || performance.now() >= end) throw new Error("CLEANUP_BLOCKED");
    if (!succeeded) console.info("LC2_PHYSICAL_CAPACITY_RETAINED", f.root);
    else {
      if (!resolve(f.root).startsWith(f.temp + sep) || !f.root.includes("mcsm-physical-capacity-")) throw new Error("CLEANUP_BLOCKED");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([rm(f.root, { recursive: true, force: true }), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("CLEANUP_BLOCKED")), Math.max(1, end - performance.now()));
        })]);
        if (performance.now() >= end) throw new Error("CLEANUP_BLOCKED");
      } finally { if (timer) clearTimeout(timer); }
    }
    } catch { stopped = true; throw new Error("CLEANUP_BLOCKED"); }
    finally { inFlight = false; }
  }
}
async function fixture() {
  const start = performance.now(), end = start + 50_000, temp = await realpath(tmpdir()), root = await mkdtemp(join(temp, "mcsm-physical-capacity-"));
  console.info("LC2_PHYSICAL_CANONICAL_FIXTURE", await realpath(root));
  const fence = () => { if (performance.now() >= end) throw new Error("PHYSICAL_CAPACITY_OBSERVATION_DEADLINE"); };
  let busy = false, publications = 0;
  const owner = { assertHeld: (p: string) => { if (p !== root) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE"); }, rootIdentity: () => whitelistCommandHash(root),
    beginOfflineMutation: () => { if (busy) throw new AuthCoreError("AUTH_BUSY"); busy = true; return () => { busy = false; }; } };
  const acl = new FakeAcl(fence);
  const publication: WhitelistCommandPublication = {
    createDirectory: async (file) => { fence(); publications++; await mkdir(file); },
    writeNew: async (file, bytes) => { fence(); publications++; await writeFile(file, bytes, { flag: "wx" }); },
    publishNew: async (stage, target) => { fence(); publications++; await link(stage, target); fence(); await unlink(stage); }
  };
  return { temp, root, owner, acl, publication, fence, end, publications: () => publications };
}

it("uses999 physical guards plus a real256KiB/64chunk create at1000, rejecting1001 with no publication", () => physicalCase(async (f) => {
  const namespace = join(f.root, "whitelist-guards"); await mkdir(namespace);
  const namespaceIdentity = await directoryIdentity(namespace), bytes = Buffer.from("[]"), before = snapshot(bytes);
  const { members: omitted, ...source } = before; void omitted;
  for (let i = 0; i < 999; i++) {
    f.fence(); const operationId = randomUUID(), directory = join(namespace, operationId); await mkdir(directory);
    const manifest = { schemaVersion: 1, operationId, managerRootIdentity: f.owner.rootIdentity(), namespaceIdentity,
      directoryIdentity: await directoryIdentity(directory), source, revision: whitelistMemberRevision(before), byteLength: 2, chunks: 1, pinned: true };
    await writeFile(join(directory, "00.bin"), bytes, { flag: "wx" }); await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest), { flag: "wx" });
  }
  const guards = await WhitelistGuardStore.open(f.root, f.owner, f.acl, f.publication); f.fence(); expect(f.publications()).toBe(0);
  const members = Array.from({ length: 1000 }, (_, i) => ({ name: `Player_${String(i).padStart(4, "0")}`, uuid: randomUUID() }));
  const json = Buffer.from(JSON.stringify(members)), largest = Buffer.alloc(256 * 1024, 32); json.copy(largest);
  const largestSnapshot = snapshot(largest, members), largestId = randomUUID();
  await guards.create(largestId, largestSnapshot, largest); f.fence();
  const contents = await readdir(join(namespace, largestId)); expect(contents).toHaveLength(65); expect(contents.filter((name) => name.endsWith(".bin"))).toHaveLength(64);
  const rows = await guards.scan(); f.fence(); expect(rows).toHaveLength(1000);
  expect(rows.find((row) => row.operationId === largestId)?.snapshot).toEqual(largestSnapshot);
  const names = (await readdir(namespace)).sort(), writes = f.publications();
  await expect(guards.create(randomUUID(), before, bytes)).rejects.toMatchObject({ code: "WHITELIST_GUARD_CAPACITY" }); f.fence();
  expect(f.publications()).toBe(writes); expect((await readdir(namespace)).sort()).toEqual(names);
  const retained = await readFile(join(namespace, largestId, "63.bin")); expect(retained.equals(largest.subarray(63 * 4096))).toBe(true);
}), 60_000);

async function commandFixture(f: Awaited<ReturnType<typeof fixture>>, count: number) {
  const directory = join(f.root, "whitelist-commands"); await mkdir(directory);
  const managerRootIdentity = f.owner.rootIdentity(), identity = await directoryIdentity(directory);
  await writeFile(join(f.root, "whitelist-commands.receipt.json"), encodeWhitelistNamespace({ schemaVersion: 1, managerRootIdentity, directoryIdentity: identity }), { flag: "wx" });
  let first: Omit<WhitelistCommandRecord, "managerRootIdentity" | "directoryIdentity"> | undefined;
  for (let start = 0; start < count; start += 4) {
    // Independent fixture files, bounded preparation only; product scan, worker
    // count, original50s budget and all capacity assertions remain unchanged.
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, count - start) }, async () => {
    f.fence(); const input = command(); first ??= input;
    const record = { ...input, managerRootIdentity, directoryIdentity: identity }, bytes = encodeWhitelistCommand(record);
    await writeFile(join(directory, `${record.operationId}.0000.json`), bytes, { flag: "wx" });
    await writeFile(join(f.root, `whitelist-command-${record.operationId}.receipt.json`), encodeWhitelistAnchor({ schemaVersion: 1,
      managerRootIdentity, directoryIdentity: identity, operationId: record.operationId, genesisHash: whitelistCommandHash(bytes) }), { flag: "wx" });
    }));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  return { directory, first: first! };
}

it("validates10000 physical command evidence entries, admits the last pair, replays at capacity and refuses a new pair without publication", () => physicalCase(async (f) => {
  const mark = (stage: 'prepare' | 'open' | 'admit' | 'replay' | 'capacity-refusal' | 'complete') =>
    console.info('LC2_CAPACITY_STAGE', JSON.stringify({ stage, elapsedMs: Math.floor(performance.now() - (f.end - 50_000)) }));
  mark('prepare');
  const { directory, first } = await commandFixture(f, 4999);
  mark('open');
  const store = await WhitelistCommandStore.open(f.root, f.owner, f.acl, f.publication); f.fence(); expect(f.publications()).toBe(0);
  mark('admit');
  const final = command(); expect((await store.admit(final)).operationId).toBe(final.operationId); f.fence();
  expect(await readdir(directory)).toHaveLength(5000);
  expect((await readdir(f.root)).filter((name) => name.startsWith("whitelist-command-"))).toHaveLength(5000);
  const writes = f.publications();
  mark('replay');
  const replay = await store.admit({ ...first, operationId: randomUUID() }); f.fence(); expect(replay.operationId).toBe(first.operationId); expect(f.publications()).toBe(writes);
  mark('capacity-refusal');
  await expect(store.admit(command())).rejects.toMatchObject({ code: "WHITELIST_COMMAND_CAPACITY" }); f.fence(); expect(f.publications()).toBe(writes);
  expect(await readdir(directory)).toHaveLength(5000);
  mark('complete');
}), 60_000);

it("enforces the independent10000 root-entry ceiling even when command evidence is far below its cap", () => physicalCase(async (f) => {
  await commandFixture(f, 1);
  const existing = (await readdir(f.root)).length;
  for (let i = existing; i < 10000; i++) { f.fence(); await writeFile(join(f.root, `other-${i}.txt`), "", { flag: "wx" }); }
  const store = await WhitelistCommandStore.open(f.root, f.owner, f.acl, f.publication); f.fence();
  expect(await readdir(f.root)).toHaveLength(10000); const writes = f.publications();
  await expect(store.admit(command())).rejects.toMatchObject({ code: "WHITELIST_COMMAND_CAPACITY" }); f.fence();
  expect(f.publications()).toBe(writes); expect(await readdir(f.root)).toHaveLength(10000);
}), 60_000);
