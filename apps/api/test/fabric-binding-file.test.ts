import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
const fs = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn(), realpath: vi.fn() }));
vi.mock("node:fs/promises", () => fs);
import { readFabricBindingFile } from "../src/services/fabric-binding-file.js";

const file = path.resolve("synthetic-fabric.jar");
const contents = Buffer.from("same bytes");
const snapshot = (fields: Record<string, bigint> = {}) => ({ dev: 7n, ino: 9007199254740992n, nlink: 1n,
  size: BigInt(contents.length), birthtimeNs: 10000000000000001n, mtimeNs: 20000000000000001n,
  ctimeNs: 30000000000000001n, isFile: () => true, isSymbolicLink: () => false, ...fields });
let stat: ReturnType<typeof vi.fn>, read: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  fs.lstat.mockResolvedValue(snapshot()); fs.realpath.mockResolvedValue(file);
  stat = vi.fn().mockResolvedValue(snapshot()); close = vi.fn().mockResolvedValue(undefined);
  read = vi.fn().mockImplementation(async (buffer: Buffer, offset: number, length: number, position: number) => {
    const copied = contents.copy(buffer, offset, position, position + length); return { bytesRead: copied, buffer };
  });
  fs.open.mockResolvedValue({ stat, read, close });
});
it("distinguishes exact IDs that collapse to one Number through actual descriptor reads", async () => {
  const first = await readFabricBindingFile(file);
  const different = 9007199254740993n;
  expect(Number(different)).toBe(Number(9007199254740992n));
  fs.lstat.mockResolvedValue(snapshot({ ino: different })); stat.mockResolvedValue(snapshot({ ino: different }));
  const second = await readFabricBindingFile(file);
  expect(first.bytes.equals(second.bytes)).toBe(true); expect(first.checksum).toBe(second.checksum);
  expect(first.identity).not.toBe(second.identity); expect(first.physicalIdentity).not.toBe(second.physicalIdentity);
  expect(stat).toHaveBeenCalledWith({ bigint: true }); expect(close).toHaveBeenCalledTimes(2);
});
it("separates birth identity from rename-stable physical identity", async () => {
  const first = await readFabricBindingFile(file);
  fs.lstat.mockResolvedValue(snapshot({ birthtimeNs: 10000000000000002n }));
  stat.mockResolvedValue(snapshot({ birthtimeNs: 10000000000000002n }));
  const second = await readFabricBindingFile(file);
  expect(second.identity).not.toBe(first.identity); expect(second.physicalIdentity).toBe(first.physicalIdentity);
});
it("rejects an opened descriptor with a different exact ID before reading bytes", async () => {
  stat.mockResolvedValue(snapshot({ ino: 9007199254740993n }));
  await expect(readFabricBindingFile(file)).rejects.toThrow("unsafe-fabric-binding-file");
  expect(read).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
it("rejects a named file swap after the descriptor read", async () => {
  fs.lstat.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ ino: 9007199254740993n }));
  await expect(readFabricBindingFile(file)).rejects.toThrow("unsafe-fabric-binding-file"); expect(close).toHaveBeenCalledOnce();
});
it.each(["mtimeNs", "ctimeNs", "birthtimeNs"])("detects high-resolution %s drift", async (field) => {
  const original = snapshot(); stat.mockResolvedValueOnce(original).mockResolvedValueOnce(snapshot({ [field]: original[field as keyof typeof original] as bigint + 1n }));
  await expect(readFabricBindingFile(file)).rejects.toThrow("unsafe-fabric-binding-file"); expect(close).toHaveBeenCalledOnce();
});
it("rejects hardlinks without opening the file", async () => {
  fs.lstat.mockResolvedValue(snapshot({ nlink: 2n }));
  await expect(readFabricBindingFile(file)).rejects.toThrow("unsafe-fabric-binding-file"); expect(fs.open).not.toHaveBeenCalled();
});
it("rejects symlinks without opening the file", async () => {
  fs.lstat.mockResolvedValue({ ...snapshot(), isSymbolicLink: () => true });
  await expect(readFabricBindingFile(file)).rejects.toThrow("unsafe-fabric-binding-file"); expect(fs.open).not.toHaveBeenCalled();
});
it("rejects a canonical path mismatch without opening the file", async () => {
  fs.realpath.mockResolvedValue(path.resolve("other-fabric.jar"));
  await expect(readFabricBindingFile(file)).rejects.toThrow("unsafe-fabric-binding-file"); expect(fs.open).not.toHaveBeenCalled();
});
it("rejects exact size beyond the byte limit before allocation or opening", async () => {
  fs.lstat.mockResolvedValue(snapshot({ size: BigInt(contents.length) + 1n }));
  await expect(readFabricBindingFile(file, contents.length)).rejects.toThrow("unsafe-fabric-binding-file"); expect(fs.open).not.toHaveBeenCalled();
});
it.each([NaN, Infinity, -1, 1.5, 64 * 1024 ** 2 + 1])("rejects invalid limit %s before filesystem access", async (limit) => {
  await expect(readFabricBindingFile(file, limit)).rejects.toThrow("unsafe-fabric-binding-file"); expect(fs.lstat).not.toHaveBeenCalled();
});
it("rejects a short read and closes the descriptor", async () => {
  read.mockResolvedValue({ bytesRead: 0 });
  await expect(readFabricBindingFile(file)).rejects.toThrow("unsafe-fabric-binding-file"); expect(close).toHaveBeenCalledOnce();
});
it("zeros captured bytes if descriptor close fails", async () => {
  let captured: Buffer | undefined;
  read.mockImplementation(async (buffer: Buffer, offset: number, length: number, position: number) => {
    captured = buffer; const copied = contents.copy(buffer, offset, position, position + length); return { bytesRead: copied, buffer };
  });
  close.mockRejectedValue(new Error("synthetic-close-failure"));
  await expect(readFabricBindingFile(file)).rejects.toThrow("synthetic-close-failure");
  expect(captured?.equals(Buffer.alloc(contents.length))).toBe(true); expect(close).toHaveBeenCalledOnce();
});
