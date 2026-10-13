# P7.2a foundation loop — ENGINEERING PASS

Status: P7.2a ENGINEERING PASS (2026-10-12). This document records the complete-loop engineering Gate, not a real remote acceptance. It supersedes implementation-pending statements in the earlier P7.2a slice records for current code only; their historical results and failures remain unchanged. Real Tailscale/Cloudflare acceptance NOT RUN; production adapters unavailable.

## Implementation

Manager-wide AccessOperationStore is separate from server operations and TransactionJournal. ManagerLifetimeLock is retained by main; shared Access exclusion protects both providers and operation scans. Startup reads existing private disabled records and operation history without creating records, routes or provider actions. Private storage failure blocks Access only.

Fixed namespace `access-operations` contains immutable numbered checkpoints. A root namespace receipt binds the protected directory; per-operation admission receipts bind the genesis checksum. Receipt-before-checkpoint publication prevents a missing expected genesis from appearing unconfigured. Each checkpoint is versioned, canonical, bounded to4096 bytes and binds root/directory, operation, provider/action, configuration revision, request/key hashes, predecessor hash and observed ownership evidence. Reads verify private ACL, single-link file identity/content before and after, chain ordering and legal transitions. Unknown versions/files/stages, gaps, drift or corruption fail closed; no automatic cleanup. Scanning rejects more than10000 root entries or combined operation receipt/checkpoint entries, and more than64 checkpoints per operation. Previously observed heads cannot regress within a process.

Same UUID idempotency key and canonical request returns the original operation after restart; changed request conflicts. Nonterminal records retain admission protection indefinitely. No raw key is persisted or returned.

Admission: read-only configuration/preflight -> shared lock and fresh identity/revision/recovery checks -> final synchronous shared authorization -> private verified intent -> APPLYING -> injected adapter -> VERIFYING/read-only evidence -> terminal publication. The entire request remains awaited;202 is an admission response, never proof of successful remote configuration. Concurrent GET uses only a verified cache during publication; otherwise it scans under the same exclusion. Only the operation actually executing in this process may project a running checkpoint. Old nonterminal operations project recovery_required.

Adapter failure or response loss retains recovery evidence. Restart may observe read-only but never applies, finalizes or deletes. Explicit recovery requires operation/configuration/ownership/observed revision, healthy state, requested effect and resource revision all matching. It only appends a proven succeeded or not-applied failed terminal record. It does not retry network changes or roll back. Final authorization is repeated after recovery's filesystem/ACL waits, directly before first publication; rejection retains usable evidence without poisoning storage.

The test-only applied revision formula is a proof contract for Fake Adapter tests, **not** a claim that Tailscale has CAS or that a pair of observations prevents external races. P7.2b must establish its own reviewed ownership/concurrency/observed-resource contract before implementing a production adapter.

## API and production boundary

- GET `/api/v1/access/methods` preserves truthful unimplemented remote capabilities, desired=false, observed=unknown, URL/remoteVerifiedAt=null.
- GET `/api/v1/access/operations/:id` uses shared session authentication and no-store, exposes safe operation fields only.
- POST `/api/v1/access/:provider/enable|disable` accepts only revision/confirm=true with UUID Idempotency-Key.
- POST `/api/v1/access/operations/:id/recover` accepts only revision/confirm=true; repeated terminal recovery is read-only.

Unknown body fields are rejected before Fastify validation can strip them. No paths, commands or target ports are accepted. Session, CSRF, Origin/Host, audit and recent reauthentication remain shared. Missing authentication is not a local anonymous Access fallback. No production adapter exists: enable/disable/recover report ACCESS_UNAVAILABLE before admission or storage writes. Fake Adapter is injected by test construction only, never request/environment. Existing immutable disabled configuration is not converted into mutable enabled state. No Settings UI added.

## Current issue ledger

| Issue | Priority/status | Evidence and correction | Attempts |
|---|---|---|---|
| P72A-OP-READ-RACE | P2 / corrected, delta review closed | Initial independent static review: unlocked GET scan could see legitimate stage and poison store. Shared read/write exclusion and deterministic overlap regression added. No explicit runtime error code from static finding. |1/2|
| P72A-RECOVERY-AUTH | P2 / corrected, delta review closed | Initial review: async append checks followed earlier authorization. Final synchronous callback moved to publication after read-only waits; rejection preserves evidence. Targeted expiry/retention regression. AUTH_REAUTH_REQUIRED is the intentionally injected rejection. |1/2|
| P72A-OLD-STATE | P3 / corrected, delta review closed | Global executing flag could project old applying record while another request held lock. Replaced with current executing operation ID. No explicit error code from static finding. |1/2|
| P72A-HOST-INVENTORY | P3 / limitation | Read-only host inventory query denied HRESULT0x80041003. No process cleanup was inferred/performed from this query. Crash acceptance uses exact spawned ChildProcess handles and close events. |0/2|
| P72A-BROWSER-CLEANUP | P2 / corrected, delta review closed | Test-only wrapper initially awaited close without an independent bound. Attempt1 added30s close confirmation; delta found port error could overwrite cleanup failure and defeat immediate exit. Attempt2 uses independent ownedChildrenClosed boolean and preserves CLEANUP_BLOCKED. Static finding, no runtime error code; no original browser assertion/deadline altered. |2/2|
| P72A-MANIFEST-SHAPE | P3 / resolved | PowerShell array wrapping produced nested v3 manifest, FrozenV3Files=2 instead of25. Explicit flattening corrected at Attempt1; invalid v3 preserved, never used as validation basis. No explicit error code. |1/2|

Historical P7.2 ACL helper-timeout and load/cleanup failures remain in their original reports; neither the new Access loop nor synthetic passes mark those historical causes RESOLVED.

## Required final evidence

Native Windows process-crash acceptance PASS: `p72a-crash-ce4918b3-0b4f-4d9d-b5ec-5dde958d69e4`. Four durable boundaries (0000 intent,0001 applying,0002 verifying,0003 succeeded) were interrupted after native publication. Each used separate run/observe/recover processes, twelve owned children total, all close-confirmed. Fresh-process replay kept the original ID and applyCalls=0. Read-only startup left nonterminal evidence recovery_required; explicit recovery proved not-applied failed for0000/0001 and applied succeeded for0002, while0003 stayed succeeded. Normal observation/recovery children exited0/signal=null; original interrupted children recorded SIGTERM. Isolated fixtures remain retained. Production remote provider calls=0 and original user data accessed=false.

Frozen candidate `test-results/p72a-foundation-frozen-v6.json` contains25 source/test files;25/25 match before and after final validation. Invalid nested v3 manifest remains preserved and was not used.

Final results:

- Focused fake/disk/API/auth55 PASS/native0; strict DTO delta6 PASS/native0; contracts10 PASS/native0.
- New frozen `npm.cmd run check`: Contracts10 + API1325 + Web153 =1488 PASS/native exit0. API82 files/636.35s; Web27 files/12.96s. Lint/typecheck/production build completed in the same check. Evidence: `test-results/p72a-foundation-full-v1.log` and `.exit.txt`.
- Unchanged auth browser spec360/768/1440:3 PASS/8.8s/native0. Evidence: `test-results/p72a-auth-browser-a9f00098-d722-42f1-8d10-bfbd2a9cc228/result.json` and `browser.log`. Exact owned Vite stopped with SIGTERM; owned children closed=true and portReleased=true. No failed assertion or timeout was changed.
- `git diff --check` exit0. Git LF/CRLF notices are retained; no whitespace errors.
- Independent GPT-6.1 Sol High whole-loop source and final evidence signoff: P1=0/P2=0/P3=0, ENGINEERING PASS. No source or test changes in final signoff.
- Nonblocking output preserved: Vite531.32kB chunk warning, two jsdom navigation-not-implemented messages and browser NO_COLOR/FORCE_COLOR notice. These are not real-provider diagnostics.

This is a new1488-PASS baseline, not reuse of the historical1429-PASS authentication baseline. Historical partial result v1 remains unchanged; final summary is recorded separately in `test-results/p72a-foundation-results-v2.json`.

## Retained limits

Same-user administrative deletion of all private evidence cannot be proven by a local ledger. Fresh-process removal of only terminal tail checkpoints conservatively becomes recovery_required rather than permitting reapply; an absent historical tail cannot be reconstructed as historical truth. Windows power-loss/directory flush limits remain. Process crash acceptance kills after a native publisher completes, not during the kernel call; publication faults and retained stages have separate injected tests. Evidence is never automatically removed. All remote/Minecraft actions remain unauthorized and unperformed; original credentials and worlds are untouched.

No commit, push or PR. After the full engineering Gate passes, stop; P7.2b-A is a separate next stage.
