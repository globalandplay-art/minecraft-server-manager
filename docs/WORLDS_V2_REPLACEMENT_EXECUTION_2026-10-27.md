# Worlds V2 replacement execution continuation — IN PROGRESS

## Scope and inherited evidence

Continues the publication checkpoint; no new Phase0, Git publication or P7 work.
The earlier 27-file hash artifact remains a historical candidate, not evidence for
the source changes in this continuation. Original test failures remain preserved.

## Mixed immutable predecessor protection

The existing replacement journal wrapper now checks the exact ordered prefix and
latest record against the actual journal, and verifies every predecessor's retained
immutable protection. Activation uses its existing guard/copy proof; schema13
replacement uses its retained old tree, guard and approval snapshots with the exact
earlier prefix. Schema12 remains inspection-only. Historical live paths are not
compared with original imported bytes. A final latest-installed pass follows the
last predecessor pass, followed by journal comparison; leases remain caller-owned.

First report mixed-prefix-attempt1:58PASS/1FAIL (new fixture incorrectly hashed one
record instead of the history array). Corrected report60PASS. Independent review
found P3 coverage gap: initial-construction mutation did not test the final retained
phase. Revised returned-proof mutation tests for target/claim/controls now protect
that exact ordering; mixed-prefix-reviewed report60PASS, independent Sol High
P1/P2/P3=0/0/0. No live-state/recovery authority is implied.

## Actual executor candidate

New WorldReplacementService is UNMOUNTED. It reuses internal under-lease import
preparation, the existing operation/upload locks, durable operation and journal,
legacy pinned backup and protected catalog publication. It executes all15 schema13
checkpoints, preserves the old world under its owned workspace and installs verified
staged data through same-volume renames with persisted intents. Properties and
legacy active-state bytes remain unchanged; new immutable catalog identity retires
the old identity. No automatic restart, rollback, replay or evidence cleanup.

The current candidate deliberately rejects nonempty transition history until mixed
live-state admission/recovery is integrated. It is not a general replacement API.
The live OperationService retains replacement-owned inspection immediately after
intent and after successful publication. Generic confirmation/recovery cannot clear
it. Postcommit failures preserve the committed journal and invalidate only the exact
owned catalog head. Startup/explicit recovery, shutdown coordination, HTTP/UI,
fresh OS-process interruption and actual Minecraft replacement remain required.

First executor report:24PASS/6FAIL, with unexercised injection points not yet
explicitly asserted. Independent P2: controls classified its own active journal as
an unrelated recovery blocker, preventing healthy progress. Attempt1 excludes only
the exact owned journal from unfinished-work classification, preserving full get
equality, other records, issues and live inspection gate. All interruption tests now
must prove their named injection point was reached. Updated result/review pending.

API typecheck and scoped lint passed before this small owned-journal correction;
final checks remain required. No actual Minecraft/world/repository operation run.
Fake runtime results are not real Minecraft acceptance. V2 remains IN PROGRESS.

## Reviewed executor and independent process result

Owned-journal correction report30PASS. Fault coverage strengthened again: each
injection reached exactly once, exact persisted marker prefix and both rename-gap
file placements asserted. Fresh affected report
`worlds-v2-replacement-executor-affected-2026-10-27.json`:280PASS/0FAIL/0pending,
five files (114 import,45 journal,60 protection,30 executor,31 transition records).
API typecheck/scoped lint exit0. Independent Sol High re-read source and report,
closed P2/P3 and accepted this UNMOUNTED first-transition checkpoint0/0/0.

Existing OS-process harness extended with --replacement; existing modes preserved.
New five-boundary run:
`test-results/worlds-v2-replacement-crash-2c9718ce-442e-41c6-b610-e7e0fe63b07c/result.json`.
All5PASS: durable intent, old rename gap, new rename gap, committed journal and
completed catalog. Parent interrupted exact spawned Node handles after nonce-owned
IPC evidence, confirmed close, then launched a distinct probe OS process. Old data
and guards retained, server bytes unchanged by probe, same operation ID on replay,
one journal and recovery gate true for every case. All children closed; Java starts0.
This verifies gated reconstruction/no replay, NOT implemented recovery acceptance,
not full Fastify startup, not real Minecraft and not V2 FINAL PASS. Final independent
process-evidence readback accepted by independent Sol High0/0/0:5boundaries,
10distinct child PIDs, all29source hashes matched. Fixtures preserved as owned evidence; no cleanup
of unknown processes or historical uncertain fixtures.

## Current-state observation and recovery boundary in progress

Added read-only first committed replacement current-state proof. It verifies
immutable guards/approvals, exact journal, committed catalog, current object and
stable current files/controls, trusted source/NBT profile and ordinary import
births. Normal active-world saves/settings changes need not equal original bytes;
historical identity/protection remains required. The installed/publication proof
keeps its original strict import-content comparison. Mandatory source/claim reading
is shared rather than bypassing the existing upload verifier.

Independent review found two P2 areas: complete ordinary import birth bindings
(including the explicitly retired predecessor), and rechecking retained inactive
sources/claims. Dedicated bidirectional catalog audit now checks roots, entry
metadata, exact six checkpoints and original/preserved object links. Every birth
source and mandatory claim is rechecked, including actual claim deletion and
same-byte/new-object replacement. Metadata-relocation unit cases are explicitly
binding-only synthetic evidence, not alternate execution acceptance.

Baselines retained:100PASS initial,105PASS object checks,112PASS initial births;
four-file175PASS/1FAIL was a synthetic retired fixture using a reader that correctly
rejects external revisions. Fresh reader used for that deliberate binding fixture,
without changing product guard. Final current-state/birth report179PASS/0FAIL/
0pending across4files. Independent source fixes0/0/0; final evidence readback pending.
One typecheck initially caught an unused local; removed; current typecheck PASS.

Dedicated OperationService.verifyReplacementOutcome is now an UNMOUNTED candidate:
exact owned causes, instance then upload lease continuation, current proof before/
after receipt persistence and exact journal/receipt checks; interrupted outcomes
require explicit recovery. Generic recovery stays closed. Receipt-save or late
physical failure must retain uncertainty without rewriting the committed journal.
Tests/review pending; no startup/HTTP/UI integration or overall recovery PASS.

Current-state final reviewed evidence independently accepted179PASS/0FAIL/
0pending, Sol High0/0/0. Dedicated settlement initial112PASS was before callback
lifetime hardening. Review P2: escaped/detached consumer could outlive its leases.
Per-invocation revocation after owner close, checks around awaited mutation stages
and draining before instance unlock now implemented; current GET/replay stays
uncertain until final verification, including after receipt persistence. Independent
source review0/0/0; evidence gate still PENDING.

Lifetime suite113PASS/2FAIL: two new cases hit unchanged default5s limits (5052ms,
5030ms). One focused diagnostic at the same deadline passed2cases (2308ms,2560ms),
68other cases NOT RUN by name filter. This proves no root cause for the broad-run
timing difference; no timeout, assertion or production validation changed. One
affected module revalidation is running without simultaneous build/lint work.
Report paths: settlement-attempt1, settlement-lifetime, settlement-timing-focused,
settlement-final (all worlds-v2-replacement prefix/date2026-10-27 JSON).

## Accepted settlement and shutdown continuation

Final affected settlement report115PASS/0FAIL/0pending accepted independently by
Sol High0/0/0. Earlier failures remain historical; no changed timeout or weakened
assertion. Explicit OS recovery run b12ccce2-acf9-4c82-a320-42b44378f41c passed5
boundaries and was independently accepted0/0/0 (30 source hashes,10 child PIDs).

Executor close now rejects new admission, tracks receipt/admission/job lifetime
through OperationService's existing owner callback, and cooperatively interrupts.
Independent5s cleanup deadline reports CLEANUP_BLOCKED while retaining unfinished
owners/leases. Review P2 found awaited checks immediately before world renames
could allow late close to proceed; check() now runs immediately after the final
await before all three renames. Both pre-world-rename injection cases verify no
move after close. Final shutdown-reviewed report76PASS/0FAIL/0pending, process
exit0, independent Sol High0/0/0 accepted. This is executor-only, not app hooks.

Latest changed-candidate OS recovery rerun:
`test-results/worlds-v2-replacement-recovery-crash-71585dae-604a-49e6-bd44-57c135aaa706/result.json`.
All5PASS, process exit0. Four incomplete boundaries remain gated; complete head
publication can explicitly confirm through current physical proof. No replay,
all owned children closed, no Java. Final candidate evidence readback pending.

Strict replacement approval DTO added using existing opaque identity/revision
schemas. All eight approval fields required, extra paths/override permissions/
recovery proof rejected. Service consumes the shared type only; no runtime route
enabled and preview still executionAvailable=false. Focused Contracts5PASS;
independent delta review pending. Full V2 remains IN PROGRESS.

Contracts full module33PASS/0FAIL/0pending, report
`test-results/worlds-v2-replacement-contracts-2026-10-27.json`; API build,
scoped ESLint and diff checks exit0. New candidate artifact:
`test-results/worlds-v2-replacement-execution-candidate-2026-10-27.json`.
It explicitly records that the latest OS run precedes the strict DTO addition
and type-only service import; no rename/close runtime semantics changed in that
delta. Do not claim the old report hashes equal these two changed source files.

## Exact next integration boundary

Current app.ts constructs one OperationService, uploads, imports and backups;
reuse these same objects for replacement rather than building a parallel runtime.
ManagerStartupRecovery is startup-scoped: its check/close cannot alone own later
explicit outcome verification. Runtime outcome tasks need owned lifetime and a
closing admission check before adapter disposal; executor close must join before
service.close. Startup should observe and retain incomplete replacement gates,
not replay or automatically confirm interrupted receipts.

Activation-only reconciler/history currently rejects replacement records; do not
route mixed replacement history through it or infer authority from an immutable
prefix proof. Current first-transition executor intentionally rejects nonempty
transition history. HTTP approval must validate strict raw fields before Fastify
coercion/removal and recheck the existing mutation admission after waits; proof
continuations remain backend-only. UI capability must remain false until the
actual shared-runtime endpoint and explicit recovery/close tests are accepted.
Next work: application recovery lifetime integration, bounded first-transition
API and UI, then actual isolated Minecraft replacement acceptance. Mixed-history
write support remains independently gated. No product Final claim.

Final independent Sol High readback accepted this bounded checkpoint0/0/0:
strict8-field DTO, Contracts33PASS,5 OS boundaries/10closed children/Java0,
all33source/test hashes and4report hashes matched. OS/type-only delta limits
accepted. Earlier pending statements above describe their historical checkpoints;
they do not supersede this bounded acceptance. All product integration gates
listed above remain open. No Git upload or real server operations performed.
