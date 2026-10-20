import { mkdtemp, mkdir, writeFile, link, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WhitelistGuardStore } from '../src/services/whitelist-guard-store.js';
import { whitelistCommandHash } from '../src/services/whitelist-command-record.js';
import { SyntheticRuntime } from './whitelist-synthetic-fixture.js';
import { AuthCoreError } from '../src/auth/password.js';

// Deterministic composition tests only; native evidence is a separate Gate.
const state = vi.hoisted(() => ({ live:new Set<{closedConfirmed:boolean}>(), actions:[] as string[],
  pause:false, failClose:false, badAcl:false, finish:undefined as (()=>void)|undefined }));
const snapshot = () => ({userSid:'S-1-5-21-1-2-3-1001',ownerSid:'S-1-5-21-1-2-3-1001',protected:true,
  aces:[{sid:'S-1-5-21-1-2-3-1001',kind:'allow',mask:state.badAcl ? 0 : 0x1f01ff,flags:0}]});
vi.mock('../src/services/whitelist-acl-session.js', async load => ({
  ...await load<typeof import('../src/services/whitelist-acl-session.js')>(),
  WhitelistAclSession:class {
    closedConfirmed=false;
    constructor(_factory:unknown,_clock:unknown,private readonly wrap:(script:string)=>string) { state.live.add(this); }
    get healthyForRotation() { return !this.closedConfirmed; }
    async query(files:readonly string[]) { this.wrap('fixed-mock-script'); return files.map(snapshot); }
    async close() {
      if(state.failClose) throw Error('fixed-close-failure');
      if(state.pause) { state.pause=false; await new Promise<void>(resolve => {state.finish=resolve;}); }
      this.closedConfirmed=true;
    }
  }
}));
vi.mock('../src/auth/private-publication.js', async load => {
  const actual=await load<typeof import('../src/auth/private-publication.js')>();
  const check=(name:string) => {
    if([...state.live].some(child=>!child.closedConfirmed)) throw Error('publication-before-quiesce');
    state.actions.push(name);
  };
  return {...actual,
    createPrivateEntry:async(file:string,directory:boolean,acl:{verifyNativeSnapshot(value:unknown):string})=>{
      check('create'); if(directory) await mkdir(file); else await writeFile(file,'',{flag:'wx'}); acl.verifyNativeSnapshot(snapshot());
    },
    writePrivateNew:async(file:string,bytes:Buffer,acl:{verify(file:string):Promise<string>})=>{
      check('write'); await writeFile(file,bytes,{flag:'wx'}); await acl.verify(file);
    },
    publishPrivateStageNew:async(stage:string,target:string)=>{check('publish');await link(stage,target);await unlink(stage);}
  };
});
const roots:string[]=[];
beforeEach(()=>{state.live.clear();state.actions=[];state.pause=false;state.failClose=false;state.badAcl=false;state.finish=undefined;});
afterEach(async()=>{for(const root of roots.splice(0)) {
  if(path.dirname(root)!==tmpdir()||!path.basename(root).startsWith('mcsm-guard-scoped-'))throw Error('cleanup-boundary');
  await rm(root,{recursive:true,force:true});
}});
async function fixture() {
  const root=await mkdtemp(path.join(tmpdir(),'mcsm-guard-scoped-'));roots.push(root);
  let busy=false;
  const owner={assertHeld:(file:string)=>{if(file!==root)throw Error('wrong-owner');},rootIdentity:()=>whitelistCommandHash(root),
    beginOfflineMutation:()=>{if(busy)throw new AuthCoreError('AUTH_BUSY');busy=true;return()=>{busy=false;};},
    nativeAclChildWrapper:()=> (script:string)=>{if(!busy)throw Error('escaped-capability');return script;}};
  const runtime=new SyntheticRuntime(), captured=await runtime.capture('test');
  return {root,owner,captured,busy:()=>busy};
}
it('default scope uses one lease, quiesces before every publication and verifies after reopen',async()=>{
  const f=await fixture(), id=randomUUID(), store=await WhitelistGuardStore.open(f.root,f.owner);
  const receipt=await store.create(id,f.captured.snapshot,f.captured.bytes);
  const reopened=await WhitelistGuardStore.open(f.root,f.owner);
  expect(await reopened.verify(id)).toEqual(receipt);
  expect(state.actions).toEqual(['create','create','write','publish','write','publish']);
  expect([...state.live].every(child=>child.closedConfirmed)).toBe(true);expect(f.busy()).toBe(false);
});
it('holds the lease and forbids publication while action helper close is pending',async()=>{
  const f=await fixture(),store=await WhitelistGuardStore.open(f.root,f.owner);state.pause=true;
  let settled=false;
  const pending=store.create(randomUUID(),f.captured.snapshot,f.captured.bytes).finally(()=>{settled=true;});
  await vi.waitFor(()=>expect(state.finish).toBeTypeOf('function'));
  expect(f.busy()).toBe(true);expect(settled).toBe(false);expect(state.actions).not.toContain('publish');
  state.finish!();await pending;expect(f.busy()).toBe(false);
});
it('poisons the store and retains the lease when helper close is unconfirmed',async()=>{
  const f=await fixture(),store=await WhitelistGuardStore.open(f.root,f.owner);state.failClose=true;
  await expect(store.create(randomUUID(),f.captured.snapshot,f.captured.bytes)).rejects.toMatchObject({code:'WHITELIST_GUARD_UNSAFE'});
  expect(state.actions).not.toContain('publish');expect(f.busy()).toBe(true);
  await expect(store.scan()).rejects.toMatchObject({code:'WHITELIST_GUARD_UNSAFE'});
});
it('maps external lease contention to busy without poisoning an otherwise healthy store',async()=>{
  const f=await fixture(),store=await WhitelistGuardStore.open(f.root,f.owner),release=f.owner.beginOfflineMutation();
  await expect(store.scan()).rejects.toMatchObject({code:'WHITELIST_GUARD_BUSY'});
  release();await expect(store.scan()).resolves.toEqual([]);
  await expect(store.create(randomUUID(),f.captured.snapshot,f.captured.bytes)).resolves.toHaveProperty('receiptHash');
});
