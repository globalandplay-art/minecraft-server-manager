// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createWorldFolderArchive } from './worldFolderArchive';
function file(relativePath: string, content = 'data', size?: number) {
  const result = new File([content], relativePath.split('/').at(-1)!);
  Object.defineProperty(result, 'webkitRelativePath', { value: relativePath });
  if (size !== undefined) Object.defineProperty(result, 'size', { value: size });
  return result;
}
describe('bounded world folder ZIP transport', () => {
  it('writes stored UTF-8 entries, strips only the common folder and records CRC/central directory', async () => {
    const archive = await createWorldFolderArchive([file('世界/level.dat', '123456789'), file('世界/region/r.0.0.mca')]);
    const bytes = new Uint8Array(await archive.arrayBuffer()); const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x800);
    expect(view.getUint32(14, true)).toBe(0xcbf43926);
    expect(new TextDecoder().decode(bytes.slice(30, 39))).toBe('level.dat');
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 14, true)).toBe(2);
    expect(view.getUint32(view.getUint32(bytes.length - 6, true), true)).toBe(0x02014b50);
  });
  it.each(['root/../x', 'root/CON.txt', 'root/a:b', 'root/a\\b', '/root/x', 'root/a./x', 'root//x'])('rejects unsafe path %s', async path => {
    await expect(createWorldFolderArchive([file('root/level.dat'), file(path)])).rejects.toMatchObject({ code: 'invalid' });
  });
  it.each([
    ['root/LEVEL.DAT', 'root/level.dat'], ['root/a', 'root/a/x'], ['root/a/x', 'root/a'],
    ['root/é', 'root/e\u0301'], ['other/x', 'root/level.dat']
  ])('rejects case/normalization/file-directory/root collisions %j', async (a, b) => {
    await expect(createWorldFolderArchive([file(a), file(b)])).rejects.toMatchObject({ code: 'invalid' });
  });
  it('requires root level.dat and bounded count, size including headers, and depth', async () => {
    await expect(createWorldFolderArchive([file('root/nested/level.dat')])).rejects.toMatchObject({ code: 'missingLevel' });
    await expect(createWorldFolderArchive(Array.from({ length: 10001 }, () => file('root/level.dat')))).rejects.toMatchObject({ code: 'invalid' });
    await expect(createWorldFolderArchive([file('root/level.dat', '', 128 * 1024 ** 2)])).rejects.toMatchObject({ code: 'large' });
    await expect(createWorldFolderArchive([file(`${'a/'.repeat(34)}x`)])).rejects.toMatchObject({ code: 'invalid' });
  });
  it('rejects changed file size and cancellation without producing an upload', async () => {
    await expect(createWorldFolderArchive([file('root/level.dat', 'data', 1)])).rejects.toMatchObject({ code: 'invalid' });
    const abort = new AbortController(); abort.abort();
    await expect(createWorldFolderArchive([file('root/level.dat')], abort.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('observes cancellation after a pending file read and preserves Unicode entry names', async () => {
    const abort = new AbortController(); let finish!: (value: ArrayBuffer) => void;
    const pending = file('root/level.dat');
    Object.defineProperty(pending, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
    const packing = createWorldFolderArchive([pending], abort.signal);
    abort.abort(); finish(new TextEncoder().encode('data').buffer);
    await expect(packing).rejects.toMatchObject({ code: 'cancelled' });
    const zip = await createWorldFolderArchive([file('root/level.dat'), file('root/日本語.dat')]);
    const bytes = new Uint8Array(await zip.arrayBuffer()); const view = new DataView(bytes.buffer);
    const second = 30 + view.getUint16(26, true) + view.getUint32(18, true);
    expect(new TextDecoder().decode(bytes.slice(second + 30, second + 30 + view.getUint16(second + 26, true)))).toBe('日本語.dat');
  });
});
