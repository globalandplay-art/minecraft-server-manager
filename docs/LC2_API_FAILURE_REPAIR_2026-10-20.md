# LC2 API failure repair — BLOCKED

## Latest follow-up: prototype count root resolved (2026-10-20)

The LC1.1 full run found12 failed tests, including the prototype guard assertion expecting23 ACL queries/63 targets while actual completed queries were17/51. This is now a separately verified stale-observation assertion root, repaired in Attempt1. Production code, ACL decisions, helper/test deadlines and execution topology were not changed.

Proof: two file publications retain10 queries/26 targets; create verification retains2 queries/8 targets; reopen scans namespace plus the pair (3/9); explicit verification retains2/8. Total17/51. Three uses of the already-reviewed first-pair read merge each remove two repeated namespace/guard checks, totaling six fewer queries/twelve fewer targets. Each file remains inside before/after ACL checks.

Repair adds a bounded32-entry completion trace with fixed phase/role labels only. The parent now asserts the exact ordered phase/target sequence,17/51 totals, two sessions/two creates/two writes/two publications, exact bytes, equal receipt, zero commands and actual normal child close. This replaces an obsolete count with stronger coverage, not a relaxed minimum or generic success assertion. No paths, UUIDs, SIDs or ACL/file content are added to the trace.

Actual new verification (same test candidate, no overlap in selected cases):

| Selection | Result | Exit | Duration |
| --- | --- | --- | --- |
| guard roundtrip / scope / rotation / retention | 4PASS, other5NOT RUN | 0 | 94.48s |
| default active-parent death / idle ownership handoff | 2PASS, other7NOT RUN | 0 | 48.59s |

Filtered cases are reported by Vitest as skipped because of `-t`; no test was edited to skip. They are NOT RUN for those invocations. These are six distinct new passing cases, not full9-case/native-file or all-API PASS. Earlier successful normal/idle-parent evidence remains historical, not a fresh full-file result.

Independent SolHigh source review:P1/P2/P3=0; changed-file lint and diff check:exit0. Evidence: ignored `test-results/lc2-prototype-count-repair-0b9b4253-a1f7-44d7-b7e0-dded0e5fef5b/`.

Remaining roots unchanged: detached survivor launch has no validated execution/survival fix; ordinary native roundtrip and physical capacity retain their exhausted two-repair counters. No third blind repair, unchanged failing-root rerun, system repair, unknown-process cleanup, Minecraft or real network operation was performed. Full API baseline remains the historical2510PASS/12FAIL until a new valid full run; do not arithmetically subtract passing subsets from that result. LC1.1 final project Gate remains BLOCKED.

The user authorized repairing the eight historical API failures. They are three primary failures and five dependent stop results, not eight independent product defects. No full-suite PASS is claimed. Historical evidence remains unchanged under ignored `test-results/lc2-rcon-final-c75fdd6b-73c0-4b67-be9b-ca3c7c702059/`.

## Ordinary native guard — HARD BLOCKER, two attempts exhausted

Tests in `apps/api/test/whitelist-native.test.ts`:

1. publishes exact private guard bytes and verifies them after actual owner reacquisition.
2. retains guard checkpoint after owned process death; new process blocks recovery and never resends.
3. retains dispatch checkpoint after owned process death; new process blocks recovery and never resends.

Raw errors:

```text
Error: NATIVE_OBSERVATION_DEADLINE
test/whitelist-native.test.ts:104:73
Error: CLEANUP_BLOCKED
test/whitelist-native.test.ts:47:102
Error: PRIOR_NATIVE_FAILURE_STOP
test/whitelist-native.test.ts:37:27
```

The latter two death cases did not execute their acceptance bodies. Cleanup refused to kill/delete an unacknowledged fixture; this is not proof of an OS deletion failure. There is no explicit OS errno/HResult for this deadline.

Attempt1: replace only the shared Get-Acl descriptor extraction with File/Directory.GetAccessControl. Preserve raw owner/protected/DACL/CommonAce/SID/mask/flags validation, five-second helper timeout, output bound, every before/after call and fail-closed behavior. Independent inert directory/file observation found equal complete descriptors and cold Get-Acl1033.9ms versus .NET14.0ms; hot comparison1.36ms versus1.84ms. This demonstrates cold cmdlet overhead in that process, not all Windows startup cost. Real parity test also checks ordinary directory/file/new private file complete snapshots, actual private verify and wrong-owner rejection. ACL diagnostics/publication/parity30PASS. Historical16 extraction hashes remain unchanged; tests project ONLY the explicitly identified reader change before comparing all other historical bytes.

Attempt1 original native run: exit1, three failed tests. Guard creation now completes at44537ms, but the roundtrip still exceeds the unchanged50000ms deadline. This is improvement, not resolution. Exact observed NodePID3832 was subsequently absent; no claim that this proves every descendant closed.

Attempt2: `WhitelistGuardStore.#readFirstPair` brackets manifest.json and00.bin with a common four-target ACL-before/after check. Retains both handles through after-check, every file identity/metadata/link/path/byte/hash check, root/directory gate, strict first-chunk length and all other chunks. All opened handles are drained even on failure, buffers zeroed; only then accept fingerprints. Owned/wide transport remains unchanged. Two new negatives reject changed second-file ACL and replaced first chunk at the common after-check. Affected70PASS followed by updated synthetic26PASS; these overlapping results are not summed. Independent design/source reviewP1/P2/P3=0.

Attempt2 original native run: exit1, three failed tests/50.01seconds. Exact stages:

```text
owner-acquire 0ms
stores-open 3923ms
stores-opened 3933ms
guard-create 3933ms
guard-created 40320ms
owner-release 40321ms
NATIVE_OBSERVATION_DEADLINE
CLEANUP_BLOCKED
PRIOR_NATIVE_FAILURE_STOP
```

Last confirmed stage is now owner-release, not an ACL helper timeout. The precise await inside release remains UNKNOWN. Source: `ManagerLifetimeLock.release` awaits a separately compiled native Release payload using runWindowsNativeScript; do not infer which compilation/kernel action exhausted the remaining budget. Exact NodePID20660 was subsequently absent; original failed fixture was retained and no unknown process killed.

Full new raw log, JSON reporter and actual exit receipt: ignored `test-results/lc2-api-repair-2026-10-20/native-attempt2.log`, `native-attempt2.json`, `native-attempt2-result.json`. Attempt1 console evidence above is retained as an excerpt, not represented as a complete raw-log artifact. Stop this root after two real attempts; no third repair or unchanged rerun. Next needs a reviewed owner-release-specific timing/implementation decision under unchanged safety constraints.

## ACL retained-parent prototype — BLOCKED, fixes0

Historical three affected tests in `whitelist-acl-session-native.test.ts`:

- keeps a fresh Manager blocked during an owned active helper after parent death: expected retained-parent, received failed.
- confirms the default active helper exits before fresh Manager acquisition after parent death: PRIOR_NATIVE_FAILURE_STOP.
- retains exclusive root ownership in an idle helper after original owner release: PRIOR_NATIVE_FAILURE_STOP.

Historical diagnostic: stage=active-checkpoint, settled=true, marked=false, queryFault=closed, drained=true. This fails before the actual parent-kill/retention assertion, so it does not prove exclusion is broken.

New single inert launch diagnosis used the exact detached:true/windowsHide/pipe/EncodedCommand topology, with a fixed script whose first action writes an anonymous stage marker in its own temporary directory. Outcome:

```json
{"code":0,"signal":null,"output":0}
```

```text
NO_SCRIPT_MARKER
```

Exact child close was observed; its own inert temporary directory was removed afterwards. No ACL changes, real credentials, user worlds or unknown processes were involved. The script-delivery/launch boundary is implicated; exact Windows reason remains UNKNOWN. Do not replace detached survival injection with ordinary spawn or remove BUSY/survival/ACQUIRED assertions. No full prototype rerun or purported fix. A reviewed launch mechanism that actually executes and preserves the intended independent survivor is needed. This prototype is not silently selected for production.

## Physical capacity — BLOCKED, Attempt1 insufficient

Two affected tests in `whitelist-physical-capacity.test.ts`:

- validates10000 physical command evidence entries, admits the last pair, replays at capacity and refuses a new pair without publication.
- enforces the independent10000 root-entry ceiling even when command evidence is far below its cap.

```text
Error: PHYSICAL_CAPACITY_OBSERVATION_DEADLINE
test/whitelist-physical-capacity.test.ts:47:43
Error: PRIOR_PHYSICAL_CAPACITY_FAILURE_STOP
test/whitelist-physical-capacity.test.ts:38:34
```

Attempt1: two bounded independent read chains per CommandStore scan, preserving all checks and sorted output, allSettled drain before lease release/failure and no next batch after failure; four bounded independent fixture-preparation pairs, unchanged worker settings/deadlines/limits/assertions. New deterministic failure test proves lease retention, drain and no next batch. Independent source reviewP1/P2/P3=0.

Actual affected run:29PASS/2FAIL/exit1, physical file81.510seconds across three tests; maximum command case50026ms, then dependent stop. Ordinary physical guard case passed. Failed fixture `mcsm-physical-capacity-6yHM6b` retained; no successful maximum-history capacity claim. Exact exhausted stage within preparation/open/admit/replay is UNKNOWN, so no speculative Attempt2. Next minimal step is bounded stage timing for that exact case, not increasing concurrency or extending deadlines blindly.

## Validation and safety

Shared auth affected regression:23files/289PASS/exit0,444.08seconds. Includes actual native audit, Manager lifetime lock, descriptor parity, credential initialization/reset backup, before/after-publication interruption recovery, malformed/inherited/broad-Allow ACL refusal, HTTP and WS admission. Native credential writer7cases completed in443.584seconds, all within unchanged original per-test limits. Raw log and JSON: ignored `test-results/lc2-api-repair-2026-10-20/auth-affected.log` and `auth-affected.json`. These are synthetic private test credentials, not real administrator credentials.

Final changed-file lint, API typecheck, API build and git diff --check:PASS/exit0. Independent Sol High review of both descriptor and guard-pair/scan-drain candidates:P1=0/P2=0/P3=0; this accepts source, not failing native/capacity Gates. Candidate source hashes recorded in `candidate.json` are post-focused/static receipts, not a retroactive pre-run freeze.

Do not rerun the full API suite while these same known blockers remain: that would repeat stopped roots without a new repair and cannot establish a green final baseline. The original eight failures are NOT RESOLVED. No new whole-project count is inferred from the289 passing auth subset.

Production LC2 member writes remain unavailable by default. Phase7 remote PAUSED. No Minecraft startup, user-world access, real credential initialization, system permission/network changes, Git commit/push/PR or failed-evidence deletion. Candidate improvements are uncommitted; no claim that they make the original eight failures green.


## Capacity Attempt2 follow-up (2026-10-20)

The previous Attempt1/UNKNOWN statement above is historical. Bounded stage diagnostics identified cumulative scan cost. Attempt2 expanded independent fully validated scan chains2 to8, draining every in-flight chain before failure/release. Focused42PASS. Physical run1PASS/2FAIL/exit1: prepare2ms/open6540ms/admit19326ms/replay44310ms, original50s deadline exceeded; root-entry dependent stopped. Evidence `test-results/debt-closure-2026-10-20/capacity-attempt2.log` and `.json`. Root now STOPPED AFTER TWO REPAIRS; no Attempt3. Ordinary native root also remains stopped. Standalone owner acquire/release/reacquire/release passed4086/2069/3916/2056ms; this does not resolve the cumulative roundtrip. See TECHNICAL_DEBT.md for current status.

## 2026-10-20 reviewed native debt path update

Three direct gates now PASS without extending their deadlines: detached retained-parent survival 1 PASS (27.78s total); default scoped GuardStore roundtrip 1 PASS (39.75s test / 40.09s total); complete physical-capacity file 3 PASS (60.54s file total, original per-case limits unchanged). These supersede the corresponding unresolved direct checks, not historical failures or whole-project results.

Implementation: test-only detached Node bridge preserves the actual PowerShell PID/protocol and real survival/exit assertions; default GuardStore reuses the existing bounded ACL scope with quiescence before private publication; CommandStore read batches retain full physical namespace gates before and after drained batches plus every per-file identity/ACL/hash check. Independent scoped source review P1/P2/P3=0. Affected deterministic suite 67 PASS; API typecheck and changed-file lint PASS. Historical repair counters retained; new ordinary/capacity path is recorded as total historical repair 3, not a reset.

Affected crash validation remains BLOCKED: guard writer reached its durable checkpoint around 40s; a new reader reached stores-open at 6844ms, then the shared original 50s observation deadline expired. Raw error NATIVE_OBSERVATION_DEADLINE at apps/api/test/whitelist-native.test.ts:104. Cleanup refused deletion with CLEANUP_BLOCKED at line47 because the reader had not produced its terminal ownership/closure proof. Dispatch body was not executed (PRIOR_NATIVE_FAILURE_STOP); its reported failure is a dependent stop, not a distinct observed product fault. No claim that background helpers are all closed; fixture evidence retained. No further native run or destructive cleanup after this safety stop.

Evidence (ignored/local): test-results/lc2-debt-path-2026-10-20/{detached-survivor,native-scoped-roundtrip,capacity-batch-gate,native-scoped-crash}.log and corresponding result JSON. Original full regression 2510 PASS /12 FAIL remains historical; no new full-project PASS. Remaining work is cumulative crash/restart storage-path cost and safe reader closure evidence; exact internal bottleneck UNKNOWN. LC2 production and LC1.1 final Gate remain BLOCKED, remote PAUSED, real Minecraft NOT RUN; no commit/push/PR.

## 2026-10-20 continued closure attempt: canonical fixture fixed, dispatch still blocked

Preflight: original writer13680/reader14000 absent; process snapshot contained no PowerShell except this query process. No process was terminated and old fixtures were retained. CIM command-line inventory remains unavailable; no claim of global runtime health.

Added fixed test-only stages operations-ready/guard-opened/commands-opened/reconciled/replayed, preserving bounded IPC,50s total deadline, assertions and cleanup. Diagnostic guard selection failed in38.98s (not deadline): reader operation init4071ms, guard open6385ms, command open6388ms, reconcile8856ms, then NATIVE_PROBE_FAILED before replay. Source proves independent fixture fingerprint defect: writer serialized action,name,confirm,revision while coordinator normalizes action,name,revision,confirm. Same fields do not imply identical JSON fingerprints. Fixture now calls the formal parseWhitelistMemberIntent before both persistence and replay; no product fingerprint or conflict check changed. Canonical fixture repair Attempt1.

Fresh unchanged guard crash/restart selection PASS:1PASS/2filteredNOTRUN,41.82s test /42.21s total,exit0. Exact operation replay, interrupted/recovery_required, zero resend, evidence retention and actual normal reader close assertions all passed. Independent SolHigh delta P1/P2/P3=0. Source review is separate from real targeted evidence.

Previously unexecuted dispatch selection was then run:1FAIL/2filteredNOTRUN,50.01s test /50.36s total,exit1. Last substantive observed stage intent-publish28485ms. At32057ms native command directory create completed2421ms and ACL-many was active; fixed observation cap prevented finer late-step attribution. No dispatch checkpoint message or reader launch was observed. Error NATIVE_OBSERVATION_DEADLINE at whitelist-native.test.ts:104; secondary CLEANUP_BLOCKED at line47. This is before confirmed command dispatch boundary, not a proven recovery-reader failure. Current actual command mutation count not observable beyond checkpoint; never infer a command was sent. Fixture retained; no forced kill/delete or subsequent native retry.

Exact remaining pipeline: whitelist-native-probe.ts command.admit -> CommandStore.admit -> namespace/directory ACL -> #publish namespace/anchor/first record -> scan/readback, followed by append(dispatch-intent). The precise inner step at50s is UNKNOWN. The probe still injects legacy ObservedAcl/private-publication into CommandStore, while GuardStore uses reviewed default scoped composition. Do not silently substitute Fake or delete command evidence to pass. A safe command-storage optimization requires action-local bounded ACL ownership, drain of concurrent scan chains and quiescence before publication; existing single-query ACL scope cannot directly serve concurrent eight-chain scans. No such high-risk change made in this diagnostic/fixture repair slice.

API typecheck, changed two-file ESLint exit0. Full regression/build NOT RUN because affected native Gate fails. New root/fix counters preserved: canonical request fixture1successful repair; no dispatch-path substantive repair this slice. No whole-project/LC2 production/LC1.1 finalPASS. RemotePAUSED, realMinecraftNOTRUN, no commit/push/PR. Logs: test-results/lc2-debt-path-2026-10-20/guard-stage-observation.log,guard-canonical-request.log,dispatch-canonical-request.log. Historical failures retained.
