import { describe, expect, it } from "vitest";
import { assessWorldCompatibility } from "../src/services/world-compatibility.js";

// Synthetic DataVersion values test policy, not the real 26.3 data-version mapping.
const source = { readable: true, version: "26.3", dataVersion: 100 };
const target = { serverType: "vanilla", version: "26.3", dataVersion: 100 };

describe("world compatibility observations", () => {
  it("accepts matching observations without claiming real loading", () => {
    expect(assessWorldCompatibility(source, target)).toEqual({ status: "compatible", findings: [], loadVerified: false });
  });
  it("blocks malformed metadata", () => {
    expect(assessWorldCompatibility({ ...source, readable: false }, target).findings).toEqual(["WORLD_METADATA_UNREADABLE"]);
  });
  it("blocks a demonstrably newer data version", () => {
    expect(assessWorldCompatibility({ ...source, dataVersion: 101 }, target).status).toBe("blocked");
  });
  it.each(["paper", "fabric", "forge", "neoforge"])("does not inherit Vanilla policy for %s", (serverType) => {
    expect(assessWorldCompatibility(source, { ...target, serverType }).status).toBe("unknown");
  });
  it.each(["26.2", "26.4", "future"])("does not authorize implicit version conversion: %s", (version) => {
    expect(assessWorldCompatibility({ ...source, version }, target).status).toBe("unknown");
  });
  it.each([null, NaN, -1, 1.5])("keeps missing or invalid data version unknown: %s", (dataVersion) => {
    expect(assessWorldCompatibility({ ...source, dataVersion }, target).status).toBe("unknown");
  });
  it("does not guess when version names disagree with the numeric observation", () => {
    expect(assessWorldCompatibility({ ...source, dataVersion: 99 }, target).status).toBe("unknown");
  });
});
