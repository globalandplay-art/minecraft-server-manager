import path from "node:path";
import { lstat } from "node:fs/promises";
import { beforeEach, expect, it, vi } from "vitest";
import { createPrivateEntry, publishPrivateStage, publishPrivateStageNew } from "../../src/auth/private-publication.js";
import { buildPrivateCreateScript, buildPrivatePublishNewScript, buildPrivatePublishScript } from "../../src/auth/private-publication-scripts.js";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";
import { runWindowsNativeScript } from "../../src/auth/windows-native.js";

vi.mock("node:fs/promises", async (original) => ({ ...await original<typeof import("node:fs/promises")>(), lstat: vi.fn() }));
vi.mock("../../src/auth/windows-native.js", async (original) => ({ ...await original<typeof import("../../src/auth/windows-native.js")>(), runWindowsNativeScript: vi.fn() }));
const root = path.resolve("synthetic-publication-fixture"), stage = path.join(root, "stage.json"), target = path.join(root, "target.json");
const sid = "S-1-5-21-1-2-3-1001", snapshot = { userSid: sid, ownerSid: sid, protected: true, aces: [{ sid, kind: "allow", mask: 0x1f01ff, flags: 0 }] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(runWindowsNativeScript).mockResolvedValue({ ok: true, snapshot }); });
it.each([false, true])("keeps original runner and ACL validation for directory=%s", async (directory) => {
  vi.mocked(lstat).mockRejectedValueOnce(Object.assign(new Error(), { code: "ENOENT" }));
  vi.mocked(lstat).mockResolvedValueOnce({ isSymbolicLink: () => false, isDirectory: () => directory, isFile: () => !directory, nlink: 1, size: 0 } as Awaited<ReturnType<typeof lstat>>);
  const acl = new WindowsPrivateAclVerifier(), check = vi.spyOn(acl, "verifyNativeSnapshot");
  await createPrivateEntry(stage, directory, acl);
  expect(runWindowsNativeScript).toHaveBeenCalledExactlyOnceWith(buildPrivateCreateScript(stage, directory));
  expect(check).toHaveBeenCalledExactlyOnceWith(snapshot);
});
it.each(["new", "replace"])("keeps original runner and fixed %s publication payload", async (mode) => {
  await (mode === "new" ? publishPrivateStageNew(stage, target) : publishPrivateStage(stage, target));
  expect(runWindowsNativeScript).toHaveBeenCalledExactlyOnceWith(mode === "new" ? buildPrivatePublishNewScript(stage, target) : buildPrivatePublishScript(stage, target));
  expect(lstat).not.toHaveBeenCalled();
});
it("still refuses a known existing create target before any native invocation", async () => {
  vi.mocked(lstat).mockResolvedValue({} as Awaited<ReturnType<typeof lstat>>);
  await expect(createPrivateEntry(stage, false, new WindowsPrivateAclVerifier())).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
  expect(runWindowsNativeScript).not.toHaveBeenCalled();
});
it.each([publishPrivateStageNew, publishPrivateStage])("still refuses cross-directory publication before invocation", async (publish) => {
  await expect(publish(stage, path.join(root, "other", "target.json"))).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
  expect(runWindowsNativeScript).not.toHaveBeenCalled();
});
it("does not accept a failed native success receipt", async () => {
  vi.mocked(runWindowsNativeScript).mockResolvedValue({ ok: false });
  await expect(publishPrivateStageNew(stage, target)).rejects.toMatchObject({ code: "AUTH_PRIVATE_UNSAFE" });
});
