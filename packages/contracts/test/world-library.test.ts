import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { worldLibraryEntrySchema } from "../src/index.js";

const entry = { worldId: "worldv2-12345678-1234-4123-8123-123456789012", levelName: "world",
  state: "present", origin: "legacy-observation", createdAt: "2026-10-25T08:00:00.000Z",
  legacySlotId: "world-" + "a".repeat(24), legacyBackupAssociation: "unverified" };
describe("world library identity contract", () => {
  it("keeps opaque identity separate from legacy slots", () => {
    expect(Value.Check(worldLibraryEntrySchema, entry)).toBe(true);
    expect(Value.Check(worldLibraryEntrySchema, { ...entry, worldId: entry.legacySlotId })).toBe(false);
  });
  it("rejects private metadata and claims of proven legacy association", () => {
    expect(Value.Check(worldLibraryEntrySchema, { ...entry, directoryIdentity: "a".repeat(64) })).toBe(false);
    expect(Value.Check(worldLibraryEntrySchema, { ...entry, legacyBackupAssociation: "verified" })).toBe(false);
  });
});
