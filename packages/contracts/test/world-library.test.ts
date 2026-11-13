import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { worldLibraryEntrySchema, worldActivationApprovalSchema, worldActivationPlanRequestSchema,
  worldReplacementApprovalSchema, worldReplacementPlanRequestSchema, worldReplacementPlanResponseSchema,
  worldReplacementVerificationRequestSchema } from "../src/index.js";

const entry = { worldId: "worldv2-12345678-1234-4123-8123-123456789012", levelName: "world",
  state: "present", origin: "legacy-observation", createdAt: "2026-10-25T08:00:00.000Z",
  legacySlotId: "world-" + "a".repeat(24), legacyBackupAssociation: "unverified" };
describe("world library identity contract", () => {
  it("describes generated UUIDs without claiming a legacy backup association", () => {
    expect(Value.Check(worldLibraryEntrySchema, { ...entry, origin: "generation", legacySlotId: null })).toBe(true);
    expect(Value.Check(worldLibraryEntrySchema, { ...entry, origin: "generated-anything" })).toBe(false);
  });
  it("requires exact replacement approvals without paths or permission overrides", () => {
    const approval = { uploadId: "12345678-1234-4123-8123-123456789012", uploadRevision: "a".repeat(64),
      libraryRevision: "b".repeat(64), currentWorldId: entry.worldId, currentWorldRevision: "c".repeat(64),
      currentContentRevision: "d".repeat(64), propertiesRevision: "e".repeat(64), confirmWorldName: "world" };
    expect(Value.Check(worldReplacementApprovalSchema, approval)).toBe(true);
    for (const field of Object.keys(approval)) {
      const incomplete = { ...approval } as Record<string, unknown>; delete incomplete[field];
      expect(Value.Check(worldReplacementApprovalSchema, incomplete)).toBe(false);
    }
    for (const extra of [{ targetPath: "outside" }, { allowStop: true }, { skipBackup: true },
      { worldId: entry.worldId }, { recoveryProof: {} }, { executionAvailable: true }]) {
      expect(Value.Check(worldReplacementApprovalSchema, { ...approval, ...extra })).toBe(false);
    }
    for (const bad of [{ uploadId: "../world" }, { currentWorldId: "world" }, { uploadRevision: "old" },
      { libraryRevision: "A".repeat(64) }, { currentWorldRevision: "" }, { currentContentRevision: 1 },
      { propertiesRevision: null }, { confirmWorldName: "" }, { confirmWorldName: "x".repeat(129) }]) {
      expect(Value.Check(worldReplacementApprovalSchema, { ...approval, ...bad })).toBe(false);
    }
    expect(worldReplacementPlanResponseSchema.properties.data.properties.executionAvailable.type).toBe("boolean");
  });
  it("restricts replacement preview to an upload identity and forbids executable success claims", () => {
    const uploadId = "12345678-1234-4123-8123-123456789012";
    expect(Value.Check(worldReplacementPlanRequestSchema, { uploadId })).toBe(true);
    for (const extra of [{ path: "outside" }, { name: "world" }, { allowStop: true }]) {
      expect(Value.Check(worldReplacementPlanRequestSchema, { uploadId, ...extra })).toBe(false);
    }
    expect(worldReplacementPlanResponseSchema.properties.data.properties.executionAvailable.type).toBe("boolean");
    expect(worldReplacementPlanResponseSchema.properties.data.properties.requiresProtectedBackup.const).toBe(true);
  });
  it("limits explicit replacement verification to one operation and fixed intent", () => {
    const request = { operationId: "12345678-1234-4123-8123-123456789012", intent: "confirm-current-state" };
    expect(Value.Check(worldReplacementVerificationRequestSchema, request)).toBe(true);
    for (const bad of [{ ...request, intent: "retry" }, { ...request, operationId: "../world" },
      { ...request, proof: {} }, { operationId: request.operationId }, { ...request, replay: true }]) {
      expect(Value.Check(worldReplacementVerificationRequestSchema, bad)).toBe(false);
    }
  });
  it("restricts activation to opaque world identity and exact revision approval fields", () => {
    const value = { worldId: entry.worldId, currentWorldId: "worldv2-12345678-1234-4123-8123-123456789013",
      libraryRevision: "a".repeat(64), currentWorldRevision: "b".repeat(64), targetWorldRevision: "c".repeat(64),
      currentContentRevision: "d".repeat(64), targetContentRevision: "e".repeat(64), propertiesRevision: "f".repeat(64), confirmWorldName: "Imported" };
    expect(Value.Check(worldActivationApprovalSchema, value)).toBe(true);
    expect(Value.Check(worldActivationPlanRequestSchema, { worldId: entry.worldId })).toBe(true);
    for (const bad of [{ ...value, targetPath: "untrusted" }, { ...value, allowStop: true }, { ...value, confirmWorldName: "" },
      { ...value, libraryRevision: "old" }, { ...value, worldId: "world" }]) expect(Value.Check(worldActivationApprovalSchema, bad)).toBe(false);
  });
  it("keeps opaque identity separate from legacy slots", () => {
    expect(Value.Check(worldLibraryEntrySchema, entry)).toBe(true);
    expect(Value.Check(worldLibraryEntrySchema, { ...entry, worldId: entry.legacySlotId })).toBe(false);
  });
  it("rejects private metadata and claims of proven legacy association", () => {
    expect(Value.Check(worldLibraryEntrySchema, { ...entry, directoryIdentity: "a".repeat(64) })).toBe(false);
    expect(Value.Check(worldLibraryEntrySchema, { ...entry, legacyBackupAssociation: "verified" })).toBe(false);
  });
});
