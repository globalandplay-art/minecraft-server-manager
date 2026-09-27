import type { ApiErrorResponse, ResponseMeta } from "@mcsm/contracts";
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

export function responseMeta(requestId: string, clock: Clock): ResponseMeta {
  return { requestId, generatedAt: clock.now().toISOString(), mode: "mock" };
}

export function errorResponse(
  requestId: string,
  clock: Clock,
  code: string,
  message: string
): ApiErrorResponse {
  return { error: { code, message }, meta: responseMeta(requestId, clock) };
}

export function installLocalRequestGuard(clock: Clock) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const host = request.headers.host?.toLowerCase();
    if (host === undefined || !ALLOWED_HOSTS.has(host)) {
      await reply
        .code(403)
        .send(errorResponse(request.id, clock, "HOST_REJECTED", "请求 Host 不在本地允许列表中"));
      return;
    }

    if (FORWARDED_HEADERS.some((header) => request.headers[header] !== undefined)) {
      await reply
        .code(403)
        .send(errorResponse(request.id, clock, "HOST_REJECTED", "代理转发请求不被允许"));
      return;
    }

    const origin = request.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      await reply
        .code(403)
        .send(errorResponse(request.id, clock, "ORIGIN_REJECTED", "请求 Origin 不在本地允许列表中"));
    }
  };
}
