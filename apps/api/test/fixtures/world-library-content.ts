import { gzipSync } from "node:zlib";

function string(value: string) { const bytes = Buffer.from(value); const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); return Buffer.concat([length, bytes]); }
function tag(type: number, name: string, value: Buffer) { return Buffer.concat([Buffer.from([type]), string(name), value]); }
function compound(name: string, children: Buffer[]) { return tag(10, name, Buffer.concat([...children, Buffer.from([0])])); }
export function testWorldLevel(marker: string, withDataVersion = true) {
  // Synthetic matching DataVersion: not the authoritative real Minecraft mapping.
  const data = Buffer.alloc(4); data.writeInt32BE(100);
  return gzipSync(Buffer.concat([Buffer.from([10]), string(""), compound("Data", [
    compound("Version", [tag(8, "Name", string("26.3"))]), tag(8, "LevelName", string(marker)),
    ...(withDataVersion ? [tag(3, "DataVersion", data)] : [])]), Buffer.from([0])]));
}
export function testWorldZip(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  crc = (crc ^ 0xffffffff) >>> 0;
  const name = Buffer.from("level.dat"), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + bytes.length, 16);
  return Buffer.concat([local, name, bytes, central, name, end]);
}
