import { statfs } from "node:fs/promises";
import type { Metrics } from "@mcsm/contracts";
import { backupDirectoryIdentity } from "./backup-identity.js";

export async function readVolumeMetric(rootPath: string, expectedIdentity: string | undefined, sampledAt: string): Promise<Metrics["disk"]> {
  const unavailable = { status: "unavailable" as const, value: null, source: null, sampledAt: null, reason: "volume-probe-unavailable" };
  if (!expectedIdentity) return unavailable;
  try {
    if (await backupDirectoryIdentity(rootPath) !== expectedIdentity) return unavailable;
    const data = await statfs(rootPath, { bigint: true });
    if (await backupDirectoryIdentity(rootPath) !== expectedIdentity) return unavailable;
    const total = data.blocks * data.bsize; const free = data.bfree * data.bsize;
    if (data.bsize <= 0n || free < 0n || free > total || total > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable;
    return { status: "available", source: "filesystem", sampledAt,
      value: { totalBytes: Number(total), freeBytes: Number(free), usedBytes: Number(total - free) } };
  } catch { return unavailable; }
}
