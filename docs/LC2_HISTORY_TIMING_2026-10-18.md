# LC2 history read-only timing observation — 2026-10-18

Baseline capacity remains BLOCKED: original run
`lc2-history-open-bca9b9d1-70ac-40d1-984d-e07e548e63b3`,50009.0221ms,
WHITELIST_GUARD_UNSAFE/real envelope deadline/actual foreground exit1.
Its SHA256 remains
`7b1c5e3b3854c47ff60a814d8d05c0480e72b340c4dcc35d1388ddfed1c5d1ea`.

## Controlled observation

Run `lc2-history-timing-e2819fa8-0726-429a-974c-4a1da6c4c3a4` reuses that exact
preserved synthetic root. No Guard creation/content write/deletion. It pins
the baseline report,40 previous source files,2000 file identities/content and
the existing lifetime-lock file before/after ownership. All original real
query arguments, absolute deadlines, getter values, promises and errors are
delegated unchanged. The only injected constructor factory constructs the
same real WhitelistAclSession(undefined,now,wrapper).

Observers attach safe bounded metadata reactions, return original promises,
deduplicate close-promise observations and store at most256 anonymous rows.
No target paths, snapshots, raw stdout/stderr, proof or exception text is
recorded. Constructor count is not an OS-spawn counter. Clock failure or
overflow marks incomplete diagnostics rather than changing product results.

Original50s action/shared5s drain remain. Setup30s/admin110s; source checking
uses ONE shared5s deadline bounded by adminEnd. Evidence has its own5s bound.
Unknown drain/ownership retains the known Node and existing fixture.

## Validation

- Observer8 focused tests PASS/334ms: promise/error/getter identity, exact
 arguments, shared-close rejection/deduplication, sensitive-value exclusion,
 bounded records, bad/backward clock and pending settlement.
- Syntax/lint/typecheck/diff0. No product changes after prior626 affected
 regression and applicable4.76s build. This is not a new full-project baseline.
- Frozen43-source candidate v2 independently matches43/43 before execution.
- Independent source/pre-run SolHigh P1/P2/P3=0 after correcting a P3
 per-file source-deadline reset to a shared bound. Previous source-only
 candidate/frozen-v1 preserved; no diagnostic execution before that correction.

## Observed outcome

Actual direct foreground exit1/60871ms, exclusive external receipt
`lc2-history-timing-external-8e6e1a1c-3aa5-44a8-b9e2-7c2a99561a80.json`.
Open50017.6405ms/WHITELIST_GUARD_UNSAFE. This observed run's exact envelope
primary is **cancelled**, not the baseline's deadline; do not rewrite it.
The original absolute work budget remained50000ms and no later work was
admitted. Diagnostic report `lc2-history-timing-e2819fa8-0726-429a-974c-4a1da6c4c3a4.json`.

| Node-observed metric | Actual |
| --- | --- |
| Constructor attempts with recorded sessions |31 |
| Query calls / total targets |961 /2400 |
| First-query elapsed sum |43285.6721ms |
| Subsequent-query elapsed sum |2694.0943ms |
| Close elapsed sum |640.0472ms |
| Rejected query calls |1 |
| Actually closed sessions / pending queries |31 /0 |
| Observation incomplete |false |

First30 sessions each completed32 queries. Last session attempted one query,
rejected after1222.1767ms, and had one rejected close promise while actual
closed=true. A cleanup rejection is not an orphan: actual closure and owner
release were separately confirmed. Captured action released/bodySettled=true,
resource0/activity and mutation released; activeSteps0,owner released,
lock identity preserved, all1000 histories/2000 files unchanged,
source43 unchanged, fixture retained. No server/world/credential/network work.

## Interpretation and limits

CONFIRMED: the repeated first-query boundary dominates this observed read
(43.29s versus2.69s for subsequent queries). It includes lazy process launch,
native-owner retention, Add-Type, first ACL query/provider initialization and
IPC. This is not pure PowerShell-startup or pure compilation measurement.
Queries include observation overhead. Failure drain close can overlap the
last rejected query, so these sums are not an exclusive CPU-time partition.
Remaining wall time includes Node metadata/I/O, parsing, hashing, controller
and scheduling overhead; it is not a measured Node-I/O cost.

No native performance fix has been implemented for the history deadline.
Increasing time/frame/target/rotation limits, caching ACLs, skipping physical
verification or splitting/resetting the original operation is not justified.
Maximum64-history layouts, one-million retained member objects and combined
Guard/CommandStore admission remain separate unpassed Gates.

## Next repair direction

Evaluate a fixed precompiled owner-retaining ACL executable while preserving
the existing full checks and finite lifecycle. Compiler presence alone is not
trust, artifact readiness or performance proof. Its artifact publication,
process image identity, private ACLs, TOCTOU protection, opaque owner epoch
bootstrap and protocol equivalence require independent design review before
implementation or execution. Current transport/default Store/API remain
unchanged and member writes UNWIRED. Remote PAUSED. No commit/push/PR.

Independent final timing-evidence review P1/P2/P3=0 confirms43/43 source
hashes, actual exit1/60871ms, all measured aggregates, cancelled primary,
released owner/action and preserved fixture/lock identities. This closes
the diagnostic evidence Gate only. The capacity failure remains BLOCKED.
Concrete follow-up candidate:
[compiled helper design](./LC2_COMPILED_ACL_HELPER_PLAN_2026-10-18.md).

## Issue ledger for this observation

| Issue | Status | Evidence / remaining work |
| --- | --- | --- |
| LC2-HISTORY-NATIVE-001 | HIGH / BLOCKED | Baseline50009ms/deadline; observed50017ms/cancelled; actualexit1 both. Fixed precompiled transport design only, no native performance repair. |
| LC2-HISTORY-FIRST-CALL-001 | MEDIUM / diagnosed | Repeated first-query bundle dominant43.29s. Internal startup/compile/owner/first-ACL/IPC breakdown UNKNOWN. Do not assert pure startup or compilation cause. |
| LC2-HISTORY-TIMING-BUDGET-001 | LOW / resolved | Source review found per-file5s resets; fixed shared sourceEnd before execution. No runtime error code;8tests/static/review0. |
| LC2-HISTORY-ARTIFACT-001 | HIGH / design condition | Executable hash-then-path-spawn is unsafe. Native artifact/ancestor pins, opaque bootstrap, uncertain acquisition/drain, dependency/provenance policy must be resolved before building/running the candidate. No runtime error code. |

All earlier history/setup/unit/exit/BOM failures remain in
[history validation](./LC2_HISTORY_OPEN_VALIDATION_2026-10-18.md). No previous
report, log or retained fixture was rewritten. No full-project regression,
new helper binary or production write Gate is claimed.
