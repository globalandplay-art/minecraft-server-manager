import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PropertiesReader } from "../src/services/properties-reader.js";
const roots: string[] = [];
async function fixture(text = "max-players=20\npvp=true\nonline-mode=true\nview-distance=10\nsimulation-distance=10\ndifficulty=normal\ngamemode=survival\nmotd=Hello\nrcon.password=private-fixture\n") {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-p4-properties-")); roots.push(root);
  const file = path.join(root, "server.properties"); await writeFile(file, text); return { root, file, text };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe("properties descriptor identity and private revision core", () => {
  it("retains overridden sensitive values for redaction while safe fields remain last-wins", async () => {
    const f = await fixture("rcon.password=OLD-PRIVATE\nrcon.password=NEW-PRIVATE\npvp=false\npvp=true\nmotd=hello OLD-PRIVATE\n");
    const result = await new PropertiesReader().read("test", f.root);
    expect(result.fields.motd).toBeNull();
    expect(result.fields.pvp).toBe(true);
    expect(JSON.stringify(result)).not.toContain("OLD-PRIVATE");
  });
  it.each(["pvp=false\n# comment\\\npvp=true\n", "motd=\\uu0041\n", "motd=unfinished\\"])("rejects ambiguous legacy grammar without returning misleading fields", async (text) => {
    const f = await fixture(text);
    await expect(new PropertiesReader().read("test", f.root)).rejects.toMatchObject({ code: "PROPERTIES_READ_UNSAFE" });
    expect(await readFile(f.file, "utf8")).toBe(text);
  });
  it("exposes only safe whitelist fields and leaves the complete file unchanged", async () => {
    const f = await fixture(); const result = await new PropertiesReader().read("test", f.root);
    expect(result.fields).toMatchObject({ "max-players": 20, pvp: true, difficulty: "normal", motd: "Hello" });
    expect(Object.keys(result.fields)).toHaveLength(8); expect(JSON.stringify(result)).not.toContain("private-fixture");
    expect(await readFile(f.file, "utf8")).toBe(f.text);
  });
  it("uses keyed root/server/content revisions, invalidating on reader restart", async () => {
    const f = await fixture(); const reader = new PropertiesReader(); const first = await reader.read("test", f.root);
    expect(first.revision).toBe((await reader.read("test", f.root)).revision);
    expect(first.revision).not.toBe(createHash("sha256").update(f.text).digest("hex"));
    expect(first.revision).not.toBe((await reader.read("other", f.root)).revision);
    expect(first.revision).not.toBe((await new PropertiesReader().read("test", f.root)).revision);
    await writeFile(f.file, f.text.replace("private-fixture", "new-private-fixture"));
    expect(first.revision).not.toBe((await reader.read("test", f.root)).revision);
  });
  it("does not leak a known secret copied into an allowed text field", async () => {
    const f = await fixture("rcon.password=private-fixture\nmotd=hello private-fixture\n");
    expect((await new PropertiesReader().read("test", f.root)).fields.motd).toBeNull();
  });
  it.each(["admin.passwd", "pwd", "passphrase", "authorization", "token", "secret", "credential"])("uses the shared sensitive key policy for %s", async (key) => {
    const f = await fixture(`${key}=private-fixture\nmotd=hello private-fixture\n`);
    expect((await new PropertiesReader().read("test", f.root)).fields.motd).toBeNull();
  });
  it("rejects a BOM instead of silently changing the first key grammar", async () => {
    const f = await fixture("\ufeffmotd=Hello\n");
    await expect(new PropertiesReader().read("test", f.root)).rejects.toMatchObject({ code: "PROPERTIES_READ_UNSAFE" });
  });
  it("returns null for missing/invalid fields rather than made-up defaults", async () => {
    const f = await fixture("pvp=maybe\nmax-players=0\ndifficulty=custom\nview-distance=not-a-number\n");
    expect(Object.values((await new PropertiesReader().read("test", f.root)).fields).every((value) => value === null)).toBe(true);
  });
  it("rejects hardlinked configurations without reading external contents", async () => {
    const f = await fixture(); await link(f.file, path.join(f.root, "external-copy"));
    await expect(new PropertiesReader().read("test", f.root)).rejects.toMatchObject({ code: "PROPERTIES_READ_UNSAFE" });
  });
  it("rejects a root junction", async () => {
    const f = await fixture(); const parent = await fixture(); const alias = path.join(parent.root, "alias");
    await symlink(f.root, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(new PropertiesReader().read("test", alias)).rejects.toMatchObject({ code: "PROPERTIES_READ_UNSAFE" });
  });
  it.each(["over-limit", "bad-utf8", "bad-unicode", "directory", "nul"])("rejects %s with a safe error only", async (kind) => {
    const f = await fixture();
    if (kind === "directory") { await rm(f.file); await mkdir(f.file); }
    else await writeFile(f.file, kind === "over-limit" ? Buffer.alloc(1024 ** 2 + 1) : kind === "bad-utf8" ? Buffer.from([255]) : kind === "bad-unicode" ? "motd=\\uZZZZ" : "motd=\0secret");
    await expect(new PropertiesReader().read("test", f.root)).rejects.toMatchObject({ code: "PROPERTIES_READ_UNSAFE", safeMessage: "配置无法安全读取，请检查实例文件状态" });
  });
});
