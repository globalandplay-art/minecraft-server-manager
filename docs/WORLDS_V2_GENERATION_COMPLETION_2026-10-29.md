# Append-only generation completion evidence (2026-10-29)

## Scope

Keep original parent/execution receipts immutable because CAS binds their
receiptDigest. Add one dedicated immutable completion record, not a new general
transaction system. sealPublishedCompletion remains backend-only under the
accepted generation mutation lease and close-drain owner. Its result is explicitly
completion-evidence-awaiting-readiness, inspectionOnly/recoveryRequired=true.
No receipt-success projection, active snapshot, cause clearing or ready/API
permission is implemented by this evidence alone.

The completion payload reuses the CAS canonical proofDigest and binds parent,
birth, catalog, original receipts, world, CAS intent checksum/identity and installed
slot checksum/identity. It is derived from fresh full proof, wx/fsync-published
and checked against the opened file identity. Existing completion, even partial
or corrupt, is never overwritten, removed or used to repair pending state.

## Ordering and final proof

Probe completion before invoking CAS. Existing completion requires active and
the original intent with absent stage: helper invocation is read-only then.
All slot entry points also check the completion fence at entry and immediately
before the last pending-slot CAS check, so the old commit path cannot bypass it.
Only absent completion allows explicit CAS/continuation before a new record.

After publication perform a full current-state recheck, verify the already bound
CAS intent checksum/identity and installed slot checksum/identity, directory
identity, completion bytes/identity and final fixed-stage absence. This retains
the required full post-write proof without re-running the entire CAS protocol
and its multiple redundant full-tree observations. No timeout is increased.

## Retained evidence and current checkpoint

Initial completion report100PASS/1FAIL retained. The combined publication/re-read
case recorded5028ms against the default5000ms test bound (STACK_TRACE_ERROR in
JSON report). Source inspection identified repeated full CAS verification after
publication; replaced with the full recheck and exact metadata checks above.
Fresh final validation is required before calling this corrected candidate PASS.

Independent review found late completion fence P2: a completion created after
intent publication must prevent rename and preserve pending/stage/intent/completion.
Both slot and completion entries now have dedicated fault cases. No previous
failure or strict assertion is removed. Final source/evidence review PENDING.

Startup receipt normalization was also found to change generation receipt
updatedAt on each Manager reconstruction; fixed-clock tests do not establish
cross-restart validity. A narrowly scoped raw-receipt preservation policy and
advancing-clock reconstruction test are under independent review. Do not claim
cross-Manager continuation until that change and evidence are accepted.

The approved minimal startup fix preserves original raw receipts only for a
valid generation execution receipt or a same-server/id/kind schema14 generation
parent. Existing generation causes and interrupted get() projection remain;
queued/running receipts are still rejected by the dedicated commit lease. Other
operation normalization is unchanged. Added reconstruction uses a later clock,
new OperationService and new WorldGenerationService, checks original JSON bytes,
and verifies an unrelated running backup still normalizes to interrupted.
Orphan execution tests retain all five original states without re-execution.

P7 STOPPED. No Git publication, real Minecraft, world/system/network changes or
new remote feature. Windows directory-sync limitations remain those of the
existing helper; no unconditional power-loss durability claim is made.

## Final limited acceptance

Fresh reviewed report150PASS/0FAIL/0pending (service104+execution46). Additional
affected lifecycle/server-service27PASS/0FAIL/0pending. Double completion check
3905.59ms and advancing-clock reconstruction3893ms; default5000ms remains.
API typecheck/build, scoped ESLint and diff check exit0. Independent GPT-6.1
Sol High verified8/8candidate hashes, unchanged HEAD and both reports; P1/P2/P3
=0/0/0, limited ACCEPT for completion evidence and generation raw-receipt
startup stability. Original100/1report retained. Earlier PENDING checkpoints
are superseded only for this scope. No success projection/clear/ready/API,
real OS-process crash or actual Minecraft acceptance is certified.

## Remaining delivery

Completion does not yet settle the public operation result. Final readiness,
subsequent legitimate save/lifecycle policy, active-state integration, explicit
HTTP/UI and scoped OS-process/real Minecraft acceptance remain required.
