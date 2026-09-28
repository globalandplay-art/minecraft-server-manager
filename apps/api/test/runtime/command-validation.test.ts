import { describe, expect, it } from "vitest";

import {
  CommandValidationError,
  MAX_COMMAND_BYTES,
  validateMinecraftCommand
} from "../../src/infra/runtime/command-validation.js";

describe("Minecraft command validation", () => {
  it("accepts one ordinary line without rewriting it", () => {
    expect(validateMinecraftCommand("say  你好 world ")).toBe("say  你好 world ");
  });

  it.each(["", "   ", "say first\nstop", "say first\rstop", "say\0stop", "say\u0007stop"])(
    "rejects empty or control-bearing input %#",
    (command) => {
      expect(() => validateMinecraftCommand(command)).toThrow(CommandValidationError);
    }
  );

  it("measures the limit in UTF-8 bytes", () => {
    expect(Buffer.byteLength("你".repeat(341), "utf8")).toBeLessThanOrEqual(MAX_COMMAND_BYTES);
    expect(validateMinecraftCommand("你".repeat(341))).toHaveLength(341);
    expect(() => validateMinecraftCommand("你".repeat(342))).toThrow("1024 UTF-8 字节");
  });
});
