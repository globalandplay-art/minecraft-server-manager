# LC2 Synthetic whitelist execution integration — 2026-10-14

## Scope and status

UNWIRED SYNTHETIC INTEGRATION PASS: fresh frozen full regression and independent Sol High evidence review completed. This is an UNWIRED Synthetic integration Gate, not LC2 whole PASS or production member-write acceptance. Phase7 remote remains PAUSED; LM1/LM2 have not started. No real Minecraft/RCON, original world, network/system changes or Git publication.

## Implemented closed loop

- Private pinned exact-byte guard: bounded4096-byte chunks, strict manifest/hash, source snapshot binding, descriptor identity and before/after ACL verification, no-replace publication/readback. Original whitelist bytes are retained; no whitelist.json write, restoration or automatic deletion.
- Common OperationService whitelist-change admission/exclusion, request/key binding, no-TTL replay, startup recovery overlay and explicit proof-based recovery. Existing other operation expiry semantics remain unchanged.
- Construction-only Synthetic coordinator: final admission -> guard -> durable intent -> dispatch-intent -> exactly one Fake atomic dispatch -> causal receipt/archived observation verification -> common terminal persistence. No implicit start/stop/restart or response-loss retry.
- Historical completed commands verify their original archived observations, not today's member list. Matching current members alone never proves an uncertain command succeeded. Explicit recovery clears only its own cause after proof and terminal publication; unrelated causes remain.
- Manager owner activity spans queued/running/terminal common-operation persistence. Closing the coordinator or losing the owner before Fake dispatch denies sending; publication mutex remains non-reentrant and independent of activity retention.
- Production app/routes/UI/environment cannot construct this Fake provider. No new member mutation endpoint is exposed. Existing readonly Vanilla26.3 capability remains; other versions/Paper/Fabric member changes remain unavailable.

## Evidence boundary

The Fake daemon's atomic check-and-dispatch and structured historical receipt protocol are synthetic capabilities, NOT ordinary Minecraft RCON guarantees. Profile UUIDs in fixtures are predefined synthetic identities, not resolved or invented by product code. Native guard/command-store end-to-end validation, fresh OS-process transaction crash recovery, actual Vanilla26.3 command grammar/profile/persistence/causal effects and real RCON acceptance are NOT RUN. In-memory coordinator reconstruction and the JsonOperationStore disk reconstruction test retain Fake receipt observations in the same process; they do not establish cross-process receipt durability.

Existing Windows native ManagerLifetimeLock tests cover only the newly added owner activity component. Windows fsync/power-loss and same-user removal of matched history/all evidence limitations remain. No surviving journal prefix authorizes redispatch or proves non-dispatch. Storage ambiguity retains evidence and fails closed.

## Validation before freeze

- Synthetic/policy/command-store/readonly focused:94 PASS, exit0 (24+27+27+16).
- Earlier affected focused including native owner tests:96 PASS, exit0; native owner tests3 PASS. Latest additions do not claim rerunning native store acceptance.
- Shared server/operation/lifecycle/backup/properties regression:71 PASS, exit0.
- lint/typecheck:PASS after mechanical import/type fixes; final frozen check PASS.
- Independent Sol High source review:initial P2 owner retention gap; fixedAttempt1. Delta P1/P2/P3=0, permits candidate freeze. Final narrow delta and independent evidence signoff P1/P2/P3=0.
- UI/app wiring unchanged; no new browser acceptance claimed.

## Issue ledger

- LC2-SYNTHETIC-OWNER-001 / P2 / RESOLVED / Attempt1: static independent review found the owner could be released while awaiting dispatch before terminal persistence. NO_EXPLICIT_ERROR_CODE. Added shared owner activity, final atomic owner/open checks and common persistence lifetime. Close/owner-loss/queued-save/terminal-save negative tests and native owner component tests passed; independent delta P1/P2/P3=0.
- LC2-SYNTHETIC-LINT-001 / LOW / RESOLVED / Attempt1 per independent unused symbol: no-unused-vars (unused writeFile, then unused _serverId), lint exit1. Removed unused import and bound Fake registeredRoot/capture to the test server. No product safety or assertions weakened.
- LC2-SYNTHETIC-TYPE-001 / LOW / RESOLVED / Attempt1: TS2367, owner type comparison had no overlap; typecheck exit2. Reused the complete shared owner interface including activity retention; no any or strictness change. Typecheck passed.

No failing product tests or exhausted repair limit in this slice. Historical LC1/LC2/P7/native failures remain preserved; this candidate does not resolve them retroactively.

## Final frozen validation and remaining gates

Fresh frozen run `lc2-synthetic-final-a15278ef-338b-4dbf-9d80-4d4363c17b9b`: exit0, Contracts17/API1619/Web170=1806 PASS; lint/typecheck/production build/diff PASS. Source/config379/379 independently rehashed, unchanged, no duplicates. Existing543.14kB build warning retained; no threshold change. Original two-worker API configuration and deadlines retained. Raw check.log/result/frozen remain ignored under test-results. Independent source/delta/final evidence Sol High P1/P2/P3=0; owner P2 closedAttempt1. After this limited Gate, plan native isolated guard/store and fresh-process recovery validation before real-runtime design; production RCON and authenticated mutation API/UI remain closed until their own required proof/tests/review. Real Minecraft acceptance requires separate authorization. No commit/push/PR.

## Later native Gate

2026-10-14 LC2 native validation SAFETY BLOCKED: first guard roundtrip reached shared50s observation limit without drained ACK, CLEANUP_BLOCKED, exit1; two dependent death-checkpoint cases stopped/not launched (PRIOR_NATIVE_FAILURE_STOP). Native fixture retained; child/helper ownership/exit UNKNOWN, CIM HResult=-2146233088. Underlying root UNKNOWN/fixes0/2; no retry/full check or real runtime. Prior Synthetic1806PASS preserved but does not establish native Gate. WholeLC2 IN PROGRESS, remote PAUSED, LM1/LM2 NOT STARTED. See LC2_NATIVE_VALIDATION_2026-10-14.md. No Git publication.
The earlier limited Synthetic PASS is preserved; native failures are not rewritten or resolved by it.
