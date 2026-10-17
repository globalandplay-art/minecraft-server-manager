import { TextDecoder } from "node:util";
import { buildWhitelistGuardGroup } from "../../src/services/whitelist-guard-group-scripts.js";

/** Test-only finite Create-loop pause. Original creator, ACL rows and next iterations
 * unchanged; direct sibling transport ONLY, never supplied to a product writer.
 */
export function pausedGuardCreateGroup(root: string, guard: string) {
  const plan = buildWhitelistGuardGroup(root, guard, Array.from({ length: 8 }, (_, i) => i), "create");
  const marker = "$receipts+=@{index=$index;snapshot=$snapshot}";
  if (plan.script.split(marker).length !== 2) throw new Error("GROUP_PAUSE_SOURCE_MISMATCH");
  const prelude = `$utf8=[Text.UTF8Encoding]::new($false,$true)
[Console]::OutputEncoding=$utf8
$reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),$utf8,$false,4096,$true)
function Read-GroupRelease {
 $clock=[Diagnostics.Stopwatch]::StartNew();$line='';$one=[char[]]::new(1)
 while($true) {
  $pending=$reader.ReadAsync($one,0,1)
  while(-not $pending.IsCompleted) { if($clock.ElapsedMilliseconds -ge 12000) { throw 'GROUP_CONTROL_TIMEOUT' };[Threading.Thread]::Sleep(5) }
  if($clock.ElapsedMilliseconds -ge 12000 -or $pending.Result -ne 1) { throw 'GROUP_CONTROL_EOF' }
  if($one[0] -eq [char]10) { break }
  if($line.Length -ge 8) { throw 'GROUP_CONTROL_LIMIT' };$line+=$one[0]
 }
 if($line -cne 'RELEASE') { throw 'GROUP_CONTROL_INVALID' }
}
`;
  const pause = `${marker}
if($index -eq 0) { [Console]::Out.WriteLine('{"phase":"paused-after-first-create"}');[Console]::Out.Flush();Read-GroupRelease }`;
  return { plan, script: prelude + plan.script.replace(marker, pause) };
}

/** Strict bounded private protocol. Never includes raw ACL rows in diagnostics. */
export class GuardGroupRetentionFrames {
  #buffer = Buffer.alloc(0); #total = 0; #result: unknown;
  phase = 0; fault = false;
  get totalBytes() { return this.#total; }
  get result(): unknown { return this.phase === 2 && !this.fault ? this.#result : undefined; }
  push(chunk: Buffer): void {
    if (this.fault) return;
    if (!Buffer.isBuffer(chunk) || chunk.length > 16384 - this.#total) { this.fault = true; return; }
    this.#total += chunk.length; this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (let n; (n = this.#buffer.indexOf(10)) >= 0;) {
      const line = this.#buffer.subarray(0, n); this.#buffer = this.#buffer.subarray(n + 1);
      try {
        const row: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
        if (typeof row !== "object" || row === null || Array.isArray(row)) throw new Error();
        const value = row as Record<string, unknown>;
        if (this.phase === 0 && Object.keys(value).join(",") === "phase" && value.phase === "paused-after-first-create") this.phase = 1;
        else if (this.phase === 1 && Object.keys(value).sort().join(",") === "entries,ok" && value.ok === true && Array.isArray(value.entries) && value.entries.length === 8) {
          this.#result = value; this.phase = 2;
        } else throw new Error();
      } catch { this.fault = true; }
      if (this.fault) { this.#result = undefined; return; }
    }
  }
  finish(): void { if (this.#buffer.length || this.phase !== 2) { this.fault = true; this.#result = undefined; } }
}
