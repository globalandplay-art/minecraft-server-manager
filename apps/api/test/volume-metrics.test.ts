import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { readVolumeMetric } from "../src/services/volume-metrics.js";
describe("registered volume metrics", () => {
  it("returns volume byte arithmetic for the exact directory and rejects absent/wrong identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcsm-volume-"));
    try {
      const identity = await backupDirectoryIdentity(root);
      const metric = await readVolumeMetric(root, identity, "2026-10-08T00:00:00Z");
      expect(metric.status).toBe("available");
      if (metric.status === "available") expect(metric.value.usedBytes + metric.value.freeBytes).toBe(metric.value.totalBytes);
      expect((await readVolumeMetric(root, undefined, "2026-10-08T00:00:00Z")).status).toBe("unavailable");
      expect((await readVolumeMetric(root, "wrong", "2026-10-08T00:00:00Z")).status).toBe("unavailable");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("does not measure a replacement directory under the same path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mcsm-volume-replace-")); const root = join(parent, "root");
    try {
      await mkdir(root); const identity = await backupDirectoryIdentity(root);
      await rename(root, join(parent, "old")); await mkdir(root);
      expect((await readVolumeMetric(root, identity, "2026-10-08T00:00:00Z")).status).toBe("unavailable");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
