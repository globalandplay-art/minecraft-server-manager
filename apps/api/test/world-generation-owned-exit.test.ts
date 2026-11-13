import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { RuntimeOwnedLaunchObservation } from "../src/infra/runtime-contract.js";
import { generationExecutionFingerprint } from "../src/services/world-generation-execution.js";
import { captureGenerationOwnedLaunch } from "../src/services/world-generation-observation.js";

function fixture() {
  const execution = { schemaVersion: 1 as const, serverId: "owned-exit", executionOperationId: randomUUID(), preparationOperationId: randomUUID(),
    preparationTransactionId: randomUUID(), worldId: `worldv2-${randomUUID()}`, preparedRecordDigest: "a".repeat(64),
    registeredExecutionDigest: "b".repeat(64), requestDigest: "", keyDigest: "c".repeat(64) };
  execution.requestDigest = generationExecutionFingerprint(execution);
  const observation: RuntimeOwnedLaunchObservation = { launchId: randomUUID(), serverId: execution.serverId,
    ownerOperationId: execution.executionOperationId, processId: 12345, spawned: true, ready: true, stopRequested: false,
    stopOperationId: null, stopCompleted: false, errorObserved: false, exited: false, exitCode: null, signal: null, closed: false };
  const runtime = { getOwnedLaunchObservation: vi.fn((): RuntimeOwnedLaunchObservation | null => structuredClone(observation)) };
  const adapter = { serverId: execution.serverId, mode: "local", plan: { serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getRuntime: vi.fn(() => runtime) } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]);
  const complete = () => Object.assign(observation, { stopRequested: true, stopOperationId: execution.executionOperationId,
    stopCompleted: true, exited: true, closed: true, exitCode: 0 });
  return { execution, observation, runtime, adapter, registry, complete };
}

describe("ephemeral generation child exit binding (not world birth)", () => {
  it("requires actual normal exit/close of the same ready owned launch and rechecks on every call", () => {
    const f = fixture(), witness = captureGenerationOwnedLaunch(f.registry, f.execution.serverId, f.execution, null);
    expect(() => witness.assertStopped()).toThrow(); f.complete();
    expect(witness.assertStopped()).toEqual({ launchId: f.observation.launchId, executionOperationId: f.execution.executionOperationId, normallyExited: true });
    Object.assign(f.observation, { launchId: randomUUID() }); expect(() => witness.assertStopped()).toThrow();
  });
  it.each([
    ["spawned", false], ["ready", false], ["errorObserved", true], ["stopRequested", true], ["stopCompleted", true],
    ["exited", true], ["closed", true], ["exitCode", 0], ["signal", "SIGTERM"], ["processId", null], ["processId", 0],
    ["ownerOperationId", randomUUID()], ["serverId", "other"]
  ])("rejects invalid initial %s=%s", (field, value) => {
    const f = fixture(); Object.assign(f.observation, { [field as string]: value });
    expect(() => captureGenerationOwnedLaunch(f.registry, f.execution.serverId, f.execution, null)).toThrow();
  });
  it("rejects a prior launch or a runtime without in-memory observation", () => {
    const f = fixture();
    expect(() => captureGenerationOwnedLaunch(f.registry, f.execution.serverId, f.execution, f.observation.launchId)).toThrow();
    f.runtime.getOwnedLaunchObservation.mockReturnValue(null);
    expect(() => captureGenerationOwnedLaunch(f.registry, f.execution.serverId, f.execution, null)).toThrow();
  });
  it.each([
    ["stopRequested", false], ["stopCompleted", false], ["exited", false], ["closed", false], ["exitCode", 1],
    ["exitCode", null], ["signal", "SIGTERM"], ["errorObserved", true], ["ready", false], ["processId", 67890],
    ["launchId", randomUUID()], ["ownerOperationId", randomUUID()], ["stopOperationId", randomUUID()], ["serverId", "other"]
  ])("rejects incomplete or changed final %s=%s", (field, value) => {
    const f = fixture(), witness = captureGenerationOwnedLaunch(f.registry, f.execution.serverId, f.execution, null);
    f.complete(); Object.assign(f.observation, { [field as string]: value }); expect(() => witness.assertStopped()).toThrow();
  });
  it("rejects observer disposal or runtime replacement after capture", () => {
    const f = fixture(), witness = captureGenerationOwnedLaunch(f.registry, f.execution.serverId, f.execution, null); f.complete();
    f.runtime.getOwnedLaunchObservation.mockReturnValue(null); expect(() => witness.assertStopped()).toThrow();
    f.runtime.getOwnedLaunchObservation.mockReturnValue(structuredClone(f.observation));
    vi.spyOn(f.adapter, "getRuntime").mockReturnValue({} as never); expect(() => witness.assertStopped()).toThrow();
  });
});
