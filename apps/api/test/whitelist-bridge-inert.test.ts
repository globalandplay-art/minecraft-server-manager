import { expect, it } from "vitest";
import { InertBridgeFrames, inertBrokerScript } from "./fixtures/whitelist-bridge-inert-probe.mjs";

const frame = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
it("accepts exactly started then silent exit37, including split chunks, without starting any process", () => {
  const f = new InertBridgeFrames(), bytes = Buffer.concat([frame({ phase: "started", pid: 123 }), frame({ phase: "closed", exitCode: 37, silent: true })]);
  f.stdout(bytes.subarray(0, 7)); f.stdout(bytes.subarray(7)); f.finish();
  expect(f.fault).toBeNull(); expect(f.completed).toBe(true); expect(f.targetClosed).toBe(true);
});
it.each([
  [{ phase: "closed", exitCode: 37, silent: true }],
  [{ phase: "started", pid: 0 }], [{ phase: "started", pid: 123, path: "PRIVATE_SENTINEL" }],
  [{ phase: "started", pid: 123 }, { phase: "started", pid: 123 }],
  [{ phase: "started", pid: 123 }, { phase: "closed", exitCode: 0, silent: true }],
  [{ phase: "started", pid: 123 }, { phase: "closed", exitCode: 37, silent: false }]
])("rejects unknown, reordered, duplicated or unsuccessful metadata %j", (...rows) => {
  const f = new InertBridgeFrames(); for (const row of rows) f.stdout(frame(row)); f.finish();
  expect(f.fault).not.toBeNull(); expect(f.targetClosed).toBe(false);
});
it("never infers target close from a failed broker that lost its started event", () => {
  const f = new InertBridgeFrames(); f.stdout(frame({ phase: "failed", stage: "start", targetClosed: true })); f.finish();
  expect(f.fault).toBe("BROKER_FAILED"); expect(f.targetClosed).toBe(false);
});
it("bounds total output and refuses incomplete or invalid UTF8 data", () => {
  for (const bytes of [Buffer.alloc(4097, 65), Buffer.from([255, 10]), Buffer.from("{")]) {
    const f = new InertBridgeFrames(); f.stdout(bytes); f.finish(); expect(f.fault).not.toBeNull(); expect(f.targetClosed).toBe(false);
  }
});
it("builds only fixed inert ProcessStartInfo work, no ACL queries, Job control or extra shell", () => {
  const script = inertBrokerScript("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  expect(script).toContain("UseShellExecute=$false"); expect(script).toContain("CreateNoWindow=$true");
  expect(script).not.toMatch(/Get-Acl|Add-Type|Start-Process|JobObject|\.Kill\(|ReadToEnd/u);
});
