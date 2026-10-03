import { describe, expect, it } from "vitest";
import { classifyDiagnosticText, diagnosticsAllowed, readinessRequirements } from "../../../tests/acceptance/import-diagnostics.mjs";

const warning = "[12:34:56] [Server thread/WARN]: Can't keep up! Is the server overloaded? Running 3081ms or 61 ticks behind";
const ready = Object.fromEntries(readinessRequirements.map((key: string) => [key, true]));
const classify = (stdout: string, stderr = "", log = "", captureOverflow = false) =>
  classifyDiagnosticText({ stdout, stderr, log, captureOverflow });

describe("real Import acceptance diagnostics", () => {
  it("permits only exact timing warnings after complete verified readiness", () => {
    const result = classify(warning);
    expect(result.classifiedMinecraftWarnings).toEqual([{ classification: "minecraft-cant-keep-up", text: warning,
      sources: ["stdout"], occurrences: [{ source: "stdout", line: 1 }] }]);
    expect(result.blockingMinecraftWarnings).toEqual([]); expect(result.unclassifiedWarnings).toEqual([]);
    expect(diagnosticsAllowed(result, ready)).toBe(true);
    expect(diagnosticsAllowed(result)).toBe(false);
  });
  it("deduplicates summaries across surfaces and retains every raw occurrence", () => {
    const input = { stdout: warning + "\r\n" + warning, log: warning, stderr: "" };
    const original = { ...input }; const result = classifyDiagnosticText(input);
    expect(input).toEqual(original);
    expect(result.minecraftWarnings).toEqual([warning]);
    expect(result.classifiedMinecraftWarnings[0].sources).toEqual(["latest.log", "stdout"]);
    expect(result.classifiedMinecraftWarnings[0].occurrences).toHaveLength(3);
    expect(result.unclassifiedWarnings).toEqual([]);
  });
  it("keeps different timestamps and counts as distinct events", () => {
    const other = warning.replace("12:34:56", "12:35:20").replace("3081ms", "3200ms");
    expect(classify(warning + "\n" + other).classifiedMinecraftWarnings).toHaveLength(2);
  });
  it.each([
    warning + " extra", " " + warning, warning.replace("Server thread", "Worker thread"),
    warning.replace("3081ms", "3.081ms"), warning.replace("61 ticks", "-61 ticks"),
    warning.replace("12:34:56", "99:99:99"), warning.replace("Can't keep up!", "Can't keep something else!"),
    "[Server thread/WARN]: Can't keep up! Is the server overloaded? Running 3081ms or 61 ticks behind",
    "[12:34:56] [Server thread/WARN]: Some unrelated warning"
  ])("blocks non-exact or unrelated Minecraft warning: %s", (text) => {
    const result = classify(text); expect(result.blockingMinecraftWarnings).toEqual([text]);
    expect(diagnosticsAllowed(result, ready)).toBe(false);
  });
  it.each([
    "[12:34:57] [Server thread/ERROR]: bad world", "ERROR failure on stderr",
    "Perflib 009", "Unable to locate English counter names", "HkeyPerformanceDataUtil failure",
    "Win32Exception", "ERROR_INVALID_PARAMETER", "Error 0x80070057", "COM exception querying Win32_Processor",
    "Encountered an unexpected exception", "A crash report has been saved",
    "[12:34:57] [Server thread/WARN]: Failed to load", "WARNING: new unknown Java warning"
  ])("blocks timing warning accompanied by diagnostic: %s", (text) => {
    expect(diagnosticsAllowed(classify(warning, text), ready)).toBe(false);
  });
  it.each(readinessRequirements)("blocks when readiness requirement %s is missing or false", (key: string) => {
    expect(diagnosticsAllowed(classify(warning), { ...ready, [key]: false })).toBe(false);
    const incomplete = { ...ready }; delete incomplete[key];
    expect(diagnosticsAllowed(classify(warning), incomplete)).toBe(false);
  });
  it("blocks overflow and re-evaluates late errors after previously verified startup", () => {
    expect(diagnosticsAllowed(classify(warning, "", "", true), ready)).toBe(false);
    expect(diagnosticsAllowed(classify(warning + "\nERROR after normal stop"), ready)).toBe(false);
  });
  it("blocks premature clean exit or shutdown despite previously verified readiness", () => {
    const result = classifyDiagnosticText({ stdout: warning, prematureExit: true });
    expect(diagnosticsAllowed(result, ready)).toBe(false);
    // Later cleanup authorization cannot erase a captured premature exit.
    expect(diagnosticsAllowed({ ...result, shutdownAuthorized: true }, ready)).toBe(false);
    expect(diagnosticsAllowed(classify(warning + "\n[12:35:00] [Server thread/INFO]: Stopping server"), ready)).toBe(false);
  });
  it("uses historical verified startup only for an explicitly authorized normal stop", () => {
    const input = { stdout: warning + "\n[12:35:00] [Server thread/INFO]: Stopping server", shutdownAuthorized: true };
    const result = classifyDiagnosticText(input);
    expect(diagnosticsAllowed(result, ready)).toBe(true);
    expect(diagnosticsAllowed(result)).toBe(false);
    for (const late of ["ERROR after stop", "Perflib 009", "WARNING: unknown", "[12:35:02] [Server thread/WARN]: unrelated"]) {
      expect(diagnosticsAllowed(classifyDiagnosticText({ ...input, stdout: input.stdout + "\n" + late }), ready)).toBe(false);
    }
  });
  it("preserves the two precise Java 25 warning blocks without permitting variants", () => {
    const jna = "WARNING: A restricted method in java.lang.System has been called\n" +
      "WARNING: java.lang.System::load has been called by com.sun.jna.Native in an unnamed module (file:/isolation/libraries/net/java/dev/jna/jna/5.17.0/jna-5.17.0.jar)\n" +
      "WARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module\n" +
      "WARNING: Restricted methods will be blocked in a future release unless native access is enabled";
    const joml = "WARNING: A terminally deprecated method in sun.misc.Unsafe has been called\n" +
      "WARNING: sun.misc.Unsafe::objectFieldOffset has been called by org.joml.MemUtil$MemUtilUnsafe (file:/isolation/libraries/org/joml/joml/1.10.9/joml-1.10.9.jar)\n" +
      "WARNING: Please consider reporting this to the maintainers of class org.joml.MemUtil$MemUtilUnsafe\n" +
      "WARNING: sun.misc.Unsafe::objectFieldOffset will be removed in a future release";
    const result = classify(warning, jna + "\n" + joml);
    expect(result.classifiedJavaWarnings.map((item: { classification: string }) => item.classification))
      .toEqual(["java25-jna-native-access", "java25-joml-unsafe-deprecation"]);
    expect(diagnosticsAllowed(result, ready)).toBe(true);
    expect(diagnosticsAllowed(classify(warning, jna.replace("5.17.0", "5.18.0")), ready)).toBe(false);
  });
});
