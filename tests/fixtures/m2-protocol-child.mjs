// Test-only Node protocol simulator. Never a Minecraft launch descriptor.
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { realpathSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { minecraftStatusProtocol } from '../../apps/api/src/infra/runtime/status-probe.ts';
import { encodeRconPacket } from '../../apps/api/src/infra/runtime/rcon-client.ts';

assert.equal(process.env.LT_PROTOCOL_FIXTURE, '1');
const [gameText, rconText, marker] = process.argv.slice(2), gamePort = Number(gameText), rconPort = Number(rconText);
assert(['A', 'B'].includes(marker));
assert([gamePort, rconPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535));
assert.notEqual(gamePort, rconPort);
const cwd = realpathSync(process.cwd()), workspace = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(path.dirname(path.dirname(cwd)).toLowerCase(), path.join(workspace, 'test-results').toLowerCase());
assert.match(path.basename(path.dirname(cwd)), /^m2-multi-protocol-[a-f0-9-]{36}$/u);
assert.equal(path.basename(cwd), `instance-${marker.toLowerCase()}`);
const sockets = new Set(), servers = []; let shutting = false, stopPending = false;
function track(socket) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); }
function shutdown() {
  if (shutting) return; shutting = true;
  for (const socket of sockets) socket.destroy();
  let remaining = servers.length;
  for (const server of servers) server.close(() => { if (--remaining === 0) process.exit(0); });
}
const game = net.createServer(socket => {
  track(socket); socket.once('data', () => {
    const json = minecraftStatusProtocol.encodeString(JSON.stringify({ version: { name: 'Node protocol fixture', protocol: 1 },
      players: { online: 0, max: 20 }, description: { text: marker } }));
    socket.end(minecraftStatusProtocol.frame(Buffer.concat([Buffer.from([0]), json])));
  });
});
const rcon = net.createServer(socket => {
  track(socket); let pending = Buffer.alloc(0), authenticated = false;
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]); if (pending.length > 65540) return socket.destroy();
    while (pending.length >= 4) {
      const length = pending.readInt32LE(0); if (length < 10 || length > 65536) return socket.destroy();
      if (pending.length < length + 4) return;
      const packet = pending.subarray(4, length + 4); pending = pending.subarray(length + 4);
      const id = packet.readInt32LE(0), type = packet.readInt32LE(4), body = packet.subarray(8, length - 2).toString('utf8');
      if (type === 3) {
        authenticated = body === 'protocol-fixture-only'; socket.write(encodeRconPacket(authenticated ? id : -1, 2, ''));
      } else if (!authenticated) return socket.destroy();
      else if (type === 2) {
        appendFileSync(path.join(cwd, 'received.jsonl'), `${JSON.stringify({ marker, command: body })}\n`);
        socket.write(encodeRconPacket(id, 0, `${marker}:${body}`));
        if (body === 'stop') stopPending = true;
      } else if (type === 0) {
        socket.write(encodeRconPacket(id, 0, ''));
        if (stopPending) setTimeout(shutdown, 20);
      } else return socket.destroy();
    }
  });
});
for (const [server, port] of [[game, gamePort], [rcon, rconPort]]) {
  servers.push(server); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
}
appendFileSync(path.join(cwd, 'logs/latest.log'), `[Server thread/INFO]: Done (${marker} protocol fixture)!\n`);
process.stdin.setEncoding('utf8'); process.stdin.on('data', text => { if (text.trim() === 'stop') shutdown(); });
