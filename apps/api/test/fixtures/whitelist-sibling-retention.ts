import { TextDecoder } from "node:util";
import { PRIVATE_ACL_INSPECT_SCRIPT } from "../../src/auth/windows-private-acl.js";
import { nativePathData } from "../../src/auth/windows-native.js";

/** Test-only primitive protocol; no product transport, raw ACL output or query deadline exemption. */
export function siblingRetentionScript(target: string, fingerprint: string): string {
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) throw new Error("RETENTION_FIXTURE_INPUT");
  return `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$utf8=[Text.UTF8Encoding]::new($false,$true)
$reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),$utf8,$false,4096,$true)
$writer=[IO.StreamWriter]::new([Console]::OpenStandardOutput(),$utf8,4096,$true)
$writer.AutoFlush=$true
${PRIVATE_ACL_INSPECT_SCRIPT}
function Confirm-Snapshot {
 $s=Read-AuthPrivateAcl (${nativePathData(target)})
 $canonical=[ordered]@{userSid=$s.userSid;ownerSid=$s.ownerSid;protected=$s.protected;aces=@(foreach($a in $s.aces) { [ordered]@{sid=$a.sid;kind=$a.kind;mask=$a.mask;flags=$a.flags} })}
 $bytes=$utf8.GetBytes(($canonical|ConvertTo-Json -Depth 5 -Compress))
 $sha=[Security.Cryptography.SHA256]::Create()
 try { $hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
 finally { [Array]::Clear($bytes,0,$bytes.Length);$sha.Dispose() }
 if($hash -cne '${fingerprint}') { throw 'RETENTION_SNAPSHOT_MISMATCH' }
}
function Read-Control([string]$expected) {
 $clock=[Diagnostics.Stopwatch]::StartNew();$line='';$one=[char[]]::new(1)
 while($true) {
  $pending=$reader.ReadAsync($one,0,1)
  while(-not $pending.IsCompleted) { if($clock.ElapsedMilliseconds -ge 12000) { throw 'RETENTION_CONTROL_TIMEOUT' };[Threading.Thread]::Sleep(10) }
  if($clock.ElapsedMilliseconds -ge 12000 -or $pending.Result -ne 1) { throw 'RETENTION_CONTROL_EOF' }
  if($one[0] -eq [char]10) { break }
  if($line.Length -ge 8) { throw 'RETENTION_CONTROL_LIMIT' };$line+=$one[0]
 }
 if($line -cne $expected) { throw 'RETENTION_CONTROL_INVALID' }
}
try {
 Confirm-Snapshot
 $writer.WriteLine('{"phase":"ready","verified":true}')
 Read-Control 'ACTIVE'
 $writer.WriteLine('{"phase":"accepted-before-inspection"}')
 Read-Control 'RELEASE'
 Confirm-Snapshot
 $writer.WriteLine('{"phase":"done","verified":true}')
} catch { exit 1 }
finally { $reader.Dispose();$writer.Dispose() }
`;
}

/** Only three fixed, ordered metadata events; snapshots/scripts never enter this channel. */
export class SiblingRetentionFrames {
  #buffer = Buffer.alloc(0); #bytes = 0;
  phase = 0; fault = false;
  push(chunk: Buffer): void {
    if (this.fault) return;
    this.#bytes += chunk.length;
    if (this.#bytes > 4096) { this.fault = true; return; }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (let n; (n = this.#buffer.indexOf(10)) >= 0;) {
      const line = this.#buffer.subarray(0, n); this.#buffer = this.#buffer.subarray(n + 1);
      try {
        const row: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error();
        const value = row as Record<string, unknown>, keys = Object.keys(value).sort().join(",");
        if (this.phase === 0 && keys === "phase,verified" && value.phase === "ready" && value.verified === true) this.phase = 1;
        else if (this.phase === 1 && keys === "phase" && value.phase === "accepted-before-inspection") this.phase = 2;
        else if (this.phase === 2 && keys === "phase,verified" && value.phase === "done" && value.verified === true) this.phase = 3;
        else throw new Error();
      } catch { this.fault = true; return; }
    }
  }
  finish(): void { if (this.#buffer.length || this.phase !== 3) this.fault = true; }
}
