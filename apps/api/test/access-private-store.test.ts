import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, link, unlink, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccessPrivateStore, type AccessPublication } from "../src/services/access-private-store.js";
import { WindowsPrivateAclVerifier } from "../src/auth/windows-private-acl.js";

class TestAcl extends WindowsPrivateAclVerifier {
  denied = false;
  override async verifyMany(files: readonly string[]): Promise<string[]> {
    if (this.denied) throw new Error("synthetic-sensitive-path");
    return files.map(() => "safe-acl");
  }
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mcsm-access-test-"));
  let busy = false; let held = true; let writes = 0;
  const owner = { assertHeld: (actual: string) => { if (!held || actual !== root) throw new Error("unsafe"); },
    rootIdentity: () => createHash("sha256").update(root).digest("hex"),
    beginOfflineMutation: (actual: string) => {
      owner.assertHeld(actual); if (busy) throw new Error("busy"); busy = true; return () => { busy = false; };
    } };
  const acl = new TestAcl();
  const publication: AccessPublication = {
    createDirectory: async (directory) => { writes++; await mkdir(directory); },
    writeNew: async (file, bytes) => { writes++; await writeFile(file, bytes, { flag: "wx" }); },
    publishNew: async (stage, target) => { writes++; await link(stage, target); await unlink(stage); }
  };
  return { root, owner, acl, publication, writes: () => writes, release: () => { held = false; },
    close: () => rm(root, { recursive: true, force: true }) };
}

describe("Access private disabled bootstrap publication (injected filesystem/ACL)", () => {
  it("open/read absent never writes; explicit bootstrap survives reopen without mixing providers", async () => {
    const f = await fixture();
    try {
      const store = await AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication);
      expect(await store.read("tailscale")).toBeNull(); expect(f.writes()).toBe(0);
      expect(await readdir(f.root)).toEqual([]);
      const record = await store.initializeDisabled("tailscale");
      expect(record.desiredEnabled).toBe(false);
      const reopened = await AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication);
      expect(await reopened.read("tailscale")).toEqual(record);
      expect(await reopened.read("cloudflare")).toBeNull();
      const old = await readFile(path.join(f.root, "access", "tailscale.json"));
      await expect(reopened.initializeDisabled("tailscale")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      expect(await readFile(path.join(f.root, "access", "tailscale.json"))).toEqual(old);
    } finally { await f.close(); }
  });
  it("retains interrupted stage and blocks restart/retry without deleting evidence", async () => {
    const f = await fixture();
    try {
      const publication = { ...f.publication, publishNew: async () => { throw new Error("synthetic-secret"); } };
      const store = await AccessPrivateStore.open(f.root, f.owner, f.acl, publication);
      await expect(store.initializeDisabled("tailscale")).rejects.toThrow("Private Access storage validation failed.");
      expect(await readdir(path.join(f.root, "access"))).toEqual(["tailscale.stage.json"]);
      await expect(store.read("cloudflare")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      await expect(AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication)).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
    } finally { await f.close(); }
  });
  it("atomic no-replace rejects injected foreign destination without overwriting it", async () => {
    const f = await fixture();
    try {
      const publication = { ...f.publication, publishNew: async (stage: string, target: string) => {
        if (target.endsWith("tailscale.json")) await writeFile(target, "foreign", { flag: "wx" });
        await f.publication.publishNew(stage, target);
      } };
      const store = await AccessPrivateStore.open(f.root, f.owner, f.acl, publication);
      await expect(store.initializeDisabled("tailscale")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      expect(await readFile(path.join(f.root, "access", "tailscale.json"), "utf8")).toBe("foreign");
      expect(await readdir(path.join(f.root, "access"))).toHaveLength(2);
    } finally { await f.close(); }
  });
  it("rejects directory replacement, hardlinked record, ACL denial and released owner", async () => {
    const f = await fixture();
    try {
      const store = await AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication);
      await store.initializeDisabled("tailscale");
      const target = path.join(f.root, "access", "tailscale.json");
      await link(target, path.join(f.root, "duplicate"));
      await expect(store.read("tailscale")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      await unlink(path.join(f.root, "duplicate"));
      f.acl.denied = true;
      await expect(store.read("tailscale")).rejects.toThrow("Private Access storage validation failed.");
      f.acl.denied = false;
      await rename(path.join(f.root, "access"), path.join(f.root, "old-access")); await mkdir(path.join(f.root, "access"));
      await expect(store.read("tailscale")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      f.release();
      await expect(AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication)).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
    } finally { await f.close(); }
  });
  it("uses shared owner exclusion for concurrent explicit initialization", async () => {
    const f = await fixture();
    try {
      const store = await AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication);
      const first = store.initializeDisabled("tailscale");
      await expect(store.initializeDisabled("cloudflare")).rejects.toThrow("busy");
      expect((await first).provider).toBe("tailscale");
    } finally { await f.close(); }
  });
  it("never recreates a known missing record and verifies ACL on absent-provider reads", async () => {
    const f = await fixture();
    try {
      const store = await AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication);
      await store.initializeDisabled("tailscale");
      f.acl.denied = true;
      await expect(store.read("cloudflare")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      f.acl.denied = false;
      await unlink(path.join(f.root, "access", "tailscale.json"));
      await expect(store.read("tailscale")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      const before = f.writes();
      await expect(store.initializeDisabled("tailscale")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      expect(f.writes()).toBe(before);
      expect(await readdir(path.join(f.root, "access"))).toEqual([]);
    } finally { await f.close(); }
  });
  it("rejects missing or changed record after reopen using immutable expectation receipts", async () => {
    const f = await fixture();
    try {
      const store = await AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication);
      await store.initializeDisabled("tailscale");
      const target = path.join(f.root, "access", "tailscale.json");
      const original = await readFile(target);
      await unlink(target);
      await expect(AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication)).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      await writeFile(target, original);
      const changed = JSON.parse(original.toString()) as { revision: string };
      changed.revision = "6babd7fe-c96b-4938-917d-01def3ab4d80";
      await writeFile(target, JSON.stringify(changed));
      await expect(AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication)).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      await writeFile(target, original);
      await unlink(path.join(f.root, "access-tailscale.receipt.json"));
      await expect(AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication)).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
    } finally { await f.close(); }
  });
  it("preserves committed expectation when config publish fails and never infers success", async () => {
    const f = await fixture();
    try {
      const publication = { ...f.publication, publishNew: async (stage: string, target: string) => {
        if (target.endsWith("tailscale.json")) throw new Error("synthetic-apply-failure");
        await f.publication.publishNew(stage, target);
      } };
      const store = await AccessPrivateStore.open(f.root, f.owner, f.acl, publication);
      await expect(store.initializeDisabled("tailscale")).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      const receipt = await readFile(path.join(f.root, "access-tailscale.receipt.json"));
      expect(receipt.length).toBeGreaterThan(0);
      await unlink(path.join(f.root, "access", "tailscale.stage.json"));
      await expect(AccessPrivateStore.open(f.root, f.owner, f.acl, f.publication)).rejects.toMatchObject({ code: "ACCESS_PRIVATE_UNSAFE" });
      expect(await readFile(path.join(f.root, "access-tailscale.receipt.json"))).toEqual(receipt);
    } finally { await f.close(); }
  });
});
