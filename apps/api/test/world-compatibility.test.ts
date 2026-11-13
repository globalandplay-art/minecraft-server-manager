import { describe, expect, it } from "vitest";
import { assessWorldCompatibility, supportsVanillaWorldLayout } from "../src/services/world-compatibility.js";

// Synthetic DataVersion values test policy, not the real 26.3 data-version mapping.
const source = { readable: true, version: "26.3", dataVersion: 100 };
const target = { serverType: "vanilla", version: "26.3", dataVersion: 100 };

describe("world compatibility observations", () => {
  const observed = { readable: true, version: "26.3", dataVersion: 5023 };
  const standard = ["level.dat", "data/minecraft/game_rules.dat", "dimensions/minecraft/overworld/region/r.0.0.mca",
    "dimensions/minecraft/the_nether/data/minecraft/raids.dat", "dimensions/minecraft/the_end/data/minecraft/ender_dragon_fight.dat"].map(path => ({ path }));
  it("allows the three observed 26.3/5023 standard dimension roots", () => {
    expect(supportsVanillaWorldLayout(standard, observed)).toBe(true);
    expect(supportsVanillaWorldLayout([{ path: "level.dat" }, { path: "region/r.0.0.mca" }], source)).toBe(true);
  });
  it.each(["dimensions/modded/overworld/region/r.0.0.mca", "dimensions/minecraft/custom/region/r.0.0.mca",
    "dimensions/minecraft/the_nether_extra/data/test.dat", "dimensions/minecraft/overworld", "dimensions/other.dat",
    "Dimensions/minecraft/overworld/region/r.0.0.mca", "dimensions/Minecraft/overworld/region/r.0.0.mca",
    "dimensions/minecraft/Overworld/region/r.0.0.mca"])("rejects an unknown dimension path: %s", path => {
    expect(supportsVanillaWorldLayout([...standard, { path }], observed)).toBe(false);
  });
  it.each([5022, 5024, 100, null, NaN, -1, 5023.5])("does not extend namespaced storage to unverified DataVersion %s", dataVersion => {
    expect(supportsVanillaWorldLayout(standard, { ...observed, dataVersion })).toBe(false);
  });
  it.each(["26.2", "26.4", null])("does not extend namespaced storage to version %s", version => {
    expect(supportsVanillaWorldLayout(standard, { ...observed, version })).toBe(false);
  });
  it.each(["region/r.0.0.mca", "entities/r.0.0.mca", "poi/r.0.0.mca", "DIM-1/region/r.0.0.mca", "DIM1/region/r.0.0.mca", "Region/r.0.0.mca"])("rejects mixed storage with %s", path => {
    expect(supportsVanillaWorldLayout([...standard, { path }], observed)).toBe(false);
  });
  it("does not authorize an unreadable layout observation", () => {
    expect(supportsVanillaWorldLayout(standard, { ...observed, readable: false })).toBe(false);
  });
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
