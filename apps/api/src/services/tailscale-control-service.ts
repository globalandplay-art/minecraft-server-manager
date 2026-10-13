import type { TailscaleControlResponse } from "@mcsm/contracts";
import type { AccessOperationService } from "./access-operation-service.js";
import type { TailscaleControlAdapter } from "./tailscale-control-adapter.js";
import { DomainError } from "./domain-errors.js";

/** Preview only. Production does not construct an atomic provider adapter. */
export class TailscaleControlService {
  constructor(readonly operations: AccessOperationService, private readonly adapter?: TailscaleControlAdapter) {}
  async read(): Promise<TailscaleControlResponse["data"]> {
    const base: TailscaleControlResponse["data"] = { state: "unavailable", revision: null, observedEnabled: null,
      recoveryOperationId: null, enableAllowed: false, disableAllowed: false,
      connectionUrl: null, remoteVerifiedAt: null, lastErrorCode: "TAILSCALE_ATOMIC_CONTROL_UNAVAILABLE" };
    if (!this.adapter) return base;
    try {
      const status = await this.operations.controlPreview(() => this.adapter!.preview());
      if (!status.available || !status.preview) return base;
      const preview = status.preview;
      if (status.recoveryOperationId) return { ...base, state: "recovery_required", revision: preview.revision,
        recoveryOperationId: status.recoveryOperationId, lastErrorCode: "ACCESS_RECOVERY_REQUIRED" };
      return { ...base, state: preview.enabled ? "enabled" : "ready", observedEnabled: preview.enabled,
        revision: preview.revision, enableAllowed: !preview.enabled, disableAllowed: preview.enabled, lastErrorCode: null };
    } catch (error) {
      const code = error instanceof DomainError ? error.code : "ACCESS_RECOVERY_REQUIRED";
      const allowed = ["TAILSCALE_OWNERSHIP_CONFLICT", "TAILSCALE_ATOMIC_CONTROL_UNAVAILABLE", "ACCESS_RECOVERY_REQUIRED", "ACCESS_BUSY"];
      return { ...base, state: code === "TAILSCALE_OWNERSHIP_CONFLICT" ? "conflict" : "recovery_required",
        lastErrorCode: allowed.includes(code) ? code : "ACCESS_RECOVERY_REQUIRED" };
    }
  }
}
