import { spawn } from "node:child_process";
import { lstat, realpath, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { TailscaleReadError, tailscaleReadArguments, type TailscaleReadCommand, type TailscaleReadRunner } from "./tailscale-readonly.js";

const executable = "C:\\Program Files\\Tailscale\\tailscale.exe";
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
/** Fixed argv only; waits for close, bounds combined output, never publishes raw errors. */
async function execute(file: string, args: readonly string[], timeout: number, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let code: string | undefined; let bytes = 0; let output = ""; let cleanup: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: string) => {
      if (code) return; code = reason; child.kill();
      cleanup = setTimeout(() => reject(new TailscaleReadError("TAILSCALE_CLEANUP_BLOCKED")), 5000);
    };
    const timer = setTimeout(() => stop("TAILSCALE_TIMEOUT"), timeout);
    child.on("error", () => { code ??= "TAILSCALE_SPAWN_FAILED"; });
    const capture = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length;
      if (bytes > limit) { stop("TAILSCALE_OUTPUT_LIMIT"); return; }
      if (stdout && !code) output += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, false));
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer); if (cleanup) clearTimeout(cleanup);
      if (code || exitCode !== 0 || signal !== null) reject(new TailscaleReadError(code ?? "TAILSCALE_EXIT_FAILED"));
      else resolve(output);
    });
  });
}
async function identity(): Promise<string> {
  try {
    for (const item of ["C:\\Program Files", path.dirname(executable), executable]) {
      const stat = await lstat(item);
      if (stat.isSymbolicLink() || (await realpath(item)).toLowerCase() !== item.toLowerCase()) throw new Error();
    }
    const stat = await lstat(executable);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 128 * 1024 * 1024) throw new Error();
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${createHash("sha256").update(await readFile(executable)).digest("hex")}`;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw new TailscaleReadError("TAILSCALE_UNAVAILABLE");
    throw new TailscaleReadError("TAILSCALE_EXECUTABLE_UNTRUSTED");
  }
}
/** No PATH discovery, arbitrary paths, env flag or configurable CLI parameters. */
export class WindowsTailscaleReadRunner implements TailscaleReadRunner {
  #blocked = false;
  async run(command: TailscaleReadCommand): Promise<string> {
    if (this.#blocked) throw new TailscaleReadError("TAILSCALE_CLEANUP_BLOCKED");
    if (process.platform !== "win32") throw new TailscaleReadError("TAILSCALE_UNAVAILABLE");
    if (!Object.hasOwn(tailscaleReadArguments, command)) throw new TailscaleReadError("TAILSCALE_CLI_UNSUPPORTED");
    try {
      const before = await identity();
      // Fixed read-only signature/ancestor write-ACL query, no user values or ACL changes.
      const script = String.raw`$ErrorActionPreference='Stop'
$p='C:\Program Files\Tailscale\tailscale.exe'
$trusted=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
$s=Get-AuthenticodeSignature -LiteralPath $p
$ok=($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match '(^|, )CN=Tailscale Inc\.?($|, )')
foreach($d in @('C:\Program Files','C:\Program Files\Tailscale',$p)){
  if(([int](Get-Item -LiteralPath $d -Force).Attributes -band 1024) -ne 0){$ok=$false}
  $a=Get-Acl -LiteralPath $d
  $owner=([Security.Principal.NTAccount]$a.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
  if($owner -notin $trusted){$ok=$false}
  foreach($r in $a.Access){
    if(($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){continue}
    if($r.AccessControlType -eq 'Allow' -and ([int]$r.FileSystemRights -band 852310) -ne 0){
      $sid=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if($sid -notin $trusted){$ok=$false}
    }
  }
}
@{approved=$ok}|ConvertTo-Json -Compress`;
      const verified = await execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], 15_000, 4096);
      if (JSON.parse(verified).approved !== true || await identity() !== before) throw new TailscaleReadError("TAILSCALE_EXECUTABLE_UNTRUSTED");
      const output = await execute(executable, tailscaleReadArguments[command], 5000, 64 * 1024);
      if (await identity() !== before) throw new TailscaleReadError("TAILSCALE_EXECUTABLE_CHANGED");
      return output;
    } catch (error) {
      if (error instanceof TailscaleReadError) { if (error.code === "TAILSCALE_CLEANUP_BLOCKED") this.#blocked = true; throw error; }
      throw new TailscaleReadError("TAILSCALE_EXECUTABLE_UNTRUSTED");
    }
  }
}
