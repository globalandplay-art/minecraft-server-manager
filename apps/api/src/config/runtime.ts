export const API_HOST = "127.0.0.1" as const;
export const API_PORT = 8080 as const;
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

export function resolveMode(configuredMode: string | undefined): "mock" | "local" {
  if (configuredMode === undefined || configuredMode === "mock") {
    return "mock";
  }
  if (configuredMode === "local") {
    return "local";
  }
  throw new Error("MCSM_MODE must be mock or local.");
}

/** Backward-compatible assertion used by the Phase 1 test boundary. */
export function assertMockMode(configuredMode: string | undefined): "mock" {
  if (configuredMode === undefined || configuredMode === "mock") return "mock";
  throw new Error("Only mock mode is supported by this assertion.");
}
