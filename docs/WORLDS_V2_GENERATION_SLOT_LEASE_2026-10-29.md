# Dedicated generation slot writer composition (2026-10-29)

## Implementation scope

OperationService now reuses its private generation lease core behind distinct
read-only inspection and backend slot-commit entries. The read-only callback
receives one runtime argument, never a write guard. The writer receives a sync
guard scoped to one lease; leaseOpen is closed in release-finally so a captured
guard cannot be reused during a later same-instance lease. Original owner,
receipt, journal, cause/cache checks and final release checks remain mandatory.

WorldGenerationService.commitPublishedSlot registers its owner before awaiting
the dedicated lease. Pending observations with a startup descriptor must pass
the exact typed current-state proof. Active observations only enter the immutable
intent helper, which refuses active without the original intent/stage identity.
Every helper authorization checks both lease and owner admission. close aborts
admission but waits for the action and lease to drain; no process stop/kill.

No receipt, recovery cause, typed cache or normal active snapshot is changed.
After a protected pending slot commits, ordinary inspection can still reject
its old descriptor. Explicit commit continuation can read-only confirm the exact
installed intent. This is deliberately not settlement or a ready capability.
No HTTP route or production startup runner is mounted by this unit.

## Validation checkpoint

Design independently approved by GPT-6.1 Sol High. API typecheck exit0; new
lease integration and existing generation-execution tests running. Independent
source/evidence acceptance PENDING until recorded. Cases cover live and fresh
startup, active with/without intent, descriptor retention, guard escape and runtime
argument privacy, same-instance conflict, close drain, revocation/external causes
and safe explicit continuation after failed admission. Fake runtime only.

Prior CAS primitive87PASS/five-hash limited acceptance remains historical for
that candidate; it did not certify this new composition. P7 STOPPED. No Git or
system/network changes, real world operations or new Java run.

## Fresh integration evidence

slot-lease report140PASS/0FAIL/0pending: generation service94 and execution46.
The previous primitive87 is an overlapping subset, not an additive test total.
API typecheck/build, scoped ESLint and diff check exit0. Independent Sol High
source review P1/P2/P3=0/0/0, bounded source ACCEPT. Seven-file candidate manifest
records the composed source/test/report. Final hash/evidence readback PENDING
until returned. No source change after freezing; documentation updates only.

Final independent GPT-6.1 Sol High readback completed:7/7hashes match and HEAD
unchanged;140PASS/0FAIL/0pending independently read; P1/P2/P3=0/0/0, limited
ACCEPT for backend write-lease/owner composition. Earlier PENDING is historical.
Not an API, ready, receipt-settlement, real OS crash or actual Java certification.

## Remaining delivery and next constraint

The current immutable CAS intent binds the original receiptDigest. A future
settlement design must not blindly overwrite a first receipt and then discover
that the remaining explicit continuation no longer matches its immutable intent.
Define and independently review a crash-resumable final-evidence/receipt protocol
before implementing any settlement write. This unit intentionally changes no
receipt and makes no claim that partial receipt settlement is already supported.

Partial receipt settlement and final completion evidence; safe typed active
startup explanation and legitimate subsequent-save policy; final readiness
invalidation; authorized HTTP/UI recovery and fresh real acceptance. Unknown
and external causes cannot be relabeled or cleared by slot commit.
