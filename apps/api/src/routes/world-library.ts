import { apiErrorResponseSchema, serverParamsSchema, worldLibraryResponseSchema, worldStoppedRevisionResponseSchema,
  type Mode, type ServerParams, type WorldLibraryResponse } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { installWriteRequestGuard, responseMeta } from "../infra/http.js";
import { worldIdentity, type ActiveWorldState } from "../services/active-world-state-store.js";
import type { HttpAuthentication } from "../auth/http-auth.js";
import type { OperationService } from "../services/operation-service.js";
import { verifyStartupOwnedWorldRevision } from "../services/world-owned-lifecycle.js";
import { DomainError } from "../services/domain-errors.js";
import { ServerNotFoundError } from "../services/server-service.js";
import type { WorldLibraryStore } from "../services/world-library-store.js";
import type { OperationStore } from "../services/operation-store.js";
import type { TransactionJournalStore } from "../services/transaction-journal.js";
import { createHash } from "node:crypto";

export function registerWorldStopInspectionRoute(app: FastifyInstance, registry: AdapterRegistry, operations: OperationService,
  library: Pick<WorldLibraryStore, "list">, proof: { journal: Pick<TransactionJournalStore, "scan">; receipts: Pick<OperationStore, "list"> },
  snapshot: (serverId: string) => ActiveWorldState | null, clock: Clock, mode: Mode,
  authentication: Pick<HttpAuthentication, "assertMutation">): void {
  app.post<{ Params: ServerParams; Body: { confirmStopOperationId?: string } }>("/api/v1/servers/:serverId/worlds/stopped-revision-inspection", {
    preHandler: installWriteRequestGuard(clock, mode),
    schema: { params: serverParamsSchema, body: { type: "object", anyOf: [{ maxProperties: 0 }, {
      maxProperties: 1, required: ["confirmStopOperationId"],
      properties: { confirmStopOperationId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" } }
    }] },
      response: { 200: worldStoppedRevisionResponseSchema } }
  }, async (request, reply) => {
    authentication.assertMutation(request);
    const { serverId } = request.params;
    const active = snapshot(serverId), expected = JSON.stringify(active);
    const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Stopped world mapping requires inspection", "world-stop-slot-unverified", true);
    if (active?.state !== "active" || active.serverId !== serverId || !active.levelName ||
        active.worldId !== worldIdentity(serverId, active.levelName)) throw fail();
    const admission = (): undefined => {
      authentication.assertMutation(request);
      if (JSON.stringify(snapshot(serverId)) !== expected) throw fail();
      return undefined;
    };
    const levelName = active.levelName;
    const result = await verifyStartupOwnedWorldRevision(registry, operations, serverId, levelName, admission, async (target, assertCurrent) => {
      const adapter = registry.getLocal(serverId);
      if (!adapter) throw fail();
      assertCurrent();
      const catalog = await library.list({ serverId, rootPath: adapter.plan.rootPath }, active,
        { ...proof, registeredExecutionDigest: target.registeredExecutionDigest, assertCurrent,
          readLifecycle: () => operations.readStartupWorldStopCandidate(serverId) });
      assertCurrent();
      const matching = catalog.items.filter(item => item.state === "present" && item.levelName === levelName);
      if (catalog.serverId !== serverId || catalog.revision !== target.catalogRevision || matching.length !== 1 ||
          matching[0]?.worldId !== target.worldId ||
          (target.historicalGeneration && catalog.state !== "inspection-required") ||
          (catalog.state === "ready" && catalog.activeWorldId !== target.worldId)) throw fail();
    }, request.body.confirmStopOperationId);
    admission();
    return reply.header("Cache-Control", "no-store").send({
      data: { serverId, operationId: result.stopOperationId, worldId: result.worldId, inspectionOnly: true, recoveryRequired: true,
        confirmationRecorded: result.confirmationRecorded },
      meta: responseMeta(request.id, clock, mode)
    });
  });
}

/** Uses the same app-level origin/session boundary as the existing worlds reader. */
export function registerWorldLibraryRoutes(app: FastifyInstance, library: WorldLibraryStore,
  registry: AdapterRegistry, snapshot: (serverId: string) => ActiveWorldState | null, clock: Clock, mode: Mode,
  importAvailable?: (serverId: string) => Promise<boolean>, activationAvailable?: () => boolean,
  generationProof?: { journal: Pick<TransactionJournalStore, "scan">; receipts: Pick<OperationStore, "list"> },
  stoppedInspectionTarget?: (catalog: WorldLibraryResponse["data"]) => Promise<string | undefined>,
  readLifecycle?: OperationService["readStartupWorldStopCandidate"]): void {
  app.get<{ Params: ServerParams }>("/api/v1/servers/:serverId/world-library", {
    schema: { params: serverParamsSchema, response: { 200: worldLibraryResponseSchema,
      ...Object.fromEntries([400, 403, 404, 409, 500, 501].map(code => [code, apiErrorResponseSchema])) } }
  }, async (request, reply) => {
    const adapter = registry.getLocal(request.params.serverId);
    if (!registry.get(request.params.serverId)) throw new ServerNotFoundError();
    if (!adapter || adapter.plan.serverInfo.type !== "vanilla") {
      throw new DomainError(501, "WORLD_LAYOUT_UNSUPPORTED", "World library layout is not supported", "unsupported-server-layout");
    }
    reply.header("Cache-Control", "no-store");
    const active = snapshot(adapter.serverId), activeDigest = JSON.stringify(active);
    const identity = adapter.getRegisteredExecutionIdentity?.();
    const registeredExecutionDigest = identity ? createHash('sha256').update(JSON.stringify(identity)).digest('hex') : undefined;
    const assertCurrent = (): undefined => {
      const current = adapter.getRegisteredExecutionIdentity?.();
      if (!registeredExecutionDigest || registry.getLocal(adapter.serverId) !== adapter || !current ||
          createHash('sha256').update(JSON.stringify(current)).digest('hex') !== registeredExecutionDigest ||
          JSON.stringify(snapshot(adapter.serverId)) !== activeDigest) {
        throw new DomainError(409, "RECOVERY_REQUIRED", "World library identity requires inspection", "identity-unverified", true);
      }
      return undefined;
    };
    const data = await library.list({ serverId: adapter.serverId, rootPath: adapter.plan.rootPath }, active,
      generationProof && registeredExecutionDigest ? { ...generationProof, registeredExecutionDigest, assertCurrent,
        ...(readLifecycle ? { readLifecycle: () => readLifecycle(adapter.serverId) } : {}) } : generationProof);
    const target = active?.state === "active" && active.serverId === adapter.serverId && active.levelName &&
      active.worldId === worldIdentity(adapter.serverId, active.levelName)
      ? await stoppedInspectionTarget?.(data) : undefined;
    const inspectionWorldId = target && data.items.some(item => item.worldId === target && item.state === "present" &&
      item.levelName === active?.levelName) ? target : undefined;
    if (inspectionWorldId) assertCurrent();
    return { data: { ...data, ...(inspectionWorldId ? { stoppedRevisionInspectionAvailable: true,
      stoppedRevisionInspectionWorldId: inspectionWorldId } : {}),
      mutationsAvailable: data.state === "ready" && Boolean(await importAvailable?.(adapter.serverId)),
      activationAvailable: data.state === "ready" && adapter.plan.serverInfo.minecraftVersion === "26.3" && Boolean(activationAvailable?.()) },
      meta: responseMeta(request.id, clock, mode) };
  });
}
