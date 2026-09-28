import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  RconClient,
  RconError,
  encodeRconPacket
} from "../../src/infra/runtime/rcon-client.js";

interface ParsedPacket {
  requestId: number;
  type: number;
  body: string;
}

interface TestServer {
  port: number;
  close(): Promise<void>;
}

const openServers: TestServer[] = [];

function parsePackets(buffer: Buffer): { packets: ParsedPacket[]; rest: Buffer } {
  const packets: ParsedPacket[] = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const length = buffer.readInt32LE(offset);
    if (buffer.length - offset < length + 4) break;
    const packet = buffer.subarray(offset + 4, offset + 4 + length);
    packets.push({
      requestId: packet.readInt32LE(0),
      type: packet.readInt32LE(4),
      body: packet.subarray(8, length - 2).toString("utf8")
    });
    offset += length + 4;
  }
  return { packets, rest: buffer.subarray(offset) };
}

async function createTestServer(onPacket: (socket: net.Socket, packet: ParsedPacket) => void): Promise<TestServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const parsed = parsePackets(buffered);
      buffered = parsed.rest;
      for (const packet of parsed.packets) onPacket(socket, packet);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind TCP");
  const testServer: TestServer = {
    port: address.port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
  openServers.push(testServer);
  return testServer;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("RconClient", () => {
  it("can reconnect immediately after a timed-out command", async () => {
    let commands = 0;
    const server = await createTestServer((socket, packet) => {
      if (packet.type === 3) socket.write(encodeRconPacket(packet.requestId, 2, ""));
      else if (packet.type === 2) {
        commands += 1;
        if (commands > 1) socket.write(encodeRconPacket(packet.requestId, 0, "recovered"));
      } else socket.write(encodeRconPacket(packet.requestId, 0, ""));
    });
    const client = new RconClient({
      host: "127.0.0.1", port: server.port,
      getPassword: async () => "secret", timeoutMs: 200
    });
    try {
      await expect(client.execute("list")).rejects.toMatchObject({ code: "RCON_TIMEOUT" });
      await expect(client.execute("list")).resolves.toBe("recovered");
    } finally { client.close(); }
  });

  it("authenticates with a private request id and joins multi-packet output", async () => {
    const observed: ParsedPacket[] = [];
    const server = await createTestServer((socket, packet) => {
      observed.push(packet);
      if (packet.type === 3) {
        socket.write(encodeRconPacket(packet.requestId, 2, ""));
      } else if (packet.type === 2) {
        socket.write(Buffer.concat([
          encodeRconPacket(packet.requestId, 0, "first "),
          encodeRconPacket(packet.requestId, 0, "second")
        ]));
      } else {
        socket.write(encodeRconPacket(packet.requestId, 0, "Unknown request 0"));
      }
    });
    const client = new RconClient({
      host: "127.0.0.1",
      port: server.port,
      getPassword: async () => "private-rcon-password",
      timeoutMs: 500,
    });

    await expect(client.execute("list")).resolves.toBe("first second");
    expect(observed).toHaveLength(3);
    expect(observed[0]).toMatchObject({ type: 3, body: "private-rcon-password" });
    expect(observed[1]).toMatchObject({ type: 2, body: "list" });
    expect(observed[2]).toMatchObject({ type: 0, body: "" });
    expect(observed[0]?.requestId).not.toBe(observed[1]?.requestId);
    client.close();
  });

  it("waits for a barrier after delayed multi-packet and exact 4096-character chunks", async () => {
    const chunk = "x".repeat(4096);
    let commandId = 0;
    let secondSent = false;
    const server = await createTestServer((socket, packet) => {
      if (packet.type === 3) {
        socket.write(encodeRconPacket(packet.requestId, 2, ""));
      } else if (packet.type === 2) {
        commandId = packet.requestId;
        socket.write(encodeRconPacket(packet.requestId, 0, chunk));
      } else {
        setTimeout(() => {
          socket.write(encodeRconPacket(commandId, 0, chunk));
          secondSent = true;
          socket.write(encodeRconPacket(packet.requestId, 0, "Unknown request 0"));
        }, 60);
      }
    });
    const client = new RconClient({
      host: "127.0.0.1",
      port: server.port,
      getPassword: async () => "secret",
      timeoutMs: 500
    });

    const output = await client.execute("help");
    expect(secondSent).toBe(true);
    expect(output).toBe(chunk + chunk);
    expect(output).toHaveLength(8192);
    client.close();
  });

  it("completes an empty command output only after the barrier response", async () => {
    let barrierSeen = false;
    const server = await createTestServer((socket, packet) => {
      if (packet.type === 3) socket.write(encodeRconPacket(packet.requestId, 2, ""));
      else if (packet.type === 2) socket.write(encodeRconPacket(packet.requestId, 0, ""));
      else {
        barrierSeen = true;
        socket.write(encodeRconPacket(packet.requestId, 0, "Unknown request 0"));
      }
    });
    const client = new RconClient({
      host: "127.0.0.1",
      port: server.port,
      getPassword: async () => "secret",
      timeoutMs: 300
    });

    await expect(client.execute("list")).resolves.toBe("");
    expect(barrierSeen).toBe(true);
    client.close();
  });

  it("reports authentication failure without exposing the password", async () => {
    const server = await createTestServer((socket, packet) => {
      socket.write(encodeRconPacket(-1, packet.type, "bad password supplied-secret"));
    });
    const client = new RconClient({
      host: "127.0.0.1",
      port: server.port,
      getPassword: async () => "supplied-secret",
      timeoutMs: 300
    });

    const error = await client.execute("list").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RconError);
    expect(error).toMatchObject({ code: "RCON_AUTH_FAILED" });
    expect(String(error)).not.toContain("supplied-secret");
  });

  it("rejects oversized packet declarations", async () => {
    const server = await createTestServer((socket) => {
      const invalid = Buffer.alloc(4);
      invalid.writeInt32LE(70_000, 0);
      socket.write(invalid);
    });
    const client = new RconClient({
      host: "127.0.0.1",
      port: server.port,
      getPassword: async () => "secret",
      timeoutMs: 300,
      maxPacketLength: 1024
    });

    await expect(client.connect()).rejects.toMatchObject({ code: "RCON_PROTOCOL_ERROR" });
  });

  it("times out without retrying a command", async () => {
    let commands = 0;
    const server = await createTestServer((socket, packet) => {
      if (packet.type === 3) socket.write(encodeRconPacket(packet.requestId, 2, ""));
      else commands += 1;
    });
    const client = new RconClient({
      host: "127.0.0.1",
      port: server.port,
      getPassword: async () => "secret",
      timeoutMs: 60,
      multiPacketIdleMs: 5
    });

    await expect(client.execute("list")).rejects.toMatchObject({ code: "RCON_TIMEOUT" });
    expect(commands).toBe(1);
  });

  it("rejects the in-flight request when the server disconnects", async () => {
    const server = await createTestServer((socket, packet) => {
      if (packet.type === 3) socket.write(encodeRconPacket(packet.requestId, 2, ""));
      else socket.destroy();
    });
    const client = new RconClient({
      host: "127.0.0.1",
      port: server.port,
      getPassword: async () => "secret",
      timeoutMs: 300
    });

    await expect(client.execute("list")).rejects.toMatchObject({ code: "RCON_DISCONNECTED" });
  });

  it("does not accept a response with another request id", async () => {
    const server = await createTestServer((socket, packet) => {
      if (packet.type === 3) socket.write(encodeRconPacket(packet.requestId, 2, ""));
      else socket.write(encodeRconPacket(packet.requestId + 50, 0, "wrong response"));
    });
    const client = new RconClient({
      host: "127.0.0.1",
      port: server.port,
      getPassword: async () => "secret",
      timeoutMs: 60
    });

    await expect(client.execute("list")).rejects.toMatchObject({ code: "RCON_TIMEOUT" });
  });

  it("rejects non-loopback construction", () => {
    expect(() => new RconClient({
      host: "example.invalid" as "127.0.0.1",
      port: 25575,
      getPassword: async () => "secret"
    })).toThrow("127.0.0.1");
  });
});
