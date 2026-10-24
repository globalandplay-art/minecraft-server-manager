import { mkdtemp, mkdir, readFile, rm, writeFile, link, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AddonInventory, addonProfile, safeAddonFilename } from "../src/services/addon-inventory.js";
import { readPrivatePropertiesFile } from "../src/services/properties-private-file.js";
import { addonZip } from "./helpers/addon-zip.js";
import { parseForgeAddonMetadata } from "../src/services/forge-addon-metadata.js";
const roots: string[] = [];
it("bounds aggregate declaration output and refuses over-budget inventories without partial success", async () => {
  const root = await fixture(); await mkdir(path.join(root, "mods"));
  const raw = 'modLoader="javafml"\n' + Array.from({ length: 8 }, (_, index) => `[[mods]]\nmodId="mod_${index}"\n` +
    Array(64).fill(`[[dependencies.mod_${index}]]\nmodId="library"\nversionRange="${'x'.repeat(128)}"\ntype="required"\nside="BOTH"\n`).join('')).join('');
  expect(Buffer.byteLength(raw)).toBeLessThan(256 * 1024);
  const parsed = parseForgeAddonMetadata(Buffer.from(raw), "neoforge"); expect(parsed).not.toBeNull();
  const count = Math.ceil(1024 * 1024 / Buffer.byteLength(JSON.stringify(parsed))) + 1; expect(count).toBeLessThanOrEqual(16);
  const bytes = addonZip("META-INF/neoforge.mods.toml", raw);
  await writeFile(path.join(root, "mods", "0.jar"), bytes);
  const reader = new AddonInventory(); expect((await reader.read("test", root, "neoforge")).items).toHaveLength(1);
  for (let index = 1; index < count; index++) await writeFile(path.join(root, "mods", `${index}.jar`), bytes);
  await expect(reader.read("test", root, "neoforge")).rejects.toMatchObject({ code: "ADDON_INVENTORY_UNSAFE" });
});
it.each(["forge", "neoforge"] as const)("selects only the %s descriptor and keeps unresolved versions out of the summary", async type => {
  const root = await fixture(); await mkdir(path.join(root, "mods"));
  const wrong = type === "forge" ? "META-INF/neoforge.mods.toml" : "META-INF/mods.toml", right = type === "forge" ? "META-INF/mods.toml" : "META-INF/neoforge.mods.toml";
  const declaration = 'modLoader="javafml"\n[[mods]]\nmodId="sample_mod"\ndisplayName="示例"\nversion="${file.jarVersion}"\n';
  await writeFile(path.join(root, "mods", "wrong.jar"), addonZip(wrong, declaration));
  await writeFile(path.join(root, "mods", "right.jar"), addonZip(right, declaration));
  const listing = await new AddonInventory().read("test", root, type, true);
  expect(listing.writeSupported).toBe(false);
  expect(listing.items.find(item => item.filename === "wrong.jar")).toMatchObject({ name: null, metadataStatus: "missing" });
  expect(listing.items.find(item => item.filename === "right.jar")).toMatchObject({ name: "示例", version: null, metadataStatus: "parsed", declaredMetadata: { source: right, mods: [{ versionStatus: "unresolved" }] } });
});
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
it.each(["forge", "neoforge"] as const)("discovers %s files without granting writes or misidentifying Fabric metadata", async type => {
  const root = await fixture(); await mkdir(path.join(root, "mods")); await mkdir(path.join(root, "disabled-mods"));
  await writeFile(path.join(root, "mods", "sample.jar"), "invalid jar remains explicitly invalid");
  await writeFile(path.join(root, "disabled-mods", "other.jar"), "other bytes");
  const result = await new AddonInventory().read("test", root, type, true);
  expect(addonProfile(type)).toBeNull(); expect(result.writeSupported).toBe(true);
  expect((await new AddonInventory().read('test', root, type, false)).writeSupported).toBe(false);
  expect(result.items).toHaveLength(2);
  expect(result.items.map(item => item.state).sort()).toEqual(["disabled", "enabled"]);
  expect(result.items.every(item => item.kind === "mod" && item.loader === null && item.name === null && item.compatibility === "unknown" && item.metadataStatus === "invalid")).toBe(true);
  expect(JSON.stringify(result)).not.toContain(root);
});
it.each(["forge", "neoforge"] as const)("keeps missing %s directories absent and refuses linked inventory", async type => {
  const root = await fixture(); expect((await new AddonInventory().read("test", root, type, true)).items).toEqual([]);
  await expect(readFile(path.join(root, "mods"))).rejects.toMatchObject({ code: "ENOENT" });
  await mkdir(path.join(root, "mods")); await writeFile(path.join(root, "original"), "bytes"); await link(path.join(root, "original"), path.join(root, "mods", "linked.jar"));
  await expect(new AddonInventory().read("test", root, type)).rejects.toMatchObject({ code: "ADDON_INVENTORY_UNSAFE" });
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
