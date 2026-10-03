import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { systemClock } from "../src/clock.js";
import { errorResponse, installLocalRequestGuard } from "../src/infra/http.js";
import { DomainError } from "../src/services/domain-errors.js";
import { registerWorldImportUploadRoutes } from "../src/routes/world-import-uploads.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";
import { WorldImportUploadService } from "../src/services/world-import-upload-service.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function text(value: string) { const bytes = Buffer.from(value), length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length, bytes]); }
function zip() {
  const data = gzipSync(Buffer.concat([Buffer.from([10]), text(""), Buffer.from([10]), text("Data"), Buffer.from([10]), text("Version"), Buffer.from([8]), text("Name"), text("26.3"), Buffer.from([0,0,0])]));
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  crc = (crc ^ 0xffffffff) >>> 0;
  const name = Buffer.from("level.dat"), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt32LE(crc,14); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt32LE(crc,16); central.writeUInt32LE(data.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length + name.length,12); end.writeUInt32LE(local.length + name.length + data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-upload-")); roots.push(root);
  const manager = path.join(root,"private"), server = path.join(root,"server");
  await mkdir(manager); await mkdir(server); await mkdir(path.join(server,"world"));
  await writeFile(path.join(server,"world","sentinel"), "original");
  await writeFile(path.join(server,"server.properties"), "rcon.password=never-public");
  const state = { state: "stopped", ownership: "none", recoveryRequired: false };
  const adapter = { serverId: "test", mode: "local", plan: { rootPath: server, serverInfo: { type: "vanilla" } },
    getStatus: async () => state, getServerInfo: async () => ({ minecraftVersion: "26.3" }) } as unknown as LocalMinecraftServerAdapter;
  const operations = new OperationService(new MemoryOperationStore(), systemClock); await operations.initialize();
  const service = new WorldImportUploadService(new AdapterRegistry([adapter]), operations, manager);
  return { root, manager, server, state, adapter, operations, service };
}
describe("P3.3c private stream upload", () => {
  it("validates a streamed world, binds its private owner and never changes the server", async () => {
    const f = await fixture(), bytes = zip();
    const result = await f.service.upload("test", "测试.zip", Readable.from([bytes.subarray(0,11),bytes.subarray(11)]));
    expect(result).toMatchObject({ state: "validated", executionAvailable: false, fileCount: 1, minecraftVersion: "26.3" });
    expect(JSON.stringify(result)).not.toContain(f.server); expect(JSON.stringify(result)).not.toContain("never-public");
    const directory = path.join(f.manager,"world-imports",result.id);
    expect(JSON.parse(await readFile(path.join(directory,"owner.json"),"utf8"))).toMatchObject({ serverId: "test", serverRoot: f.server });
    expect(JSON.parse(await readFile(path.join(directory,"validated.json"),"utf8"))).toMatchObject({ checksumSha256: result.checksumSha256 });
    expect(await readFile(path.join(f.server,"world","sentinel"),"utf8")).toBe("original");
    expect(await readdir(f.server)).toEqual(["server.properties","world"]);
  });
  it.each(["../x.zip","C:\\x.zip","x.jar","", " x.zip"])("rejects filename %s before creating private storage", async (filename) => {
    const f = await fixture(); await expect(f.service.upload("test",filename,Readable.from([zip()]))).rejects.toMatchObject({ statusCode: 400 });
    expect(await readdir(f.manager)).toEqual([]);
  });
  it("retains bad/interrupted evidence, bounds slots, and refuses a fourth upload", async () => {
    const f = await fixture();
    for (let index=0;index<3;index++) await expect(f.service.upload("test","x.zip",Readable.from(["invalid"]))).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_UNSAFE" });
    expect(await readdir(path.join(f.manager,"world-imports"))).toHaveLength(3);
    await expect(f.service.upload("test","x.zip",Readable.from([zip()]))).rejects.toMatchObject({ code: "IMPORT_STAGING_QUOTA" });
    expect(f.operations.getServerState("test").activeOperationId).toBeNull();
  });
  it("refuses recovery and external process states before receiving bytes", async () => {
    const f = await fixture(); f.operations.requireRecovery(["test"]);
    await expect(f.service.upload("test","x.zip",Readable.from([zip()]))).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    const other = await fixture(); other.state.state="running";other.state.ownership="external";
    await expect(other.service.upload("test","x.zip",Readable.from([zip()]))).rejects.toMatchObject({ code: "SERVER_STATE_CONFLICT" });
    expect(await readdir(other.manager)).toEqual([]);
  });
  it("locks upload admission across overlapping streams and releases on failure", async () => {
    const f = await fixture(), stream = new Readable({ read() {} });
    const first = f.service.upload("test","x.zip",stream);
    await expect(f.service.upload("test","x.zip",Readable.from([zip()]))).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    stream.push("bad");stream.push(null);await expect(first).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_UNSAFE" });
    expect((await f.service.upload("test","good.zip",Readable.from([zip()]))).state).toBe("validated");
  });
  it("enforces actual streamed bytes without trusting Content-Length", async () => {
    const f=await fixture();
    await expect(f.service.upload("test","large.zip",Readable.from([Buffer.alloc(128*1024**2+1)]))).rejects.toMatchObject({ code: "UPLOAD_TOO_LARGE" });
    const [id]=await readdir(path.join(f.manager,"world-imports"));
    expect((await readFile(path.join(f.manager,"world-imports",id!,"upload.zip"))).length).toBe(0);
  });
  it("retains an interrupted stream and releases locks without requiring world recovery", async () => {
    const f=await fixture();
    async function* interrupted() { yield Buffer.from("partial"); throw new Error("client disconnected"); }
    await expect(f.service.upload("test","x.zip",Readable.from(interrupted()))).rejects.toThrow("client disconnected");
    const [id]=await readdir(path.join(f.manager,"world-imports"));
    expect(await readFile(path.join(f.manager,"world-imports",id!,"upload.zip"),"utf8")).toBe("partial");
    expect(f.operations.getServerState("test").recoveryRequired).toBe(false);
    expect((await f.service.upload("test","x.zip",Readable.from([zip()]))).state).toBe("validated");
  });
  it("times out a stalled receive and releases admission", async () => {
    const f=await fixture(),stream=new Readable({read(){}});
    vi.useFakeTimers();
    try {
      const outcome=f.service.upload("test","x.zip",stream).then(() => null,(error: unknown) => error);
      await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await outcome).toMatchObject({code:"IMPORT_UPLOAD_TIMEOUT"});
    } finally {vi.useRealTimers();}
    expect((await f.service.upload("test","x.zip",Readable.from([zip()]))).state).toBe("validated");
  });
  it("refuses a linked staging root without writing into its target", async () => {
    const f=await fixture(),outside=path.join(f.root,"outside");await mkdir(outside);
    await symlink(outside,path.join(f.manager,"world-imports"),process.platform==="win32"?"junction":"dir");
    await expect(f.service.upload("test","x.zip",Readable.from([zip()]))).rejects.toMatchObject({code:"RESTORE_LAYOUT_UNSAFE"});
    expect(await readdir(outside)).toEqual([]);
  });
  it("serializes across server IDs and preserves the quota across manager recreation", async () => {
    const f=await fixture(),other={...f.adapter,serverId:"other"} as LocalMinecraftServerAdapter;
    const registry=new AdapterRegistry([f.adapter,other]);
    const service=new WorldImportUploadService(registry,f.operations,f.manager);
    const stream=new Readable({read(){}}),first=service.upload("test","x.zip",stream);
    await expect(service.upload("other","x.zip",Readable.from([zip()]))).rejects.toMatchObject({code:"OPERATION_CONFLICT"});
    stream.push("bad");stream.push(null);await expect(first).rejects.toMatchObject({code:"IMPORT_ARCHIVE_UNSAFE"});
    await service.upload("test","x.zip",Readable.from([zip()]));await service.upload("other","x.zip",Readable.from([zip()]));
    const recreated=new WorldImportUploadService(registry,f.operations,f.manager);
    await expect(recreated.upload("test","x.zip",Readable.from([zip()]))).rejects.toMatchObject({code:"IMPORT_STAGING_QUOTA"});
  });
  it("serves successful ZIP streams through the real HTTP parser with private schema", async () => {
    const f=await fixture(),app=fastify();app.addHook("onRequest",installLocalRequestGuard(systemClock,"local"));
    registerWorldImportUploadRoutes(app,f.service,systemClock,"local");
    try {
      const response=await app.inject({method:"POST",url:"/api/v1/servers/test/worlds/import-uploads",headers:{host:"localhost:8080",origin:"http://localhost:3000",
        "x-manager-intent":"local-ui","content-type":"application/zip","x-upload-filename":encodeURIComponent("世界.zip")},payload:zip()});
      expect(response.statusCode).toBe(201);expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().data).toMatchObject({ executionAvailable:false,state:"validated",fileCount:1 });
      expect(response.body).not.toContain(f.server);expect(response.body).not.toContain("never-public");
    } finally {await app.close();}
  });
  it("lists owned artifacts after recreation, discards only confirmed staging and frees capacity", async () => {
    const f=await fixture();const uploaded=await f.service.upload("test","x.zip",Readable.from([zip()]));
    const recreated=new WorldImportUploadService(new AdapterRegistry([f.adapter]),f.operations,f.manager);
    const list=await recreated.list("test");expect(list).toMatchObject({occupiedSlots:1,limit:3,items:[{id:uploaded.id,state:"validated",discardAllowed:true}]});
    expect(JSON.stringify(list)).not.toContain(f.server);expect(JSON.stringify(list)).not.toContain("never-public");
    await recreated.discard("test",uploaded.id,{confirmUploadId:uploaded.id,revision:list.items[0]!.revision});
    expect(await recreated.list("test")).toMatchObject({items:[],occupiedSlots:0});
    expect(await readFile(path.join(f.server,"world","sentinel"),"utf8")).toBe("original");
    expect(await readFile(path.join(f.server,"server.properties"),"utf8")).toBe("rcon.password=never-public");
  });
  it("allows explicitly discarding an incomplete failed upload", async () => {
    const f=await fixture();await expect(f.service.upload("test","x.zip",Readable.from(["bad"]))).rejects.toMatchObject({code:"IMPORT_ARCHIVE_UNSAFE"});
    const {items}=await f.service.list("test");expect(items[0]).toMatchObject({state:"incomplete",discardAllowed:true});
    await f.service.discard("test",items[0]!.id,{confirmUploadId:items[0]!.id,revision:items[0]!.revision});
    expect((await f.service.list("test")).occupiedSlots).toBe(0);
  });
  it("rejects stale revisions, wrong confirmation and path-like IDs without deleting", async () => {
    const f=await fixture();const uploaded=await f.service.upload("test","x.zip",Readable.from([zip()]));
    const {items}=await f.service.list("test");const request={confirmUploadId:uploaded.id,revision:items[0]!.revision};
    await expect(f.service.discard("test",uploaded.id,{...request,revision:"a".repeat(64)})).rejects.toMatchObject({code:"IMPORT_STAGING_UNSAFE"});
    await expect(f.service.discard("test",uploaded.id,{...request,confirmUploadId:"wrong"})).rejects.toMatchObject({statusCode:400});
    await expect(f.service.discard("test","../escape",request)).rejects.toMatchObject({statusCode:400});
    expect((await f.service.list("test")).occupiedSlots).toBe(1);
  });
  it("hides another server's artifact and rejects cross-server discard", async () => {
    const f=await fixture(),uploaded=await f.service.upload("test","x.zip",Readable.from([zip()]));
    const {items}=await f.service.list("test");const other={...f.adapter,serverId:"other"} as LocalMinecraftServerAdapter;
    const service=new WorldImportUploadService(new AdapterRegistry([f.adapter,other]),f.operations,f.manager);
    expect(await service.list("other")).toMatchObject({items:[],occupiedSlots:1});
    await expect(service.discard("other",uploaded.id,{confirmUploadId:uploaded.id,revision:items[0]!.revision})).rejects.toMatchObject({statusCode:404});
  });
  it("locks legacy ownership and same-path replaced roots against automatic discard", async () => {
    const f=await fixture(),uploaded=await f.service.upload("test","x.zip",Readable.from([zip()]));
    const {items}=await f.service.list("test");await rename(f.server,f.server+"-original");await mkdir(f.server);
    expect((await f.service.list("test")).items[0]).toMatchObject({state:"identity-unverified",discardAllowed:false});
    await expect(f.service.discard("test",uploaded.id,{confirmUploadId:uploaded.id,revision:items[0]!.revision})).rejects.toMatchObject({code:"IMPORT_STAGING_UNSAFE"});
    await rm(f.server,{recursive:true});await rename(f.server+"-original",f.server);
    const ownerPath=path.join(f.manager,"world-imports",uploaded.id,"owner.json");const owner=JSON.parse(await readFile(ownerPath,"utf8"));delete owner.rootIdentity;delete owner.directoryIdentity;await writeFile(ownerPath,JSON.stringify(owner));
    expect((await f.service.list("test")).items[0]).toMatchObject({state:"identity-unverified",discardAllowed:false});
  });
  it.each(["symlink","hardlink"])("rejects a %s anywhere in staging before the first deletion",async (kind)=>{
    const f=await fixture(),uploaded=await f.service.upload("test","x.zip",Readable.from([zip()]));
    const {items}=await f.service.list("test"),outside=path.join(f.root,"outside");await mkdir(outside);await writeFile(path.join(outside,"sentinel"),"preserve");
    const artifact=path.join(f.manager,"world-imports",uploaded.id);
    if(kind==="symlink")await symlink(outside,path.join(artifact,"link"),process.platform==="win32"?"junction":"dir");
    else await link(path.join(outside,"sentinel"),path.join(artifact,"linked-file"));
    await expect(f.service.discard("test",uploaded.id,{confirmUploadId:uploaded.id,revision:items[0]!.revision})).rejects.toMatchObject({code:"IMPORT_STAGING_UNSAFE"});
    expect(await readFile(path.join(outside,"sentinel"),"utf8")).toBe("preserve");expect(await readFile(path.join(artifact,"upload.zip"))).toEqual(zip());
  });
  it.each(["EACCES","interrupted"])("keeps durable discard ownership across %s after owner unlink and allows an explicit retry",async (failure)=>{
    const f=await fixture(),uploaded=await f.service.upload("test","x.zip",Readable.from([zip()]));
    const {items}=await f.service.list("test");
    const failing=new WorldImportUploadService(new AdapterRegistry([f.adapter]),f.operations,f.manager,async (point)=>{
      if(point==="before-final-rmdir")throw Object.assign(new Error(failure),{code:failure});
    });
    await expect(failing.discard("test",uploaded.id,{confirmUploadId:uploaded.id,revision:items[0]!.revision})).rejects.toThrow(failure);
    expect(await readdir(path.join(f.manager,"world-imports",uploaded.id))).toEqual([]);
    expect(await readFile(path.join(f.manager,"world-import-discard-owners",uploaded.id+".json"),"utf8")).toContain(uploaded.id);
    const recreated=new WorldImportUploadService(new AdapterRegistry([f.adapter]),f.operations,f.manager);
    const retained=await recreated.list("test");expect(retained.items[0]).toMatchObject({state:"incomplete",discardAllowed:true});
    await recreated.discard("test",uploaded.id,{confirmUploadId:uploaded.id,revision:retained.items[0]!.revision});
    expect((await recreated.list("test")).occupiedSlots).toBe(0);
    expect(await readdir(path.join(f.manager,"world-import-discard-owners"))).toEqual([]);
  });
  it.each(["discard-owner-before-write","discard-owner-before-sync"])("publishes no partial receipt on %s failure and permits a fresh explicit retry",async (point)=>{
    const f=await fixture(),uploaded=await f.service.upload("test","x.zip",Readable.from([zip()]));
    const {items}=await f.service.list("test"),body={confirmUploadId:uploaded.id,revision:items[0]!.revision};
    const failing=new WorldImportUploadService(new AdapterRegistry([f.adapter]),f.operations,f.manager,async (actual)=>{if(actual===point)throw new Error("receipt failed");});
    await expect(failing.discard("test",uploaded.id,body)).rejects.toThrow("receipt failed");
    expect(await readFile(path.join(f.manager,"world-imports",uploaded.id,"upload.zip"))).toEqual(zip());
    await expect(readFile(path.join(f.manager,"world-import-discard-owners",uploaded.id+".json"))).rejects.toMatchObject({code:"ENOENT"});
    await f.service.discard("test",uploaded.id,body);expect((await f.service.list("test")).occupiedSlots).toBe(0);
  });
  it("requires synchronizing an existing receipt on every retry before deleting",async ()=>{
    const f=await fixture(),uploaded=await f.service.upload("test","x.zip",Readable.from([zip()]));
    const {items}=await f.service.list("test"),body={confirmUploadId:uploaded.id,revision:items[0]!.revision};
    const afterOwner=new WorldImportUploadService(new AdapterRegistry([f.adapter]),f.operations,f.manager,async(point)=>{if(point==="before-final-rmdir")throw new Error("rmdir failed");});
    await expect(afterOwner.discard("test",uploaded.id,body)).rejects.toThrow("rmdir failed");
    const syncing=new WorldImportUploadService(new AdapterRegistry([f.adapter]),f.operations,f.manager,async(point)=>{if(point==="discard-owner-before-sync")throw new Error("sync failed");});
    await expect(syncing.discard("test",uploaded.id,body)).rejects.toThrow("sync failed");
    expect((await f.service.list("test")).occupiedSlots).toBe(1);
    await f.service.discard("test",uploaded.id,body);expect((await f.service.list("test")).occupiedSlots).toBe(0);
  });
});
describe("raw upload HTTP boundary", () => {
  it("lists and explicitly discards through guarded HTTP, rejecting extra fields before writes",async ()=>{
    const f=await fixture(),uploaded=await f.service.upload("test","x.zip",Readable.from([zip()])),app=fastify();
    app.addHook("onRequest",installLocalRequestGuard(systemClock,"local"));
    app.setErrorHandler((error,req,reply)=>reply.code(error instanceof DomainError?error.statusCode:400).send(errorResponse(req.id,systemClock,"VALIDATION_ERROR","请求被拒绝","local")));
    registerWorldImportUploadRoutes(app,f.service,systemClock,"local");
    try {
      const get=await app.inject({method:"GET",url:"/api/v1/servers/test/worlds/import-uploads",headers:{host:"localhost:8080"}});
      expect(get.statusCode).toBe(200);expect(get.headers["cache-control"]).toBe("no-store");
      const record=get.json().data.items[0],url=`/api/v1/servers/test/worlds/import-uploads/${uploaded.id}/discard`;
      const headers={host:"localhost:8080",origin:"http://localhost:3000","x-manager-intent":"local-ui","content-type":"application/json"};
      const body={confirmUploadId:uploaded.id,revision:record.revision};
      expect((await app.inject({method:"POST",url,headers,payload:{...body,path:"../escape"}})).statusCode).toBe(400);
      expect((await app.inject({method:"POST",url,headers:{...headers,"x-manager-intent":"invalid"},payload:body})).statusCode).toBe(403);
      expect((await f.service.list("test")).occupiedSlots).toBe(1);
      const response=await app.inject({method:"POST",url,headers,payload:body});expect(response.statusCode).toBe(200);expect(response.json().data.state).toBe("discarded");
      expect((await f.service.list("test")).occupiedSlots).toBe(0);
    } finally {await app.close();}
  });
  it("rejects hostile intent, types, oversized declared lengths and path fields before service writes", async () => {
    const app=fastify();app.addHook("onRequest",installLocalRequestGuard(systemClock,"local"));
    app.setErrorHandler((error,req,reply) => {
      const status=error instanceof DomainError ? error.statusCode : 500;
      return reply.code(status).send(errorResponse(req.id,systemClock,error instanceof DomainError ? error.code : "INTERNAL_ERROR","请求被拒绝","local"));
    });
    const upload=vi.fn();registerWorldImportUploadRoutes(app,{upload} as unknown as WorldImportUploadService,systemClock,"local");
    const headers={host:"localhost:8080",origin:"http://localhost:3000","x-manager-intent":"local-ui","content-type":"application/zip","x-upload-filename":"x.zip"};
    try {
      for (const [extra,url,expected] of [
        [{origin:"http://evil.example"},"",403], [{"x-manager-intent":"other"},"",403],
        [{"content-type":"application/json"},"",415], [{"content-encoding":"gzip"},"",415],
        [{"content-length":String(129*1024**2)},"",413], [{},"?path=escape",400],
        [{"x-upload-filename":"%ZZ"},"",400]
      ] as const) {
        const response=await app.inject({method:"POST",url:`/api/v1/servers/test/worlds/import-uploads${url}`,headers:{...headers,...extra},payload:"bad"});
        expect(response.statusCode).toBe(expected);
      }
      expect(upload).not.toHaveBeenCalled();
    } finally {await app.close();}
  });
});
