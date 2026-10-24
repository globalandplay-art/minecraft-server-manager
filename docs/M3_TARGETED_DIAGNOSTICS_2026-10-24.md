> 2026-10-25 final-signoff update: user expressly accepted only R1/R2.
> Their bounded decisions are now ACCEPTED_RESIDUAL_RISK; the earlier pending
> language below is historical. A/C/D/E1 remain unapproved required categories.
> Original strict results stay BLOCKED; revised final Gate stays BLOCKED.
> See [authoritative final decision](./M3_FINAL_ACCEPTANCE_2026-10-25.md).

# M3 targeted DebugFile coverage and tick investigation

Scope: no feature work, no original seven-launch lifecycle rerun, no production
source/classifier/dependency/timeout change. P7 STOPPED; no Git upload.
User authorized targeted real testing in the standing isolated-instance scope.
Current M3 and original strict diagnostic Gate remain **BLOCKED**.

## Normal diagnostics and the preserved tooling failure

Run `m3-diagnostics-f7db7f09-4386-4143-b07b-01ebe6aeae5d` created a new isolated
NeoForge26.3.0.95 root, copied only the preflight's70 source files, reused accepted
test EULA and built a constructor-only fixed diagnostic probe against the verified
closure. It emits INFO/WARN/ERROR, a nested RuntimeException/IllegalStateException
chain, and DEBUG. No threads/network/world content/System.exit in the probe.

Five INFO/WARN/ERROR/chain sentinels are each present in stdout, latest.log,
debug.log and LT's runtime event stream; DEBUG is present in debug.log.
This fixed-path log coverage is **PASS**, independently reviewed by Sol High.
It does not prove arbitrary throwable/class-loader failures are lossless.

Normal Minecraft exited0/null after explicit stop. The subsequent offline
`jfr print` originally expanded1526 ThreadPark events beyond its16MiB output
buffer: `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. Original run/report remains
**BLOCKED/exit1**. No retry of that normal Minecraft start was needed.
Raw JFR549110 bytes and all logs survived; source inputs/ports/helpers verified.
The tool correction only narrows exported event types; buffer/timeout unchanged.

Independent offline supplement:
`test-results/m3-targeted-steady-supplement-20261024-v1.json`.
Raw recording SHA256:
`c5abe2ac5cb8680d8e9681b133d724b45e9f6554fc12891b372d2c346fd5e037`.

## Normal post-Done performance evidence

JFR default recording is bounded60s/64MiB; same-JDK hash-recorded jcmd targets
only the exact owned PID with executable/start identity checks before and after.
Each counter read rechecks the same child/PID/liveness after its await.
Sampling uses fixed monotonic5s slots and a60s admission deadline, then drains
bounded already-started tools. No tick-rate change, synthetic player load or
system modification. Profiling/commands impose observation cost.

- Done14:22:43Z; JFR summary start14:22:48Z for60s. Core events cover
 14:22:49.529Z–14:23:48.004Z (Asia/Shanghai is UTC+8).
- JFR attach14:22:46.049Z–14:22:50.424Z took4375ms. Early Done/first seconds
 are outside this recording and cannot be attributed from it.
-59 `minecraft.ServerTickTime` periodic average values:0.084272–0.494839ms;
 mean of those averages0.139146ms. These are NOT maximum individual tick time
 or an end-to-end TPS measurement. RCON `tick query` provides the saved rolling
 samples, not a guarantee of future performance.
-59 CPU-load samples; maximum normalized JVM fraction0.0058334292. Machine
 maximum is1.0 on the first baseline; subsequent maximum0.40865925. Do not
 quietly delete the first sample or call it a diagnosed fault.
-12 owned-process RAM samples750088192–758329344 bytes. No fabricated OSHI
 fallback is involved; these are the fixed LT Get-Process probe observations.
- Explicit save14:23:22.403Z–14:23:22.447Z took44ms, inside the actual JFR core
 event window. No lag warning occurred. No GC pause event was recorded; absence
 in the recording is not a universal assertion that no pause can occur.

This idle/save window did not reproduce historical warm-start lag. It is a
bounded diagnostic observation, not a load/performance certification.

## Fixed fatal mod-loading coverage

Run `m3-diagnostics-90cc81a6-690a-42e0-88f7-978a02f204e2` executes **fatal only**
in a separate fresh UUID root. No second normal lifecycle was executed here.
The probe constructor throws fixed `LT_M3_FATAL_SENTINEL` with nested
`LT_M3_FATAL_CAUSE`; it does not call halt/exit or manipulate files/threads.

Predeclared assertions all passed:
- Both sentinels in stdout, latest.log, debug.log, LT runtime logs and the FML
 crash report; no fallback weakening of the file requirement.
- No Done; autonomous nonzero exit1/null, not a diagnostic stop/kill.
- LT startup rejects with `RUNTIME_START_FAILED`; observed final status stopped,
 ownership none, recoveryRequired false. This tests runtime/event admission,
 not a new full frontend crash-analysis journey.
- `crash-2026-10-24_22.27.17-fml.txt` durably records both causes.
 stdout53/68 contain the causes,71 the construction failure,74 the saved path;
 crash text19/37/40 contains the outer/nested cause.
- finalStopped/helpersClosed/portsReleased/sourceInputsUnchanged true.

Fatal case **PASS/exit0** means the test correctly observed an expected failed
Minecraft start. Its strict Gate remains BLOCKED. It must not be combined with
the earlier normal tool failure into a fictitious two-case harness-wide PASS.
Sol High independently verified this fixed fatal path. The known native-probe
DEBUG events remain missing in the original run; this coverage does not repair
Log4j or certify every possible linkage/mod exception.

## Single warm-start extension

Historical five lag warnings occurred after existing-world startup. To fill
the demonstrated missing observation window, admit **one** warm startup of
only the normal fixture above, using separate `AUTHORIZED_ONE_WARM_WINDOW`.
No normal/fatal lifecycle loop or retry is allowed.

Before spawn: zero pre-existing Java, exact prior run/root/probe, all70 copied
source SHA values, exact one-probe mods directory, EULA, loopback and fixed
properties/ports are checked. Original secret/inode history was deliberately
not recorded; no historical comparison is claimed. Current production
registration/start and socket checks still bind the actual target identity.

Original latest/debug are preserved in the new manager evidence; the test world
is backed up before recording, with regular-file/no-link checks, per-file source
identity/SHA and destination readback, bounded2000 files/128MiB. Original JFR
and reports are not overwritten. World writes after the authorized warm start
are expected; no claim of byte-identical live worlds is made.

New run `m3-diagnostics-da56081e-1171-4043-9b5e-691e5e6b70a4`: **warm case PASS**,
exit0/null, finalStopped/helpersClosed/portsReleased/sourceInputsUnchanged true.
Recording starts soon after owned spawn rather than after Done, still60s/64MiB,
default settings. Actual JFR timestamps must prove coverage of Done plus the
next3s; attach delay/missing events/no reproduction will be reported as such.
The single attempt is not automatically extended or rerun.

Actual JFR core window14:37:09.312Z–14:38:09.121Z covers Done14:37:17Z and
the following3s. Summary duration60s, file2125522 bytes,64MiB bound unchanged.
There were53 periodic Tick averages, including4 zero bootstrap values without
sufficient completed-tick history, **not** proof of zero-cost ticks. The49
positive windows peak0.479178ms. No Can't-keep-up warning was observed.
The explicit save14:37:52.197Z–.234Z took37ms within recording;36 recorded
GC pause events peak15.130813ms. Averages/observed pauses do not certify every
individual tick, other loads or future performance. JFR attach itself perturbs
startup; this single-instance scene lacks the original live Vanilla peer.

World backup includes30 files/2228352 bytes. Original normal JFR SHA remains
unchanged. Pre-warm latest/debug are preserved separately in the warm manager
directory, with hashes in the v2 analysis supplement. The active runtime log
now belongs to the warm launch, not the original normal launch.
See `test-results/m3-targeted-warm-analysis-20261024-v2.json`.

Conclusion: **historical warm-start lag NOT REPRODUCED; root cause UNKNOWN**.
No automatic fourth Minecraft launch or performance waiver is authorized by
this test result. This is substantially narrower than proving that historical
warnings were harmless or caused by LT/Windows.

## Validation and independent review

New acceptance script: `tests/acceptance/m3-targeted-diagnostics.mjs`.
Syntax/eslint/diff checks pass; no product source changed, so the applicable
2834 API,243 Web,28 Contracts and final static/build evidence is reused.
The three deferred LC2 native experiments remain excluded and not PASS.

Independent Sol High pre-run review closed three initial harness P2s (post-await
process identity, monotonic sampling schedule, failure-safe evidence/cleanup).
Warm delta closed one reused-fixture admission P2 (full closure/mods/props).
Current reviewed harness P1/P2/P3=0. Independent Sol High evidence review
confirmed normal fixed log coverage, fatal constructor/crash coverage and the
single warm observation. A full-array recount confirmed4 zero/49 positive
averages; an earlier partial3/50 suggestion was explicitly withdrawn.
Evidence review P1/P2/P3=0; it does not approve a risk waiver.

### 2026-10-25 independent non-Minecraft control

`tests/acceptance/m3-log4j-control.mjs` uses original FML XML bytes, verified
Java/CP and a fresh diagnostic cwd. It changes no Minecraft launch configuration,
dependency or source. This runs a fixed standalone Java main, not Minecraft.

First run `m3-log4j-control-d7f7bb44-99bb-452f-ad89-390b491c658e` remains
**BLOCKED**: Windows `C:/...` config location was parsed as an unknown `c` URL
protocol; no latest.log was produced, ENOENT. Java exit0 is not a diagnostic
PASS. Original stdout/stderr/report are retained. The single fixture correction
uses `pathToFileURL(...).href`; XML bytes, runtime15s/1MiB and dependencies stay
unchanged. This is a diagnostic fixture correction, not a product repair.

Second run `m3-log4j-control-6b0b12fc-ba47-4d85-a98d-f67e69b9a86a` **PASS/exit0**:
- Original6096-byte FML XML SHA256
 `b21e48eed0bb227cbace66925105d9879c62b325927945662e54cf86e9ccf2b0`;
 original verified manifest `2ff02ee70cf1ef52a1e2d2d84abc59210c097df15e1b58321025e0689d35d7b6`.
- Native availability is false,false. stderr2/48 contain exactly two DebugFile
 failures; kqueue/epoll class names, platform restrictions and
 ThrowableExtendedStackTraceRenderer/LoaderUtil chain all match.
- The original native availability DEBUG events are absent in debug.log.
 Subsequent six fixed ERROR/FATAL message/cause markers are each present in
 stdout/latest/debug; subsequent ordinary DEBUG also appears. No additional
 ERROR/FATAL signature was accepted.
- Source inputs unchanged. No Minecraft main/world/port was operated.

Independent Sol High source/evidence review **P1/P2/P3=0** after closing the
asynchronous ZIP-error reporting P3. Reviewer independently checked XML/source
SHA, precise exception chains and subsequent marker destinations.

**Confirmed:** LT/Manager is not a necessary trigger for this precise artifact
interaction. This supports UPSTREAM DEFECT attribution for that interaction,
not all possible log problems. It does not repair the lost DEBUG events or
prove arbitrary future errors lossless. Standalone FATAL-level output followed
by exit0 must not substitute for the separate real FML crash/exit1 test.
No additional Minecraft or standalone repetition is planned.

## Bounded disposition submitted for decision — not active

**B:** technical investigation and fixed-path coverage are complete. A possible
M3-only risk acceptance can cover the two exact unsupported native-transport
availability DEBUG events in this hash-bound Windows/Java25/NeoForge26.3.0.95/
FML12.0.12/Log4j2.26.0/Netty4.2.16.Final fixture scope. It must explicitly accept
those lost events while retaining raw stderr and the demonstrated subsequent
ordinary/error/fatal/crash evidence. It must NOT cover any other appender,
class/linkage/native error, absent required logs or failed lifecycle state.
Recheck after artifact/JDK/logging configuration changes. No core JAR or
configuration is changed as a workaround. Approval remains PENDING.

**E2:** bounded fresh and warm measurements completed without reproducing lag;
historical cause remains UNKNOWN. An owner could decide whether to accept only
the five preserved startup warnings as a historical limitation of this local
M3 functional milestone, excluding sustained-performance certification. This
is not evidence that Windows or LT caused them, not a future warning filter,
and not a proposed increase of a timeout. New/longer/repeated lag, failed saves,
crash, failed stop or new missing evidence continues to block. Any artifact,
host or workload change requires re-evaluation. Approval remains PENDING.

The earlier A/C/D/E1 proposals in the final diagnostics report also remain
unapproved; this work does not silently accept them. The original strict runs
remain BLOCKED. **M3 FINAL PASS is not declared.**

Final independent Sol High report delta review: **P1/P2/P3=0**. It confirms
these bounded conclusions and explicitly leaves risk acceptance/final release
to the user. No Java remains in the final read-only process inventory; all33
frozen candidate files and original NeoForge report/14 streams remain unchanged.
Evidence index: `test-results/m3-targeted-summary-20261025-v1.json`;
integrity/cleanup records use the corresponding `m3-targeted-*20261025-v1.json`
names. Final diff check exits0. No commit/push/PR/merge.

Raw JFR stays in ignored isolated diagnostic storage; do not publish it as a
generic attachment: JDK default recordings can contain environment/process
metadata. Only selected, scoped diagnostic summaries belong in delivery docs.

No risk acceptance or strict classifier rule is active. M3 FINAL PASS requires
the final standard and explicit outstanding risk decisions to be satisfied.
