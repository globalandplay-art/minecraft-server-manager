import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, link, unlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WindowsPrivateAclVerifier } from "../src/auth/windows-private-acl.js";
import { AccessOperationStore } from "../src/services/access-operation-store.js";
import { AccessOperationService, accessAppliedRevision, type AccessProvider, type AccessProviderAdapter, type AccessEvidence } from "../src/services/access-operation-service.js";
import { accessHash, type AccessCheckpoint } from "../src/services/access-operation-record.js";
import type { AccessPublication } from "../src/services/access-private-store.js";

export class FixtureAcl extends WindowsPrivateAclVerifier {
  denied = false;
  beforeCheck: () => Promise<void> = async () => {};
  override async verifyMany(files: readonly string[]) {
    await this.beforeCheck();
    if (this.denied) throw new Error("private-diagnostic-not-for-response");
    return files.map(() => "fixture-acl");
  }
}
export class FakeAccessAdapter implements AccessProviderAdapter {
  revision = randomUUID(); calls = 0; observations = 0;
  duringPreflight: () => Promise<void> = async () => {};
  duringApply: () => Promise<void> = async () => {};
  unknown = false; lostResponse = false;
  states = new Map<AccessProvider, { enabled: boolean; revision: string; operationId?: string }>();
  async preflight(provider: AccessProvider) {
    await this.duringPreflight();
    const state = this.states.get(provider) ?? { enabled: false, revision: accessHash(provider) };
    return { configurationRevision: this.revision, observedRevision: state.revision,
      ownershipRevision: accessHash(`ownership-${provider}`), previousEnabled: state.enabled };
  }
  async apply(intent: AccessCheckpoint) {
    this.calls++; await this.duringApply();
    const previous = this.states.get(intent.operation.resource.provider);
    if ((previous?.revision ?? accessHash(intent.operation.resource.provider)) !== intent.observedRevision) throw new Error("fixture-conflict");
    this.states.set(intent.operation.resource.provider, { enabled: intent.operation.action === "enable",
      revision: accessAppliedRevision(intent), operationId: intent.operation.id });
    if (this.lostResponse) throw new Error("fixture-response-lost");
  }
  async observe(intent: AccessCheckpoint): Promise<AccessEvidence> {
    this.observations++;
    const state = this.states.get(intent.operation.resource.provider);
    return { configurationRevision: this.revision, observedRevision: intent.observedRevision,
      ownershipRevision: accessHash(`ownership-${intent.operation.resource.provider}`), previousEnabled: intent.previousEnabled,
      operationId: state?.operationId ?? intent.operation.id,
      outcome: this.unknown ? "unknown" : state?.operationId === intent.operation.id ? "applied" : "not_applied",
      enabled: state?.enabled ?? false, healthy: !this.unknown, resourceRevision: state?.revision ?? intent.observedRevision };
  }
}
export async function accessFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mcsm-access-operations-"));
  let busy = false; let writes = 0;
  const owner = { assertHeld: (file: string) => { if (file !== root) throw new Error("fixture-owner"); },
    rootIdentity: () => accessHash(root), beginOfflineMutation: (file: string) => {
      owner.assertHeld(file); if (busy) throw new Error("fixture-busy"); busy = true; return () => { busy = false; };
    } };
  const acl = new FixtureAcl(); const adapter = new FakeAccessAdapter();
  const publication: AccessPublication = {
    createDirectory: async (file) => { writes++; await mkdir(file); },
    writeNew: async (file, bytes) => { writes++; await writeFile(file, bytes, { flag: "wx" }); },
    publishNew: async (stage, target) => { writes++; await link(stage, target); await unlink(stage); }
  };
  const open = async (pub = publication) => {
    const store = await AccessOperationStore.open(root, owner, acl, pub);
    const service = new AccessOperationService({ store, adapter, configuration: async () => adapter.revision });
    await service.initialize(); return { store, service };
  };
  return { root, owner, acl, adapter, publication, open, writes: () => writes,
    body: () => ({ revision: adapter.revision, confirm: true as const }),
    close: () => rm(root, { recursive: true, force: true }) };
}
