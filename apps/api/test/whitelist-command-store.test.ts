import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, link, unlink, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { WindowsPrivateAclVerifier } from "../src/auth/windows-private-acl.js";
import { AuthCoreError } from "../src/auth/password.js";
import { WhitelistCommandStore, type WhitelistCommandPublication } from "../src/services/whitelist-command-store.js";
import { encodeWhitelistCommand, decodeWhitelistCommand, verifyWhitelistCommandChain, whitelistCommandHash,
  whitelistCommandRequestHash, type WhitelistCommandRecord } from "../src/services/whitelist-command-record.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith("mcsm-whitelist-store-")) throw new Error("fixture-cleanup-boundary");
    await rm(root, { recursive: true, force: true });
  }
});
class FakeAcl extends WindowsPrivateAclVerifier {
  denied = false; during: (files: readonly string[]) => Promise<void> = async () => {};
  override async verifyMany(files: readonly string[]): Promise<string[]> {
    await this.during(files); if (this.denied) throw new Error("PRIVATE_TEST_SENTINEL"); return files.map(() => "fake-acl");
  }
}
const now = "2026-10-14T00:00:00.000Z";
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-whitelist-store-")); roots.push(root);
  let busy = false, writes = 0, held = true;
  const owner = { assertHeld: (file: string) => { if (file !== root || !held) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE"); },
    rootIdentity: () => whitelistCommandHash(root), beginOfflineMutation: (file: string) => {
      owner.assertHeld(file); if (busy) throw new AuthCoreError("AUTH_BUSY"); busy = true; return () => { busy = false; };
    } };
  const acl = new FakeAcl();
  const publication: WhitelistCommandPublication = {
    createDirectory: async (file) => { writes++; await mkdir(file); },
    writeNew: async (file, bytes) => { writes++; await writeFile(file, bytes, { flag: "wx" }); },
    publishNew: async (stage, target) => { writes++; await link(stage, target); await unlink(stage); }
  };
  const input = (serverId = "test") => {
    const request = { action: "add" as const, name: "Player_One", revision: "a".repeat(64), confirm: true as const };
    return { schemaVersion: 1 as const, sequence: 0, previousHash: null, operationId: randomUUID(), serverId,
      idempotencyHash: whitelistCommandHash(randomUUID()), requestHash: whitelistCommandRequestHash(serverId, request), request,
      serverRootIdentity: "b".repeat(64), runtimeId: randomUUID(), guardReceiptHash: "c".repeat(64),
      state: "intent-persisted" as const, responseHash: null, createdAt: now, updatedAt: now };
  };
  return { root, owner, acl, publication, input, writes: () => writes, releaseOwner: () => { held = false; },
    open: (pub = publication, scanLimit?: number) => WhitelistCommandStore.open(root, owner, acl, pub, scanLimit), directory: path.join(root, "whitelist-commands") };
}
it("construction/scan never creates storage, commands or configuration", async () => {
  const f = await fixture(), store = await f.open();
  expect(await store.scan()).toEqual([]); expect(await readdir(f.root)).toEqual([]); expect(f.writes()).toBe(0);
});
it('rejects a namespace identity replacement during a read batch without publishing or accepting the batch', async () => {
  const f = await fixture(), store = await f.open(); await store.admit(f.input());
  const retained = path.join(f.root,'retained-commands');
  let replaced = false;
  const writes = f.writes();
  f.acl.during = async files => {
    if (!replaced && files.some(file => file.startsWith(f.directory + path.sep))) {
      replaced = true;
      await rename(f.directory,retained); await mkdir(f.directory);
      for (const name of await readdir(retained)) await rename(path.join(retained,name),path.join(f.directory,name));
    }
  };
  await expect(store.scan()).rejects.toMatchObject({code:'WHITELIST_COMMAND_STORAGE_UNSAFE'});
  expect(replaced).toBe(true); expect(f.writes()).toBe(writes);
  await expect(store.scan()).rejects.toMatchObject({code:'WHITELIST_COMMAND_STORAGE_UNSAFE'});
});
it("drains eight bounded read chains under the owner lease after failure and never schedules the ninth", async () => {
  const f = await fixture(), store = await f.open();
  for (let index = 0; index < 9; index++) await store.admit(f.input());
  const anchors = (await readdir(f.root)).filter(name => /^whitelist-command-.*\.receipt\.json$/u.test(name)).sort();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let thirdRead = false, settled = false;
  f.acl.during = async files => {
    if (files.includes(path.join(f.root, anchors[0]!))) throw new Error('PRIVATE_TEST_SENTINEL');
    if (files.includes(path.join(f.root, anchors[7]!))) { entered(); await blocked; }
    if (files.includes(path.join(f.root, anchors[8]!))) thirdRead = true;
  };
  const outcome = store.scan().then(() => null, (error: unknown) => error).finally(() => { settled = true; });
  try {
    await started;
    expect(settled).toBe(false);
    expect(() => f.owner.beginOfflineMutation(f.root)).toThrow('AUTH_BUSY');
  } finally { release(); }
  expect(await outcome).toMatchObject({ code: 'WHITELIST_COMMAND_STORAGE_UNSAFE' });
  expect(thirdRead).toBe(false);
  f.owner.beginOfflineMutation(f.root)();
});
it("preserves append-only intent/dispatch/response/recovery across a new store without executing anything", async () => {
  const f = await fixture(), store = await f.open(), request = f.input();
  const first = await store.admit(request), bytes = await readFile(path.join(f.directory, `${first.operationId}.0000.json`));
  await store.append(first.operationId, "dispatch-intent", null, now);
  await store.append(first.operationId, "response-recorded", "d".repeat(64), now);
  await store.append(first.operationId, "recovery-required", "d".repeat(64), now);
  const count = f.writes(), reopened = await f.open(), chains = await reopened.scan();
  expect(chains[0]).toHaveLength(4); expect(chains[0]!.at(-1)!.state).toBe("recovery-required");
  expect(await readFile(path.join(f.directory, `${first.operationId}.0000.json`))).toEqual(bytes); expect(f.writes()).toBe(count);
});
it("same-key replay returns the original head across reopen and far beyond24h with zero writes", async () => {
  const f = await fixture(), request = f.input(), store = await f.open(); await store.admit(request);
  await store.append(request.operationId, "dispatch-intent", null, now);
  const count = f.writes(), reopened = await f.open();
  const replay = await reopened.admit({ ...request, operationId: randomUUID(), createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" });
  expect(replay.operationId).toBe(request.operationId); expect(replay.state).toBe("dispatch-intent"); expect(f.writes()).toBe(count);
});
it("same key different request conflicts without poisoning history; independent server keys remain distinct", async () => {
  const f = await fixture(), store = await f.open(), first = f.input(); await store.admit(first);
  const request = { ...first.request, action: "remove" as const };
  await expect(store.admit({ ...first, operationId: randomUUID(), request, requestHash: whitelistCommandRequestHash(first.serverId, request) })).rejects.toMatchObject({ code: "WHITELIST_COMMAND_KEY_CONFLICT" });
  expect(await store.scan()).toHaveLength(1);
  const other = f.input("other"); await store.admit({ ...other, idempotencyHash: first.idempotencyHash }); expect(await store.scan()).toHaveLength(2);
});
it.each(["missing-genesis", "unknown-file", "stage", "chain-gap", "content", "hardlink"])("rejects %s and retains evidence without repair", async (fault) => {
  const f = await fixture(), store = await f.open(), request = f.input(); await store.admit(request);
  const first = path.join(f.directory, `${request.operationId}.0000.json`);
  if (fault === "missing-genesis") await unlink(first);
  if (fault === "unknown-file") await writeFile(path.join(f.directory, "unknown.json"), "{}");
  if (fault === "stage") await writeFile(first + ".stage", "retained");
  if (fault === "chain-gap") await rename(first, path.join(f.directory, `${request.operationId}.0001.json`));
  if (fault === "content") await writeFile(first, "PRIVATE_TEST_SENTINEL");
  if (fault === "hardlink") await link(first, path.join(f.root, "owned-link"));
  const writes = f.writes(); await expect(f.open()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" }); expect(f.writes()).toBe(writes);
});
it.each(["replacement", "junction"])("does not follow namespace %s", async (fault) => {
  const f = await fixture(), store = await f.open(); await store.admit(f.input());
  const retained = path.join(f.root, "retained"); await rename(f.directory, retained);
  if (fault === "replacement") await mkdir(f.directory); else await symlink(retained, f.directory, "junction");
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" }); expect(await readdir(retained)).toHaveLength(1);
});
it("detects same-content checkpoint replacement during an open session", async () => {
  const f = await fixture(), store = await f.open(), request = f.input(); await store.admit(request);
  const file = path.join(f.directory, `${request.operationId}.0000.json`), bytes = await readFile(file);
  await rename(file, path.join(f.root, "retained-checkpoint")); await writeFile(file, bytes);
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
});
it.each(["namespace", "anchor", "checkpoint"])("failure after %s publication leaves fail-closed evidence on restart", async (point) => {
  const f = await fixture();
  const pub = { ...f.publication, publishNew: async (stage: string, target: string) => {
    await f.publication.publishNew(stage, target);
    if (point === "namespace" && target.endsWith("whitelist-commands.receipt.json") || point === "anchor" && target.includes("whitelist-command-") ||
      point === "checkpoint" && target.endsWith(".0000.json")) throw new Error("PRIVATE_TEST_SENTINEL");
  } };
  const store = await f.open(pub); await expect(store.admit(f.input())).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
  await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
  if (point === "anchor") await expect(f.open()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
  else {
    const reopened = await f.open(); const chains = await reopened.scan();
    expect(point === "namespace" ? chains.length : chains[0]!.at(-1)!.state).toBe(point === "namespace" ? 0 : "intent-persisted");
  }
});
it("never overwrites a foreign destination and leaves its own stage intact", async () => {
  const f = await fixture(); let foreign = "";
  const pub = { ...f.publication, publishNew: async (stage: string, target: string) => {
    if (target.endsWith(".0000.json")) { await writeFile(target, "foreign", { flag: "wx" }); foreign = target; }
    await f.publication.publishNew(stage, target);
  } };
  const store = await f.open(pub); await expect(store.admit(f.input())).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
  expect(await readFile(foreign, "utf8")).toBe("foreign"); expect((await readFile(foreign + ".stage")).length).toBeGreaterThan(0);
});
it("ACL denial and owner loss reject without leaking diagnostics", async () => {
  const f = await fixture(), store = await f.open(); await store.admit(f.input()); f.acl.denied = true;
  const error = await store.scan().catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" }); expect(JSON.stringify(error)).not.toContain("PRIVATE_TEST_SENTINEL");
  f.acl.denied = false; const other = await f.open(); f.releaseOwner(); await expect(other.scan()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
});
it("a concurrent read returns BUSY rather than scanning mid-publication or poisoning the writer", async () => {
  const f = await fixture(), store = await f.open(); let release!: () => void, entered!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { entered = resolve; });
  const pub = { ...f.publication, writeNew: async (file: string, bytes: Buffer) => { entered(); await paused; await f.publication.writeNew(file, bytes); } };
  const writer = await f.open(pub), pending = writer.admit(f.input()); await started;
  try { await expect(store.scan()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_BUSY" }); }
  finally { release(); await pending; }
  expect(await store.scan()).toHaveLength(1);
});
it("codec rejects unknown version, fields, bytes, invalid time and contradictory transitions", async () => {
  const f = await fixture(), store = await f.open(), first = await store.admit(f.input());
  for (const invalid of [{ ...first, schemaVersion: 2 }, { ...first, path: "PRIVATE_TEST_SENTINEL" }]) expect(() => encodeWhitelistCommand(invalid as WhitelistCommandRecord)).toThrow();
  expect(() => decodeWhitelistCommand(Buffer.from("\ufeff{}"))).toThrow(); expect(() => decodeWhitelistCommand(Buffer.alloc(4097))).toThrow();
  expect(() => verifyWhitelistCommandChain([{ ...first, createdAt: "2026-02-30T00:00:00.000Z", updatedAt: "2026-02-30T00:00:00.000Z" }])).toThrow();
  await expect(store.append(first.operationId, "response-recorded", "d".repeat(64), now)).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
  expect(await store.scan()).toHaveLength(1);
  await store.append(first.operationId, "dispatch-intent", null, now);
  await expect(store.append(first.operationId, "response-recorded", null, now)).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
  await store.append(first.operationId, "response-recorded", "d".repeat(64), now);
  await expect(store.append(first.operationId, "recovery-required", "e".repeat(64), now)).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
});
it.each(["checkpoint", "witness"])("rejects removed suffix %s after reopen without downgrading dispatch history", async (part) => {
  const f = await fixture(), store = await f.open(), request = f.input(); await store.admit(request);
  await store.append(request.operationId, "dispatch-intent", null, now);
  await unlink(part === "checkpoint" ? path.join(f.directory, `${request.operationId}.0001.json`) :
    path.join(f.root, `whitelist-command-${request.operationId}.0001.receipt.json`));
  await expect(f.open()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
});
it("reserves admit and append capacity before any publication; readable history is preserved", async () => {
  const f = await fixture(), store = await f.open(f.publication, 4), request = f.input();
  await store.admit(request); await store.admit(f.input()); const count = f.writes();
  await expect(store.admit(f.input())).rejects.toMatchObject({ code: "WHITELIST_COMMAND_CAPACITY" });
  await expect(store.append(request.operationId, "dispatch-intent", null, now)).rejects.toMatchObject({ code: "WHITELIST_COMMAND_CAPACITY" });
  expect(f.writes()).toBe(count); expect(await store.scan()).toHaveLength(2); expect(await readdir(f.directory)).toHaveLength(2);
});
it("a published append witness without its checkpoint is retained and blocks restart", async () => {
  const f = await fixture(), base = await f.open(), request = f.input(); await base.admit(request);
  const pub = { ...f.publication, publishNew: async (stage: string, target: string) => {
    await f.publication.publishNew(stage, target);
    if (target.endsWith(".0001.receipt.json")) throw new Error("PRIVATE_TEST_SENTINEL");
  } };
  const store = await f.open(pub); await expect(store.append(request.operationId, "dispatch-intent", null, now)).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
  expect(await readdir(f.directory)).toHaveLength(1);
  expect(await readFile(path.join(f.root, `whitelist-command-${request.operationId}.0001.receipt.json`), "utf8")).toContain("checkpointHash");
  await expect(f.open()).rejects.toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
});
it.each(["scan", "admit", "append"])("%s normalizes a missing namespace to a fixed error with no path/cause", async (method) => {
  const f = await fixture(), store = await f.open(), request = f.input(); await store.admit(request);
  await rename(f.directory, path.join(f.root, "retained-private"));
  const action = method === "scan" ? store.scan() : method === "admit" ? store.admit(f.input()) : store.append(request.operationId, "dispatch-intent", null, now);
  const error = await action.catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "WHITELIST_COMMAND_STORAGE_UNSAFE" });
  expect(String(error)).not.toContain(f.root); expect(JSON.stringify(error)).not.toContain(f.root);
  expect(error).not.toHaveProperty("cause"); expect(error).not.toHaveProperty("path");
});
