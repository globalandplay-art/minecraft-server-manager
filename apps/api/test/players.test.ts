import { afterEach, describe, expect, it, vi } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { playersResponseSchema, type ServerStatus } from "@mcsm/contracts";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import { parsePlayerList } from "../src/services/player-list.js";
import { ServerService } from "../src/services/server-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore } from "../src/services/operation-store.js";

const now = "2026-10-04T10:00:00.000Z";
const clock = { now: () => new Date(now) };
function fixture() {
  const state: ServerStatus = { state: "running", ownership: "managed", source: "process", observedAt: now,
    activeOperationId: null, recoveryRequired: false };
  const command = vi.fn(async () => ({ status: "executed" as const, transport: "rcon" as const,
    output: "There are 2 of a max of 20 players online: Steve, Alex" }));
  const adapter = {
    serverId: "test", mode: "local", plan: { eulaAccepted: true },
    getServerInfo: async () => ({ id: "test", name: "Test", type: "vanilla", minecraftVersion: "26.3",
      java: { runtimeVersion: "25", requiredMajor: 25 }, detection: { confidence: "high", evidence: [], warnings: [] } }),
    getStatus: async () => state, getCommandTransport: vi.fn(async () => "rcon"),
    getCapabilities: async () => ({ mods: false, plugins: false, worlds: true, backup: true, console: true, rcon: true, properties: true }),
    command, subscribe: () => () => {}, closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter;
  const operations = new OperationService(new MemoryOperationStore(), clock);
  const service = new ServerService(new AdapterRegistry([adapter]), operations);
  return { adapter, command, state, operations, service };
}
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
describe("verified Vanilla player lists", () => {
  it("accepts complete names and genuine zero players", () => {
    expect(parsePlayerList("There are 2 of a max of 20 players online: Steve, Alex")).toEqual(["Steve", "Alex"]);
    expect(parsePlayerList("There are 0 of a max of 20 players online: ")).toEqual([]);
  });
  it.each([
    "There are 2 of a max of 20 players online: Steve",
    "There are 2 of a max of 20 players online: Steve, steve",
    "There are 1 of a max of 20 players online: ../secret",
    "There are 1 of a max of 0 players online: Steve",
    "There are 1 of a max of 20 players online: Steve\nsecret=value",
    "localized or plugin response", "x".repeat(200001)
  ])("rejects malformed, partial or unbounded output %s", (raw) => expect(parsePlayerList(raw)).toBeNull());
  it("returns opaque session IDs, not invented UUIDs, stable for consecutive samples", async () => {
    const { service, command } = fixture();
    const a = await service.getPlayers("test", () => now);
    const b = await service.getPlayers("test", () => now);
    expect(a.availability).toBe("available"); expect(a.items.map((p) => p.name)).toEqual(["Steve", "Alex"]);
    expect(a.items[0]?.uuid).toBeNull(); expect(a.items[0]?.id).toMatch(/^session-/u);
    expect(b.items).toEqual(a.items); expect(command).toHaveBeenCalledWith("list");
  });
  it.each(["stopped", "unknown", "starting"] as const)("never commands a %s server", async (state) => {
    const f = fixture(); f.state.state = state;
    expect((await f.service.getPlayers("test", () => now)).availability).toBe("unavailable"); expect(f.command).not.toHaveBeenCalled();
  });
  it("rejects external ownership and recovery admission without commands", async () => {
    const f = fixture(); f.state.ownership = "external";
    expect((await f.service.getPlayers("test", () => now)).availability).toBe("unavailable");
    f.state.ownership = "managed"; f.operations.requireRecovery(["test"]);
    expect((await f.service.getPlayers("test", () => now)).reason).toBe("recovery-required"); expect(f.command).not.toHaveBeenCalled();
  });
  it("does not expose transport failures or secret/raw output", async () => {
    const f = fixture(); f.command.mockRejectedValue(new Error("rcon.password=PRIVATE C:\\secret"));
    const data = await f.service.getPlayers("test", () => now);
    expect(data).toEqual({ availability: "unavailable", completeness: "unknown", items: [], sampledAt: null, reason: "player-query-failed" });
  });
  it("serializes with other admitted operations", async () => {
    const f = fixture(); let release!: () => void;
    const held = f.operations.runExclusive("test", () => new Promise<void>((resolve) => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await f.service.getPlayers("test", () => now)).reason).toBe("operation-active");
    expect(f.command).not.toHaveBeenCalled(); release(); await held;
  });
  it("serves a schema-valid endpoint and rejects absent/local-guard requests", async () => {
    const f = fixture(); const app = buildApp({ mode: "local", adapters: [f.adapter], clock }); apps.push(app);
    const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000" };
    const response = await app.inject({ method: "GET", url: "/api/v1/servers/test/players", headers });
    expect(response.statusCode).toBe(200); expect(Value.Check(playersResponseSchema, response.json())).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/v1/servers/missing/players", headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/servers/test/players" })).statusCode).toBe(403);
  });
});
