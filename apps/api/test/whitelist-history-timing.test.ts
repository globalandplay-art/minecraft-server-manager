import { expect, it, vi } from "vitest";
import { historySessionTimings } from "./fixtures/whitelist-history-timing.js";
function pending<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const query = pending<unknown[]>(), close = pending<void>(); let tick = 0;
  const session = { closedConfirmed: false, healthyForRotation: true, query: vi.fn(() => query.promise), close: vi.fn(() => close.promise) };
  const factory = vi.fn(() => session), clock = () => tick, observer = historySessionTimings(factory, clock), wrapper = (s: string) => s;
  return { session, factory, observer, wrapper, clock, query, close, set: (value: number) => { tick = value; } };
}
it("preserves arguments, getter values and original promise identities without recording sensitive values", async () => {
  const f = fixture(), view = f.observer.factory(f.wrapper, f.clock), paths = ["SENSITIVE_PATH"], result = [{ secret: "SENSITIVE_PAYLOAD" }];
  expect(f.factory).toHaveBeenCalledExactlyOnceWith(f.wrapper, f.clock);
  expect(view.query(paths, 123)).toBe(f.query.promise); expect(f.session.query).toHaveBeenCalledExactlyOnceWith(paths, 123);
  f.set(5); f.query.resolve(result); expect(await f.query.promise).toBe(result);
  expect(view.healthyForRotation).toBe(true); f.session.healthyForRotation = false; expect(view.healthyForRotation).toBe(false);
  expect(view.close(456)).toBe(f.close.promise); expect(view.close(456)).toBe(f.close.promise);
  f.set(7); f.session.closedConfirmed = true; f.close.resolve(); await f.close.promise;
  expect(view.closedConfirmed).toBe(true);
  expect(f.observer.snapshot().rows[0]).toMatchObject({ queries: 1, targets: 1, firstMs: 5, pending: 0, closeCalls: 2, closeObserved: 1, closeMs: 2, closePending: 0, closed: true });
  expect(JSON.stringify(f.observer.snapshot())).not.toMatch(/SENSITIVE/u);
});
it("keeps first and steady query latency separate and propagates the original rejection", async () => {
  const f = fixture(), view = f.observer.factory(f.wrapper, f.clock), error = new Error("SENSITIVE_ERROR");
  const first = view.query(["a"], 50); f.set(3); f.query.resolve([]); await first;
  const next = pending<unknown[]>(); f.session.query.mockImplementation(() => next.promise);
  const task = view.query(["b", "c"], 70); f.set(8); next.reject(error); await expect(task).rejects.toBe(error);
  expect(f.observer.snapshot().rows[0]).toMatchObject({ queries: 2, targets: 3, firstMs: 3, steadyMs: 5, rejected: 1, pending: 0 });
});
it("does not replace synchronous factory/query/close errors", () => {
  const f = fixture(), error = new Error("SENSITIVE_ERROR"), view = f.observer.factory(f.wrapper, f.clock);
  f.session.query.mockImplementation(() => { throw error; }); f.session.close.mockImplementation(() => { throw error; });
  expect(() => view.query(["a"], 50)).toThrow(error); expect(() => view.close(60)).toThrow(error);
  f.factory.mockImplementation(() => { throw error; }); expect(() => f.observer.factory(f.wrapper, f.clock)).toThrow(error);
  expect(f.observer.snapshot().rows[0]).toMatchObject({ rejected: 1, pending: 0, closeRejected: 1 });
});
it("bounds records at256 without changing delegation when the observer overflows", () => {
  const f = fixture(); let last;
  for (let i = 0; i < 257; i++) last = f.observer.factory(f.wrapper, f.clock);
  expect(last).toBe(f.session); expect(f.factory).toHaveBeenCalledTimes(257);
  expect(f.observer.snapshot()).toMatchObject({ incomplete: true, constructors: 257 }); expect(f.observer.snapshot().rows).toHaveLength(256);
});
it("observation clock failures never replace native outcomes", async () => {
  const f = fixture(), observer = historySessionTimings(f.factory, () => { throw new Error("SENSITIVE_CLOCK"); });
  const view = observer.factory(f.wrapper, f.clock); expect(view.query(["a"], 50)).toBe(f.query.promise);
  f.query.resolve([]); await f.query.promise;
  expect(observer.snapshot()).toMatchObject({ incomplete: true }); expect(observer.snapshot().rows[0]).toMatchObject({ pending: 0 });
});
it("observes one rejected shared close promise without replacing errors or duplicating settlement", async () => {
  const f = fixture(), view = f.observer.factory(f.wrapper, f.clock), error = new Error("SENSITIVE_CLOSE");
  const first = view.close(25), second = view.close(25);
  expect(first).toBe(second); f.set(4); f.close.reject(error);
  await expect(first).rejects.toBe(error);
  expect(f.observer.snapshot().rows[0]).toMatchObject({ closeCalls: 2, closeObserved: 1, closeRejected: 1, closePending: 0, closeMs: 4, closed: false });
});
it("delegates throwing getters while snapshot only marks observation incomplete", () => {
  const f = fixture(), view = f.observer.factory(f.wrapper, f.clock), error = new Error("SENSITIVE_GETTER");
  Object.defineProperty(f.session, "closedConfirmed", { get: () => { throw error; } });
  expect(() => view.closedConfirmed).toThrow(error);
  expect(f.observer.snapshot()).toMatchObject({ incomplete: true, rows: [{ closed: false }] });
  expect(JSON.stringify(f.observer.snapshot())).not.toContain("SENSITIVE_GETTER");
});
it("marks a backward observation clock incomplete without changing the query outcome", async () => {
  const f = fixture(), view = f.observer.factory(f.wrapper, f.clock);
  f.set(5); const original = view.query(["a"], 20); f.set(4); f.query.resolve([]); await original;
  expect(f.observer.snapshot()).toMatchObject({ incomplete: true });
  expect(f.observer.snapshot().rows[0]).toMatchObject({ firstMs: 0, pending: 0 });
});
