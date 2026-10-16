# LC2 native ACL session investigation — 2026-10-15

## Owner-retention implementation and active-fixture failure

New UNWIRED candidate adds `auth/windows-owner-retention.ts`, an exact-mutation-epoch owner wrapper, and a constructor-only session script transformation. It duplicates the original directory/share-zero lock handles into the helper, validates canonical descriptor/file identities and the original private ACL standard, and retains successful raw handles until OS process exit. No original Acquire/Release native code, shared authentication verifier, system ACL or network setting was changed. Default stores remain UNWIRED.

- Independent Sol High architecture/source review P1/P2/P3=0 after fixing the design's early-EOF-release P2 before implementation. Failed bootstrap may close only known local copies; successful retention never closes before OS exit.
- `lc2-retention-policy-add6e5ee-bf41-4c1e-bb5e-b7d1cdaaf950`:100 selected deterministic tests PASS/typecheck exit0; lint exit1 for test-only `_script` unused at whitelist-acl-session.test.ts:17. Type-only mock signature correction Attempt1, subsequent lint exit0 (`lc2-retention-policy-lint-after.log`). This first aggregate remains exit1, not rewritten.
- `lc2-retention-final-build-result.json`:lint/build/diff exit0 after current source and active harness preparation. Prior bundle warning retained. No new full regression.
- `lc2-native-owner-retention-d1e4c41a-a4b8-43cf-93bd-0610f9fb1900`:one selected normal-retention PASS/five unselected, exit0,30.57s suite/30.23s body. Three real batches match legacy ACL fingerprints, first query including compilation is strictly below5000ms, actual close precedes release, and owner is genuinely reacquired/released. Pre-run6-file manifest retained; four product files still match. Harness/probe were subsequently extended for a separate active checkpoint, not used to rewrite this result.
- LC2-ACTIVE-HARNESS-DEADLINE-001, MEDIUM/RESOLVED source P2, Attempt1: before native active run added pre-spawn and post-await absolute50s fences, first-IPC fence and shared-cleanup5s fence. Independent delta0; no timeout/cleanup budget extension.

### LC2-ACTIVE-FIXTURE-001 — HIGH/BLOCKED, exact exit ordering UNKNOWN

First active run `lc2-native-active-retention-e0d240bc-6b45-4467-84d2-12f0fd42ecf9` FAIL/exit1,one failed/six unselected,25.38s suite/25.07s body. At18773ms the isolated source Node38788 reported helper10768 with an active marker and pending request. After killing only that exact Node, fresh contender returned ACQUIRED; native.test.ts:97 expected BUSY:

```text
AssertionError: expected 'ACQUIRED' to be 'BUSY' // Object.is equality
Expected: "BUSY"
Received: "ACQUIRED"
```

No helper-liveness observation was made before the first contender acquisition; the unconditional BUSY expectation therefore cannot distinguish retained-orphan overlap from normal OS removal of the helper. Actual helper-exit ordering in this preserved run is UNKNOWN. The owned test hold was released in failure cleanup, both recorded PIDs were subsequently confirmed absent, all7 frozen fingerprints matched, and failed synthetic root `mcsm-acl-prototype-MA1jl7` was retained. A subsequent read-only process inventory found no project test/compiler helper. No unknown process was stopped and no original world/credentials were accessed.

Node22.23.1 reports libuv1.51.0. The [exact libuv1.51.0 Windows implementation](https://github.com/libuv/libuv/blob/v1.51.0/src/win/process.c) assigns ordinary spawned children to a private kill-on-parent-exit job, but permits continuing without that association on ERROR_ACCESS_DENIED. This directly establishes that an orphan is not guaranteed to survive normal Node death. It is a PROBABLE explanation for the historical assertion, not recovered proof of that helper's exact exit time. No product lock failure is established by ACQUIRED alone.

At the first active failure checkpoint, the next unexecuted proposal was to separate default-spawn parent-death evidence (helper absence BEFORE acquisition) from a fixture-only detached-child injection retaining the strict BUSY assertion. Subsequent reviewed execution and limitations are recorded immediately below. The original failure remains FAIL; its exact helper-exit ordering remains UNKNOWN.

### Subsequent matrix, inert diagnostics and separate positive evidence

Reviewed fixture correction Attempt1 changed only the orphan injection factory to detached:true, preserving fixed script/arguments, request5000ms,40s lifetime,12s deterministic hold and50s/5s/60s case bounds. Production spawn and Job/system settings were unchanged.

`lc2-native-parent-matrix-dc3528e2-d70b-427d-b9ae-15b3839d307f` exit1: the first actual case failed before an active checkpoint; second case did NOT launch (PRIOR_NATIVE_FAILURE_STOP), though the runner reports2 failed tests. At18927ms Node4288 sent phase=failed/code=NATIVE_PROBE_FAILED/reason=native/drained=true, no recorded protocol rejection. Primary assertion was `expected 'failed' to be 'retained-parent'`; harness additionally reported CLEANUP_BLOCKED. Failed synthetic root `mcsm-acl-prototype-a8CMWP` retained; Node4288 subsequently absent. Exact query fault/stage was discarded by that historical fixture and remains UNKNOWN.

Two independent fixture deficiencies were then fixed without rerunning the unsupported orphan branch:

- LC2-ACTIVE-DIAG-001, MEDIUM/RESOLVED source review, Attempt1: preserve fixed stage, AclSessionError.reason or literal unknown, bounded state booleans and pid-created only. No raw exception, streams, paths, ACLs or credentials.
- LC2-ACTIVE-ACK-001, MEDIUM/RESOLVED source review, Attempt1: a failed ACK with drained=true must still wait for actual Node close under the shared5s cleanup budget before accepting drain. Primary failure remains failure, failed fixture remains retained. The historical extra cleanup error is not deleted or rewritten.

Minimal inert observations, all actual closes confirmed, no ACL/filesystem target access:

| Prefix | Direct observation |
| --- | --- |
| lc2-detached-inert-b6206e5a-7027-4a9f-99e3-c79d4684541b | detached PowerShell exit0 launches/closes successfully,228ms; generic spawn capability exists |
| lc2-detached-inert-session-c0a58804-8ee0-4f62-a3eb-1862638a7a9a | fixed-sentinel session fails ACL_SESSION_UNSAFE/closed, actual close with failure, no protocol diagnostic |
| lc2-inert-detached-stdio-5d18ec87-7296-4144-bb7d-abb5710b0f09 | identical fixed pipe script: normal ready+echo/25stdout bytes; detached no ready/no echo/0bytes; both exit0/no stderr |
| lc2-inert-detached-exit-641f4d89-4b09-4162-9d77-aabd3ac11f5c | requested exit37: normal EncodedCommand returns37; detached EncodedCommand and Command both return0; no output |

LC2-DETACHED-PS-001 is MEDIUM/BLOCKED experimental fixture precondition. The expected detached WinPS command/pipe contract is not established on this host; deeper WinPS internal cause is UNKNOWN. Do not change product security, add breakaway fallback, rerun this unsupported branch or convert it to PASS. The corresponding failed test/requirement remains present; no final full-regression claim is made while it is unresolved.

Separately reviewed, fresh-root positive native runs:

| Prefix | Selection/result | What was established |
| --- | --- | --- |
| lc2-native-default-parent-f4034620-8e02-4afb-85b9-1ac8f7165b5e |1 PASS/7 unselected,exit0;25.23s suite/24.92s body | default active helper is confirmed absent AFTER exact parent death and BEFORE any new contender acquisition |
| lc2-native-idle-handoff-921ab14e-c642-4a67-b3fb-366773cc46ef |1 PASS/8 unselected,exit0;32.46s suite/32.14s body | real initial ACL query completes; raw fixture ends lease and successfully releases original owner; idle helper stays alive and fresh contender is BUSY; no further query; actual helper close then fresh ACQUIRED/released/closed |

Handoff is explicitly a test-only lifecycle fault outside the production scope controller. Product lease-before-actual-close rules remain unchanged. It proves local duplicate handles retain actual exclusivity after the originals are gone; it does not simulate a surviving active helper after parent death. Latest handoff frozen7/7 independently matched. Four product files match all five retention-run manifests; earlier probe/harness versions remain historical. Independent Sol High final source/evidence review found no new source P1/P2; one documentation P3 (stale unexecuted-proposal status) is corrected by this section. Active-orphan P2 remains OPEN, original default Native Gate BLOCKED, entire LC2 IN PROGRESS.

Current affected regression `lc2-retention-affected-2739a570-6951-4365-99db-17e33a1beb3c`:9 files/192 PASS,exit0. Includes retention policy/session/scope/rotation/inert transport/timing/member policy/command store/synthetic coordinator, not the unsupported native-orphan case or a whole-project check. Typecheck/lint/build/diff standalone exit0 on the unchanged four product candidates; no new browser/UI or full-project acceptance claimed. All old failure evidence and retained roots remain.

## Latest healthy-rotation checkpoint

Dedicated scope/transport now implement healthy rotation and explicit quiescence, still UNWIRED. Original default native guard/crash Gate remains BLOCKED. New focused prefix `lc2-rotation-final-cec0a7ef-0510-4017-8946-81951807fee4`:92 PASS in4 files (86 deterministic+6 actual inert Windows transport), lint/typecheck/build/diff exit0. Existing web chunk-size warning retained. This is not a new full regression and does not renew the historical1806 baseline.

New native prefix `lc2-native-healthy-rotation-b125dad5-bc1c-41b2-8f83-0d871615ba12`:1 selected PASS/4 unselected, exit0,33.94s suite. Frozen4/4 matched after execution.35 real ACL queries/68 target checks, count/age rotation, quiescence before native publication, legacy equivalence, actual close of every child and mutation lease retention were asserted. No unsafe fixture cleanup or unknown-process termination occurred.

New static findings, fixed before this native run:

- LC2-ROTATION-LATE-001, HIGH/RESOLVED candidate, review P2: a delayed timer could permit a reply after the40-second lifetime. Added monotonic reply/close checks; Attempt1, fixed-code `ACL_SESSION_UNSAFE`/timeout in negative tests. Deadline and permission standards unchanged.
- LC2-ROTATION-CREATION-001, HIGH/RESOLVED candidate, review P2: a nested factory could create a child then throw, leaving no assigned child reference. Creation uncertainty is now established before the factory; absent reference cannot authorize owner release. Attempt1, negative tests require `CLEANUP_BLOCKED`, retained lease and no retry.
- LC2-SCOPE-ROTATION-001 moves from DESIGN PENDING to UNWIRED CANDIDATE VERIFIED for healthy rotation only. Maximum physical history capacity is NOT RUN; static budget compatibility is not throughput evidence.
- LC2-SCOPE-ACTIVE-DEATH-001 remains HIGH/OPEN P2. Idle EOF is insufficient for an active query and fresh Manager. No default wiring until this boundary is proven.

Independent pre-native source/harness review P1/P2/P3=0. Post-run review independently matched4/4 frozen hashes, the1selected/4unselected/exit0 result,33.94s total duration (33.59s test body), and4-file92PASS final focused selection; no new finding in the three additional boundary tests. Separate active-parent architecture review is still in progress. One reviewer continuation earlier failed with the actual account message `You've hit your usage limit`; no signoff was invented. After the usage window reset, the real allowance tool reported primary used0% and the independent reviewer resumed successfully. This did not use a reset credit.

Post-run generic process inventory through CIM was denied (`HRESULT 0x80041003`); it does not establish a residual helper or a product failure. The selected native harness independently required its own actual child-close evidence before cleanup. A name-only Get-Process fallback observed only the invoking PowerShell; no process was terminated. No system permission repair was attempted.

All earlier sections below are historical checkpoints. They are not claims that rotation remains unimplemented in the latest candidate. No Git publication, real server/world/network action, or change to paused remote work occurred.

## Scope and current gate

LC2 member writes remain UNWIRED and overall IN PROGRESS. The prior synthetic integration baseline is 1806 PASS (Contracts17/API1619/Web170), frozen379/379, not final evidence for this new native candidate. The original native guard/process-recovery Gate is BLOCKED. Remote Phase7 remains PAUSED; LM1/LM2 have not started. No Minecraft, real RCON, user-world, network, system configuration or Git publication actions occurred.

The user removed the underlying-fix attempt limit on 2026-10-15. Attempts and original failures remain recorded; safety/verification gates and original deadlines are unchanged. Work began as test-only prototype research, then produced dedicated UNWIRED service candidates. It is not an authentication verifier replacement or a completed production performance fix.

## Original guard timing evidence

`test-results/lc2-native-timing-baaf7fff-2a17-461e-8454-e2c5c525d370*` preserves the bounded native failure. At48094ms, guard-create had run44396ms without completing. Completed top-level native categories total43056ms: create-directory5859ms, write-new11382ms, publish-new3770ms, ACL-many22045ms. Adding the ninth active ACL-many age1317ms gives44373ms of completed-plus-active category observation; this must not be called completed time. Write-new includes its nested ACL-one5551ms; these must not be added twice. Eight ACL-many calls completed around2735–2805ms each, ninth active1317ms. No completed ACL inspection rejected permissions.

CONFIRMED direct cause: cumulative serial native invocation cost exhausted the50s observation budget. The share attributable to PowerShell startup, actual ACL queries, compilation or close is UNKNOWN. Static first one-chunk guard path has20 helper calls (6 compiled publication,14 ACL inspection); this is not proof that all20 executed in the failed run. Prior50s work/5s cleanup/60s test,5000ms ACL helper and15000ms compiled publication limits remain unchanged.

## Prototype and historical failures

At the historical prototype checkpoint, `whitelist-acl-session.ts` was under test/fixtures only (later promotion is recorded below). It owns one lazy PowerShell child, real batched ACL queries, fresh snapshot validation, strict bounded frames,5000ms request deadline including startup,64KiB aggregate output cap,64-query/40s scope limits and separate5s close confirmation. Any stderr, malformed/unsolicited output, error or timeout poisons the session. Exact owned child termination is not a substitute for actual close evidence. Cleanup uncertainty is permanent and reported CLEANUP_BLOCKED.

The original prototype run `lc2-acl-prototype-cd0fc1cf-3f23-4e74-8960-b73a8a6f28d2` failed with ACL_SESSION_UNSAFE/protocol after19208ms. The following parent-death test was stopped, not passed. The failed synthetic fixture was retained. Earlier retained-fixture diagnostics `lc2-acl-protocol-35c23ea5-172a-48ee-ac39-d439a8c4dbdb` and `lc2-acl-protocol-metadata-f20f227f-9877-45f7-b4ee-72051e7d431f` failed at stderr and confirmed actual child close; their complete stderr semantics remain UNKNOWN. No raw stderr, paths, snapshots, SIDs or credentials were published.

### Transport fix Attempt1 — insufficient

Removed Console.InputEncoding/OutputEncoding setters and used explicit strict UTF8 StreamReader/Writer over standard pipes. This removes a console-codepage dependency; it does not prove the old stderr cause. Candidate SHA256 `12EE402B10C003DC6BDF92C39F4DC5443B0541BDA98292E53346985D39F1E197` received independent Sol High review0 findings.34 focused tests/lint/typecheck passed. One retained-fixture read-only query `lc2-acl-pipes-fix1-d1e0a576-efef-4b77-9d3a-a6ecf6702def` still failed: exit1, protocol/stderr, actual close CONFIRMED_WITH_FAILURE. Preserved unchanged.

### Independent parser defect and progress evidence

Inert transport probe `lc2-acl-inert-transport-359fb61c-7718-4007-9794-5efdf2d63bb5` replaced only the inspector with fixed sentinel output, with no filesystem/ACL access. Exit1, no reply; bounded stderr had CLIXML prefix, progress labels, complete closing element. This limited structural observation does not validate arbitrary stderr as harmless.

Stage-only inert probe `lc2-acl-inert-stage-b93ecc57-0f3e-46e4-a193-69726ae74b62` pinpointed types/runtime/target rejection. Harmless native parser inspection confirmed `@(... | ConvertFrom-Json)` nested the parsed array on this Windows PowerShell5.1: outer count1, first element array, not string, for both one and two targets. Direct assignment preserves an array of strings/count1 or2. This is a CONFIRMED prototype parser defect; it does not retroactively explain every historical stderr-only failure.

Fix Attempt1 for that parser defect removes the extra array wrapper and requires an actual array,1–8 items, each a bounded string. Script-local ProgressPreference=SilentlyContinue controls progress rendering only. ErrorActionPreference=Stop, warning behavior and any-stderr-poisons remain unchanged. [Microsoft preference documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables?view=powershell-5.1#progresspreference) defines the separate progress preference; no system preference was modified.

## Current validation

- `lc2-acl-parser-fix-d738fbe2-0ce5-4078-8d82-e44ef649088f`:35 focused PASS, including one actual Windows inert transport case.
- `lc2-acl-parser-boundaries-8b48c09b-7bf4-42e9-a6ba-99678f086a4c`:40 focused PASS, including6 actual Windows inert transport cases: one/two/eight target roundtrip, scalar/null/empty/nested/nine target rejection. Real parser, pipe and close; no filesystem/ACL access. Remaining34 are deterministic session/timing tests.
- lint/typecheck exit0. No new full regression or production build claimed at this checkpoint.
- Independent Sol High parser/transport source delta review P1/P2/P3=0. Session SHA256 `749885401DC0BA16828CF8963B55E8E6ECCEB23FC901685AE01765B9F91967CF`.
- `lc2-acl-parser-readonly-d7134b8a-b9d0-462f-afd4-caf387d1ab9e`: frozen3 files, one retained synthetic fixture real ACL query PASS/exit0; actual close CONFIRMED, no blocking protocol location. This establishes this read-only query only; no original guard Gate or member-write acceptance claim.

## Issue ledger

| ID | Severity/status | Evidence and next action |
| --- | --- | --- |
| LC2-NATIVE-CUMULATIVE-001 | HIGH/BLOCKED | Original guard cumulative invocation cost exceeds50s. Prototype reuse is not yet a product fix; original native guard and process-recovery Gate remain pending. No permission violation established. |
| LC2-ACL-PROTOCOL-001 | MEDIUM/UNKNOWN historical | Old stderr-only failures lack complete semantics; retained as failures. Do not rewrite them as resolved. |
| LC2-ACL-CONSOLE-001 | MEDIUM/Attempt1 insufficient | Explicit pipe stream change alone still failed readonly query, exit1/protocol. Retained for compatibility but no root-cause claim. |
| LC2-ACL-ARRAY-001 | MEDIUM/RESOLVED prototype | Native WindowsPS5.1 nesting proved, direct assignment plus strict array validation; six actual parser transport cases and readonly ACL query PASS. FixAttempt1. |
| LC2-ACL-PROGRESS-001 | LOW/controlled prototype | Inert stderr progress observed; only script-local progress display disabled. All stderr/WARN/error safety gates retained. Historical complete stderr semantics UNKNOWN. |
| LC2-ACL-CLEANUP-001 | HIGH/RESOLVED prototype review | Added stream error handlers and permanent close uncertainty with exact-child stop; tests preserve late-close failure. Idle parent-death proof later passed; active-query death/restart proof still pending. |
| LC2-SCOPE-GENERATION-001 | HIGH/RESOLVED candidate review | Static P2: old action could borrow the next scope; fixed distinct capabilities+async context and cleanup admission fence,4 new negative cases. No explicit runtime error code; Attempt1. |
| LC2-SCOPE-ROTATION-001 | HIGH/DESIGN PENDING | Current one-child candidate is not compatible with maximum-history scans. Explicit bounded rotation/quiescence/query-budget proposal saved, not implemented or accepted as capacity PASS. No explicit runtime error code. |
| LC2-SCOPE-ACTIVE-DEATH-001 | HIGH/DESIGN PENDING | Idle EOF does not prove in-flight death/new-owner safety. Native containment investigation remains prerequisite; no OS/job operation executed. No explicit runtime error code. |
| LC2-BENCH-COUNTS-001 | MEDIUM/RESOLVED static review | P2: expected22/62 omitted namespace ACL query; corrected23/63 before execution. Actual native benchmark PASS; no safety assertion removed. Attempt1; no runtime error code. |
| LC2-BENCH-OWNER-001 | LOW/RESOLVED static review | P3: acquire/release uncertainty could be mislabeled drained. Fixed before guard execution; failed ACK never permits fixture cleanup. Attempt1; no runtime error code. |
| LC2-SCOPE-TYPE-001 | LOW/RESOLVED | TS2375 at transport50:3; optional pid now admits Node's explicit undefined. Type-only fixAttempt1; strictness unchanged, typecheck/build PASS. |
| LC2-SCOPE-LINT-001 | LOW/RESOLVED | @typescript-eslint/no-this-alias at scope68:11; replaced with bound closures, rule retained. Attempt1; final lint PASS. |

## Next gated work

Fresh actual-session prototype `lc2-acl-prototype-parser-ef1242c8-63f7-4d4a-b29e-49034c6027f9`: normal/parent2 PASS, exit0, tests49.42s total; frozen3/3 independently reviewed. This validates three real batches with legacy fingerprint equivalence and actual normal close, plus exact idle helper disappearance after controlled parent death. It does not validate default product store recovery.

Fresh test-only guard benchmark `lc2-guard-session-benchmark-34b47737-26ea-44c9-a97c-d60685a4205c`: one selected PASS, two unrelated cases not selected, exit0, case38.23s, under unchanged50s work budget. Frozen4 files include the unchanged product guard store. All23 actual ACL queries/63 target checks,2 distinct owner-scoped sessions,2 directory creations/2 writes/2 publications, exact original bytes, matching receipt after owner reacquisition and actual helper close were asserted. Reuse changes helper process count, not inspection count. This is positive mechanism evidence, not default product Native Gate PASS.

Independent benchmark source review closed P2 omitted namespace query count (corrected22/62 to23/63 BEFORE execution) and P3 unknown owner-acquire/release drain reporting (uncertainty now retained across failed native calls), both Attempt1/no runtime failure from these findings. Final source delta P1/P2/P3=0. No explicit runtime error codes for these static findings. Historical original default guard failures remain BLOCKED.

These prototype gates are complete within their scope. Next independently review the dedicated scoped-verifier/lease design before any production integration. It must retain all queries/readback/identity checks, keep mutation ownership through actual close, fail closed on unknown helper state and avoid global caching/pooling. Existing unconditional release-finally store logic cannot be reused blindly for a live session. No default auth behavior change, route wiring or real server operation is authorized by prototype success.

All ignored `test-results` evidence and historical retained synthetic roots remain preserved. No commit/push/PR.

## Dedicated UNWIRED scope-controller candidate

The validated transport was moved into `apps/api/src/services/whitelist-acl-session.ts`; the old fixture reexports aliases. Independent review confirmed runtime source equivalence after normalizing import/class/comment and a type-only optional-pid correction. The default auth verifier, guard store, command store, routes and app do not import the new modules. The single-child controller in `whitelist-acl-scope.ts` deliberately does not implement long-scan rotation or claim capacity compatibility.

Private persistent SID validation is shared across distinct action facades. Each facade carries an immutable per-action token AND requires its originating async context. The acceptance window closes before cleanup. Old/cross-run/external/cleanup callbacks cannot dispatch queries or alter SID state. Rejected ACL checks permanently poison the scope even when action code catches the error. Actual child close is required before releasing the mutation lease; unknown factory/child/close outcome or an outstanding detached query retains the lease. Only healthy cleanup can preserve an original action error; uncertain cleanup returns fixed codes and primary-failure presence, never raw nested errors.

Validation chronology (historical intermediate results retained):

- `lc2-acl-scope-candidate-13c1fae5-ef4e-482d-bb75-ac393142a72f`:58 focused PASS/lint PASS; source typecheck then failed TS2375 at whitelist-acl-session.ts:50:3, optional pid incompatible with Node's number|undefined under exactOptionalPropertyTypes. Fixed type-only `pid?: number | undefined`; no tsconfig/strictness/runtime change. Subsequent typecheck/build PASS.
- Initial promotion equivalence/frozen6-file evidence `lc2-acl-scope-frozen-35f5bc7e-0c72-4346-8b6b-bd8132ba7e63` is BEFORE the type and scope-review fixes, not the final manifest.
- Source review P2: reused verifier reference lacked action generation and creator-snapshot admission. Fixed Attempt1 with private verifier, distinct per-action capability+AsyncLocalStorage and closed admission before cleanup; four negative tests. Final source delta0 findings.
- `lc2-acl-scope-binding-f930d05b-cf5b-4da1-970f-7129012e0c22`:62 focused PASS, then lint failed `@typescript-eslint/no-this-alias` at scope.ts:68:11. Replaced alias with bound closures, without disabling the rule. No typecheck/build from that failed command claimed.
- `lc2-acl-scope-final-focused-baa45821-23ef-4c13-9dae-977fbd5016b1`:64 focused PASS (58 deterministic+6 actual inert Windows transport cases); full lint/typecheck/build exit0. Existing543.14kB chunk warning retained. Two additional cases ensure caught query/creator ACL rejection cannot become action success. Independent source/native-smoke review P1/P2/P3=0.

No new full-project regression has been run for these dedicated candidates. The old1806 result is historical; no whole-LC2 or default Native Gate PASS is claimed. Long-scan rotation and active-query parent death/restart remain design P2 prerequisites before any store wiring. See LC2_SCOPED_ACL_IMPLEMENTATION_PLAN_2026-10-15.md for the explicit, unimplemented capacity/rotation proposal and remaining containment proof.

Final native scope smoke `lc2-native-acl-scope-edbe085f-824b-48ab-8640-59557899179c`:1 selected PASS/3 not selected,exit0,20.20s case. Actual original private publication/legacy comparison and new action capability worked together; owner release was rejected AUTH_BUSY during action and succeeded only after actual helper close. Frozen6/6 independently rehashed; source/evidence review current UNWIRED P1/P2/P3=0. No whole-LC2/full-regression/native-default signoff implied.

Affected store/policy/coordinator regression `lc2-scope-affected-5c86962c-621f-4955-a7d1-aa3c22179f5e`:78 PASS,exit0; git diff --check exit0. This is additional focused coverage, not a new full-project baseline. Latest native scope case kept50s work/5s shared cleanup/60s test. All successful fixture roots were removed only after own ACK and actual child close; historical failed roots remain retained.


## 2026-10-15 inert normal-broker feasibility checkpoint

Diagnostic-only source: apps/api/test/fixtures/whitelist-bridge-inert-probe.mjs and apps/api/test/whitelist-bridge-inert.test.ts. No ACL, credentials, filesystem targets or network in either PowerShell process. The inner fixed script sleeps250ms then exits37. No detached flag, relay, parent kill, product integration or Job-setting change.

Pure focused10PASS/exit0 (initial log lc2-inert-bridge-focused-d0d94d98-a7a0-494c-b74d-939a4d81db0e.log); after source-review corrections10PASS/exit0 again, lint0, syntax0. Pre-run independent SolHigh found P2 cleanup deadline began after kill and P3 uncaught evidence-save exception could print raw details. Both fixed before native execution: shared cleanup5s now starts before first cleanup action, top-level unexpected failures emit a fixed code only. Delta review P1/P2/P3=0 authorized ONE inert run. Neither was a product ACL failure; substantive correction Attempt1 for each.

Fresh single native run lc2-inert-bridge-5385d3ba-d063-40ae-903f-a2d8ef8a2add: PASS/native exit0, elapsed2603ms within original outer5000ms, brokerActualClose=true/exitCode0/exitSignalnull, targetPid38852/targetCloseProven=true, stdout81bytes, killRequested=false. Exact .NET Process handle WaitForExit and both silent stream EOFs establish target exit37 before its fixed closed receipt. Lost receipts remain CLEANUP_BLOCKED; broker close alone never proves target closure. Frozen two-file manifest lc2-inert-bridge-frozen.json matched2/2 after run. Subsequent readonly process inventory found neither targetPID38852 nor matching project test/helper processes. No fixture directory was created or deleted by this inert probe.

This proves only normal Node?PowerShell broker?ProcessStartInfo PowerShell fixed startup/exit/close feasibility. It does NOT prove Job inheritance, a surviving helper after parent death, retained-lock behavior during an active orphan, real ACL relay, or maximum-history compatibility. Historical detached FAIL results remain unchanged. No new whole-project regression or LC2 feature PASS is claimed; latest affected baseline remains9files192PASS, prior lint/typecheck/build/diff0 for the owner-retention candidate.

Next bounded design step: independently design an exact-owned broker/target identity and bounded IPC relay before any active-orphan experiment. It must establish lifetime/Job behavior without assuming normal grandchildren escape Node termination; retain exact owner handle duplicates until OS exit; enforce original5000ms query deadline including all startup; avoid metadata-PID killing, raw output, false drain and uncontrolled breakaway. If surviving active orphan cannot be created safely on this host, keep that native Gate OPEN and state platform limitation. Then prove maximum physical history capacity and integrate scope into stores only after corresponding review/validation. Default native guard/crash Gate BLOCKED; member writes UNWIRED; LC2 IN PROGRESS; remote PAUSED. No Minecraft, realRCON, user-world, system/network or Git publication action.

Actual allowance checkpoint: primary used96%/remaining4%, ordinaryUsageAllowed=true. This is not an exhaustion claim. Save evidence and do not begin a larger unsafe transaction before safe handoff.

Final independent SolHigh inert source/evidence/document review completed: P1/P2/P3=0; frozen2/2 independently matched. Product retention manifest rechecked12/12 unchanged. Active-orphan P2 OPEN/default native Gate BLOCKED/member writes UNWIRED; no feature PASS or whole-project regression claim. Git branch codex/phase-4-players-properties, HEAD ba28a6a44ebac5efee8bbe75b96ddcfc86aa2789,93 working-tree entries; tracked runtime/.manager/test-results files0. No commit/push/PR.
