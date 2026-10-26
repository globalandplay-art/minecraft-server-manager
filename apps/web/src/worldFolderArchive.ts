/** Bounded browser-only ZIP transport. The server independently validates every entry. */
export class WorldFolderError extends Error {
  constructor(readonly code: 'invalid' | 'large' | 'missingLevel' | 'cancelled') { super(code); }
}
const maxBytes = 128 * 1024 ** 2;
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function safeSegment(segment: string) {
  return segment.length > 0 && segment.length <= 255 && segment !== '.' && segment !== '..' &&
    !/[\\:\u0000-\u001f\u007f<>"|?*]/u.test(segment) && !/[. ]$/u.test(segment) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment);
}
export async function createWorldFolderArchive(files: readonly File[], signal?: AbortSignal): Promise<File> {
  const check = () => { if (signal?.aborted) throw new WorldFolderError('cancelled'); };
  check();
  if (!files.length || files.length > 10000) throw new WorldFolderError('invalid');
  let root: string | undefined; let total = 22;
  const entries: { file: File; name: Uint8Array; path: string }[] = [];
  const paths = new Set<string>(); const directories = new Set<string>();
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/');
    if (parts.length < 2 || parts.length > 33 || !parts.every(safeSegment) || parts[parts.length - 1] !== file.name ||
        !Number.isSafeInteger(file.size) || file.size < 0) throw new WorldFolderError('invalid');
    root ??= parts[0];
    if (root !== parts[0]) throw new WorldFolderError('invalid');
    const path = parts.slice(1).join('/'); const canonical = path.normalize('NFC').toLowerCase();
    if (paths.has(canonical) || directories.has(canonical)) throw new WorldFolderError('invalid');
    for (let depth = 1; depth < parts.length - 1; depth++) {
      const directory = parts.slice(1, depth + 1).join('/').normalize('NFC').toLowerCase();
      if (paths.has(directory)) throw new WorldFolderError('invalid');
      directories.add(directory);
    }
    paths.add(canonical);
    const name = encoder.encode(path);
    if (name.length > 65535) throw new WorldFolderError('invalid');
    total += 30 + 46 + name.length * 2 + file.size;
    if (total > maxBytes) throw new WorldFolderError('large');
    entries.push({ file, name, path });
  }
  if (!entries.some(entry => entry.path === 'level.dat')) throw new WorldFolderError('missingLevel');
  const archive = new Uint8Array(total); const view = new DataView(archive.buffer);
  const records: { offset: number; crc: number; size: number; name: Uint8Array }[] = [];
  let position = 0;
  for (const { file, name } of entries) {
    check(); const bytes = new Uint8Array(await file.arrayBuffer()); check();
    if (bytes.length !== file.size) throw new WorldFolderError('invalid');
    const crc = crc32(bytes); const offset = position;
    view.setUint32(position, 0x04034b50, true); view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 0x800, true); view.setUint16(position + 12, 33, true);
    view.setUint32(position + 14, crc, true); view.setUint32(position + 18, bytes.length, true);
    view.setUint32(position + 22, bytes.length, true); view.setUint16(position + 26, name.length, true);
    archive.set(name, position + 30); archive.set(bytes, position + 30 + name.length);
    position += 30 + name.length + bytes.length; records.push({ offset, crc, size: bytes.length, name });
  }
  const directoryStart = position;
  for (const record of records) {
    view.setUint32(position, 0x02014b50, true); view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 20, true); view.setUint16(position + 8, 0x800, true);
    view.setUint16(position + 14, 33, true); view.setUint32(position + 16, record.crc, true);
    view.setUint32(position + 20, record.size, true); view.setUint32(position + 24, record.size, true);
    view.setUint16(position + 28, record.name.length, true); view.setUint32(position + 42, record.offset, true);
    archive.set(record.name, position + 46); position += 46 + record.name.length;
  }
  view.setUint32(position, 0x06054b50, true); view.setUint16(position + 8, records.length, true);
  view.setUint16(position + 10, records.length, true); view.setUint32(position + 12, position - directoryStart, true);
  view.setUint32(position + 16, directoryStart, true); check();
  return new File([archive], 'world-folder.zip', { type: 'application/zip' });
}
