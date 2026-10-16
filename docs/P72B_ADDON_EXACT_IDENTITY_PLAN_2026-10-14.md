# Scoped Addon Inventory exact identity hardening

Design candidate; no source hardening yet. Historical full-run revision equality remains UNKNOWN; single synthetic proof did not reproduce it. This is independently justified preventive hardening against confirmed Number identity precision risk, not a confirmed repair of that historical failure.

## Selected first slice: ephemeral inventory only

Add a specifically named backend reader for AddonInventory. It performs lstat/opened-descriptor/named-after checks with bigint dev/ino/birthtimeNs/mtimeNs/ctimeNs/nlink/size. Preserve canonical realpath, symlink and hardlink rejection, exact read bounds, short-read detection and before/opened/after matching. Readonly JAR bytes are never executed or logged. Validate a safe integer byte limit and exact bounded size before converting only size to Number for Buffer allocation; never convert dev/ino/time identity fields back to Number.

Inventory identity is a domain-separated SHA256 of exact dev/ino/birthtimeNs; physical identity uses exact dev/ino without birth time, though inventory does not persist or consume that physical field. Same-file rename semantics and replacement identity remain distinct. The helper is not a generic replacement for the shared properties/credentials reader.

Change only AddonInventory's default backend reader and add exact-reader tests. Keep the injected reader seam and all existing quotas, metadata validation, busy/admission, directory identity, snapshot rechecks and revision HMAC. Every file is checked with lossless descriptor identity throughout the default read; adding only an outer lstat around a lossy reader is insufficient because a swap-and-restore around descriptor open would evade that proof.

The resulting identity is consumed only inside Inventory's transient file set/revision. That revision already has a process-specific random HMAC key and is never a persisted physical identity or recovery receipt. No public DTO field, journal schema, private guard manifest, addon receipt, install checkpoint, auth credential or other persisted record is changed by this slice. Existing default readers in other services remain unchanged; their precision risk is explicitly deferred, not claimed resolved.

## Deferred persisted identity version plan

Before changing shared identities, enumerate properties schema6 intent/guard/checkpoint, addon-install schema7 physicalIdentity, addon-lifecycle schema8 receipt/journal and other execution/auth/Access consumers. New persisted records require an explicit identity algorithm version and domain-separated encoding; terminal history is preserved read-only. Unknown legacy-to-exact binding cannot be inferred from checksum or matching either old/new hash. Legacy nonterminal operations or retained resources without sufficient exact binding remain gated, with no automatic migration/rewrite/rebaseline/rollback/delete. Do not change directory identity already using bigint.

Credentials/ephemeral readers and persisted recovery records must be distinguished individually; a shared helper change cannot silently impose a new digest on all consumers. This compatibility/explicit recovery design needs independent review and its own authorized implementation slice; it is not implemented here.

## Mandatory focused evidence

- Deterministic synthetic descriptor test: distinct exact IDs above2^53 that collapse to the same Number must still yield distinct exact Inventory identities.
- Swapped named/opened identities, same-byte replacement, high-resolution metadata change, hardlink, symlink, quota and short-read cases reject or change revision as designed.
- Real fresh-file replacement test remains unchanged and must pass; no assertion relaxation, timeout increase or retry-until-green.
- Affected Inventory/API/install/lifecycle/property tests; verify persisted helper/format files unchanged. New frozen full regression and independent Sol High review after source changes.

No Minecraft or original worlds, real credentials, private existing records, remote provider actions, system changes or Git publication. Whole P7.2b and current full candidate remain BLOCKED until required gates are actually satisfied.
