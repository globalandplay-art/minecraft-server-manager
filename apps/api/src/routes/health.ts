import {
  apiErrorResponseSchema,
  type Features,
  type Mode,
  healthResponseSchema,
  type HealthResponse
} from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";

import type { Clock } from "../clock.js";
import { responseMeta } from "../infra/http.js";

export const FEATURES: Features = {
  dashboard: { implemented: true, phase: 1 },
  servers: { implemented: true, phase: 1 },
  lifecycle: { implemented: false, phase: 2 },
  console: { implemented: false, phase: 2 },
  worlds: { implemented: false, phase: 3 },
  backups: { implemented: false, phase: 3 },
  players: { implemented: false, phase: 4 },
  properties: { implemented: false, phase: 4 },
  addons: { implemented: false, phase: 5 },
  performance: { implemented: false, phase: 6 },
  crashAnalysis: { implemented: false, phase: 6 },
  remoteAccess: { implemented: false, phase: 7 }
};

export function featuresForMode(mode: Mode): Features {
  if (mode === "mock") return structuredClone(FEATURES);
  return {
    ...structuredClone(FEATURES),
    lifecycle: { implemented: true, phase: 2 },
    console: { implemented: true, phase: 2 },
    players: { implemented: true, phase: 4 }
  };
}

export function registerHealthRoute(app: FastifyInstance, clock: Clock, mode: Mode = "mock"): void {
  app.get<{ Reply: HealthResponse }>(
    "/api/v1/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
          403: apiErrorResponseSchema,
          500: apiErrorResponseSchema
        }
      }
    },
    async (request) => ({
      data: { status: "ok", apiVersion: "1", features: featuresForMode(mode) },
      meta: responseMeta(request.id, clock, mode)
    })
  );
}
