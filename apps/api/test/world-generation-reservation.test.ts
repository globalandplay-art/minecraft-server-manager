import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classifyWorldGenerationObservation, proposeWorldGenerationReservation, readWorldGenerationReservation } from "../src/services/world-generation-reservation.js";

function proposal() {
  return proposeWorldGenerationReservation({ serverId: "generation-test", operationId: randomUUID(), transactionId: randomUUID(),
    previousWorldId: `worldv2-${randomUUID()}`, catalogId: randomUUID(), catalogRevision: "1".repeat(64), rootIdentity: "2".repeat(64),
    previousName: "world", nextName: "NewWorld", propertiesBefore: "3".repeat(64), propertiesAfter: "4".repeat(64),
    activeStateRevision: "5".repeat(64), guardBackupId: randomUUID() });
}
describe("unmounted world generation identity reservation", () => {
  it("allocates distinct identities for the same target name and preserves the old UUID", () => {
    const first = proposal(), second = proposeWorldGenerationReservation(first);
    expect(second.worldId).not.toBe(first.worldId); expect(second.previousWorldId).toBe(first.previousWorldId);
    expect(first).not.toHaveProperty("directoryIdentity");
    const parsed = readWorldGenerationReservation(JSON.parse(JSON.stringify(first)));
    expect(parsed).toEqual(first); parsed.nextName = "Other"; expect(first.nextName).toBe("NewWorld");
  });
  it.each(["directoryIdentity", "path", "completedAt"])("rejects unproven or arbitrary %s metadata", key => {
    expect(() => readWorldGenerationReservation({ ...proposal(), [key]: "untrusted" })).toThrow();
  });
  it.each(["../world", "WORLD", "con", "world/child"])("rejects unsafe or reused target %s", nextName => {
    expect(() => readWorldGenerationReservation({ ...proposal(), nextName })).toThrow();
  });
  it("rejects reused UUID, unchanged properties and unknown record versions", () => {
    const p = proposal();
    for (const delta of [{ worldId: p.previousWorldId }, { propertiesAfter: p.propertiesBefore }, { schemaVersion: 2 }]) {
      expect(() => readWorldGenerationReservation({ ...p, ...delta })).toThrow();
    }
  });
  it("never promotes a level.dat observation to accepted birth or success", () => {
    const p = proposal(), observation = { serverId: p.serverId, worldId: p.worldId, transactionId: p.transactionId,
      propertiesRevision: p.propertiesAfter, activeName: p.nextName, target: "absent" as const };
    expect(classifyWorldGenerationObservation(p, observation)).toBe("awaiting-explicit-start");
    expect(classifyWorldGenerationObservation(p, { ...observation, target: "level-data-present" })).toBe("birth-verification-required");
    for (const target of ["partial", "unsafe"] as const) expect(classifyWorldGenerationObservation(p, { ...observation, target })).toBe("inspection-required");
    for (const delta of [{ worldId: `worldv2-${randomUUID()}` }, { transactionId: randomUUID() }, { serverId: "other" },
      { propertiesRevision: "0".repeat(64) }, { activeName: "other" }]) {
      expect(classifyWorldGenerationObservation(p, { ...observation, ...delta })).toBe("inspection-required");
    }
  });
});
