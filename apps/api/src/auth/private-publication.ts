import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { AuthCoreError } from "./password.js";
import { WindowsPrivateAclVerifier } from "./windows-private-acl.js";
import { runWindowsNativeScript } from "./windows-native.js";
import { buildPrivateCreateScript, buildPrivatePublishNewScript, buildPrivatePublishScript } from "./private-publication-scripts.js";
import { readPrivatePropertiesFile } from "../services/properties-private-file.js";

const fail = () => new AuthCoreError("AUTH_PRIVATE_UNSAFE");


async function execute(payload: string): Promise<unknown> {
  const output = await runWindowsNativeScript(payload);
  if (typeof output !== "object" || output === null || !("ok" in output) || output.ok !== true) throw fail();
  return output;
}
export async function privateEntryExists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false; throw fail(); }
}
/** Only creates a new protected object; never repairs or recursively changes existing ACLs. */
export async function createPrivateEntry(file: string, directory: boolean, acl: WindowsPrivateAclVerifier): Promise<void> {
  if (await privateEntryExists(file)) throw fail();
  const output = await runWindowsNativeScript(buildPrivateCreateScript(file, directory));
  if (typeof output !== "object" || output === null || !("snapshot" in output) || !("ok" in output) || output.ok !== true) throw fail();
  acl.verifyNativeSnapshot(output.snapshot);
  const info = await lstat(file);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size !== 0)) throw fail();
}
export async function writePrivateNew(file: string, bytes: Buffer, acl: WindowsPrivateAclVerifier): Promise<void> {
  if (bytes.length > 4096) throw fail();
  await createPrivateEntry(file, false, acl);
  const before = await lstat(file);
  const handle = await open(file, "r+");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== 0 || opened.dev !== before.dev || opened.ino !== before.ino) throw fail();
    await handle.writeFile(bytes); await handle.sync();
  } finally { await handle.close(); }
  await acl.verify(file);
  const check = await readPrivatePropertiesFile(file, 4096);
  try { if (!check.bytes.equals(bytes)) throw fail(); } finally { check.bytes.fill(0); }
}
export async function publishPrivateStage(stage: string, target: string): Promise<void> {
  if (path.dirname(stage) !== path.dirname(target)) throw fail();
  await execute(buildPrivatePublishScript(stage, target));
}
/** Atomic no-replace publication: an unexpectedly existing destination is never overwritten. */
export async function publishPrivateStageNew(stage: string, target: string): Promise<void> {
  if (path.dirname(stage) !== path.dirname(target)) throw fail();
  await execute(buildPrivatePublishNewScript(stage, target));
}
/** Identity/checksum before deleting only the writer's fixed private journal/stage. */
export async function deleteVerifiedPrivate(file: string, checksum: string, acl: WindowsPrivateAclVerifier): Promise<void> {
  await acl.verify(file); const actual = await readPrivatePropertiesFile(file, 4096);
  try { if (actual.checksum !== checksum) throw fail(); await unlink(file); }
  finally { actual.bytes.fill(0); }
}
