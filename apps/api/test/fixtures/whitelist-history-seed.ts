import path from "node:path";
import { PRIVATE_PUBLICATION_NATIVE } from "../../src/auth/private-publication-scripts.js";
import { nativePathData } from "../../src/auth/windows-native.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const fail = (): never => { throw new Error("HISTORY_SEED_INPUT_UNSAFE"); };

/** Test-only empty private entries. ACK is NOT a protection/publication/ACL receipt.
 * Original native creator, at most32 directories+64 files, no Move/remove/overwrite.
 * Caller owns setup lease, validates actual close, then supplies exact fsynced bytes.
 */
export function buildWhitelistHistorySeed(root: string, ids: readonly string[] | null) {
  if (typeof root !== "string" || !/^[A-Za-z]:\\/u.test(root) || root !== path.win32.resolve(root) || root.length > 4096 ||
    root.includes("/") || root.slice(2).includes(":") || root.split("\\").slice(1).some((part) => !part || /[<>"|?*\x00-\x1f]/u.test(part) || /[. ]$/u.test(part)) ||
    path.win32.basename(root) !== "manager" || !/^mcsm-history-open-[a-f0-9-]{36}$/u.test(path.win32.basename(path.win32.dirname(root)))) fail();
  if (ids !== null && (!Array.isArray(ids) || ids.length < 1 || ids.length > 32)) fail();
  const input = ids === null ? null : Array.from(ids);
  if (input !== null && (input.length < 1 || input.length > 32 || input.some((value) => typeof value !== "string" || !uuid.test(value)) || new Set(input).size !== input.length)) fail();
  const namespace = path.win32.join(root, "whitelist-guards");
  const action = input === null ? "[AuthPrivateNative]::Create($namespace,$true)" :
    `$ids=ConvertFrom-Json -InputObject (${nativePathData(JSON.stringify(input))})
foreach($id in $ids) {
 $directory=[IO.Path]::Combine($namespace,$id)
 [AuthPrivateNative]::Create($directory,$true)
 [AuthPrivateNative]::Create([IO.Path]::Combine($directory,'00.bin'),$false)
 [AuthPrivateNative]::Create([IO.Path]::Combine($directory,'manifest.json'),$false)
}`;
  return Object.freeze({ entries: input === null ? 1 : input.length * 3,
    script: `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
${PRIVATE_PUBLICATION_NATIVE}
'@
$namespace=${nativePathData(namespace)}
${action}
@{ok=$true;entries=${input === null ? 1 : input.length * 3}} | ConvertTo-Json -Compress` });
}
