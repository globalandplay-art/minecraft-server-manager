import type { ServerStatus, WsMessage } from "@mcsm/contracts";
import { afterEach, describe, expect, it } from "vitest";

import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { buildApp } from "../src/app.js";

const status: ServerStatus = {
  state: "stopped",
  ownership: "none",
  source: "process",
  observedAt: "2026-09-28T00:00:00.000Z",
  activeOperationId: null,
  recoveryRequired: false
};

describe("WebSocket route", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("upgrades with an allowed Host and Origin and sends hello then snapshot", async () => {
    const adapter = {
      serverId: "vanilla-26-3",
      mode: "local",
      subscribe: () => () => {},
      streamSnapshot: async () => ({
        streamId: "runtime-stream",
        latestSequence: 0,
        status,
        logs: []
      }),
      closeObserver: async () => {}
    } as unknown as LocalMinecraftServerAdapter;
    const app = buildApp({ mode: "local", adapters: [adapter] });
    apps.push(app);
    await app.ready();

    const messages: WsMessage[] = [];
    let resolveMessages = () => {};
    const receivedMessages = new Promise<void>((resolve) => { resolveMessages = resolve; });
    const socket = await app.injectWS(
      "/ws/v1/servers/vanilla-26-3/events",
      { headers: { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000" } },
      {
        onInit: (client) => client.on("message", (data) => {
          messages.push(JSON.parse(data.toString()) as WsMessage);
          if (messages.length === 2) resolveMessages();
        })
      }
    );
    await receivedMessages;
    const [hello, snapshot] = messages;

    expect(hello).toMatchObject({ type: "hello", latestSequence: 0 });
    expect(snapshot).toMatchObject({ type: "snapshot", sequence: 0, status });
    socket.close();
  });
});
