import { randomUUID } from "node:crypto";
import { accessHash, type AccessCheckpoint } from "../src/services/access-operation-record.js";
import { accessAppliedRevision, AccessOperationService } from "../src/services/access-operation-service.js";
import { TailscaleControlAdapter, tailscaleIntentHash, type TailscaleAtomicBridge,
  type TailscaleControlSnapshot, type TailscaleCommitProof } from "../src/services/tailscale-control-adapter.js";
import { TailscaleControlService } from "../src/services/tailscale-control-service.js";
import { accessFixture } from "./access-operation-fixture.js";

/** In-memory Fake Daemon only. state/proofs survive reconstruction of Manager services. */
export class FakeTailscaleDaemon implements TailscaleAtomicBridge {
  snapshot: TailscaleControlSnapshot = { schemaVersion: 1, version: "1.98.8", atomic: true,
    daemonIdentity: accessHash("daemon-epoch"), tailnetIdentity: accessHash("tailnet"), hostname: "test.tail123.ts.net",
    configurationRevision: randomUUID(), revision: accessHash("empty-0"), configuration: "{}", ready: true, https: true,
    target: { host: "127.0.0.1", port: 19443, identity: accessHash("owned-listener"), purpose: "manager-ingress", owned: true, healthy: true }, ownership: null, owningProof: null };
  proofs = new Map<string, TailscaleCommitProof>(); counter = 0; calls = 0; commits = 0;
  loseResponse = false; beforeCommit: () => Promise<void> = async () => {};
  async read() { return structuredClone({ ...this.snapshot, owningProof: this.snapshot.ownership
    ? this.proofs.get(this.snapshot.ownership.operationId) ?? null : null }); }
  async compareAndSwap(expected: TailscaleControlSnapshot, configuration: string, intent: AccessCheckpoint,
    managerIdentity: string, binding: string, authorize: () => void) {
    this.calls++; await this.beforeCommit();
    const current = { ...this.snapshot, owningProof: this.snapshot.ownership
      ? this.proofs.get(this.snapshot.ownership.operationId) ?? null : null };
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("FAKE_CAS_CONFLICT");
    authorize(); // No await between final authorization and the single atomic commit.
    const resourceRevision = accessAppliedRevision(intent);
    const revision = accessHash(`epoch:${++this.counter}:${configuration}:${resourceRevision}`);
    const next = { ...this.snapshot, configuration, revision, ownership: intent.operation.action === "enable"
      ? { operationId: intent.operation.id, managerIdentity, binding, configurationHash: accessHash(configuration), resourceRevision } : null };
    const proof: TailscaleCommitProof = { intent: structuredClone(intent), operationId: intent.operation.id, action: intent.operation.action,
      managerIdentity, binding, intentHash: tailscaleIntentHash(intent), previousConfigurationHash: accessHash(expected.configuration),
      previousOwnership: structuredClone(expected.ownership), expectedRevision: expected.revision,
      rootIdentity: intent.rootIdentity, directoryIdentity: intent.directoryIdentity,
      finalRevision: revision, configurationHash: accessHash(configuration), resourceRevision, outcome: "applied" };
    this.snapshot = { ...next, owningProof: intent.operation.action === "enable" ? proof : null };
    this.proofs.set(intent.operation.id, proof); this.commits++;
    if (this.loseResponse) throw new Error("FAKE_RESPONSE_LOST");
  }
  async observe(operationId: string) {
    const snapshot = { ...this.snapshot, owningProof: this.snapshot.ownership
      ? this.proofs.get(this.snapshot.ownership.operationId) ?? null : null };
    return structuredClone({ snapshot, proof: this.proofs.get(operationId) ?? null });
  }
  externalWrite(configuration = this.snapshot.configuration) {
    this.snapshot = { ...this.snapshot, configuration, ownership: null, owningProof: null,
      revision: accessHash(`external:${++this.counter}:${configuration}`) };
  }
}
export async function tailscaleControlFixture() {
  const f = await accessFixture(); const daemon = new FakeTailscaleDaemon();
  const adapter = new TailscaleControlAdapter(daemon, f.owner.rootIdentity());
  const services: AccessOperationService[] = [];
  const open = async (bridge = daemon) => {
    const { store, service: unused } = await f.open(); await unused.close();
    const selectedAdapter = bridge === daemon ? adapter : new TailscaleControlAdapter(bridge, f.owner.rootIdentity());
    const operations = new AccessOperationService({ store, adapter: selectedAdapter,
      configuration: async (provider) => provider === "tailscale" ? bridge.snapshot.configurationRevision : null });
    await operations.initialize(); services.push(operations);
    return { operations, control: new TailscaleControlService(operations, selectedAdapter) };
  };
  return { ...f, daemon, adapter, open,
    body: () => ({ revision: daemon.snapshot.configurationRevision, confirm: true as const }),
    close: async () => { for (const service of services) await service.close(); await f.close(); } };
}
