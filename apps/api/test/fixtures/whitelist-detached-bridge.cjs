// Fixture only: Node tolerates DETACHED_PROCESS; Windows PowerShell on this host
// exits without running a script under that flag. Preserve independent lifetime
// with a detached Node launcher and an ordinary hidden PowerShell owned by it.
const { spawn } = require('node:child_process');
const path = require('node:path');
const encoded = process.argv[2];
if (process.argv.length !== 3 || !encoded || encoded.length > 30000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || !process.send) process.exit(2);
const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
  ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],
  { windowsHide: true, stdio: [0,1,2] });
process.on('message', value => {
  if (value === 'kill-owned-child') child.kill();
});
// Losing the original parent must not close/kill the real helper mid-request.
process.on('disconnect', () => {});
child.on('error', () => {
  if (process.connected) process.send({kind:'launch-error'}, () => {});
});
if (Number.isSafeInteger(child.pid) && child.pid > 0 && process.connected) process.send({kind:'started',pid:child.pid}, () => {});
child.on('close', (code,signal) => {
  process.exitCode = code === 0 && signal === null ? 0 : 1;
  if (process.connected) process.send({kind:'closed',pid:child.pid,code,signal}, () => { if (process.connected) process.disconnect(); });
});
