import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { captureFabricLaunchBinding, launchMetadata, manifestField } from "../src/services/fabric-launch-binding.js";
import { fabricLaunchFixture } from "./helpers/fabric-launch.js";
import { launchZip } from "./helpers/launch-zip.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "p55-fabric-binding-")); roots.push(root);
  return { root, ...await fabricLaunchFixture(root) };
}
it("binds actual bundle, server, loader and manifest dependencies, including physical identities", async () => {
  const f = await fixture(); const before = await captureFabricLaunchBinding(f.root, f.jarPath);
  expect(before).toMatchObject({ version: "26.2", requiredMajor: 25 });
  expect(await captureFabricLaunchBinding(f.root, f.jarPath)).toEqual(before);
  const file = path.join(f.root, "libraries/test/loader.jar"); const bytes = await readFile(file);
  await rename(file, file + ".old"); await writeFile(file, bytes);
  expect((await captureFabricLaunchBinding(f.root, f.jarPath)).identitySha256).not.toBe(before.identitySha256);
});
it.each([".fabric/server/26.2-server.jar", "versions/26.2/server-26.2.jar", "libraries/test/loader.jar"])("binds replacement bytes for %s", async (relative) => {
  const f = await fixture(); const before = await captureFabricLaunchBinding(f.root, f.jarPath);
  const file = path.join(f.root, relative); const bytes = await readFile(file); bytes.writeUInt16LE(7, bytes.length - 2);
  await writeFile(file, Buffer.concat([bytes, Buffer.from("changed")]));
  expect((await captureFabricLaunchBinding(f.root, f.jarPath)).identitySha256).not.toBe(before.identitySha256);
});
it("rejects missing dependencies, ambiguous versions and linked auxiliary directories", async () => {
  const f = await fixture(); const file = path.join(f.root, "libraries/test/loader.jar");
  await rename(file, file + ".old"); await expect(captureFabricLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
  await rename(file + ".old", file);
  await mkdir(path.join(f.root, "versions/26.3")); await expect(captureFabricLaunchBinding(f.root, f.jarPath)).rejects.toThrow("ambiguous-fabric-versions");
  await rm(path.join(f.root, "versions/26.3"), { recursive: true });
  await rename(path.join(f.root, "libraries/test"), path.join(f.root, "libraries/other"));
  await symlink(path.join(f.root, "libraries/other"), path.join(f.root, "libraries/test"), process.platform === "win32" ? "junction" : "dir");
  await expect(captureFabricLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it.each(["outer-classpath", "nested-classpath", "duplicate-manifest", "resource-override", "duplicate-properties", "escaped-properties"])("refuses %s ambiguous execution input", async (change) => {
  const f = await fixture();
  if (change === "nested-classpath" || change === "resource-override") {
    await writeFile(path.join(f.root, "libraries/test/loader.jar"), launchZip(change === "nested-classpath" ? { "META-INF/MANIFEST.MF": "Class-Path: outside.jar\n" } : { "fabric-server-launch.properties": "launch.mainClass=attacker.Main\n" }));
  } else {
    const manifest = "Main-Class: net.fabricmc.installer.ServerLauncher\n" + (change === "outer-classpath" ? "Class-Path: outside.jar\n" : change === "duplicate-manifest" ? "Main-Class: attacker.Main\n" : "");
    const properties = "game-version=26.2\nfabric-loader-version=0.19.5\n" + (change === "duplicate-properties" ? "game-version=26.3\n" : change === "escaped-properties" ? "game\\-version=26.3\n" : "");
    await writeFile(f.jarPath, launchZip({ "META-INF/MANIFEST.MF": manifest, "install.properties": properties }));
  }
  await expect(captureFabricLaunchBinding(f.root, f.jarPath)).rejects.toThrow();
});
it("reads only bounded main attributes of a large signed manifest and continues checking duplicate ZIP members", async () => {
  const manifest = "Manifest-Version: 1.0\r\nMain-Class: net.minecraft.server.Main\r\n\r\n" + "Name: member.class\r\nSHA-256-Digest: hash\r\n\r\n".repeat(60_000);
  const metadata = await launchMetadata(launchZip({ "META-INF/MANIFEST.MF": manifest }), ["META-INF/MANIFEST.MF"]);
  expect(metadata.get("META-INF/MANIFEST.MF")!.length).toBeLessThan(100);
  expect(manifestField(metadata.get("META-INF/MANIFEST.MF")!, "Main-Class")).toBe("net.minecraft.server.Main");
  await expect(launchMetadata(launchZip([["META-INF/MANIFEST.MF", manifest], ["META-INF/MANIFEST.MF", manifest]]), ["META-INF/MANIFEST.MF"])).rejects.toThrow("unsafe-launch-metadata");
});
it("rejects overlong main attributes rather than trusting a truncated executable field", async () => {
  await expect(launchMetadata(launchZip({ "META-INF/MANIFEST.MF": "Main-Class: " + "x".repeat(70_000) }), ["META-INF/MANIFEST.MF"])).rejects.toThrow("launch-manifest-main-attributes-limit");
});
it.each(["\n", "\r", "\r\n"])("reads main attributes with newline %j and ignores named-section fake entries", async (newline) => {
  const manifest = ["Manifest-Version: 1.0", "Main-Class: net.minecraft.server.Main", "X-Pad: " + "x".repeat(16_312), "", "Name: member.class", "Main-Class: attacker.Main", "Class-Path: outside.jar", ""].join(newline);
  const metadata = await launchMetadata(launchZip({ "META-INF/MANIFEST.MF": manifest }), ["META-INF/MANIFEST.MF"]);
  expect(manifestField(metadata.get("META-INF/MANIFEST.MF")!, "Main-Class")).toBe("net.minecraft.server.Main");
  expect(manifestField(metadata.get("META-INF/MANIFEST.MF")!, "Class-Path")).toBeUndefined();
  expect(() => manifestField("Main-Class: io.papermc.paperclip.Main" + newline + "Main-Class: attacker.Main" + newline + newline, "Main-Class")).toThrow("duplicate-launch-manifest-field");
});
it.each(["launch.mainClass=attacker.Main\n", "launch.mainClass=net.fabricmc.loader.impl.launch.knot.KnotServer\nlaunch.mainClass=attacker.Main\n", "launch\\.mainClass=net.fabricmc.loader.impl.launch.knot.KnotServer\n", "launch.mainClass=net.fabricmc.loader.impl.launch.knot.KnotServer\nunknown=value\n"])("refuses unbound generated loader property %j", async (properties) => {
  const f = await fixture();
  await writeFile(path.join(f.root, ".fabric/server/fabric-loader-server-0.19.5-minecraft-26.2.jar"), launchZip({ "META-INF/MANIFEST.MF": "Main-Class: net.fabricmc.loader.impl.launch.server.FabricServerLauncher\nClass-Path: ../../libraries/test/loader.jar\n", "fabric-server-launch.properties": properties }));
  await expect(captureFabricLaunchBinding(f.root, f.jarPath)).rejects.toThrow("fabric-launch-resource-override");
});
