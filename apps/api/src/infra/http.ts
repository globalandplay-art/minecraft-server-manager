import type { ApiErrorResponse, Mode, ResponseMeta } from "@mcsm/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { Clock } from "../clock.js";

const ALLOWED_HOSTS = new Set(["127.0.0.1:8080", "localhost:8080"]);
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://localhost:8080"
]);
const FORWARDED_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto"
] as const;

export function responseMeta(requestId: string, clock: Clock, mode: Mode = "mock"): ResponseMeta {
  return { requestId, generatedAt: clock.now().toISOString(), mode };
}

export function errorResponse(
  requestId: string,
  clock: Clock,
  code: string,
  message: string,
  mode: Mode = "mock",
  reason?: string
): ApiErrorResponse {
  return {
    error: reason === undefined ? { code, message } : { code, message, details: { reason } },
    meta: responseMeta(requestId, clock, mode)
  };
}

/** Fixed event and generated request ID only; the observer receives no headers or URL. */
export type LocalGuardDenialObserver = (event: "origin-rejected", requestId: string) => Promise<boolean>;

export function installLocalRequestGuard(clock: Clock, mode: Mode = "mock", observeDenial?: LocalGuardDenialObserver) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const host = request.headers.host?.toLowerCase();
    if (host === undefined || !ALLOWED_HOSTS.has(host)) {
      await reply
        .code(403)
        .send(errorResponse(request.id, clock, "HOST_REJECTED", "请求 Host 不在本地允许列表中", mode));
      return;
    }

    if (FORWARDED_HEADERS.some((header) => request.headers[header] !== undefined)) {
      await reply
        .code(403)
        .send(errorResponse(request.id, clock, "HOST_REJECTED", "代理转发请求不被允许", mode));
      return;
    }

    const origin = request.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      let auditAvailable = true;
      try { auditAvailable = await observeDenial?.("origin-rejected", request.id) ?? true; }
      catch { auditAvailable = false; }
      await reply
        .code(auditAvailable ? 403 : 503)
        .send(errorResponse(request.id, clock, auditAvailable ? "ORIGIN_REJECTED" : "AUTH_AUDIT_UNAVAILABLE",
          auditAvailable ? "请求 Origin 不在本地允许列表中" : "Authentication audit unavailable", mode));
    }
  };
}

export function installWriteRequestGuard(clock: Clock, mode: Mode) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.headers.origin === undefined) {
      await reply
        .code(403)
        .send(errorResponse(request.id, clock, "ORIGIN_REJECTED", "写请求必须提供允许的 Origin", mode));
      return;
    }
    if (request.headers["x-manager-intent"] !== "local-ui") {
      await reply
        .code(403)
        .send(errorResponse(request.id, clock, "ORIGIN_REJECTED", "写请求缺少本地操作意图标记", mode));
      return;
    }
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      await reply
        .code(415)
        .send(errorResponse(request.id, clock, "UNSUPPORTED_FILE_TYPE", "写请求必须使用 application/json", mode));
    }
  };
}
