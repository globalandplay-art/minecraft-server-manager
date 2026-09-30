import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { ActiveWorldStateStore, worldIdentity } from "../src/services/active-world-state-store.js";

const roots: string[] = [];
const id = "vanilla-state-test";

async function fixture(worldExists = true) {
  const managerRoot = await mkdtemp(path.join(tmpdir(), "mcsm-world-state-"));
  roots.push(managerRoot);
  const serverRoot = path.join(managerRoot, "server");
  await mkdir(serverRoot);
  if (worldExists) {
    await mkdir(path.join(serverRoot, "world"));
    await writeFile(path.join(serverRoot, "world", "level.dat"), "fixture");
  }
  await writeFile(path.join(serverRoot, "server.properties"), "level-name=world\n");
  const adapter = {
    mode: "local",
    serverId: id,
    plan: { rootPath: serverRoot, serverInfo: { type: "vanilla" } }
  } as unknown as LocalMinecraftServerAdapter;
  return { managerRoot, serverRoot, adapter };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ActiveWorldStateStore", () => {
  it("persists active identity under manager storage and reads it after restart", async () => {
    const { managerRoot, serverRoot, adapter } = await fixture();
    const first = new ActiveWorldStateStore(managerRoot, [adapter]);
    await expect(first.initialize()).resolves.toEqual(new Set());
    const identity = worldIdentity(id, "world");
    expect(first.isActive(id, identity)).toBe(true);
    expect(JSON.parse(await readFile(path.join(managerRoot, "active-worlds", `${id}.json`), "utf8")))
      .toMatchObject({ state: "active", worldId: identity, levelName: "world" });
    expect((await readdir(serverRoot)).sort()).toEqual(["server.properties", "world"]);

    const restarted = new ActiveWorldStateStore(managerRoot, [adapter]);
    await expect(restarted.initialize()).resolves.toEqual(new Set());
    expect(restarted.isActive(id, identity)).toBe(true);
  });

  it("gates a corrupted record, explicit none, or changed active identity", async () => {
    const { managerRoot, adapter } = await fixture();
    const directory = path.join(managerRoot, "active-worlds");
    await mkdir(directory);
    const file = path.join(directory, `${id}.json`);
    await writeFile(file, "{broken");
    expect([...(await new ActiveWorldStateStore(managerRoot, [adapter]).initialize())]).toEqual([id]);

    await writeFile(file, JSON.stringify({
      schemaVersion: 1, serverId: id, state: "none", worldId: null, levelName: null
    }));
    expect([...(await new ActiveWorldStateStore(managerRoot, [adapter]).initialize())]).toEqual([id]);

    await writeFile(file, JSON.stringify({
      schemaVersion: 1, serverId: id, state: "active", worldId: worldIdentity(id, "old-world"), levelName: "old-world"
    }));
    expect([...(await new ActiveWorldStateStore(managerRoot, [adapter]).initialize())]).toEqual([id]);
  });

  it("keeps a missing configured world in pending-generation state", async () => {
    const { managerRoot, adapter } = await fixture(false);
    const store = new ActiveWorldStateStore(managerRoot, [adapter]);
    await store.initialize();
    expect(JSON.parse(await readFile(path.join(managerRoot, "active-worlds", `${id}.json`), "utf8")))
      .toMatchObject({ state: "pending-generation" });
    expect(store.isActive(id, worldIdentity(id, "world"))).toBe(false);

    await mkdir(path.join(adapter.plan.rootPath, "world"));
    await writeFile(path.join(adapter.plan.rootPath, "world", "level.dat"), "generated");
    await store.reconcileAfterStart(id);
    expect(store.isActive(id, worldIdentity(id, "world"))).toBe(true);
    expect(JSON.parse(await readFile(path.join(managerRoot, "active-worlds", `${id}.json`), "utf8")))
      .toMatchObject({ state: "active" });
  });
});
