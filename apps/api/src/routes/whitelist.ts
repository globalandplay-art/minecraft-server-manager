import { apiErrorResponseSchema, serverParamsSchema, whitelistResponseSchema, whitelistMemberRequestSchema,
  lifecycleActionResponseSchema, type WhitelistMemberRequest, type ServerParams, type Mode } from "@mcsm/contracts";
import { whitelistRecoveryRequestSchema, type WhitelistRecoveryRequest } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Clock } from "../clock.js";
import { responseMeta, installWriteRequestGuard } from "../infra/http.js";
import type { WhitelistService } from "../services/whitelist-service.js";
import type { HttpAuthentication } from "../auth/http-auth.js";
import { parseWhitelistMemberIntent } from "../services/whitelist-member-policy.js";
import { DomainError } from "../services/domain-errors.js";
import { whitelistMutationResponseSchema, whitelistCandidatesResponseSchema } from "@mcsm/contracts";
import type { WhitelistOnlineService } from "../services/whitelist-online-service.js";
export function registerWhitelistRoutes(app: FastifyInstance, service: WhitelistService, clock: Clock, mode: Mode,
  authentication?: Pick<HttpAuthentication, "assertRecentMutation">, online?: WhitelistOnlineService): void {
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/whitelist", {
    schema: { params: serverParamsSchema, response: { 200: whitelistResponseSchema, 400: apiErrorResponseSchema,
      401: apiErrorResponseSchema, 403: apiErrorResponseSchema, 404: apiErrorResponseSchema, 500: apiErrorResponseSchema } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { data: await (online ?? service).read(request.params.serverId), meta: responseMeta(request.id, clock, mode) };
  });
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/whitelist/candidates", {
    schema: { params: serverParamsSchema, response: { 200: whitelistCandidatesResponseSchema, 404: apiErrorResponseSchema } }
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { data: online ? await online.candidates(request.params.serverId) : {
      availability: "unavailable", reason: "candidate-read-unavailable", items: [], sampledAt: clock.now().toISOString()
    }, meta: responseMeta(request.id, clock, mode) };
  });
  app.post<{ Params: ServerParams; Body: WhitelistMemberRequest }>("/api/v1/servers/:serverId/whitelist/members", {
    preValidation: async request => { parseWhitelistMemberIntent(request.body); },
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, body: whitelistMemberRequestSchema,
      response: { 200: whitelistMutationResponseSchema, 202: lifecycleActionResponseSchema, ...Object.fromEntries([400,401,403,404,409,413,415,428,500,501,503].map(code => [code, apiErrorResponseSchema])) } }
  }, async (request, reply) => {
    if (online && mode === "local") {
      authentication?.assertRecentMutation(request);
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(key))
        throw new DomainError(428, "PRECONDITION_REQUIRED", "白名单修改需要 UUID 请求标识");
      const data = await online.mutate(request.params.serverId, request.body, key.toLowerCase(), () => {
        authentication?.assertRecentMutation(request); return undefined;
      });
      return reply.header("Cache-Control", "no-store").code(200).send({ data, meta: responseMeta(request.id, clock, mode) });
    }
    if (!authentication) throw new DomainError(403, "AUTH_REQUIRED", "白名单修改需要管理员登录和重新认证");
    authentication.assertRecentMutation(request);
    if (!service.members || mode !== "local") throw new DomainError(501, "MEMBER_RULE_UNAVAILABLE", "受控白名单写入尚未完成生产验收");
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(key))
      throw new DomainError(428, "PRECONDITION_REQUIRED", "白名单修改需要 UUID 幂等键");
    const operation = await service.members.submit(request.params.serverId, request.body, key.toLowerCase(), () => {
      authentication.assertRecentMutation(request); return undefined;
    });
    return reply.header("Cache-Control", "no-store").code(202).send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
  });
  app.post<{ Params: ServerParams; Body: WhitelistRecoveryRequest }>("/api/v1/servers/:serverId/whitelist/recover", {
    preValidation: async request => {
      if (!request.body || Object.keys(request.body).sort().join(",") !== "confirm,operationId")
        throw new DomainError(400, "VALIDATION_ERROR", "恢复请求不接受额外字段");
    },
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, body: whitelistRecoveryRequestSchema,
      response: { 200: lifecycleActionResponseSchema, ...Object.fromEntries([400,401,403,404,409,413,415,500,501,503].map(code => [code, apiErrorResponseSchema])) } }
  }, async (request, reply) => {
    if (!authentication) throw new DomainError(403, "AUTH_REQUIRED", "恢复核验需要管理员登录和重新认证");
    authentication.assertRecentMutation(request);
    if (!service.members || mode !== "local") throw new DomainError(501, "MEMBER_RULE_UNAVAILABLE", "受控白名单写入尚未完成生产验收");
    const operation = await service.members.recover(request.params.serverId, request.body.operationId, () => {
      authentication.assertRecentMutation(request); return undefined;
    });
    return reply.header("Cache-Control", "no-store").send({ data: { operation }, meta: responseMeta(request.id, clock, mode) });
  });
}
