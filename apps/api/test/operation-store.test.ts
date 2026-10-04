import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonOperationStore, type StoredOperation } from "../src/services/operation-store.js";

const roots: string[] = [];
const at = "2026-10-04T00:00:00.000Z";
const record = (): StoredOperation => ({
  operation: { id: randomUUID(), serverId: "test", kind: "backup", state: "succeeded", step: "completed",
    progress: 100, createdAt: at, updatedAt: at, result: null, error: null },
  idempotencyKey: randomUUID(), requestFingerprint: "fixture", expiresAt: "2026-10-05T00:00:00.000Z"
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-operation-store-")); roots.push(root);
  const manager = path.join(root,"manager"), outside = path.join(root,"outside");
  await mkdir(manager); await mkdir(outside);
  return { root, manager, outside, store: new JsonOperationStore(manager) };
}
afterEach(async()=> {for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
describe("operation store filesystem containment",()=> {
  it("preserves valid records across restart and atomic updates",async()=> {
    const f=await fixture(); await f.store.initialize(); const value=record();
    await f.store.save(value); expect(await f.store.list()).toEqual([value]);
    const reopened=new JsonOperationStore(f.manager); await reopened.initialize();
    await reopened.save({...value,operation:{...value.operation,step:"updated"}});
    expect(await reopened.list()).toEqual([{...value,operation:{...value.operation,step:"updated"}}]);
  });
  it("rejects a pre-existing operations junction before external writes",async()=> {
    const f=await fixture(); const sentinel=path.join(f.outside,"sentinel.txt"); await writeFile(sentinel,"unchanged");
    await symlink(f.outside,path.join(f.manager,"operations"),process.platform === "win32" ? "junction" : "dir");
    await expect(f.store.initialize()).rejects.toThrow(/operation store/iu);
    await expect(f.store.save(record())).rejects.toThrow(/operation store/iu);
    expect(await readdir(f.outside)).toEqual(["sentinel.txt"]); expect(await readFile(sentinel,"utf8")).toBe("unchanged");
  });
  it("rejects manager-root aliases before creating operations",async()=> {
    const f=await fixture(); const alias=path.join(f.root,"alias");
    await symlink(f.outside,alias,process.platform === "win32" ? "junction" : "dir");
    await expect(new JsonOperationStore(alias).initialize()).rejects.toThrow(/operation store/iu);
    expect(await readdir(f.outside)).toEqual([]);
  });
  it("revalidates containment when a directory is substituted after initialization",async()=> {
    const f=await fixture(); await f.store.initialize(); await rmdir(path.join(f.manager,"operations"));
    await symlink(f.outside,path.join(f.manager,"operations"),process.platform === "win32" ? "junction" : "dir");
    await expect(f.store.list()).rejects.toThrow(/operation store/iu);
    await expect(f.store.save(record())).rejects.toThrow(/operation store/iu);
    expect(await readdir(f.outside)).toEqual([]);
  });
  it("rejects hardlinked durable operation records and preserves their outside source",async()=> {
    const f=await fixture(); await f.store.initialize(); const value=record();
    const source=path.join(f.outside,"record.json"); const bytes=JSON.stringify(value); await writeFile(source,bytes);
    await link(source,path.join(f.manager,"operations",`${value.operation.id}.json`));
    await expect(f.store.list()).rejects.toThrow(/operation record/iu);
    await expect(f.store.save(value)).rejects.toThrow(/operation record/iu);
    expect(await readFile(source,"utf8")).toBe(bytes);
  });
  it("rejects oversized records before reading JSON",async()=> {
    const f=await fixture(); await f.store.initialize();
    await writeFile(path.join(f.manager,"operations",`${randomUUID()}.json`)," ".repeat(64*1024+1));
    await expect(f.store.list()).rejects.toThrow(/operation record/iu);
  });
  it("rejects a linked record entry rather than silently omitting persisted authority",async()=> {
    const f=await fixture(); await f.store.initialize(); const value=record();
    await symlink(f.outside,path.join(f.manager,"operations",`${value.operation.id}.json`),process.platform === "win32" ? "junction" : "dir");
    await expect(f.store.list()).rejects.toThrow(/operation record/iu);
    await expect(f.store.save(value)).rejects.toThrow(/operation record/iu);
    expect(await readdir(f.outside)).toEqual([]);
  });
  it("rejects unsafe IDs before deriving a write path",async()=> {
    const f=await fixture(); await f.store.initialize(); const value=record();
    await expect(f.store.save({...value,operation:{...value.operation,id:"../outside/escape"}})).rejects.toThrow(/operation record/iu);
    expect(await readdir(f.outside)).toEqual([]);
  });
  it("rejects filename/record identity mismatches",async()=> {
    const f=await fixture(); await f.store.initialize();
    await writeFile(path.join(f.manager,"operations",`${randomUUID()}.json`),JSON.stringify(record()));
    await expect(f.store.list()).rejects.toThrow(/operation record/iu);
  });
});
