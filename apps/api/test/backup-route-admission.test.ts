import fastify from "fastify";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { registerBackupRoutes } from "../src/routes/backups.js";
import type { BackupService } from "../src/services/backup-service.js";
import type { BackupExportService } from "../src/services/backup-export-service.js";
import type { OperationAdmission } from "../src/services/operation-service.js";
import { DomainError } from "../src/services/domain-errors.js";
import { errorResponse } from "../src/infra/http.js";
const clock = { now: () => new Date("2026-10-14T00:00:00Z") };
it.each(["backup", "export"] as const)("forwards a request-bound final admission for %s", async kind => {
  const app = fastify(); let valid = true;
  const auth = { assertMutation: vi.fn(() => { if (!valid) throw new DomainError(401, "AUTH_REQUIRED", "Authentication required"); }) };
  const denied = async (admission?: OperationAdmission) => { await Promise.resolve(); valid = false; admission?.(); throw new Error("missing-admission"); };
  const create = vi.fn(async (_server: string, _body: unknown, _key: string, _origin: string, _preflight: unknown, admission?: OperationAdmission) => denied(admission));
  const request = vi.fn(async (_server: string, _backup: string, _key: string, admission?: OperationAdmission) => denied(admission));
  registerBackupRoutes(app, { create } as unknown as BackupService, clock, "mock",
    { request } as unknown as BackupExportService, auth);
  app.setErrorHandler((error, req, reply) => { const domain = error instanceof DomainError ? error : undefined;
    void reply.code(domain?.statusCode ?? 500).send(errorResponse(req.id, clock, domain?.code ?? "INTERNAL_ERROR", "Request denied", "mock")); });
  try {
    const response = await app.inject({ method: "POST", url: kind === "backup" ? "/api/v1/servers/test/backups" : `/api/v1/servers/test/backups/${randomUUID()}/exports`,
      headers: { origin: "http://127.0.0.1:3000", "x-manager-intent": "local-ui", "idempotency-key": randomUUID() }, payload: kind === "backup" ? { scope: "world-set", allowStop: false } : {} });
    expect(response.statusCode).toBe(401); expect(response.json().error.code).toBe("AUTH_REQUIRED");
    expect(auth.assertMutation).toHaveBeenCalledOnce();
    expect(kind === "backup" ? create : request).toHaveBeenCalledOnce();
    expect(kind === "backup" ? request : create).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
