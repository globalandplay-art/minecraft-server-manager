import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { TextDecoder } from "node:util";
import { PRIVATE_ACL_INSPECT_SCRIPT } from "../auth/windows-private-acl.js";

/** Dedicated whitelist transport candidate. UNWIRED: not the default auth verifier or a global pool. */
export const aclSessionScript = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$utf8=[Text.UTF8Encoding]::new($false,$true)
$reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),$utf8,$false,4096,$true)
$writer=[IO.StreamWriter]::new([Console]::OpenStandardOutput(),$utf8,4096,$true)
$writer.AutoFlush=$true
${PRIVATE_ACL_INSPECT_SCRIPT}
$sequence=0
try { while(($line=$reader.ReadLine()) -ne $null) {
 try {
  if($line.Length -gt 262144) { throw 'frame' }
  $r=$line | ConvertFrom-Json
  $keys=(@($r.PSObject.Properties.Name) | Sort-Object) -join ','
  if($keys -ne 'id,paths,version') { throw 'shape' }
  if(($r.version -isnot [int] -and $r.version -isnot [long]) -or $r.version -ne 1 -or
    ($r.id -isnot [int] -and $r.id -isnot [long]) -or $r.id -ne ($sequence+1) -or $r.paths -isnot [string]) { throw 'sequence' }
  $targets=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($r.paths)) | ConvertFrom-Json
  if($targets -isnot [array] -or $targets.Count -lt 1 -or $targets.Count -gt 8) { throw 'count' }
  foreach($target in $targets) { if($target -isnot [string] -or $target.Length -gt 4096) { throw 'target' } }
  $sequence++
  $rows=@(foreach($target in $targets) { Read-AuthPrivateAcl $target })
  $reply=@{version=1;id=$sequence;snapshots=@($rows)} | ConvertTo-Json -Depth 5 -Compress
  $writer.WriteLine($reply)
  $writer.Flush()
 } catch { exit 1 }
} } finally { $reader.Dispose(); $writer.Dispose() }
`;

export interface OwnedAclChild extends EventEmitter {
  stdin: Writable; stdout: Readable; stderr: Readable; pid?: number | undefined;
  kill(): boolean;
}
export type SessionFault = "busy" | "timeout" | "protocol" | "spawn" | "closed" | "capacity" | "cleanup";
type ProtocolLocation = "stderr" | "stdout-unsolicited" | "stdout-size" | "stdout-trailing" | "stdout-json" | "stdout-shape" | "stdout-binding";
export class AclSessionError extends Error {
  readonly code: string;
  constructor(readonly reason: SessionFault) { super(reason === "cleanup" ? "CLEANUP_BLOCKED" : "ACL_SESSION_UNSAFE"); this.code = this.message; }
}
const defaultFactory = (script: string): OwnedAclChild => {
  if (process.platform !== "win32") throw new AclSessionError("spawn");
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
};
interface Pending { id: number; count: number; deadline: number; resolve: (value: unknown[]) => void; reject: (error: AclSessionError) => void; timer: ReturnType<typeof setTimeout> }

export class WhitelistAclSession {
  #child: OwnedAclChild | undefined; #pending: Pending | undefined;
  #sequence = 0; #buffer = Buffer.alloc(0); #fault: SessionFault | undefined;
  #closing = false; #closed = false; #closeResult: { code: number | null; signal: string | null } | undefined;
  #killRequested = false; #cleanupFailed = false;
  #protocolLocation: ProtocolLocation | null = null;
  #stderrKind: "unknown" | "clixml-progress-marker" | "clixml-error-marker" = "unknown";
  #stderrBuffer = Buffer.alloc(0);
  #stderrFlags = { inputEncoding: false, outputEncoding: false, readAcl: false };
  #waitClosed: Promise<void> | undefined; #scopeTimer: ReturnType<typeof setTimeout> | undefined;
  #startedAt: number | undefined; #closeTask: Promise<void> | undefined;
  #cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  #creationUncertain = false;
  constructor(private readonly factory: (trustedScript: string) => OwnedAclChild = defaultFactory,
    private readonly now: () => number = () => performance.now(),
    private readonly wrapScript: (trustedScript: string) => string = (script) => script) {}
  get pid(): number | undefined { return this.#child?.pid; }
  get closedConfirmed(): boolean { return this.#closed; }
  get healthyForRotation(): boolean {
    return !this.#fault && !this.#creationUncertain && !this.#cleanupFailed && !this.#closing && !this.#closed && !this.#pending &&
      (this.#startedAt === undefined || this.now() - this.#startedAt < 40_000);
  }
  get diagnostic() { return { protocolLocation: this.#protocolLocation, stderrKind: this.#stderrKind, ...this.#stderrFlags }; }
  #protocol(location: ProtocolLocation) { this.#protocolLocation ??= location; this.#poison("protocol"); }
  #poison(reason: SessionFault, mayKill = true) {
    this.#fault ??= reason;
    const pending = this.#pending; this.#pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(new AclSessionError(this.#fault)); }
    if (mayKill && this.#child && !this.#closed && !this.#killRequested) {
      this.#killRequested = true;
      try { this.#child.kill(); } catch { /* close proof still required */ }
    }
  }
  #start(deadline: number) {
    if (this.#child) return;
    this.#startedAt = this.now();
    // Constructor-only wrapper is inside the original query deadline. No prewarm.
    const script = this.wrapScript(aclSessionScript);
    if (this.now() >= deadline) { this.#poison("timeout"); throw new AclSessionError("timeout"); }
    this.#creationUncertain = true;
    try { this.#child = this.factory(script); this.#creationUncertain = false; } catch { this.#poison("spawn"); throw new AclSessionError("spawn"); }
    const child = this.#child;
    this.#waitClosed = new Promise<void>((resolve) => child.once("close", (code: number | null, signal: string | null) => {
      this.#closed = true; this.#closeResult = { code, signal }; if (this.#scopeTimer) clearTimeout(this.#scopeTimer);
      if (this.#cleanupTimer) clearTimeout(this.#cleanupTimer);
      if (!this.#closing || code !== 0 || signal !== null || this.#buffer.length) this.#poison("closed"); resolve();
    }));
    child.on("error", () => this.#poison("spawn")); child.stdin.on("error", () => this.#poison("closed"));
    child.stdout.on("error", () => this.#poison("protocol")); child.stderr.on("error", () => this.#poison("protocol"));
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.isBuffer(chunk) && chunk.length + this.#stderrBuffer.length + this.#buffer.length <= 65536) {
        this.#stderrBuffer = Buffer.concat([this.#stderrBuffer, chunk]);
        const text = this.#stderrBuffer.toString("utf8").replace(/^\uFEFF/u, "");
        if (text.startsWith("#< CLIXML") && /S="error"/iu.test(text)) this.#stderrKind = "clixml-error-marker";
        else if (text.startsWith("#< CLIXML") && /S="progress"/iu.test(text)) this.#stderrKind = "clixml-progress-marker";
        this.#stderrFlags.inputEncoding ||= text.includes("InputEncoding");
        this.#stderrFlags.outputEncoding ||= text.includes("OutputEncoding");
        this.#stderrFlags.readAcl ||= text.includes("Read-AuthPrivateAcl");
      }
      this.#protocol("stderr"); // Marker classification NEVER authorizes acceptance.
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.#fault || !this.#pending) { this.#protocol("stdout-unsolicited"); return; }
      if (!Buffer.isBuffer(chunk) || chunk.length + this.#buffer.length + this.#stderrBuffer.length > 65536) { this.#protocol("stdout-size"); return; }
      this.#buffer = Buffer.concat([this.#buffer, chunk]); const newline = this.#buffer.indexOf(10);
      if (newline < 0) return;
      if (newline !== this.#buffer.length - 1) { this.#protocol("stdout-trailing"); return; }
      let location: ProtocolLocation = "stdout-json";
      try {
        const row: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(this.#buffer.subarray(0, newline)));
        const pending = this.#pending;
        location = "stdout-shape";
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== "id,snapshots,version") throw new Error();
        const value = row as Record<string, unknown>;
        location = "stdout-binding";
        if (value.version !== 1 || value.id !== pending.id || !Array.isArray(value.snapshots) || value.snapshots.length !== pending.count) throw new Error();
        if (this.now() >= pending.deadline || (this.#startedAt !== undefined && this.now() - this.#startedAt >= 40_000)) { this.#poison("timeout"); return; }
        this.#buffer.fill(0); this.#buffer = Buffer.alloc(0); this.#pending = undefined; clearTimeout(pending.timer); pending.resolve(value.snapshots);
      } catch { this.#protocol(location); }
    });
    // Separate, bounded scope lifetime. Never relaxes the 5000ms request timer.
    this.#scopeTimer = setTimeout(() => this.#poison("timeout"), Math.max(1, 40_000 - (this.now() - this.#startedAt))); this.#scopeTimer.unref();
  }
  /** Trusted absolute monotonic deadline may ONLY shorten the original5000ms limit. */
  query(files: readonly string[], deadline = this.now() + 5000): Promise<unknown[]> {
    if (this.#cleanupFailed) return Promise.reject(new AclSessionError("cleanup"));
    if (this.#fault || this.#closed || this.#closing) return Promise.reject(new AclSessionError(this.#fault ?? "closed"));
    if (!Number.isFinite(deadline) || deadline > this.now() + 5000) return Promise.reject(new AclSessionError("protocol"));
    if (deadline <= this.now() || (this.#startedAt !== undefined && this.now() - this.#startedAt >= 40_000)) {
      this.#poison("timeout"); return Promise.reject(new AclSessionError("timeout"));
    }
    if (this.#pending) return Promise.reject(new AclSessionError("busy"));
    if (this.#sequence >= 64) return Promise.reject(new AclSessionError("capacity"));
    if (files.length < 1 || files.length > 8 || files.some((file) => typeof file !== "string" || file.length > 4096) ||
      new Set(files.map((file) => process.platform === "win32" ? file.toLowerCase() : file)).size !== files.length) return Promise.reject(new AclSessionError("protocol"));
    const id = ++this.#sequence;
    const frame = Buffer.from(JSON.stringify({ version: 1, id, paths: Buffer.from(JSON.stringify(files), "utf8").toString("base64") }) + "\n", "utf8");
    if (frame.length > 262144) return Promise.reject(new AclSessionError("capacity"));
    // Timer is established BEFORE lazy spawn: startup and all waiting are included.
    return new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => this.#poison("timeout"), Math.max(1, deadline - this.now()));
      this.#pending = { id, count: files.length, deadline, resolve, reject, timer };
      try {
        this.#start(deadline);
        if (this.now() >= deadline) this.#poison("timeout");
        if (this.#fault) { frame.fill(0); this.#poison(this.#fault); }
        else this.#child!.stdin.write(frame, (error) => { frame.fill(0); if (error) this.#poison("closed"); });
      } catch { frame.fill(0); this.#poison("spawn"); }
    });
  }
  /** Shared drain; a caller may shorten, never restart, the original5000ms budget. */
  close(deadline?: number): Promise<void> {
    if (this.#closeTask) return this.#closeTask;
    const started = this.now(), ownDeadline = started + 5000;
    const end = deadline === undefined ? ownDeadline :
      Number.isFinite(deadline) && deadline <= ownDeadline ? deadline : started;
    let resolve!: () => void, reject!: (error: unknown) => void;
    // Publish before any EOF/kill callback can synchronously reenter close.
    this.#closeTask = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void this.#close(end).then(resolve, reject);
    return this.#closeTask;
  }
  async #close(closeDeadline: number): Promise<void> {
    if (this.#cleanupFailed || this.now() >= closeDeadline) {
      this.#cleanupFailed = true;
      // No new EOF/kill and no guessed cancellation. Original query/lifetime timers stay live.
      throw new AclSessionError("cleanup");
    }
    const fence = () => {
      if (this.now() >= closeDeadline) {
        this.#cleanupFailed = true; this.#poison("cleanup", false);
        throw new AclSessionError("cleanup");
      }
    };
    if (!this.#closed && this.#startedAt !== undefined && this.now() - this.#startedAt >= 40_000) this.#poison("timeout");
    fence();
    this.#closing = true;
    // Only actual close cancels lifetime supervision, including during a shortened drain.
    if (!this.#child) {
      if (this.#creationUncertain) {
        this.#cleanupFailed = true; this.#poison("closed", false);
        throw new AclSessionError("cleanup");
      }
      this.#closed = true; if (this.#fault) throw new AclSessionError(this.#fault); return;
    }
    try {
      // Arrange the original exact-child timeout reaction while admission is still timely.
      const timeout = new Promise<never>((_, reject) => { this.#cleanupTimer = setTimeout(() => {
        this.#cleanupFailed = true; this.#poison("cleanup"); reject(new AclSessionError("cleanup"));
      }, Math.max(1, closeDeadline - this.now())); });
      void timeout.catch(() => undefined);
      if (this.#pending) this.#poison("closed");
      fence();
      if (!this.#closed) { try { this.#child.stdin.end(); } catch { this.#poison("closed"); } }
      fence();
      await Promise.race([this.#waitClosed, timeout]);
    } finally {
      // Failed post-fences cannot cancel the already-admitted timeout reaction.
      if (this.#closed && this.#cleanupTimer) clearTimeout(this.#cleanupTimer);
      this.#buffer.fill(0); this.#buffer = Buffer.alloc(0); this.#stderrBuffer.fill(0); this.#stderrBuffer = Buffer.alloc(0);
    }
    if (this.#startedAt !== undefined && this.now() - this.#startedAt >= 40_000) this.#poison("timeout");
    fence();
    if (!this.#closed || !this.#closeResult) throw new AclSessionError("cleanup");
    if (this.#fault) throw new AclSessionError(this.#fault);
  }
}
