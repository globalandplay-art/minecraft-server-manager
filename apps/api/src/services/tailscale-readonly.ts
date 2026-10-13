import type { TailscaleStatusResponse } from "@mcsm/contracts";
import { isIP } from "node:net";

export type TailscaleReadCommand = "version" | "help" | "status-help" | "status" | "serve-status";
export interface TailscaleReadRunner { run(command: TailscaleReadCommand): Promise<string> }
export const tailscaleReadArguments = {
  version: ["version"], help: ["serve", "--help"], "status-help": ["serve", "status", "--help"], status: ["status", "--json"],
  "serve-status": ["serve", "status", "--json"]
} as const;
export class TailscaleReadError extends Error {
  constructor(readonly code: string) { super("Tailscale read-only check unavailable."); }
}
type Status = TailscaleStatusResponse["data"];
const empty = (): Status => ({ state: "disabled", desiredEnabled: false, observedEnabled: null,
  observedServeMode: "unknown", managementMode: "external", dependency: "unknown", tailnet: "unknown",
  https: "unknown", target: "unconfigured", lastCheckedAt: null, lastErrorCode: null,
  connectionUrl: null, remoteVerifiedAt: null, capabilities: { preflight: true, enable: false, disable: false } });

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
  return value as Record<string, unknown>;
}
/** Bounds both sensitive daemon output and the JSON tree. Never returns raw fields. */
function parse(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text) > 64 * 1024) throw new TailscaleReadError("TAILSCALE_OUTPUT_LIMIT");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new TailscaleReadError("TAILSCALE_JSON_INVALID"); }
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/gu) ?? [];
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ":") {
      const current = stack.at(-1); const key = JSON.parse(token) as string;
      if (!current || current.has(key)) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
      current.add(key);
    }
  }
  let count = 0;
  function inspect(node: unknown, depth: number): void {
    if (++count > 4096 || depth > 12) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
    if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
      inspect(child, depth + 1);
    }
  }
  inspect(value, 0); return object(value);
}
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
};

/** v1.98.8 ServeConfig fields. Any occupied resource is external; no ownership inference. */
export function inspectServe(text: string): { mode: Status["observedServeMode"]; occupied: boolean } {
  const root = parse(text);
  keys(root, ["TCP", "Web", "Services", "AllowFunnel", "Foreground"]);
  let occupied = false; let funnel = false;
  for (const key of ["TCP", "Web", "Services", "Foreground"] as const) {
    if (Object.hasOwn(root, key)) {
      const entries = object(root[key]);
      // Nonempty foreground/services are conflicts without interpreting nested provider resources.
      if (Object.keys(entries).length) occupied = true;
    }
  }
  if (Object.hasOwn(root, "AllowFunnel")) for (const [hostPort, allowed] of Object.entries(object(root.AllowFunnel))) {
    occupied = true;
    if (!/^[a-z0-9.-]+:[1-9][0-9]{0,4}$/u.test(hostPort)) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
    if (typeof allowed !== "boolean") throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
    if (allowed) { funnel = true; occupied = true; }
  }
  return { mode: funnel ? "funnel" : occupied ? "external" : "none", occupied };
}

/** Test runners are constructor-only. Production never creates an adapter or performs a mutation. */
export class TailscaleReadOnlyService {
  #value = empty(); #active = false;
  constructor(private readonly runner?: TailscaleReadRunner) {}
  read(): Status { return structuredClone(this.#value); }
  async preflight(): Promise<Status> {
    if (this.#active) throw new TailscaleReadError("TAILSCALE_CHECK_BUSY");
    this.#active = true; this.#value = { ...empty(), state: "checking" };
    try { await this.#probe(); }
    catch (error) {
      this.#value.state = "unavailable";
      const allowed = ["TAILSCALE_UNAVAILABLE", "TAILSCALE_VERSION_UNSUPPORTED", "TAILSCALE_CLI_UNSUPPORTED", "TAILSCALE_SCHEMA_UNKNOWN", "TAILSCALE_JSON_INVALID", "TAILSCALE_OUTPUT_LIMIT", "TAILSCALE_TIMEOUT", "TAILSCALE_SPAWN_FAILED", "TAILSCALE_EXIT_FAILED", "TAILSCALE_CLEANUP_BLOCKED", "TAILSCALE_EXECUTABLE_UNTRUSTED", "TAILSCALE_EXECUTABLE_CHANGED"];
      this.#value.lastErrorCode = error instanceof TailscaleReadError && allowed.includes(error.code) ? error.code : "TAILSCALE_READ_FAILED";
      this.#value.observedEnabled = null; this.#value.observedServeMode = "unknown";
    } finally { this.#value.lastCheckedAt = new Date().toISOString(); this.#active = false; }
    return this.read();
  }
  async #probe(): Promise<void> {
      if (!this.runner) throw new TailscaleReadError("TAILSCALE_UNAVAILABLE");
      const version = await this.runner.run("version");
      // Reviewed source schema only; no future/development versions are assumed compatible.
      if (version.split(/\r?\n/u)[0]?.trim() !== "1.98.8") throw new TailscaleReadError("TAILSCALE_VERSION_UNSUPPORTED");
      this.#value.dependency = "available";
      const help = await this.runner.run("help");
      const statusHelp = await this.runner.run("status-help");
      if (!help.includes("status") || !help.includes("--https") || !statusHelp.includes("--json")) throw new TailscaleReadError("TAILSCALE_CLI_UNSUPPORTED");
      const status = parse(await this.runner.run("status"));
      keys(status, ["Version", "TUN", "BackendState", "HaveNodeKey", "AuthURL", "TailscaleIPs", "Self", "ExitNodeStatus",
        "Health", "MagicDNSSuffix", "CurrentTailnet", "CertDomains", "Peer", "User", "ClientVersion"]);
      if (typeof status.Version !== "string" || status.Version.split("-")[0] !== "1.98.8" ||
        !["NoState", "NeedsLogin", "NeedsMachineAuth", "Stopped", "Starting", "Running"].includes(String(status.BackendState))) {
        throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
      }
      // Serve/Funnel is checked even when login/HTTPS is unavailable; existing resources cannot be hidden.
      const serve = inspectServe(await this.runner.run("serve-status"));
      this.#value.observedServeMode = serve.mode;
      if (serve.occupied) { this.#value.state = "conflict"; this.#value.lastErrorCode = "TAILSCALE_EXTERNAL_CONFIG"; return; }
      this.#value.observedEnabled = false;
      if (status.BackendState !== "Running") {
        this.#value.tailnet = "not_ready"; this.#value.state = "needs_setup"; this.#value.lastErrorCode = "TAILSCALE_LOGIN_REQUIRED"; return;
      }
      if (!status.Self || !status.CurrentTailnet || !Array.isArray(status.TailscaleIPs) || !status.TailscaleIPs.length ||
        status.TailscaleIPs.some((ip) => typeof ip !== "string" || isIP(ip) === 0) ||
        !Object.hasOwn(status, "Health") || (status.Health !== null && (!Array.isArray(status.Health) || status.Health.some((item) => typeof item !== "string")))) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
      if (Array.isArray(status.Health) && status.Health.length) { this.#value.state = "degraded"; this.#value.lastErrorCode = "TAILSCALE_DAEMON_UNHEALTHY"; return; }
      const self = object(status.Self); const tailnet = object(status.CurrentTailnet);
      if (self.Online !== true || typeof self.DNSName !== "string" || typeof tailnet.MagicDNSSuffix !== "string") throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
      const suffix = tailnet.MagicDNSSuffix;
      const domain = self.DNSName.replace(/\.$/u, "");
      if (!/^[a-z0-9-]+\.ts\.net$/u.test(suffix) || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/u.test(domain) || !domain.endsWith(`.${suffix}`)) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
      this.#value.tailnet = "ready";
      if (!Object.hasOwn(status, "CertDomains") || (status.CertDomains !== null && (!Array.isArray(status.CertDomains) || status.CertDomains.some((item) => typeof item !== "string")))) throw new TailscaleReadError("TAILSCALE_SCHEMA_UNKNOWN");
      const https = Array.isArray(status.CertDomains) && status.CertDomains.includes(domain);
      this.#value.https = https ? "available" : "needs_setup";
      this.#value.state = "needs_setup";
      this.#value.lastErrorCode = https ? "TAILSCALE_TARGET_UNCONFIGURED" : "TAILSCALE_HTTPS_REQUIRED";
      // No owned ingress/target yet. Do not claim ready, enabled or a connectable URL.
      return;
  }
}
