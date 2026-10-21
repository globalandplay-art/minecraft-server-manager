import { execFile } from 'node:child_process';

export interface LoopbackPeer { readonly serverPort: number; readonly clientPort: number }
export type RconPeerVerifier = (peer: LoopbackPeer, expectedPid: number) => Promise<void>;
const unsafe = () => new Error('tcp-peer-unverified');

/** Inspect the server half of the established connection, never a listener snapshot. */
export function assertTcpPeerOwner(output: string, peer: LoopbackPeer, expectedPid: number): void {
  if (!Number.isSafeInteger(expectedPid) || expectedPid < 1 ||
    [peer.serverPort, peer.clientPort].some(port => !Number.isInteger(port) || port < 1 || port > 65535) ||
    Buffer.byteLength(output) > 256 * 1024) throw unsafe();
  let matched = 0;
  for (const line of output.split(/\r?\n/u)) {
    if (!/^\s*TCP\s/u.test(line)) continue;
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 5 || !/^\d+$/u.test(fields[4]!)) throw unsafe();
    if (fields[1] !== `127.0.0.1:${peer.serverPort}` || fields[2] !== `127.0.0.1:${peer.clientPort}`) continue;
    if (fields[3] !== 'ESTABLISHED' || Number(fields[4]) !== expectedPid) throw unsafe();
    matched++;
  }
  if (matched !== 1) throw unsafe();
}

export const verifyWindowsTcpPeer: RconPeerVerifier = async (peer, expectedPid) => {
  if (process.platform !== 'win32') throw unsafe();
  const output = await new Promise<string>((resolve, reject) => {
    execFile('C:\\Windows\\System32\\netstat.exe', ['-ano', '-p', 'tcp'],
      { shell: false, windowsHide: true, timeout: 2500, maxBuffer: 256 * 1024, encoding: 'utf8' },
      (error, stdout) => error ? reject(unsafe()) : resolve(stdout));
  });
  assertTcpPeerOwner(output, peer, expectedPid);
};
