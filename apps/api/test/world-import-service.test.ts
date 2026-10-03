import { randomUUID } from "node:crypto";
import { cp, link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import type { WorldImportRequest } from "@mcsm/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import { parseProperties } from "../src/config/properties.js";
import { ActiveWorldStateStore } from "../src/services/active-world-state-store.js";
import { BackupService } from "../src/services/backup-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { TransactionJournalStore } from "../src/services/transaction-journal.js";
import { WorldCreatePlanService } from "../src/services/world-create-plan-service.js";
import { WorldImportService } from "../src/services/world-import-service.js";
import { WorldImportUploadService } from "../src/services/world-import-upload-service.js";

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
function zip(data: Buffer) {
  let crc=0xffffffff; for (const byte of data) { crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1; } crc=(crc^0xffffffff)>>>0;
  const name=Buffer.from("level.dat"),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt32LE(crc,14); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt32LE(crc,16); central.writeUInt32LE(data.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+name.length,12); end.writeUInt32LE(local.length+name.length+data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
async function complete(ops: OperationService, id: string) {
  await vi.waitFor(() => {
    expect(ops.get(id)?.state).toMatch(/^(succeeded|failed|interrupted)$/u);
    expect(ops.getServerState(ops.get(id)!.serverId).activeOperationId).toBeNull();
  }, { timeout: 10_000 });
  return ops.get(id)!;
}
async function fixture(inject?: (point: string) => Promise<void>) {
  const parent = await mkdtemp(path.join(tmpdir(), "mcsm-world-create-")); roots.push(parent);
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
  const uploads = new WorldImportUploadService(registry,ops,manager,undefined,journal); const uploaded = await uploads.upload(adapter.serverId,"world.zip",Readable.from([zip(level("imported"))]));
  const service = new WorldImportService(registry, ops, journal, backups, manager, states, clock, uploads, inject);
  const plan = await new WorldCreatePlanService(registry, ops).plan(adapter.serverId, { name: "new-world", seed: "9223372036854775807" });
  const body: WorldImportRequest = { name: plan.name, uploadId:uploaded.id,uploadRevision:(await service.plan(adapter.serverId,{name:plan.name,uploadId:uploaded.id})).uploadRevision, confirmWorldName: plan.currentWorldName,
    worldRevision: plan.worldRevision!, allowStop: false };
  return { parent, manager, server, adapter, registry, journal, store, ops, states, backups, service, body, status, start, stop, uploads };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function restarted(f: Fixture, reconcile = true, adapter = f.adapter, inject?: (point: string) => Promise<void>) {
  const registry = new AdapterRegistry([adapter]); const journal = new TransactionJournalStore(f.manager);
  const ops = new OperationService(f.store, clock, journal);
  const backups = new BackupService(registry, ops, journal, f.manager, clock);
  const states = new ActiveWorldStateStore(f.manager, [adapter]);
  const uploads = new WorldImportUploadService(registry,ops,f.manager,undefined,journal); const service = new WorldImportService(registry, ops, journal, backups, f.manager, states, clock,uploads,inject);
  if (reconcile) await service.reconcileStartup();
  await ops.initialize(); const records=(await journal.scan()).records; const importWorlds=new Map(records.filter((r)=>r.intent.worldImport && ["active","recovery-required"].includes(r.state)).map((r)=>[r.intent.serverId,[r.intent.worldImport!.previousName,r.intent.worldImport!.nextName]] as const)); ops.requireRecovery(await states.initialize(new Map(),importWorlds));
  return { ops, service, states, journal };
}
async function makeOutcomeUncertain(f: Fixture, id: string) {
  const stored = (await f.store.list()).find((record) => record.operation.id === id)!;
  await f.store.save({ ...stored, operation: { ...stored.operation, state: "running", step: "switching-world-config" } });
}
async function assertOldWorld(f: Fixture) {
  expect(await readFile(path.join(f.server, "world", "level.dat"))).toEqual(level());
  for (const dimension of ["region", "DIM-1/region", "DIM1/region", "dimensions/custom/deep/region", "playerdata"]) {
    expect(await readFile(path.join(f.server, "world", dimension, "fixture.dat"), "utf8")).toBe("old:" + dimension);
  }
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("guarded imported-world transaction", () => {
  it("previews without writes then imports, preserves all old dimensions, consumes upload and never starts",async () => {
    const f=await fixture(); const names=await readdir(f.server);
    const plan=await f.service.plan(f.adapter.serverId,{uploadId:f.body.uploadId,name:f.body.name});
    expect(plan).toMatchObject({ executionAvailable:true,currentWorldName:"world",requiresStop:false,fileCount:1 });
    expect(await readdir(f.server)).toEqual(names); expect((await f.journal.scan()).records).toHaveLength(0);
    const key=randomUUID(),op=await f.service.importWorld(f.adapter.serverId,f.body,key); const outcome=await complete(f.ops,op.id);
    expect(outcome).toMatchObject({state:"succeeded",kind:"world-import",result:{rollbackAvailable:false}});
    expect(await readFile(path.join(f.server,f.body.name,"level.dat"))).toEqual(level("imported")); await assertOldWorld(f);
    expect(parseProperties(await readFile(path.join(f.server,"server.properties"),"utf8")).get("level-name")).toBe(f.body.name);
    expect(f.states.snapshot(f.adapter.serverId)?.state).toBe("active"); expect(f.start).not.toHaveBeenCalled();
    const item=(await f.uploads.list(f.adapter.serverId)).items[0]!;
    expect(item).toMatchObject({state:"consumed",discardAllowed:false,importOperationId:op.id});
    await rm(path.join(f.manager,"world-imports",item.id,"consumed.json"));
    expect((await f.uploads.list(f.adapter.serverId)).items[0]).toMatchObject({state:"consumed",discardAllowed:false,importOperationId:op.id});
    await expect(f.uploads.discard(f.adapter.serverId,item.id,{confirmUploadId:item.id,revision:item.revision})).rejects.toMatchObject({code:"IMPORT_STAGING_UNSAFE"});
    expect((await f.service.importWorld(f.adapter.serverId,f.body,key)).id).toBe(op.id);
    await expect(f.service.importWorld(f.adapter.serverId,{...f.body,name:"other"},key)).rejects.toMatchObject({code:"OPERATION_CONFLICT"});
    const next=await restarted(f); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });
  it.each(["confirmation","revision","upload-revision","payload","version","target","state"])("rejects stale %s before intent or stop",async (reason) => {
    const f=await fixture(); let body=f.body;
    if(reason==="confirmation") body={...body,confirmWorldName:"wrong"};
    if(reason==="revision") body={...body,worldRevision:"0".repeat(64)};
    if(reason==="upload-revision") body={...body,uploadRevision:"0".repeat(64)};
    if(reason==="payload") await writeFile(path.join(f.manager,"world-imports",body.uploadId,"world","level.dat"),level("tampered"));
    if(reason==="version") vi.spyOn(f.adapter,"getServerInfo").mockResolvedValue({...(await f.adapter.getServerInfo()),minecraftVersion:"wrong"});
    if(reason==="target") await mkdir(path.join(f.server,body.name.toUpperCase()));
    if(reason==="state") {f.status.state="running";f.status.ownership="external";}
    await expect(f.service.importWorld(f.adapter.serverId,body,randomUUID())).rejects.toBeDefined();
    expect(await f.store.list()).toHaveLength(0); expect((await f.journal.scan()).records).toHaveLength(0);
    expect(await readFile(path.join(f.server,"server.properties"),"utf8")).toBe(originalProperties); await assertOldWorld(f);
    expect(f.stop).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();
  });
  it("requires stop consent and captures the post-stop world in the guard",async () => {
    const f=await fixture(); f.status.state="running";f.status.ownership="managed";
    await expect(f.service.importWorld(f.adapter.serverId,f.body,randomUUID())).rejects.toMatchObject({code:"SERVER_MUST_BE_STOPPED"});
    f.stop.mockImplementation(async () => { f.status.state="stopped";f.status.ownership="none";await writeFile(path.join(f.server,"world","level.dat"),level("at stop")); });
    const op=await f.service.importWorld(f.adapter.serverId,{...f.body,allowStop:true},randomUUID()); const outcome=await complete(f.ops,op.id);
    expect(outcome.state).toBe("succeeded"); const source=await f.backups.exportSource(f.adapter.serverId,outcome.result!.resourceId!);
    expect(await readFile(path.join(source.directory,"payload","world","level.dat"))).toEqual(level("at stop")); expect(source.manifest.pinned).toBe(true); expect(f.start).not.toHaveBeenCalled();
  });
  it.each(["intent-created","stop-confirmed","guard-verified","import-staged","world-install-intent","world-installed","config-switch-intent","config-installed","active-state-installed","before-commit"])("retains evidence and gates restart after %s",async (boundary) => {
    const f=await fixture(async(point)=>{if(point===boundary)throw new Error("interruption");});
    const op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID()); expect((await complete(f.ops,op.id)).state).toBe("interrupted");
    await assertOldWorld(f);expect(f.start).not.toHaveBeenCalled();
    const next=await restarted(f); expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    await expect(next.ops.requestLifecycle(f.adapter.serverId,"start",randomUUID(),async()=>{})).rejects.toMatchObject({code:"RECOVERY_REQUIRED"});
    expect((await f.uploads.list(f.adapter.serverId)).items[0]?.discardAllowed).toBe(false);
  });
  it("shares staging and instance locks while an import checkpoint is held",async () => {
    let release:()=>void=()=>{},entered:()=>void=()=>{};const barrier=new Promise<void>((r)=>{release=r;}),reached=new Promise<void>((r)=>{entered=r;});
    const f=await fixture(async(point)=>{if(point==="guard-verified"){entered();await barrier;}});
    const key=randomUUID(),op=await f.service.importWorld(f.adapter.serverId,f.body,key);
    try {await reached;
      expect((await f.service.importWorld(f.adapter.serverId,f.body,key)).id).toBe(op.id);
      await expect(f.uploads.upload(f.adapter.serverId,"second.zip",Readable.from([zip(level())]))).rejects.toMatchObject({code:"OPERATION_CONFLICT"});
      await expect(f.uploads.discard(f.adapter.serverId,f.body.uploadId,{confirmUploadId:f.body.uploadId,revision:f.body.uploadRevision})).rejects.toMatchObject({code:"OPERATION_CONFLICT"});
      await expect(f.ops.requestLifecycle(f.adapter.serverId,"start",randomUUID(),async()=>{})).rejects.toMatchObject({code:"OPERATION_CONFLICT"});
    } finally {release();} expect((await complete(f.ops,op.id)).state).toBe("succeeded");
  });
  it("physically confirms an uncertain durable commit, but preserves later play on established success",async () => {
    const f=await fixture(async(point)=>{if(point==="after-commit")throw new Error("crash");}); const op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());
    expect((await complete(f.ops,op.id)).state).toBe("interrupted");const next=await restarted(f);
    expect(next.ops.get(op.id)?.state).toBe("succeeded");expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
    await writeFile(path.join(f.server,f.body.name,"level.dat"),level("later play"));await writeFile(path.join(f.server,"world","level.dat"),level("archived changes"));
    const again=await restarted(f);expect(again.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });
  it.each(["target","config","guard","snapshot","root"])("does not infer an uncertain commit with invalid %s",async(reason)=>{
    const f=await fixture(),op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());const outcome=await complete(f.ops,op.id);await makeOutcomeUncertain(f,op.id);
    const record=(await f.journal.scan()).records[0]!;let adapter=f.adapter;
    if(reason==="target") await writeFile(path.join(f.server,f.body.name,"level.dat"),level("changed"));
    if(reason==="config") await writeFile(path.join(f.server,"server.properties"),originalProperties);
    if(reason==="guard") await writeFile(path.join(f.manager,"backups",f.adapter.serverId,outcome.result!.resourceId!,"payload","world","level.dat"),level("changed"));
    if(reason==="snapshot") await rm(path.join(f.server,record.intent.worldImport!.workspaceName,"properties.before"));
    if(reason==="root"){const other=path.join(f.parent,"other");await cp(f.server,other,{recursive:true});adapter={...f.adapter,plan:{...f.adapter.plan,rootPath:other}};}
    const next=await restarted(f,true,adapter);expect(next.ops.get(op.id)?.state).toBe("interrupted");expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
  });
  it("never infers committed success when physical reconcile is omitted",async()=>{
    const f=await fixture(),op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());await complete(f.ops,op.id);await makeOutcomeUncertain(f,op.id);
    const next=await restarted(f,false);expect(next.ops.get(op.id)?.state).toBe("interrupted");expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
  });
  it("explicitly restores the old configuration after failure, preserving imported/upload/guard trees across restart",async()=>{
    const f=await fixture(async(point)=>{if(point==="config-installed")throw new Error("crash");}),op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());await complete(f.ops,op.id);
    const next=await restarted(f);const plan=await next.service.recoveryPlan(f.adapter.serverId,op.id);
    const key=randomUUID(),body={operationId:op.id,confirmWorldName:plan.previousWorldName,recoveryRevision:plan.recoveryRevision};
    const recover=await next.service.recover(f.adapter.serverId,body,key);expect((await complete(next.ops,recover.id)).state).toBe("succeeded");
    expect((await next.service.recover(f.adapter.serverId,body,key)).id).toBe(recover.id);
    expect(await readFile(path.join(f.server,"server.properties"),"utf8")).toBe(originalProperties);await assertOldWorld(f);
    expect(await readFile(path.join(f.server,f.body.name,"level.dat"))).toEqual(level("imported"));
    expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);expect(next.states.snapshot(f.adapter.serverId)?.levelName).toBe("world");
    expect((await f.uploads.list(f.adapter.serverId)).items[0]?.state).toBe("consumed");expect(f.start).not.toHaveBeenCalled();
    const again=await restarted(f);expect(again.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });
  it.each(["other-cause","old-world","config","wrong-revision","missing-guard"])("refuses unsafe explicit recovery %s",async(reason)=>{
    const f=await fixture(async(point)=>{if(point==="config-installed")throw new Error("crash");}),op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());await complete(f.ops,op.id);
    const next=await restarted(f),plan=await next.service.recoveryPlan(f.adapter.serverId,op.id); const record=(await f.journal.scan()).records[0]!;
    if(reason==="other-cause")next.ops.requireRecovery([f.adapter.serverId]);
    if(reason==="old-world")await writeFile(path.join(f.server,"world","level.dat"),level("tampered"));
    if(reason==="config")await writeFile(path.join(f.server,"server.properties"),"level-name=foreign\n");
    if(reason==="missing-guard")await rm(path.join(f.manager,"backups",f.adapter.serverId,record.intent.worldImport!.guardBackupId),{recursive:true});
    await expect(next.service.recover(f.adapter.serverId,{operationId:op.id,confirmWorldName:"world",recoveryRevision:reason==="wrong-revision"?"0".repeat(64):plan.recoveryRevision},randomUUID())).rejects.toBeDefined();
    expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);expect(f.start).not.toHaveBeenCalled();
  });
  it("rejects linked configuration before journaling",async()=>{
    const f=await fixture();await link(path.join(f.server,"server.properties"),path.join(f.parent,"linked"));
    const op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());expect((await complete(f.ops,op.id)).state).toBe("failed");expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it.each(["server-directory","staging-directory"])("rejects a copied replacement %s even when content is identical",async(reason)=>{
    const f=await fixture();const target=reason==="server-directory"?f.server:path.join(f.manager,"world-imports",f.body.uploadId);
    await cp(target,target+"-copy",{recursive:true});await rm(target,{recursive:true});await cp(target+"-copy",target,{recursive:true});
    await expect(f.service.importWorld(f.adapter.serverId,f.body,randomUUID())).rejects.toBeDefined();expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it("binds preview consent to content even if private validation metadata is also replaced",async()=>{
    const f=await fixture(),directory=path.join(f.manager,"world-imports",f.body.uploadId);
    await writeFile(path.join(directory,"world","level.dat"),level("replacement"));
    const { inventoryRestoreTree,restoreFilesChecksum }=await import("../src/services/restore-files.js");const files=await inventoryRestoreTree(path.join(directory,"world"));
    const marker=JSON.parse(await readFile(path.join(directory,"validated.json"),"utf8"));
    await writeFile(path.join(directory,"validated.json"),JSON.stringify({...marker,files,checksumSha256:restoreFilesChecksum(files),sizeBytes:files.reduce((sum,f)=>sum+f.sizeBytes,0)}));
    await expect(f.service.importWorld(f.adapter.serverId,f.body,randomUUID())).rejects.toMatchObject({code:"IMPORT_STAGING_UNSAFE"});expect((await f.journal.scan()).records).toHaveLength(0);
  });
  it.each(["import-recovery-operation","import-recovery-config-intent","import-recovery-config-installed"])("retains recovery ownership after interrupted %s and allows only a fresh explicit recovery",async(boundary)=>{
    const f=await fixture(async(point)=>{if(point==="config-installed")throw new Error("crash");}),op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());await complete(f.ops,op.id);
    const next=await restarted(f,true,f.adapter,async(point)=>{if(point===boundary)throw new Error("recovery interruption");});const plan=await next.service.recoveryPlan(f.adapter.serverId,op.id);
    const recover=await next.service.recover(f.adapter.serverId,{operationId:op.id,confirmWorldName:"world",recoveryRevision:plan.recoveryRevision},randomUUID());
    expect((await complete(next.ops,recover.id)).state).toBe("interrupted");expect(next.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(true);
    const again=await restarted(f);const newPlan=await again.service.recoveryPlan(f.adapter.serverId,op.id);expect(newPlan.recoveryRevision).not.toBe(plan.recoveryRevision);
    const final=await again.service.recover(f.adapter.serverId,{operationId:op.id,confirmWorldName:"world",recoveryRevision:newPlan.recoveryRevision},randomUUID());expect((await complete(again.ops,final.id)).state).toBe("succeeded");
    expect(again.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);await assertOldWorld(f);expect(f.start).not.toHaveBeenCalled();
  });
  it("physically verifies recovery when its terminal journal survived but operation success did not",async()=>{
    const f=await fixture(async(point)=>{if(point==="config-installed")throw new Error("crash");}),op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());await complete(f.ops,op.id);
    const next=await restarted(f,true,f.adapter,async(point)=>{if(point==="recovery-after-commit")throw new Error("terminal crash");});const plan=await next.service.recoveryPlan(f.adapter.serverId,op.id);
    const recover=await next.service.recover(f.adapter.serverId,{operationId:op.id,confirmWorldName:"world",recoveryRevision:plan.recoveryRevision},randomUUID());expect((await complete(next.ops,recover.id)).state).toBe("interrupted");
    const again=await restarted(f);expect(again.ops.get(recover.id)?.state).toBe("succeeded");expect(again.ops.get(op.id)).toMatchObject({state:"failed",error:null});expect(again.ops.getServerState(f.adapter.serverId).recoveryRequired).toBe(false);
  });
  it("fails closed on legacy unbound import intent instead of inferring commit",async()=>{
    const f=await fixture();await expect(f.journal.createIntent({operationId:randomUUID(),serverId:f.adapter.serverId,kind:"world-import",scope:"world-set",resourceId:null,allowStop:false,originalState:"stopped",paths:[],createdAt:clock.now().toISOString()})).rejects.toThrow();
  });
  it.each(["target-at-install","foreign-config","target-before-commit"])("rejects %s inserted at a transaction boundary without erasing evidence",async(reason)=>{
    const f=await fixture(async(point)=>{
      if(reason==="target-at-install" && point==="world-install-intent")await mkdir(path.join(f.server,f.body.name));
      if(reason==="foreign-config" && point==="config-switch-intent")await writeFile(path.join(f.server,"server.properties"),"level-name=foreign\n");
      if(reason==="target-before-commit" && point==="before-commit")await writeFile(path.join(f.server,f.body.name,"level.dat"),level("changed at commit"));
    });
    const op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());expect((await complete(f.ops,op.id)).state).toBe("interrupted");await assertOldWorld(f);
    if(reason==="foreign-config")expect(await readFile(path.join(f.server,"server.properties"),"utf8")).toBe("level-name=foreign\n");
    if(reason==="target-at-install")expect(await readdir(path.join(f.server,f.body.name))).toEqual([]);
  });
  it("composes explicit HTTP recovery after restart and enforces same transaction confirmation",async()=>{
    const f=await fixture(async(point)=>{if(point==="config-installed")throw new Error("crash");}),op=await f.service.importWorld(f.adapter.serverId,f.body,randomUUID());await complete(f.ops,op.id);
    const app=buildApp({adapters:[f.adapter],mode:"local",clock,operationStore:f.store,transactionJournal:f.journal,managerRoot:f.manager,activeWorldState:f.states});
    const headers={host:"127.0.0.1:8080",origin:"http://127.0.0.1:3000","x-manager-intent":"local-ui"},url=`/api/v1/servers/${f.adapter.serverId}/worlds`;
    try {
      const preview=await app.inject({method:"POST",url:url+"/import-recovery-plan",headers,payload:{operationId:op.id}});
      expect(preview.statusCode).toBe(200);expect(preview.headers["cache-control"]).toBe("no-store");expect(preview.body).not.toContain(f.server);expect(preview.body).not.toContain("PRIVATE_SENTINEL");
      const body={operationId:op.id,confirmWorldName:"world",recoveryRevision:preview.json().data.recoveryRevision};
      expect((await app.inject({method:"POST",url:url+"/import-recovery",headers,payload:body})).statusCode).toBe(428);
      expect((await app.inject({method:"POST",url:url+"/import-recovery",headers:{...headers,"idempotency-key":randomUUID()},payload:{...body,confirmWorldName:f.body.name}})).statusCode).toBe(409);
      expect((await app.inject({method:"POST",url:url+"/import-recovery",headers:{...headers,"idempotency-key":randomUUID()},payload:{...body,path:f.server}})).statusCode).toBe(400);
      const response=await app.inject({method:"POST",url:url+"/import-recovery",headers:{...headers,"idempotency-key":randomUUID()},payload:body});expect(response.statusCode).toBe(202);
      await vi.waitFor(async()=>{const poll=await app.inject({method:"GET",url:`/api/v1/operations/${response.json().data.operation.id}`,headers:{host:headers.host}});expect(poll.json().data.state).toBe("succeeded");},{timeout:10000});
      expect(await readFile(path.join(f.server,"server.properties"),"utf8")).toBe(originalProperties);await assertOldWorld(f);expect(f.start).not.toHaveBeenCalled();
    } finally {await app.close();}
  });
  it("composes strict guarded HTTP preview, execute and poll with no paths or secrets",async()=>{
    const f=await fixture(),app=buildApp({adapters:[f.adapter],mode:"local",clock,operationStore:f.store,transactionJournal:f.journal,managerRoot:f.manager,activeWorldState:f.states});
    const headers={host:"127.0.0.1:8080",origin:"http://127.0.0.1:3000","x-manager-intent":"local-ui"},url=`/api/v1/servers/${f.adapter.serverId}/worlds`;
    try {
      const preview=await app.inject({method:"POST",url:url+"/import-plan",headers,payload:{uploadId:f.body.uploadId,name:f.body.name}});
      expect(preview.statusCode).toBe(200);expect(preview.headers["cache-control"]).toBe("no-store");expect(preview.body).not.toContain(f.server);expect(preview.body).not.toContain("PRIVATE_SENTINEL");
      expect((await app.inject({method:"POST",url:url+"/import",headers,payload:f.body})).statusCode).toBe(428);
      expect((await app.inject({method:"POST",url:url+"/import",headers:{...headers,"idempotency-key":randomUUID()},payload:{...f.body,allowStop:"false"}})).statusCode).toBe(400);
      const response=await app.inject({method:"POST",url:url+"/import",headers:{...headers,"idempotency-key":randomUUID()},payload:f.body});expect(response.statusCode).toBe(202);
      await vi.waitFor(async()=>{const poll=await app.inject({method:"GET",url:`/api/v1/operations/${response.json().data.operation.id}`,headers:{host:headers.host}});expect(poll.json().data.state).toBe("succeeded");},{timeout:10000});
    } finally {await app.close();}
  });
});
