import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { OwnedAclChild } from './whitelist-acl-session.js';

/** Fixture-only launcher. Metadata uses separate IPC; protocol pipes are inherited directly. */
export function detachedAclFactory(script: string, observeBridge: (pid: number) => void): OwnedAclChild {
  const bridge = spawn(process.execPath,[fileURLToPath(new URL('./whitelist-detached-bridge.cjs',import.meta.url)),Buffer.from(script,'utf16le').toString('base64')],
    {windowsHide:true,detached:true,stdio:['pipe','pipe','pipe','ipc']});
  if (Number.isSafeInteger(bridge.pid) && bridge.pid! > 0) observeBridge(bridge.pid!);
  let pid: number | undefined, proof: {code:number|null;signal:string|null} | undefined;
  const owned = new EventEmitter() as OwnedAclChild;
  owned.stdin = bridge.stdin!; owned.stdout = bridge.stdout!; owned.stderr = bridge.stderr!;
  Object.defineProperty(owned,'pid',{get:()=>pid});
  const fault = () => owned.emit('error',new Error('fixture-launch-unknown'));
  owned.kill = () => {
    if (!bridge.connected) return false;
    bridge.send('kill-owned-child', error => { if(error) fault(); }); return true;
  };
  bridge.on('error',fault);
  bridge.on('message',value => {
    if (!value || typeof value !== 'object' || !('kind' in value)) { fault(); return; }
    const row = value as Record<string,unknown>;
    if (row.kind === 'started' && pid === undefined && Number.isSafeInteger(row.pid) && Number(row.pid)>0) { pid=Number(row.pid); return; }
    if (row.kind === 'closed' && pid !== undefined && row.pid === pid && !proof &&
      (row.code === null || Number.isInteger(row.code)) && (row.signal === null || typeof row.signal === 'string')) {
      proof={code:row.code as number|null,signal:row.signal as string|null}; return;
    }
    fault();
  });
  bridge.on('close',(code,signal) => {
    if (!proof) { fault(); return; } // No fabricated close if the real child is unconfirmed.
    owned.emit('close',code === 0 && signal === null ? proof.code : 1,proof.signal);
  });
  return owned;
}
