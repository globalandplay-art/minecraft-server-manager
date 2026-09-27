import { Value } from "@sinclair/typebox/value";
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  overviewResponseSchema,
  serverResponseSchema,
  serversResponseSchema,
  type ServerInfo
} from "@mcsm/contracts";
import { afterEach, describe, expect, it } from "vitest";

import type { MinecraftServerAdapter } from "../src/adapters/contract.js";
import { buildApp } from "../src/app.js";
import type { Clock } from "../src/clock.js";
import {
  API_HOST,
  API_PORT,
  JSON_BODY_LIMIT_BYTES,
  assertMockMode
} from "../src/config/runtime.js";

const NOW = new Date("2026-09-27T08:30:00.000Z");
const fixedClock: Clock = { now: () => new Date(NOW) };
const apps: ReturnType<typeof buildApp>[] = [];

const createApp = (options: Parameters<typeof buildApp>[0] = {}) => {
  const app = buildApp({ clock: fixedClock, ...options });
  apps.push(app);
  return app;
};

const localHeaders = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000" };

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Phase 1 read API", () => {
  it("returns the exact feature map in a valid health envelope", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/api/v1/health",
      headers: localHeaders
    });
    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(Value.Check(healthResponseSchema, payload)).toBe(true);
    expect(payload.meta).toMatchObject({ mode: "mock", generatedAt: NOW.toISOString() });
    expect(payload.data.features.dashboard).toEqual({ implemented: true, phase: 1 });
    expect(payload.data.features.servers).toEqual({ implemented: true, phase: 1 });
    expect(
      Object.entries(payload.data.features)
        .filter(([feature]) => !["dashboard", "servers"].includes(feature))
        .every(([, state]) => (state as { implemented: boolean }).implemented === false)
    ).toBe(true);
  });

  it("lists Paper running, Vanilla stopped and Fabric partial fixtures", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/api/v1/servers",
      headers: localHeaders
    });
    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(Value.Check(serversResponseSchema, payload)).toBe(true);
    expect(
      payload.data.items.map((item: { server: { id: string }; status: { state: string } }) => [
        item.server.id,
        item.status.state
      ])
    ).toEqual([
      ["paper-demo", "running"],
      ["vanilla-demo", "stopped"],
      ["fabric-partial", "unknown"]
    ]);

    for (const item of payload.data.items) {
      expect(item.readiness.commandTransport).toBe("unavailable");
      for (const [key, availability] of Object.entries(item.readiness)) {
        if (key !== "commandTransport") {
          expect(availability).toEqual({ allowed: false, reason: "mock-mode" });
        }
      }
    }
  });

  it("returns a valid server detail", async () => {
    const response = await createApp().inject({
      method: "GET",
      url: "/api/v1/servers/paper-demo",
      headers: localHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(Value.Check(serverResponseSchema, response.json())).toBe(true);
    expect(response.json().data.server.type).toBe("paper");
  });

  it("preserves unavailable and stale metric semantics in overviews", async () => {
    const app = createApp();
    const paper = await app.inject({
      method: "GET",
      url: "/api/v1/servers/paper-demo/overview",
      headers: localHeaders
    });
    const fabric = await app.inject({
      method: "GET",
      url: "/api/v1/servers/fabric-partial/overview",
      headers: localHeaders
    });

    expect(Value.Check(overviewResponseSchema, paper.json())).toBe(true);
    expect(paper.json().data.metrics.tps).toEqual({
      status: "unavailable",
      value: null,
      source: null,
      sampledAt: null,
      reason: "not-collected"
    });
    expect(paper.json().data.metrics.ram.value).toHaveProperty("rssBytes");
    expect(paper.json().data.metrics.disk.value).toEqual({
      totalBytes: 128_849_018_880,
      freeBytes: 77_309_411_328,
      usedBytes: 51_539_607_552
    });
    expect(Value.Check(overviewResponseSchema, fabric.json())).toBe(true);
    expect(fabric.json().data.metrics.cpu).toMatchObject({
      status: "stale",
      reason: "probe-unavailable"
    });
  });

  it("supports a zero-server fixture set", async () => {
    const response = await createApp({ adapters: [] }).inject({
      method: "GET",
      url: "/api/v1/servers",
      headers: localHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual([]);
  });

  it("returns safe error envelopes for unknown servers and unimplemented routes", async () => {
    const app = createApp();
    const missingServer = await app.inject({
      method: "GET",
      url: "/api/v1/servers/missing-server",
      headers: localHeaders
    });
    const futureRoute = await app.inject({
      method: "POST",
      url: "/api/v1/servers/paper-demo/actions/start",
      headers: localHeaders,
      payload: {}
    });

    expect(missingServer.statusCode).toBe(404);
    expect(Value.Check(apiErrorResponseSchema, missingServer.json())).toBe(true);
    expect(missingServer.json().error.code).toBe("SERVER_NOT_FOUND");
    expect(futureRoute.statusCode).toBe(404);
    expect(futureRoute.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });
});

describe("local HTTP security boundary", () => {
  it.each(["127.0.0.1:8080", "localhost:8080", "LOCALHOST:8080"])(
    "accepts allowlisted Host %s",
    async (host) => {
      const response = await createApp().inject({
        method: "GET",
        url: "/api/v1/health",
        headers: { host }
      });
      expect(response.statusCode).toBe(200);
    }
  );

  it.each([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://localhost:8080"
  ])("accepts allowlisted Origin %s", async (origin) => {
    const response = await createApp().inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: "127.0.0.1:8080", origin }
    });
    expect(response.statusCode).toBe(200);
  });

  it.each(["evil.example:8080", "127.0.0.1:3000", "localhost"])(
    "rejects non-allowlisted Host %s",
    async (host) => {
      const response = await createApp().inject({
        method: "GET",
        url: "/api/v1/health",
        headers: { host }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("HOST_REJECTED");
    }
  );

  it.each(["https://evil.example", "null", "http://127.0.0.1:3001"])(
    "rejects non-allowlisted Origin %s",
    async (origin) => {
      const response = await createApp().inject({
        method: "GET",
        url: "/api/v1/health",
        headers: { host: "127.0.0.1:8080", origin }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("ORIGIN_REJECTED");
    }
  );

  it.each(["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"])(
    "rejects the %s proxy header",
    async (header) => {
      const response = await createApp().inject({
        method: "GET",
        url: "/api/v1/health",
        headers: { host: "127.0.0.1:8080", [header]: "attacker.example" }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("HOST_REJECTED");
    }
  );

  it("uses the fixed bind and request limits and refuses local mode", () => {
    const app = createApp();
    expect(API_HOST).toBe("127.0.0.1");
    expect(API_PORT).toBe(8080);
    expect(app.initialConfig.bodyLimit).toBe(JSON_BODY_LIMIT_BYTES);
    expect(assertMockMode(undefined)).toBe("mock");
    expect(assertMockMode("mock")).toBe("mock");
    expect(() => assertMockMode("local")).toThrow("Only mock mode");
  });

  it("strips fields outside response schemas", async () => {
    const unsafeServer: ServerInfo & { serverRoot: string; rconPassword: string } = {
      id: "unsafe-fixture",
      name: "Unsafe fixture",
      type: "unknown",
      minecraftVersion: null,
      java: { runtimeVersion: null, requiredMajor: null },
      detection: { confidence: "low", evidence: ["test-fixture"], warnings: [] },
      serverRoot: "C:\\private\\server",
      rconPassword: "hunter2"
    };
    const adapter: MinecraftServerAdapter = {
      serverId: unsafeServer.id,
      getServerInfo: async () => unsafeServer,
      getCapabilities: async () => ({
        mods: false,
        plugins: false,
        rcon: false,
        console: false,
        backup: false,
        worlds: false,
        properties: false
      }),
      getStatus: async () => ({
        state: "unknown",
        ownership: "unknown",
        source: "mock",
        observedAt: NOW.toISOString(),
        activeOperationId: null,
        recoveryRequired: false
      }),
      getMetrics: async () => {
        throw new Error("not used");
      },
      getActivity: async () => [],
      getAlerts: async () => []
    };
    const response = await createApp({ adapters: [adapter] }).inject({
      method: "GET",
      url: "/api/v1/servers/unsafe-fixture",
      headers: localHeaders
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("serverRoot");
    expect(response.body).not.toContain("private");
    expect(response.body).not.toContain("rconPassword");
    expect(response.body).not.toContain("hunter2");
  });

  it("does not expose internal exceptions, paths, stacks or secrets", async () => {
    const logStream = new PassThrough();
    let logs = "";
    logStream.on("data", (chunk: Buffer) => {
      logs += chunk.toString("utf8");
    });
    const adapter: MinecraftServerAdapter = {
      serverId: "broken-fixture",
      getServerInfo: async () => {
        throw new Error("C:\\private\\server rcon.password=hunter2");
      },
      getCapabilities: async () => {
        throw new Error("unreachable");
      },
      getStatus: async () => {
        throw new Error("unreachable");
      },
      getMetrics: async () => {
        throw new Error("unreachable");
      },
      getActivity: async () => [],
      getAlerts: async () => []
    };
    const response = await createApp({
      adapters: [adapter],
      logger: { level: "error", stream: logStream }
    }).inject({
      method: "GET",
      url: "/api/v1/servers/broken-fixture",
      headers: localHeaders
    });

    expect(response.statusCode).toBe(500);
    expect(Value.Check(apiErrorResponseSchema, response.json())).toBe(true);
    expect(response.json().error.code).toBe("INTERNAL_ERROR");
    expect(response.body).not.toContain("private");
    expect(response.body).not.toContain("hunter2");
    expect(response.body).not.toContain("stack");
    expect(logs).toContain("UNHANDLED_REQUEST_ERROR");
    expect(logs).not.toContain("private");
    expect(logs).not.toContain("hunter2");
    expect(logs).not.toContain("rcon.password");
  });
});
import { PassThrough } from "node:stream";
