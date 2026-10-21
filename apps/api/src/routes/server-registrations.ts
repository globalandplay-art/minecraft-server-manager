import { apiErrorResponseSchema, registrationDraftSchema, registrationCatalogResponseSchema, registrationPreviewResponseSchema,
  registrationSaveRequestSchema, registrationSaveResponseSchema, type RegistrationDraft, type RegistrationSaveRequest, type Mode } from '@mcsm/contracts';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../clock.js';
import type { HttpAuthentication } from '../auth/http-auth.js';
import { installWriteRequestGuard, responseMeta } from '../infra/http.js';
import { DomainError } from '../services/domain-errors.js';
import type { ServerRegistrationService } from '../services/server-registration-service.js';

export function registerServerRegistrationRoutes(app: FastifyInstance, service: ServerRegistrationService | undefined, clock: Clock, mode: Mode, auth?: HttpAuthentication) {
  const available = () => { if (!service) throw new DomainError(501, 'REGISTRATION_UNAVAILABLE', '实例登记仅在本地模式和有效配置目录中可用'); return service; };
  const errors = Object.fromEntries([400,401,403,409,413,500,501,503].map(code => [code, apiErrorResponseSchema]));
  app.get('/api/v1/server-registrations', { schema: { response: { 200: registrationCatalogResponseSchema, ...errors } } }, async request =>
    ({ data: await available().catalog(), meta: responseMeta(request.id, clock, mode) }));
  app.post<{ Body: RegistrationDraft }>('/api/v1/server-registrations/preflight', {
    preValidation: async request => {
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'id,jarFile,javaProfileId,name,root' ||
        Object.values(body).some(value => typeof value !== 'string')) throw new DomainError(400, 'VALIDATION_ERROR', '实例登记仅接受名称、目录、JAR 文件名和已有 Java 配置');
    },
    preHandler: installWriteRequestGuard(clock, mode), schema: { body: registrationDraftSchema, response: { 200: registrationPreviewResponseSchema, ...errors } }
  }, async request => ({ data: await available().preview(request.body, () => auth?.assertRecentMutation(request)), meta: responseMeta(request.id, clock, mode) }));
  app.post<{ Body: RegistrationSaveRequest }>('/api/v1/server-registrations', {
    preValidation: async request => {
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'confirm,token' ||
        body.confirm !== true || typeof body.token !== 'string') throw new DomainError(400, 'VALIDATION_ERROR', '保存需要检查凭据与明确确认');
    },
    preHandler: installWriteRequestGuard(clock, mode), schema: { body: registrationSaveRequestSchema, response: { 201: registrationSaveResponseSchema, ...errors } }
  }, async (request, reply) => reply.code(201).send({ data: await available().save(request.body.token, () => auth?.assertRecentMutation(request)), meta: responseMeta(request.id, clock, mode) }));
}
