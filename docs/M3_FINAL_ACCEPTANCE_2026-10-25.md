# M3_REVISED_FINAL_GATE — 2026-10-25

**ORIGINAL_STRICT_DIAGNOSTICS = BLOCKED**

**REVISED_FINAL_GATE = BLOCKED**

**M3_FINAL_STATUS = BLOCKED**

This is a new decision layer, not a rewrite of any original run. The user
explicitly approved only R1/R2 in the current final-signoff instruction.
Those risks are accepted within their boundaries. Four other required
diagnostic categories lack an applicable M3 approval/nonblocking rule.
Therefore `M3 FINAL PASS — Accepted Residual Risks` is **not** declared.

## Candidate, authority and change boundary

- Branch: `codex/phase-4-players-properties`.
- HEAD: `d8bb9b4b9dd27d5dd864beae7793c9bc1f4762a7`.
- Candidate means this HEAD **plus the uncommitted M3 working tree**, not HEAD
 alone. `test-results/m3-final-candidate-20261024-v1.json` pins33 changed/new
 production/contracts/test/harness files. All33 currently match.
- The subsequent test-only Forge/NeoForge capability correction matches
 `m3-final-test-delta-20261024-v1.json`. No production behavior changed there.
- Two subsequently added diagnostic scripts are independently reviewed test
 tools, not production features. Their syntax/eslint and actual evidence are
 recorded in the targeted diagnostics report. No other unexpected changed code
 path exists outside the frozen manifest plus these explicit additions.
- This final-signoff task changes documentation and decision evidence only.
 No product/test/classifier/dependency change, new Minecraft start, full-suite
 rerun, system change, Git upload or next-stage work is performed.
- Existing uncommitted work and historical reviewer attributions are retained.
 A `sources/` project mirror, if present, is reference-only and was not modified.
- Current M3 independent review is GPT-6.1 Sol High under the user-approved
 AGENTS/model-routing exception; no Astra or writer self-signoff substitution.

## Approved risk R1

**R1 = ACCEPTED_RESIDUAL_RISK**.

Bound to Windows, verified Java25.0.4.1, NeoForge26.3.0.95, FML12.0.12,
Log4j2.26.0, Netty4.2.16.Final and the verified dedicated-server launch closure.
Neo source manifest:
`2ff02ee70cf1ef52a1e2d2d84abc59210c097df15e1b58321025e0689d35d7b6`.
Original FML XML SHA:
`b21e48eed0bb227cbace66925105d9879c62b325927945662e54cf86e9ccf2b0`.

Accept only the established optional kqueue/epoll native-availability DEBUG
event loss and its exact DebugFile/NoClassDefFoundError/platform-restriction/
ThrowableExtendedStackTraceRenderer/LoaderUtil signatures. This does **not**
mean logging is fully normal, all throwable cases are covered, or loss is fixed.

Evidence:

- Non-Minecraft control
 `m3-log4j-control-6b0b12fc-ba47-4d85-a98d-f67e69b9a86a`: same artifacts and
 original XML reproduce the two failures without LT. Later fixed ERROR/FATAL
 chains are visible in stdout/latest/debug; ordinary DEBUG continues.
- Normal probe in `m3-diagnostics-f7db7f09-4386-4143-b07b-01ebe6aeae5d`:
 five fixed log/exception markers visible in stdout/latest/debug/LT stream.
 Original offline JFR-export failure report remains BLOCKED; the log coverage
 is verified separately in `m3-targeted-steady-supplement-20261024-v1.json`.
- Real fatal constructor test
 `m3-diagnostics-90cc81a6-690a-42e0-88f7-978a02f204e2`: LT returns
 `RUNTIME_START_FAILED`; no Done; autonomous Java exit1/null; fixed causes
 visible in LT/latest/debug/stdout and the FML crash report. Standalone
 FATAL-level logging with exit0 is not used as a substitute for this test.
- Install/lifecycle correctness uses private physical identities, hashes,
 snapshot/receipt/journal/operation evidence and runtime admission, not the
 optional native DEBUG availability events. Relevant tests and source review
 remain valid; no diagnostic exception authorizes a transaction bypass.

Exclusions: missing required ERROR/FATAL diagnosis, unrecognized fatal load,
concealed world/transaction/security failure, unknown Log4j/NeoForge exceptions,
other appender failures, changed signatures, or new version/configuration.
All of those require investigation and remain blocking where applicable.

## Approved risk R2

**R2 = ACCEPTED_RESIDUAL_RISK**.

Accept the five preserved historical NeoForge startup Can't-keep-up warnings
at2115/2172/2019/2002/2109ms (40–43 ticks), without claiming a cause or fix.
The original logs remain unchanged. This is local M3 functional acceptance,
not a performance SLA, sustained TPS/MSPT certification or blanket warning rule.

Evidence: fresh60s JFR/sampling and one warm-start60s/64MiB bounded recording.
Warm run `m3-diagnostics-da56081e-1171-4043-9b5e-691e5e6b70a4` covers actual
Done plus the next3s; no lag warning reproduced.53 periodic averages contain
4 bootstrap zeros and49 positives; zeros are not measured zero-cost ticks,
periodic averages are not maximum individual tick latency. Warm save37ms,
recorded GC pause maximum15.130813ms; source/ports/helpers/normal exit verified.
JFR attach perturbs startup; no player/live-peer workload equivalence is claimed.
Historical cause remains **UNKNOWN / NOT REPRODUCED**, never “fixed”.

Exclusions: sustained/reproducible TPS/MSPT degradation, unresponsiveness,
abnormal stop, data damage, failed world save, new performance regression,
process identity/stop/recovery failure. Those are not accepted by R2.

## Remaining required diagnostics — no authorization inferred

The original Neo report contains19 blocking ERROR,51 blocking Minecraft WARN
and6 unclassified terminal entries (76 total classified blocking entries).
R1 covers12 exact appender ERROR entries; R2 covers5 exact startup-lag WARN
entries. The remaining59 entries belong to these **four** required categories:

|ID|Category|Original entries|Existing evidence|Current disposition|
|---|---|---:|---|---|
|A|Perflib/OSHI/SystemReport|32:7 ERROR+7 counter WARN+18 SystemReport WARN|Windows counter lookup failure and Java telemetry degradation; M3 operations continue; LT live monitoring not accepted here|BLOCKED: no M3 waiver/nonblocking rule|
|C|Minecraft services discovery|18:12 Neo+6 Vanilla peer|Captured TLS-handshake read timeout; no demonstrated local lifecycle failure; online正版 player authentication NOT VERIFIED|BLOCKED: no M3 waiver/nonblocking rule|
|D|Controlled marker missing|3|Exactly marker omission launches3/5/7; annotation-only fixture, world seed/save continuity, not arbitrary user-mod/world safety|BLOCKED: no M3 waiver/nonblocking rule|
|E1|no-TTY|6|Pipe-stdio fixture; RCON/owned stop and capture work; interactive console behavior not certified by this test|BLOCKED: no M3 waiver/nonblocking rule|

These are diagnostic categories, not59 crashes or59 distinct underlying defects.
The20 `fatalRuntimeDiagnostics` strings overlap A and are not added again.
Original classifier `tests/acceptance/import-diagnostics.mjs` retains its
existing exact Java/Paper/Fabric rules and rejects these Neo categories; no
existing applicable M3 exception was found. Earlier Perflib postponement for
M1 does not automatically apply to M3. Environment attribution/controlled-test
semantics alone are not treated as an approved strict-Gate exception.

Required next decision is limited to these four categories: evidence-backed
explicit nonblocking/waiver disposition or a verified applicable fix. This
document does not extend the user's R1/R2 acceptance to them. No broad ERROR/
WARN allowance, network repair, registry repair or unrequested rerun is made.

## Function and transaction evidence

|Capability|Implementation/test evidence|Scope and limitation|
|---|---|---|
|Forge/Neo inventory, TOML and dependencies|`addon-inventory.ts`, `forge-addon-metadata.ts`; inventory/metadata tests in final API suite|Declared metadata, not arbitrary mod compatibility proof|
|Upload/staging and protected installation|existing addon upload/install/policy services; loader-install, API and journal tests|Unknown compatibility still requires explicit consent; no unverified arbitrary execution|
|Enable/disable/trash/restore|`addon-lifecycle-service.ts`, successor-chain and loader profiles; lifecycle/API tests and real marker scenes|Original enabled/disabled state and guarded receipts retained|
|Idempotency/protection/recovery|operation service, transaction journal, protected snapshots, successor-chain tests and independent reviews|Missing/ambiguous evidence fails closed; no resend or invented receipt|
|Startup recovery and admission|`manager-startup-recovery.ts`, startup/successor/install tests; current formal browser rebuild evidence|Pending recovery blocks admission; close drains actual task; no global hook-timeout increase|
|Multi-instance and old loaders|owned-peer real checks plus included Paper/Fabric API/runtime/install/lifecycle tests|No new Paper/Fabric real-launch rerun; old loader semantics remain separate|

No new source issue was found in this audit; prior independent code/safety
reviews P1/P2/P3=0 remain attributed to their reviewed candidates. Final API
includes relevant modules; older isolated counts are not added to its total.

## Real Minecraft — do not relabel original reports

Evidence roots are `.manager/<run>/acceptance-report.json` and its launch logs.

|State|Forge actual marker|NeoForge actual marker|
|---|---|---|
|Installed|loaded|loaded|
|Disabled|omitted|omitted|
|Enabled|loaded|loaded|
|Trashed-enabled|omitted|omitted|
|Restored-enabled|loaded|loaded|
|Restored-disabled|omitted|omitted|

- Forge run `m2-loaders-real-ff4aa01b-17d9-415b-8507-ccd1abc4e82a`: all six
 phase marker assertions and normal exits0/null are recorded, plus its Vanilla
 peer (7 tracked launches). Source unchanged/no original-world access,
 helpers/ports/final stop true. **Original modLifecycle/business/overall remain
 BLOCKED**, `managerReplay=false`, `FST_ERR_HOOK_TIMEOUT` at onReady. No
 current-run Forge replay PASS or missing original noCrashReport field is invented.
- Neo run `m2-loaders-real-1afb966b-8a8a-4bc3-8343-ff5b12de9f9d`: six phase
 checks and7 tracked normal exits; business/modLifecycle PASS, no crash report,
 source unchanged/no original-world access, helpers/ports/final stop true.
 **strictDiagnostics/overall remain BLOCKED**. Replay here is same-process
 app/adapter/JsonStore reconstruction, not an independent OS restart.
- Later shared startup/restore fixes and persistent Manager rebuild evidence
 are recorded separately. Formal browser runs below cover8 independent Manager
 OS process sessions across two reports, including initial starts and
 reconstruction, using production JsonOperationStore/journal.
 This does not turn the old Forge replay flag into true. Registered replay is
 checked before removal; after unregister, old receipts correctly project as
 interrupted/physical-recovery-required rather than silently losing evidence.

## Current regression and browser audit

All paths below are under `test-results/`. Times are recorded local run times
on2026-10-24 (Asia/Shanghai); static-only logs lack a start timestamp, so their
file completion timestamps are reported as metadata, not invented start times.

|Check|Result/exit|Evidence|Recorded time|
|---|---|---|---|
|API v2|2834/2834,157 files,0|`m3-final-api-20261024-v2.log` and saved diagnostics result JSON|start21:51:54; duration680.87s|
|Web|243/243,38 files,0|`m3-final-web-20261024-v1.log`|start20:45:56;19.74s|
|Contracts|28/28,7 files,0|`m3-final-contracts-20261024-v1.log`|start20:46:12;1.55s|
|Lint|PASS,0|`m3-final-lint-20261024-v1.log`|file completion20:46:33|
|Typecheck|PASS,0|`m3-final-typecheck-20261024-v1.log`|file completion20:46:55|
|Build|PASS,0|`m3-final-build-20261024-v1.log`|file completion20:47:34|
|Diff|PASS,0|new final-signoff diff log; prior diff evidence retained|this document-only closure|
|360 browser|PASS,0|`m12-real-92214e67-2246-42e4-a476-f5ccd18225e6/m21-report.json`|real Chrome/Vite/Fastify,3 Managers|
|768/1440 browser|PASS,0|`m12-real-4f0947b2-7914-4956-ad70-fc2eb3c93736/m21-report.json`|real Chrome/Vite/Fastify,5 Managers|

Browser original30000ms assertions retained;18 addon mutation requests total,
forbidden0, source inputs unchanged/ports released. Trace/screenshots remain
in the corresponding reports' run roots. This is not mocked-HTTP acceptance.
No unchanged tests/real Java starts are repeated for this document-only task.
Web's two jsdom navigation-not-implemented messages remain in the passing log.

Historical API2832 PASS/2 FAIL and capability-focused6 PASS logs are retained,
not arithmetically combined into v2. V2 is its own actual single execution.
The explicitly deferred LC2 native experiment files remain excluded and **not
PASS**: `whitelist-native.test.ts`, `whitelist-acl-session-native.test.ts`,
`whitelist-sibling-retention-native.test.ts`. This is the scoped project
regression, not a claim that those postponed experiments passed.

## Reassessment and remaining limits

Reassess the affected acceptance on NeoForge/Java/Log4j upgrades, changed trusted
closure or configuration, new DebugFile signatures, missing ERROR/FATAL causes,
missed fatal startup, sustained/recurrent lag, world-save/data failure, ownership/
stop/recovery regression or relevant production changes. Neither risk transfers
automatically to another OS/version/unverified instance. Online player
authentication, arbitrary mod compatibility and sustained load remain unverified
where noted; P7 STOPPED, EXE packaging and next stages are not started.

## Independent decision

Independent GPT-6.1 Sol High source/evidence audit (not writer self-signoff):

```text
P1 = 0
P2 = 0
P3 = 0
R1 = ACCEPT
R2 = ACCEPT
UNRESOLVED_REQUIRED_GATES = 4
REVISED_FINAL_GATE = BLOCKED
```

Final document delta verification is complete with the same structured decision.
The decision artifact is
`test-results/m3-revised-final-gate-20261025-v1.json`; candidate/evidence hashes,
test paths and working-tree snapshot are recorded there. User authorization
is not an automatic pass. No commit/push/PR/merge or branch reset is performed.
