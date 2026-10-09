import { spawn } from "node:child_process";
import { once } from "node:events";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ManagerLifetimeLock } from "../../src/auth/manager-lifetime-lock.js";

async function fixture(action: (root: string, parent: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), "mcsm-lifetime-")); const root = join(parent, "manager");
  try { await mkdir(root); await action(root, parent); }
  finally { await rm(parent, { recursive: true, force: true }); }
}
function probe(root: string) {
  const child = spawn(process.execPath, ["--import", "tsx", resolve("test/auth/fixtures/lock-probe.ts"), root], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (value: string) => { output += value; });
  const line = async () => {
    if (output.includes("\n")) return output.trim();
    await Promise.race([once(child.stdout, "data"), once(child, "exit").then(() => { throw new Error("probe-exited: " + output); })]);
    return output.trim();
  };
  return { child, line };
}
describe.skipIf(process.platform !== "win32")("native parent-owned Manager lifetime exclusion", () => {
  it("keeps exclusion after helper exit, holds root against rename and releases explicitly", async () => fixture(async (root, parent) => {
    const lock = await ManagerLifetimeLock.acquire(root);
    try {
      expect(JSON.stringify(lock)).toBe("{}"); lock.assertHeld(root);
      await expect(ManagerLifetimeLock.acquire(root)).rejects.toMatchObject({ code: "AUTH_BUSY" });
      await expect(rename(root, join(parent, "moved"))).rejects.toBeDefined();
      await expect(readFile(join(root, "manager.lifetime.lock"))).rejects.toBeDefined();
    } finally { await lock.release(); }
    expect(() => lock.assertHeld(root)).toThrow("AUTH_PRIVATE_UNSAFE");
    await lock.release(); const next = await ManagerLifetimeLock.acquire(root); await next.release();
  }), 60_000);
  it("rejects a competing process and OS releases parent handles after abrupt parent kill", async () => fixture(async (root) => {
    const owner = probe(root);
    try {
      expect(await owner.line()).toBe("LOCKED");
      const competitor = probe(root); const exited = once(competitor.child, "exit");
      expect(await competitor.line()).toBe("AUTH_BUSY"); expect((await exited)[0]).toBe(2);
      const dead = once(owner.child, "exit"); owner.child.kill(); await dead;
      const replacement = await ManagerLifetimeLock.acquire(root); await replacement.release();
    } finally { if (owner.child.exitCode === null && owner.child.signalCode === null) { const dead = once(owner.child, "exit"); owner.child.kill(); await dead; } }
  }), 60_000);
  it("rejects alias roots and hardlinked persistent lock records", async () => fixture(async (root, parent) => {
    const lock = await ManagerLifetimeLock.acquire(root); await lock.release();
    await link(join(root, "manager.lifetime.lock"), join(parent, "alias.lock"));
    await expect(ManagerLifetimeLock.acquire(root)).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
    await symlink(root, join(parent, "junction"), "junction");
    await expect(ManagerLifetimeLock.acquire(join(parent, "junction"))).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
  }), 60_000);
});
