import { apiErrorResponseSchema, lifecycleActionResponseSchema, serverParamsSchema, worldArchiveRequestSchema, worldArchivesResponseSchema,
  type Mode, type ServerParams, type WorldArchiveRequest } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { WorldArchiveService } from "../services/world-archive-service.js";

export function registerWorldArchiveRoutes(app: FastifyInstance, service: WorldArchiveService, clock: Clock, mode: Mode): void {
  const errors = Object.fromEntries([400,403,404,409,415,428,500,501,507].map((code) => [code,apiErrorResponseSchema]));
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/worlds/archives", {
    schema:{ params:serverParamsSchema,response:{ 200:worldArchivesResponseSchema,...errors } }
  },async (req,reply) => { reply.header("Cache-Control","no-store"); return { data:{ items:await service.list(req.params.serverId) },meta:responseMeta(req.id,clock,mode) }; });
  app.post<{ Params: ServerParams; Body: WorldArchiveRequest }>("/api/v1/servers/:serverId/worlds/archive", {
    preValidation:async (req) => {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || typeof req.body.worldId !== "string" || typeof req.body.confirmWorldName !== "string" ||
        typeof req.body.worldRevision !== "string" || req.body.intent !== "archive-world-set" || typeof req.body.allowStop !== "boolean" ||
        Object.keys(req.body).some((key) => !["worldId","confirmWorldName","worldRevision","intent","allowStop"].includes(key)))
        throw new DomainError(400,"VALIDATION_ERROR","归档请求不接受路径或其他字段","invalid-world-archive-request");
    },preHandler:installWriteRequestGuard(clock,mode),schema:{ params:serverParamsSchema,body:worldArchiveRequestSchema,response:{ 202:lifecycleActionResponseSchema,...errors } }
  },async (req,reply) => {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key))
      throw new DomainError(428,"PRECONDITION_REQUIRED","归档需要 UUID Idempotency-Key","idempotency-key-required");
    return reply.code(202).send({ data:{ operation:await service.archive(req.params.serverId,req.body,key.toLowerCase()) },meta:responseMeta(req.id,clock,mode) });
  });
}
