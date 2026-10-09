import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";

export const SCRYPT_PROFILE = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024, keyLength: 64 });
export type CredentialRecord = Readonly<{
  version: 1; username: string; revision: string; salt: string; hash: string;
  parameters: typeof SCRYPT_PROFILE;
}>;
export type MonotonicNow = () => number;
export class AuthCoreError extends Error {
  constructor(readonly code: "AUTH_INVALID" | "AUTH_BUSY" | "AUTH_RATE_LIMITED" | "AUTH_CAPACITY" | "AUTH_PRIVATE_UNSAFE", readonly retryAfterSeconds?: number) {
    super(code);
  }
}
const invalid = () => new AuthCoreError("AUTH_INVALID");
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(",") === keys.sort().join(",");
const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function validUsername(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(value);
}
export function validPassword(value: unknown, initial = false): value is string {
  if (typeof value !== "string" || value.length > 256 || Buffer.byteLength(value, "utf8") > 512) return false;
  // Reject unpaired surrogates rather than silently replacing distinct inputs with U+FFFD.
  if (value !== Buffer.from(value, "utf8").toString("utf8")) return false;
  const length = [...value].length;
  return length <= 128 && (!initial || length >= 15);
}
export function parseCredentialRecord(value: unknown): CredentialRecord {
  if (!plainObject(value) || !exactKeys(value, ["version", "username", "revision", "salt", "hash", "parameters"]) ||
    value.version !== 1 || !validUsername(value.username) || typeof value.revision !== "string" || !uuid.test(value.revision) ||
    typeof value.salt !== "string" || !/^[0-9a-f]{32}$/u.test(value.salt) ||
    typeof value.hash !== "string" || !/^[0-9a-f]{128}$/u.test(value.hash) || !plainObject(value.parameters) ||
    !exactKeys(value.parameters, Object.keys(SCRYPT_PROFILE)) ||
    Object.entries(SCRYPT_PROFILE).some(([key, expected]) => (value.parameters as Record<string, unknown>)[key] !== expected)) throw invalid();
  return Object.freeze({ version: 1, username: value.username, revision: value.revision, salt: value.salt, hash: value.hash, parameters: SCRYPT_PROFILE });
}
type Derive = (password: string, salt: Buffer) => Promise<Buffer>;
const derive: Derive = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, SCRYPT_PROFILE.keyLength, SCRYPT_PROFILE, (error, hash) => error ? reject(error) : resolve(hash));
});

/** One active hash process-wide, including future offline credential creation; no queue. */
let hashing = false;
async function exclusiveHash(password: string, salt: Buffer, work: Derive): Promise<Buffer> {
  if (hashing) throw new AuthCoreError("AUTH_BUSY", 1);
  hashing = true;
  try { return await work(password, salt); }
  finally { hashing = false; }
}

/** Fixed counters, independent of attacker-controlled usernames/IPs. */
export class AuthAttemptWindow {
  #start: number | undefined;
  #last = 0;
  #attempts = 0;
  constructor(private readonly now: MonotonicNow = () => performance.now()) {}
  admit(): void {
    const time = this.now();
    if (!Number.isFinite(time) || time < this.#last) throw invalid();
    this.#last = time;
    if (this.#start === undefined || time - this.#start >= 300_000) { this.#start = time; this.#attempts = 0; }
    if (this.#attempts >= 5) throw new AuthCoreError("AUTH_RATE_LIMITED", Math.max(1, Math.ceil((300_000 - (time - this.#start)) / 1000)));
    this.#attempts++;
  }
  success(): void { this.#start = undefined; this.#attempts = 0; }
}
const processAttempts = new AuthAttemptWindow();

/** Backend-only verifier: neither record nor password is exposed in its result/errors. */
export class PasswordVerifier {
  #record: CredentialRecord;
  #dummySalt = randomBytes(16);
  #dummyHash = randomBytes(64);
  #attempts: AuthAttemptWindow;
  #work: Derive;
  constructor(record: CredentialRecord, attempts = processAttempts, work: Derive = derive) {
    this.#record = parseCredentialRecord(record);
    this.#attempts = attempts;
    this.#work = work;
  }
  async verify(username: unknown, password: unknown): Promise<{ revision: string }> {
    if (!validUsername(username) || !validPassword(password)) throw invalid();
    if (hashing) throw new AuthCoreError("AUTH_BUSY", 1);
    this.#attempts.admit();
    const known = username === this.#record.username;
    const expected = known ? Buffer.from(this.#record.hash, "hex") : this.#dummyHash;
    const actual = await exclusiveHash(password, known ? Buffer.from(this.#record.salt, "hex") : this.#dummySalt, this.#work);
    try {
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || !known) throw invalid();
      this.#attempts.success();
      return { revision: this.#record.revision };
    } finally { actual.fill(0); }
  }
}

/** In-memory preparation only. No file writer or setup/reset entry point is enabled. */
export async function prepareCredentialRecord(username: string, password: string): Promise<CredentialRecord> {
  if (!validUsername(username) || !validPassword(password, true)) throw invalid();
  const salt = randomBytes(16);
  const hash = await exclusiveHash(password, salt, derive);
  try { return parseCredentialRecord({ version: 1, username, revision: randomUUID(), salt: salt.toString("hex"), hash: hash.toString("hex"), parameters: SCRYPT_PROFILE }); }
  finally { hash.fill(0); }
}
