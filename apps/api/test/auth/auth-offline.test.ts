import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseOfflineOptions, readHiddenPassword } from "../../src/cli/auth-offline.js";

describe("offline explicit options and hidden input", () => {
  it("requires explicit action/username and forbids argv/environment secrets", () => {
    expect(parseOfflineOptions(["init", "--username", "admin"], {}).action).toBe("init");
    expect(parseOfflineOptions(["recover"], {}).action).toBe("recover");
    for (const args of [[], ["auto"], ["init"], ["init", "--username", "admin", "--password", "secret"], ["reset", "--username", "admin", "rawpassword"], ["recover", "--username", "admin"]]) {
      expect(() => parseOfflineOptions(args, {})).toThrow();
    }
    for (const key of ["MCSM_PASSWORD", "MCSM_AUTH_PASSWORD", "MCSM_AUTH_SECRET", "MCSM_CREDENTIAL"]) expect(() => parseOfflineOptions(["init", "--username", "admin"], { [key]: "secret" })).toThrow("OFFLINE_SECRET_SOURCE_REJECTED");
  });
  it("refuses non-TTY input before any credential action", async () => {
    await expect(readHiddenPassword("hidden", new PassThrough() as unknown as typeof process.stdin, new PassThrough() as unknown as typeof process.stdout)).rejects.toThrow("OFFLINE_TTY_REQUIRED");
  });
  it("does not echo raw password, preserves spaces/Unicode/backspace and restores terminal mode", async () => {
    const input = new PassThrough() as unknown as typeof process.stdin;
    Object.assign(input, { isTTY: true, isRaw: false, setRawMode: (value: boolean) => { input.isRaw = value; return input; } });
    const output = new PassThrough() as unknown as typeof process.stdout; Object.assign(output, { isTTY: true });
    let visible = ""; output.on("data", (value: Buffer) => { visible += value.toString("utf8"); });
    const reading = readHiddenPassword("hidden: ", input, output);
    input.emit("data", "  password😀x\u007f"); input.emit("data", " \r");
    expect(await reading).toBe("  password😀 "); expect(visible).toBe("hidden: \n"); expect(input.isRaw).toBe(false);
  });
  it("cancels on EOF/control input and refuses multiline paste, restoring terminal mode", async () => {
    for (const event of ["eof", "\u0003", "password\rsecond"]) {
      const input = new PassThrough() as unknown as typeof process.stdin;
      Object.assign(input, { isTTY: true, isRaw: false, setRawMode: (value: boolean) => { input.isRaw = value; return input; } });
      const output = new PassThrough() as unknown as typeof process.stdout; Object.assign(output, { isTTY: true });
      const reading = readHiddenPassword("hidden: ", input, output);
      if (event === "eof") input.emit("end"); else input.emit("data", event);
      await expect(reading).rejects.toThrow(); expect(input.isRaw).toBe(false);
    }
  });
});
