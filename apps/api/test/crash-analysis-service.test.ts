import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { createMockAdapters } from "../src/fixtures/servers.js";
import { buildApp } from "../src/app.js";
import { CrashAnalysisService } from "../src/services/crash-analysis-service.js";
import { CrashEvidenceReader } from "../src/services/crash-evidence-reader.js";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { DomainError } from "../src/services/domain-errors.js";

const clock = { now: () => new Date("2026-10-08T00:00:00Z") };
function adapter(root: string, identity: string): LocalMinecraftServerAdapter {
  // Narrow fixture: none of the runtime methods may be called by evidence reads.
  return { ...createMockAdapters(clock)[0]!, mode: "local", plan: { rootPath: root },
    subscribe: () => () => {}, closeObserver: async () => {},
    getRegisteredExecutionIdentity: () => ({ rootIdentity: identity }) } as unknown as LocalMinecraftServerAdapter;
}
describe("crash analysis demand boundary", () => {
  it("coalesces scans, preserves sampledAt and isolates returned objects", async () => {
    let wall = 1000; let mono = 0;
    const local = adapter("registered-root", "registered-identity");
    const read = vi.fn().mockResolvedValue({ findings: [], sources: [], incomplete: false, conclusion: "no-rule-match", limitations: [] });
    const service = new CrashAnalysisService(new AdapterRegistry([local]), { now: () => new Date(wall) }, { read }, () => mono);
    const first = await Promise.all(Array.from({ length: 12 }, () => service.read(local.serverId)));
    expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith(local.serverId, "registered-root", "registered-identity");
    first[0]!.incomplete = true; wall = 2000; mono = 4999;
    expect(await service.read(local.serverId)).toMatchObject({ sampledAt: new Date(1000).toISOString(), incomplete: false });
    mono = 5000; expect((await service.read(local.serverId)).sampledAt).toBe(new Date(2000).toISOString());
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("retains unsafe failure throughout cooldown instead of serving earlier success", async () => {
    let mono = 0; const local = adapter("root", "identity");
    const reader = { read: vi.fn().mockResolvedValue({ findings: [], sources: [], incomplete: false, conclusion: "no-rule-match", limitations: [] }) };
    const service = new CrashAnalysisService(new AdapterRegistry([local]), clock, reader, () => mono);
    await service.read(local.serverId); mono = 5000;
    reader.read.mockRejectedValue(new DomainError(409, "CRASH_EVIDENCE_UNSAFE", "unsafe", "unsafe"));
    await expect(service.read(local.serverId)).rejects.toMatchObject({ code: "CRASH_EVIDENCE_UNSAFE" });
    mono = 5001; await expect(service.read(local.serverId)).rejects.toMatchObject({ code: "CRASH_EVIDENCE_UNSAFE" });
    expect(reader.read).toHaveBeenCalledTimes(2);
    mono = 10000; reader.read.mockResolvedValue({ findings: [], sources: [], incomplete: false, conclusion: "no-rule-match", limitations: [] });
    expect((await service.read(local.serverId)).status).toBe("available");
  });
  it("mock is unavailable without filesystem reads; unknown id is rejected", async () => {
    const mocks = createMockAdapters(clock); const reader = { read: vi.fn() };
    const service = new CrashAnalysisService(new AdapterRegistry(mocks), clock, reader);
    expect(await service.read(mocks[0]!.serverId)).toMatchObject({ status: "unavailable", sampledAt: null, findings: [] });
    await expect(service.read("unknown")).rejects.toThrow(); expect(reader.read).not.toHaveBeenCalled();
  });
  it("registered API returns only redacted evidence, refuses query/mutations/host/origin and no-store", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcsm-crash-api-"));
    const readerSpy = vi.spyOn(CrashEvidenceReader.prototype, "read");
    let app: ReturnType<typeof buildApp> | undefined;
    try {
      await mkdir(join(root, "logs")); await writeFile(join(root, "server.properties"), "rcon.password=api-private-secret\n");
      await writeFile(join(root, "logs", "latest.log"), `OutOfMemoryError api-private-secret C:\\private\\server.jar\n`);
      const local = adapter(root, await backupDirectoryIdentity(root)); app = buildApp({ adapters: [local], clock, mode: "local" });
      const url = `/api/v1/servers/${local.serverId}/crash-analysis`;
      const headers = { host: "127.0.0.1:8080" };
      const response = await app.inject({ method: "GET", url, headers });
      expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().data.findings[0].code).toBe("out-of-memory");
      for (const secret of [root, "api-private-secret", "server.jar"]) expect(response.body).not.toContain(secret);
      expect((await app.inject({ method: "GET", url: `${url}?path=outside`, headers })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url, headers: { host: "evil.test" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url, headers: { ...headers, origin: "https://evil.test" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url, headers })).statusCode).toBe(404);
      expect(readerSpy).toHaveBeenCalledTimes(1);
      expect((await app.inject({ method: "GET", url: "/api/v1/servers/unknown/crash-analysis", headers })).statusCode).toBe(404);
    } finally { await app?.close(); readerSpy.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });
});
