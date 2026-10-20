import type { WhitelistResponse } from "@mcsm/contracts";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { PropertiesReader } from "./properties-reader.js";
import { readStoredWhitelist } from "./whitelist-reader.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import type { WhitelistRconCoordinator } from "./whitelist-rcon-coordinator.js";
import { whitelistMemberRevision } from "./whitelist-member-policy.js";

export class WhitelistService {
  private readonly properties = new PropertiesReader();
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService, private readonly clock: Clock,
    readonly members?: WhitelistRconCoordinator) {
    if (members && members.operations !== operations) throw new Error("Whitelist must share instance operation exclusion");
  }
  async read(serverId: string): Promise<WhitelistResponse["data"]> {
    const unavailable = (reason: string): WhitelistResponse["data"] => ({ availability: "unavailable", reason,
      configuredEnabled: null, configuredEnforced: null, effectiveEnabled: null, items: [], source: null,
      sampledAt: this.clock.now().toISOString(), membershipWritable: false, writeReason: "MEMBER_RULE_UNAVAILABLE" });
    if (!this.registry.get(serverId)) throw new DomainError(404, "SERVER_NOT_FOUND", "未找到服务器实例");
    const adapter = this.registry.getLocal(serverId);
    if (!adapter || adapter.plan.serverInfo.type !== "vanilla" || adapter.plan.serverInfo.minecraftVersion !== "26.3") return unavailable("version-unsupported");
    const registration = (() => { try { return adapter.getRegisteredExecutionIdentity?.(); } catch { return undefined; } })();
    if (!registration || !/^[a-f0-9]{64}$/u.test(registration.rootIdentity)) return unavailable("registration-unavailable");
    const registeredRoot = registration.rootIdentity;
    const assertRoot = async () => {
      if (await backupDirectoryIdentity(adapter.plan.rootPath) !== registeredRoot) throw new Error("WHITELIST_ROOT_CHANGED");
    };
    try {
      return await this.operations.runExclusive(serverId, async () => {
        const status = await adapter.getStatus();
        if (status.recoveryRequired || status.activeOperationId || !((status.state === "stopped" && status.ownership === "none") ||
          (status.state === "running" && status.ownership === "managed"))) return unavailable("server-state-unavailable");
        await assertRoot();
        const config = await this.properties.read(serverId, adapter.plan.rootPath);
        const enabled = config.fields["white-list"], enforced = config.fields["enforce-whitelist"];
        const flags = { configuredEnabled: typeof enabled === "boolean" ? enabled : null, configuredEnforced: typeof enforced === "boolean" ? enforced : null };
        let items;
        try { items = await readStoredWhitelist(adapter.plan.rootPath); }
        catch (error) {
          const absent = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
          await assertRoot();
          if ((await this.properties.read(serverId, adapter.plan.rootPath)).revision !== config.revision) return unavailable("snapshot-changed");
          return { ...unavailable(absent ? "whitelist-file-missing" : "whitelist-read-unsafe"), ...flags };
        }
        if ((await this.properties.read(serverId, adapter.plan.rootPath)).revision !== config.revision) return unavailable("snapshot-changed");
        await assertRoot();
        if (this.members && status.state === "running" && status.ownership === "managed") {
          try {
            const prepared = await this.members.prepare(serverId);
            if (prepared.rootIdentity === registeredRoot && prepared.configRevision === config.revision &&
              JSON.stringify(prepared.members) === JSON.stringify(items)) {
              return { availability: "available", reason: null, ...flags, effectiveEnabled: null, items, source: "whitelist-json",
                sampledAt: this.clock.now().toISOString(), membershipWritable: true, writeReason: null, revision: whitelistMemberRevision(prepared) };
            }
          } catch { /* Saved list remains readable; missing live proof never enables writes. */ }
        }
        return { availability: "available", reason: null, ...flags, effectiveEnabled: null, items, source: "whitelist-json",
          sampledAt: this.clock.now().toISOString(), membershipWritable: false, writeReason: "MEMBER_RULE_UNAVAILABLE" };
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "RECOVERY_REQUIRED") return unavailable("recovery-required");
      if (error instanceof DomainError && error.code === "OPERATION_CONFLICT") return unavailable("operation-active");
      return unavailable("whitelist-read-unsafe");
    }
  }
}
