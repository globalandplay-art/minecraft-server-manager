import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import type { RuntimeOwnedLaunchObservation } from "../src/infra/runtime-contract.js";
import { captureOwnedWorldLifecycle } from "../src/services/world-owned-lifecycle.js";

function fixture() {
  const identity = { rootIdentity: "a".repeat(64), javaIdentity: "b".repeat(64), javaSha256: "c".repeat(64),
    launcherIdentity: "d".repeat(64), launcherSha256: "e".repeat(64) };
  const expected = { serverId: "normal-world", startOperationId: randomUUID(), previousLaunchId: null as string | null,
    registeredExecutionDigest: createHash("sha256").update(JSON.stringify(identity)).digest("hex") };
  const stopId = randomUUID();
  const observation: RuntimeOwnedLaunchObservation = { launchId: randomUUID(), serverId: expected.serverId,
    ownerOperationId: expected.startOperationId, processId: 12345, spawned: true, ready: true, stopRequested: false,
    stopOperationId: null, stopCompleted: false, errorObserved: false, exited: false, exitCode: null, signal: null, closed: false };
  const runtime = { getOwnedLaunchObservation: vi.fn((): RuntimeOwnedLaunchObservation | null => structuredClone(observation)) };
  const adapter = { serverId: expected.serverId, mode: "local", plan: { rootPath: "fixture-root", serverInfo: { type: "vanilla", minecraftVersion: "26.3" } },
    getRuntime: vi.fn(() => runtime), getRegisteredExecutionIdentity: vi.fn(() => identity) } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]);
  const complete = () => Object.assign(observation, { stopRequested: true, stopOperationId: stopId, stopCompleted: true, exited: true, closed: true, exitCode: 0 });
  return { identity, expected, stopId, observation, runtime, adapter, registry, complete };
}

describe("ordinary owned lifecycle observation, not revision authority", () => {
  it("binds different start/stop operations to one ready launch and checks every use", () => {
    const f = fixture(), proof = captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined);
    expect(() => proof.assertStopped(f.stopId)).toThrow(); f.complete();
    expect(proof.assertStopped(f.stopId)).toEqual({ phase: "owned-normal-lifecycle-only", inspectionOnly: true,
      serverId: f.expected.serverId, launchId: f.observation.launchId, startOperationId: f.expected.startOperationId,
      stopOperationId: f.stopId, registeredExecutionDigest: f.expected.registeredExecutionDigest, normallyExited: true });
    expect(() => proof.assertStopped(randomUUID())).toThrow();
    Object.assign(f.observation, { launchId: randomUUID() }); expect(() => proof.assertStopped(f.stopId)).toThrow();
  });
  it("rejects reconstructing the witness after exit or from stopped status alone", () => {
    const f = fixture(); f.complete();
    expect(() => captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined)).toThrow();
    f.runtime.getOwnedLaunchObservation.mockReturnValue(null);
    expect(() => captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined)).toThrow();
  });
  it("keeps private expected binding detached from mutable caller input", () => {
    const f = fixture(), proof = captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined);
    f.expected.serverId = "other"; f.expected.startOperationId = randomUUID(); f.expected.registeredExecutionDigest = "f".repeat(64);
    f.complete(); expect(proof.assertStopped(f.stopId).serverId).toBe("normal-world");
  });
  it.each(["Java", "runtime", "registry", "root"])("rejects changed %s binding after capture", kind => {
    const f = fixture(), proof = captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined); f.complete();
    if (kind === "Java") f.identity.javaSha256 = "f".repeat(64);
    if (kind === "runtime") vi.spyOn(f.adapter, "getRuntime").mockReturnValue({} as never);
    if (kind === "registry") { f.registry.remove(f.expected.serverId, f.adapter); f.registry.add({ ...f.adapter } as never); }
    if (kind === "root") Object.assign(f.adapter.plan, { rootPath: "other-root" });
    expect(() => proof.assertStopped(f.stopId)).toThrow();
  });
  it("rejects prior launches, unverified registration, unsupported profiles and another instance", () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => { f.expected.previousLaunchId = f.observation.launchId; },
      (f: ReturnType<typeof fixture>) => { f.expected.registeredExecutionDigest = "f".repeat(64); },
      (f: ReturnType<typeof fixture>) => { Object.assign(f.adapter.plan.serverInfo, { minecraftVersion: "unknown" }); },
      (f: ReturnType<typeof fixture>) => { Object.assign(f.adapter.plan.serverInfo, { type: "paper" }); },
      (f: ReturnType<typeof fixture>) => { Object.assign(f.observation, { serverId: "other" }); }
    ]) { const f = fixture(); change(f); expect(() => captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined)).toThrow(); }
  });
  it.each([
    ["stopRequested", false], ["stopCompleted", false], ["closed", false], ["exited", false], ["exitCode", 1],
    ["exitCode", null], ["signal", "SIGTERM"], ["errorObserved", true], ["ready", false], ["processId", 54321],
    ["ownerOperationId", randomUUID()]
  ])("keeps uncertain stop %s=%s rejected", (field, value) => {
    const f = fixture(), proof = captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined);
    f.complete(); Object.assign(f.observation, { [field as string]: value }); expect(() => proof.assertStopped(f.stopId)).toThrow();
  });
  it("does not reuse the generation same-operation stop protocol", () => {
    const f = fixture(), proof = captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined); f.complete();
    Object.assign(f.observation, { stopOperationId: f.expected.startOperationId });
    expect(() => proof.assertStopped(f.expected.startOperationId)).toThrow();
  });
  it("rejects observation disposal after capture even if the last copied fields said stopped", () => {
    const f = fixture(), proof = captureOwnedWorldLifecycle(f.registry, f.expected, () => undefined); f.complete();
    expect(proof.assertStopped(f.stopId).normallyExited).toBe(true);
    f.runtime.getOwnedLaunchObservation.mockReturnValue(null);
    expect(() => proof.assertStopped(f.stopId)).toThrow();
  });
  it("rejects admission becoming asynchronous after a valid initial capture", () => {
    const f = fixture(); let asynchronous = false;
    const authorize = (() => asynchronous ? Promise.resolve() : undefined) as () => undefined;
    const proof = captureOwnedWorldLifecycle(f.registry, f.expected, authorize); f.complete(); asynchronous = true;
    expect(() => proof.assertStopped(f.stopId)).toThrow();
  });
  it("rejects revoked or asynchronous admission on initial and final observation", () => {
    const f = fixture(); let active = true;
    const authorize = () => { if (!active) throw new Error("fixed-test-revocation"); return undefined; };
    const proof = captureOwnedWorldLifecycle(f.registry, f.expected, authorize); f.complete(); active = false;
    expect(() => proof.assertStopped(f.stopId)).toThrow();
    expect(() => captureOwnedWorldLifecycle(f.registry, f.expected, (() => Promise.resolve()) as never)).toThrow();
  });
});
