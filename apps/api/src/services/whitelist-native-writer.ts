import { spawn } from "node:child_process";
import path from "node:path";
import { TextDecoder } from "node:util";
import type { OwnedAclChild } from "./whitelist-acl-session.js";

type WriterFault = "owner" | "spawn" | "timeout" | "output" | "exit" | "cancelled" | "used" | "cleanup";
export class WhitelistWriterError extends Error {
  readonly code: "WHITELIST_WRITER_UNSAFE" | "CLEANUP_BLOCKED";
  constructor(readonly reason: WriterFault) {
    super(reason === "cleanup" ? "CLEANUP_BLOCKED" : "WHITELIST_WRITER_UNSAFE");
    this.code = this.message as WhitelistWriterError["code"];
  }
}

export const whitelistNativeWriterExecutable = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const nativeChild = (script: string): OwnedAclChild => {
  if (process.platform !== "win32") throw new WhitelistWriterError("spawn");
  const executable = whitelistNativeWriterExecutable();
  return spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
};

/** UNWIRED internal transport. Caller must retain its exact owner lease through drain.
 * No HTTP/config/script input. The mandatory wrapper must bind the current owner epoch.
 * This component proves child closure only; it does not track Node write/sync tasks.
 */
export class WhitelistNativeWriter {
  #used = false;
  #child: OwnedAclChild | undefined;
  #creationUncertain = false;
  #closed = true;
  #closeResult: { code: number | null; signal: string | null } | undefined;
  #fault: WriterFault | undefined;
  #killRequested = false;
  #bytes = 0;
  #stdout = Buffer.alloc(0);
  #deadline = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: { resolve: (value: unknown) => void; reject: (error: WhitelistWriterError) => void } | undefined;
  #waitClosed: Promise<void> | undefined;
  #closeTask: Promise<void> | undefined;
  constructor(private readonly ownerWrapper: (trustedScript: string) => string,
    private readonly factory: (wrappedTrustedScript: string) => OwnedAclChild = nativeChild,
    private readonly now: () => number = () => performance.now()) {}

  /** Physical close proof, never operation success or permission to release other tasks. */
  get closedConfirmed(): boolean { return this.#closed && !this.#creationUncertain; }
  /** Fixed, bounded process metadata only. Never exposes native output or owner proof. */
  get closeEvidence() {
    return { actualClose: this.closedConfirmed && this.#closeResult !== undefined,
      exitCode: this.#closeResult?.code ?? null, exitSignal: this.#closeResult?.signal ?? null };
  }

  #wipe() { this.#stdout.fill(0); this.#stdout = Buffer.alloc(0); }
  #fail(reason: WriterFault, mayKill = true) {
    this.#fault ??= reason;
    // Expired cleanup cannot dispatch a kill, but must retain original work supervision.
    if (mayKill && this.#timer) clearTimeout(this.#timer);
    const pending = this.#pending; this.#pending = undefined;
    this.#wipe();
    pending?.reject(new WhitelistWriterError(this.#fault));
    if (mayKill && this.#child && !this.#closed && !this.#killRequested) {
      this.#killRequested = true;
      try { this.#child.kill(); } catch { /* Actual close, not kill return, proves drain. */ }
    }
  }

  /** Exactly one trusted invocation. A lost response never authorizes retry. */
  run(trustedScript: string): Promise<unknown> {
    if (this.#used) return Promise.reject(new WhitelistWriterError("used"));
    this.#used = true;
    this.#deadline = this.now() + 15_000;
    return new Promise<unknown>((resolve, reject) => {
      this.#pending = { resolve, reject };
      this.#timer = setTimeout(() => this.#fail("timeout"), 15_000);
      let wrapped: string;
      try {
        if (typeof this.ownerWrapper !== "function" || typeof trustedScript !== "string") throw new Error();
        wrapped = this.ownerWrapper(trustedScript);
        if (typeof wrapped !== "string" || !wrapped.length) throw new Error();
      } catch { this.#fail("owner"); return; }
      if (this.#fault) return;
      if (this.now() >= this.#deadline) { this.#fail("timeout"); return; }
      this.#creationUncertain = true; this.#closed = false;
      try {
        this.#child = this.factory(wrapped);
        this.#creationUncertain = false;
      } catch { this.#fail("spawn"); return; }
      const child = this.#child;
      this.#waitClosed = new Promise<void>((closed) => child.once("close", (code: unknown, signal: unknown) => {
        this.#closed = true;
        if (this.#timer) clearTimeout(this.#timer);
        this.#closeResult = { code: typeof code === "number" && Number.isSafeInteger(code) && Math.abs(code) <= 0xffffffff ? code : null,
          signal: signal === null ? null : typeof signal === "string" && ["SIGTERM", "SIGKILL", "SIGINT", "SIGBREAK"].includes(signal) ? signal : "UNKNOWN" };
        closed();
        if (this.#fault) return;
        if (this.now() >= this.#deadline) { this.#fail("timeout"); return; }
        if (code !== 0 || signal !== null) { this.#fail("exit"); return; }
        let value: unknown;
        try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(this.#stdout).replace(/^\uFEFF/u, "")); }
        catch { this.#fail("output"); return; }
        if (this.now() >= this.#deadline) { this.#fail("timeout"); return; }
        if (this.#timer) clearTimeout(this.#timer);
        const pending = this.#pending; this.#pending = undefined;
        this.#wipe(); pending?.resolve(value);
      }));
      child.on("error", () => this.#fail("spawn"));
      child.stdin.on("error", () => this.#fail("exit"));
      child.stdout.on("error", () => this.#fail("output"));
      child.stderr.on("error", () => this.#fail("output"));
      const receive = (chunk: unknown, stderr: boolean) => {
        if (this.#fault) return;
        if (this.now() >= this.#deadline) { this.#fail("timeout"); return; }
        if (!Buffer.isBuffer(chunk) || chunk.length > 16 * 1024 - this.#bytes) { this.#fail("output"); return; }
        this.#bytes += chunk.length;
        if (stderr && chunk.length) { this.#fail("output"); return; }
        if (!stderr) this.#stdout = Buffer.concat([this.#stdout, chunk]);
      };
      child.stdout.on("data", (chunk: unknown) => receive(chunk, false));
      child.stderr.on("data", (chunk: unknown) => receive(chunk, true));
      if (this.#fault) { this.#fail(this.#fault); return; }
      if (this.now() >= this.#deadline) { this.#fail("timeout"); return; }
      try { child.stdin.end(); } catch { this.#fail("exit"); }
    });
  }

  cancel(): void { this.#used = true; if (this.#pending || !this.#closed) this.#fail("cancelled"); }
  /** Independent, shared 5s drain. A rejected run is never evidence that the child exited. */
  close(deadline?: number): Promise<void> {
    if (this.#closeTask) return this.#closeTask;
    const started = this.now(), ownDeadline = started + 5000;
    const end = deadline === undefined ? ownDeadline :
      Number.isFinite(deadline) && deadline <= ownDeadline ? deadline : started;
    let resolve!: () => void, reject!: (error: unknown) => void;
    this.#closeTask = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void this.#close(end).then(resolve, reject);
    return this.#closeTask;
  }
  async #close(deadline: number): Promise<void> {
    if (this.now() >= deadline) {
      this.#used = true;
      if (this.#pending || !this.#closed) this.#fail("cancelled", false);
      throw new WhitelistWriterError("cleanup");
    }
    this.cancel();
    if (this.#creationUncertain) throw new WhitelistWriterError("cleanup");
    if (this.now() >= deadline) throw new WhitelistWriterError("cleanup");
    if (this.#closed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.#waitClosed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WhitelistWriterError("cleanup")), Math.max(1, deadline - this.now()));
      })]);
      if (!this.closedConfirmed || this.now() >= deadline) throw new WhitelistWriterError("cleanup");
    } finally { if (timer) clearTimeout(timer); this.#wipe(); }
  }
}
