import { describe, expect, it } from "vitest";
import { ProcessResourceSampler, readWindowsProcessCounters, type ProcessCounters } from "../../src/infra/runtime/process-resources.js";
const initial: ProcessCounters = { pid: 42, startTicks: "621355968010000000", cpuMs: 100, rssBytes: 2048, executable: "C:\\java.exe" };
const stamp = "2026-10-08T00:00:00Z";
describe("owned Minecraft process resource arithmetic", () => {
  it("requires CPU baseline and normalizes the delta to all logical processors", async () => {
    let time = 0; let counters = { ...initial };
    const sampler = new ProcessResourceSampler(async () => counters, () => time, 4);
    expect(await sampler.sample(42, initial.executable, stamp, () => true)).toMatchObject({ cpu: { status: "unavailable" }, ram: { value: { rssBytes: 2048 } } });
    time = 1000; counters = { ...counters, cpuMs: 1100 };
    expect(await sampler.sample(42, initial.executable, stamp, () => true)).toMatchObject({ cpu: { status: "available", value: 25, source: "process", sampledAt: stamp } });
  });
  it("rejects changed ownership/executable and OS start outside the managed launch window", async () => {
    const sampler = new ProcessResourceSampler(async () => initial);
    for (const [exe, owned, window] of [[initial.executable, false, undefined], ["C:\\wrong.exe", true, undefined],
      [initial.executable, true, { earliest: 2000, latest: 3000 }]] as const) {
      expect(await sampler.sample(42, exe, stamp, () => owned, window)).toMatchObject({ cpu: { status: "unavailable" }, ram: { status: "unavailable" } });
    }
  });
  it("does not carry CPU across PID reuse, probe failure or decreasing counters", async () => {
    let time = 0; let counters = { ...initial }; let fail = false;
    const sampler = new ProcessResourceSampler(async () => { if (fail) throw new Error("denied"); return counters; }, () => time, 1);
    await sampler.sample(42, initial.executable, stamp, () => true);
    time = 1000; counters = { ...counters, startTicks: "621355968020000000", cpuMs: 200 };
    expect((await sampler.sample(42, initial.executable, stamp, () => true)).cpu.status).toBe("unavailable");
    time = 2000; counters.cpuMs = 1;
    expect((await sampler.sample(42, initial.executable, stamp, () => true)).cpu.status).toBe("unavailable");
    fail = true;
    expect((await sampler.sample(42, initial.executable, stamp, () => true)).ram.status).toBe("unavailable");
    fail = false; time = 3000; counters.cpuMs = 2;
    expect((await sampler.sample(42, initial.executable, stamp, () => true)).cpu.status).toBe("unavailable");
  });
  it("does not clamp impossible CPU or invent data at a duplicate monotonic time", async () => {
    let time = 0; let cpuMs = 0;
    const sampler = new ProcessResourceSampler(async () => ({ ...initial, cpuMs }), () => time, 1);
    await sampler.sample(42, initial.executable, stamp, () => true);
    cpuMs = 1000;
    expect((await sampler.sample(42, initial.executable, stamp, () => true)).cpu.status).toBe("unavailable");
    time = 1; cpuMs = 2000;
    expect((await sampler.sample(42, initial.executable, stamp, () => true)).cpu.status).toBe("unavailable");
  });
  it("rejects nonnumeric and nonpositive PIDs before launching a helper", async () => {
    for (const pid of [NaN, 0, -1, 1.1]) await expect(readWindowsProcessCounters(pid)).rejects.toThrow();
  });
});
