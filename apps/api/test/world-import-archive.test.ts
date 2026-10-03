import { link, mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { stageWorldImportArchive, WORLD_IMPORT_ARCHIVE_LIMITS } from "../src/services/world-import-archive.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function str(value: string): Buffer {
  const bytes = Buffer.from(value), size = Buffer.alloc(2); size.writeUInt16BE(bytes.length); return Buffer.concat([size, bytes]);
}
function tag(type: number, name: string, data: Buffer): Buffer { return Buffer.concat([Buffer.from([type]), str(name), data]); }
function compound(name: string, children: Buffer[]): Buffer { return tag(10, name, Buffer.concat([...children, Buffer.from([0])])); }
function level(version: string | null = "1.21.1"): Buffer {
  return gzipSync(Buffer.concat([Buffer.from([10]), str(""), compound("Data", version === null ? [] : [compound("Version", [tag(8, "Name", str(version))])]), Buffer.from([0])]));
}
// Deliberately independent bit-at-a-time CRC oracle for these hand-written ZIP fixtures.
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
type Member = {
  name: string; data?: Buffer; method?: number; flags?: number; localFlags?: number; localName?: string;
  mode?: number; madeBy?: number; extra?: Buffer; localExtra?: Buffer; crc?: number;
  expanded?: number; localExpanded?: number; disk?: number; descriptor?: boolean; descriptorCrc?: number; compressedData?: Buffer;
};
function zip(members: Member[]): Buffer {
  const payload: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const member of members) {
    const data = member.data ?? Buffer.alloc(0), name = Buffer.from(member.name), localName = Buffer.from(member.localName ?? member.name);
    const extra = member.extra ?? Buffer.alloc(0), localExtra = member.localExtra ?? extra;
    const method = member.method ?? 0, compressed = member.compressedData ?? (method === 8 ? deflateRawSync(data) : data);
    const flags = (member.flags ?? 0x0800) | (member.descriptor ? 8 : 0), crc = member.crc ?? crc32(data), expanded = member.expanded ?? data.length;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(member.localFlags ?? flags, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(member.descriptor ? 0 : crc, 14); header.writeUInt32LE(member.descriptor ? 0 : compressed.length, 18);
    header.writeUInt32LE(member.localExpanded ?? (member.descriptor ? 0 : expanded), 22);
    header.writeUInt16LE(localName.length, 26); header.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(member.descriptor ? 16 : 0);
    if (member.descriptor) { descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(member.descriptorCrc ?? crc, 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(expanded, 12); }
    payload.push(header, localName, localExtra, compressed, descriptor);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(member.madeBy ?? 20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(compressed.length, 20); cd.writeUInt32LE(expanded, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(extra.length, 30); cd.writeUInt16LE(member.disk ?? 0, 34);
    cd.writeUInt32LE((member.mode ?? 0) >>> 0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, name, extra); offset += header.length + localName.length + localExtra.length + compressed.length + descriptor.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...payload, directory, end]);
}
async function fixture(bytes: Buffer) {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-import-zip-")); roots.push(root);
  const archive = path.join(root, "private-upload.zip"), stage = path.join(root, "generated-stage"); await writeFile(archive, bytes);
  return { root, archive, stage, run: () => stageWorldImportArchive(archive, stage, "1.21.1") };
}
const world = (extra: Member[] = []) => [{ name: "level.dat", data: level() }, ...extra];
async function rejectedBeforeStaging(bytes: Buffer, code = "IMPORT_ARCHIVE_UNSAFE") {
  const f = await fixture(bytes); await expect(f.run()).rejects.toMatchObject({ code }); await expect(stat(f.stage)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("private world ZIP validation and staging", () => {
  it("stages a root Vanilla world, bounds streams, hashes files and preserves bytes", async () => {
    const region = Buffer.from("test-region-content"), f = await fixture(zip(world([{ name: "region/", mode: 0x10 }, { name: "region/r.-1.2.mca", data: region, method: 8 }])));
    const result = await f.run();
    expect(result.minecraftVersion).toBe("1.21.1"); expect(result.sizeBytes).toBe(level().length + region.length);
    expect(result.files.map((file) => file.path)).toEqual(["level.dat", "region/r.-1.2.mca"]);
    expect(result.files.every((file) => /^[0-9a-f]{64}$/u.test(file.sha256))).toBe(true);
    expect(await readFile(path.join(f.stage, "region/r.-1.2.mca"))).toEqual(region);
  });
  it("unwraps a sole directory and accepts checked deflate data descriptors", async () => {
    const f = await fixture(zip([{ name: "世界/" }, { name: "世界/level.dat", data: level(), method: 8, descriptor: true },
      { name: "世界/DIM-1/region/r.0.0.mca", data: Buffer.from("nether") }, { name: "世界/data/minecraft/random_sequences.dat", data: Buffer.from("data") }]));
    const result = await f.run(); expect(result.files).toHaveLength(3);
    expect(await readFile(path.join(f.stage, "level.dat"))).toEqual(level());
    await expect(stat(path.join(f.stage, "世界"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["../escape", "/escape", "C:/escape", "region\\evil.mca", "data/name:secret.dat", "data/CON.dat", "data/COM¹.dat", "data/name. ", "data/./x.dat", "data//x.dat", "data/hello\u0000.dat", "data/x?.dat", "data/x|.dat", "data/x>.dat", "data/.. /x.dat"])("rejects unsafe path %s before creating staging", async (name) => {
    await rejectedBeforeStaging(zip(world([{ name, data: Buffer.from("x") }])));
  });
  it("rejects excessive nesting", async () => { await rejectedBeforeStaging(zip(world([{ name: "a/".repeat(33) + "x" }]))); });
  it.each(["server.properties", ".env", "plugin.yml", "plugins/x.jar", "data/secret.properties", "region/server.properties", "datapacks/pack.zip", "unknown.dat"])("rejects non-allowlisted %s", async (name) => {
    await rejectedBeforeStaging(zip(world([{ name, data: Buffer.from("rcon.password=private") }])));
  });
  it.each([
    [{ name: "level.dat", data: level() }],
    [{ name: "data/foo.dat" }, { name: "data/FOO.dat" }],
    [{ name: "data/é.dat" }, { name: "data/e\u0301.dat" }],
    [{ name: "data/a.dat" }, { name: "Data/b.dat" }],
    [{ name: "region" }, { name: "region/r.0.0.mca" }],
    [{ name: "region/" }, { name: "region/" }]
  ].map((members) => ({ members })))("rejects duplicate or ambiguous trees (%j)", async ({ members }) => { await rejectedBeforeStaging(zip(world(members))); });
  it.each([
    [{ name: "one/level.dat", data: level() }, { name: "two/level.dat", data: level() }],
    [{ name: "world/level.dat", data: level() }, { name: "server.properties" }],
    [{ name: "level.dat", data: level() }, { name: "world/level.dat", data: level() }],
    [{ name: "region/r.0.0.mca" }],
    [{ name: "world/level.dat", data: level() }, { name: "world/extra/" }]
  ].map((members) => ({ members })))("rejects extra roots, missing level data or extra directories (%j)", async ({ members }) => { await rejectedBeforeStaging(zip(members)); });
  it.each([0xa000, 0x1000, 0x2000, 0x6000, 0xc000, 0x4000, 0])("rejects Unix nonregular/missing type %#x", async (mode) => {
    await rejectedBeforeStaging(zip(world([{ name: "data/test.dat", data: Buffer.from("x"), madeBy: (3 << 8) | 20, mode: (mode << 16) >>> 0 }])));
  });
  it("accepts explicitly regular Unix files", async () => {
    const f = await fixture(zip([{ name: "level.dat", data: level(), madeBy: (3 << 8) | 20, mode: 0x81a40000 }])); expect((await f.run()).files).toHaveLength(1);
  });
  it.each([1, 0x40, 0x2000])("rejects encrypted or unsupported flags %#x", async (flags) => {
    await rejectedBeforeStaging(zip([{ name: "level.dat", data: level(), flags }]));
  });
  it("rejects unsupported compression", async () => { await rejectedBeforeStaging(zip([{ name: "level.dat", data: level(), method: 12 }])); });
  it("rejects directory payload and inconsistent DOS type flags", async () => {
    await rejectedBeforeStaging(zip(world([{ name: "region/", data: Buffer.from("hidden") }])));
    await rejectedBeforeStaging(zip([{ name: "level.dat", data: level(), mode: 0x10 }]));
  });
  it.each([0x0001, 0x000d, 0x756e, 0x5855, 0x7075])("rejects ZIP64 or link/ambiguous extra field %#x", async (id) => {
    const extra = Buffer.alloc(4); extra.writeUInt16LE(id); await rejectedBeforeStaging(zip([{ name: "level.dat", data: level(), extra }]));
  });
  it("rejects malformed local extra fields", async () => { await rejectedBeforeStaging(zip([{ name: "level.dat", data: level(), localExtra: Buffer.from([1]) }])); });
  it.each([
    { localName: "other.dat" }, { localFlags: 0 }, { localExpanded: 999 }, { descriptor: true, descriptorCrc: 123 }, { disk: 1 }
  ])("checks local headers, descriptors and central disk metadata (%j)", async (change) => { await rejectedBeforeStaging(zip([{ name: "level.dat", data: level(), ...change }])); });
  it("rejects EOCD multidisk and ZIP64 sentinels", async () => {
    for (const offset of [4, 6, 8, 10]) { const bytes = zip(world()); bytes.writeUInt16LE(offset === 10 ? 0xffff : 2, bytes.length - 22 + offset); await rejectedBeforeStaging(bytes); }
    const bytes = zip(world()); bytes.writeUInt32LE(0xffffffff, bytes.length - 6); await rejectedBeforeStaging(bytes);
  });
  it("rejects overlapping local entries", async () => {
    const bytes = zip(world([{ name: "data/test.dat" }])); const central = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt32LE(0, central + 46 + Buffer.byteLength("level.dat") + 42); await rejectedBeforeStaging(bytes);
  });
  it("checks actual CRC after extraction and leaves private failed staging for guarded cleanup", async () => {
    const f = await fixture(zip([{ name: "level.dat", data: level(), crc: 123 }]));
    await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_UNSAFE", reason: "entry-content-mismatch" });
    expect((await stat(f.stage)).isDirectory()).toBe(true); await expect(stat(path.join(f.root, "escape"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects understated actual expansion in streaming extraction", async () => {
    const f = await fixture(zip([{ name: "level.dat", data: level(), method: 8, expanded: 1 }]));
    await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_TOO_LARGE" });
  });
  it("rejects deflate trailing bytes rather than silently accepting an alternate payload", async () => {
    const bytes = zip([{ name: "level.dat", data: level(), method: 8 }]);
    const central = bytes.readUInt32LE(bytes.length - 6), changed = Buffer.concat([bytes.subarray(0, central), Buffer.from("extra"), bytes.subarray(central)]);
    const compressed = bytes.readUInt32LE(18) + 5; changed.writeUInt32LE(compressed, 18); changed.writeUInt32LE(compressed, central + 5 + 20); changed.writeUInt32LE(central + 5, changed.length - 6);
    const f = await fixture(changed); await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_UNSAFE" });
  });
  it.each(["1.20.6", null])("rejects mismatched or unavailable NBT world version %s", async (version) => {
    const f = await fixture(zip([{ name: "level.dat", data: level(version) }])); await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_VERSION_UNSUPPORTED" });
  });
  it("rejects malformed and overexpanded NBT level data", async () => {
    for (const data of [Buffer.from("not-nbt"), gzipSync(Buffer.alloc(17 * 1024 ** 2))]) {
      const f = await fixture(zip([{ name: "level.dat", data }])); await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_VERSION_UNSUPPORTED" });
    }
  });
  it("rejects ZIP, entry-count, per-file and ratio resource limits before staging", async () => {
    const f = await fixture(zip(world())); await truncate(f.archive, WORLD_IMPORT_ARCHIVE_LIMITS.zipBytes + 1);
    await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_TOO_LARGE" }); await expect(stat(f.stage)).rejects.toMatchObject({ code: "ENOENT" });
    const count = zip(world()); count.writeUInt16LE(10_001, count.length - 14); count.writeUInt16LE(10_001, count.length - 12); await rejectedBeforeStaging(count, "IMPORT_ARCHIVE_TOO_LARGE");
    await rejectedBeforeStaging(zip([{ name: "level.dat", data: level(), method: 8, expanded: WORLD_IMPORT_ARCHIVE_LIMITS.fileBytes + 1 }]), "IMPORT_ARCHIVE_TOO_LARGE");
    await rejectedBeforeStaging(zip(world([{ name: "data/bomb.dat", data: Buffer.alloc(128 * 1024), method: 8 }])), "IMPORT_ARCHIVE_TOO_LARGE");
  });
  it("bounds aggregate declared expansion before extracting any entry", async () => {
    const compressedData = Buffer.alloc(2 * 1024 ** 2);
    const members = Array.from({ length: 4 }, (_, index) => ({ name: `data/test${index}.dat`, method: 8,
      compressedData, expanded: WORLD_IMPORT_ARCHIVE_LIMITS.fileBytes }));
    await rejectedBeforeStaging(zip(world(members)), "IMPORT_ARCHIVE_TOO_LARGE");
  });
  it.each(["", "world/"])("rejects unknown deep layouts before collision-prefix expansion with wrapper %s", async (prefix) => {
    const deep = Array.from({ length: 31 }, () => "a".repeat(100)).join("/");
    const f = await fixture(zip([{ name: prefix + "level.dat", data: level() },
      { name: prefix + deep + "/" }, { name: prefix + deep + "/" }]));
    await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_UNSAFE", reason: "file-not-allowlisted" });
    await expect(stat(f.stage)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects 10,000-entry long/deep directory amplification before staging", async () => {
    const directories = Array.from({ length: WORLD_IMPORT_ARCHIVE_LIMITS.entries - 1 }, (_, index) => ({
      name: [String(index).padStart(5, "0") + "a".repeat(119), ...Array.from({ length: 31 }, () => "b".repeat(124))].join("/") + "/"
    }));
    const f = await fixture(zip(world(directories)));
    expect((await stat(f.archive)).size).toBeLessThan(WORLD_IMPORT_ARCHIVE_LIMITS.zipBytes);
    await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_UNSAFE", reason: "file-not-allowlisted" });
    await expect(stat(f.stage)).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);
  it("rejects reused staging and preserves its sentinel", async () => {
    const f = await fixture(zip(world())); await mkdir(f.stage); await writeFile(path.join(f.stage, "sentinel"), "preserve");
    await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_UNSAFE" }); expect(await readFile(path.join(f.stage, "sentinel"), "utf8")).toBe("preserve");
  });
  it("rejects hard-linked upload files before staging", async () => {
    const f = await fixture(zip(world())); await link(f.archive, path.join(f.root, "other-link"));
    await expect(f.run()).rejects.toMatchObject({ code: "IMPORT_ARCHIVE_UNSAFE" }); await expect(stat(f.stage)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects incomplete and empty ZIPs", async () => { for (const bytes of [Buffer.from("PK"), zip([]), zip(world()).subarray(0, 50)]) await rejectedBeforeStaging(bytes); });
});
