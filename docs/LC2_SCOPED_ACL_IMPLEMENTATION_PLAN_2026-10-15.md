# LC2 scoped native ACL — implementation gate

## Latest owner-retention checkpoint — mechanism proven, active orphan still OPEN

The dedicated UNWIRED scope now requires a constructor-only native owner wrapper by default. The private capability is exact-mutation-epoch bound; its helper duplicates the original root/share-zero lock handles, validates descriptor identity/type/link/path/privateACL, and retains successful copies until OS exit. Original lock Acquire/Release native behavior and ordinary authentication ACL verification remain unchanged. Missing capability refuses, never falls back. Stores/HTTP writes remain UNWIRED.

Normal-retention native1PASS/30.57s, default active-parent1PASS/25.23s and idle original-handle handoff1PASS/32.46s establish startup within original5s, actual close/reacquisition, default child absence before takeover, and actual exclusive-lock retention by a surviving idle helper. Latest affected9-file192PASS, lint/typecheck/build/diff exit0; final source/evidence independent Sol High no new source P1/P2. These are component gates only, not a new full regression.

Two original active-fixture failures remain FAIL. Default-spawn survivor assumption was not justified; historical exact exit order UNKNOWN. The detached experimental fixture could not establish the expected WinPS pipe/command behavior (inert normal exit37=>37 versus detached=>0, no output). Do not rerun or relabel it PASS. The genuine surviving active-orphan death case remains OPEN P2, maximum physical history capacity NOT RUN and default native guard/crash Gate BLOCKED. See the full run IDs, raw errors, attempted fixture correction and limitations in LC2_NATIVE_SESSION_INVESTIGATION_2026-10-15.md.

Next possible bridge is design-only: any ProcessStartInfo-based test launcher must prove both process identities/lifetimes, exact owned-target receipt, strict unchanged aggregate pipe limits, startup entirely inside5000ms and actual closure of bridge AND target. Do not infer that a grandchild escapes every outer Job or substitute bridge close for target close. No native bridge implementation or execution has been approved by source review at this checkpoint.

## Latest checkpoint — healthy rotation candidate verified, default integration still blocked

The earlier single-child and NOT implemented sections below are retained design history. Healthy rotation is now implemented only in the dedicated UNWIRED scope/transport. It does not finish maximum-history capacity validation, active-parent-death containment, store integration or the original default Native Gate.

Implemented:32-query/20-second healthy rotation, explicit publication-before quiescence, one absolute5000ms logical-query deadline covering retirement/start/dispatch/reply, shared bounded close promise, unchanged40-second child lifetime and combined262144-unit accounting. A response arriving after a deadline or child lifetime cannot succeed even if a timer callback was delayed. A nested child factory that throws after possible creation is unknown, not proof of absence; cleanup retains the mutation lease. SID and action/context identity remain frozen across children. Failed children are never replaced or retried.

Fresh focused evidence `lc2-rotation-final-cec0a7ef-0510-4017-8946-81951807fee4`:4 files/92 tests PASS (86 deterministic and6 actual inert Windows transport cases), lint/typecheck/production build/diff check exit0. This selected suite excludes the separate timing/store suites; counts from earlier, differently selected suites are not added. Existing bundle-size warning remains. No new whole-project baseline is claimed.

Fresh native evidence `lc2-native-healthy-rotation-b125dad5-bc1c-41b2-8f83-0d871615ba12`:one selected test PASS, four unrelated cases unselected, exit0,33.94s suite. Frozen transport/scope/probe/harness4/4 matched after execution. Actual35 queries/68 targets, every child1–32 queries, at least3 real children, all actual closes before owner release, legacy ACL equivalence and quiescence around native publication are asserted. The20-second threshold may rotate early; the test deliberately does not hardcode child grouping. Original50-second work/shared5-second cleanup/60-second test limits remain.

Independent source/evidence review is recorded separately in the investigation ledger. Active-query parent death and new-owner safety remain OPEN P2. Default stores and authentication still do not import these modules; no routes, real RCON or Minecraft operations were enabled.

Design candidate only. No production session wiring or default ACL behavior change in this checkpoint. The test-only session and guard benchmark do not finish the member-write slice.

## Objective

Retain every actual ACL inspection, batch boundary, before/after descriptor check, native publication and pinned exact-byte guard while avoiding a new PowerShell process for each ACL query. The observed native failure is cumulative invocation cost, not an established invalid ACL or individual helper timeout.

## Proposed production boundary

1. Keep ordinary authentication `WindowsPrivateAclVerifier` unchanged. Introduce a dedicated whitelist-scoped verifier only after the prototype gates and independent security design review pass.
2. Scope is owned by one store exclusive operation under its existing `beginOfflineMutation` lease. The verifier is unavailable outside that scope; never a global pool, caller-controlled factory or environment-configured bypass.
3. Native create/write helpers must validate their returned snapshot through the same SID-frozen verifier. Query reuse returns newly read snapshots on every invocation, never cached fingerprints. Existing batches1–8 and all file/root/link identity checks remain.
4. Each owned child retains request5000ms including startup,64KiB aggregate output, fixed trusted script/arguments, no shell, strict JSON/UTF8/sequence and any-stderr failure. Script-local progress display is distinct from accepting diagnostics. No fallback after unknown state.
5. A long history scan may exceed the prototype64-query/40s child limits. Do not silently reduce the command store's10000-directory-entry scan ceiling (including records, anchors and witnesses), or the guard store's independent1000-guard/256KiB-per-source ceiling. Healthy rotation design below still requires review/implementation. Unknown/failed children cannot be rotated away. No unlimited retries or TTL deletion.

## Ownership and cleanup invariant

Current store `finally { release(); }` cannot safely enclose a persistent helper without change. The native mutation lease must remain held until actual child `close` is confirmed. Query success is not close proof; kill request is not close proof; Node exit alone is not helper drain proof.

- action success + healthy actual close: release lease, then return result.
- action failure + confirmed child close: retain primary error and poison as applicable, release lease, report failure.
- close failure with confirmed exit: poison store and report failure, never return action success.
- helper exit unknown: poison store, retain mutation lease, refuse owner release and further writes; report fixed cleanup/recovery failure. Preserve evidence; no generic process kill or forced directory removal.
- session creation failure before a child exists: release only if absence is positively established.

No store instance may overlap scopes. Cross-store operations still obey the shared owner mutation mutex. `beginActivity` additionally protects owner lifetime but does not replace mutation exclusion. Verification and creator callbacks must use the scope belonging to the action, with no live session crossing owner reacquisition.

## Required tests before default production use

- lifecycle and bounded framing/timeout/stream failures, malicious and unsolicited output;
- actual Windows parser1/2/8 targets and invalid scalar/null/empty/nested/oversize arrays;
- repeated real ACL equivalence, actual normal close, idle helper EOF after exact parent death;
- original guard checks, bytes/manifest/hash/revision and owner reacquisition with all queries counted;
- scope overlap, create/query/close failure, close unknown retaining lease, no next write/owner release;
- healthy controlled rotation preserving batch checks and SID continuity; failures never trigger fallback;
- guard and command store targeted regression, native process-death/restart/recovery with new process;
- independent source review, then fresh frozen full regression/lint/typecheck/build/diff and final evidence review.

The original default native test remains BLOCKED until tested on the actual new default implementation. A faster injected benchmark cannot be substituted. Whitelist HTTP writes, real RCON and real Minecraft remain outside this design gate. All old failures/evidence remain unchanged; no Git publication.

## Dedicated candidate checkpoint

`whitelist-acl-session.ts` now lives in services as an UNWIRED dedicated module; the old fixture only reexports a compatibility alias. Runtime source equivalence was checked except import/class/comment and a type-only optional pid correction. Default authentication and stores do not import it. `whitelist-acl-scope.ts` is also UNWIRED: exactly one child, no rotation or long-scan capacity claim.

Each action receives a distinct verifier capability bound to a generation token AND AsyncLocalStorage. The SID-frozen real verifier is private and persists across scopes. Old capabilities, external borrowed contexts, cleanup-time calls and caught ACL rejections cannot authorize queries or action success. Unknown child closure or factory outcome retains the owner mutation lease. This candidate closes a primitive scope boundary only; it is not permission to wire the stores.

## Long-scan proposal for the next design review — NOT implemented

Use healthy between-query rotation at32 completed queries or20 seconds since that child's first query, whichever comes first. Each query still has5000ms including lazy spawn; each close still has its independent5000ms bound. Never rotate while a query or lifecycle transition is pending. The old child must close successfully with actual close confirmation before a new child starts. Keep the same private SID verifier across all children. Any query/close failure,40s poison or uncertain state fails the operation; it never triggers automatic replacement/retry.

**One logical-query deadline, never5s+5s:** at every verify/verifyMany entry establish one absolute monotonic deadline5000ms ahead, before any waiting. Rotation needed to serve that query, old-child close wait, new-child startup, dispatch and reply all consume that same deadline. Check it and the32-query/20s thresholds again immediately before dispatch. A new transport request may only use the remaining time, never restart a fresh5000ms allowance. If none remains, dispatch/start counts stay zero for that next child. A child already faulted or beyond its40s lifetime is not healthy even if its timer callback has been delayed; cancellation/close cannot rehabilitate it.

The independent close bound is for proving physical drain after rejection, not for extending the logical query or allowing late success. Share one in-flight close transition/promise so quiesce, timeout and final cleanup cannot serially allocate multiple5s waits. The query failure remains failure even if later drain succeeds. Owner lease and action exclusion remain held through drain. Explicit publication-before quiesce is a separately declared operation stage, must complete before publication begins, and cannot be inserted as hidden work before starting a query's clock. None of this deadline/rotation API is implemented in the current transport; a future trusted remaining-deadline parameter must only shorten its existing5000ms limit.

Before a potentially long compiled native publication, explicitly quiesce the healthy child while retaining action capability and mutation lease. The native publication may begin only after confirmed healthy close; inline snapshot validation still uses the same SID verifier, and the next actual query starts a fresh child. Concurrent calls during quiescence must be rejected. If host scheduling/IO exceeds the timing bounds, fail closed rather than treating nominal age thresholds as a liveness guarantee.

An operation-wide combined262144-unit budget is proposed as a finite ceiling, not a record-retention policy. Each query attempt and each child start consumes one unit, deducted before dispatch/start under the same exclusion; failed attempts are not refunded, and rotation never resets the budget. Reserve both units atomically when a query needs a new child. Every child start must correspond to a real requested query; no idle respawn. Static over-approximations from current store loops:

| Existing action | Conservative query bound |
| --- | ---: |
| Guard scan,1000 guards ×(manifest+64chunks)×before/after +namespace | 130001 |
| Guard create, over-approx full scan +65files×(write verify +staged2 +published2 +final2) | 130456 |
| Command scan, up to10000 combined evidence entries×before/after +namespace2 +directory1 | 20003 |
| Command admit/append, two scans +bounded new namespace/anchor/record/witness publication | below40100 |

These are structural query counts, not runtime estimates or tested maximum-history throughput. Directory-entry ceilings and per-chain32 checkpoints remain unchanged. Even one child start per query gives combined guard upper bound2×130456=260912<262144; the command bound is smaller. Unhealthy or externally changing layouts still fail closed. Budget, quiescence and rotation must be verified against actual loops and tested before claiming capacity compatibility. The current one-child controller deliberately implements NONE of this proposal.

## Active-parent-death prerequisite — still OPEN

The positive native parent test proves idle EOF only. It does not prove cleanup when a query is executing or stuck, nor that a new Manager can safely classify an unknown former helper. Reacquiring the root owner alone is insufficient. Before production wiring, independently evaluate bounded OS process containment or durable ownership/reconciliation evidence, then verify active-query death and a fresh Manager process. No platform settings or unknown-process termination is authorized. Until this is established, retain the design P2 and keep stores/default auth UNWIRED.

### Static containment direction, not an implemented fix

Microsoft documents [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) and their kill-on-last-handle-close limit. A possible Windows-only design is an unnamed, non-inheritable child job whose last controlling handle belongs to the exact Node owner. If adopted, the helper must be associated before receiving query data; an assignment/containment failure must prevent query dispatch. Do not change or terminate the Manager's existing outer job. [Nested-job rules](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs) and sandbox restrictions must be checked through an isolated capability test, without changing system policy or permitting breakaway fallback.

This is an inference/design direction from the Win32 contract, not proof that the present Node launcher supports it. Current spawn/session code has no such job containment. Creating a child then assigning it leaves a race unless execution/input is gated with demonstrable lifetime ownership. Handle inheritance/duplication, assignment failure, parent death before/after assignment, pending local ACL query, child close/pipe closure, fresh owner acquisition and zero unknown-process actions all need explicit tests. No native addon/toolchain availability,5-second compatibility or parent-crash guarantee has been established. Do not replace this gap with PID-only termination or idle EOF evidence.

Static repository feasibility check: ManagerLifetimeLock already uses OpenProcess with exact process creation identity and DuplicateHandle to retain native directory/file handles in Node. It does NOT implement CreateJobObject/AssignProcessToJobObject or a contained child launcher. The shared `runWindowsNativeScript` has its existing15000ms/16KiB bounds and Add-Type callers; it cannot simply replace the5000ms/64KiB ACL query transport. Do not alter the shared lock/native runner to experiment.

Next minimal investigation should first choose and independently review a dedicated trusted launcher. Any bootstrap handles must be closed/duplicated with exact owner identity; helper stdin remains gated until containment is proven, and the last controlling job handle must genuinely belong only to the owner before query dispatch. Parent death at every bootstrap boundary and lost bootstrap responses require explicit outcomes. Unknown remote handles must not be guessed or broadly closed. Startup/compilation/assignment cost must remain inside the original first-query budget rather than being hidden by prewarming. If this cannot be proved, report an unavailable prerequisite and keep the existing defaults; do not start a native repair from this static proposal alone.

## Revised active-parent safety proposal — retain actual owner exclusion, not guaranteed termination

The next candidate should investigate retaining local duplicates of the existing ManagerLifetimeLock root-directory and share-zero lock-file handles inside the dedicated ACL child. This is a proposed fail-closed safety boundary, not a claim of immediate child termination or a completed Gate. Do not implement a remote Job-handle protocol at the same time.

Before entering the inspector loop or consuming any target frame, trusted bootstrap code must:

1. Receive a constructor-only capability issued by the exact live owner while its mutation lease is held. No request/environment switch, public response, log or enumerable owner field may contain the capability, root or native handle values.
2. Open the exact Node process using the already established creation identity. Retain that process handle while duplicating; never reconnect to a PID that may have been reused.
3. Duplicate the already-open root and share-zero file handles INTO THIS helper, with inheritance disabled, without closing or replacing the Node originals. Reopening a pathname is not equivalent. If the parent dies before duplication, no query may start. Failed/partial duplication must fail closed and close only positively owned local handles.
4. Validate both duplicates against the expected volume/file identities, canonical paths, type/link constraints and private lock-file ACL. No validation/ACL standard may be reduced. After successful validation, keep raw duplicates in rooted static process-lifetime storage until OS process exit; do not Dispose/close them in an EOF/finally handler. Only failed/partial bootstrap before any query may close positively owned local copies. This closes the independently identified P2 early-release window between EOF and actual child exit.
5. Accept query input only after every required duplicate and check has succeeded. Bootstrap/compilation/retention cost consumes the original first-query5000ms; no prewarm or extra timeout. Preserve64KiB framing, actual ACL query and SID checks.

During a pending query, abrupt Node death closes its originals but leaves the helper's verified duplicates holding actual OS exclusion. A fresh Manager must receive AUTH_BUSY until that helper actually exits and the OS releases its duplicates. If the helper remains blocked, the root remains unavailable; this is an explicit retained-ownership/availability limitation, not successful recovery. No new Manager can classify an unknown orphan as drained just because the old Node is gone. Idle EOF may still end the helper normally; its successful retained handles are never explicitly closed. No cross-process handle closure or PID kill is required. Scope cleanup still requires actual child close before releasing the in-process mutation lease.

Native evidence must cover parent death before retention, after retention/before dispatch, during an actively held query, and lost/failed bootstrap replies. For active death, a bounded test-only inspector hold may provide a deterministic checkpoint, with real handle duplication/OS exclusion and no real credentials/world. Verify a separate fresh process is blocked while the exact old helper is alive, then reacquires only after proven helper close. A finite hold demonstrates OS exclusion; it is not proof that arbitrary Get-Acl calls finish. Failure/unknown states retain fixture evidence and prohibit forced cleanup. Re-run ordinary owner lock semantics if its private capability API changes.

This proposal changes the required safety proof from “old child must immediately die” to “new owner can never overlap an unclosed old child.” The design must receive independent Sol High acceptance before implementation; no capacity, default store or LC2 PASS follows from design acceptance alone.

Independent Sol High design review accepted the layered direction after the early-release P2 clarification above (Attempt1; no runtime error). The owner capability must be bound to the exact mutation epoch, revoked by lease release and restricted to the internal fixed-script factory. Minimal UNWIRED implementation/source review may proceed. Native execution remains a separate pre-reviewed checkpoint; default integration and actual parent-safety Gate remain pending.

## Next minimal bridge investigation — inert feasibility only, review pending

Do not build a production bridge or wire a new child type into WhitelistAclSession from this proposal. The detached WinPS fixture cannot provide the requested command/pipe contract on this host. First establish whether a normally launched, trusted PowerShell broker can use the built-in .NET ProcessStartInfo API to run a second ordinary PowerShell with CreateNoWindow=true and UseShellExecute=false, without DETACHED_PROCESS or any explicit breakaway/Job changes.

A single inert capability probe may be considered only after independent design/source review:

- Node starts the fixed normal PowerShell broker by argument array, no shell. All executable paths are the same fixed SystemRoot-derived Windows PowerShell path. No user values, filesystem targets, credentials, ACL inspection, environment enumeration or network access.
- Broker creates exactly one child. The immutable inner script sleeps250ms then exits37, with no stdout/stderr/files. The250ms is intentional and included in elapsed time; it is not ACL-query evidence.
- Broker emits exactly two bounded JSON metadata events on its own test-only output: started with positive child PID, then closed with exitCode. Its retained .NET Process object/WaitForExit is the exact-child termination evidence; no re-opening by a process name. These metadata events are NOT injected into the production ACL protocol or its output budget.
- One5000ms monotonic work deadline includes both process launches and script execution, with pre-spawn/post-result fences. Broker stdout cap4096 bytes; any stderr, unknown event/field, duplicate or trailing data fails. Never print raw streams/errors. Report fixed categories, stage, elapsed times, codes/signals and actual-close evidence only.
- Normal completion requires expected inner37, broker0/null, two exact events and actual broker close. No parent-kill experiment, source-root access or retention capability is involved.
- On timeout stop scheduling, preserve primary failure, and stop only the exact Node-owned broker object if required. Use one separate shared5000ms cleanup deadline. If exact target close/absence cannot be established, report CLEANUP_BLOCKED; do not terminate a PID inferred solely from a metadata number or a process name. No fixture directory exists to delete.

Even a positive result only establishes this inert launch path. It does not prove Job inheritance, orphan survival, native retention bootstrap timing, bounded relay behavior, PID/handle lifetime binding or active-parent recovery. Those require a separate reviewed design before a full fixture. Failure stops this direction without fallback or retries. This investigation must not hide startup/compilation outside the original ACL query deadline.


## 2026-10-15 inert normal-broker feasibility checkpoint

Diagnostic-only source: apps/api/test/fixtures/whitelist-bridge-inert-probe.mjs and apps/api/test/whitelist-bridge-inert.test.ts. No ACL, credentials, filesystem targets or network in either PowerShell process. The inner fixed script sleeps250ms then exits37. No detached flag, relay, parent kill, product integration or Job-setting change.

Pure focused10PASS/exit0 (initial log lc2-inert-bridge-focused-d0d94d98-a7a0-494c-b74d-939a4d81db0e.log); after source-review corrections10PASS/exit0 again, lint0, syntax0. Pre-run independent SolHigh found P2 cleanup deadline began after kill and P3 uncaught evidence-save exception could print raw details. Both fixed before native execution: shared cleanup5s now starts before first cleanup action, top-level unexpected failures emit a fixed code only. Delta review P1/P2/P3=0 authorized ONE inert run. Neither was a product ACL failure; substantive correction Attempt1 for each.

Fresh single native run lc2-inert-bridge-5385d3ba-d063-40ae-903f-a2d8ef8a2add: PASS/native exit0, elapsed2603ms within original outer5000ms, brokerActualClose=true/exitCode0/exitSignalnull, targetPid38852/targetCloseProven=true, stdout81bytes, killRequested=false. Exact .NET Process handle WaitForExit and both silent stream EOFs establish target exit37 before its fixed closed receipt. Lost receipts remain CLEANUP_BLOCKED; broker close alone never proves target closure. Frozen two-file manifest lc2-inert-bridge-frozen.json matched2/2 after run. Subsequent readonly process inventory found neither targetPID38852 nor matching project test/helper processes. No fixture directory was created or deleted by this inert probe.

This proves only normal Node?PowerShell broker?ProcessStartInfo PowerShell fixed startup/exit/close feasibility. It does NOT prove Job inheritance, a surviving helper after parent death, retained-lock behavior during an active orphan, real ACL relay, or maximum-history compatibility. Historical detached FAIL results remain unchanged. No new whole-project regression or LC2 feature PASS is claimed; latest affected baseline remains9files192PASS, prior lint/typecheck/build/diff0 for the owner-retention candidate.

Next bounded design step: independently design an exact-owned broker/target identity and bounded IPC relay before any active-orphan experiment. It must establish lifetime/Job behavior without assuming normal grandchildren escape Node termination; retain exact owner handle duplicates until OS exit; enforce original5000ms query deadline including all startup; avoid metadata-PID killing, raw output, false drain and uncontrolled breakaway. If surviving active orphan cannot be created safely on this host, keep that native Gate OPEN and state platform limitation. Then prove maximum physical history capacity and integrate scope into stores only after corresponding review/validation. Default native guard/crash Gate BLOCKED; member writes UNWIRED; LC2 IN PROGRESS; remote PAUSED. No Minecraft, realRCON, user-world, system/network or Git publication action.

Actual allowance checkpoint: primary used96%/remaining4%, ordinaryUsageAllowed=true. This is not an exhaustion claim. Save evidence and do not begin a larger unsafe transaction before safe handoff.

Final independent SolHigh inert source/evidence/document review completed: P1/P2/P3=0; frozen2/2 independently matched. Product retention manifest rechecked12/12 unchanged. Active-orphan P2 OPEN/default native Gate BLOCKED/member writes UNWIRED; no feature PASS or whole-project regression claim. Git branch codex/phase-4-players-properties, HEAD ba28a6a44ebac5efee8bbe75b96ddcfc86aa2789,93 working-tree entries; tracked runtime/.manager/test-results files0. No commit/push/PR.
