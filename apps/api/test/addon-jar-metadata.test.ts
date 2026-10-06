import { expect, it } from "vitest";
import { readAddonJarMetadata } from "../src/services/addon-jar-metadata.js";
import { deflateRawSync } from "node:zlib";
import { addonZip } from "./helpers/addon-zip.js";
it.each(["signed", "unsigned"] as const)("validates %s data descriptors and refuses damaged descriptor CRC", (kind) => {
  const bytes = addonZip("plugin.yml", "name: Demo", kind);
  expect(readAddonJarMetadata(bytes).get("plugin.yml")?.toString()).toBe("name: Demo");
  bytes[30 + Buffer.byteLength("plugin.yml") + Buffer.byteLength("name: Demo") + (kind === "signed" ? 4 : 0)] ^= 1;
  expect(() => readAddonJarMetadata(bytes)).toThrow();
});
it("refuses symlink external attributes and out-of-range local offsets", () => {
  const linked = addonZip("plugin.yml", "name: Demo"); const central = linked.readUInt32LE(linked.length - 6);
  linked.writeUInt32LE(0xa1ff0000, central + 38);
  expect(() => readAddonJarMetadata(linked)).toThrow();
  const offset = addonZip("plugin.yml", "name: Demo"); offset.writeUInt32LE(central, central + 42);
  expect(() => readAddonJarMetadata(offset)).toThrow();
});
function zip(name: string, text: string, deflate = false, padding = 0) {
  const filename = Buffer.from(name), data = Buffer.from(text);
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  crc = (crc ^ 0xffffffff) >>> 0;
  const compressed = deflate ? Buffer.concat([deflateRawSync(data), Buffer.alloc(padding)]) : data;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(deflate ? 8 : 0, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const payload = Buffer.concat([local, filename, compressed]); const directory = Buffer.concat([central, filename]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(payload.length, 16);
  return Buffer.concat([payload, directory, end]);
}
it("validates non-metadata class member integrity without extracting or interpreting it", () => {
  expect(readAddonJarMetadata(zip("fabric.mod.json", '{"schemaVersion":1}')).get("fabric.mod.json")?.toString()).toBe('{"schemaVersion":1}');
  expect(readAddonJarMetadata(zip("Main.class", "untrusted executable bytes")).size).toBe(0);
  const corruptClass = zip("Main.class", "untrusted executable bytes");
  corruptClass[30 + Buffer.byteLength("Main.class")] ^= 1;
  expect(() => readAddonJarMetadata(corruptClass)).toThrowError(expect.objectContaining({ code: "ADDON_JAR_UNSAFE" }));
});
it.each(["../plugin.yml", "C:/plugin.yml", "a\\plugin.yml", "CON.jar", "/plugin.yml"])("rejects unsafe ZIP path %s", (name) => {
  expect(() => readAddonJarMetadata(zip(name, "x"))).toThrowError(expect.objectContaining({ code: "ADDON_JAR_UNSAFE" }));
});
it("rejects corrupted metadata CRC", () => {
  const bytes = zip("plugin.yml", "name: demo"); bytes[30 + "plugin.yml".length] ^= 1;
  expect(() => readAddonJarMetadata(bytes)).toThrow();
});
it("rejects mismatched local headers and encrypted entries", () => {
  const bytes = zip("plugin.yml", "x"); bytes.writeUInt16LE(1, 6);
  expect(() => readAddonJarMetadata(bytes)).toThrow();
});
it("rejects oversized metadata and malformed ZIP", () => {
  expect(() => readAddonJarMetadata(zip("plugin.yml", "x".repeat(256 * 1024 + 1)))).toThrow();
  expect(() => readAddonJarMetadata(Buffer.from("not a jar"))).toThrow();
});
it("does not strip a UTF8 filename BOM into an allowlisted metadata path", () => {
  const bytes = zip("\uFEFFfabric.mod.json", "{}");
  const central = bytes.readUInt32LE(bytes.length - 6);
  bytes.writeUInt16LE(0x800, 6); bytes.writeUInt16LE(0x800, central + 8);
  expect(() => readAddonJarMetadata(bytes)).toThrowError(expect.objectContaining({ code: "ADDON_JAR_UNSAFE" }));
});
it("reads complete raw deflate and rejects trailing compressed-region padding", () => {
  expect(readAddonJarMetadata(zip("plugin.yml", "name: Demo", true)).get("plugin.yml")?.toString()).toBe("name: Demo");
  expect(() => readAddonJarMetadata(zip("plugin.yml", "name: Demo", true, 12))).toThrow();
  expect(() => readAddonJarMetadata(zip("plugin.yml", "x".repeat(100000), true, 2000))).toThrow();
});
