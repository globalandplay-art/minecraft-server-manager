# LC2 capacity investigation ? 2026-10-16

## Scope and current result

Budget/counting compatibility PASS; factored physical guard boundary PASS; preserved command cold-open PASS. Whole physical command workflow BLOCKED. The independent root-entry case was NOT RUN in the original failed suite, then passed as a separately selected independent case below. Maximum combined1000?64-file/one-million-member retained snapshot resource performance NOT RUN. This is not native ACL throughput, default store integration or LC2 PASS.

## Budget evidence

`lc2-acl-capacity-budget-ee5b6197-2612-43a7-bcf0-65b3dd0074d5`:2PASS/exit0,5.59s test body/5.97s suite. Real WhitelistAclScope and snapshot validation with constructor FakeSession; fixed logical clock isolates accounting while independent real-wall50s fences remain.130456 three-target queries fit healthy rotation. Worst-case one healthy child per query/quiesce fits260912 units;262144 units admit exactly131072 queries+children, next request rejected before an extra start/dispatch. No security query was removed and no retention ceiling was reduced.

Review P3 before execution: actual clock could trigger legitimate age rotation and contaminate exact counting; fixed logical clock as planned. No runtime failure from this finding. Counting is not physical capacity or real-time deadline evidence.

## Physical run and retained failure

`lc2-physical-capacity-4b53dc91-d598-402b-b40e-7297ca50cd23`:exit1/frozen7/7; reporter1PASS/2FAIL,98.23s suite. Actual workload comprises one passed guard case, one failed command case, one unexecuted case rejected by stop gate.

- Guard:999 small REAL guard directories then real store.create of the1000th guard with1000 valid synthetic members/padding256KiB/64 chunks. Full1000 scan validated snapshots.1001st create rejected exactly WHITELIST_GUARD_CAPACITY, publication count unchanged, directory set and final chunk retained. Exact passed-case duration was not separately printed; no invented duration is reported. Successful fixture cleaned only after action settled.
- Command:4999 valid genesis records+4999 anchors were directly constructed, then store.open/admit/replay/capacity scenario began.50.018s original observation deadline reached. Fixed error PHYSICAL_CAPACITY_OBSERVATION_DEADLINE. Failed root mcsm-physical-capacity-ikoP6r retained. Read-only follow-up counted4999 records/4999 anchors/root5001/stages0; final pair had not published. Historical exact timeout step (open versus later pre-admission scan) remains UNKNOWN.
- Independent root-limit case: PRIOR_PHYSICAL_CAPACITY_FAILURE_STOP at entry. NOT RUN, not a second underlying capacity failure.

Raw errors:

~~~text
Error: PHYSICAL_CAPACITY_OBSERVATION_DEADLINE
  test/whitelist-physical-capacity.test.ts:47:43
Error: PRIOR_PHYSICAL_CAPACITY_FAILURE_STOP
  test/whitelist-physical-capacity.test.ts:38:34
~~~

No errno/HResult/HTTP code was provided; test-run exit1. No product performance fix has been attempted for this cause. No timeout/assertion change, retry until green, fixture deletion or ignored safety error.

## Single preserved-root read-only observation

`lc2-preserved-command-open-96535cef-f1c3-420e-9e30-46b0c9835a3e`:PASS/exit0/frozen3/3; fresh store/cold known-file map over the exact retained4999+4999 root; real filesystem/store checks with FakeACL. Actual open25.643s; total25.742s.19999 ACL verification calls/29997 targets exactly expected; publication0; actual action settled; deadlineExceeded=false; directory identities/mtime/names unchanged; original root preserved.

Category observations (same Node monotonic clock, first/last observation intervals NOT exclusive component CPU durations):

| Query class | Queries | Targets | First/last ms |
| --- | ---: | ---: | --- |
| namespace-file | 2 | 2 |102/104|
| directory-only |1|1|106/106|
| anchor-file |9998|9998|120/25718|
| record-file |9998|19996|124/25720|

A current cold-open fits50s. Multiple full scans plus fixture construction are a PROBABLE explanation for the previous grouped workload deadline; this observation cannot reconstruct the old execution timeline or mark the old FAIL resolved. Do not classify it as ACL permission failure or proven data corruption. Further profiling/design review is needed before a product optimization or a revised acceptance structure; no automatic timeout increase.

## Independent root-entry boundary

`lc2-physical-root-limit-3f7b9182-12a6-4b91-98d7-f9d288790b51`:1 selected PASS/2 unselected, exit0,9.53s body/10.24s suite; source fingerprint unchanged. Real root has10000 entries while combined record/anchor evidence is only2. Admission rejects additional root growth before publication. This independent case was selected after read-only review; guard/command workloads were not rerun. Its earlier NOT RUN stop-gate history remains intact. It does not pass the combined command-capacity workflow.

## Review corrections and safety

- Physical pre-run P2: whole action initially only had post-call fences. Added one absolute50s race plus real settled tracking, FakeACL/publication pre-mutation fences, and shared5s cleanup waiting. Failure stops later loads and retains roots. Attempt1, source delta0 before execution.
- Read-only diagnostic pre-run P2: metadata verification could outlive cleanup and still report PASS. Entire verification now shares the existing remaining5s deadline, with post-fence and late-result CLEANUP_BLOCKED. Attempt1, pre-run delta0.
- No real owner/credentials/world/server/RCON/network or system permissions were modified. Fake ownership/ACL are explicitly test-only; no reentrant owner substitute is used to claim scope integration. Private logs/results stay Git ignored.

## Open work

HIGH: original default native guard/crash Gate BLOCKED (cumulative helper cost), member writes UNWIRED. Native publication helpers do not currently retain owner handles; this separate writer-lifetime P2 must be closed before scoped integration. MEDIUM: grouped physical command-capacity deadline, actual failing stage UNKNOWN, product fixes0. Full combined resource capacity NOT RUN. Independent root-entry boundary now PASS only in its stated FakeACL scope. Limited native owner-retention exclusion P2 is closed by its separate reviewed sibling test, not by this capacity work.

Next decision: review exact per-action capacity budgets and command scan evidence, preserve all historical errors, then choose a minimal validated implementation/acceptance correction without weakening validation or increasing deadlines. Before native scoped-store integration, inspect publication-helper lifetime and whole-action ownership alongside ACL child ownership; no integration or Phase expansion follows from counting PASS alone.
