import { apiErrorResponseSchema, serverParamsSchema, worldLibraryResponseSchema,
  type Mode, type ServerParams } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { responseMeta } from "../infra/http.js";
import type { ActiveWorldState } from "../services/active-world-state-store.js";
import { DomainError } from "../services/domain-errors.js";
import { ServerNotFoundError } from "../services/server-service.js";
import type { WorldLibraryStore } from "../services/world-library-store.js";

/** Uses the same app-level origin/session boundary as the existing worlds reader. */
export function registerWorldLibraryRoutes(app: FastifyInstance, library: WorldLibraryStore,
  registry: AdapterRegistry, snapshot: (serverId: string) => ActiveWorldState | null, clock: Clock, mode: Mode,
  importAvailable?: (serverId: string) => Promise<boolean>): void {
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
    const data = await library.list({ serverId: adapter.serverId, rootPath: adapter.plan.rootPath }, snapshot(adapter.serverId));
    return { data: { ...data, mutationsAvailable: data.state === "ready" && Boolean(await importAvailable?.(adapter.serverId)) },
      meta: responseMeta(request.id, clock, mode) };
  });
}
