import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  minecraftStatusProtocol,
  probeMinecraftStatus
} from "../../src/infra/runtime/status-probe.js";

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

async function listen(handler: (socket: net.Socket) => void): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    handler(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server not bound");
  return { server, port: address.port };
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe("Minecraft status protocol probe", () => {
  it("requires a valid framed status JSON response", async () => {
    const { port } = await listen((socket) => {
      socket.once("data", () => {
        const json = minecraftStatusProtocol.encodeString(JSON.stringify({
          version: { name: "1.21.11", protocol: 774 },
          players: { online: 0, max: 20 },
          description: { text: "test" }
        }));
        socket.write(minecraftStatusProtocol.frame(Buffer.concat([
          minecraftStatusProtocol.encodeVarInt(0),
          json
        ])));
      });
    });

    await expect(probeMinecraftStatus({ host: "127.0.0.1", port }, 300)).resolves.toBe("running");
  });

  it("rejects framed JSON that is not a Minecraft status response", async () => {
    const { port } = await listen((socket) => {
      socket.once("data", () => {
        const json = minecraftStatusProtocol.encodeString(JSON.stringify({ ok: true }));
        socket.write(minecraftStatusProtocol.frame(Buffer.concat([
          minecraftStatusProtocol.encodeVarInt(0),
          json
        ])));
      });
    });

    await expect(probeMinecraftStatus({ host: "127.0.0.1", port }, 300)).resolves.toBe("unknown");
  });

  it("does not treat a TCP listener as a running Minecraft server", async () => {
    const { port } = await listen((socket) => {
      socket.once("data", () => socket.write("not a minecraft status packet"));
    });

    await expect(probeMinecraftStatus({ host: "127.0.0.1", port }, 100)).resolves.toBe("unknown");
  });

  it("distinguishes a refused port from timeout or abort", async () => {
    const { port } = await listen(() => {});
    const controller = new AbortController();
    controller.abort();
    await expect(probeMinecraftStatus({ host: "127.0.0.1", port }, 100, controller.signal)).resolves.toBe("unknown");

    const unused = await listen(() => {});
    await new Promise<void>((resolve) => unused.server.close(() => resolve()));
    servers.splice(servers.indexOf(unused.server), 1);
    await expect(probeMinecraftStatus({ host: "127.0.0.1", port: unused.port }, 100)).resolves.toBe("stopped");
  });
});
