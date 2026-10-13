import type { AccessMethodsResponse } from "@mcsm/contracts";

/** Read-only capability inventory. No host observation, CLI, listeners or persistence. */
export class AccessCoordinator {
  #authenticationRequired: boolean;
  constructor(authenticationRequired: boolean) { this.#authenticationRequired = authenticationRequired; }
  read(): AccessMethodsResponse["data"] {
    const unavailable = <T extends "tailscale" | "cloudflare">(id: T) => ({
      id, implemented: false as const, desiredEnabled: false as const,
      observedState: "unknown" as const, managementMode: "external" as const,
      connectionUrl: null, remoteVerifiedAt: null,
      capabilities: { preflight: id === "tailscale", enable: false as const, disable: false as const }
    });
    return {
      local: { id: "local", authenticationRequired: this.#authenticationRequired, available: true, managementMode: "manager" },
      tailscale: unavailable("tailscale"), cloudflare: unavailable("cloudflare")
    };
  }
}
