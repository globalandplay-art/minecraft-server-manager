import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildPrivateCreateScript, buildPrivatePublishNewScript, buildPrivatePublishScript } from "../../src/auth/private-publication-scripts.js";
import { nativePathData } from "../../src/auth/windows-native.js";

interface Case { kind: "create-file" | "create-directory" | "publish-new" | "publish-replace"; file: string; target?: string; sha256: string }
const baseline = JSON.parse(readFileSync(new URL("../fixtures/private-publication-script-baseline.json", import.meta.url), "utf8")) as { cases: Case[] };
it("retains the sixteen pre-extraction synthetic cases", () => { expect(baseline.cases).toHaveLength(16); });
it.each(baseline.cases)("preserves legacy $kind script for $file", (row) => {
  const script = row.kind === "create-file" ? buildPrivateCreateScript(row.file, false) :
    row.kind === "create-directory" ? buildPrivateCreateScript(row.file, true) :
      row.kind === "publish-new" ? buildPrivatePublishNewScript(row.file, row.target!) : buildPrivatePublishScript(row.file, row.target!);
  // Git checkout newline conversion is independent of the raw before/after capture receipt.
  expect(createHash("sha256").update(script.replaceAll("\r\n", "\n")).digest("hex")).toBe(row.sha256);
  expect(script).toContain(nativePathData(row.file));
  if (row.target) expect(script).toContain(nativePathData(row.target));
});
