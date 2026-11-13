# Worlds V2 live history observation — IN PROGRESS

`WorldActivationLiveHistory` is an unmounted read-only candidate. It verifies
the durable history head and all historical protection, existing persisted active
slot and current properties selection, catalog and imported installation bindings,
retained original uploads/version profile, every present live world, then late
source/journal/head/config/tree/protection checks. It never initializes missing
state, repairs/adopts files, sends commands, clears operation recovery, or replays.

Active-world saves are allowed only within the supported layout/profile and stable
identity. Inactive worlds must match the latest departure guard contents or their
original imported contents if never used. Original-world identity is the existing
catalog entry, not a new name-derived assignment. Unsupported archive history,
partial transactions, missing slots and ambiguous evidence remain blocked.

## Focused tests

`test-results/worlds-v2-live-history-focused-2026-10-26.json`:7PASS/79filtered,
exit0. Tests use isolated real filesystem and Fake Minecraft. Cases: intact
reconstruction with active save; changed inactive contents; missing active slot;
late guard corruption; changed import-root binding; late original-upload change;
new unfinished transaction appearing after the protection pass. No repair or
current-config/catalog mutation is allowed.

Independent review initially identified three P2 source gaps: root binding,
fresh unfinished transaction scan, and late upload validation. All were patched
with direct negative cases. Final independent disposition is recorded separately
after review; writer tests alone cannot close its Gate.

Final independent GPT-6.1 Sol High source/evidence review: P1=0/P2=0/P3=0;
three P2s closed;7focused cases and4actual process boundaries verified from
reports;22/22 recorded source hashes match current candidates. Multi-transition
observer coverage P3 closed within this observation scope. Reviewer ran no
tests/edits/Git/Astra and did not accept production/recovery/API/UI/Java Gates.

## Actual process boundaries

The existing owned-process harness now supports `--repeated`, reusing its30s
deadline and38s bounded close confirmation, owner nonce/UUID fixture, fixed Node
executable, argument array, shell=false and only exact ChildProcess termination.
No unknown process or Java was touched and no fixture was force-deleted.

`node tests/acceptance/worlds-v2-import-process-crash.mjs --repeated`
exit0,4boundaries PASS. Three completed or in-flight transitions per fresh fixture:
original -> imported -> original -> imported, with normal saved files preserved.
Report:
`test-results/worlds-v2-repeated-crash-590ae162-c059-4d49-bbe3-a23b4a4f66ed/result.json`.

| Third-transition boundary | Fresh-process physical observation | Operation recovery |
| --- | --- | --- |
| activation-head-reserved | rejected | gated |
| activation-commit-persisted | rejected | gated |
| activation-head-completed | verified | still gated |
| activation-after-commit + subsequent active save | verified | still gated |

The probe starts in a separate OS process, before ActiveWorldState initialization;
source hashes, process IDs, close states and untouched server digest are recorded.
Each fixture contains4transactions,0Java starts, childrenClosed=true. This is
physical observation with persistent gates, not completed Manager startup/importer
proof consumption or recovered successful operations. No production hook/API/UI
is mounted. Original import and first-only activation harness modes remain intact.

## Remaining

Final affected regression:93PASS/0FAIL across2files,exit0,93.30s; existing
three-hop test4151ms under unchanged5000ms. Report
`test-results/worlds-v2-live-history-final-2026-10-26.json`. API typecheck/build,
scoped ESLint and diff check passed. No full repository regression claimed.

Exact importer supersession and final synchronous confirmation must account for
all historical transitions and imports without clearing unrelated recovery causes.
Then validate full startup ordering/cancellation, multiple imported worlds,
explicit uncertain-operation handling, API/UI and real Minecraft loading. V2
remains IN PROGRESS; no browser/real Java/full repository PASS, Git upload or P7.
