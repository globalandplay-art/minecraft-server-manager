import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertGenerationProperties, captureGenerationProperties } from "../src/services/world-generation-properties.js";
const before = "#Minecraft server properties\n#Wed Oct 28 21:36:46 CST 2026\nlevel-name=NewWorld\ncustom-key=keep\n";
const after = before.replace("21:36:46", "21:37:08");
function file(text: string, identity = "same-file") {
  const bytes = Buffer.from(text); return { bytes, identity, checksum: createHash("sha256").update(bytes).digest("hex") };
}
describe("owned-stop Java generated timestamp compatibility", () => {
  it("accepts only the generated second-line timestamp with the captured same-file baseline", () => {
    const original = file(before), proof = captureGenerationProperties(original);
    expect(() => assertGenerationProperties(file(after), original.checksum)).toThrow();
    expect(() => assertGenerationProperties(file(after), original.checksum, proof)).not.toThrow();
    expect(() => assertGenerationProperties(original, original.checksum)).not.toThrow();
  });
  it.each([
    after.replace("NewWorld", "Other"), after.replace("keep", "changed"), after + "#other\n",
    after.replace("#Minecraft server properties", "#different header"), after.replaceAll("\n", "\r\n"),
    after.replace("level-name=NewWorld\ncustom-key=keep", "custom-key=keep\nlevel-name=NewWorld"),
    after.replace("#Wed Oct 28 21:37:08 CST 2026", "#arbitrary"), after.replace("21:37:08", "99:37:08")
  ])("rejects every change outside the fixed generated timestamp", changed => {
    const original = file(before); expect(() => assertGenerationProperties(file(changed), original.checksum, captureGenerationProperties(original))).toThrow();
  });
  it("rejects replacement identity and a proof for another original checksum", () => {
    const original = file(before), proof = captureGenerationProperties(original);
    expect(() => assertGenerationProperties(file(after, "replacement"), original.checksum, proof)).toThrow();
    expect(() => assertGenerationProperties(file(after), "0".repeat(64), proof)).toThrow();
  });
  it("does not infer a timestamp exception for unknown header layouts", () => {
    const original = file("level-name=NewWorld\n#Wed Oct 28 21:36:46 CST 2026\n");
    expect(captureGenerationProperties(original).timestampDigest).toBeNull();
    expect(() => assertGenerationProperties(file(after), original.checksum, captureGenerationProperties(original))).toThrow();
  });
});
