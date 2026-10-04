import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { backupScheduleResponseSchema, backupRetentionResponseSchema } from "@mcsm/contracts";
import { registerBackupScheduleRoutes } from "../src/routes/backup-schedules.js";
import { registerBackupRetentionRoutes } from "../src/routes/backup-retention.js";
import { installLocalRequestGuard, errorResponse } from "../src/infra/http.js";
import { DomainError } from "../src/services/domain-errors.js";
import type { BackupScheduleService } from "../src/services/backup-schedule-service.js";
import type { BackupRetentionService } from "../src/services/backup-retention-service.js";

const apps: ReturnType<typeof fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
function fixture() {
  const app = fastify(); apps.push(app); const clock = { now: () => new Date("2026-10-04T00:00:00.000Z") };
  app.addHook("onRequest", installLocalRequestGuard(clock, "local"));
  app.setErrorHandler((error, request, reply) => {
    const domain = error instanceof DomainError ? error : new DomainError(400, "VALIDATION_ERROR", "invalid");
    void reply.code(domain.statusCode).send(errorResponse(request.id, clock, domain.code, domain.safeMessage, "local"));
  });
  const schedule = { revision: "1".repeat(64), settings: { enabled: false, localTime: "02:00", timezone: "Asia/Shanghai", allowStop: false }, runs: [] };
  const retention = { revision: "2".repeat(64), settings: { enabled: false, retainCount: 10, retainDays: 7 }, lastRun: null };
  const scheduleService = { get: vi.fn(async () => schedule), update: vi.fn(async () => schedule) };
  const retentionService = { get: vi.fn(async () => retention), update: vi.fn(async () => retention), run: vi.fn(async () => retention) };
  registerBackupScheduleRoutes(app, scheduleService as unknown as BackupScheduleService, clock, "local");
  registerBackupRetentionRoutes(app, retentionService as unknown as BackupRetentionService, clock, "local");
  const headers = { host: "127.0.0.1:8080", origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui" };
  return { app, schedule, retention, scheduleService, retentionService, headers };
}
describe("backup policy HTTP contracts", () => {
  it.each(["backup-schedule", "backup-retention"])("GET %s follows frontend Value.Check and excludes private metadata", async (route) => {
    const f = fixture(); const reply = await f.app.inject({ url: `/api/v1/servers/test/${route}`, headers: f.headers });
    expect(reply.statusCode).toBe(200); expect(Value.Check(route === "backup-schedule" ? backupScheduleResponseSchema : backupRetentionResponseSchema, reply.json())).toBe(true);
    expect(reply.headers["cache-control"]).toBe("no-store"); expect(reply.body).not.toContain("rootIdentity");
  });
  it.each(["backup-schedule", "backup-retention"])("POST %s requires local intent and rejects raw coercion/extra paths", async (route) => {
    const f = fixture(), body = route === "backup-schedule" ? { revision: f.schedule.revision, settings: f.schedule.settings } : { revision: f.retention.revision, settings: f.retention.settings };
    const url = `/api/v1/servers/test/${route}`;
    expect((await f.app.inject({ method: "POST", url, headers: { host: f.headers.host }, payload: body })).statusCode).toBe(403);
    expect((await f.app.inject({ method: "POST", url, headers: f.headers, payload: { ...body, path: "C:/outside" } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "POST", url, headers: f.headers, payload: { ...body, settings: { ...body.settings, enabled: "true" } } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "POST", url, headers: f.headers, payload: body })).statusCode).toBe(200);
  });
  it("retention run requires the exact intent and revision, never accepts a delete path", async () => {
    const f = fixture(), url = "/api/v1/servers/test/backup-retention/run";
    for (const payload of [{ revision: f.retention.revision }, { revision: f.retention.revision, intent: "apply-backup-retention", paths: [] }]) {
      expect((await f.app.inject({ method: "POST", url, headers: f.headers, payload })).statusCode).toBe(400);
    }
    expect(f.retentionService.run).not.toHaveBeenCalled();
    const reply = await f.app.inject({ method: "POST", url, headers: f.headers, payload: { revision: f.retention.revision, intent: "apply-backup-retention" } });
    expect(reply.statusCode).toBe(200); expect(f.retentionService.run).toHaveBeenCalledWith("test", { revision: f.retention.revision, intent: "apply-backup-retention" });
  });
});
