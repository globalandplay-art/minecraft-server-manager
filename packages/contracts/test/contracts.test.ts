import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  actionAvailabilitySchema,
  healthResponseSchema,
  numberMetricSchema,
  worldInfoSchema
} from "../src/index.js";

describe("shared contract invariants", () => {
  it("ties allowed actions to a null reason and denied actions to a reason", () => {
    expect(Value.Check(actionAvailabilitySchema, { allowed: true, reason: null })).toBe(true);
    expect(Value.Check(actionAvailabilitySchema, { allowed: false, reason: "mock-mode" })).toBe(true);
    expect(Value.Check(actionAvailabilitySchema, { allowed: true, reason: "mock-mode" })).toBe(false);
    expect(Value.Check(actionAvailabilitySchema, { allowed: false, reason: null })).toBe(false);
  });

  it("rejects negative metric sentinels and requires null for unavailable values", () => {
    expect(
      Value.Check(numberMetricSchema, {
        status: "available",
        value: -1,
        source: "mock",
        sampledAt: "2026-09-27T00:00:00.000Z"
      })
    ).toBe(false);
    expect(
      Value.Check(numberMetricSchema, {
        status: "unavailable",
        value: -1,
        source: null,
        sampledAt: null,
        reason: "not-collected"
      })
    ).toBe(false);
  });

  it("rejects properties outside the response allowlist", () => {
    expect(
      Value.Check(healthResponseSchema, {
        data: {
          status: "ok",
          apiVersion: "1",
          features: {},
          secret: "must-not-pass"
        },
        meta: {
          requestId: "request-1",
          generatedAt: "2026-09-27T00:00:00.000Z",
          mode: "mock"
        }
      })
    ).toBe(false);
  });

  it("keeps world seeds as exact decimal strings and excludes filesystem paths", () => {
    const sampledAt = "2026-09-28T00:00:00.000Z";
    const available = <T>(value: T) => ({
      status: "available" as const,
      value,
      source: "filesystem" as const,
      sampledAt
    });
    const world = {
      worldId: "world-1234",
      active: true,
      dimensions: [{ id: "minecraft:overworld", kind: "overworld" }],
      name: available("world"),
      seed: available("-9223372036854775808"),
      minecraftVersion: available("26.3"),
      sizeBytes: available(1024),
      difficulty: available("normal"),
      gameMode: available("survival"),
      hardcore: available(false),
      pvp: available(true),
      viewDistance: available(10),
      simulationDistance: available(10),
      fieldSources: {
        name: "server-properties",
        seed: "level-dat",
        minecraftVersion: "level-dat",
        sizeBytes: "filesystem",
        difficulty: "level-dat",
        gameMode: "level-dat",
        hardcore: "level-dat",
        pvp: "server-properties",
        viewDistance: "server-properties",
        simulationDistance: "server-properties"
      }
    };

    expect(Value.Check(worldInfoSchema, world)).toBe(true);
    expect(Value.Check(worldInfoSchema, { ...world, seed: available(-1) })).toBe(false);
    expect(Value.Check(worldInfoSchema, { ...world, serverRoot: "C:\\private\\world" })).toBe(false);
  });
});
