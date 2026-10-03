import { apiErrorResponseSchema, lifecycleActionResponseSchema, serverParamsSchema,
  worldImportPlanRequestSchema, worldImportPlanResponseSchema, worldImportRequestSchema,
  worldImportRecoveryPlanRequestSchema, worldImportRecoveryPlanResponseSchema, worldImportRecoveryRequestSchema,
  type Mode, type ServerParams, type WorldImportPlanRequest, type WorldImportRequest,
  type WorldImportRecoveryPlanRequest, type WorldImportRecoveryRequest } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard,responseMeta } from "../infra/http.js";
import { DomainError } from "../services/domain-errors.js";
import type { WorldImportService } from "../services/world-import-service.js";

export function registerWorldImportRoutes(app: FastifyInstance, service: WorldImportService, clock: Clock, mode: Mode): void {
  const errors = Object.fromEntries([400,403,404,409,415,428,500,501,507].map((code) => [code,apiErrorResponseSchema]));
  const strict = (body: unknown, fields: Record<string,string>) => {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !(key in fields)) ||
      Object.entries(fields).some(([key,type]) => typeof (body as Record<string,unknown>)[key] !== type)) {
      throw new DomainError(400,"VALIDATION_ERROR","导入请求格式无效","invalid-world-import-request");
    }
  };
  const key = (headers: Record<string,unknown>): string => {
    const value = headers["idempotency-key"];
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
      throw new DomainError(428,"PRECONDITION_REQUIRED","导入操作需要 UUID Idempotency-Key","idempotency-key-required");
    }
    return value.toLowerCase();
  };
  app.post<{ Params:ServerParams; Body:WorldImportPlanRequest }>("/api/v1/servers/:serverId/worlds/import-plan",{
    preValidation:async (req) => strict(req.body,{ uploadId:"string",name:"string" }),preHandler:installWriteRequestGuard(clock,mode),
    schema:{ params:serverParamsSchema,body:worldImportPlanRequestSchema,response:{200:worldImportPlanResponseSchema,...errors} }
  },async (req,reply) => { reply.header("Cache-Control","no-store"); return { data:await service.plan(req.params.serverId,req.body),meta:responseMeta(req.id,clock,mode) }; });
  app.post<{ Params:ServerParams; Body:WorldImportRequest }>("/api/v1/servers/:serverId/worlds/import",{
    preValidation:async (req) => strict(req.body,{ uploadId:"string",name:"string",uploadRevision:"string",worldRevision:"string",confirmWorldName:"string",allowStop:"boolean" }),
    preHandler:installWriteRequestGuard(clock,mode),schema:{ params:serverParamsSchema,body:worldImportRequestSchema,response:{202:lifecycleActionResponseSchema,...errors} }
  },async (req,reply) => reply.code(202).send({ data:{ operation:await service.importWorld(req.params.serverId,req.body,key(req.headers)) },meta:responseMeta(req.id,clock,mode) }));
  app.post<{ Params:ServerParams; Body:WorldImportRecoveryPlanRequest }>("/api/v1/servers/:serverId/worlds/import-recovery-plan",{
    preValidation:async (req) => strict(req.body,{ operationId:"string" }),preHandler:installWriteRequestGuard(clock,mode),
    schema:{params:serverParamsSchema,body:worldImportRecoveryPlanRequestSchema,response:{200:worldImportRecoveryPlanResponseSchema,...errors}}
  },async (req,reply) => { reply.header("Cache-Control","no-store"); return { data:await service.recoveryPlan(req.params.serverId,req.body.operationId),meta:responseMeta(req.id,clock,mode) }; });
  app.post<{ Params:ServerParams; Body:WorldImportRecoveryRequest }>("/api/v1/servers/:serverId/worlds/import-recovery",{
    preValidation:async (req) => strict(req.body,{ operationId:"string",confirmWorldName:"string",recoveryRevision:"string" }),preHandler:installWriteRequestGuard(clock,mode),
    schema:{params:serverParamsSchema,body:worldImportRecoveryRequestSchema,response:{202:lifecycleActionResponseSchema,...errors}}
  },async (req,reply) => reply.code(202).send({ data:{operation:await service.recover(req.params.serverId,req.body,key(req.headers))},meta:responseMeta(req.id,clock,mode) }));
}
