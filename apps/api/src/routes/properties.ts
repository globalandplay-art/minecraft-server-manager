import { apiErrorResponseSchema, propertiesResponseSchema, propertiesWriteRequestSchema, propertiesWriteResponseSchema,
  serverParamsSchema, type Mode, type PropertiesWriteRequest, type ServerParams } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import { PROPERTY_KEYS } from "../services/properties-reader.js";
import type { PropertiesWriteService } from "../services/properties-write-service.js";

export function registerPropertiesRoutes(app: FastifyInstance, service: PropertiesWriteService | undefined, clock: Clock, mode: Mode): void {
  const errors = Object.fromEntries([400,403,404,409,413,415,428,500,501,507].map((code) => [code, apiErrorResponseSchema]));
  const available = () => {
    if (!service) throw new DomainError(501, "ACTION_UNAVAILABLE", "配置管理需要完整本地实例和持久事务服务", "properties-unavailable");
    return service;
  };
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/properties", {
    schema: { params: serverParamsSchema, response: { 200: propertiesResponseSchema, ...errors } }
  }, async (request, reply) => {
    const data = await available().read(request.params.serverId);
    reply.header("Cache-Control", "no-store").header("ETag", `"${data.revision}"`);
    const fieldRules = available().fieldRules(request.params.serverId);
    return { data: { ...data, fieldRules }, meta: responseMeta(request.id, clock, mode) };
  });
  app.patch<{ Params: ServerParams; Body: PropertiesWriteRequest }>("/api/v1/servers/:serverId/properties", {
    preValidation: async (request) => {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["changes", "confirmOfflineIdentity"].includes(key)) || typeof body.confirmOfflineIdentity !== "boolean" ||
        !body.changes || typeof body.changes !== "object" || Array.isArray(body.changes) ||
        Object.entries(body.changes).some(([key, value]) => !PROPERTY_KEYS.includes(key as typeof PROPERTY_KEYS[number]) ||
          key === "view-distance" || key === "simulation-distance" || typeof value !== "string")) {
        throw new DomainError(400, "VALIDATION_ERROR", "配置修改不接受路径、密码或未知字段", "invalid-properties-request");
      }
    },
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, body: propertiesWriteRequestSchema, response: { 202: propertiesWriteResponseSchema, ...errors } }
  }, async (request, reply) => {
    const match = request.headers["if-match"], key = request.headers["idempotency-key"];
    if (typeof match !== "string" || !/^"[a-f0-9]{64}"$/u.test(match) || typeof key !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(key)) {
      throw new DomainError(428, "PRECONDITION_REQUIRED", "配置保存需要完整 If-Match 和 UUID Idempotency-Key", "properties-preconditions-required");
    }
    const changes: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.body.changes)) {
      if (typeof value !== "string") throw new DomainError(400, "VALIDATION_ERROR", "配置值必须为字符串", "invalid-property-value");
      changes[name] = value;
    }
    const operation = await available().save(request.params.serverId, { changes,
      confirmOfflineIdentity: request.body.confirmOfflineIdentity, revision: match.slice(1, -1) }, key.toLowerCase());
    reply.header("Cache-Control", "no-store");
    return reply.code(202).send({ data: { operation, restartRequired: true, restartFields: Object.keys(request.body.changes) },
      meta: responseMeta(request.id, clock, mode) });
  });
}
