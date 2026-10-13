import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

assert.equal(process.platform, 'win32', 'native Windows acceptance required');
const evidence = path.resolve('test-results', `p72a-crash-${randomUUID()}`);
await mkdir(evidence, { recursive: true });
const children = new Set();
async function child(root, mode, boundary, revision, key) {
  const processChild = spawn(process.execPath, ['--import', 'tsx', 'tests/acceptance/p72a-access-crash-child.ts', root, mode, boundary, revision, key],
    { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.add(processChild);
  let message; let timeout = false;
  const close = new Promise((resolve) => processChild.once('close', (code, signal) => { children.delete(processChild); resolve({ code, signal }); }));
  const timer = setTimeout(() => { timeout = true; processChild.kill(); }, 600_000);
  processChild.on('message', (item) => {
    message = item;
    if (item.kind === 'boundary') processChild.kill(); // Only this exact owned ChildProcess, after native publisher has exited.
  });
  const status = await close; clearTimeout(timer);
  assert.equal(timeout, false, 'CLEANUP_BLOCKED: owned child exceeded independent acceptance deadline');
  assert.ok(message, 'NO_CHILD_EVIDENCE');
  if (mode !== 'run') { assert.equal(status.code, 0, JSON.stringify(message)); assert.equal(status.signal, null); }
  return { message, status, closed: true };
}
const results = [];
for (const boundary of ['0000', '0001', '0002', '0003']) {
  const parent = await mkdtemp(path.join(tmpdir(), 'mcsm-access-crash-'));
  const root = path.join(parent, 'manager'); await mkdir(root);
  const revision = randomUUID(); const key = randomUUID();
  const killed = await child(root, 'run', boundary, revision, key);
  assert.equal(killed.message.kind, 'boundary');
  const observed = await child(root, 'probe', boundary, revision, key);
  assert.equal(observed.message.applyCalls, 0); assert.equal(observed.message.replayId, true);
  assert.equal(observed.message.before, boundary === '0003' ? 'succeeded' : 'recovery_required');
  const recovered = await child(root, 'recover', boundary, revision, key);
  assert.equal(recovered.message.applyCalls, 0);
  assert.equal(recovered.message.after, ['0002', '0003'].includes(boundary) ? 'succeeded' : 'failed');
  results.push({ boundary, killed, observed, recovered, fixture: parent, retained: true });
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'IN_PROGRESS', results }, null, 2));
  console.log(`PASS: native boundary ${boundary}, new-process lock/replay/read-only observation/explicit recovery`);
}
assert.equal(children.size, 0);
await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', childrenClosed: true,
  realProviderCalls: 0, originalUserDataAccessed: false, results }, null, 2));
console.log(`PASS: process crash acceptance; evidence ${evidence}`);
