import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  actionAvailabilitySchema,
  healthResponseSchema,
  numberMetricSchema
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
});
