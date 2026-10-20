import { TextDecoder } from "node:util";

/** UNWIRED D2 candidate. Pure shape/order checks only: no I/O, spawn, artifact
 * trust, native handle validation, epoch admission or remote/public API. A valid
 * frame is NOT native evidence until a reviewed transport binds its source. */
export const COMPILED_CONTROL_LIMITS = Object.freeze({ frameBytes: 4096,
  ancestorDirectories: 32, bootstrapOwnedHandles: 128, workerOwnedHandles: 64 });
type Fault = "size" | "encoding" | "shape" | "binding" | "order";
const faults: readonly Fault[] = ["size", "encoding", "shape", "binding", "order"];
export class CompiledControlError extends Error {
  readonly code = "ACL_CONTROL_UNSAFE";
  readonly category: Fault;
  constructor(category: Fault) {
    super("ACL_CONTROL_UNSAFE");
    this.category = faults.includes(category) ? category : "shape";
  }
}
const fail = (category: Fault): never => { throw new CompiledControlError(category); };
const hash = (value: unknown): value is string => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/u.test(value);
const processIdentity = (value: unknown): value is string => typeof value === "string" && value.length === 16 && value !== "0000000000000000" && /^[0-9A-F]{16}$/u.test(value);
const generation = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 262_144;
const uint32 = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).sort().join(",") === [...expected].sort().join(",");
type Binding = Readonly<{ action: string; artifact: string; generation: number }>;
function copyBinding(binding: Binding): Binding {
  try {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) return fail("binding");
    const descriptors = Object.getOwnPropertyDescriptors(binding);
    if (Reflect.ownKeys(descriptors).length !== 3 || !keys(descriptors, ["action", "artifact", "generation"]) ||
      Object.values(descriptors).some((descriptor) => !("value" in descriptor))) return fail("binding");
    const action: unknown = descriptors.action?.value, artifact: unknown = descriptors.artifact?.value;
    const sequence: unknown = descriptors.generation?.value;
    if (!hash(action) || !hash(artifact) || !generation(sequence)) return fail("binding");
    return Object.freeze({ action, artifact, generation: sequence });
  } catch { return fail("binding"); }
}
type Base = Binding & Readonly<{ version: 1; processIdentity: string }>;
export type CompiledControlFrame =
  | (Base & Readonly<{ type: "created" }>)
  | (Base & Readonly<{ type: "ready"; ownerRetained: true; pinsRetained: true }>)
  | (Base & Readonly<{ type: "terminal"; exitCode: number; exitSignal: null;
    processSignaled: true; stdoutEof: true; stderrEof: true; generationHandlesClosed: true }>);
const baseKeys = ["version", "type", "action", "artifact", "generation", "processIdentity"];

/** Exactly one canonical UTF-8 JSON line. Canonical roundtrip also rejects
 * duplicate keys, alternate numeric spellings and hidden/trailing frames. */
export function parseCompiledControlFrame(bytes: Buffer): CompiledControlFrame {
  if (!Buffer.isBuffer(bytes) || bytes.length < 3 || bytes.length > COMPILED_CONTROL_LIMITS.frameBytes) return fail("size");
  if (bytes[bytes.length - 1] !== 10 || bytes.subarray(0, -1).includes(10)) return fail("encoding");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, -1)); }
  catch { return fail("encoding"); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return fail("shape"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || JSON.stringify(parsed) !== text) return fail("shape");
  const row = parsed as Record<string, unknown>;
  if (row.version !== 1 || !hash(row.action) || !hash(row.artifact) || !generation(row.generation) || !processIdentity(row.processIdentity)) return fail("shape");
  if (row.type === "created" && keys(row, baseKeys)) return Object.freeze(row) as CompiledControlFrame;
  if (row.type === "ready" && keys(row, [...baseKeys, "ownerRetained", "pinsRetained"]) &&
    row.ownerRetained === true && row.pinsRetained === true) return Object.freeze(row) as CompiledControlFrame;
  if (row.type === "terminal" && keys(row, [...baseKeys, "exitCode", "exitSignal", "processSignaled", "stdoutEof", "stderrEof", "generationHandlesClosed"]) &&
    uint32(row.exitCode) && row.exitSignal === null && row.processSignaled === true && row.stdoutEof === true &&
    row.stderrEof === true && row.generationHandlesClosed === true) return Object.freeze(row) as CompiledControlFrame;
  return fail("shape");
}

/** One registered generation's observation ledger, not an admission capability.
 * Missing/invalid receipts stay unknown. No reset, retry or runtime integration. */
export class CompiledControlLedger {
  readonly #binding: Binding;
  #state: "reserved" | "created" | "ready" | "terminal" | "unknown" = "reserved";
  #identity: string | undefined;
  #ready = false;
  #exitCode: number | undefined;
  constructor(binding: Binding) {
    this.#binding = copyBinding(binding);
  }
  get state() { return this.#state; }
  get terminalObserved(): boolean { return this.#state === "terminal"; }
  /** Clean generation closure does not imply successful ACL queries or action. */
  get cleanGeneration(): boolean { return this.terminalObserved && this.#ready && this.#exitCode === 0; }
  invalidate(): void { this.#state = "unknown"; }
  observe(bytes: Buffer): void {
    try {
      if (this.#state === "unknown" || this.#state === "terminal") fail("order");
      const frame = parseCompiledControlFrame(bytes);
      if (frame.action !== this.#binding.action || frame.artifact !== this.#binding.artifact || frame.generation !== this.#binding.generation) fail("binding");
      if (frame.type === "created") {
        if (this.#state !== "reserved") fail("order");
        this.#identity = frame.processIdentity; this.#state = "created";
      } else {
        if (frame.processIdentity !== this.#identity) fail("binding");
        if (frame.type === "ready") {
          if (this.#state !== "created") fail("order");
          this.#ready = true; this.#state = "ready";
        } else {
          if (this.#state !== "created" && this.#state !== "ready") fail("order");
          this.#exitCode = frame.exitCode; this.#state = "terminal";
        }
      }
    } catch (error) {
      this.invalidate();
      throw error instanceof CompiledControlError ? new CompiledControlError(error.category) : new CompiledControlError("shape");
    }
  }
}

/** Planned explicitly owned native handles, excluding CLR/platform internals.
 * No native resources are created here. Each later launcher must enforce these
 * counts and refuse rather than truncate or silently expand them. */
export function compiledHandleInventory(ancestorDirectories: number) {
  if (!Number.isSafeInteger(ancestorDirectories) || ancestorDirectories < 1 || ancestorDirectories > COMPILED_CONTROL_LIMITS.ancestorDirectories) fail("size");
  const pins = ancestorDirectories + 1; // ancestors + exact executable
  const inherited = pins + 2 + 3; // two owner handles + three worker stdio ends
  // Reserve peak owner-process/current-identity-token temporaries explicitly;
  // managed runtime internals are not claimed to be this application's inventory.
  const bootstrap = pins + 2 + 1 + 1 + 2 + 6 + 3 + inherited + 2;
  const worker = inherited + 2;
  if (bootstrap > COMPILED_CONTROL_LIMITS.bootstrapOwnedHandles || worker > COMPILED_CONTROL_LIMITS.workerOwnedHandles) fail("size");
  return Object.freeze({ pinHandles: pins, inheritedHandles: inherited, bootstrapOwnedHandles: bootstrap,
    workerOwnedHandles: worker, logicalResources: 3 as const });
}
