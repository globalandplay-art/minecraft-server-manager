import path from "node:path";
import { PRIVATE_PUBLICATION_NATIVE } from "../auth/private-publication-scripts.js";
import { PRIVATE_ACL_INSPECT_SCRIPT, type PrivateAclSnapshot } from "../auth/windows-private-acl.js";
import { nativePathData } from "../auth/windows-native.js";

/** UNWIRED pure payloads. No spawn, file access, owner admission or production switch.
 * A finite group is one already-issued native operation, NOT per-item JS admission.
 * Its future controller must retain actual owner exclusion through actual child close.
 */
export const WHITELIST_GUARD_GROUP_LIMIT = 8;
export const WHITELIST_GUARD_WIDE_GROUP_LIMIT = 16;
// The creator emits exactly three ACEs. Complete compact snapshot is <1024 ASCII bytes
// even at the conservative184-character SID bound; framing/indices reserve another512.
export const WHITELIST_GUARD_GROUP_OUTPUT_BOUND = 8 * 1024 + 512;
// Strict snapshot maximum779 bytes + ordered index framing; no truncated ACEs.
export const WHITELIST_GUARD_WIDE_GROUP_OUTPUT_BOUND = 16 * 800 + 512;
const id = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const sid = /^S-1-(?:\d+-){1,14}\d+$/u;
const full = 0x1f01ff;
export class WhitelistGuardGroupError extends Error {
  readonly code = "WHITELIST_GUARD_GROUP_UNSAFE";
  constructor() { super("WHITELIST_GUARD_GROUP_UNSAFE"); }
}
function fail(): never { throw new WhitelistGuardGroupError(); }
export interface WhitelistGuardGroupPlan {
  readonly kind: "create" | "move";
  readonly indices: readonly number[];
  readonly script: string;
}
const plans = new WeakSet<WhitelistGuardGroupPlan>();
const exactKeys = (value: unknown, keys: string): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys;

/** Additional strict CREATION receipt contract; general ACL permission rules unchanged.
 * Never filter/truncate ACEs. Reject the entire group on drift, retain every file.
 */
function creationSnapshot(value: unknown): value is PrivateAclSnapshot {
  if (!exactKeys(value, "aces,ownerSid,protected,userSid") || typeof value.userSid !== "string" ||
    value.userSid.length > 184 || !sid.test(value.userSid) || value.ownerSid !== value.userSid || value.protected !== true ||
    !Array.isArray(value.aces) || value.aces.length !== 3) return false;
  const expected = [value.userSid, "S-1-5-18", "S-1-5-32-544"].sort(), actual: string[] = [];
  for (const ace of value.aces) {
    if (!exactKeys(ace, "flags,kind,mask,sid") || typeof ace.sid !== "string" || ace.kind !== "allow" || ace.mask !== full || ace.flags !== 0) return false;
    actual.push(ace.sid);
  }
  return actual.sort().every((principal, index) => principal === expected[index]);
}
const strictCreation = `
if($snapshot.userSid.Length -gt 184 -or $snapshot.ownerSid -cne $snapshot.userSid -or -not $snapshot.protected -or @($snapshot.aces).Count -ne 3) { throw 'GUARD_GROUP_UNSAFE' }
$actual=@($snapshot.aces | ForEach-Object { if($_.kind -cne 'allow' -or $_.mask -ne 2032127 -or $_.flags -ne 0) { throw 'GUARD_GROUP_UNSAFE' }; $_.sid } | Sort-Object)
$expected=@(@($snapshot.userSid,'S-1-5-18','S-1-5-32-544') | Sort-Object)
for($j=0;$j -lt 3;$j++) { if($actual[$j] -cne $expected[$j]) { throw 'GUARD_GROUP_UNSAFE' } }
`;

/** Backend-owned UUID/chunk grammar only. Manifest and arbitrary paths are excluded. */
export function buildWhitelistGuardGroup(root: string, operationId: string, input: readonly number[], kind: "create" | "move"): WhitelistGuardGroupPlan {
  return buildGroup(root, operationId, input, kind, WHITELIST_GUARD_GROUP_LIMIT);
}
/** Separate trusted capacity candidate. Existing eight-item entry is unchanged. */
export function buildWhitelistGuardWideGroup(root: string, operationId: string, input: readonly number[], kind: "create" | "move"): WhitelistGuardGroupPlan {
  return buildGroup(root, operationId, input, kind, WHITELIST_GUARD_WIDE_GROUP_LIMIT);
}
function buildGroup(root: string, operationId: string, input: readonly number[], kind: "create" | "move", limit: 8 | 16): WhitelistGuardGroupPlan {
  if (typeof root !== "string" || root.length > 4096 || !/^[A-Za-z]:\\/u.test(root) || root !== path.win32.resolve(root) ||
    root.includes("\0") || root.includes("/") || root.slice(2).includes(":") || root.split("\\").length > 64 ||
    root.split("\\").slice(1).some((part) => !part || /[<>"|?*\x00-\x1f]/u.test(part) || /[. ]$/u.test(part)) ||
    typeof operationId !== "string" || !id.test(operationId) || !Array.isArray(input) || input.length < 1 || input.length > limit ||
    !["create", "move"].includes(kind)) fail();
  const indices = Array.from(input);
  if (indices.some((index, offset) => !Number.isInteger(index) || index < 0 || index > 63 || (offset > 0 && index !== indices[offset - 1]! + 1))) fail();
  const directory = path.win32.join(root, "whitelist-guards", operationId);
  const action = kind === "create" ? `[AuthPrivateNative]::Create($stage,$false)
$snapshot=Read-AuthPrivateAcl $stage
${strictCreation}
$receipts+=@{index=$index;snapshot=$snapshot}` :
    `[AuthPrivateNative]::PublishNew($stage,$target)
$receipts+=@{index=$index}`;
  const script = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
${PRIVATE_PUBLICATION_NATIVE}
'@
${kind === "create" ? PRIVATE_ACL_INSPECT_SCRIPT : ""}
$directory=${nativePathData(directory)}
$indices=@(${indices.join(",")})
$receipts=@()
foreach($index in $indices) {
$target=[IO.Path]::Combine($directory,($index.ToString('D2')+'.bin'))
$stage=$target+'.stage'
${action}
}
@{ok=$true;entries=@($receipts)} | ConvertTo-Json -Depth 7 -Compress`;
  const plan = Object.freeze({ kind, indices: Object.freeze(indices), script }); plans.add(plan); return plan;
}

/** Checks the FULL owner-wrapped script immediately before future dispatch.
 * Conservative Windows quoting bound includes executable, fixed arguments and NUL.
 * No truncation, dynamic retry/splitting or alternative transport on refusal.
 */
export function whitelistGuardGroupCommandBound(wrapped: string, executable: string): number {
  if (typeof wrapped !== "string" || !wrapped.length || typeof executable !== "string" || !executable.length || executable.includes("\0")) fail();
  const encodedChars = 4 * Math.ceil(Buffer.byteLength(wrapped, "utf16le") / 3);
  const flags = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"];
  const upper = 2 * executable.length + 2 + flags.reduce((sum, arg) => sum + arg.length + 1, 0) + 1 + encodedChars + 1;
  if (!Number.isSafeInteger(upper) || upper > 32767) fail(); return upper;
}

/** All rows structurally checked before SID-pinned verifier receives any snapshot.
 * Actual-close/identity/bytes and before/after gates belong to the future controller.
 */
export function verifyWhitelistGuardGroupResult(plan: WhitelistGuardGroupPlan, value: unknown, verify: (snapshot: unknown) => string): readonly string[] {
  if (!plans.has(plan) || !exactKeys(value, "entries,ok") || value.ok !== true || !Array.isArray(value.entries) || value.entries.length !== plan.indices.length) fail();
  const entries = value.entries;
  for (let offset = 0; offset < entries.length; offset++) {
    const entry: unknown = entries[offset];
    if (!exactKeys(entry, plan.kind === "create" ? "index,snapshot" : "index") || entry.index !== plan.indices[offset] ||
      (plan.kind === "create" && !creationSnapshot(entry.snapshot))) fail();
  }
  if (plan.kind === "move") return Object.freeze([]);
  const hashes = entries.map((entry: Record<string, unknown>) => {
    let hash: string; try { hash = verify(entry.snapshot); } catch { fail(); }
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) fail(); return hash;
  });
  return Object.freeze(hashes);
}
