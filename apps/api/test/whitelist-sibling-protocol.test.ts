import { expect, it } from "vitest";
import { SiblingRetentionFrames, siblingRetentionScript } from "./fixtures/whitelist-sibling-retention.js";

const encode = (row: unknown) => Buffer.from(JSON.stringify(row) + "\n");
const valid = [{ phase: "ready", verified: true }, { phase: "accepted-before-inspection" }, { phase: "done", verified: true }];
it("requires the complete verified before/accepted/verified after sequence, across split chunks", () => {
  const f = new SiblingRetentionFrames(), bytes = Buffer.concat(valid.map(encode));
  f.push(bytes.subarray(0, 11)); f.push(bytes.subarray(11)); f.finish();
  expect(f.fault).toBe(false); expect(f.phase).toBe(3);
});
it.each([
  [valid[1]], [valid[0], valid[0]], [valid[0], valid[2]],
  [{ phase: "ready", verified: false }], [{ phase: "ready", verified: true, secret: "SENTINEL" }],
  [...valid, valid[2]], [null], [[]]
])("rejects unknown fields, duplication, omission or unverified results %j", (...rows) => {
  const f = new SiblingRetentionFrames(); for (const row of rows) f.push(encode(row)); f.finish(); expect(f.fault).toBe(true);
});
it("rejects oversized, malformed UTF8 and incomplete metadata", () => {
  for (const bytes of [Buffer.alloc(4097, 65), Buffer.from([255, 10]), Buffer.from("{")]) {
    const f = new SiblingRetentionFrames(); f.push(bytes); f.finish(); expect(f.fault).toBe(true);
  }
});
it("does not construct a helper for a malformed expected fingerprint", () => {
  expect(() => siblingRetentionScript("C:\\fixture", "bad")).toThrow("RETENTION_FIXTURE_INPUT");
});
