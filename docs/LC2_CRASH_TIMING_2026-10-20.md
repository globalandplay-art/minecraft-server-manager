# LC2 crash/restart cumulative timing investigation — 2026-10-20

Scope: read-only source/log analysis after the native-scoped-crash safety stop. No new test, process termination, fixture deletion, timeout change or product modification.

## Confirmed observations

- Writer owner-acquire marker 0ms; stores-open 4758ms; stores-opened 4774ms; guard-create 4802ms.
- Writer timing observation still present at 40066ms. Durable guard checkpoint subsequently received; its exact receipt timestamp was not recorded. Thus checkpoint latency is greater than 40.066s, not an exact 40s measurement.
- Reader launched only after original writer kill and close. Reader owner-acquire 0ms; stores-open 6844ms. No stores-opened/restart-reconcile marker was observed before the shared 50s deadline.
- Both processes share the single deadline created at whitelist-native.test.ts:119. It is not a fresh 50s deadline per process. Writer elapsed and reader elapsed use different process origins; their values must not be added as exact wall-clock timing.
- Last observable reader region: OperationService.initialize, GuardStore.open/scan, CommandStore.open/scan, between stores-open and stores-opened in fixtures/whitelist-native-probe.ts. Evidence does not distinguish those calls. It does not prove initialize/recover/resubmit executed.
- Error NATIVE_OBSERVATION_DEADLINE at whitelist-native.test.ts:104. Fixture refuses directory deletion at line47 unless reader terminal proof exists. CLEANUP_BLOCKED is an intentional safety refusal, not evidence of ENOTEMPTY or proof a helper remained alive.
- Dispatch case stopped before its body with PRIOR_NATIVE_FAILURE_STOP. No independent dispatch failure observed.

## Source-supported cost map

Default GuardStore scope batches read-only ACL queries within each action. Guard creation still separately creates namespace and operation directories, writes and publishes chunk/manifest, verifies stage/target bytes and returns verified receipt. Each publication boundary quiesces the readonly child; original private-publication primitives still launch separate trusted native scripts. A one-chunk first guard needs at least six native mutation scripts (two directories, two stage creations, two no-replace publications), plus scope lifecycle/read validation. These are necessary checks in the present design, not disposable duplicate assertions.

Reader open performs full existing guard scan; SyntheticWhitelistCoordinator.initialize subsequently scans commands and guards again, while later replay/recover/explicit verification can read additional evidence. CommandStore empty scan in guard mode does not create command namespace or write a command. Therefore blaming dispatch command publication for this specific guard-mode timeout is unsupported.

## Conclusions

CONFIRMED: cumulative shared deadline exhausted before reader finishes opening stores; most observed budget had already been spent reaching the writer checkpoint. Recovery algorithm failure, deadlock, ACL insecurity and command resend are NOT established.
PROBABLE: repeated native publication startup plus bounded ACL scope startup/quiescence cost materially contributes to checkpoint latency. Per-primitive timings are not available on this default scoped path, so no exact attribution or Windows-wide performance diagnosis is justified.
UNKNOWN: reader internal slow call, exact checkpoint receipt time, helper/reader eventual exit, and whether a safe optimization suffices under50s.

## Minimal next action

First recover identity-bound closure evidence for the prior owned reader; do not infer closure from PID reuse or terminate unknown processes. Keep the fixture preserved when proof is unavailable. Then add bounded anonymous test-only timestamps around operations initialize / guard open / command open and around existing publication callbacks; preserve output, ACL, original timeouts, concurrency and all assertions. A new run is not safe until previous closure is proven. Do not build a new native writer or bypass required readback to obtain a pass. Any publication-combining change is a separate safety-reviewed design, not a speculative performance fix.

Direct detached/ordinary/capacity PASS evidence remains valid for those selections only. Crash/restart Gate remains BLOCKED. Underlying cumulative crash root: diagnostic only, no substantive fix in this investigation. No full regression, Minecraft, remote/system changes or Git publication.
## 2026-10-20 continued closure attempt: canonical fixture fixed, dispatch still blocked

Preflight: original writer13680/reader14000 absent; process snapshot contained no PowerShell except this query process. No process was terminated and old fixtures were retained. CIM command-line inventory remains unavailable; no claim of global runtime health.

Added fixed test-only stages operations-ready/guard-opened/commands-opened/reconciled/replayed, preserving bounded IPC,50s total deadline, assertions and cleanup. Diagnostic guard selection failed in38.98s (not deadline): reader operation init4071ms, guard open6385ms, command open6388ms, reconcile8856ms, then NATIVE_PROBE_FAILED before replay. Source proves independent fixture fingerprint defect: writer serialized action,name,confirm,revision while coordinator normalizes action,name,revision,confirm. Same fields do not imply identical JSON fingerprints. Fixture now calls the formal parseWhitelistMemberIntent before both persistence and replay; no product fingerprint or conflict check changed. Canonical fixture repair Attempt1.

Fresh unchanged guard crash/restart selection PASS:1PASS/2filteredNOTRUN,41.82s test /42.21s total,exit0. Exact operation replay, interrupted/recovery_required, zero resend, evidence retention and actual normal reader close assertions all passed. Independent SolHigh delta P1/P2/P3=0. Source review is separate from real targeted evidence.

Previously unexecuted dispatch selection was then run:1FAIL/2filteredNOTRUN,50.01s test /50.36s total,exit1. Last substantive observed stage intent-publish28485ms. At32057ms native command directory create completed2421ms and ACL-many was active; fixed observation cap prevented finer late-step attribution. No dispatch checkpoint message or reader launch was observed. Error NATIVE_OBSERVATION_DEADLINE at whitelist-native.test.ts:104; secondary CLEANUP_BLOCKED at line47. This is before confirmed command dispatch boundary, not a proven recovery-reader failure. Current actual command mutation count not observable beyond checkpoint; never infer a command was sent. Fixture retained; no forced kill/delete or subsequent native retry.

Exact remaining pipeline: whitelist-native-probe.ts command.admit -> CommandStore.admit -> namespace/directory ACL -> #publish namespace/anchor/first record -> scan/readback, followed by append(dispatch-intent). The precise inner step at50s is UNKNOWN. The probe still injects legacy ObservedAcl/private-publication into CommandStore, while GuardStore uses reviewed default scoped composition. Do not silently substitute Fake or delete command evidence to pass. A safe command-storage optimization requires action-local bounded ACL ownership, drain of concurrent scan chains and quiescence before publication; existing single-query ACL scope cannot directly serve concurrent eight-chain scans. No such high-risk change made in this diagnostic/fixture repair slice.

API typecheck, changed two-file ESLint exit0. Full regression/build NOT RUN because affected native Gate fails. New root/fix counters preserved: canonical request fixture1successful repair; no dispatch-path substantive repair this slice. No whole-project/LC2 production/LC1.1 finalPASS. RemotePAUSED, realMinecraftNOTRUN, no commit/push/PR. Logs: test-results/lc2-debt-path-2026-10-20/guard-stage-observation.log,guard-canonical-request.log,dispatch-canonical-request.log. Historical failures retained.
