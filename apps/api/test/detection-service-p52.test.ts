import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { detectServer } from "../src/services/detection-service.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(text); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, filename); offset += local.length + filename.length + data.length;
  }
  const body = Buffer.concat([...locals, ...centrals]), centralSize = Buffer.concat(centrals).length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([body, end]);
}
const version = (id: string) => JSON.stringify({ id, java_version: 25 });

it("recognizes exact Paperclip launcher and reports version/Java from embedded metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p52-paper-")); roots.push(root);
  const jarPath = path.join(root, "server.jar");
  await writeFile(jarPath, zip({ "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nMain-Class: io.papermc.paperclip.Main\n", "version.json": version("26.2") }));
  const info = await detectServer({ id: "paper", name: "paper", rootPath: root, jarPath, javaExecutable: process.execPath });
  expect(info).toMatchObject({ type: "paper", minecraftVersion: "26.2", java: { requiredMajor: 25 }, detection: { confidence: "high", evidence: expect.arrayContaining(["paperclip-main-class", "jar-version-json"]) } });
});

it("recognizes Fabric only with exact launcher and one matching bundled server version artifact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p52-fabric-")); roots.push(root);
  await mkdir(path.join(root, "versions", "26.2"), { recursive: true });
  const jarPath = path.join(root, "launcher.jar");
  const serverJar = path.join(root, "versions", "26.2", "server-26.2.jar");
  await writeFile(jarPath, zip({ "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nMain-Class: net.fabricmc.installer.ServerLauncher\n" }));
  await writeFile(serverJar, zip({ "META-INF/MANIFEST.MF": "Manifest-Version: 1.0\nMain-Class: net.minecraft.server.Main\n", "version.json": version("26.2") }));
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
