import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { detectServer } from "../src/services/detection-service.js";
import { trustedLifecycle } from "../src/services/trusted-lifecycle.js";

import { launchZip as zip } from "./helpers/launch-zip.js";
import { fabricLaunchFixture } from "./helpers/fabric-launch.js";
import { forgeLaunchFixture } from "./helpers/forge-launch.js";
import { neoForgeLaunchFixture } from './helpers/neoforge-launch.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const version = (id: string) => JSON.stringify({ id, java_version: 25 });
it('recognizes NeoForge only through its complete dedicated-server descriptor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mcsm-m21-neo-')); roots.push(root);
  const { anchor } = await neoForgeLaunchFixture(root);
  const info = await detectServer({ id: 'neo', name: 'NeoForge', rootPath: root, jarPath: anchor, javaExecutable: process.execPath });
  expect(info).toMatchObject({ type: 'neoforge', minecraftVersion: '26.3', java: { requiredMajor: 25 }, detection: { confidence: 'high' } });
  expect(trustedLifecycle(info)).toBe(false);
  expect(trustedLifecycle({ ...info, java: { requiredMajor: 25, runtimeVersion: '25.0.4' } })).toBe(true);
  await writeFile(anchor, '@echo off\njava attacker.Main\n');
  const unknown = await detectServer({ id: 'neo', name: 'NeoForge', rootPath: root, jarPath: anchor, javaExecutable: process.execPath });
  expect(unknown.type).toBe('unknown'); expect(trustedLifecycle(unknown)).toBe(false);
});
it('detects a complete Forge shim separately from the unsupported legacy bootstrap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mcsm-m21-forge-')); roots.push(root);
  const { jarPath } = await forgeLaunchFixture(root);
  const info = await detectServer({ id: 'forge', name: 'forge', rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info).toMatchObject({ type: 'forge', minecraftVersion: '1.21.9', java: { requiredMajor: 21 }, detection: { confidence: 'high', evidence: expect.arrayContaining(['forge-shim-main-class', 'forge-execution-binding']) } });
  // This fixture's Node executable is not a verified Java runtime.
  expect(trustedLifecycle(info)).toBe(false);
  const verified = { ...info, java: { runtimeVersion: '21.0.4', requiredMajor: 21 } };
  expect(info.detection.evidence).toContain('forge-headless-exit-unsupported');
  expect(info.detection.warnings).toContainEqual(expect.stringContaining('59.0.5'));
  expect(trustedLifecycle(verified)).toBe(false);
  expect(trustedLifecycle({ ...verified, type: 'neoforge' })).toBe(false);
  expect(trustedLifecycle({ ...verified, java: { runtimeVersion: '17.0.1', requiredMajor: 21 } })).toBe(false);
});

it('permits the complete 26.3 Forge candidate only with a sufficient verified Java runtime', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mcsm-m21-forge26-')); roots.push(root);
  const { jarPath } = await forgeLaunchFixture(root, { minecraftVersion: '26.3', javaVersion: 25 });
  const info = await detectServer({ id: 'forge26', name: 'forge26', rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info).toMatchObject({ type: 'forge', minecraftVersion: '26.3', java: { requiredMajor: 25 } });
  expect(info.detection.evidence).not.toContain('forge-headless-exit-unsupported');
  expect(trustedLifecycle(info)).toBe(false);
  expect(trustedLifecycle({ ...info, java: { runtimeVersion: '25.0.4', requiredMajor: 25 } })).toBe(true);
  expect(trustedLifecycle({ ...info, java: { runtimeVersion: '21.0.4', requiredMajor: 25 } })).toBe(false);
});

it("recognizes exact Paperclip launcher and reports version/Java from embedded metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p52-paper-")); roots.push(root);
  const jarPath = path.join(root, "server.jar");
  await writeFile(jarPath, zip({ "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nMain-Class: io.papermc.paperclip.Main\n", "version.json": version("26.2") }));
  const info = await detectServer({ id: "paper", name: "paper", rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info).toMatchObject({ type: "paper", minecraftVersion: "26.2", java: { requiredMajor: 25 }, detection: { confidence: "high", evidence: expect.arrayContaining(["paperclip-main-class", "jar-version-json"]) } });
});

it("detects the verified Forge bootstrap marker for display without trusting lifecycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-m1-forge-")); roots.push(root);
  const jarPath = path.join(root, "forge-server.jar");
  await writeFile(jarPath, zip({ "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nMain-Class: net.minecraftforge.bootstrap.ForgeBootstrap\n" }));
  const info = await detectServer({ id: "forge", name: "forge", rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info).toMatchObject({ type: "forge", detection: { confidence: "medium", evidence: ["jar-manifest", "forge-bootstrap-main-class"], warnings: expect.arrayContaining([expect.stringContaining("启动配置尚未受支持")]) } });
  expect(trustedLifecycle(info)).toBe(false);
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
