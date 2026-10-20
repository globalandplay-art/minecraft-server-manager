import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { compiledAclWorkerSource } from "../../src/auth/windows-compiled-acl-worker-source.js";
import { WINDOWS_OWNER_RETENTION_NATIVE } from "../../src/auth/windows-owner-retention-native.js";
import { wrapWithNativeOwnerRetention } from "../../src/auth/windows-owner-retention.js";

// Source composition invariants only. These do not compile C#, observe native
// handles, prove ACL parity or make the program safe to run.
it("composes only fixed source while preserving the original owner implementation", () => {
  const source = compiledAclWorkerSource();
  const expected = WINDOWS_OWNER_RETENTION_NATIVE.replace("public static class WhitelistOwnerRetention {", "public static partial class WhitelistOwnerRetention {");
  expect(source.startsWith(expected)).toBe(true);
  expect(source.match(/public static partial class WhitelistOwnerRetention \{/gu)).toHaveLength(2);
  expect(source.match(/public static int Main\(string\[\] args\)/gu)).toHaveLength(1);
  expect(compiledAclWorkerSource()).toBe(source);
  expect(createHash("sha256").update(WINDOWS_OWNER_RETENTION_NATIVE).digest("hex"))
    .toBe("fc4cee0f4b50a879885dd6f536949ae90b268cf710f13239f7c4018bb15bcca6");
});

it("does not change current owner wrapper source or enable a compiled transport", () => {
  const script = wrapWithNativeOwnerRetention("# source-only", {
    root: "C:\\synthetic-worker-source", nodePid: 123, directoryHandle: "10", fileHandle: "11",
    directoryIdentity: "A".repeat(40), fileIdentity: "B".repeat(40), processIdentity: "C".repeat(16)
  });
  expect(script).toContain(WINDOWS_OWNER_RETENTION_NATIVE);
  expect(script).not.toContain("RetainInherited");
  expect(script).not.toContain("WhitelistAclWorker");
  expect(script.endsWith("# source-only")).toBe(true);
});

it("keeps inherited retention and pin checks before readiness/query dispatch in fixed source", () => {
  const source = compiledAclWorkerSource();
  expect(source.indexOf("RetainInherited(root,pid")).toBeLessThan(source.indexOf("ValidateInheritedPin(handle,current"));
  expect(source.indexOf("var bootstrap=Bootstrap(first)")).toBeLessThan(source.indexOf("Emit(output,ready,4096)"));
  expect(source.indexOf("Emit(output,ready,4096)")).toBeLessThan(source.indexOf("snapshots.Add(Snapshot(target))"));
  expect(source).toContain('Utf8.GetBytes(Canonical(value)+"\\n")');
  expect(source).not.toContain("Console.Error");
  expect(source).not.toContain("Console.WriteLine");
});

it("uses explicit hex characters and a Node-compatible encoder instead of framework HTML escaping", () => {
  const source = compiledAclWorkerSource();
  const method = source.slice(source.indexOf("static bool Hex("), source.indexOf("static long Handle("));
  expect(method).not.toContain("Regex");
  expect(method).toContain("foreach(char c in text)");
  expect(source).not.toContain("Json.Serialize(");
  expect(source).toContain("Char.IsHighSurrogate(c)");
  expect(source).toContain("Check(Canonical(value)==text)");
});
