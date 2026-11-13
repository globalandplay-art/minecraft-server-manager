# Activation history continuation — IN PROGRESS

Latest timing/routing continuation: see
[bounded timing checkpoint](./WORLDS_V2_TIMING_2026-10-26.md). Fresh affected100PASS
includes unchanged5000ms roundtrip4720ms. Historical failures below remain intact.
This does not enable production writes or complete repeated startup recovery.

## Source-provenance continuation

### Historical physical protection continuation

#### Optional repeated executor candidate (not production mounted)

The existing activation executor now accepts an optional backend history verifier.
Its default remains first-only. The opt-in candidate verifies source provenance,
uses explicit predecessor/sequence and guard schema11, reserves pending head
before filesystem work, then completes the head after committed journal evidence
and fresh physical verification. Planning receives the exact catalog revision;
the history target verifier binds inactive contents to their last departure guard.
Original import-source verification remains a caller obligation for import kind.

The candidate repeats old guard/journal checks before configuration rename and
final commit. New publication boundaries recheck current guard/config copies,
both live trees, installed config, catalog bindings and active selection. If a
final physical check fails, only this operation's exact transaction+intent head
is invalidated to pending; terminal journals remain immutable. This is a durable
inspection gate, not automatic rollback or file repair. Failure to publish that
gate must preserve uncertainty/evidence; production recovery remains unfinished.

The isolated three-transition scenario preserves legitimate saves in both worlds
and uses schema11 for both return transitions. Old guard damage before a repeated
switch leaves current config unchanged and pending evidence retained. Two head
interruption tests reconstruct services without replay; this is not an OS-process
crash or full Manager restart acceptance.

Retained failures: initial affected report
`test-results/worlds-v2-repeated-executor-2026-10-26.json` has87 PASS/1 FAIL
(three-transition test exceeded unchanged5000ms). A later focused run also exposed
an inaccurate assumption that protection-only verification must detect changed
live contents after committed-head publication; a durable pending invalidation
was added rather than weakening that assertion. Six publication corruption cases
now all require pending head and rejected protection gate. An unused preliminary
preflight/controller was removed from the test fixture only; all three actual
plans, operations, physical checks and assertions remain. Focused final scenario
ran4598ms within unchanged5000ms. No timeout or product safety check was relaxed.

`test-results/worlds-v2-publication-fix-2026-10-26.json`:7 PASS/67 filtered,
exit0. The filters are targeted selection, not repository full acceptance.
Independent reviewers closed the publication P2; scoped P1/P2/P3=0. Final affected
report is `test-results/worlds-v2-repeated-executor-final-2026-10-26.json`.
That final report is **94 PASS /1 FAIL across3 files, exit1,90.11s**. The same
three-step roundtrip reached5042ms and exceeded unchanged5000ms. Earlier targeted
PASS does not override it; repeated execution remains BLOCKED. API typecheck,
API build, scoped lint and diff passed after mechanical import/type/lint fixes.
No timeout increase, assertion removal, repeat-until-PASS, or new full repository
PASS is claimed. Next is bounded timing diagnosis before additional execution
expansion. All test processes from these commands completed; no Java started.

An additional publication P2 was found and closed after that affected run:
checking intent alone could miss altered committed checkpoints. The executor
now retains `setState`'s exact committed snapshot, compares the complete journal
before/after physical publication checks and supplies the same snapshot to head
completion. Two targeted checkpoint-corruption cases PASS,exit0; report
`test-results/worlds-v2-publication-journal-2026-10-26.json`. The final eight-case
publication matrix is recorded separately in
`test-results/worlds-v2-publication-matrix-final-2026-10-26.json`.
Both independent reviewers closed this P2 with no remaining scoped P1/P2/P3.
This does not supersede the94PASS/1FAIL affected result or accept timing,
multi-transition restart, production writer, browser or real Minecraft Gates.
No repeated physical startup acceptance, production route/UI, real Minecraft,
browser, complete Phase1 or V2 FINAL PASS is claimed. Next required work is exact
multi-transition restart/supersession proof consumption and interruption coverage,
bounded startup/cancellation, then strict confirmation API/UI.

`world-activation-protection.ts` extracts existing immutable guard/configuration
verification from the first reconciler. It checks ordered checkpoints, pinned
manifest and directory identities, exact protected config transformation and
copy identities, complete guard payload and single-root layout. It exposes a
fresh physical recheck rather than a reusable recovery authorization. The first
reconciler retains its separate live old-world and target checks.

`WorldActivationHistoryProtection` is a backend-only, unmounted history pass:
scan issues/archive/unfinished records fail closed; durable catalog head and
every historical guard are checked, then status/scan/head observations precede
a final complete protection recheck. It does not verify live active-world state,
import birth, full mutable-world lineage, or clear any recovery gate.

Historical protection deliberately does not compare immutable guards with live
worlds that may have since been used again. This must not be mistaken for
accepting arbitrary live mutations. Repeated execution still needs independent
active/inactive live-state checks, source validation and coordinator integration.

Five focused new tests initially passed (56 others filtered, not a full run).
Initial affected import/head run67 PASS,exit0,61.70s; retained report
`test-results/worlds-v2-history-protection-2026-10-26.json`.
Independent review found one P2: the last status callback could mutate protection
after the last recheck. The order was corrected and three aggregate gate tests
inject guard/before/approved corruption during that callback; all three reject,
preserve current properties, and never start/stop Minecraft. Both independent
reviewers closed P2, with current scoped P1/P2/P3=0. Final affected validation is
recorded in `test-results/worlds-v2-history-protection-final-2026-10-26.json`.

Test-only head publication around an already completed fixture is explicit
setup, not product adoption/recovery. No real Minecraft, OS-process crash,
browser, repeated-switch execution or full V2 PASS is claimed.

### Durable catalog head continuation

`WorldLibraryStore` now supports schema2 with an exact activation head. It
reuses the existing private file/identity reader, single-writer exclusion and
protected catalog publication; no new native writer or transaction framework.
Schema1 stays readable and is not rewritten during reads.

`reserveActivation` requires matching current/parameter/journal approval revision,
valid structural predecessor/history and physically bound catalog entries. It
publishes pending with the exact intent and preceding full-history digests before
any future caller applies a configuration switch. `completeActivation` requires
the same reserved intent, complete committed history and prefix, then publishes
the full-history digest. `auditActivationHead` detects truncated/modified history,
pending state and catalog-only rollback. Old history with no head is rejected,
not automatically adopted. Pending state blocks ready list/new installations.

These methods are NOT production-mounted. Physical guard checks, scan-issue
checks, correct commit order, cancellation and crash handling remain required
from the future repeated-activation coordinator. No method grants physical
recovery authority. Same-process store reconstruction is not an OS crash test.

Five affected suites:122 PASS,0FAIL,exit0,54.72s, report
`test-results/worlds-v2-durable-head-2026-10-26.json`. During independent review,
a P2 missing comparison of journal libraryRevision to the approved/current
revision was identified, fixed, and covered by a stale-intent rejection test
asserting unchanged bytes. Six head tests passed again after that fix; the
122-test report predates it. API typecheck/scoped lint/diff passed.
Independent source delta reviews have no remaining P1/P2/P3 after closure;
execution/recovery/final V2 Gates are not signed.

A jointly rolled-back catalog and journal, or deletion of all evidence, cannot
be disproved by this local head. Do not call it tamper-proof or an independent
anti-rollback anchor. No world, legacy backup or old journal was migrated.

Schema11 explicitly records `sourceGuard` (transaction ID, guard backup ID,
checksum) while both legacy import fields are null. Schema10 remains unchanged
for import sources. Dual/malformed sources, self references, first-transition
guards and reused new/source guards are rejected. Historical files are not
migrated or rewritten.

The source selector chooses the latest departure guard for a previously active
world, including the original world, and the unique import owner for a newly
imported inactive world. Chain validation binds guard provenance to the exact
preceding departure, name, directory and content checksums. This is evidence
selection/serialization only, not physical validation or execution permission.

Final focused source/history/journal/operation checks:55 PASS, exit0, report
`test-results/worlds-v2-source-final-2026-10-26.json`. Affected import/journal
integration78 PASS, exit0,57.24s, before the final guard cross-reference addition;
report `test-results/worlds-v2-source-provenance-2026-10-26.json`.
Independent source reviews P1/P2/P3=0. A P3 test masking the first-transition
guard branch was fixed by also clearing its predecessor, then retested.

Durable head, physical historical guard verification and repeated executor
remain unfinished. No activation UI/API enabled and no real Minecraft test.

## Implemented scope

`orderedActivationHistory` orders by explicit sequence, never timestamps. It
rejects missing first/middle records, forks, bad predecessor links, noncommitted
transitions, root/catalog drift, inconsistent permanent world/name/directory
bindings, and reused transaction/operation/guard IDs. Bindings include inactive
worlds and the original world when revisited.

The reconciler reuses its existing scan and still permits only a single first
transition after full physical checks. No activation writer/API/UI is mounted.
This is structural validation, not repeated activation delivery.

## Evidence

Initial focused history/journal tests: 29 PASS, exit 0. Initial importer/recovery
integration: 56 PASS, exit 0; retained report
`test-results/worlds-v2-history-integration-2026-10-26.json`.
Final tests after consolidating the check into the existing scan: 85 PASS across
3 files, 0 FAIL, exit 0, 58.03s. Report:
`test-results/worlds-v2-history-final-2026-10-26.json`.
API typecheck, scoped ESLint and diff checks passed. No full regression,
new browser acceptance or fresh OS-process crash run in this delta.

Independent Sol High and advanced source delta: P1/P2/P3=0, limited to these
structural checks and retention of first-only recovery. Not repeated-write or
complete V2 signoff. These tests use Fake Minecraft and isolated filesystems.

The prior six-process crash report belongs to the previous candidate: 16/17
listed source hashes still match; the reconciler changed and the new history
module is not listed. Preserve it as historical evidence, not a fresh crash run.

## Remaining boundary

A valid prefix cannot prove its final transition was not deleted. This helper
is not a durable head anchor and cannot clear recovery gates alone. Historical
guard payloads and live world evidence still require physical verification.
Complete deletion of local evidence cannot be disproved by the local ledger.

Next: versioned source evidence distinguishing an import birth from a legacy
world's prior activation guard; durable chain head; physical historical guard
validation with legitimate world saves; repeated execution/crash tests; bounded
startup verification; explicit confirmation API/UI. Do not repurpose the field
`sourceImportTransactionId` for an activation ID. Archive history stays blocked.

No Java starts, real world changes, Git publication or P7 work in this delta.
