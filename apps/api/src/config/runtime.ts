export const API_HOST = "127.0.0.1" as const;
export const API_PORT = 8080 as const;
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

export function assertMockMode(configuredMode: string | undefined): "mock" {
  if (configuredMode !== undefined && configuredMode !== "mock") {
    throw new Error("Only mock mode is implemented in Phase 1.");
  }

  return "mock";
}
