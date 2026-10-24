# 2026-10-24 M3 final acceptance checkpoint

NeoForge fresh run m2-loaders-real-1afb966b-8a8a-4bc3-8343-ff5b12de9f9d:
business/modLifecycle PASS, six actual load/omission scenes, seven tracked Java
children normal exit0/null; finalStopped/helpersClosed/portsReleased/sourceInputsUnchanged
true. Strict diagnostics BLOCKED/overall exit1. Perflib, NeoForge DebugFile
appender failures, service-discovery TLS timeout and remaining warnings are
separate unresolved diagnostic Gate items; no classifier/system changes.
Formal browser360/768/1440 PASS and durable Manager worker rebuild PASS.

Final broad API:2832 PASS/2 FAIL, exit1 (157 files). Both failures were stale
Forge/NeoForge mods=false expectations. Only those two test expectations were
corrected to the existing production mods=true contract; focused6 PASS/exit0.
Original broad failure log is preserved; no claim of a new2834-PASS full run.
Exactly three explicitly deferred LC2 native experiment files were excluded;
these are not PASS. Final Web243 PASS, contracts28 PASS, lint/typecheck/build
PASS, git diff --check PASS (all exit0). Original33 frozen files unchanged;
additional test-only delta fingerprint saved separately. Independent Sol High
delta/source/evidence review P1/P2/P3=0; strict Gate remains BLOCKED.

No further Minecraft rerun, no uncertain fixture cleanup, no commit/push/PR.
P7 STOPPED. Whole M3 FINAL remains BLOCKED. Next: bounded read-only triage of
NeoForge logging artifact and host diagnostics, then decide individual fixes or
strictly evidenced diagnostic rules; do not blanket-allow errors or rewrite runs.
See [NeoForge acceptance](./M3_NEOFORGE_REAL_2026-10-24.md).

# M3-F Forge / NeoForge lifecycle

Latest follow-up: startup reconstruction and restore browser blockers CLOSED
in the tested engineering scope after bounded closure I/O attempt2. Formal
360/768/1440 all PASS with the original30000ms assertions, real persistent
Manager rebuild and clean shutdown. Independent Sol High final source/evidence
review P1/P2/P3=0; affected API133PASS, latest binding36PASS, static/build PASS.
See [current bounded-binding evidence](./M3_BOUNDED_BINDING_2026-10-24.md).
Older failed checkpoints below are retained, not relabeled or deleted.
Actual NeoForge loading and final frozen stage regression remain outstanding;
M3 FINAL is still BLOCKED. No Minecraft launch or Git action in this follow-up.

Status: IN PROGRESS. Engineering, real HTTP/browser, and real Minecraft loading
are separate gates. No M3 FINAL PASS is granted by this record.

## Implementation

- Reuse the existing addon lifecycle service, operation lock, protected snapshot,
  journal and API. Forge/NeoForge lifecycle uses a separate profile; inert upload
  admission retains its previous profile and running-instance protection.
- Activation requires explicit unknown-compatibility consent and fresh descriptor
  parsing/ID conflict admission. Restore preserves the original enabled/disabled
  state. The UI displays raw loader/dependency declarations and operation IDs.
- Persist the loader and exact predecessor operation relationship. A bounded,
  unique committed successor chain explains legitimate movement of installed
  bytes/inode. Every fresh check retains guard, directory/file identity, hash,
  trash receipt/restoration marker and original consumed-upload verification.
- New-loader interrupted/noncommitted startup is read-only and fail-closed. It
  does not silently unlink, resend, create missing receipts, or declare success.
- Existing Paper/Fabric lifecycle and recovery behavior remains separate.

## Validation and reviews

- Missing-consent startup cases: 27 PASS (loader-install file at that checkpoint).
- Integrated implementation checkpoint: 155 PASS; subsequent final focused
  command actually ran five existing files, 145 PASS. Its misspelled sixth upload
  filename did not run and is not counted as coverage.
- Actual upload-service/journal/ServerService admission follow-up: 36 PASS / three
  files. The two new loaders retain stopped, ownership, feature, active-operation
  and recovery gates.
- Full Web before final review fixes: 238 PASS; contracts 28 PASS; lint/typecheck/
  build passed at that checkpoint. These are not final frozen-stage evidence.
- New UI operation-ID tests: first 37 PASS / one FAIL because a network-read retry
  had not finished within the existing assertion interval. The revised fixture
  uses an explicitly nonretryable HTTP 400 to test query-error rendering; 38 PASS.
  Mutation response-loss/no-resend tests remain separate. No production retry,
  assertion timeout or safety rule was changed. Both logs are retained.
- Independent Sol High reviewed lifecycle and test harness; its missing raw
  loader fields and restore/no-implicit-launch coverage suggestions were added.
- Independent Astra High found two P2 integration omissions: ServerService
  readiness and visible accepted operation ID. Both source fixes were accepted;
  subsequent UI verification passed. Final evidence review remains pending.

## Browser scan overlap investigation

Historical run `m12-real-b623d219-2e9e-4a1a-a8f9-9fc65c566483` stopped at
`ERR_ASSERTION: 429 !== 200`, no Minecraft, Manager closed and ports released.
The parent readonly inventory and embedded management used distinct query keys.
Fix attempt 1 unified the key but run
`m12-real-db8b94fd-3e5a-465e-85ba-2edc8efb7884` still blocked at the same
assertion. Read cancellation during StrictMode remount could leave the original
backend scan/read admission running while the replacement request was sent.

Fix attempt 2 keeps the new-loader inventory/trash bounded requests alive across
remounts by selecting a query function that never reads AbortSignal. It also
removes same-key refetch-plus-invalidation cancellation and stale query keys.
Paper/Fabric cancellation remains unchanged; backend busy guards are unchanged.
Added a delayed StrictMode test for exactly one inventory and trash request.
Focused UI: 39 PASS. Run `m12-real-f1172781-6326-40ba-b78d-77204abeef71`
confirmed inventory GET 200: the scan overlap failure no longer triggered.
It then stopped at `409 !== 201` on upload while the independent trash read held
the existing exclusive read-admission lock. This is a separate UI admission
omission: upload is now disabled until that read finishes; its fixture also
awaits actual enabled input. The StrictMode test checks disabled/enabled states.
No backend lock, retry, timeout or filesystem check was weakened. Preserve all
failed runs; fresh validation of this separate correction is in progress.

## Real acceptance boundary

The user has authorized fresh UUID copies from verified Forge/NeoForge sources.
The harness builds a small local annotation-only marker against hash-verified
dependencies, then checks actual load/omission over install, disable, enable,
trash, restored-enabled and restored-disabled states while an isolated Vanilla
peer remains responsive. No original world is read or copied.

The real-loader harness uses production Fastify `app.inject`; the independent
browser harness supplies real HTTP. Its app/adapter/store reconstruction is
same-process durability evidence, not an OS Manager-process restart. The browser
harness uses separate Manager processes. Strict diagnostic failures remain
separate from business behavior and are never generically allowlisted.

## Latest actual acceptance (supersedes pending statements above)

Forge run `m2-loaders-real-ff4aa01b-17d9-415b-8507-ccd1abc4e82a`:

- All six actual load/omission phases passed: installed, disabled, enabled,
  trashed-enabled, restored-enabled, restored-disabled. The local marker was
  observed only when expected. A separate Vanilla peer stayed responsive.
- Seven Java launches (six Forge plus the peer) all explicitly stopped with
  exitCode=0 / exitSignal=null, no premature exit. finalStopped/helpersClosed/
  portsReleased/sourceInputsUnchanged=true. Original source worlds untouched.
- Final same-process Manager reconstruction failed in `onReady` with
  `FST_ERR_HOOK_TIMEOUT`: `A callback for 'onReady' hook timed out. You may have
  forgotten to call 'done' function or to resolve a Promise`. managerReplay=false;
  businessResult/result remain BLOCKED. Do not call this a durability PASS.
- strictDiagnostics=BLOCKED separately retains Perflib 009 errors and JVM/Forge
  Unsafe/restricted-method warnings. They did not prevent these six functional
  scenes or normal shutdown. No classifier/system setting was changed.
- Report and launch logs remain in ignored `.manager/<runId>/`; both fresh
  runtime copies and recovery evidence remain preserved.

One read-only post-run profile (no Minecraft spawn, no receipt/journal writes):
`test-results/m3-forge-startup-readonly-profile-v1.json`. Same-process monotonic
timing: adapter construction 3019.57ms (outside the hook), fresh identity
4196.31ms, full successor/guard/endpoint proof 6184.31ms, original consumed
upload proof 4447.34ms. These proofs individually PASS. Even the last two sum
to 10631.65ms, exceeding the default 10000ms hook budget before other startup
work. Exact original-hook per-stage timing was not instrumented; this separate
sample proves the cost conflict, not identical historical stage durations.
The post-timeout operation records include recovery/interrupted outcomes; do
not overwrite them with the earlier succeeded state.

Independent Sol High assessment: no demonstrated small deduplication can
guarantee that entire startup completes within 10s. Original guard duplication
can be reduced but does not solve the measured lower bound. An explicit
bootstrap/pending-admission architecture decision is required; keep a bounded
overall deadline, fail-closed writes and controlled shutdown. Merely moving
work outside the hook must not be reported as passing the original 10s Gate.
No repair of this startup cause has been attempted (0).

Latest real HTTP/Chrome browser run:
`m12-real-3aad0c5b-c02f-4b7c-8af2-a6a5a54d6062`, BLOCKED.
360px installation, disable, enable and trash passed; restore was accepted and
the backend operation `c9c35c80-2c6f-4774-ad71-609ef52fde8d` succeeded, but the
page did not show `操作完成，列表已刷新` within the unchanged 30000ms assertion.
Original error: `NO_EXPLICIT_ERROR_CODE`, `expect(locator).toBeVisible() failed`,
`Received: <element(s) not found>`, `Timeout: 30000ms`.
The operation createdAt/updatedAt interval is about 28482ms; it is not a
measurement of UI completion (post-terminal listing/trash/status verification
is additional). No final trace was saved in this non-timing failure branch,
so the exact remaining frontend/verification segment remains UNKNOWN.
Cleanup observed all five accepted operations succeeded, closed the Manager,
preserved sources and released ports. No Minecraft launch. 768/1440 NOT RUN;
even 360px is not an overall PASS. No speculative performance repair/rerun.

## Latest candidate checks and remaining gates

### Follow-up: bounded startup admission and restore timing (2026-10-24)

User explicitly approved independent GPT-6.1 Sol High for M3 advanced/final
review instead of Astra. AGENTS.md and CODEX_MODEL_ROUTING.md record the
M3-only exception; historical review attribution is unchanged.

Startup cause CONFIRMED: the complete dependency, successor-chain, guard and
consumed-upload proofs exceed the default 10000ms onReady budget. The original
failure did not preserve a stack; no original stack is reconstructed here.
The candidate keeps synchronous journal attribution and legacy reconciliation,
then establishes app-wide pending admission before bounded deferred addon
verification. Pending/failed API and WebSocket admission stays closed; auth
remains available. Checks use a monotonic deadline, shutdown aborts and joins
the owned proof, and background schedulers start only after verification.
This is an explicit admission architecture change, not proof that recovery
itself completes in 10 seconds. The 120s recovery admission deadline does not
guarantee hard cancellation of arbitrary in-flight operating-system I/O.

`test-results/m3-startup-gate-preserved-forge-v1.json`: PASS within its narrow
scope. Actual historical Forge transaction/guard/consumed proofs were read;
operation projection used MemoryOperationStore to avoid rewriting historical
receipts. Fastify ready 657.34ms; complete recovery 39474.59ms; pending API 503,
then stopped/recovery-cleared state. Historical transaction/operation hashes
unchanged, Minecraft launches=0, helpersClosed=true. This is not a fresh real
Minecraft or durable operation-replay acceptance run.

Browser diagnostic `m12-real-659fd7b2-3828-477f-8b36-355c542bf10c` retained the
30000ms restore assertion and failed it. Non-restore scene preparation used
bounded status reads and explicitly did NOT claim installation/lifecycle UI
acceptance. Restore operation `0648c913-d749-413c-a4d1-60bc71a7c5e7` published
success about 35713.60ms after queued-store entry: checkpoint source-removed
27983.12ms, before-publication 32497.90ms, journal committed 35699.60ms.
The backend transaction itself exceeded the assertion, so stopped polling or
frontend-only delay is not the demonstrated cause. Failure trace is preserved
as `completion-failure-trace.zip` in that run. All accepted operations eventually
terminated, Manager closed, no Minecraft launch, source unchanged and ports
released. A previous diagnostic installation timeout remains preserved under
`m12-real-e6735997-1270-4977-a42c-af14edca2d16`.

Repair attempt1 implemented the existing operation-scoped NeoForge pure
metadata parser cache across lifecycle captures, disposed in finally. Fresh
reads, hashes, physical identity, registered plan/Java/environment and
owner/stopped checks remain. HTTP/preflight/recovery reads stay cold;
Paper/Fabric/Forge paths do not use the new scope. No timeout changed.

Focused tests: four-file first run137PASS/5FAIL because an old fake NeoForge
adapter lacked its registration snapshot. The fixture now provides the same
stable synthetic registration as the other loader fixture; all original
assertions remain. That file then74/74PASS; together with the unchanged passing
other three files this is142/142 in batches, not one full regression. Three
new tests prove injected identity drift before-move/destination-installed/
before-commit still preserves evidence, blocks commit and requires recovery.
Startup/active-world/schedule27PASS; the command also named a nonexistent
operations.test.ts and therefore does NOT establish that file's coverage.
API typecheck v5 exit0. Independent Sol High source delta P1/P2/P3=0.

Formal360 run `m12-real-220200d3-f455-4b33-a54c-999f3c09a684` is BLOCKED at
installation visible-success30000ms, BEFORE restore. Failure trace SAVED;
68 operation GETs all200, last07:54:19.759Z still
`running / protection-backup-complete`. No evidence that polling stopped.
Installation eventually succeeded, Manager closed, zero Minecraft launches,
sources unchanged and ports released. This installation deadline recurrence
is not relabeled as a successful restore test. No speculative install repair.

Bounded post-repair restore diagnostic
`m12-real-527c33a5-0674-4f44-ad05-a39595e74232` also FAILED its original
30000ms restore visible-success assertion. Operation
`a92ab54b-2de9-4868-a5b1-29d12d82ca8c` manager-clock queued-save187135.1768ms
to succeeded-publication218822.4745ms =31687.30ms, versus35713.60ms before
repair. Source-removed24511.97ms; before-publication28254.72ms; committed
state31673.02ms relative to the same queued entry. First succeeded API
serialization219833.8577ms uses that SAME manager clock. Browser clock is
separate: its assertion failed at221719.2145ms. Cross-process timestamps are
not subtracted or used to invent a browser latency. The bounded observer does
not trace individual filesystem calls, so the remaining internal bottleneck
inside each full proof is UNKNOWN. No second speculative repair was made.

This diagnostic only prepares non-restore steps by bounded status reads and
is NOT eligible for whole UI acceptance. Failure trace is SAVED; all five
accepted operations eventually succeeded; cleanup1084ms, Manager closed,
zero Minecraft, source inputs unchanged, ports released. Formal768/1440 remain
NOT RUN because formal360 did not pass. Fresh NeoForge real acceptance,
durable startup replay and final stage regression remain pending. Historical
failed results are not rewritten. M3 FINAL remains BLOCKED.

Final checks for this bounded two-blocker change (all exit0):

- API142 lifecycle/identity/install/successor tests in batches,27 startup/
  active-world/schedule tests,58 affected API/service/store/upload tests.
  The last command also named nonexistent addon-journal.test.ts; its actual
  summary is five files58PASS, not six. No coverage is claimed for that name.
- Web focused Addons41PASS; Contracts28PASS. This is not a new full Web/API run.
- `m3-two-blocker-lint-v1.log`, `m3-two-blocker-typecheck-v1.log`,
  `m3-two-blocker-build-v1.log`, `m3-two-blocker-diff-v1.log`: PASS.
- Independent GPT-6.1 Sol High final source/evidence delta: P1/P2/P3=0 in
  reviewed source changes; explicitly confirms both failed browser reports and
  the limited startup proof. It does not sign off whole M3 or erase runtime
  deadline blockers. No full regression or new Minecraft run during this
  follow-up; no legacy CommandStore experiments, Git upload or P7 work.

Next decision must be evidence-led: the metadata-only reuse reduced but did
not close the restore deadline. Individual filesystem/protection/closure
substeps still need attribution before selecting repair attempt2. Formal
installation timing also remains independently blocked. Do not loop formal
runs without a new justified candidate or weaken either original assertion.

- Runtime timestamp correction: 39 PASS. Actual repeated probe observations
  refresh status and stream timestamps without duplicate transition events;
  unknown remains unknown. Initial new-test cleanup typo (`runtime.close`)
  failed, corrected to the actual `closeObserver` API; original log retained.
- Install terminal proof now uses a shared fresh Query, with no cancellation
  of another scan and no duplicate successful-install refresh. Cached and
  pending cases are covered. Focused UI 41 PASS; latest complete Web 243 PASS.
- Latest typecheck/lint/diff and production build PASS (exit0).
- Sol High and Astra High source delta reviews: P1/P2/P3=0 in their reviewed
  implementation scope. They do not sign off the subsequently observed timing
  and startup integration failures or claim whole-M3 acceptance.
- Current frozen broad API regression NOT RUN: startup/browser blockers remain;
  earlier 2788 API baseline is historical, not final evidence for this candidate.
  Deferred LC2 native experiments were not rerun. Contracts 28 PASS checkpoint
  retained; no contract change since that run.
- NeoForge real marker lifecycle NOT RUN. Avoid repeating the shared startup
  failure across another long real run before its architecture is resolved.
- Whole M3 FINAL: BLOCKED, not PASS. Preserve all code and historical evidence.
  No commit/push/PR. P7 remains STOPPED.
