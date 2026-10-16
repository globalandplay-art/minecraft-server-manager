import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
const model = vi.hoisted(() => ({ target: "", id: 9007199254740992n }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const projected = (info: Awaited<ReturnType<typeof actual.stat>>, exact: boolean) => {
    Object.assign(info, { ino: exact ? model.id : Number(model.id),
      birthtimeMs: exact ? 1000n : 1000, ...(exact ? { birthtimeNs: 1000000000n } : {}) });
    return info;
  };
  return { ...actual,
    lstat: async (file: string, options?: { bigint?: boolean }) => {
      const info = await actual.lstat(file, options);
      return path.resolve(String(file)) === model.target ? projected(info, options?.bigint === true) : info;
    },
    open: async (file: string, flags: string) => {
      const handle = await actual.open(file, flags);
      if (path.resolve(String(file)) !== model.target) return handle;
      return { read: handle.read.bind(handle), close: handle.close.bind(handle), stat: async (options?: { bigint?: boolean }) =>
        projected(await handle.stat(options), options?.bigint === true) };
    }
  };
});
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fabricLaunchFixture } from "./helpers/fabric-launch.js";
import { captureFabricLaunchBinding } from "../src/services/fabric-launch-binding.js";
import { readPrivatePropertiesFile } from "../src/services/properties-private-file.js";
let root: string | undefined;
afterEach(async () => { model.target = ""; model.id = 9007199254740992n; if (root) await rm(root, { recursive: true, force: true }); root = undefined; });
it("distinguishes a dependency through actual binding when legacy numeric identities collide", async () => {
  root = await mkdtemp(path.join(tmpdir(), "mcsm-fabric-exact-")); const f = await fabricLaunchFixture(root);
  model.target = path.join(root, "libraries", "test", "loader.jar");
  const before = await captureFabricLaunchBinding(root, f.jarPath);
  const legacyBefore = await readPrivatePropertiesFile(model.target);
  const bytes = await readFile(model.target); await rename(model.target, model.target + ".old"); await writeFile(model.target, bytes);
  model.id = 9007199254740993n;
  expect(Number(model.id)).toBe(Number(9007199254740992n));
  const legacyAfter = await readPrivatePropertiesFile(model.target);
  expect(legacyAfter.identity).toBe(legacyBefore.identity); expect(legacyAfter.checksum).toBe(legacyBefore.checksum);
  const after = await captureFabricLaunchBinding(root, f.jarPath);
  expect(after.identitySha256).not.toBe(before.identitySha256); expect(after.requiredMajor).toBe(before.requiredMajor);
});
