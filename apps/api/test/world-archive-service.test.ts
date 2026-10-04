import { createHash, randomUUID } from "node:crypto";
import { cp, link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { WorldArchiveRequest } from "@mcsm/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import { ActiveWorldStateStore, worldIdentity } from "../src/services/active-world-state-store.js";
import { BackupService } from "../src/services/backup-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { readWorldRevision } from "../src/services/world-inventory-service.js";
import { ServerService } from "../src/services/server-service.js";
import { WorldArchiveService } from "../src/services/world-archive-service.js";
import { RestoreService } from "../src/services/restore-service.js";

const roots: string[] = [];
const clock = { now: () => new Date("2026-10-02T00:00:00Z") };
const originalProperties = "# retained comment\nlevel-name=world\nlevel-seed=17\nrcon.password=PRIVATE_SENTINEL\nmax-players=20\n";
function string(value: string): Buffer {
  const bytes = Buffer.from(value); const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}
function tag(kind: number, name: string, value: Buffer): Buffer { return Buffer.concat([Buffer.from([kind]), string(name), value]); }
function compound(name: string, children: Buffer[]): Buffer { return tag(10, name, Buffer.concat([...children, Buffer.from([0])])); }
function level(marker = "preserved", version = "26.3"): Buffer {
  return gzipSync(Buffer.concat([Buffer.from([10]), string(""), compound("Data", [
    compound("Version", [tag(8, "Name", string(version))]), tag(8, "LevelName", string(marker))
  ]), Buffer.from([0])]));
}
async function complete(ops: OperationService, id: string) {
  await vi.waitFor(() => {
    expect(ops.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u);
    expect(ops.getServerState(ops.get(id)!.serverId).activeOperationId).toBeNull();
  }, { timeout: 10_000 });
  return ops.get(id)!;
}
async function treeSnapshot(root: string): Promise<string[]> {
  const entries: string[] = [];
  const visit = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory,{ withFileTypes:true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) { entries.push(relative + "/"); await visit(path.join(directory,entry.name),relative + "/"); }
      else entries.push(relative + ":" + createHash("sha256").update(await readFile(path.join(directory,entry.name))).digest("hex"));
    }
  };
  await visit(root,""); return entries.sort();
}
async function fixture(inject?: (point: string) => Promise<void>) {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-world-archive-")); roots.push(parent);
  const manager = path.join(parent, "manager"); const server = path.join(parent, "server");
  await mkdir(manager); await mkdir(path.join(server, "world"), { recursive: true });
  await writeFile(path.join(server, "server.properties"), originalProperties);
  await writeFile(path.join(server, "world", "level.dat"), level());
  for (const dimension of ["region", "DIM-1/region", "DIM1/region", "dimensions/custom/deep/region", "playerdata"]) {
    await mkdir(path.join(server, "world", dimension), { recursive: true });
    await writeFile(path.join(server, "world", dimension, "fixture.dat"), "old:" + dimension);
  }
  const status = { state: "stopped", ownership: "none", recoveryRequired: false };
  const stop = vi.fn(async () => { status.state = "stopped"; status.ownership = "none"; });
  const start = vi.fn(async () => { status.state = "running"; status.ownership = "managed"; });
  const adapter = { serverId: "create-test", mode: "local", plan: { rootPath: server, eulaAccepted: true, serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getStatus: async () => ({ ...status, source: "process", observedAt: clock.now().toISOString(), activeOperationId: null }),
    getServerInfo: async () => ({ id: "create-test", name: "Create fixture", type: "vanilla", minecraftVersion: "26.3",
      java: { runtimeVersion: "25", requiredMajor: 25 }, detection: { confidence: "high", evidence: ["fixture"], warnings: [] } }),
    getCapabilities: async () => ({ mods: false, plugins: false, rcon: false, console: false, backup: true, worlds: true, properties: true }),
    getCommandTransport: async () => "unavailable", revalidateBeforeStart: async () => {},
    stop, start, subscribe: () => () => {}, closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]); const journal = new TransactionJournalStore(manager);
  const store = new MemoryOperationStore(); const ops = new OperationService(store, clock, journal); await ops.initialize();
  const states = new ActiveWorldStateStore(manager, [adapter]); expect((await states.initialize()).size).toBe(0);
  const backups = new BackupService(registry, ops, journal, manager, clock);
  const service = new WorldArchiveService(registry, ops, journal, backups, manager, states, clock, inject);
  const body: WorldArchiveRequest = { worldId:worldIdentity(adapter.serverId,"world"), confirmWorldName:"world", worldRevision:await readWorldRevision(adapter.serverId,"world",path.join(server,"world")), intent:"archive-world-set", allowStop:false };
  return { parent, manager, server, adapter, registry, journal, store, ops, states, backups, service, body, status, start, stop };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function restarted(f: Fixture, adapter = f.adapter) {
  const registry = new AdapterRegistry([adapter]); const journal = new TransactionJournalStore(f.manager);
  const ops = new OperationService(f.store,clock,journal); const states = new ActiveWorldStateStore(f.manager,[adapter]);
  const backups = new BackupService(registry,ops,journal,f.manager,clock);
  const service = new WorldArchiveService(registry,ops,journal,backups,f.manager,states,clock);
  const witness = await service.reconcileStartup(); await ops.initialize(); ops.requireRecovery(await states.initialize(new Map(),new Map(),witness,new Set([f.adapter.serverId])));
  return { ops,states,service,journal,registry };
}
async function uncertain(f: Fixture, id: string) {
  const stored = (await f.store.list()).find((r) => r.operation.id === id)!;
  await f.store.save({ ...stored,operation:{ ...stored.operation,state:"running",step:"archiving-world-set" } });
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root,{ recursive:true,force:true }); });

describe("P3.3 complete world-set archive",() => {
  it.each([false,true])("rejects direct and API legacy Restore/Rollback after archive (startAfter=%s)",async (startAfter) => {
    const f = await fixture(); const serverId = f.adapter.serverId;
    const backupOp = await f.backups.create(serverId,{ scope:"world-set",allowStop:false },randomUUID());
    expect((await complete(f.ops,backupOp.id)).state).toBe("succeeded");
    const [backup] = await f.backups.list(serverId);
    await writeFile(path.join(f.server,"world","level.dat"),level("before-restore"));
    const restores = new RestoreService(f.registry,f.ops,f.backups,f.journal,f.manager,clock);
    const plan = await restores.plan(serverId,backup!.id);
    const body = { restoreScope:"world-set" as const,confirmWorldName:"world",worldRevision:plan.worldRevision,allowStop:true as const,startAfterRestore:false };
    const restore = await restores.restore(serverId,backup!.id,body,randomUUID());
    expect((await complete(f.ops,restore.id)).state).toBe("succeeded");
    const rollbackPlan = await restores.rollbackPlan(serverId,restore.id);
    const archive = await f.service.archive(serverId,f.body,randomUUID());
    expect((await complete(f.ops,archive.id)).state).toBe("succeeded");
    const rollbackBody = { confirmWorldName:"world",worldRevision:rollbackPlan.worldRevision,startAfterRollback:startAfter };
    const before = await treeSnapshot(f.server);
    const state = await readFile(path.join(f.manager,"active-worlds",`${serverId}.json`));
    const records = (await f.journal.scan()).records.length;
    for (const request of [() => restores.plan(serverId,backup!.id),() => restores.restore(serverId,backup!.id,{ ...body,startAfterRestore:startAfter },randomUUID()),
      () => restores.rollbackPlan(serverId,restore.id),() => restores.rollback(serverId,restore.id,rollbackBody,randomUUID())]) {
      await expect(request()).rejects.toMatchObject({ code:"NO_ACTIVE_WORLD",statusCode:409 });
    }
    expect((await restores.history(serverId)).items).toMatchObject([{ operationId:restore.id,rollbackAvailable:false }]);
    const app = buildApp({ mode:"local",adapters:[f.adapter],managerRoot:f.manager,transactionJournal:f.journal,activeWorldState:new ActiveWorldStateStore(f.manager,[f.adapter]),operationStore:f.store,clock });
    const headers = { host:"127.0.0.1:8080",origin:"http://127.0.0.1:3000","x-manager-intent":"local-ui" };
    try {
      const restoreUrl = `/api/v1/servers/${serverId}/backups/${backup!.id}/restore`;
      const rollbackUrl = `/api/v1/servers/${serverId}/operations/${restore.id}/rollback`;
      for (const url of [restoreUrl,rollbackUrl]) {
        const response = await app.inject({ url,headers }); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("NO_ACTIVE_WORLD");
      }
      for (const [url,payload] of [[restoreUrl,{ ...body,startAfterRestore:startAfter }],[rollbackUrl,rollbackBody]] as const) {
        const response = await app.inject({ method:"POST",url,headers:{ ...headers,"idempotency-key":randomUUID() },payload });
        expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("NO_ACTIVE_WORLD");
      }
    } finally { await app.close(); }
    expect(await treeSnapshot(f.server)).toEqual(before);
    expect(await readFile(path.join(f.manager,"active-worlds",`${serverId}.json`))).toEqual(state);
    expect((await f.journal.scan()).records).toHaveLength(records);
    expect(await readdir(f.server)).not.toContain("world"); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["missing","invalid-shape","hardlink"])("keeps direct Restore locked when archived state is %s",async (reason) => {
    const f = await fixture(); const archive = await f.service.archive(f.adapter.serverId,f.body,randomUUID()); await complete(f.ops,archive.id);
    const file = path.join(f.manager,"active-worlds",`${f.adapter.serverId}.json`);
    if (reason === "missing") await rm(file);
    if (reason === "invalid-shape") await writeFile(file,JSON.stringify({ schemaVersion:1,serverId:f.adapter.serverId,state:"none",worldId:null,levelName:null }));
    if (reason === "hardlink") await link(file,path.join(f.manager,"state-link.json"));
    const restores = new RestoreService(f.registry,f.ops,f.backups,f.journal,f.manager,clock);
    await expect(restores.plan(f.adapter.serverId,randomUUID())).rejects.toMatchObject({ code:"RECOVERY_REQUIRED" });
    expect(f.start).not.toHaveBeenCalled(); expect(await readdir(f.server)).not.toContain("world");
  });
  it.each(["restore","rollback"] as const)("rechecks durable none in accepted %s executor before writes",async (kind) => {
    const f = await fixture(); const serverId = f.adapter.serverId;
    const backupOp = await f.backups.create(serverId,{ scope:"world-set",allowStop:false },randomUUID()); await complete(f.ops,backupOp.id);
    const [backup] = await f.backups.list(serverId);
    const restores = new RestoreService(f.registry,f.ops,f.backups,f.journal,f.manager,clock);
    const plan = await restores.plan(serverId,backup!.id);
    const body = { restoreScope:"world-set" as const,confirmWorldName:"world",worldRevision:plan.worldRevision,allowStop:true as const,startAfterRestore:false };
    const parent = kind === "rollback" ? await restores.restore(serverId,backup!.id,body,randomUUID()) : null;
    if (parent) await complete(f.ops,parent.id);
    const rollbackPlan = parent ? await restores.rollbackPlan(serverId,parent.id) : null;
    const save = f.store.save.bind(f.store);
    vi.spyOn(f.store,"save").mockImplementation(async (record) => {
      await save(record);
      if (record.operation.kind === kind && record.operation.state === "queued") await writeFile(path.join(f.manager,"active-worlds",`${serverId}.json`),JSON.stringify({ schemaVersion:1,serverId,state:"none",worldId:null,levelName:null,archiveTransactionId:randomUUID() }));
    });
    const before = await treeSnapshot(f.server); const records = (await f.journal.scan()).records.length;
    const op = parent ? await restores.rollback(serverId,parent.id,{ confirmWorldName:"world",worldRevision:rollbackPlan!.worldRevision,startAfterRollback:true },randomUUID()) : await restores.restore(serverId,backup!.id,{ ...body,startAfterRestore:true },randomUUID());
    expect(await complete(f.ops,op.id)).toMatchObject({ state:"failed",error:{ code:"NO_ACTIVE_WORLD" } });
    expect(await treeSnapshot(f.server)).toEqual(before); expect((await f.journal.scan()).records).toHaveLength(records);
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("renames every dimension and player data, pins a verified guard and persists restart-safe none",async () => {
    const f = await fixture(); const key = randomUUID(); const op = await f.service.archive(f.adapter.serverId,f.body,key);
    expect(await complete(f.ops,op.id)).toMatchObject({ kind:"world-archive",state:"succeeded",result:{ rollbackAvailable:false } });
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled(); expect(await readdir(f.server)).not.toContain("world");
    const [record] = (await f.journal.scan()).records; const w = record!.intent.worldArchive!;
    expect(record).toMatchObject({ schemaVersion:5,state:"committed",intent:{ worldArchive:{ levelName:"world",worldId:f.body.worldId,approvedRevision:f.body.worldRevision } } });
    expect(record!.checkpoints.map((c) => c.name)).toEqual(["stop-confirmed","guard-verified","archive-ready","archive-rename-intent","archive-renamed","active-none-intent","active-none-installed"]);
    for (const folder of ["region","DIM-1/region","DIM1/region","dimensions/custom/deep/region","playerdata"])
      expect(await readFile(path.join(f.server,w.workspaceName,"world",folder,"fixture.dat"),"utf8")).toBe("old:" + folder);
    expect(await readFile(path.join(f.server,"server.properties"),"utf8")).toBe(originalProperties);
    const guard = await f.backups.exportSource(f.adapter.serverId,w.guardBackupId);
    expect(guard.manifest).toMatchObject({ pinned:true,label:"Before World Archive",scope:"world-set",includedRoots:["world"] });
    expect(f.states.snapshot(f.adapter.serverId)).toMatchObject({ state:"none",worldId:null,levelName:null,archiveTransactionId:record!.transactionId });
    const archives = await f.service.list(f.adapter.serverId); expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({ id:w.archiveId,guardBackupId:w.guardBackupId,checksumSha256:guard.manifest.checksumSha256 });
    expect(JSON.stringify(archives)).not.toContain(f.server); expect(JSON.stringify(archives)).not.toContain("PRIVATE_SENTINEL");
    expect((await f.service.archive(f.adapter.serverId,f.body,key)).id).toBe(op.id);
    await expect(f.service.archive(f.adapter.serverId,{ ...f.body,allowStop:true },key)).rejects.toMatchObject({ code:"OPERATION_CONFLICT" });
    const next = await restarted(f); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    expect(next.states.snapshot(f.adapter.serverId)?.state).toBe("none"); expect(await next.service.list(f.adapter.serverId)).toHaveLength(1);
    const server = new ServerService(next.registry,next.ops,next.states,true,true);
    expect((await server.get(f.adapter.serverId)).readiness).toMatchObject({ start:{ allowed:false,reason:"NO_ACTIVE_WORLD" },restart:{ allowed:false,reason:"NO_ACTIVE_WORLD" } });
    for (const kind of ["start","restart"] as const) await expect(server.requestLifecycle(f.adapter.serverId,kind,randomUUID())).rejects.toMatchObject({ code:"NO_ACTIVE_WORLD" });
    f.status.state = "running"; f.status.ownership = "managed";
    for (const kind of ["start","restart"] as const) await expect(server.requestLifecycle(f.adapter.serverId,kind,randomUUID())).rejects.toMatchObject({ code:"NO_ACTIVE_WORLD" });
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it("requires stop consent, snapshots post-stop saved data and never restarts",async () => {
    const f = await fixture(); f.status.state = "running"; f.status.ownership = "managed";
    await expect(f.service.archive(f.adapter.serverId,f.body,randomUUID())).rejects.toMatchObject({ code:"SERVER_MUST_BE_STOPPED" });
    expect(await f.store.list()).toHaveLength(0);
    f.stop.mockImplementation(async () => { f.status.state = "stopped"; f.status.ownership = "none"; await writeFile(path.join(f.server,"world","level.dat"),level("saved")); });
    const op = await f.service.archive(f.adapter.serverId,{ ...f.body,allowStop:true },randomUUID()); expect((await complete(f.ops,op.id)).state).toBe("succeeded");
    const [record] = (await f.journal.scan()).records; const w = record!.intent.worldArchive!;
    expect(await readFile(path.join(f.server,w.workspaceName,"world","level.dat"))).toEqual(level("saved"));
    expect(f.stop).toHaveBeenCalledOnce(); expect(f.start).not.toHaveBeenCalled();
  });
  it.each(["wrong-name","wrong-id","revision","external","unknown","recovery","hardlink","split-layout","version"])("rejects %s before any world change",async (reason) => {
    const f = await fixture(); let body = f.body;
    if (reason === "wrong-name") body = { ...body,confirmWorldName:"wrong" };
    if (reason === "wrong-id") body = { ...body,worldId:worldIdentity(f.adapter.serverId,"wrong") };
    if (reason === "revision") await writeFile(path.join(f.server,"world","level.dat"),level("changed"));
    if (reason === "external") { f.status.state = "running"; f.status.ownership = "external"; }
    if (reason === "unknown") f.status.state = "unknown";
    if (reason === "recovery") f.ops.requireRecovery([f.adapter.serverId]);
    if (reason === "hardlink") await link(path.join(f.server,"world","level.dat"),path.join(f.server,"external.dat"));
    if (reason === "split-layout") await mkdir(path.join(f.server,"world_nether"));
    if (reason === "version") { await writeFile(path.join(f.server,"world","level.dat"),level("same","old")); body = { ...body,worldRevision:await readWorldRevision(f.adapter.serverId,"world",path.join(f.server,"world")) }; }
    await expect(f.service.archive(f.adapter.serverId,body,randomUUID())).rejects.toBeDefined();
    expect((await f.journal.scan()).records).toHaveLength(0); expect(await readdir(f.server)).toContain("world"); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["intent-created","stop-confirmed","guard-verified","archive-ready","archive-rename-intent","before-rename","after-rename","archive-renamed","active-none-intent","after-none-write","active-none-installed","before-commit"])("retains all evidence and restart recovery gate at %s",async (boundary) => {
    const f = await fixture(async (point) => { if (point === boundary) throw new Error("archive injected " + boundary); });
    const op = await f.service.archive(f.adapter.serverId,f.body,randomUUID()); expect(await complete(f.ops,op.id)).toMatchObject({ state:"interrupted",error:{ code:"RECOVERY_REQUIRED" } });
    const [record] = (await f.journal.scan()).records; const w = record!.intent.worldArchive!;
    const moved = ["after-rename","archive-renamed","active-none-intent","after-none-write","active-none-installed","before-commit"].includes(boundary);
    expect(await readFile(path.join(f.server,...(moved ? [w.workspaceName,"world"] : ["world"]),"DIM-1/region/fixture.dat"),"utf8")).toBe("old:DIM-1/region");
    if (record!.checkpoints.some((c) => c.name === "guard-verified")) expect((await f.backups.exportSource(f.adapter.serverId,w.guardBackupId)).manifest.pinned).toBe(true);
    expect((await restarted(f)).ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true); expect(f.start).not.toHaveBeenCalled();
  });
  it("physically reconciles an uncertain committed operation",async () => {
    const f = await fixture(); const op = await f.service.archive(f.adapter.serverId,f.body,randomUUID()); await complete(f.ops,op.id); await uncertain(f,op.id);
    const next = await restarted(f); expect(next.ops.get(op.id)?.state).toBe("succeeded"); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });
  it("requires physical evidence after committed checkpoint interruption",async () => {
    const f = await fixture(async (point) => { if (point === "after-commit") throw new Error("lost final outcome"); });
    const op = await f.service.archive(f.adapter.serverId,f.body,randomUUID()); expect((await complete(f.ops,op.id)).state).toBe("interrupted");
    const next = await restarted(f); expect(next.ops.get(op.id)?.state).toBe("succeeded"); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });
  it.each(["linked-entry","destination-conflict","source-replaced","save-unconfirmed","post-intent-change"])("retains data without fallback at %s",async (reason) => {
    const f = await fixture(async (point) => {
      if (reason === "destination-conflict" && point === "before-rename") {
        const [record] = (await f.journal.scan()).records; const destination = path.join(f.server,record!.intent.worldArchive!.workspaceName,"world");
        await mkdir(destination); await writeFile(path.join(destination,"retained.dat"),"unrelated-data");
      }
      if (reason === "source-replaced" && point === "guard-verified") {
        await rename(path.join(f.server,"world"),path.join(f.server,"retained-old-world"));
        await cp(path.join(f.server,"retained-old-world"),path.join(f.server,"world"),{ recursive:true });
      }
      if (reason === "post-intent-change" && point === "archive-rename-intent") await writeFile(path.join(f.server,"world","playerdata/fixture.dat"),"external-change");
    });
    if (reason === "linked-entry") {
      const external = path.join(f.parent,"external-data"); await mkdir(external); await writeFile(path.join(external,"retained.dat"),"untouched");
      await symlink(external,path.join(f.server,"world","linked-data"),process.platform === "win32" ? "junction" : "dir");
    }
    if (reason === "save-unconfirmed") { f.status.state = "running"; f.status.ownership = "managed"; f.stop.mockImplementation(async () => {}); }
    if (reason === "linked-entry") await expect(f.service.archive(f.adapter.serverId,f.body,randomUUID())).rejects.toBeDefined();
    else {
      const op = await f.service.archive(f.adapter.serverId,{ ...f.body,allowStop:true },randomUUID()); expect((await complete(f.ops,op.id)).state).toBe("interrupted");
    }
    expect(await readdir(f.server)).toContain("world"); expect(f.start).not.toHaveBeenCalled();
    if (reason === "destination-conflict") {
      const [record] = (await f.journal.scan()).records;
      expect(await readFile(path.join(f.server,record!.intent.worldArchive!.workspaceName,"world/retained.dat"),"utf8")).toBe("unrelated-data");
    }
  });
  it.each(["archive-content","archive-identity","source-recreated","state-missing","state-tampered","root-rebound","guard-tampered"])("gates established success when %s changes",async (reason) => {
    const f = await fixture(); const op = await f.service.archive(f.adapter.serverId,f.body,randomUUID()); await complete(f.ops,op.id);
    const [record] = (await f.journal.scan()).records; const w = record!.intent.worldArchive!; let adapter = f.adapter;
    if (reason === "archive-content") await writeFile(path.join(f.server,w.workspaceName,"world","playerdata/fixture.dat"),"tampered");
    if (reason === "archive-identity") { await rename(path.join(f.server,w.workspaceName),path.join(f.server,"old-archive")); await cp(path.join(f.server,"old-archive"),path.join(f.server,w.workspaceName),{ recursive:true }); }
    if (reason === "source-recreated") await mkdir(path.join(f.server,"world"));
    if (reason === "state-missing") await rm(path.join(f.manager,"active-worlds",`${f.adapter.serverId}.json`));
    if (reason === "state-tampered") await writeFile(path.join(f.manager,"active-worlds",`${f.adapter.serverId}.json`),JSON.stringify({ schemaVersion:1,serverId:f.adapter.serverId,state:"none",worldId:null,levelName:null,archiveTransactionId:randomUUID() }));
    if (reason === "root-rebound") { const other = path.join(f.parent,"replacement"); await cp(f.server,other,{ recursive:true }); adapter = { ...f.adapter,plan:{ ...f.adapter.plan,rootPath:other } }; }
    if (reason === "guard-tampered") { const guard = await f.backups.exportSource(f.adapter.serverId,w.guardBackupId); await writeFile(path.join(guard.directory,"payload/world/level.dat"),"broken"); }
    const next = await restarted(f,adapter); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    if (reason === "state-missing") await expect(readFile(path.join(f.manager,"active-worlds",`${f.adapter.serverId}.json`))).rejects.toMatchObject({ code:"ENOENT" });
    expect(f.start).not.toHaveBeenCalled();
  });
  it("prevents concurrent lifecycle and archive operations through shared admission",async () => {
    let release = () => {}; const pause = new Promise<void>((resolve) => { release = resolve; });
    const f = await fixture(async (point) => { if (point === "guard-verified") await pause; });
    const op = await f.service.archive(f.adapter.serverId,f.body,randomUUID());
    const server = new ServerService(f.registry,f.ops,f.states,true,true);
    await expect(f.service.archive(f.adapter.serverId,f.body,randomUUID())).rejects.toMatchObject({ code:"OPERATION_CONFLICT" });
    await expect(server.requestLifecycle(f.adapter.serverId,"start",randomUUID())).rejects.toMatchObject({ code:"OPERATION_CONFLICT" });
    release(); expect((await complete(f.ops,op.id)).state).toBe("succeeded");
  });
  it("strict API rejects paths, coercion, missing intent/key and serves no-active-world inventory after restart",async () => {
    const f = await fixture(); const app = buildApp({ mode:"local",adapters:[f.adapter],managerRoot:f.manager,transactionJournal:f.journal,activeWorldState:f.states,operationStore:f.store,clock });
    const headers = { host:"127.0.0.1:8080",origin:"http://127.0.0.1:3000","x-manager-intent":"local-ui","idempotency-key":randomUUID() };
    try {
      for (const body of [{ ...f.body,path:"C:/escape" },{ ...f.body,allowStop:"true" },{ ...f.body,intent:"delete" }]) {
        const response = await app.inject({ method:"POST",url:`/api/v1/servers/${f.adapter.serverId}/worlds/archive`,headers,payload:body }); expect(response.statusCode).toBe(400);
      }
      const noKey = await app.inject({ method:"POST",url:`/api/v1/servers/${f.adapter.serverId}/worlds/archive`,headers:{ ...headers,"idempotency-key":"invalid" },payload:f.body }); expect(noKey.statusCode).toBe(428);
      const response = await app.inject({ method:"POST",url:`/api/v1/servers/${f.adapter.serverId}/worlds/archive`,headers,payload:f.body }); expect(response.statusCode).toBe(202);
      const id = response.json().data.operation.id;
      await vi.waitFor(async () => expect((await app.inject({ url:`/api/v1/operations/${id}`,headers })).json().data.state).toBe("succeeded"),{ timeout:10000 });
    } finally { await app.close(); }
    const app2 = buildApp({ mode:"local",adapters:[f.adapter],managerRoot:f.manager,transactionJournal:f.journal,activeWorldState:new ActiveWorldStateStore(f.manager,[f.adapter]),operationStore:f.store,clock });
    try {
      expect((await app2.inject({ url:`/api/v1/servers/${f.adapter.serverId}/worlds`,headers })).json().data.items).toEqual([]);
      expect((await app2.inject({ url:`/api/v1/servers/${f.adapter.serverId}/worlds/archives`,headers })).json().data.items).toHaveLength(1);
      const start = await app2.inject({ method:"POST",url:`/api/v1/servers/${f.adapter.serverId}/actions/start`,headers,payload:{} }); expect(start.statusCode).toBe(409); expect(start.json().error.code).toBe("NO_ACTIVE_WORLD");
    } finally { await app2.close(); }
  });
});
