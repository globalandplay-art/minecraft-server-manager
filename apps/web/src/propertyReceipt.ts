import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { PropertiesWriteRequest } from '@mcsm/contracts';
import { authState } from './authState';

export type PropertyReceipt = { body: PropertiesWriteRequest; revision: string; key: string; attempt?: number; operationId?: string };

/** One pending request per server/auth generation in the existing session cache.
 * No browser storage, automatic POST, TTL expiry or credentials. Authentication
 * clears this cache on generation changes; stale async completions cannot refill it. */
export function usePropertyReceipt(serverId: string | undefined) {
  const client = useQueryClient();
  const { generation } = useSyncExternalStore(authState.subscribe, authState.snapshot);
  const queryKey = ['properties-pending-receipt', generation, serverId] as const;
  const query = useQuery<PropertyReceipt | null>({ queryKey, queryFn: async () => null,
    enabled: false, initialData: null, gcTime: Infinity });
  const current = () => generation === authState.snapshot().generation;
  const update = (next: PropertyReceipt | undefined, expected?: PropertyReceipt) => {
    if (!serverId || !current()) return false;
    let accepted = false;
    client.setQueryData<PropertyReceipt | null>(queryKey, previous => {
      if (expected) {
        if (!previous || previous.key !== expected.key) return previous ?? null;
        if (next?.operationId) {
          if (previous.operationId && previous.operationId !== next.operationId) return previous;
          next = { ...previous, operationId: next.operationId };
        } else if ((previous.attempt ?? 0) !== (expected.attempt ?? 0) || previous.operationId !== expected.operationId) return previous;
      } else if (previous) return previous;
      accepted = true;
      return next ? structuredClone(next) : null;
    });
    return accepted;
  };
  return { receipt: query.data ?? undefined, update, current };
}
