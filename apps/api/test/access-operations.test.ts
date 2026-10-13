import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, unlink, link, rename, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { accessFixture } from "./access-operation-fixture.js";
import { AccessOperationService } from "../src/services/access-operation-service.js";
import { accessHash } from "../src/services/access-operation-record.js";
import { DomainError } from "../src/services/domain-errors.js";

const authorize = () => {};
it("projects an orphan applying record as recovery even during idempotent replay", async () => {
  const f = await accessFixture(); let release!: () => void; let entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  try {
    const { store } = await f.open(); const key = randomUUID(); const id = randomUUID(); const now = new Date().toISOString();
    await store.exclusive(async () => {
      await store.admit({ schemaVersion: 1, sequence: 0, previousHash: null, idempotencyHash: accessHash(key),
        requestHash: accessHash(JSON.stringify({ provider: "tailscale", action: "enable", ...f.body() })),
        configurationRevision: f.adapter.revision, observedRevision: accessHash("tailscale"), ownershipRevision: accessHash("ownership-tailscale"),
        previousEnabled: false, operation: { schemaVersion: 1, id, resource: { kind: "manager-access", provider: "tailscale" },
          action: "enable", state: "intent_persisted", createdAt: now, updatedAt: now, errorCode: null } }, authorize);
      await store.append(id, "applying", null, now);
    });
    const { service } = await f.open();
    f.acl.beforeCheck = async () => { entered(); await pending; };
    const replay = service.submit("tailscale", "enable", f.body(), key, authorize); await started;
    expect((await service.get(id)).state).toBe("recovery_required");
    release(); expect((await replay).state).toBe("recovery_required"); expect(f.adapter.calls).toBe(0);
  } finally { release(); await f.close(); }
});
it.each(["replacement", "junction"])("rejects an operation directory %s without following it", async (fault) => {
  const f = await accessFixture();
  try {
    const { service, store } = await f.open(); await service.submit("tailscale", "enable", f.body(), randomUUID(), authorize);
    const directory = path.join(f.root, "access-operations"); const retained = path.join(f.root, "retained-operations");
    await rename(directory, retained);
    if (fault === "junction") await symlink(retained, directory, "junction"); else await mkdir(directory);
    await expect(store.scan()).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
    expect(await readdir(retained)).toHaveLength(4); expect(f.adapter.calls).toBe(1);
  } finally { await f.close(); }
});
it("does not overwrite a foreign publication destination and preserves its stage", async () => {
  const f = await accessFixture(); let collided = "";
  try {
    const { service } = await f.open({ ...f.publication, publishNew: async (stage, target) => {
      if (target.endsWith(".0000.json")) { await writeFile(target, "foreign-owned", { flag: "wx" }); collided = target; }
      await f.publication.publishNew(stage, target);
    } });
    await expect(service.submit("tailscale", "enable", f.body(), randomUUID(), authorize)).rejects.toMatchObject({ code: "ACCESS_RECOVERY_REQUIRED" });
    expect(await readFile(collided, "utf8")).toBe("foreign-owned");
    expect((await readFile(collided + ".stage")).length).toBeGreaterThan(0); expect(f.adapter.calls).toBe(0);
  } finally { await f.close(); }
});
it("serializes a GET disk scan with admission instead of poisoning a legitimate publisher", async () => {
  const f = await accessFixture(); let release!: () => void; let entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  try {
    const { service } = await f.open();
    const op = await service.submit("tailscale", "enable", f.body(), randomUUID(), authorize);
    f.acl.beforeCheck = async () => { entered(); await pending; };
    const query = service.get(op.id); await started;
    await expect(service.submit("cloudflare", "enable", f.body(), randomUUID(), authorize)).rejects.toMatchObject({ code: "ACCESS_BUSY" });
    release(); expect((await query).state).toBe("succeeded"); f.acl.beforeCheck = async () => {};
    expect((await service.submit("cloudflare", "enable", f.body(), randomUUID(), authorize)).state).toBe("succeeded");
  } finally { release(); await f.close(); }
});
it("rechecks recovery authorization after the final ACL wait without poisoning retained evidence", async () => {
  const f = await accessFixture();
  try {
    const { service } = await f.open(); f.adapter.lostResponse = true;
    const op = await service.submit("tailscale", "enable", f.body(), randomUUID(), authorize);
    const writes = f.writes(); let expired = false;
    await expect(service.recover(op.id, f.body(), () => {
      if (expired) throw new DomainError(403, "AUTH_REAUTH_REQUIRED", "fixed");
      f.acl.beforeCheck = async () => { expired = true; };
    })).rejects.toMatchObject({ code: "AUTH_REAUTH_REQUIRED" });
    expect(f.writes()).toBe(writes); expect(f.adapter.calls).toBe(1);
    f.acl.beforeCheck = async () => {};
    expect((await service.get(op.id)).state).toBe("recovery_required");
    expect((await service.recover(op.id, f.body(), authorize)).state).toBe("succeeded");
  } finally { await f.close(); }
});
it("persists both provider operations, immutable checkpoints and cross-restart idempotency", async () => {
  const f = await accessFixture();
  try {
    const { store, service } = await f.open(); const key = randomUUID();
    expect(f.writes()).toBe(0);
    const first = await service.submit("tailscale", "enable", f.body(), key, authorize);
    expect(first.state).toBe("succeeded"); expect(f.adapter.calls).toBe(1);
    const before = await readdir(path.join(f.root, "access-operations"));
    expect(before).toHaveLength(4);
    const chains = await store.scan();
    expect(chains[0]!.map((c) => c.operation.state)).toEqual(["intent_persisted", "applying", "verifying", "succeeded"]);
    for (const name of before) expect((await readFile(path.join(f.root, "access-operations", name))).length).toBeLessThanOrEqual(4096);
    const reopened = await f.open();
    expect(await reopened.service.submit("tailscale", "enable", f.body(), key, authorize)).toEqual(first);
    await expect(reopened.service.submit("tailscale", "disable", f.body(), key, authorize)).rejects.toMatchObject({ code: "ACCESS_CONFLICT" });
    expect(f.adapter.calls).toBe(1); expect(await readdir(path.join(f.root, "access-operations"))).toEqual(before);
    expect((await reopened.service.submit("cloudflare", "enable", f.body(), randomUUID(), authorize)).state).toBe("succeeded");
    expect((await reopened.service.submit("tailscale", "disable", f.body(), randomUUID(), authorize)).state).toBe("succeeded");
    expect(f.adapter.states.get("tailscale")!.enabled).toBe(false); expect(f.adapter.states.get("cloudflare")!.enabled).toBe(true);
    const response = JSON.stringify(first);
    for (const secret of [key, f.root, "ownershipRevision", "requestHash", "observedRevision"]) expect(response).not.toContain(secret);
  } finally { await f.close(); }
});
it.each(["AUTH_REQUIRED", "AUTH_REAUTH_REQUIRED", "AUTH_AUDIT_UNAVAILABLE", "CSRF_REJECTED"])("rejects final admission %s after waits without any publication or modification", async (code) => {
  const f = await accessFixture();
  try {
    const { service } = await f.open(); let expired = false;
    f.adapter.duringPreflight = async () => { expired = true; };
    await expect(service.submit("tailscale", "enable", f.body(), randomUUID(), () => {
      if (expired) throw new DomainError(403, code, "fixed");
    })).rejects.toMatchObject({ code });
    expect(f.writes()).toBe(0); expect(f.adapter.calls).toBe(0); expect(await readdir(f.root)).toEqual([]);
  } finally { await f.close(); }
});
it("blocks stale revision and production unavailable without creating a namespace", async () => {
  const f = await accessFixture();
  try {
    const { service } = await f.open();
    await expect(service.submit("tailscale", "enable", { revision: randomUUID(), confirm: true }, randomUUID(), authorize)).rejects.toMatchObject({ code: "ACCESS_CONFLICT" });
    await expect(new AccessOperationService().submit("tailscale", "enable", f.body(), randomUUID(), authorize)).rejects.toMatchObject({ code: "ACCESS_UNAVAILABLE" });
    expect(f.writes()).toBe(0); expect(f.adapter.calls).toBe(0);
  } finally { await f.close(); }
});
it("excludes both providers during apply and supplies the verified running checkpoint", async () => {
  const f = await accessFixture(); let release!: () => void; let entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  try {
    const { service, store } = await f.open(); f.adapter.duringApply = async () => { entered(); await pending; };
    const task = service.submit("tailscale", "enable", f.body(), randomUUID(), authorize);
    await started; const id = (await store.scan())[0]![0]!.operation.id;
    expect((await service.get(id)).state).toBe("applying");
    await expect(service.submit("cloudflare", "disable", f.body(), randomUUID(), authorize)).rejects.toMatchObject({ code: "ACCESS_BUSY" });
    release(); expect((await task).state).toBe("succeeded"); expect(f.adapter.calls).toBe(1);
  } finally { release(); await f.close(); }
});
it("retains lost response and explicitly confirms applied state after restart without reapplying", async () => {
  const f = await accessFixture();
  try {
    const { service } = await f.open(); f.adapter.lostResponse = true; const key = randomUUID();
    const op = await service.submit("tailscale", "enable", f.body(), key, authorize);
    expect(op.state).toBe("recovery_required");
    const next = await f.open(); expect((await next.service.get(op.id)).state).toBe("recovery_required");
    expect((await next.service.submit("tailscale", "enable", f.body(), key, authorize)).id).toBe(op.id);
    await expect(next.service.submit("cloudflare", "enable", f.body(), randomUUID(), authorize)).rejects.toMatchObject({ code: "ACCESS_RECOVERY_REQUIRED" });
    expect((await next.service.recover(op.id, f.body(), authorize)).state).toBe("succeeded");
    const writes = f.writes(); expect((await next.service.recover(op.id, f.body(), authorize)).state).toBe("succeeded");
    expect(f.writes()).toBe(writes); expect(f.adapter.calls).toBe(1);
  } finally { await f.close(); }
});
it("never accepts unknown health or incomplete ownership evidence during explicit recovery", async () => {
  const f = await accessFixture();
  try {
    const { service } = await f.open(); f.adapter.unknown = true;
    const op = await service.submit("tailscale", "enable", f.body(), randomUUID(), authorize);
    expect(op.state).toBe("recovery_required"); const writes = f.writes();
    await expect(service.recover(op.id, f.body(), authorize)).rejects.toMatchObject({ code: "ACCESS_RECOVERY_REQUIRED" });
    expect(f.writes()).toBe(writes); expect(f.adapter.calls).toBe(1);
    f.adapter.unknown = false; const original = f.adapter.observe.bind(f.adapter);
    f.adapter.observe = async (intent) => ({ ...await original(intent), ownershipRevision: "0".repeat(64) });
    await expect(service.recover(op.id, f.body(), authorize)).rejects.toMatchObject({ code: "ACCESS_RECOVERY_REQUIRED" });
    expect(f.writes()).toBe(writes);
  } finally { await f.close(); }
});
it("confirms not-applied evidence as failed without retrying the adapter", async () => {
  const f = await accessFixture();
  try {
    const { service } = await f.open(); f.adapter.duringApply = async () => { throw new Error("fixture-before-effect"); };
    const op = await service.submit("tailscale", "enable", f.body(), randomUUID(), authorize);
    expect(op.state).toBe("recovery_required");
    expect(await service.recover(op.id, f.body(), authorize)).toMatchObject({ state: "failed", errorCode: "ACCESS_VERIFICATION_FAILED" });
    expect(f.adapter.calls).toBe(1); expect(f.adapter.states.size).toBe(0);
  } finally { await f.close(); }
});
it.each(["namespace", "intent", "terminal"])("preserves %s publication failure and blocks restart without unsafe retry", async (boundary) => {
  const f = await accessFixture();
  try {
    const pub = { ...f.publication, publishNew: async (stage: string, target: string) => {
      if ((boundary === "namespace" && target.endsWith("access-operations.receipt.json")) ||
        (boundary === "intent" && target.endsWith(".0000.json")) || (boundary === "terminal" && target.endsWith(".0003.json"))) throw new Error("fixture-publication-fault");
      await f.publication.publishNew(stage, target);
    } };
    const { service } = await f.open(pub);
    if (boundary === "terminal") expect((await service.submit("tailscale", "enable", f.body(), randomUUID(), authorize)).state).toBe("recovery_required");
    else await expect(service.submit("tailscale", "enable", f.body(), randomUUID(), authorize)).rejects.toMatchObject({ code: "ACCESS_RECOVERY_REQUIRED" });
    expect(f.adapter.calls).toBe(boundary === "terminal" ? 1 : 0);
    await expect(f.open()).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
    expect(await readdir(f.root)).not.toEqual([]);
  } finally { await f.close(); }
});
it.each(["chain-gap", "hardlink", "acl", "stage", "namespace-loss", "tail-loss", "corruption"])("fails closed for %s without deleting history", async (fault) => {
  const f = await accessFixture();
  try {
    const { store, service } = await f.open(); const op = await service.submit("tailscale", "enable", f.body(), randomUUID(), authorize);
    const directory = path.join(f.root, "access-operations"); const genesis = path.join(directory, `${op.id}.0000.json`);
    if (fault === "chain-gap") await unlink(path.join(directory, `${op.id}.0001.json`));
    if (fault === "tail-loss") await unlink(path.join(directory, `${op.id}.0003.json`));
    if (fault === "hardlink") await link(genesis, path.join(f.root, "fixture-link"));
    if (fault === "acl") f.acl.denied = true;
    if (fault === "stage") await writeFile(path.join(directory, "unknown.stage"), "retained");
    if (fault === "namespace-loss") await unlink(path.join(f.root, "access-operations.receipt.json"));
    if (fault === "corruption") await writeFile(genesis, "{}");
    const before = await readdir(directory);
    await expect(store.scan()).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
    expect(await readdir(directory)).toEqual(before); expect(f.adapter.calls).toBe(1);
  } finally { await f.close(); }
});
