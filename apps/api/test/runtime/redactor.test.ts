import { describe, expect, it } from "vitest";

import { createRedactor, REDACTED } from "../../src/infra/runtime/redactor.js";

describe("runtime redactor", () => {
  it("redacts the current RCON secret as literal text", () => {
    let secret = "p@ss[with].regex$";
    const redactor = createRedactor({ secrets: () => [secret] });

    expect(redactor.redactText(`auth failed for ${secret}`)).toBe(`auth failed for ${REDACTED}`);
    secret = "rotated-secret";
    expect(redactor.redactText("rotated-secret rejected")).toBe(`${REDACTED} rejected`);
  });

  it("redacts common credential forms and bearer tokens", () => {
    const redactor = createRedactor();
    const text = redactor.redactText(
      'password="hunter2" token=abc123 Authorization: Bearer.header.payload rcon_password=secret-value'
    );

    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("Bearer.header.payload");
    expect(text).not.toContain("secret-value");
    expect(text.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("deeply redacts sensitive keys without mutating the input", () => {
    const input = {
      user: "steve",
      password: "plain",
      nested: { apiToken: "token-value", message: "password=also-secret" }
    };
    const redactor = createRedactor();
    const result = redactor.redactValue(input);

    expect(result).toEqual({
      user: "steve",
      password: REDACTED,
      nested: { apiToken: REDACTED, message: `password=${REDACTED}` }
    });
    expect(input.password).toBe("plain");
  });

  it("returns a fixed public error message without paths or raw diagnostics", () => {
    const redactor = createRedactor({ secrets: () => ["rcon-secret"] });
    const error = new Error("RCON rcon-secret failed");
    error.stack = "absolute path and rcon-secret";

    expect(redactor.publicError(error)).toBe("运行时操作失败。");
    expect(redactor.publicError(error)).not.toContain("RCON");
    expect(redactor.publicError(error)).not.toContain("absolute path");
  });
});
