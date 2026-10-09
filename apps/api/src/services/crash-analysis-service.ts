import { performance } from "node:perf_hooks";
import type { CrashAnalysisResponse } from "@mcsm/contracts";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { CrashEvidenceReader } from "./crash-evidence-reader.js";
import { DomainError } from "./domain-errors.js";
import { ServerNotFoundError } from "./server-service.js";

type Snapshot = CrashAnalysisResponse["data"];
/** Demand-only bounded scans. Cached failures remain errors until a later successful scan. */
export class CrashAnalysisService {
  readonly #next = new Map<string, number>();
  readonly #pending = new Map<string, Promise<Snapshot>>();
  readonly #results = new Map<string, Snapshot>();
  readonly #errors = new Map<string, unknown>();
  constructor(readonly registry: AdapterRegistry, readonly clock: Clock,
    readonly reader: Pick<CrashEvidenceReader, "read"> = new CrashEvidenceReader(),
    readonly monotonicNow: () => number = () => performance.now()) {}

  async read(serverId: string): Promise<Snapshot> {
    if (!this.registry.get(serverId)) throw new ServerNotFoundError();
    const local = this.registry.getLocal(serverId);
    if (!local) return { status: "unavailable", reason: "local-instance-required", sampledAt: null,
      minimumIntervalMs: 5000, incomplete: false, conclusion: "unavailable", sources: [], findings: [], limitations: [] };
    const pending = this.#pending.get(serverId);
    if (pending) return structuredClone(await pending);
    if (this.monotonicNow() < (this.#next.get(serverId) ?? -Infinity)) {
      if (this.#errors.has(serverId)) throw this.#errors.get(serverId);
      return structuredClone(this.#results.get(serverId)!);
    }
    this.#next.set(serverId, this.monotonicNow() + 5000);
    const task = Promise.resolve().then(async (): Promise<Snapshot> => {
      const identity = local.getRegisteredExecutionIdentity?.();
      if (!identity?.rootIdentity) throw new DomainError(409, "CRASH_EVIDENCE_UNSAFE", "注册实例身份无法核验", "crash-root-unverified");
      const analysis = await this.reader.read(serverId, local.plan.rootPath, identity.rootIdentity);
      return { ...analysis, status: "available", reason: null, sampledAt: this.clock.now().toISOString(), minimumIntervalMs: 5000 };
    });
    this.#pending.set(serverId, task);
    try {
      const result = await task;
      this.#results.set(serverId, result); this.#errors.delete(serverId);
      return structuredClone(result);
    } catch (error) { this.#errors.set(serverId, error); throw error; }
    finally { this.#pending.delete(serverId); }
  }
}
