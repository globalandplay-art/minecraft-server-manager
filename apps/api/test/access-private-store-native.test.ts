import { mkdtemp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManagerLifetimeLock } from "../src/auth/manager-lifetime-lock.js";
import { WindowsPrivateAclVerifier } from "../src/auth/windows-private-acl.js";
import { writePrivateNew, publishPrivateStageNew } from "../src/auth/private-publication.js";
import { AccessPrivateStore } from "../src/services/access-private-store.js";

describe.skipIf(process.platform !== "win32")("native disabled Access bootstrap publication", () => {
  it("verifies private ACL, restart binding and atomic no-replace without any provider action", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "mcsm-native-access-"));
    const root = path.join(parent, "manager"); await mkdir(root);
    let owner: ManagerLifetimeLock | undefined;
    let passed = false;
    try {
      owner = await ManagerLifetimeLock.acquire(root);
      const acl = new WindowsPrivateAclVerifier();
      const store = await AccessPrivateStore.open(root, owner, acl);
      expect(await store.read("tailscale")).toBeNull();
      expect(await readdir(root)).toEqual(["manager.lifetime.lock"]);
      const original = await store.initializeDisabled("tailscale");
      const target = path.join(root, "access", "tailscale.json");
      const originalBytes = await readFile(target);
      expect(await acl.verify(target)).toHaveLength(64);
      await owner.release(); owner = undefined;
      owner = await ManagerLifetimeLock.acquire(root);
      const reopened = await AccessPrivateStore.open(root, owner, acl);
      expect(await reopened.read("tailscale")).toEqual(original);
      expect(await reopened.read("cloudflare")).toBeNull();

      // Actual MoveFileEx no-replace call, not an injected filesystem approximation.
      const collisionStage = path.join(root, "access", "collision.stage.json");
      const synthetic = Buffer.from("synthetic-no-replace-evidence");
      await writePrivateNew(collisionStage, synthetic, acl);
      await expect(publishPrivateStageNew(collisionStage, target)).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
      expect(await readFile(target)).toEqual(originalBytes);
      expect(await readFile(collisionStage)).toEqual(synthetic);
      expect(await reopened.read("tailscale")).toEqual(original);
      await owner.release(); owner = undefined;
      passed = true;
    } finally {
      // Unknown native ownership/failure retains this fixture; never force removal while held.
      if (owner !== undefined) await owner.release();
      if (passed) await rm(parent, { recursive: true, force: true });
    }
  }, 180_000);
});
