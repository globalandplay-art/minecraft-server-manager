/** Independent stored ZIP fixture with optional signed/unsigned data descriptor. */
export function addonZip(name: string, text: string, descriptor: "signed" | "unsigned" | null = null): Buffer {
  const filename = Buffer.from(name), data = Buffer.from(text);
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(descriptor ? 8 : 0, 6); local.writeUInt16LE(filename.length, 26);
  if (!descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); }
  const tail = Buffer.alloc(descriptor === "signed" ? 16 : descriptor === "unsigned" ? 12 : 0);
  if (descriptor) {
    const offset = descriptor === "signed" ? 4 : 0;
    if (offset) tail.writeUInt32LE(0x08074b50);
    tail.writeUInt32LE(crc, offset); tail.writeUInt32LE(data.length, offset + 4); tail.writeUInt32LE(data.length, offset + 8);
  }
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(descriptor ? 8 : 0, 8); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const payload = Buffer.concat([local, filename, data, tail]), directory = Buffer.concat([central, filename]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(payload.length, 16);
  return Buffer.concat([payload, directory, end]);
}
