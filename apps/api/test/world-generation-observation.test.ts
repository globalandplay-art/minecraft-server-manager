import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "../src/adapters/registry.js";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { proposeWorldGenerationReservation } from "../src/services/world-generation-reservation.js";
import { observeWorldGenerationCandidate } from "../src/services/world-generation-observation.js";
import { testWorldLevel } from "./fixtures/world-library-content.js";
import * as inventory from "../src/services/world-inventory-service.js";
import { readPrivatePropertiesFile } from "../src/services/properties-private-file.js";
import { captureGenerationProperties } from "../src/services/world-generation-properties.js";

const roots: string[] = [], hash = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lt-generation-observe-")); roots.push(root);
  const target = path.join(root, "NewWorld"), properties = "level-name=NewWorld\n"; await mkdir(target);
  await writeFile(path.join(root, "server.properties"), properties); await writeFile(path.join(target, "level.dat"), testWorldLevel("synthetic", true, 5023));
  const getStatus = vi.fn(async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }));
  const start = vi.fn(), stop = vi.fn();
  const adapter = { serverId: "generation-test", mode: "local", plan: { rootPath: root, serverInfo: { type: "vanilla" } },
    getStatus, getServerInfo: async () => ({ type: "vanilla", minecraftVersion: "26.3" }), start, stop } as unknown as LocalMinecraftServerAdapter;
  const registry = new AdapterRegistry([adapter]);
  const reservation = proposeWorldGenerationReservation({ serverId: adapter.serverId, operationId: randomUUID(), transactionId: randomUUID(),
    previousWorldId: `worldv2-${randomUUID()}`, catalogId: randomUUID(), catalogRevision: "1".repeat(64), rootIdentity: await backupDirectoryIdentity(root),
    previousName: "world", nextName: "NewWorld", propertiesBefore: "2".repeat(64), propertiesAfter: hash(properties), activeStateRevision: "3".repeat(64), guardBackupId: randomUUID() });
  return { root, target, properties, registry, reservation, adapter, getStatus, start, stop };
}
describe("unmounted stopped-world candidate observation (not birth proof)", () => {
  it("rejects another valid timestamp rewrite during a single candidate observation", async () => {
    const f = await fixture(), config = path.join(f.root, "server.properties");
    const before = "#Minecraft server properties\n#Wed Oct 28 21:36:46 CST 2026\nlevel-name=NewWorld\n";
    await writeFile(config, before); f.reservation.propertiesAfter = hash(before);
    const original = await readPrivatePropertiesFile(config), baseline = captureGenerationProperties(original); original.bytes.fill(0);
    await writeFile(config, before.replace("21:36:46", "21:37:08"));
    f.getStatus.mockImplementationOnce(async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }))
      .mockImplementationOnce(async () => { await writeFile(config, before.replace("21:36:46", "21:38:09")); return { state: "stopped", ownership: "none", recoveryRequired: false }; });
    await expect(observeWorldGenerationCandidate(f.registry, f.adapter.serverId, f.reservation, baseline)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
  });
  it("cannot validate captured future-version bytes using unrelated metadata from a reopened path", async () => {
    const f = await fixture(); await writeFile(path.join(f.target, "level.dat"), testWorldLevel("future", true, 6000));
    const reread = vi.spyOn(inventory, "readWorldMetadata").mockResolvedValue({ readable: true, version: "26.3", dataVersion: 5023 });
    await expect(observeWorldGenerationCandidate(f.registry, f.adapter.serverId, f.reservation)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(reread).not.toHaveBeenCalled();
  });
  it("observes bounded metadata and identities without claiming provenance or successful loading", async () => {
    const f = await fixture(), before = await readFile(path.join(f.target, "level.dat"));
    const result = await observeWorldGenerationCandidate(f.registry, f.adapter.serverId, f.reservation);
    expect(result).toMatchObject({ phase: "candidate-only", worldId: f.reservation.worldId, birthVerified: false, loadVerified: false, version: "26.3", dataVersion: 5023 });
    expect(result.directoryIdentity).toMatch(/^[0-9a-f]{64}$/u); expect(JSON.stringify(result)).not.toContain(f.root);
    expect(await readFile(path.join(f.target, "level.dat"))).toEqual(before); expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
  it.each(["wrong-server", "root", "properties", "missing", "malformed", "future-version", "hard-link", "junction", "late-change", "late-running"])("rejects %s without authority", async scenario => {
    const f = await fixture(), level = path.join(f.target, "level.dat");
    if (scenario === "root") f.reservation.rootIdentity = "0".repeat(64);
    if (scenario === "properties") await writeFile(path.join(f.root, "server.properties"), "level-name=Other\n");
    if (scenario === "missing") await rm(level);
    if (scenario === "malformed") await writeFile(level, "not NBT");
    if (scenario === "future-version") await writeFile(level, testWorldLevel("future", true, 6000));
    if (scenario === "hard-link") await link(level, path.join(f.root, "other.dat"));
    if (scenario === "junction") {
      const outside = path.join(f.root, "Other"); await mkdir(outside); await writeFile(path.join(outside, "level.dat"), testWorldLevel("other", true, 5023));
      await rm(f.target, { recursive: true }); await symlink(outside, f.target, process.platform === "win32" ? "junction" : "dir");
    }
    if (scenario === "late-change") f.getStatus.mockImplementationOnce(async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }))
      .mockImplementationOnce(async () => { await writeFile(level, testWorldLevel("changed", true, 5023)); return { state: "stopped", ownership: "none", recoveryRequired: false }; });
    if (scenario === "late-running") f.getStatus.mockImplementationOnce(async () => ({ state: "stopped", ownership: "none", recoveryRequired: false }))
      .mockImplementationOnce(async () => ({ state: "running", ownership: "managed", recoveryRequired: false }));
    await expect(observeWorldGenerationCandidate(f.registry, scenario === "wrong-server" ? "other" : f.adapter.serverId, f.reservation)).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" });
    expect(f.start).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled();
  });
});
