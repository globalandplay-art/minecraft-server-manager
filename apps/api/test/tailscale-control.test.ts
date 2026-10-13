import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DomainError } from "../src/services/domain-errors.js";
import { TailscaleControlAdapter, type TailscaleCommitProof } from "../src/services/tailscale-control-adapter.js";
import { accessHash } from "../src/services/access-operation-record.js";
import { FakeTailscaleDaemon, tailscaleControlFixture } from "./tailscale-control-fixture.js";

it("atomically enables/disables, replays persisted keys after Manager restart, and keeps URL unverified", async () => {
  const f = await tailscaleControlFixture();
  try {
    let { operations, control } = await f.open(); const key = randomUUID();
    expect((await control.read()).state).toBe("ready"); expect(f.daemon.calls).toBe(0);
    const on = await operations.submit("tailscale", "enable", f.body(), key, () => {});
    expect(on.state).toBe("succeeded"); expect(f.daemon.commits).toBe(1);
    expect(await control.read()).toMatchObject({ state: "enabled", observedEnabled: true, connectionUrl: null, remoteVerifiedAt: null });
    await operations.close(); ({ operations, control } = await f.open());
    expect((await operations.submit("tailscale", "enable", f.body(), key, () => {})).id).toBe(on.id);
    expect(f.daemon.commits).toBe(1);
    await expect(operations.submit("tailscale", "disable", f.body(), key, () => {})).rejects.toMatchObject({ code: "ACCESS_CONFLICT" });
    const off = await operations.submit("tailscale", "disable", f.body(), randomUUID(), () => {});
    expect(off.state).toBe("succeeded"); expect(f.daemon.snapshot.configuration).toBe("{}");
    expect((await control.read()).state).toBe("ready"); expect(f.daemon.commits).toBe(2);
  } finally { await f.close(); }
});
it("lost response retains recovery evidence and explicit recovery never repeats provider mutation", async () => {
  const f = await tailscaleControlFixture();
  try {
    let { operations } = await f.open(); f.daemon.loseResponse = true;
    const result = await operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {});
    expect(result.state).toBe("recovery_required"); expect(f.daemon.commits).toBe(1);
    await operations.close(); const reopened = await f.open(); operations = reopened.operations;
    expect((await reopened.control.read()).recoveryOperationId).toBe(result.id);
    await expect(operations.submit("tailscale", "disable", f.body(), randomUUID(), () => {})).rejects.toMatchObject({ code: "ACCESS_RECOVERY_REQUIRED" });
    expect((await operations.recover(result.id, f.body(), () => {})).state).toBe("succeeded");
    expect(f.daemon.calls).toBe(1); expect(f.daemon.commits).toBe(1);
  } finally { await f.close(); }
});
it("serialized Fake commit model reconstructs a new daemon object without inferring a missing receipt", async () => {
  const f = await tailscaleControlFixture();
  try {
    const { operations } = await f.open(); f.daemon.loseResponse = true;
    const result = await operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {});
    const saved = JSON.stringify({ snapshot: f.daemon.snapshot, proofs: [...f.daemon.proofs], counter: f.daemon.counter });
    const decoded = JSON.parse(saved) as { snapshot: typeof f.daemon.snapshot; proofs: [string, TailscaleCommitProof][]; counter: number };
    const reconstructed = new FakeTailscaleDaemon(); reconstructed.snapshot = decoded.snapshot;
    reconstructed.proofs = new Map(decoded.proofs); reconstructed.counter = decoded.counter;
    await operations.close(); const restarted = await f.open(reconstructed);
    expect(reconstructed).not.toBe(f.daemon); expect((await restarted.operations.get(result.id)).state).toBe("recovery_required");
    expect((await restarted.operations.recover(result.id, f.body(), () => {})).state).toBe("succeeded");
    expect(reconstructed.calls).toBe(0); expect(reconstructed.commits).toBe(0);
    expect((await restarted.control.read()).state).toBe("enabled");
    // Serialization validates the model only, not real daemon or power-loss durability.
  } finally { await f.close(); }
});
it.each(["same-shape", "aba", "missing-proof", "wrong-proof", "wrong-manager", "wrong-head", "wrong-before", "wrong-owner"])("%s cannot impersonate operation evidence", async (failure) => {
  const f = await tailscaleControlFixture();
  try {
    const { operations } = await f.open(); f.daemon.loseResponse = true;
    const result = await operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {});
    if (failure === "same-shape") f.daemon.externalWrite();
    if (failure === "aba") { const config = f.daemon.snapshot.configuration; f.daemon.externalWrite("{}"); f.daemon.externalWrite(config); }
    if (failure === "missing-proof") f.daemon.proofs.delete(result.id);
    if (failure === "wrong-proof") f.daemon.proofs.get(result.id)!.intentHash = "0".repeat(64);
    if (failure === "wrong-manager") f.daemon.proofs.get(result.id)!.managerIdentity = "0".repeat(64);
    if (failure === "wrong-head") f.daemon.proofs.get(result.id)!.finalRevision = "0".repeat(64);
    if (failure === "wrong-before") f.daemon.proofs.get(result.id)!.previousConfigurationHash = "0".repeat(64);
    if (failure === "wrong-owner") f.daemon.snapshot.ownership!.resourceRevision = "0".repeat(64);
    await expect(operations.recover(result.id, f.body(), () => {})).rejects.toThrow();
    expect((await operations.get(result.id)).state).toBe("recovery_required"); expect(f.daemon.commits).toBe(1);
  } finally { await f.close(); }
});
it("lost disable response recovers from its exact previous owning receipt without resurrecting the route", async () => {
  const f = await tailscaleControlFixture();
  try {
    const { operations } = await f.open();
    expect((await operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {})).state).toBe("succeeded");
    f.daemon.loseResponse = true;
    const off = await operations.submit("tailscale", "disable", f.body(), randomUUID(), () => {});
    expect(off.state).toBe("recovery_required"); expect(f.daemon.snapshot.configuration).toBe("{}");
    expect(f.daemon.proofs.get(off.id)!.previousOwnership).not.toBeNull();
    expect((await operations.recover(off.id, f.body(), () => {})).state).toBe("succeeded");
    expect(f.daemon.calls).toBe(2); expect(f.daemon.commits).toBe(2); expect(f.daemon.snapshot.configuration).toBe("{}");
  } finally { await f.close(); }
});
it("new-key disable of empty config and enable of owned config are rejected before admission", async () => {
  const f = await tailscaleControlFixture();
  try {
    const { operations } = await f.open();
    await expect(operations.submit("tailscale", "disable", f.body(), randomUUID(), () => {})).rejects.toMatchObject({ code: "TAILSCALE_OWNERSHIP_CONFLICT" });
    expect(f.writes()).toBe(0); expect(f.daemon.calls).toBe(0);
    await operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {});
    const before = f.writes();
    await expect(operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {})).rejects.toMatchObject({ code: "TAILSCALE_OWNERSHIP_CONFLICT" });
    expect(f.writes()).toBe(before); expect(f.daemon.calls).toBe(1); expect(f.daemon.commits).toBe(1);
  } finally { await f.close(); }
});
it.each(["missing", "namespace", "intent", "root"])("%s owning receipt blocks new disable before admission", async (failure) => {
  const f = await tailscaleControlFixture();
  try {
    const { operations } = await f.open();
    const enabled = await operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {});
    const writes = f.writes();
    const proof = f.daemon.proofs.get(enabled.id)!;
    if (failure === "missing") f.daemon.proofs.delete(enabled.id);
    if (failure === "namespace") proof.directoryIdentity = accessHash("replaced-namespace");
    if (failure === "intent") proof.intent.requestHash = accessHash("different-request");
    if (failure === "root") proof.rootIdentity = accessHash("different-manager");
    await expect(operations.submit("tailscale", "disable", f.body(), randomUUID(), () => {})).rejects.toThrow();
    expect(f.writes()).toBe(writes); expect(f.daemon.commits).toBe(1);
    expect(f.daemon.snapshot.configuration).not.toBe("{}");
  } finally { await f.close(); }
});
it("another Manager root cannot claim an otherwise valid owning receipt", async () => {
  const f = await tailscaleControlFixture();
  try {
    const { operations } = await f.open(); await operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {});
    const foreign = new TailscaleControlAdapter(f.daemon, accessHash("another-root"));
    await expect(foreign.preflight("tailscale", "disable")).rejects.toThrow(); expect(f.daemon.commits).toBe(1);
  } finally { await f.close(); }
});
it("preview holds Access exclusion through daemon observation", async () => {
  const f = await tailscaleControlFixture(); let release!: () => void;
  try {
    const { operations, control } = await f.open();
    const read = f.daemon.read.bind(f.daemon); let reached!: () => void;
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const pause = new Promise<void>((resolve) => { release = resolve; });
    f.daemon.read = async () => { reached(); await pause; return read(); };
    const preview = control.read(); await entered;
    await expect(operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {})).rejects.toMatchObject({ code: "ACCESS_BUSY" });
    release(); expect((await preview).state).toBe("ready"); expect(f.daemon.commits).toBe(0);
  } finally { release?.(); await f.close(); }
});
it.each(["external-config", "funnel", "extra-route", "non-atomic", "target", "daemon", "tailnet"])("%s blocks mutation with zero commits", async (failure) => {
  const f = await tailscaleControlFixture();
  try {
    const { operations } = await f.open();
    if (failure === "external-config") f.daemon.externalWrite('{"TCP":{"443":{"HTTPS":true}}}');
    if (failure === "funnel") f.daemon.externalWrite('{"AllowFunnel":{"test.tail123.ts.net:443":true}}');
    if (failure === "extra-route") f.daemon.externalWrite('{"Web":{"test.tail123.ts.net:443":{"Handlers":{"/other":{"Text":"external"}}}}}');
    if (failure === "non-atomic") f.daemon.snapshot.atomic = false;
    if (failure === "target") f.daemon.snapshot.target.owned = false;
    if (failure === "daemon") f.daemon.snapshot.ready = false;
    if (failure === "tailnet") f.daemon.snapshot.tailnetIdentity = "unknown";
    await expect(operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {})).rejects.toThrow();
    expect(f.daemon.calls).toBe(0); expect(f.daemon.commits).toBe(0); expect(f.writes()).toBe(0);
  } finally { await f.close(); }
});
it.each(["drift", "auth"])("%s at final CAS gate preserves intent and never commits", async (failure) => {
  const f = await tailscaleControlFixture();
  try {
    const { operations } = await f.open(); let authorized = true;
    f.daemon.beforeCommit = async () => { if (failure === "drift") f.daemon.externalWrite(); else authorized = false; };
    const request = operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {
      if (!authorized) throw new DomainError(403, "AUTH_REAUTH_REQUIRED", "Recent authentication required.");
    });
    if (failure === "auth") await expect(request).rejects.toMatchObject({ code: "AUTH_REAUTH_REQUIRED" });
    else expect((await request).state).toBe("recovery_required");
    expect(f.daemon.commits).toBe(0); expect(f.writes()).toBeGreaterThan(0);
    expect((await operations.controlState()).recoveryOperationId).not.toBeNull();
  } finally { await f.close(); }
});
it("blocks both providers during one final commit and refuses unsupported Cloudflare", async () => {
  const f = await tailscaleControlFixture(); let release!: () => void;
  try {
    const { operations } = await f.open(); const pause = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void; const reached = new Promise<void>((resolve) => { entered = resolve; });
    f.daemon.beforeCommit = async () => { entered(); await pause; };
    const pending = operations.submit("tailscale", "enable", f.body(), randomUUID(), () => {}); await reached;
    await expect(operations.submit("cloudflare", "enable", f.body(), randomUUID(), () => {})).rejects.toMatchObject({ code: "ACCESS_BUSY" });
    release(); expect((await pending).state).toBe("succeeded");
    await expect(operations.submit("cloudflare", "enable", f.body(), randomUUID(), () => {})).rejects.toThrow();
    expect(f.daemon.commits).toBe(1);
  } finally { release?.(); await f.close(); }
});
