import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { Writable } from "node:stream";
import { expect, it } from "vitest";
import { PRIVATE_ACL_INSPECT_SCRIPT } from "../src/auth/windows-private-acl.js";
import { aclSessionScript, PrototypeAclSession, type OwnedAclChild } from "./fixtures/whitelist-acl-session.js";

function inertChild() {
  const script = aclSessionScript.replace(PRIVATE_ACL_INSPECT_SCRIPT,
    "function Read-AuthPrivateAcl([string]$target) { @{fixture=$target} }");
  expect(script).not.toBe(aclSessionScript);
  return spawn(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}

// Actual Windows PowerShell parser/pipe regression, with NO filesystem or ACL access.
// Only the inspector body is replaced; framing, parsing and fail-closed transport stay real.
it.skipIf(process.platform !== "win32")("preserves one/two/eight JSON targets through the actual PowerShell parser and pipe", async () => {
  const session = new PrototypeAclSession(inertChild);
  try {
    for (const count of [1, 2, 8]) {
      const sentinels = Array.from({ length: count }, (_, index) => `fixed-sentinel-${index}`);
      await expect(session.query(sentinels)).resolves.toEqual(sentinels.map((fixture) => ({ fixture })));
    }
    expect(session.diagnostic.protocolLocation).toBe(null);
  } finally { await session.close(); }
  expect(session.closedConfirmed).toBe(true);
}, 15_000);

it.skipIf(process.platform !== "win32").each([
  { label: "scalar", value: "fixed-sentinel" }, { label: "null", value: null },
  { label: "empty", value: [] }, { label: "nested", value: [["fixed-sentinel"]] },
  { label: "too-many", value: Array.from({ length: 9 }, () => "fixed-sentinel") },
])("rejects $label targets inside the actual script without filesystem access", async ({ value }) => {
  const session = new PrototypeAclSession(() => {
    const child = inertChild();
    const proxy = Object.assign(new EventEmitter(), {
      pid: child.pid, stdout: child.stdout, stderr: child.stderr, kill: () => child.kill(),
      stdin: new Writable({ write: (chunk: Buffer, _encoding, callback) => {
        const frame = JSON.parse(chunk.toString("utf8")) as { paths: string };
        frame.paths = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
        child.stdin.write(JSON.stringify(frame) + "\n", callback);
      }, final: (callback) => { child.stdin.end(callback); } }),
    }) satisfies OwnedAclChild;
    child.on("error", () => proxy.emit("error"));
    child.on("close", (code, signal) => proxy.emit("close", code, signal));
    child.stdin.on("error", () => proxy.stdin.destroy(new Error("fixed-pipe-failure")));
    return proxy;
  });
  let closeError: unknown;
  try { await expect(session.query(["fixed-sentinel"])).rejects.toMatchObject({ code: "ACL_SESSION_UNSAFE", reason: "closed" }); }
  finally { try { await session.close(); } catch (error) { closeError = error; } }
  expect(closeError).toMatchObject({ code: "ACL_SESSION_UNSAFE", reason: "closed" });
  expect(session.closedConfirmed).toBe(true);
}, 15_000);
