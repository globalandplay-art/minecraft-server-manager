import { describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ error: null as unknown, output: "" }));
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => {
  expect(args[2]).toMatchObject({ timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true });
  expect(args[2]).not.toHaveProperty("shell");
  const callback = args[3] as (error: unknown, stdout: string) => void;
  callback(native.error, native.output);
} }));
import { AclDiagnosticError, classifyAclHelperFailure, WindowsPrivateAclVerifier } from "../../src/auth/windows-private-acl.js";

describe("bounded ACL diagnostic classification", () => {
  it.each([
    [{ code: "ENOENT", syscall: "spawn secret-path" }, "helper-start"],
    [{ killed: true, signal: "SIGTERM" }, "helper-timeout"],
    [{ code: 1 }, "helper-exit"],
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGTERM" }, "helper-output-limit"],
    [{ message: "secret-stderr" }, "helper-unknown"],
  ])("classifies helper failures without retaining input", (input, category) => {
    expect(classifyAclHelperFailure(input)).toBe(category);
  });
  it.each([
    [{ code: "ENOENT", syscall: "spawn secret-path" }, "", "helper-start"],
    [{ killed: true, signal: "SIGTERM" }, "", "helper-timeout"],
    [{ code: 1, message: "secret-stderr", path: "secret-path" }, "", "helper-exit"],
    [null, "secret-content", "json-parse"],
    [null, "{}", "json-shape"],
    [null, "[{}]", "acl-rejected"],
  ])("keeps native verify failures sanitized and fail closed", async (error, output, category) => {
    native.error = error; native.output = output;
    try { await new WindowsPrivateAclVerifier().verify("secret-path"); expect.fail("must reject"); }
    catch (failure) {
      expect(failure).toMatchObject({ code: "AUTH_PRIVATE_UNSAFE", category });
      const text = String(failure) + JSON.stringify(failure);
      for (const secret of ["secret-path", "secret-stderr", "secret-content"]) expect(text).not.toContain(secret);
    }
  });
  it("bounds category values even at a runtime trust boundary", () => {
    const error = new AclDiagnosticError("secret-path" as "helper-start");
    expect(error.category).toBe("helper-unknown");
    expect(String(error) + JSON.stringify(error)).not.toContain("secret-path");
  });
});
