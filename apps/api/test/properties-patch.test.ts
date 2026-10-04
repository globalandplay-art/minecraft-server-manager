import { describe, expect, it } from "vitest";
import { patchPropertiesExact } from "../src/services/properties-patch.js";
describe("exact properties text preparation", () => {
  it.each(["\ud800", "\udfff"])("rejects lone surrogates before UTF8 would change the requested value", (motd) => {
    expect(() => patchPropertiesExact("motd=old\n", { motd })).toThrowError(expect.objectContaining({ code: "PROPERTIES_PATCH_INVALID" }));
  });
  it.each(["pvp=false\n# comment\\\npvp=true\n", "motd=\\uu0041\n", "motd=unfinished\\"])("rejects ambiguous legacy grammar before patching", (text) => {
    expect(() => patchPropertiesExact(text, { pvp: "false" })).toThrowError(expect.objectContaining({ code: "PROPERTIES_PATCH_INVALID" }));
  });
  it("changes only the last effective target and preserves mixed terminators/secret bytes", () => {
    const text = "# first\r\nmotd=old\npvp=true\rrcon.password=private-fixture\r\nmotd: last\n! final comment";
    expect(patchPropertiesExact(text, { motd: "New" })).toBe("# first\r\nmotd=old\npvp=true\rrcon.password=private-fixture\r\nmotd=New\n! final comment");
  });
  it("recognizes escaped keys and a target continuation without rewriting the following line", () => {
    const text = "\\u006d\\u006f\\u0074\\u0064=first\\\r\n  second\rpvp=true\n";
    expect(patchPropertiesExact(text, { motd: "Hello" })).toBe("motd=Hello\rpvp=true\n");
  });
  it("keeps CR-only layout and no trailing newline", () => {
    expect(patchPropertiesExact("# hi\rpvp=true\rmotd=old", { motd: "New" })).toBe("# hi\rpvp=true\rmotd=New");
  });
  it("preserves non-target continuation and equals/comment characters in values", () => {
    const text = "rcon.password=private\\\r\n  fixture\r\nmotd=old\n";
    expect(patchPropertiesExact(text, { motd: " #Hello=world:\\你好" })).toBe("rcon.password=private\\\r\n  fixture\r\nmotd=\\ #Hello=world:\\\\你好\n");
  });
  it("appends a missing field without changing the old byte prefix", () => {
    expect(patchPropertiesExact("# hi\rpvp=true", { motd: "Hello" })).toBe("# hi\rpvp=true\rmotd=Hello\r");
    expect(patchPropertiesExact("", { pvp: "true" })).toBe("pvp=true\n");
  });
  it("does nothing for an empty change set", () => {
    const text = "# mixed\r\nrcon.password=private-fixture\nmotd=old\r";
    expect(patchPropertiesExact(text, {})).toBe(text);
  });
  it.each([{ "rcon.password": "x" }, { "level-name": "new-world" }, { motd: "x\ny" }, { motd: "x\0" }, { motd: "x".repeat(1025) }])("rejects forbidden keys or values", (changes) => {
    expect(() => patchPropertiesExact("pvp=true\n", changes)).toThrowError(expect.objectContaining({ code: "PROPERTIES_PATCH_INVALID" }));
  });
  it("rejects malformed source escapes", () => {
    expect(() => patchPropertiesExact("rcon.password=\\uZZZZ\n", { motd: "Hello" })).toThrowError(expect.objectContaining({ code: "PROPERTIES_PATCH_INVALID" }));
  });
});
