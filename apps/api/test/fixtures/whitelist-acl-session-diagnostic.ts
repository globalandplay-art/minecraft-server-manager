import { lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrototypeAclSession, AclSessionError } from "./whitelist-acl-session.js";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";

// Read-only inspection of a previously retained, explicitly synthetic prototype fixture.
const root = process.argv[2];
const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
let files: string[];
try {
  if (!root || path.basename(root) !== "manager" || !path.basename(path.dirname(root)).startsWith("mcsm-acl-prototype-") ||
    !normalize(path.resolve(root)).startsWith(normalize(path.resolve(tmpdir()) + path.sep)) ||
    normalize(await realpath(root)) !== normalize(path.resolve(root))) throw new Error();
  files = [path.join(root, "protected"), path.join(root, "protected", "fixture.json")];
  for (const [index, file] of files.entries()) {
    const info = await lstat(file);
    if (info.isSymbolicLink() || (index === 0 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) ||
      normalize(await realpath(file)) !== normalize(file)) throw new Error();
  }
} catch {
  console.log(JSON.stringify({ result: "BLOCKED", reason: "boundary", close: "NOT_STARTED" })); process.exit(1);
}
const session = new PrototypeAclSession();
let result = "PASS", reason = "none", close = "UNKNOWN";
try { const rows = await session.query(files); const verifier = new WindowsPrivateAclVerifier(); rows.forEach((row) => verifier.verifyNativeSnapshot(row)); }
catch (error) { result = "BLOCKED"; reason = error instanceof AclSessionError ? error.reason : "acl-verification"; }
finally {
  try { await session.close(); close = session.closedConfirmed ? "CONFIRMED" : "UNKNOWN"; }
  catch { close = session.closedConfirmed ? "CONFIRMED_WITH_FAILURE" : "CLEANUP_BLOCKED"; }
}
console.log(JSON.stringify({ result, reason, close, ...session.diagnostic }));
process.exitCode = result === "PASS" && close === "CONFIRMED" ? 0 : 1;
