import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ManagerLifetimeLock } from "../../src/auth/manager-lifetime-lock.js";
import { createPrivateEntry } from "../../src/auth/private-publication.js";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";
import { siblingRetentionScript } from "./whitelist-sibling-retention.js";

const root = process.argv[2];
if (!root || !process.send) process.exit(2);
// Only a fresh controller-owned temporary fixture; no existing Manager/credential root.
if (root !== resolve(root) || basename(root) !== "manager" || !basename(dirname(root)).startsWith("mcsm-sibling-retention-") ||
  dirname(dirname(root)).toLowerCase() !== (await realpath(tmpdir())).toLowerCase()) process.exit(2);
process.once("disconnect", () => process.exit(1));
try {
  const owner = await ManagerLifetimeLock.acquire(root);
  owner.beginOfflineMutation(root); // Intentional death fixture: no early release.
  const acl = new WindowsPrivateAclVerifier(), target = join(root, "probe-target.json");
  await createPrivateEntry(target, false, acl);
  const fingerprint = await acl.verify(target);
  const script = owner.nativeAclChildWrapper(root)(siblingRetentionScript(target, fingerprint));
  if (script.length > 11000) throw new Error("RETENTION_SCRIPT_LIMIT");
  // Private Node IPC only. Never log/serialize this capability into public evidence.
  process.send!({ phase: "prepared", script });
  process.channel?.ref(); await new Promise<void>(() => {});
} catch {
  process.send!({ phase: "failed", code: "RETENTION_OWNER_PREPARATION_FAILED" });
  process.exitCode = 1; process.disconnect();
}
