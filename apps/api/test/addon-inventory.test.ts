import { mkdtemp, mkdir, readFile, rm, writeFile, link, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AddonInventory, addonProfile, safeAddonFilename } from "../src/services/addon-inventory.js";
import { readPrivatePropertiesFile } from "../src/services/properties-private-file.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), "mcsm-addon-read-")); roots.push(root); return root; }
it("only reserves validated Paper/Fabric profiles without opening unsupported loaders", () => {
  expect(addonProfile("paper")?.kind).toBe("plugin"); expect(addonProfile("fabric")?.kind).toBe("mod");
  for (const type of ["vanilla", "spigot", "purpur", "forge", "neoforge", "unknown"] as const) expect(addonProfile(type)).toBeNull();
});
it.each(["../evil.jar", "C:evil.jar", "CON.jar", " bad.jar", "a.jar.", "a.zip", "a\\b.jar", "e\u0301.jar"])("rejects unsafe filename %s", (name) => expect(safeAddonFilename(name)).toBe(false));
it("does not create missing addon folders or guess metadata", async () => {
  const root = await fixture(); const result = await new AddonInventory().read("test", root, "fabric");
  expect(result.items).toEqual([]); expect(result.writeSupported).toBe(false);
  await expect(readFile(path.join(root, "mods"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("lists enabled/disabled bytes without executing jars and changes revision when content changes", async () => {
  const root = await fixture(); await mkdir(path.join(root, "mods")); await mkdir(path.join(root, "disabled-mods"));
  await writeFile(path.join(root, "mods", "a.jar"), "untrusted bytes"); await writeFile(path.join(root, "disabled-mods", "b.jar"), "disabled bytes");
  const reader = new AddonInventory(); const first = await reader.read("test", root, "fabric");
  expect(first.items.map((item) => item.state).sort()).toEqual(["disabled", "enabled"]);
  expect(first.items.every((item) => item.name === null && item.compatibility === "unknown")).toBe(true);
  expect(JSON.stringify(first)).not.toContain(root); expect(JSON.stringify(first)).not.toContain("untrusted bytes");
  await writeFile(path.join(root, "mods", "a.jar"), "new bytes");
  expect((await reader.read("test", root, "fabric")).revision).not.toBe(first.revision);
});
it("binds revision to physical file identity even when replacement bytes are identical", async () => {
  const root = await fixture(); await mkdir(path.join(root, "plugins"));
  const installed = path.join(root, "plugins", "same.jar"), replacement = path.join(root, "replacement.jar");
  await writeFile(installed, "identical bytes"); const reader = new AddonInventory();
  const before = await reader.read("test", root, "paper");
  await writeFile(replacement, "identical bytes"); await rm(installed); await rename(replacement, installed);
  expect((await reader.read("test", root, "paper")).revision).not.toBe(before.revision);
});
it("rejects hardlinked and empty jars instead of reporting a safe inventory", async () => {
  const root = await fixture(); await mkdir(path.join(root, "plugins"));
  await writeFile(path.join(root, "source"), "bytes"); await link(path.join(root, "source"), path.join(root, "plugins", "linked.jar"));
  await expect(new AddonInventory().read("test", root, "paper")).rejects.toMatchObject({ code: "ADDON_INVENTORY_UNSAFE" });
  await rm(path.join(root, "plugins", "linked.jar")); await writeFile(path.join(root, "plugins", "empty.jar"), "");
  await expect(new AddonInventory().read("test", root, "paper")).rejects.toMatchObject({ code: "ADDON_INVENTORY_UNSAFE" });
});
it("rechecks actual descriptor bytes if a file becomes empty after the outer stat", async () => {
  const root = await fixture(); await mkdir(path.join(root, "mods"));
  await writeFile(path.join(root, "mods", "a.jar"), "before");
  const reader = new AddonInventory(async (file, limit) => {
    await writeFile(file, ""); return readPrivatePropertiesFile(file, limit);
  });
  await expect(reader.read("test", root, "fabric")).rejects.toMatchObject({ code: "ADDON_INVENTORY_UNSAFE" });
});
it("counts actual descriptor bytes rather than stale stat sizes against aggregate quota", async () => {
  const root = await fixture(); await mkdir(path.join(root, "mods"));
  for (let n = 0; n < 5; n++) await writeFile(path.join(root, "mods", `${n}.jar`), "x");
  const bytes = Buffer.alloc(64 * 1024 ** 2, 1);
  const reader = new AddonInventory(async (file, limit) => {
    const captured = await readPrivatePropertiesFile(file, limit);
    return { ...captured, bytes };
  });
  await expect(reader.read("test", root, "fabric")).rejects.toMatchObject({ code: "ADDON_INVENTORY_UNSAFE" });
});
it("bounds concurrent scans without starting a second allocation-heavy inventory", async () => {
  const root = await fixture(); const reader = new AddonInventory();
  const first = reader.read("test", root, "fabric");
  await expect(reader.read("test", root, "fabric")).rejects.toMatchObject({ code: "ADDON_SCAN_BUSY", statusCode: 429 });
  await first;
  await expect(reader.read("test", root, "fabric")).resolves.toMatchObject({ items: [] });
});
it("rejects changed file bytes during the final descriptor verification", async () => {
  const root = await fixture(); await mkdir(path.join(root, "mods"));
  await writeFile(path.join(root, "mods", "a.jar"), "first contents"); let reads = 0;
  const reader = new AddonInventory(async (file, limit) => {
    if (++reads === 2) await writeFile(file, "changed contents");
    return readPrivatePropertiesFile(file, limit);
  });
  await expect(reader.read("test", root, "fabric")).rejects.toMatchObject({ code: "ADDON_INVENTORY_UNSAFE" });
});
