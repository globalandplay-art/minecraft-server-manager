import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  actionAvailabilitySchema,
  crashAnalysisResponseSchema,
  healthResponseSchema,
  numberMetricSchema,
  worldInfoSchema,
  worldImportUploadResponseSchema,
  worldImportUploadsResponseSchema
} from "../src/index.js";

describe("shared contract invariants", () => {
  it("bounds crash evidence fields and rejects paths, certainty and oversized output", () => {
    const payload = { data: { status: "available", reason: null, sampledAt: "2026-10-08T00:00:00Z", minimumIntervalMs: 5000,
      incomplete: false, conclusion: "possible-causes", sources: [], limitations: [],
      findings: [{ code: "out-of-memory", confidence: "possible", title: "possible", guidance: "check evidence",
        evidence: [{ sourceId: "latest-log", excerptLine: 1, snippet: "OutOfMemoryError" }] }] },
      meta: { mode: "local", requestId: "test", generatedAt: "2026-10-08T00:00:00Z" } };
    expect(Value.Check(crashAnalysisResponseSchema, payload)).toBe(true);
    expect(Value.Check(crashAnalysisResponseSchema, { ...payload, data: { ...payload.data, root: "C:/secret" } })).toBe(false);
    const finding = payload.data.findings[0]!;
    expect(Value.Check(crashAnalysisResponseSchema, { ...payload, data: { ...payload.data, findings: [{ ...finding, confidence: "certain" }] } })).toBe(false);
    expect(Value.Check(crashAnalysisResponseSchema, { ...payload, data: { ...payload.data, findings: [{ ...finding,
      evidence: [{ sourceId: "latest-log", excerptLine: 1, snippet: "x".repeat(1001) }] }] } })).toBe(false);
  });
  it("validates staging lifecycle timestamps in browser Value.Check without a format registry",() => {
    const item = { id:"5babd7fe-c96b-4938-917d-01def3ab4d80",state:"validated",discardAllowed:true,revision:"a".repeat(64),lifecycle:"validated",expiresAt:"2026-10-11T00:00:00.000Z" };
    const payload = { data:{ items:[item],occupiedSlots:1,limit:3 },meta:{ requestId:"test",generatedAt:"2026-10-04T00:00:00Z",mode:"local" } };
    expect(Value.Check(worldImportUploadsResponseSchema,payload)).toBe(true);
    for (const expiresAt of ["not-a-date","2026-99-99T99:99:99.000Z","2026-10-11T00:00:00Z"]) {
      expect(Value.Check(worldImportUploadsResponseSchema,{ ...payload,data:{ ...payload.data,items:[{ ...item,expiresAt }] } })).toBe(false);
    }
  });
  it("validates an upload result in browser Value.Check without a format registry", () => {
    const payload = { data: { id: "5babd7fe-c96b-4938-917d-01def3ab4d80", serverId: "test", minecraftVersion: "26.3",
      fileCount: 1, sizeBytes: 100, checksumSha256: "a".repeat(64), state: "validated", executionAvailable: false },
      meta: { requestId: "test", generatedAt: "2026-10-02T00:00:00Z", mode: "local" } };
    expect(Value.Check(worldImportUploadResponseSchema, payload)).toBe(true);
    expect(Value.Check(worldImportUploadResponseSchema, { ...payload, data: { ...payload.data, id: "../escape" } })).toBe(false);
    expect(Value.Check(worldImportUploadResponseSchema, { ...payload, data: { ...payload.data, executionAvailable: true } })).toBe(false);
  });
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
