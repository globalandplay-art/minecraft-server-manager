import { execFile } from "node:child_process";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import type { Metrics } from "@mcsm/contracts";

export interface ProcessCounters { pid: number; startTicks: string; cpuMs: number; rssBytes: number; executable: string }
export type ProcessCounterReader = (pid: number) => Promise<ProcessCounters>;
const unavailable = (reason: string) => ({ status: "unavailable" as const, value: null, source: null, sampledAt: null, reason });

export const readWindowsProcessCounters: ProcessCounterReader = async (pid) => {
  if (process.platform !== "win32") throw new Error("process-platform-unavailable");
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("invalid-process-id");
  // Fixed local read-only script. The only interpolation is a validated integer PID.
  const script = `$ErrorActionPreference='Stop'; $p=Get-Process -Id ${pid}; $p.Refresh(); ` +
    `[ordered]@{pid=$p.Id;startTicks=$p.StartTime.ToUniversalTime().Ticks.ToString();cpuMs=$p.TotalProcessorTime.TotalMilliseconds;rssBytes=$p.WorkingSet64;executable=$p.MainModule.FileName}|ConvertTo-Json -Compress`;
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 2500, maxBuffer: 4096, encoding: "utf8" }, (error, out) => error ? reject(error) : resolve(out));
  });
  const value: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ""));
  if (typeof value !== "object" || !value || !("pid" in value) || !("startTicks" in value) ||
    !("cpuMs" in value) || !("rssBytes" in value) || !("executable" in value) || value.pid !== pid ||
    typeof value.startTicks !== "string" || !/^\d{16,20}$/.test(value.startTicks) ||
    typeof value.cpuMs !== "number" || !Number.isFinite(value.cpuMs) || value.cpuMs < 0 ||
    typeof value.rssBytes !== "number" || !Number.isSafeInteger(value.rssBytes) || value.rssBytes < 0 ||
    typeof value.executable !== "string") throw new Error("invalid-process-counters");
  return { pid, startTicks: value.startTicks, cpuMs: value.cpuMs, rssBytes: value.rssBytes, executable: value.executable };
};

export class ProcessResourceSampler {
  #previous: { signature: string; time: number; cpuMs: number } | undefined;
  constructor(readonly read: ProcessCounterReader = readWindowsProcessCounters,
    readonly monotonicNow: () => number = () => performance.now(), readonly logicalProcessors = cpus().length) {}

  reset(): void { this.#previous = undefined; }

  async sample(pid: number, executable: string, sampledAt: string | (() => string),
    stillOwned: () => boolean, launchWindow?: { earliest: number; latest: number }): Promise<Pick<Metrics, "cpu" | "ram">> {
    try {
      const counters = await this.read(pid);
      const startedMs = Number((BigInt(counters.startTicks) - 621355968000000000n) / 10000n);
      if (!stillOwned() || counters.pid !== pid || counters.executable.toLowerCase() !== executable.toLowerCase() ||
        (launchWindow && (startedMs < launchWindow.earliest || startedMs > launchWindow.latest))) {
        this.reset(); return { cpu: unavailable("process-identity-changed"), ram: unavailable("process-identity-changed") };
      }
      const time = this.monotonicNow(); const signature = `${pid}:${counters.startTicks}`;
      const observedAt = typeof sampledAt === "function" ? sampledAt() : sampledAt;
      const previous = this.#previous;
      this.#previous = { signature, time, cpuMs: counters.cpuMs };
      let cpu: Metrics["cpu"] = unavailable("cpu-baseline-pending");
      if (previous?.signature === signature && time > previous.time && counters.cpuMs >= previous.cpuMs &&
        Number.isSafeInteger(this.logicalProcessors) && this.logicalProcessors > 0) {
        const value = (counters.cpuMs - previous.cpuMs) / (time - previous.time) / this.logicalProcessors * 100;
        if (Number.isFinite(value) && value >= 0 && value <= 100) cpu = { status: "available", source: "process", sampledAt: observedAt, value };
      }
      return { cpu, ram: { status: "available", source: "process", sampledAt: observedAt, value: { rssBytes: counters.rssBytes } } };
    } catch {
      this.reset(); return { cpu: unavailable("process-probe-unavailable"), ram: unavailable("process-probe-unavailable") };
    }
  }
}
