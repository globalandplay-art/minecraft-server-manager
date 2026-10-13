import { describe, expect, it } from "vitest";
import { TailscaleReadOnlyService, TailscaleReadError, tailscaleReadArguments, inspectServe,
  type TailscaleReadCommand, type TailscaleReadRunner } from "../src/services/tailscale-readonly.js";

const status = { Version: "1.98.8", BackendState: "Running", Self: { Online: true, DNSName: "manager.example.ts.net." },
  CurrentTailnet: { MagicDNSSuffix: "example.ts.net" }, TailscaleIPs: ["100.64.0.1"], Health: null, CertDomains: ["manager.example.ts.net"] };
function fixture(changes: Partial<Record<TailscaleReadCommand, string>> = {}) {
  const calls: TailscaleReadCommand[] = [];
  const values = { version: "1.98.8\n commit", help: "status --https", "status-help": "--json", status: JSON.stringify(status), "serve-status": "{}", ...changes };
  const runner: TailscaleReadRunner = { run: async (command) => { calls.push(command); return values[command]; } };
  return { calls, runner, service: new TailscaleReadOnlyService(runner) };
}
describe("read-only Tailscale observation", () => {
  it("defaults off, performs no automatic command and does not invent ingress or remote URL", async () => {
    const f = fixture(); expect(f.service.read()).toMatchObject({ state: "disabled", desiredEnabled: false, observedEnabled: null, lastCheckedAt: null });
    expect(f.calls).toEqual([]);
    const result = await f.service.preflight();
    expect(result).toMatchObject({ state: "needs_setup", tailnet: "ready", https: "available", target: "unconfigured", observedEnabled: false,
      lastErrorCode: "TAILSCALE_TARGET_UNCONFIGURED", connectionUrl: null, remoteVerifiedAt: null, capabilities: { enable: false, disable: false } });
    expect(result.lastCheckedAt).not.toBeNull();
    expect(f.calls).toEqual(["version", "help", "status-help", "status", "serve-status"]);
    result.state = "enabled"; expect(f.service.read().state).toBe("needs_setup");
  });
  it("only exposes fixed read command arrays with no reset/up/login/funnel mutation", () => {
    expect(Object.values(tailscaleReadArguments)).toEqual([["version"], ["serve", "--help"], ["serve", "status", "--help"], ["status", "--json"], ["serve", "status", "--json"]]);
  });
  it.each(["1.52.0", "1.100.0", "1.98.8-dev", "unknown"])("rejects unreviewed version %s before daemon probes", async (version) => {
    const f = fixture({ version }); expect((await f.service.preflight()).lastErrorCode).toBe("TAILSCALE_VERSION_UNSUPPORTED"); expect(f.calls).toEqual(["version"]);
  });
  it.each(["TAILSCALE_TIMEOUT", "TAILSCALE_EXIT_FAILED", "TAILSCALE_SPAWN_FAILED", "TAILSCALE_CLEANUP_BLOCKED"])("retains unknown state for %s", async (code) => {
    const service = new TailscaleReadOnlyService({ run: async () => { throw new TailscaleReadError(code); } });
    expect(await service.preflight()).toMatchObject({ state: "unavailable", observedEnabled: null, observedServeMode: "unknown", lastErrorCode: code });
  });
  it("does not leak exceptions or arbitrary diagnostic codes", async () => {
    for (const error of [new Error("SECRET/PATH"), new TailscaleReadError("SECRET/PATH")]) {
      const service = new TailscaleReadOnlyService({ run: async () => { throw error; } });
      expect(JSON.stringify(await service.preflight())).not.toContain("SECRET");
    }
  });
  it("unavailable runner stays fail closed", async () => { expect((await new TailscaleReadOnlyService().preflight()).lastErrorCode).toBe("TAILSCALE_UNAVAILABLE"); });
  it.each(["not json", "null", "[]", '{"TCP":null}', '{"TCP":{},"TCP":{}}', '{"T\\u0043P":{},"TCP":{}}', '{"Unknown":true}', '{"AllowFunnel":{"node.ts.net:443":"false"}}', '{"__proto__":{}}'])("rejects malformed/unknown Serve %s", (text) => { expect(() => inspectServe(text)).toThrow(); });
  it.each([
    { TCP: { "443": { HTTPS: true } } }, { Web: { "node.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } } } } },
    { Foreground: { session: { AllowFunnel: { "node.ts.net:443": true } } } }, { Services: { "svc:test": { Tun: true } } },
    { AllowFunnel: { "node.ts.net:443": true } }, { AllowFunnel: { "node.ts.net:443": false } }
  ])("keeps all existing user resources external and unchanged", async (serve) => {
    const text = JSON.stringify(serve); const f = fixture({ "serve-status": text });
    expect(await f.service.preflight()).toMatchObject({ state: "conflict", lastErrorCode: "TAILSCALE_EXTERNAL_CONFIG", observedEnabled: null });
    expect(text).toBe(JSON.stringify(serve)); expect(f.calls.every((call) => Object.hasOwn(tailscaleReadArguments, call))).toBe(true);
  });
  it.each(["NeedsLogin", "NeedsMachineAuth", "Stopped", "Starting"])("does not claim Tailnet ready in %s", async (state) => {
    expect(await fixture({ status: JSON.stringify({ ...status, BackendState: state }) }).service.preflight()).toMatchObject({ state: "needs_setup", tailnet: "not_ready" });
  });
  it("reports HTTPS and daemon health prerequisites without returning domains/users", async () => {
    const noHttps = await fixture({ status: JSON.stringify({ ...status, CertDomains: [] }) }).service.preflight();
    expect(noHttps.lastErrorCode).toBe("TAILSCALE_HTTPS_REQUIRED");
    expect((await fixture({ status: JSON.stringify({ ...status, Health: ["secret remote path"] }) }).service.preflight()).lastErrorCode).toBe("TAILSCALE_DAEMON_UNHEALTHY");
    expect(JSON.stringify(noHttps)).not.toContain("example.ts.net");
  });
  it("unknown daemon schema and bounded output fail closed", async () => {
    expect((await fixture({ status: JSON.stringify({ ...status, UnknownNetworkMode: true }) }).service.preflight()).lastErrorCode).toBe("TAILSCALE_SCHEMA_UNKNOWN");
    expect(() => inspectServe(" ".repeat(65537))).toThrow();
  });
  it("does not claim readiness from malformed IP/suffix, and accepts nil certificate list as HTTPS unavailable", async () => {
    for (const changed of [{ TailscaleIPs: [null] }, { TailscaleIPs: [{}] }, { CurrentTailnet: { MagicDNSSuffix: "evil.invalid" } }]) {
      expect((await fixture({ status: JSON.stringify({ ...status, ...changed }) }).service.preflight()).lastErrorCode).toBe("TAILSCALE_SCHEMA_UNKNOWN");
    }
    expect((await fixture({ status: JSON.stringify({ ...status, CertDomains: null }) }).service.preflight()).lastErrorCode).toBe("TAILSCALE_HTTPS_REQUIRED");
  });
  it("serializes probes across requests and keeps last-known snapshot checking", async () => {
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); const f = fixture();
    const original = f.runner.run; f.runner.run = async (command) => { await wait; return original(command); };
    const pending = f.service.preflight(); expect(f.service.read().state).toBe("checking");
    await expect(f.service.preflight()).rejects.toMatchObject({ code: "TAILSCALE_CHECK_BUSY" }); release(); await pending;
  });
});
