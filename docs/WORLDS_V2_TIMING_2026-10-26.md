# Worlds V2 timing and reviewer routing continuation

## User-approved reviewer routing

On2026-10-26 the user disabled Astra for subsequent LT acceptance and selected
GPT-6.1 Sol instead. AGENTS.md and CODEX_MODEL_ROUTING.md now explicitly require
independent GPT-6.1 Sol High for applicable advanced/recovery/final Gates. This
does not rewrite historical attribution, alter tests, or change account settings.
No Astra reviewer was invoked in this continuation.

## Bounded observations

Test-only diagnostic opt-in `LT_WORLD_ACTIVATION_TIMING=1` wraps bound methods,
forwards the exact arguments/results/errors and records at most512 fixed-label
events using Node performance.now. No paths, names, passwords, command output or
world bytes enter timing events. No production environment switch is introduced.
Test assertions,5000ms limit and maxWorkers2 remain unchanged. Diagnostics are
off in ordinary regression. Times are inclusive and nested; do not sum rows as
independent elapsed work. Events from one worker are not cross-process timing.

Initial diagnostic test4014ms PASS,1selected/75filtered, exit0; report
`test-results/worlds-v2-roundtrip-timing-2026-10-26.json`. Full initial console
events were not retained by the JSON reporter; the tool transcript was bounded.
Do not claim complete baseline phase data from that reporter.

The later diagnostic log explicitly preserves all events:
`test-results/worlds-v2-roundtrip-after-2026-10-26.log`.
Report `test-results/worlds-v2-roundtrip-after-2026-10-26.json`:2PASS/75filtered,
exit0; roundtrip3956ms.161 events below the512 cap:

| Fixed label | Calls | Inclusive total ms |
| --- | ---: | ---: |
| fixture |1|445.85|
| plan |3|559.18|
| admission |3|643.74|
| operation-wait |3|2186.24|
| history-protection |13|681.93|
| target-proof |12|787.12|
| journal-scan |78|93.98|
| guard-manifest |42|101.60|
| head-reserve |3|72.32|
| head-complete |3|56.34|

No single stalled helper was observed. Operation waiting includes actual async
execution and polling; it is not proof of lock contention or exclusive filesystem
time. Historical5042ms failure remains unresolved by observation alone. Variance
and cumulative repeated verification remain relevant; no claim of fixed historical
environment/root cause or guaranteed performance from one targeted run.

## Narrow source change

The second source check in a single inspectUnderLease call may deliver backend
history evidence through a synchronous observer only after all final plan guards.
The public plan DTO is unchanged. The executor checks the exact freshly scanned
ordered history, scoped unfinished transactions, current head and rechecks old
journals/protection before using this evidence. No cross-call/request cache is
introduced. If evidence is unavailable/different, full verification is retained.
Both source checks and all final physical/publication checks remain in place.

Independent Sol High identified that the fresh fast-path scan must also reject
non-activation scoped active/recovery-required records, as the original full pass
did. That check and two scheduling-window negative tests were added; both PASS,
exit0 (`test-results/worlds-v2-fresh-transaction-2026-10-26.json`). Another test
changes guard data after source verification and confirms no new activation
intent, no catalog changes and no Java start/stop. Public plan excludes proof.

Independent GPT-6.1 Sol High `/root/worlds_v2_sol_acceptance` source delta:
P1=0,P2=0,P3=0. No tests or mutations by the reviewer. This is not acceptance of
full regression, timing, startup recovery, API/UI, real Minecraft or final V2.

## Final validation boundary

Affected regression report:
`test-results/worlds-v2-sol-timing-final-2026-10-26.json`.
Actual result:100PASS/0FAIL/0filtered across3files,exit0,89.03s; three-transition
test4720ms below unchanged5000ms. API typecheck/build/scoped lint/diff PASS.
Independent GPT-6.1 Sol High read the actual final and retained baseline JSON,
verified100/0/0 across3files,4720.336ms roundtrip and the three new negative cases,
and checked161 bounded timing events/config maxWorkers2. Scoped source+timing
checkpoint P1/P2/P3=0; evidence VALID. Static checks/process exit are writer-run
evidence, not inferred from test JSON. Reviewer ran no tests/edits/Git/Astra.
This accepts the current affected-module timing checkpoint, not every possible
environment load, historical root cause, or the still unfinished recovery Gates.
Its actual result must supersede targeted results for this module checkpoint;
the old94PASS/1FAIL report is retained, never overwritten. No full repository
regression, browser, Java, OS crash, repeated startup recovery or production
activation route is claimed. P7 stays STOPPED; no Git publication.
