import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrivateAuthAudit } from "../../src/auth/audit.js";
import { createPrivateEntry } from "../../src/auth/private-publication.js";
import { WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";
describe.skipIf(process.platform !== "win32")("native private audit publication", () => {
  it("creates protected ring files, verifies native ACLs and persists bounded secret-free events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcsm-native-audit-")); const acl = new WindowsPrivateAclVerifier();
    try {
      await createPrivateEntry(path.join(root, "auth"), true, acl);
      const audit = await PrivateAuthAudit.open(root, acl);
      try { await audit.record({ event: "login-success", requestId: randomUUID() }); }
      finally { await audit.close(); }
      const bytes = await readFile(path.join(root, "auth", "audit.0.jsonl"), "utf8");
      expect(JSON.parse(bytes).event).toBe("login-success"); expect(bytes).not.toContain(root);
      for (let i = 0; i < 3; i++) expect(await acl.verify(path.join(root, "auth", `audit.${i}.jsonl`))).toHaveLength(64);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000);
});
