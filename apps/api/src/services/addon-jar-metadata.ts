import { inflateRawSync } from "node:zlib";
import { DomainError } from "./domain-errors.js";
const targets = new Set(["fabric.mod.json", "plugin.yml", "paper-plugin.yml", "META-INF/mods.toml", "META-INF/neoforge.mods.toml"]);
const unsafe = () => new DomainError(409, "ADDON_JAR_UNSAFE", "JAR结构或metadata未通过安全检查", "addon-jar-unsafe");
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n & 1) ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Buffer) { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!; return (crc ^ 0xffffffff) >>> 0; }
/** Inspect in-memory immutable descriptor bytes; no extraction or execution. ZIP64 is deliberately unsupported. */
export function readAddonJarMetadata(bytes: Buffer): Map<string, Buffer> {
  try {
    if (bytes.length < 22 || bytes.length > 64 * 1024 ** 2) throw unsafe();
    const take = (offset: number, size: number) => {
      if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > bytes.length) throw unsafe();
      return bytes.subarray(offset, offset + size);
    };
    let eocd = bytes.length - 22;
    while (eocd >= Math.max(0, bytes.length - 65557) && !(bytes.readUInt32LE(eocd) === 0x06054b50 && eocd + 22 + bytes.readUInt16LE(eocd + 20) === bytes.length)) eocd--;
    if (eocd < Math.max(0, bytes.length - 65557)) throw unsafe();
    const end = take(eocd, 22), count = end.readUInt16LE(10), central = end.readUInt32LE(16);
    if (end.readUInt16LE(4) || end.readUInt16LE(6) || end.readUInt16LE(8) !== count || count < 1 || count > 10000 ||
      central + end.readUInt32LE(12) !== eocd) throw unsafe();
    const result = new Map<string, Buffer>(), names = new Set<string>(), spans: [number, number][] = [];
    let cursor = central, expanded = 0, metadataBytes = 0;
    const extra = (fields: Buffer) => {
      const ids = new Set<number>();
      for (let p = 0; p < fields.length;) {
        if (p + 4 > fields.length) throw unsafe();
        const id = fields.readUInt16LE(p), size = fields.readUInt16LE(p + 2);
        if (p + 4 + size > fields.length || ids.has(id) || [1, 0x7075, 0x9901].includes(id)) throw unsafe();
        ids.add(id); p += 4 + size;
      }
    };
    for (let n = 0; n < count; n++) {
      const header = take(cursor, 46);
      if (header.readUInt32LE(0) !== 0x02014b50 || header.readUInt16LE(34)) throw unsafe();
      const flags = header.readUInt16LE(8), method = header.readUInt16LE(10), compressed = header.readUInt32LE(20), size = header.readUInt32LE(24);
      const nameSize = header.readUInt16LE(28), extraSize = header.readUInt16LE(30), commentSize = header.readUInt16LE(32);
      const nameBytes = take(cursor + 46, nameSize), name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes);
      if (flags & ~0x080e || ![0, 8].includes(method) || (method === 0 && flags & 6) || header.readUInt16LE(6) > 20) throw unsafe();
      if (!(flags & 0x0800) && nameBytes.some((byte) => byte > 127)) throw unsafe();
      const directory = name.endsWith("/"), parts = (directory ? name.slice(0, -1) : name).split("/");
      if (name.includes("\uFEFF") || name.length > 4096 || name !== name.normalize("NFC") || parts.length > 32 || parts.some((part) =>
        !part || part.length > 255 || [".", ".."].includes(part) || /[\\:<>"|?*\u0000-\u001f\u007f]|[. ]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))) throw unsafe();
      const folded = name.toLowerCase(); if (names.has(folded)) throw unsafe(); names.add(folded);
      const mode = (header.readUInt32LE(38) >>> 16) & 0xf000;
      if (mode && mode !== (directory ? 0x4000 : 0x8000)) throw unsafe();
      extra(take(cursor + 46 + nameSize, extraSize));
      cursor += 46 + nameSize + extraSize + commentSize; if (cursor > eocd) throw unsafe();
      expanded += size;
      if (size > 64 * 1024 ** 2 || expanded > 512 * 1024 ** 2 || size > compressed * 100 ||
        (directory && (size || compressed || method || header.readUInt32LE(16)))) throw unsafe();
      const localOffset = header.readUInt32LE(42), local = take(localOffset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(4) !== header.readUInt16LE(6) ||
        local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || local.readUInt16LE(26) !== nameSize ||
        !take(localOffset + 30, nameSize).equals(nameBytes)) throw unsafe();
      const localExtra = local.readUInt16LE(28); extra(take(localOffset + 30 + nameSize, localExtra));
      const descriptor = Boolean(flags & 8), crc = header.readUInt32LE(16);
      for (const [offset, expected] of [[14, crc], [18, compressed], [22, size]]) {
        const actual = local.readUInt32LE(offset!); if (actual !== expected && !(descriptor && actual === 0)) throw unsafe();
      }
      const dataStart = localOffset + 30 + nameSize + localExtra; let dataEnd = dataStart + compressed;
      if (dataEnd > central) throw unsafe();
      if (targets.has(name) && (size > 256 * 1024 || metadataBytes + size > 1024 * 1024)) throw unsafe();
      if (descriptor) {
        const signed = take(dataEnd, 4).readUInt32LE(0) === 0x08074b50;
        const data = take(dataEnd + (signed ? 4 : 0), 12);
        if (data.readUInt32LE(0) !== crc || data.readUInt32LE(4) !== compressed || data.readUInt32LE(8) !== size) throw unsafe();
        dataEnd += signed ? 16 : 12; if (dataEnd > central) throw unsafe();
      }
      spans.push([localOffset, dataEnd]);
      // Check every regular member, not just descriptors, before accepting an
      // upload. A corrupt class/resource must never become installable.
      let content: Buffer | undefined;
      if (!directory) {
        const raw = take(dataStart, compressed);
        if (method === 0) content = Buffer.from(raw);
        else {
          const inflated = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1), info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
          if (inflated.engine.bytesWritten !== raw.length) throw unsafe();
          content = inflated.buffer;
        }
        if (content.length !== size || crc32(content) !== crc) throw unsafe();
      }
      if (targets.has(name)) {
        if (!content || size > 256 * 1024 || metadataBytes + size > 1024 * 1024) throw unsafe();
        metadataBytes += content.length; result.set(name, content);
      }
    }
    if (cursor !== eocd) throw unsafe();
    spans.sort((a, b) => a[0] - b[0]);
    for (let n = 1; n < spans.length; n++) if (spans[n]![0] < spans[n - 1]![1]) throw unsafe();
    return result;
  } catch { throw unsafe(); }
}
