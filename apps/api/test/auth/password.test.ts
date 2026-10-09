import { describe, expect, it, vi } from "vitest";
import { AuthAttemptWindow, parseCredentialRecord, PasswordVerifier, prepareCredentialRecord, SCRYPT_PROFILE, validPassword } from "../../src/auth/password.js";

const record = () => parseCredentialRecord({ version: 1, username: "admin", revision: "12345678-1234-4234-8234-123456789abc", salt: "ab".repeat(16), hash: "cd".repeat(64), parameters: SCRYPT_PROFILE });
describe("private password verifier", () => {
  it("uses the real frozen production scrypt profile, fresh salt/revision and preserves raw spaces", async () => {
    const password = "  password with spaces  ";
    const first = await prepareCredentialRecord("admin", password);
    const second = await prepareCredentialRecord("admin", password);
    expect(first.parameters).toEqual({ N: 131072, r: 8, p: 1, keyLength: 64, maxmem: 268435456 });
    expect(first.salt).not.toBe(second.salt); expect(first.revision).not.toBe(second.revision);
    const verifier = new PasswordVerifier(first, new AuthAttemptWindow());
    expect(await verifier.verify("admin", password)).toEqual({ revision: first.revision });
    await expect(verifier.verify("admin", password.trim())).rejects.toMatchObject({ code: "AUTH_INVALID" });
    await expect(verifier.verify("unknown", password)).rejects.toMatchObject({ code: "AUTH_INVALID" });
    expect(JSON.stringify(verifier)).toBe("{}");
  });
  it("bounds code points/UTF8, accepts spaces/emoji and refuses implicit normalization/unpaired surrogates", () => {
    expect(validPassword(" ".repeat(15), true)).toBe(true);
    expect(validPassword("😀".repeat(128), true)).toBe(true);
    expect(validPassword("😀".repeat(129), true)).toBe(false);
    expect(validPassword("x".repeat(14), true)).toBe(false);
    expect(validPassword("x".repeat(15) + "\ud800", true)).toBe(false);
    expect(validPassword("é".repeat(128), true)).toBe(true);
  });
  it.each([
    { version: 2 }, { hash: "x".repeat(128) }, { salt: "aa".repeat(15) }, { username: "../../admin" },
    { parameters: { ...SCRYPT_PROFILE, N: 262144 } }, { parameters: { ...SCRYPT_PROFILE, p: 2 } },
    { parameters: { ...SCRYPT_PROFILE, maxmem: 1024 ** 3 } }, { parameters: { ...SCRYPT_PROFILE, keyLength: 32 } },
    { unexpected: "secret" }
  ])("rejects altered record/profile before hashing: %j", (change) => {
    expect(() => parseCredentialRecord({ ...record(), ...change })).toThrow("AUTH_INVALID");
  });
  it("admits five attempts globally across usernames, resets only on verified success and uses fixed monotonic window", async () => {
    let now = 0; const attempts = new AuthAttemptWindow(() => now);
    const work = vi.fn(async () => Buffer.alloc(64)); const verifier = new PasswordVerifier(record(), attempts, work);
    for (let n = 0; n < 5; n++) await expect(verifier.verify(n % 2 ? "unknown" : "admin", "wrong")).rejects.toMatchObject({ code: "AUTH_INVALID" });
    await expect(verifier.verify("admin", "wrong")).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", retryAfterSeconds: 300 });
    expect(work).toHaveBeenCalledTimes(5); now = 300_000;
    work.mockImplementation(async () => Buffer.from(record().hash, "hex"));
    await verifier.verify("admin", "right");
    work.mockImplementation(async () => Buffer.alloc(64));
    for (let n = 0; n < 5; n++) await expect(verifier.verify("admin", "wrong")).rejects.toMatchObject({ code: "AUTH_INVALID" });
    expect(work).toHaveBeenCalledTimes(11);
    now--; await expect(verifier.verify("admin", "wrong")).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });
  it("runs equivalent dummy work and admits no queued/busy attempt across verifier instances", async () => {
    let release!: (value: Buffer) => void;
    const blocked = vi.fn(() => new Promise<Buffer>((resolve) => { release = resolve; }));
    const first = new PasswordVerifier(record(), new AuthAttemptWindow(), blocked);
    const work = vi.fn(async () => Buffer.alloc(64)); const attempts = new AuthAttemptWindow();
    const second = new PasswordVerifier(record(), attempts, work);
    const pending = first.verify("admin", "password");
    for (let n = 0; n < 8; n++) await expect(second.verify("unknown", "password")).rejects.toMatchObject({ code: "AUTH_BUSY", retryAfterSeconds: 1 });
    expect(work).not.toHaveBeenCalled(); release(Buffer.alloc(64));
    await expect(pending).rejects.toMatchObject({ code: "AUTH_INVALID" });
    for (let n = 0; n < 5; n++) await expect(second.verify("unknown", "password")).rejects.toMatchObject({ code: "AUTH_INVALID" });
    expect(work).toHaveBeenCalledTimes(5);
    expect(blocked.mock.calls[0]?.[1]).toHaveLength(16); expect(work.mock.calls[0]?.[1]).toHaveLength(16);
  });
  it("hash errors release the global slot and unequal output never enters timingSafeEqual", async () => {
    const verifier = new PasswordVerifier(record(), new AuthAttemptWindow(), async () => { throw new Error("hash-unavailable"); });
    await expect(verifier.verify("admin", "password")).rejects.toThrow("hash-unavailable");
    await expect(new PasswordVerifier(record(), new AuthAttemptWindow(), async () => Buffer.alloc(32)).verify("admin", "password")).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });
});
