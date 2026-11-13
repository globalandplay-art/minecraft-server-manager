import type { AdapterRegistry } from "../adapters/registry.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import type { OperationAdmission, OperationService } from "./operation-service.js";
import type { TransactionJournalStore } from "./transaction-journal.js";
import type { WorldImportUploadService } from "./world-import-upload-service.js";
import type { WorldLibraryStore } from "./world-library-store.js";
import { verifyReplacementCurrentState } from "./world-replacement-live.js";

/** App-owned first-replacement recovery. Startup only retains gates; it never
 * repairs data, replays replacement or confirms interrupted receipts. Explicit
 * observation keeps the instance and upload leases until final settlement. */
export class WorldReplacementRecovery {
  #closing = false;
  readonly #owners = new Set<Promise<void>>();
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly library: WorldLibraryStore,
    private readonly uploads: Pick<WorldImportUploadService, "withLease" | "validatedSource">,
    private readonly backups: Pick<BackupService, "exportSource">, private readonly managerRoot: string,
    private readonly admission: OperationAdmission) {}

  private check = () => {
    if (this.#closing) throw new DomainError(503, "ACTION_UNAVAILABLE", "Manager is closing", "manager-closing");
  };

  async reconcileStartup(check: () => void = () => {}): Promise<ReadonlySet<string>> {
    this.check(); check();
    const scan = await this.journal.scan(); this.check(); check();
    const servers = new Set<string>();
    for (const record of scan.records) {
      if (!record.intent.worldReplacement) continue;
      servers.add(record.intent.serverId);
      this.operations.requireTransactionRecovery(record.intent.serverId, record.intent.operationId);
    }
    return servers;
  }

  async verify(serverId: string, operationId: string, authorize: OperationAdmission, explicitRecovery = false) {
    const admit = () => { this.check(); this.admission(); authorize(); return undefined; };
    admit();
    // Register before the first await, including any wait for operation admission.
    let release!: () => void;
    const owner = new Promise<void>(resolve => { release = resolve; }); this.#owners.add(owner);
    try {
      return await this.operations.verifyReplacementOutcome(serverId, operationId, consume => this.uploads.withLease(async () => {
        admit(); const adapter = this.registry.getLocal(serverId);
        if (!adapter) throw new DomainError(404, "SERVER_NOT_FOUND", "Server not found", "replacement-server-unavailable");
        const check = () => {
          this.check(); this.admission();
          if (this.registry.getLocal(serverId) !== adapter) throw new DomainError(409, "RECOVERY_REQUIRED", "Instance identity changed", "replacement-instance-changed", true);
        };
        check();
        const proof = await verifyReplacementCurrentState(adapter, this.managerRoot, this.journal, this.library, this.backups, this.uploads, check);
        admit(); await consume(proof); admit();
      }), admit, explicitRecovery);
    } finally { this.#owners.delete(owner); release(); }
  }

  async close(): Promise<void> {
    this.#closing = true;
    if (!this.#owners.size) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all([...this.#owners]), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DomainError(409, "CLEANUP_BLOCKED", "Replacement verification cleanup is not confirmed", "replacement-recovery-close-deadline", true)), 5000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
