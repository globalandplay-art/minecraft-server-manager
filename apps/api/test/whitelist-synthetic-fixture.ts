import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, link, unlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { WindowsPrivateAclVerifier } from "../src/auth/windows-private-acl.js";
import { AuthCoreError } from "../src/auth/password.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore, type StoredOperation } from "../src/services/operation-store.js";
import { WhitelistCommandStore, type WhitelistCommandPublication } from "../src/services/whitelist-command-store.js";
import { WhitelistGuardStore } from "../src/services/whitelist-guard-store.js";
import { whitelistCommandHash, whitelistCommandRequestHash, type WhitelistCommandRecord } from "../src/services/whitelist-command-record.js";
import { whitelistMemberRevision, type WhitelistMemberSnapshot } from "../src/services/whitelist-member-policy.js";
import { SyntheticWhitelistCoordinator, type SyntheticWhitelistRuntime, type SyntheticWhitelistReceipt } from "../src/services/whitelist-synthetic-coordinator.js";

export class SyntheticRuntime implements SyntheticWhitelistRuntime {
  members = [{ name: "Player_One", uuid: "123e4567-e89b-42d3-a456-426614174000" }];
  runtimeId = randomUUID(); generation = 0; calls = 0; lost = false; unavailable = false;
  rootIdentity = "a".repeat(64);
  duringDispatch: () => Promise<void> = async () => {};
  readonly receipts = new Map<string, SyntheticWhitelistReceipt>();
  readonly evidence = new Map<string, Awaited<ReturnType<SyntheticRuntime["capture"]>>>();
  snapshot(serverId = "test"): WhitelistMemberSnapshot {
    return { serverId, rootIdentity: this.rootIdentity, configRevision: "b".repeat(64), fileIdentity: whitelistCommandHash(`file-${this.generation}`),
      fileSha256: whitelistCommandHash(JSON.stringify(this.members)), runtimeId: this.runtimeId, members: structuredClone(this.members) };
  }
  async registeredRoot(serverId: string) { return serverId === "test" ? this.rootIdentity : null; }
  async capture(serverId: string) {
    if (this.unavailable || serverId !== "test") throw new Error("fake-runtime-unavailable");
    return { snapshot: this.snapshot(serverId), bytes: Buffer.from(JSON.stringify(this.members)), runtimeNames: this.members.map((row) => row.name) };
  }
  async dispatch(intent: WhitelistCommandRecord, authorize: () => void) {
    await this.duringDispatch();
    const snapshot = this.snapshot(intent.serverId);
    if (this.unavailable || intent.runtimeId !== this.runtimeId || intent.serverRootIdentity !== snapshot.rootIdentity ||
      intent.request.revision !== whitelistMemberRevision(snapshot)) throw new Error("fake-lease-invalid");
    authorize(); this.calls++;
    if (intent.request.action === "add") this.members.push({ name: intent.request.name, uuid: "123e4567-e89b-42d3-a456-426614174001" });
    else this.members = this.members.filter((row) => row.name.toLowerCase() !== intent.request.name.toLowerCase());
    this.generation++;
    const receipt: SyntheticWhitelistReceipt = { mode: "synthetic-whitelist-v1", operationId: intent.operationId, serverId: intent.serverId,
      runtimeId: this.runtimeId, requestHash: whitelistCommandRequestHash(intent.serverId, intent.request), beforeSha256: snapshot.fileSha256,
      afterSha256: this.snapshot(intent.serverId).fileSha256 };
    this.receipts.set(whitelistCommandHash(JSON.stringify(receipt)), receipt);
    this.evidence.set(whitelistCommandHash(JSON.stringify(receipt)), await this.capture(intent.serverId));
    if (this.lost) throw new Error("fake-response-lost"); return receipt;
  }
  async receipt(hash: string) { return structuredClone(this.receipts.get(hash) ?? null); }
  async recordedEvidence(hash: string) {
    const value = this.evidence.get(hash); return value ? { snapshot: structuredClone(value.snapshot), bytes: Buffer.from(value.bytes), runtimeNames: [...value.runtimeNames] } : null;
  }
}
class FakeAcl extends WindowsPrivateAclVerifier {
  beforeCheck: () => Promise<void> = async () => {};
  override async verifyMany(files: readonly string[]) { await this.beforeCheck(); return files.map(() => "synthetic-acl"); }
}
export class SyntheticOperationStore extends MemoryOperationStore {
  failSuccessOnce = false;
  duringSave: (record: StoredOperation) => Promise<void> = async () => {};
  override async save(record: StoredOperation) {
    await this.duringSave(record);
    if (this.failSuccessOnce && record.operation.kind === "whitelist-change" && record.operation.state === "succeeded") {
      this.failSuccessOnce = false; throw new Error("fake-terminal-write-failed");
    }
    await super.save(record);
  }
}
export async function syntheticFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-whitelist-integration-")); let busy = false, writes = 0, held = true;
  const activities = new Set<symbol>();
  const owner = { assertHeld: (file: string) => { if (file !== root || !held) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE"); }, rootIdentity: () => whitelistCommandHash(root),
    beginOfflineMutation: (file: string) => { owner.assertHeld(file); if (busy) throw new AuthCoreError("AUTH_BUSY"); busy = true; return () => { busy = false; }; },
    beginActivity: (file: string) => { owner.assertHeld(file); const token = Symbol(); activities.add(token); return () => { activities.delete(token); return undefined; }; },
    release: () => { if (busy || activities.size) throw new AuthCoreError("AUTH_BUSY"); held = false; },
    forceLoss: () => { held = false; } };
  const acl = new FakeAcl(), runtime = new SyntheticRuntime(), opStore = new SyntheticOperationStore();
  let now = new Date("2026-10-14T00:00:00.000Z"); const clock = { now: () => new Date(now) };
  const publication: WhitelistCommandPublication = { createDirectory: async (file) => { writes++; await mkdir(file); },
    writeNew: async (file, bytes) => { writes++; await writeFile(file, bytes, { flag: "wx" }); },
    publishNew: async (stage, target) => { writes++; await link(stage, target); await unlink(stage); } };
  const open = async (pub = publication) => {
    const operations = new OperationService(opStore, clock); await operations.initialize();
    const commands = await WhitelistCommandStore.open(root, owner, acl, pub), guards = await WhitelistGuardStore.open(root, owner, acl, pub);
    const service = new SyntheticWhitelistCoordinator(operations, commands, guards, runtime, clock, owner); await service.initialize();
    return { operations, commands, guards, service };
  };
  const request = (action: "add" | "remove" = "add", name = "Player_Two") => ({ action, name, confirm: true as const, revision: whitelistMemberRevision(runtime.snapshot()) });
  return { root, owner, acl, runtime, opStore, clock, publication, open, request, writes: () => writes, activities: () => activities.size,
    setNow: (value: string) => { now = new Date(value); } };
}
