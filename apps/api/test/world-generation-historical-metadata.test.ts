import { describe, expect, it } from "vitest";
import { inspectGenerationCompletion } from "../src/services/world-generation-completion.js";
import { inspectGenerationSlotIntent } from "../src/services/world-generation-slot.js";

const sha = "a".repeat(64), id = "11111111-1111-4111-8111-111111111111";
const file = { checksum: sha, identity: sha };
const completion = { schemaVersion: 1, phase: "generation-completion-evidence", serverId: "test", executionOperationId: id,
  preparationOperationId: "22222222-2222-4222-8222-222222222222", preparationTransactionId: id,
  worldId: `worldv2-${id}`, proofDigest: sha, catalogRevision: sha, recordDigest: sha, receiptDigest: sha,
  birth: file, slot: file, intent: file };
const intent = { schemaVersion: 1, phase: "generation-slot-cas", serverId: "test", executionOperationId: id,
  proofDigest: sha, directoryIdentity: sha, before: file, after: file };
const cases = [ { label: "completion", value: completion, parse: inspectGenerationCompletion },
  { label: "CAS intent", value: intent, parse: inspectGenerationSlotIntent } ];

describe.each(cases)("historical metadata parser $label", ({ value, parse }) => {
  it("preserves canonical input and returns a detached metadata copy", () => {
    const bytes = Buffer.from(JSON.stringify(value) + "\n"), original = Buffer.from(bytes);
    expect(parse(bytes)).toEqual(value); expect(bytes).toEqual(original);
    const parsed = parse(bytes); parsed.serverId = "changed";
    expect(parse(bytes).serverId).toBe("test");
  });
  it.each(["invalid-json", "invalid-utf8", "oversized", "unknown-version", "extra-field", "noncanonical"])("rejects %s", scenario => {
    const invalid = scenario === "invalid-json" ? Buffer.from("{") : scenario === "invalid-utf8" ? Buffer.from([255]) :
      scenario === "oversized" ? Buffer.alloc(4097) : scenario === "unknown-version" ? Buffer.from(JSON.stringify({ ...value, schemaVersion: 2 }) + "\n") :
      scenario === "extra-field" ? Buffer.from(JSON.stringify({ ...value, extra: "unexpected" }) + "\n") : Buffer.from(JSON.stringify(value));
    expect(() => parse(invalid)).toThrow(expect.objectContaining({ code: "RECOVERY_REQUIRED" }));
  });
});
