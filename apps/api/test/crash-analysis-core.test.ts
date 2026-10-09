import { describe, expect, it } from "vitest";
import { analyzeCrashEvidence } from "../src/services/crash-analysis-core.js";

describe("bounded possible crash causes", () => {
  it("preserves uncertainty, source coordinates and independent causes", () => {
    const result = analyzeCrashEvidence([{ id: "latest-log", source: "latest-log", truncated: false,
      text: "java.lang.OutOfMemoryError: Java heap space\nFAILED TO BIND TO PORT\nUnsupportedClassVersionError" }], []);
    expect(result.findings.map((item) => item.code)).toEqual(["out-of-memory", "port-bind", "java-version"]);
    expect(result.findings.every((item) => item.confidence === "possible")).toBe(true);
    expect(result.findings[1]?.evidence[0]).toMatchObject({ sourceId: "latest-log", excerptLine: 2 });
  });
  it("redacts known unlabelled credentials, inline tokens, URLs and absolute paths before cropping", () => {
    const result = analyzeCrashEvidence([{ id: "crash-1", source: "crash-report", truncated: false,
      text: 'OutOfMemoryError rcon-secret token=abc Bearer bearer-secret https://user:pass@example.test/api\nOutOfMemoryError C:\\Users\\My Name\\private\\server.jar' }], ["rcon-secret"]);
    const output = JSON.stringify(result);
    for (const value of ["rcon-secret", "abc", "bearer-secret", "example.test", "My Name", "server.jar"]) expect(output).not.toContain(value);
    expect(output).toContain("[REDACTED]"); expect(output).toContain("[PATH]");
  });
  it("does not match a secret disguised as a diagnostic or infer causes from unknown ERROR", () => {
    expect(analyzeCrashEvidence([{ id: "latest-log", source: "latest-log", truncated: false,
      text: "ERROR unrelated\nOutOfMemoryError" }], ["OutOfMemoryError"]).findings).toEqual([]);
  });
  it("omits oversized lines, records incompleteness and limits repeated evidence", () => {
    const result = analyzeCrashEvidence([{ id: "latest-log", source: "latest-log", truncated: false,
      text: "OutOfMemoryError " + "x".repeat(5000) + "\n" + "OutOfMemoryError\n".repeat(20) }], []);
    expect(result.incomplete).toBe(true); expect(result.findings[0]?.evidence).toHaveLength(2);
    expect(result.findings[0]?.evidence[0]?.excerptLine).toBe(2);
    expect(() => analyzeCrashEvidence([{ id: "x", source: "latest-log", truncated: false, text: "x".repeat(65537) }], [])).toThrow("input-limit");
  });
  it("does not diagnose a healthy or empty snapshot", () => {
    expect(analyzeCrashEvidence([], [])).toMatchObject({ conclusion: "no-rule-match", findings: [], incomplete: false });
    const result = analyzeCrashEvidence([{ id: "x", source: "latest-log", truncated: false,
      text: 'Done (1.234s)! For help, type "help"' }], []);
    expect(result.conclusion).toBe("no-rule-match");
  });
  it("redacts credentials reconstructed by ANSI/control normalization", () => {
    const result = analyzeCrashEvidence([{ id: "x", source: "latest-log", truncated: false,
      text: "OutOfMemoryError abc\u001b[31mdef\nOutOfMemoryError abc\u0000def" }], ["abcdef"]);
    expect(JSON.stringify(result)).not.toContain("abcdef");
    expect(result.findings[0]?.evidence.every((item) => item.snippet.includes("[REDACTED]"))).toBe(true);
  });
  it("redacts multiline known secrets before splitting evidence", () => {
    const result = analyzeCrashEvidence([{ id: "x", source: "latest-log", truncated: false,
      text: "OutOfMemoryError private\nsecond-secret-part\nFAILED TO BIND TO PORT" }], ["private\nsecond-secret-part"]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("second-secret-part");
    expect(result.findings.map((item) => item.code)).toEqual(["out-of-memory", "port-bind"]);
  });
  it("suppresses file URI paths as well as Windows, UNC and POSIX paths", () => {
    for (const value of ["file:/private/server.jar", "file:///private/server.jar", "file:/C:/private/server.jar", "\\\\host\\private\\server.jar", "/private/server.jar"]) {
      const result = analyzeCrashEvidence([{ id: "x", source: "latest-log", truncated: false, text: `OutOfMemoryError ${value}` }], []);
      expect(JSON.stringify(result)).not.toContain("server.jar"); expect(result.findings).toHaveLength(1);
    }
  });
  it("emits no snippets or inferred causes from head/tail truncated multiline-secret fragments", () => {
    for (const text of ["OutOfMemoryError known-rcon-part-0123456789\nremaining-", "remaining-secret-part OutOfMemoryError"]) {
      const result = analyzeCrashEvidence([{ id: "x", source: "crash-report", truncated: true, text }], ["known-rcon-part-0123456789\nremaining-secret-part"]);
      expect(result).toEqual({ findings: [], incomplete: true, conclusion: "insufficient-evidence" });
    }
  });
  it("allows complete sources without using a neighboring truncated source", () => {
    const result = analyzeCrashEvidence([
      { id: "partial", source: "latest-log", truncated: true, text: "OutOfMemoryError secret-fragment" },
      { id: "whole", source: "crash-report", truncated: false, text: "FAILED TO BIND TO PORT" }
    ], []);
    expect(result.findings.map((item) => item.code)).toEqual(["port-bind"]);
    expect(result.findings[0]?.evidence[0]?.sourceId).toBe("whole");
    expect(JSON.stringify(result)).not.toContain("secret-fragment"); expect(result.incomplete).toBe(true);
  });
});
