import type { WhitelistAclSession } from "../../src/services/whitelist-acl-session.js";
type Session = Pick<WhitelistAclSession, "query" | "close" | "closedConfirmed" | "healthyForRotation">;
type Factory = (wrapper: (script: string) => string, now: () => number) => Session;
interface Row { id: number; queries: number; targets: number; rejected: number; pending: number;
  firstMs: number | null; steadyMs: number; maxMs: number; closeCalls: number; closeObserved: number;
  closePending: number; closeRejected: number; closeMs: number }

/** Test-only passive observation. Original arguments/getters/promise/error identities
 * are delegated. No paths, snapshots, output, process claims, file or network I/O.
 */
export function historySessionTimings(factory: Factory, clock: () => number = () => performance.now()) {
  const entries: { session: Session; row: Row }[] = [];
  let incomplete = false, constructors = 0;
  const safe = (action: () => void) => { try { action(); } catch { incomplete = true; } };
  const time = () => { try { const value = clock(); if (Number.isFinite(value)) return value; } catch { /* Observation only. */ } incomplete = true; return null; };
  const elapsed = (start: number | null) => { const end = time(); if (start === null || end === null || end < start) { incomplete = true; return 0; } return end - start; };
  const wrapped: Factory = (wrapper, now) => {
    constructors++;
    const session = factory(wrapper, now); // Original synchronous errors propagate unchanged.
    if (entries.length >= 256) { incomplete = true; return session; }
    const row: Row = { id: constructors, queries: 0, targets: 0, rejected: 0, pending: 0, firstMs: null,
      steadyMs: 0, maxMs: 0, closeCalls: 0, closeObserved: 0, closePending: 0, closeRejected: 0, closeMs: 0 };
    entries.push({ session, row });
    const closes = new WeakSet<Promise<void>>();
    return {
      get closedConfirmed() { return session.closedConfirmed; },
      get healthyForRotation() { return session.healthyForRotation; },
      query: (...args: Parameters<Session["query"]>) => {
        const start = time(), first = row.queries === 0;
        safe(() => { row.queries++; row.targets += args[0].length; row.pending++; });
        const finish = (failed: boolean) => safe(() => { row.pending--; if (failed) row.rejected++;
          const duration = elapsed(start); if (first) row.firstMs = duration; else row.steadyMs += duration;
          row.maxMs = Math.max(row.maxMs, duration); });
        let promise: ReturnType<Session["query"]>;
        try { promise = session.query(...args); } catch (error) { finish(true); throw error; }
        void promise.then(() => finish(false), () => finish(true)); return promise;
      },
      close: (...args: Parameters<Session["close"]>) => {
        safe(() => { row.closeCalls++; }); const start = time();
        let promise: ReturnType<Session["close"]>;
        try { promise = session.close(...args); } catch (error) { safe(() => { row.closeRejected++; }); throw error; }
        if (!closes.has(promise)) {
          closes.add(promise); safe(() => { row.closeObserved++; row.closePending++; });
          const finish = (failed: boolean) => safe(() => { row.closePending--; if (failed) row.closeRejected++; row.closeMs += elapsed(start); });
          void promise.then(() => finish(false), () => finish(true));
        }
        return promise;
      },
    };
  };
  return Object.freeze({ factory: wrapped, snapshot: () => {
    const rows = entries.map(({ row, session }) => { let closed = false; safe(() => { closed = session.closedConfirmed; }); return { ...row, closed }; });
    return { constructors, incomplete, rows };
  } });
}
