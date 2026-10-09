import { describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { createMockAdapters } from "../src/fixtures/servers.js";
import { PerformanceService } from "../src/services/performance-service.js";
import { buildApp } from "../src/app.js";

describe("bounded demand performance sampling", () => {
  it("coalesces readers, limits cadence and retains original timestamps", async () => {
    let wall = 10000; let monotonic = 0;
    const clock = { now: () => new Date(wall) };
    const adapters = createMockAdapters(clock);
    const adapter = adapters[0]!;
    const metrics = await adapter.getMetrics();
    const spy = vi.spyOn(adapter, "getMetrics").mockResolvedValue(metrics);
    const service = new PerformanceService(new AdapterRegistry(adapters), clock, () => monotonic);
    const results = await Promise.all(Array.from({ length: 20 }, () => service.read(adapter.serverId)));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.samples.length === 1)).toBe(true);
    monotonic = 4999; wall = 20000;
    expect((await service.read(adapter.serverId)).samples).toHaveLength(1);
    monotonic = 5000;
    const data = await service.read(adapter.serverId);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(data.samples).toHaveLength(2);
    expect(data.samples[1]?.metrics).toEqual(metrics);
  });

  it("does not fabricate a sample after probe failure or immediately retry", async () => {
    let monotonic = 0;
    const clock = { now: () => new Date(10000) };
    const adapters = createMockAdapters(clock); const adapter = adapters[0]!;
    const spy = vi.spyOn(adapter, "getMetrics").mockRejectedValue(new Error("probe failed"));
    const service = new PerformanceService(new AdapterRegistry(adapters), clock, () => monotonic);
    await expect(service.read(adapter.serverId)).rejects.toThrow("probe failed");
    await expect(service.read(adapter.serverId)).rejects.toThrow("probe failed");
    expect(spy).toHaveBeenCalledTimes(1);
    monotonic = 5000;
    await expect(service.read(adapter.serverId)).rejects.toThrow("probe failed");
    spy.mockResolvedValue(await createMockAdapters(clock)[0]!.getMetrics());
    monotonic = 10000;
    expect((await service.read(adapter.serverId)).samples).toHaveLength(1);
    await expect(service.read("unknown")).rejects.toThrow();
  });

  it("exposes only a validated read-only API and rejects unknown/unsafe ids", async () => {
    const clock = { now: () => new Date("2026-10-08T00:00:00Z") };
    const adapters = createMockAdapters(clock); const app = buildApp({ adapters, clock });
    try {
      const url = `/api/v1/servers/${adapters[0]!.serverId}/performance`;
      const response = await app.inject({ headers: { host: "127.0.0.1:8080" }, method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ retention: "manager-session", minimumIntervalMs: 5000 });
      expect(response.json().data.samples).toHaveLength(1);
      expect((await app.inject({ headers: { host: "127.0.0.1:8080" }, method: "GET", url: "/api/v1/servers/unknown/performance" })).statusCode).toBe(404);
      expect((await app.inject({ headers: { host: "127.0.0.1:8080" }, method: "POST", url })).statusCode).toBe(404);
      // Inject normalizes dot segments before routing; no route is reached.
      expect((await app.inject({ headers: { host: "127.0.0.1:8080" }, method: "GET", url: "/api/v1/servers/%2e%2e/performance" })).statusCode).toBe(404);
      expect((await app.inject({ headers: { host: "127.0.0.1:8080" }, method: "GET", url: "/api/v1/servers/BAD/performance" })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
});
