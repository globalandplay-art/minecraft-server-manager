import net from 'node:net';
import { expect, it } from 'vitest';
import { assertTcpPeerOwner, verifyWindowsTcpPeer } from '../../src/infra/runtime/tcp-peer-owner.js';

const peer = { serverPort: 25575, clientPort: 49152 };
const row = ' TCP 127.0.0.1:25575 127.0.0.1:49152 ESTABLISHED 1234\r\n';
it('accepts only the precise established server-side IPv4 tuple', () => {
  expect(() => assertTcpPeerOwner(`Active Connections\r\n${row}`, peer, 1234)).not.toThrow();
});
it.each([
  row.replace('1234', '9999'), row.replace('ESTABLISHED', 'LISTENING'),
  row.replace('127.0.0.1:25575', '0.0.0.0:25575'), row.replace('49152', '49153'),
  row + row, 'TCP malformed', '', 'x'.repeat(256 * 1024 + 1)
])('rejects missing/ambiguous/wrong-owner data without exposing raw output: %#', output => {
  expect(() => assertTcpPeerOwner(output, peer, 1234)).toThrow('tcp-peer-unverified');
});
it('does not accept the reverse client half as ownership proof', () => {
  expect(() => assertTcpPeerOwner('TCP 127.0.0.1:49152 127.0.0.1:25575 ESTABLISHED 1234', peer, 1234)).toThrow();
});
it.skipIf(process.platform !== 'win32')('checks an actual Windows loopback connection owner and rejects another PID', async () => {
  const accepted = new Set<net.Socket>(), server = net.createServer(socket => accepted.add(socket));
  const client = new net.Socket();
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture-port-unavailable');
    await new Promise<void>((resolve, reject) => { client.once('error', reject); client.connect(address.port, '127.0.0.1', resolve); });
    const connected = { serverPort: address.port, clientPort: client.localPort! };
    await expect(verifyWindowsTcpPeer(connected, process.pid)).resolves.toBeUndefined();
    await expect(verifyWindowsTcpPeer(connected, process.pid + 1)).rejects.toThrow('tcp-peer-unverified');
  } finally {
    client.destroy(); for (const socket of accepted) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
