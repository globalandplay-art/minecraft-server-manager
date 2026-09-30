import type { ServerStatus, ServerType } from "@mcsm/contracts";
import { describe, expect, it, vi } from "vitest";

import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { Clock } from "../src/clock.js";
import { OperationService } from "../src/services/operation-service.js";
import { MemoryOperationStore, type OperationStore, type StoredOperation } from "../src/services/operation-store.js";
import { ServerService } from "../src/services/server-service.js";

const clock: Clock = { now: () => new Date("2026-09-28T00:00:00.000Z") };

function createAdapter(initialStatus: ServerStatus, type: ServerType = "vanilla") {
  let status = initialStatus;
  const start = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  const command = vi.fn(async () => ({ transport: "stdin" as const, response: "ok" }));
  const adapter = {
    serverId: "local-test",
    mode: "local",
    plan: {
      eulaAccepted: true,
      serverInfo: {
        id: "local-test",
        name: "Local test",
        type,
        minecraftVersion: "1.21.1",
        java: { runtimeVersion: "21", requiredMajor: 21 },
        detection: { confidence: "high", evidence: [], warnings: [] }
      }
    },
    getServerInfo: async () => adapter.plan.serverInfo,
    getCapabilities: async () => ({
      mods: false, plugins: false, rcon: false, console: true,
      backup: type === "vanilla", worlds: type === "vanilla", properties: false
    }),
    getStatus: async () => status,
    getCommandTransport: async () => "stdin" as const,
    command,
    revalidateBeforeStart: vi.fn(async () => {}),
    start,
    stop,
    closeObserver: async () => {}
  } as unknown as LocalMinecraftServerAdapter;
  return { adapter, start, stop, command, setStatus: (next: ServerStatus) => { status = next; } };
}

function status(state: ServerStatus["state"], ownership: ServerStatus["ownership"]): ServerStatus {
  return {
    state,
    ownership,
    source: "process",
    observedAt: clock.now().toISOString(),
    activeOperationId: null,
    recoveryRequired: false
  };
}

async function createService(
  adapter: LocalMinecraftServerAdapter,
  store: OperationStore = new MemoryOperationStore(),
  activeWorldState?: { reconcileAfterStart(serverId: string): Promise<void> }
) {
  const operations = new OperationService(store, clock);
  await operations.initialize();
  return new ServerService(new AdapterRegistry([adapter]), operations, activeWorldState);
}

describe("ServerService lifecycle no-op contract", () => {
  it("reflects backup readiness only for safe stopped or managed Vanilla instances", async () => {
    const stopped = createAdapter(status("stopped", "none"));
    const stoppedService = await createService(stopped.adapter);
    expect((await stoppedService.get("local-test")).readiness.backup).toEqual({ allowed: true, reason: null });

    const managed = createAdapter(status("running", "managed"));
    const managedService = await createService(managed.adapter);
    expect((await managedService.get("local-test")).readiness.backup).toEqual({ allowed: true, reason: null });

    const external = createAdapter(status("running", "external"));
    const externalService = await createService(external.adapter);
    expect((await externalService.get("local-test")).readiness.backup).toEqual({ allowed: false, reason: "external-process" });

    const paper = createAdapter(status("stopped", "none"), "paper");
    const paperService = await createService(paper.adapter);
    expect((await paperService.get("local-test")).readiness.backup).toEqual({ allowed: false, reason: "capability-unsupported" });
  });

  it("sends commands while holding the shared exclusive gate without rejecting itself", async () => {
    const fixture = createAdapter(status("running", "managed"));
    const service = await createService(fixture.adapter);

    await expect(service.sendCommand("local-test", "list")).resolves.toMatchObject({ response: "ok" });
    expect(fixture.command).toHaveBeenCalledWith("list");
  });

  it("requires recovery when a successful start cannot persist its world identity", async () => {
    const fixture = createAdapter(status("stopped", "none"));
    const service = await createService(fixture.adapter, new MemoryOperationStore(), {
      reconcileAfterStart: async () => { throw new Error("state write failed"); }
    });
    const operation = await service.requestLifecycle(
      "local-test", "start", "923e4567-e89b-42d3-a456-426614174000"
    );
    await vi.waitFor(() => expect(service.getOperation(operation.id).state).toBe("interrupted"));
    expect(service.getOperation(operation.id).error?.code).toBe("RECOVERY_REQUIRED");
    await expect(service.requestLifecycle(
      "local-test", "stop", "a23e4567-e89b-42d3-a456-426614174000"
    )).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "recovery-required" });
  });

  it.each([
    ["start", "running"],
    ["stop", "stopped"]
  ] as const)("returns a successful %s operation without invoking the adapter when already %s", async (kind, state) => {
    const fixture = createAdapter(status(state, state === "running" ? "managed" : "none"));
    const service = await createService(fixture.adapter);

    const created = await service.requestLifecycle(
      "local-test",
      kind,
      kind === "start"
        ? "123e4567-e89b-42d3-a456-426614174000"
        : "223e4567-e89b-42d3-a456-426614174000"
    );

    await vi.waitFor(() => expect(service.getOperation(created.id).state).toBe("succeeded"));
    expect(service.getOperation(created.id)).toMatchObject({
      kind,
      state: "succeeded",
      step: "completed",
      result: { resourceId: null, rollbackAvailable: false },
      error: null
    });
    expect(fixture.start).not.toHaveBeenCalled();
    expect(fixture.stop).not.toHaveBeenCalled();
  });

  it("still rejects an externally owned process instead of treating it as a no-op", async () => {
    const fixture = createAdapter(status("running", "external"));
    const service = await createService(fixture.adapter);

    await expect(service.requestLifecycle(
      "local-test",
      "start",
      "323e4567-e89b-42d3-a456-426614174000"
    )).rejects.toMatchObject({ code: "ACTION_UNAVAILABLE", reason: "external-process" });
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it("does not treat an unsupported engine's stopped state as a supported no-op", async () => {
    const fixture = createAdapter(status("stopped", "none"), "paper");
    const service = await createService(fixture.adapter);

    await expect(service.requestLifecycle(
      "local-test",
      "stop",
      "823e4567-e89b-42d3-a456-426614174000"
    )).rejects.toMatchObject({ code: "ACTION_UNAVAILABLE", reason: "capability-unsupported" });
    expect(fixture.stop).not.toHaveBeenCalled();
  });

  it("checks the active-operation gate before same-state no-op handling", async () => {
    const fixture = createAdapter(status("stopped", "managed"));
    fixture.start.mockImplementation(async () => new Promise<void>(() => {}));
    const service = await createService(fixture.adapter);
    await service.requestLifecycle(
      "local-test",
      "start",
      "423e4567-e89b-42d3-a456-426614174000"
    );

    await expect(service.requestLifecycle(
      "local-test",
      "stop",
      "523e4567-e89b-42d3-a456-426614174000"
    )).rejects.toMatchObject({ code: "OPERATION_CONFLICT", reason: "operation-active" });
  });

  it("checks the recovery gate before same-state no-op handling", async () => {
    const interrupted: StoredOperation = {
      operation: {
        id: "123e4567-e89b-42d3-a456-426614174001",
        serverId: "local-test",
        kind: "stop",
        state: "interrupted",
        step: "recovery-required",
        progress: null,
        createdAt: clock.now().toISOString(),
        updatedAt: clock.now().toISOString(),
        result: null,
        error: { code: "RECOVERY_REQUIRED", message: "recovery required" }
      },
      idempotencyKey: "623e4567-e89b-42d3-a456-426614174000",
      requestFingerprint: "stored",
      expiresAt: "2026-09-29T00:00:00.000Z"
    };
    const store: OperationStore = {
      initialize: async () => {},
      list: async () => [interrupted],
      save: async () => {}
    };
    const fixture = createAdapter(status("stopped", "managed"));
    const service = await createService(fixture.adapter, store);

    await expect(service.requestLifecycle(
      "local-test",
      "stop",
      "723e4567-e89b-42d3-a456-426614174000"
    )).rejects.toMatchObject({ code: "RECOVERY_REQUIRED", reason: "recovery-required" });
    expect(fixture.stop).not.toHaveBeenCalled();
  });
});
