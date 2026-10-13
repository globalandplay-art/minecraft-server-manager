import { DomainError } from "./domain-errors.js";
import { accessHash, accessUuid, encodeAccessCheckpoint, type AccessCheckpoint } from "./access-operation-record.js";
import { accessAppliedRevision, type AccessEvidence, type AccessProvider, type AccessProviderAdapter } from "./access-operation-service.js";

const digest = (value: string) => /^[0-9a-f]{64}$/u.test(value);
const conflict = () => new DomainError(409, "TAILSCALE_OWNERSHIP_CONFLICT", "Tailscale configuration cannot be safely controlled.");
const unavailable = () => new DomainError(503, "TAILSCALE_ATOMIC_CONTROL_UNAVAILABLE", "Atomic Tailscale control is unavailable.");

export interface TailscaleTargetIdentity {
  host: "127.0.0.1"; port: number; identity: string;
  purpose: "manager-ingress"; owned: boolean; healthy: boolean;
}
export interface TailscaleOwnership {
  operationId: string; managerIdentity: string; binding: string; configurationHash: string; resourceRevision: string;
}
export interface TailscaleControlSnapshot {
  schemaVersion: 1; version: "1.98.8"; atomic: boolean;
  daemonIdentity: string; tailnetIdentity: string; hostname: string;
  configurationRevision: string; revision: string; configuration: string;
  ready: boolean; https: boolean; target: TailscaleTargetIdentity;
  ownership: TailscaleOwnership | null;
  owningProof: TailscaleCommitProof | null;
}
export interface TailscaleCommitProof {
  intent: AccessCheckpoint;
  operationId: string; managerIdentity: string; binding: string;
  intentHash: string; previousConfigurationHash: string;
  previousOwnership: TailscaleOwnership | null;
  rootIdentity: string; directoryIdentity: string;
  expectedRevision: string; finalRevision: string; configurationHash: string;
  resourceRevision: string; outcome: "applied" | "not_applied";
  action: "enable" | "disable";
}
/** Trusted construction-only bridge. No production CLI implementation exists.
 * compareAndSwap must atomically recheck the full identity/snapshot and final
 * authorization, then persist config + ownership + immutable operation receipt.
 * observe returns the receipt and current head from one consistent read.
 * Revisions bind the entire config/ownership and a monotonic daemon epoch/counter,
 * including every external write (ABA is a change). Receipts survive bridge restart.
 * A non-CAS CLI, separate file receipt, or configuration equality is insufficient.
 */
export interface TailscaleAtomicBridge {
  read(): Promise<TailscaleControlSnapshot>;
  compareAndSwap(expected: TailscaleControlSnapshot, nextConfiguration: string,
    intent: AccessCheckpoint, managerIdentity: string, binding: string, authorize: () => void): Promise<void>;
  observe(operationId: string): Promise<{ snapshot: TailscaleControlSnapshot; proof: TailscaleCommitProof | null }>;
}

export function tailscaleOwnedConfiguration(hostname: string, port: number): string {
  return JSON.stringify({ TCP: { "443": { HTTPS: true } }, Web: { [`${hostname}:443`]: {
    Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } } } });
}
const emptyConfiguration = "{}";
export const tailscaleOwnershipRevision = (binding: string, ownership: TailscaleOwnership | null) =>
  accessHash(JSON.stringify({ binding, ownership }));
export const tailscaleIntentHash = (intent: AccessCheckpoint) => accessHash(JSON.stringify({
  operationId: intent.operation.id, action: intent.operation.action, provider: intent.operation.resource.provider,
  rootIdentity: intent.rootIdentity, directoryIdentity: intent.directoryIdentity,
  configurationRevision: intent.configurationRevision, observedRevision: intent.observedRevision,
  ownershipRevision: intent.ownershipRevision, previousEnabled: intent.previousEnabled,
  requestHash: intent.requestHash, idempotencyHash: intent.idempotencyHash
}));

export class TailscaleControlAdapter implements AccessProviderAdapter {
  private readonly managerIdentity: string;
  constructor(private readonly bridge: TailscaleAtomicBridge, private readonly rootIdentity: string) {
    if (!digest(rootIdentity)) throw unavailable();
    this.managerIdentity = accessHash(`${rootIdentity}|manager-access/tailscale`);
  }
  #validate(value: TailscaleControlSnapshot): string {
    if (value.schemaVersion !== 1 || value.version !== "1.98.8" || !value.atomic) throw unavailable();
    if (!digest(value.daemonIdentity) || !digest(value.tailnetIdentity) || !digest(value.revision) ||
      !accessUuid(value.configurationRevision) || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/u.test(value.hostname) ||
      !value.ready || !value.https || value.target.host !== "127.0.0.1" ||
      !Number.isInteger(value.target.port) || value.target.port < 1024 || value.target.port > 65535 ||
      value.target.port === 25565 || value.target.port === 25575 || !digest(value.target.identity) ||
      value.target.purpose !== "manager-ingress" || !value.target.owned || !value.target.healthy ||
      Buffer.byteLength(value.configuration) > 64 * 1024) throw conflict();
    return accessHash(JSON.stringify({ manager: this.managerIdentity, daemon: value.daemonIdentity,
      tailnet: value.tailnetIdentity, hostname: value.hostname, target: value.target }));
  }
  #enabled(value: TailscaleControlSnapshot, binding: string): boolean {
    if (value.configuration === emptyConfiguration) {
      if (value.ownership !== null || value.owningProof !== null) throw conflict();
      return false;
    }
    const owner = value.ownership; const proof = value.owningProof;
    if (proof) encodeAccessCheckpoint(proof.intent);
    if (value.configuration !== tailscaleOwnedConfiguration(value.hostname, value.target.port) || !owner ||
      owner.managerIdentity !== this.managerIdentity || owner.binding !== binding ||
      owner.configurationHash !== accessHash(value.configuration) || !digest(owner.resourceRevision) || !proof ||
      !accessUuid(owner.operationId) || proof.operationId !== owner.operationId || proof.action !== "enable" ||
      proof.outcome !== "applied" || proof.managerIdentity !== this.managerIdentity || proof.rootIdentity !== this.rootIdentity ||
      !digest(proof.directoryIdentity) || !digest(proof.intentHash) || proof.binding !== binding ||
      proof.configurationHash !== owner.configurationHash || proof.finalRevision !== value.revision ||
      proof.resourceRevision !== owner.resourceRevision) throw conflict();
    if (proof.intentHash !== tailscaleIntentHash(proof.intent) || proof.intent.operation.id !== proof.operationId ||
      proof.intent.operation.resource.provider !== "tailscale" || proof.intent.operation.action !== "enable" ||
      proof.intent.rootIdentity !== proof.rootIdentity || proof.intent.directoryIdentity !== proof.directoryIdentity ||
      proof.intent.previousEnabled || proof.previousOwnership !== null || proof.previousConfigurationHash !== accessHash(emptyConfiguration) ||
      proof.intent.observedRevision !== proof.expectedRevision || proof.intent.configurationRevision !== value.configurationRevision ||
      proof.intent.ownershipRevision !== tailscaleOwnershipRevision(binding, null) ||
      proof.resourceRevision !== accessAppliedRevision(proof.intent)) throw conflict();
    return true;
  }
  async preview() {
    const value = await this.bridge.read(); const binding = this.#validate(value);
    return { revision: value.configurationRevision, enabled: this.#enabled(value, binding) };
  }
  async preflight(provider: AccessProvider, action: "enable" | "disable") {
    if (provider !== "tailscale") throw unavailable();
    const value = await this.bridge.read(); const binding = this.#validate(value);
    const enabled = this.#enabled(value, binding);
    if ((action === "enable" && enabled) || (action === "disable" && !enabled)) throw conflict();
    return { configurationRevision: value.configurationRevision, observedRevision: value.revision,
      ownershipRevision: tailscaleOwnershipRevision(binding, value.ownership), previousEnabled: enabled };
  }
  async apply(intent: AccessCheckpoint, authorize: () => void): Promise<void> {
    if (intent.operation.resource.provider !== "tailscale" || intent.operation.state !== "applying") throw unavailable();
    const value = await this.bridge.read(); const binding = this.#validate(value);
    const enabled = this.#enabled(value, binding);
    if ((intent.operation.action === "enable" && enabled) || (intent.operation.action === "disable" && !enabled)) throw conflict();
    if (intent.rootIdentity !== this.rootIdentity || (enabled && value.owningProof?.directoryIdentity !== intent.directoryIdentity)) throw conflict();
    if (value.configurationRevision !== intent.configurationRevision || value.revision !== intent.observedRevision ||
      tailscaleOwnershipRevision(binding, value.ownership) !== intent.ownershipRevision || enabled !== intent.previousEnabled) throw conflict();
    // Same-key replay is handled by AccessOperationService, never a second CAS.
    await this.bridge.compareAndSwap(value, intent.operation.action === "enable"
      ? tailscaleOwnedConfiguration(value.hostname, value.target.port) : emptyConfiguration,
    intent, this.managerIdentity, binding, authorize);
  }
  async observe(intent: AccessCheckpoint): Promise<AccessEvidence> {
    if (intent.operation.resource.provider !== "tailscale") throw unavailable();
    const { snapshot: value, proof } = await this.bridge.observe(intent.operation.id);
    if (proof) encodeAccessCheckpoint(proof.intent);
    const binding = this.#validate(value); const enabled = this.#enabled(value, binding);
    const matches = proof !== null && proof.operationId === intent.operation.id &&
      proof.rootIdentity === intent.rootIdentity && proof.directoryIdentity === intent.directoryIdentity &&
      proof.intentHash === tailscaleIntentHash(intent) && proof.previousConfigurationHash === accessHash(intent.previousEnabled
        ? tailscaleOwnedConfiguration(value.hostname, value.target.port) : emptyConfiguration) &&
      proof.action === intent.operation.action && proof.managerIdentity === this.managerIdentity &&
      proof.binding === binding && tailscaleOwnershipRevision(binding, proof.previousOwnership) === intent.ownershipRevision &&
      value.configurationRevision === intent.configurationRevision && proof.expectedRevision === intent.observedRevision &&
      tailscaleIntentHash(proof.intent) === tailscaleIntentHash(intent) &&
      proof.finalRevision === value.revision && proof.configurationHash === accessHash(value.configuration) &&
      (!enabled || value.ownership?.resourceRevision === proof.resourceRevision) &&
      (proof.outcome === "applied" ? proof.resourceRevision === accessAppliedRevision(intent) && enabled === (intent.operation.action === "enable")
        : proof.outcome === "not_applied" && proof.resourceRevision === intent.observedRevision && value.revision === intent.observedRevision && enabled === intent.previousEnabled);
    return { configurationRevision: value.configurationRevision, observedRevision: intent.observedRevision,
      ownershipRevision: matches ? intent.ownershipRevision : tailscaleOwnershipRevision(binding, value.ownership),
      previousEnabled: intent.previousEnabled, operationId: intent.operation.id,
      outcome: matches ? proof!.outcome : "unknown", enabled, healthy: matches,
      resourceRevision: matches ? proof!.resourceRevision : value.revision };
  }
}
