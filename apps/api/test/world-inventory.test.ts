import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Value } from "@sinclair/typebox/value";
import { worldsResponseSchema } from "@mcsm/contracts";
import fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { MinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { Clock } from "../src/clock.js";
import { registerWorldRoutes } from "../src/routes/worlds.js";
import { DomainError } from "../src/services/domain-errors.js";
import {
  inspectVanillaWorld,
  WorldInventoryService
} from "../src/services/world-inventory-service.js";

const NOW = "2026-09-28T02:30:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function nbtString(value: string): Buffer {
  const content = Buffer.from(value, "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(content.length);
  return Buffer.concat([length, content]);
}

function tag(type: number, name: string, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type]), nbtString(name), payload]);
}

function byteTag(name: string, value: number): Buffer {
  const payload = Buffer.alloc(1);
  payload.writeInt8(value);
  return tag(1, name, payload);
}

function intTag(name: string, value: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeInt32BE(value);
  return tag(3, name, payload);
}

function longTag(name: string, value: bigint): Buffer {
  const payload = Buffer.alloc(8);
  payload.writeBigInt64BE(value);
  return tag(4, name, payload);
}

function stringTag(name: string, value: string): Buffer {
  return tag(8, name, nbtString(value));
}

function compoundTag(name: string, children: readonly Buffer[]): Buffer {
  return tag(10, name, Buffer.concat([...children, Buffer.from([0])]));
}

function levelDat(seed: bigint, version?: string): Buffer {
  const dataChildren = [
    tag(9, "ScheduledEvents", Buffer.from([0, 0, 0, 0, 0])),
    compoundTag("WorldGenSettings", [longTag("seed", seed)]),
    byteTag("Difficulty", 3),
    intTag("GameType", 1),
    byteTag("hardcore", 1)
  ];
  if (version !== undefined) dataChildren.push(compoundTag("Version", [stringTag("Name", version)]));
  const root = Buffer.concat([
    Buffer.from([10]),
    nbtString(""),
    compoundTag("Data", dataChildren),
    Buffer.from([0])
  ]);
  return gzipSync(root);
}

async function fixture(properties: string, data = levelDat(1n, "1.21.1")): Promise<{
  root: string;
  world: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-world-"));
  roots.push(root);
  const world = path.join(root, "world");
  await mkdir(world);
  await writeFile(path.join(root, "server.properties"), properties);
  await writeFile(path.join(world, "level.dat"), data);
  return { root, world };
}

describe("Vanilla world inventory", () => {
  it("reads the actual 26.3 generated seed from separate saved data with exact int64 precision", async () => {
    const withoutSeed = gzipSync(Buffer.concat([Buffer.from([10]), nbtString(""),
      compoundTag("Data", [compoundTag("Version", [stringTag("Name", "26.3")])]), Buffer.from([0])]));
    const { root, world } = await fixture("level-name=world\nlevel-seed=111\n", withoutSeed);
    await mkdir(path.join(world, "data", "minecraft"), { recursive: true });
    await writeFile(path.join(world, "data", "minecraft", "world_gen_settings.dat"), gzipSync(Buffer.concat([
      Buffer.from([10]), nbtString(""), compoundTag("data", [longTag("seed", -9_223_372_036_854_775_808n)]), Buffer.from([0])
    ])));
    const [item] = await inspectVanillaWorld("vanilla-test", root, NOW);
    expect(item?.seed.value).toBe("-9223372036854775808");
    expect(item?.fieldSources.seed).toBe("world-data");
  });
  it("never falls back to the configured seed when saved generation data is absent or invalid", async () => {
    const withoutSeed = gzipSync(Buffer.concat([Buffer.from([10]), nbtString(""),
      compoundTag("Data", [compoundTag("Version", [stringTag("Name", "26.3")])]), Buffer.from([0])]));
    const { root, world } = await fixture("level-name=world\nlevel-seed=111\n", withoutSeed);
    expect((await inspectVanillaWorld("vanilla-test", root, NOW))[0]?.seed.status).toBe("unavailable");
    await mkdir(path.join(world, "data", "minecraft"), { recursive: true });
    await writeFile(path.join(world, "data", "minecraft", "world_gen_settings.dat"), "corrupt");
    expect((await inspectVanillaWorld("vanilla-test", root, NOW))[0]?.seed.status).toBe("unavailable");
  });
  it("keeps a signed 64-bit seed exact and discovers actual Vanilla dimensions", async () => {
    const { root, world } = await fixture(
      "level-name=world\npvp=false\nview-distance=12\nsimulation-distance=8\n",
      levelDat(-9_223_372_036_854_775_808n, "26.3")
    );
    await mkdir(path.join(world, "DIM-1", "region"), { recursive: true });
    await mkdir(path.join(world, "DIM1", "region"), { recursive: true });
    await mkdir(path.join(world, "dimensions", "example", "moon", "region"), { recursive: true });

    const [item] = await inspectVanillaWorld("vanilla-test", root, NOW);

    expect(item?.seed).toEqual({
      status: "available",
      value: "-9223372036854775808",
      source: "filesystem",
      sampledAt: NOW
    });
    expect(item?.dimensions).toEqual([
      { id: "example:moon", kind: "custom" },
      { id: "minecraft:overworld", kind: "overworld" },
      { id: "minecraft:the_end", kind: "end" },
      { id: "minecraft:the_nether", kind: "nether" }
    ]);
    expect(item?.fieldSources).toMatchObject({
      seed: "level-dat",
      pvp: "server-properties",
      sizeBytes: "filesystem"
    });
  });

  it("uses unavailable for an unknown last-written version", async () => {
    const { root } = await fixture("level-name=world\n", levelDat(42n));
    const [item] = await inspectVanillaWorld("vanilla-test", root, NOW);

    expect(item?.minecraftVersion).toEqual({
      status: "unavailable",
      value: null,
      source: null,
      sampledAt: null,
      reason: "level-dat-field-unavailable"
    });
    expect(item?.fieldSources.minecraftVersion).toBeNull();
  });

  it("accepts a contained level-name that begins with two dots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcsm-world-dot-prefix-"));
    roots.push(root);
    const world = path.join(root, "..manager");
    await mkdir(world);
    await writeFile(path.join(world, "level.dat"), levelDat(21n, "1.21.1"));
    await writeFile(path.join(root, "server.properties"), "level-name=..manager\n");

    const [item] = await inspectVanillaWorld("vanilla-test", root, NOW);
    expect(item?.name.value).toBe("..manager");
  });

  it("does not expose parser details when level.dat is corrupt", async () => {
    const { root, world } = await fixture("level-name=world\n");
    await writeFile(path.join(world, "level.dat"), gzipSync(Buffer.from("private-secret")));

    const [item] = await inspectVanillaWorld("vanilla-test", root, NOW);

    expect(item?.seed.status).toBe("unavailable");
    expect(JSON.stringify(item)).not.toContain("private-secret");
  });

  it.each(["../outside", "nested/world", "C:\\outside", "..", "world."])(
    "rejects unsafe level-name %s",
    async (levelName) => {
      const root = await mkdtemp(path.join(tmpdir(), "mcsm-world-"));
      roots.push(root);
      await writeFile(path.join(root, "server.properties"), `level-name=${levelName}\n`);

      await expect(inspectVanillaWorld("vanilla-test", root, NOW)).rejects.toMatchObject({
        code: "WORLD_LAYOUT_UNSAFE",
        reason: "invalid-level-name"
      });
    }
  );

  it("rejects a linked world directory without following it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcsm-world-link-"));
    const target = await mkdtemp(path.join(tmpdir(), "mcsm-world-target-"));
    roots.push(root, target);
    await writeFile(path.join(root, "server.properties"), "level-name=world\n");
    await writeFile(path.join(target, "level.dat"), levelDat(7n, "1.21.1"));
    await symlink(target, path.join(root, "world"), process.platform === "win32" ? "junction" : "dir");

    await expect(inspectVanillaWorld("vanilla-test", root, NOW)).rejects.toMatchObject({
      code: "WORLD_LAYOUT_UNSAFE",
      reason: "linked-directory"
    });
  });

  it("serves a schema-valid GET response for a local Vanilla adapter", async () => {
    const { root } = await fixture("level-name=world\npvp=true\nview-distance=10\n");
    const beforeFiles = await readdir(root);
    const adapter = {
      mode: "local",
      serverId: "vanilla-test",
      plan: { rootPath: root, serverInfo: { type: "vanilla" } }
    } as unknown as MinecraftServerAdapter;
    const registry = new AdapterRegistry([adapter]);
    const clock: Clock = { now: () => new Date(NOW) };
    const app = fastify();
    registerWorldRoutes(app, new WorldInventoryService(registry, clock), clock, "local");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/servers/vanilla-test/worlds"
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(Value.Check(worldsResponseSchema, response.json())).toBe(true);
    expect(response.json().data.items[0].active).toBe(true);
    expect(await readdir(root)).toEqual(beforeFiles);
  });

  it("keeps Paper and Fabric layouts explicitly unsupported", async () => {
    const adapter = {
      mode: "local",
      serverId: "paper-test",
      plan: { rootPath: "unused", serverInfo: { type: "paper" } }
    } as unknown as MinecraftServerAdapter;
    const service = new WorldInventoryService(
      new AdapterRegistry([adapter]),
      { now: () => new Date(NOW) }
    );

    await expect(service.list("paper-test")).rejects.toEqual(
      expect.objectContaining<Partial<DomainError>>({
        code: "WORLD_LAYOUT_UNSUPPORTED",
        statusCode: 501
      })
    );
  });
});
