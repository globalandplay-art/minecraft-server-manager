import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { detectServer } from "../src/services/detection-service.js";

import { launchZip as zip } from "./helpers/launch-zip.js";
import { fabricLaunchFixture } from "./helpers/fabric-launch.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const version = (id: string) => JSON.stringify({ id, java_version: 25 });

it("recognizes exact Paperclip launcher and reports version/Java from embedded metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p52-paper-")); roots.push(root);
  const jarPath = path.join(root, "server.jar");
  await writeFile(jarPath, zip({ "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nMain-Class: io.papermc.paperclip.Main\n", "version.json": version("26.2") }));
  const info = await detectServer({ id: "paper", name: "paper", rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info).toMatchObject({ type: "paper", minecraftVersion: "26.2", java: { requiredMajor: 25 }, detection: { confidence: "high", evidence: expect.arrayContaining(["paperclip-main-class", "jar-version-json"]) } });
});
it.each(["duplicate-main", "duplicate-manifest", "outer-classpath"])("refuses Paper lifecycle identity for %s", async (change) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p55-paper-")); roots.push(root);
  const jarPath = path.join(root, "server.jar");
  const paper = "Manifest-Version: 1.0\nMain-Class: io.papermc.paperclip.Main\n";
  const entries: [string, string][] = [["META-INF/MANIFEST.MF", paper + (change === "duplicate-main" ? "Main-Class: attacker.Main\n" : change === "outer-classpath" ? "Class-Path: outside.jar\n" : "")], ["version.json", version("26.2")]];
  if (change === "duplicate-manifest") entries.push(["META-INF/MANIFEST.MF", paper]);
  await writeFile(jarPath, zip(entries));
  const info = await detectServer({ id: "paper", name: "paper", rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info.type).toBe("unknown"); expect(info.detection.confidence).toBe("low");
  expect(info.detection.evidence).not.toContain("paperclip-main-class");
});

it("recognizes Fabric only with exact launcher and one matching bundled server version artifact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p52-fabric-")); roots.push(root);
  const { jarPath } = await fabricLaunchFixture(root);
  const info = await detectServer({ id: "fabric", name: "fabric", rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info).toMatchObject({ type: "fabric", minecraftVersion: "26.2", java: { requiredMajor: 25 }, detection: { confidence: "high", evidence: expect.arrayContaining(["fabric-launcher-main-class", "fabric-version-artifact"]) } });
});

it("fails closed for ambiguous Fabric artifacts and filename-like launcher claims", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p52-ambiguous-")); roots.push(root);
  for (const v of ["26.2", "26.3"]) {
    const directory = path.join(root, "versions", v); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `server-${v}.jar`), zip({ "META-INF/MANIFEST.MF": "Main-Class: net.minecraft.server.Main\n", "version.json": version(v) }));
  }
  const jarPath = path.join(root, "fabric-named.jar");
  await writeFile(jarPath, zip({ "META-INF/MANIFEST.MF": "Main-Class: example.notfabric.Server\n" }));
  const info = await detectServer({ id: "ambiguous", name: "ambiguous", rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info.type).toBe("unknown"); expect(info.minecraftVersion).toBeNull(); expect(info.detection.confidence).toBe("low");
});
