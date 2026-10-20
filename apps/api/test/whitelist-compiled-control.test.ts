import { expect, it } from "vitest";
import { COMPILED_CONTROL_LIMITS, CompiledControlError, CompiledControlLedger,
  compiledHandleInventory, parseCompiledControlFrame } from "../src/services/whitelist-compiled-control.js";

const binding = { action: "a".repeat(64), artifact: "b".repeat(64), generation: 1 };
const base = { version: 1, ...binding, processIdentity: "0123456789ABCDEF" };
const created = { ...base, type: "created" };
const ready = { ...base, type: "ready", ownerRetained: true, pinsRetained: true };
const terminal = { ...base, type: "terminal", exitCode: 0, exitSignal: null,
  processSignaled: true, stdoutEof: true, stderrEof: true, generationHandlesClosed: true };
const line = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
const unsafe = (run: () => unknown) => expect(run).toThrowError("ACL_CONTROL_UNSAFE");

it("recognizes complete created/ready/terminal frames without promoting them to native trust", () => {
  for (const frame of [created, ready, terminal]) {
    const parsed = parseCompiledControlFrame(line(frame));
    expect(parsed).toEqual(frame); expect(Object.isFrozen(parsed)).toBe(true);
  }
});

it.each([
  null, [], {}, { ...created, version: 2 }, { ...created, generation: 0 },
  { ...created, generation: 262145 }, { ...created, generation: 1.5 },
  { ...created, generation: "1" }, { ...created, action: "A".repeat(64) },
  { ...created, artifact: "SECRET" }, { ...created, processIdentity: "lowercase" },
  { ...created, action: "a".repeat(64) + "\n" }, { ...created, artifact: "b".repeat(64) + "\n" },
  { ...created, processIdentity: "0123456789ABCDEF\n" }, { ...created, processIdentity: "0000000000000000" },
  { ...created, type: "ack" }, { ...created, extra: "SECRET" },
  { ...ready, ownerRetained: false }, { ...ready, pinsRetained: "true" },
  { ...terminal, exitCode: -1 }, { ...terminal, exitCode: 0x1_0000_0000 },
  { ...terminal, exitCode: 1.1 }, { ...terminal, exitCode: null },
  { ...terminal, exitSignal: "SIGTERM" }, { ...terminal, processSignaled: false },
  { ...terminal, stdoutEof: false }, { ...terminal, stderrEof: false },
  { ...terminal, generationHandlesClosed: false }
])("rejects malformed or incomplete control receipt %#", (value) => unsafe(() => parseCompiledControlFrame(line(value))));

it.each([
  Buffer.alloc(0), Buffer.alloc(COMPILED_CONTROL_LIMITS.frameBytes + 1),
  Buffer.from(JSON.stringify(created)), Buffer.concat([line(created), line(terminal)]),
  Buffer.concat([Buffer.from([0xff]), line(created)]),
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), line(created)]),
  Buffer.from(JSON.stringify(created) + "\r\n"), Buffer.from("null\n"),
  Buffer.from(JSON.stringify(created, null, 2) + "\n"),
  Buffer.from(JSON.stringify(created).replace('"generation":1', '"generation":1e0') + "\n"),
  Buffer.from(JSON.stringify(created).replace('"version":1', '"version":9,"version":1') + "\n"),
  Buffer.from(JSON.stringify(created) + " SECRET\n")
])("rejects invalid framing/canonical encoding %#", (bytes) => unsafe(() => parseCompiledControlFrame(bytes)));

it("keeps readiness separate from terminal closure", () => {
  const ledger = new CompiledControlLedger(binding);
  expect(ledger.state).toBe("reserved"); expect(ledger.terminalObserved).toBe(false);
  ledger.observe(line(created)); expect(ledger.terminalObserved).toBe(false);
  ledger.observe(line(ready)); expect(ledger.state).toBe("ready"); expect(ledger.cleanGeneration).toBe(false);
  ledger.observe(line(terminal)); expect(ledger.terminalObserved).toBe(true); expect(ledger.cleanGeneration).toBe(true);
});

it("records a safely closed pre-readiness failure without calling it a clean generation", () => {
  const ledger = new CompiledControlLedger(binding);
  ledger.observe(line(created)); ledger.observe(line({ ...terminal, exitCode: 5 }));
  expect(ledger.terminalObserved).toBe(true); expect(ledger.cleanGeneration).toBe(false);
});

it.each([1, 0xffffffff])("records nonzero native exit %s as closure but never success", (exitCode) => {
  const ledger = new CompiledControlLedger(binding);
  ledger.observe(line(created)); ledger.observe(line(ready)); ledger.observe(line({ ...terminal, exitCode }));
  expect(ledger.terminalObserved).toBe(true); expect(ledger.cleanGeneration).toBe(false);
});

it.each([
  [ready], [terminal], [created, created], [created, ready, ready],
  [created, terminal, terminal], [created, ready, terminal, ready],
  [created, { ...ready, generation: 2 }], [created, { ...ready, action: "c".repeat(64) }],
  [created, { ...terminal, artifact: "c".repeat(64) }],
  [created, { ...terminal, processIdentity: "1123456789ABCDEF" }]
].map((frames) => ({ frames })))("poisons invalid event order/binding %# without accepting later close", ({ frames }) => {
  const ledger = new CompiledControlLedger(binding);
  unsafe(() => { for (const frame of frames) ledger.observe(line(frame)); });
  expect(ledger.state).toBe("unknown"); expect(ledger.terminalObserved).toBe(false);
  unsafe(() => ledger.observe(line(terminal)));
});

it("copies generation binding and retains unknown after explicit source loss", () => {
  const mutable = { ...binding }; const ledger = new CompiledControlLedger(mutable);
  mutable.generation = 2;
  ledger.observe(line(created)); ledger.observe(line(ready)); ledger.invalidate();
  expect(ledger.cleanGeneration).toBe(false); unsafe(() => ledger.observe(line(terminal)));
});

it.each([{}, { ...binding, action: "SECRET" }, { ...binding, generation: 0 },
  { ...binding, generation: 262145 }, { ...binding, extra: true }])("rejects invalid constructor binding %#", (value) => {
  unsafe(() => new CompiledControlLedger(value as typeof binding));
});

it("rejects binding accessors without invoking them", () => {
  let calls = 0;
  const value = { ...binding, get action() { calls++; throw new Error("SECRET"); } };
  unsafe(() => new CompiledControlLedger(value)); expect(calls).toBe(0);
});

it("does not retain or expose arbitrary native/error text", () => {
  const ledger = new CompiledControlLedger(binding);
  let caught: unknown;
  try { ledger.observe(Buffer.from('SECRET PATH stderr\n')); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(CompiledControlError);
  expect(String(caught)).toBe("Error: ACL_CONTROL_UNSAFE");
  expect(JSON.stringify(caught)).not.toContain("SECRET");
  expect(JSON.stringify(ledger)).toBe("{}");
});

it.each([0, -1, 33, 1.1, NaN, Infinity])("rejects unsupported ancestor inventory %s", (count) => unsafe(() => compiledHandleInventory(count)));

it("bounds the worst-case explicit native handle inventory without expanding logical resources", () => {
  expect(compiledHandleInventory(32)).toEqual({ pinHandles: 33, inheritedHandles: 38,
    bootstrapOwnedHandles: 88, workerOwnedHandles: 40, logicalResources: 3 });
  const limits = compiledHandleInventory(1);
  expect(limits.bootstrapOwnedHandles).toBeLessThanOrEqual(128);
  expect(limits.workerOwnedHandles).toBeLessThanOrEqual(64);
  expect(Object.isFrozen(limits)).toBe(true);
});
