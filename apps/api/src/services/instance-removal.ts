import type { RawServerConfig } from '../config/local-config.js';
import { validateRegistration } from '../config/local-config.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { RuntimeFactory } from '../infra/runtime-contract.js';
import type { OperationService } from './operation-service.js';
import type { EventStreamService } from './event-stream-service.js';
import type { TransactionJournalStore } from './transaction-journal.js';
import type { ActiveWorldStateStore } from './active-world-state-store.js';
import { DomainError } from './domain-errors.js';
import path from 'node:path';

/** Cancel management only. No server/world/backup/history file is deleted. */
export async function removeInstance(target: RawServerConfig, publish: (check: () => Promise<void>) => Promise<void>, authorize: () => void, context: {
  registry: AdapterRegistry; operations: OperationService; streams: EventStreamService; factory?: RuntimeFactory | undefined;
  active?: Pick<ActiveWorldStateStore, 'unregister'> | undefined; journal?: TransactionJournalStore | undefined; closing: () => boolean;
  detached?: (() => void) | undefined;
}) {
  return context.operations.runExclusive(target.id, async () => {
    const adapter = context.registry.getLocal(target.id);
    let temporary;
    try {
      if (!adapter) {
        if (!context.factory) throw new DomainError(409, 'REGISTRATION_REMOVE_UNAVAILABLE', '待加载实例暂不能确认停服，请使用最新本地 Manager');
        temporary = await context.factory.create((await validateRegistration(target)).plan);
      }
      const check = async () => {
        if (context.closing()) throw new DomainError(409, 'REGISTRATION_BUSY', 'Manager 正在关闭');
        if (adapter && context.registry.getLocal(target.id) !== adapter) throw new DomainError(409, 'REGISTRATION_CONFLICT', '实例引用已变化');
        if (adapter && path.resolve(adapter.plan.rootPath).toLowerCase() !== path.resolve(target.root).toLowerCase())
          throw new DomainError(409, 'REGISTRATION_CONFLICT', '登记目录与已加载实例不一致');
        if (context.operations.getServerState(target.id).recoveryRequired) throw new DomainError(409, 'RECOVERY_REQUIRED', '实例恢复状态需要检查，不能移除');
        const scan = await context.journal?.scan();
        if (scan?.issues.some(row => !row.serverId || row.serverId === target.id) || scan?.records.some(row => row.intent.serverId === target.id && ['active','recovery-required'].includes(row.state)))
          throw new DomainError(409, 'RECOVERY_REQUIRED', '存在未完成的事务记录，不能移除');
        const status = adapter ? await adapter.getStatus() : (await temporary!.snapshot()).status;
        if (status.state !== 'stopped' || status.ownership !== 'none' || status.recoveryRequired || status.activeOperationId)
          throw new DomainError(409, 'REGISTRATION_INSTANCE_ACTIVE', '实例正在运行、处理操作或状态不明确；请先正常停服');
        authorize();
      };
      const quarantine = async () => {
        // Even an uncertain config publication must not leave an operable ghost adapter.
        context.operations.unregister(target.id);
        if (adapter) context.registry.remove(target.id, adapter);
        let clean = true;
        for (const detach of [() => context.streams.remove(target.id), () => context.active?.unregister(target.id), () => context.detached?.()]) {
          try { detach(); } catch { clean = false; }
        }
        try { if (adapter) await adapter.closeObserver(); } catch { clean = false; }
        if (adapter && clean) context.registry.released(adapter);
        return { unloaded: clean, unloadErrorCode: clean ? null : 'REGISTRATION_UNLOAD_REQUIRES_RESTART' };
      };
      await check();
      try { await publish(check); }
      catch (error) {
        if (error instanceof DomainError && error.code === 'REGISTRATION_RESULT_UNKNOWN') await quarantine();
        throw error;
      }
      return await quarantine();
    } finally { await temporary?.closeObserver(); }
  }, true);
}
