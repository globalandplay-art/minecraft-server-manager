# M2.1 Forge real lifecycle blocker

## Current decision

**BLOCKED — M21-FORGE-COMMON-WATCHER-EXIT-001**.
Run `m2-loaders-real-3067ab7e-cff0-4b47-a92c-95680b0fed5c` remains an original
failed acceptance, exit1. Do not rerun it or rewrite its report as PASS.
No underlying artifact fix has been attempted (0); no timeout/assertion or
diagnostic classifier has been changed. Stop new Minecraft launches while the
captured isolated Forge process remains alive/unresolved.

The user's continuation instruction was interpreted and stated before execution
as approval of the previously proposed fresh UUID isolated Forge test. The
source Forge registration/world was not operated. Only validated startup files,
libraries and accepted EULA were copied into the fresh test runtime. A fresh
Vanilla peer was used for instance isolation, using its existing authorization.

## Observed facts

- Source preflight: Forge1.21.9 /59.0.5, 81 launcher/dependency files + EULA,
  exact SHA/Maven paths; no source world/config/player copying.
- Real Forge and Vanilla startup operations both `succeeded`. Each reached
  fresh Done, correct registered process/game/RCON ownership and real `list` /
  independent `seed` response. This is actual Minecraft, not a Fake runner.
- Forge restart requested a normal RCON `stop`. Its log confirms stopping,
  saving players/worlds/all dimensions and closing the RCON listener/client.
- The captured Forge JVM did not exit within the existing 60,000ms stop deadline.
  The restart operation became `interrupted`, public error `RECOVERY_REQUIRED`.
  The runtime deadline error in the corresponding source branch is
  `OPERATION_TIMEOUT`; the persisted public record does not preserve that inner
  error separately. Do not claim a missing inner stack was captured.

The runner's original surfaced assertion is preserved:

```text
ERR_ASSERTION: RECOVERY_REQUIRED
+ actual - expected
+ 'interrupted'
- 'succeeded'
```
- The restarted generation was never spawned. Vanilla was normally stopped in
  failure cleanup, exit0/null. All four test ports were released; source inputs
  unchanged; no crash report observed; Manager observers closed.
- The report correctly retains `businessResult=BLOCKED`,
  `strictDiagnostics=BLOCKED`, `finalStopped=false`, diagnostic owned-stdin-stop
  fallback and `cleanup=CLEANUP_BLOCKED`. Port release is not JVM exit.
- Confirmed lingering process: PID25020, creation identity and command line
  match the exact fresh `m2-a` root. Last explicit check found it still alive.
  No unknown process was terminated. Permission for ending only this captured
  test process was requested; until answered it is retained.

## Direct root-cause evidence

Private evidence root:
`.manager/m2-loaders-real-3067ab7e-cff0-4b47-a92c-95680b0fed5c/`.

1. `launch-2-stdout.log`: normal RCON stop, all dimensions saved and RCON closed.
2. Isolated Forge `logs/debug.log` line276 starts the COMMON config watcher;
   line285 attributes `forge-common.toml` change notifications to
   `pool-3-thread-1`.
3. The same debug log lines519–520 unload and stop only the SERVER watcher.
   There is no matching COMMON watcher stop.
4. `forge-thread-dump.log`, obtained using a read-only JDK `Thread.print -l`:

```text
"pool-3-thread-1" ... prio=5 ...
   java.lang.Thread.State: WAITING (parking)
   at java.util.concurrent.ScheduledThreadPoolExecutor$DelayedWorkQueue.take(...)
   at java.util.concurrent.ThreadPoolExecutor.getTask(...)
   at java.util.concurrent.ThreadPoolExecutor.runWorker(...)
"DestroyJavaVM" ...
```

The pool3 thread is **not daemon** (unlike neighbouring daemon-labelled
threads). Its creation timing matches the COMMON watcher. Actual installed
NightConfig3.7.4 `FileWatcher$FsWatcher.run` bytecode creates
`Executors.newScheduledThreadPool(1)` using the default non-daemon factory and
only shuts it down when the watcher exits. Actual Forge ConfigFileTypeHandler
has separate COMMON/SERVER/CLIENT watchers; ServerLifecycleHooks stops only
SERVER on dedicated-server shutdown.

This chain, confirmed independently against the fresh debug log and installed
classes, identifies the leaked COMMON watcher scheduler. It is not merely a
generic thread-name guess. `AsyncFileConfig$LazyExecutorHolder` was checked
separately and explicitly uses daemon threads, so it is not the identified leak.

Original `run.bat` → `win_args.txt` has the same actual JVM/shim arguments as
LT's launch; `user_jvm_args.txt` is comments. There is no missing-launch-argument
evidence and no evidence that LT failed to send stop.

## Classification and safe next step

**CONFIRMED: upstream Forge/NightConfig artifact shutdown behavior.**
LT's fail-closed timeout/recovery behavior is correct. This is a real lifecycle
blocker, independent of historical Perflib/OSHI/Unsafe diagnostics.

Independent GPT-6.1 Sol High analysis agrees with the direct evidence. The
[official NeoForge upstream issue1626](https://github.com/neoforged/NeoForge/issues/1626)
documents the same dependency mechanism; it is supporting evidence, not a
substitute for the actual installed-run proof.

[Forge's official promotion list](https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json)
at this investigation still lists 59.0.5 for Minecraft1.21.9. Do not assert that
an untested same-version update fixes it. A verified upstream-fixed artifact or
an explicitly reviewed shutdown integration is needed. No ad hoc Java agent,
patched dependency, arbitrary thread stop or new native framework was added.

Do not prepopulate config merely to avoid triggering the watcher, extend the
timeout, treat all-dimensions-saved as process exit, hide the failure, or force
kill to make restart pass. Forced cleanup, if separately authorized, must be
recorded separately and never turn this run into PASS.

NeoForge actual startup is also not certified: a test installation/launch
artifact is still needed. Its generic ServerStarterJar can run installers and
is not treated as an approved unattended execution path merely by vendor name.

## Focused safety regression

A new Fake integration test simulates the exact runtime stop timeout and checks
that no second start is attempted, new lifecycle admission is409, and same-key
replay returns the original interrupted operation without another send.
Initial test expected409 for the same key, but the actual existing idempotency
contract correctly returns202 with the **same interrupted ID**. Original
69PASS/1FAIL log is preserved as `test-results/m21-forge-stop-gate.log`; only this
new test was corrected to assert the exact202/id/state/error and unchanged
start/stop counts. No product behavior, historical assertion or time limit changed.

Final focused result: **70 PASS / 2 files, exit0**
(`test-results/m21-forge-stop-gate-v2.log`). Post-run typecheck, affected-file
lint and diff checks passed. The
existing affected134PASS/static evidence remains valid for unchanged production
code; it does not override this failed real-server run.

Independent final read-only delta/evidence Review: **P1/P2/P3=0** for the
acceptance extension, exact safety test and truthful blocker report. This is
not a signoff that the upstream shutdown leak is fixed. Supplementary process
observations are saved separately as `followup-process-observation.json`; the
original failed acceptance report is not modified.

## Follow-up: captured process cleanup and upstream source check

After the user's next-step authorization, cleanup was restricted to the captured
isolated test process PID25020. CIM command line, parent PID25268, executable and
creation time were matched to the persisted start-operation interval and exact
fresh test root; a process handle and its start time were checked before ending
that process. It exited with **-1**, not a normal Minecraft exit. The separate
`forced-cleanup-01.json` receipt records `FORCED_CAPTURED_TEST_PROCESS_EXIT` and
`exited=true`. A subsequent Java process query found no Java processes. No scene
or historical evidence was deleted.

This supersedes the earlier pending-cleanup observation only. The original
acceptance report remains unchanged: **BLOCKED, finalStopped=false** at its
original observation boundary. Forced cleanup does not establish restart or
normal-stop PASS.

Official Forge26.3/66.1.0 source archives were downloaded for static reading only
under ignored `.manager/m21-upstream-be52e322-bafb-4e3e-8413-8b2d9cde5b05`:

| Archive | SHA-256 |
| --- | --- |
| fmlcore sources | `4e6ced48f0b69125f9bcd0d3a71820e53302c6a07959050f7afc98cd8a7d2276` |
| forge sources | `218cf7adf555a1cf2cb050928660a344503e2da73c5755de9859d4da6fff4718` |
| fmlloader sources | `880acac849571ca9f3848a6ccdab64a4b57240afe853c1a9a12194590d99b581` |

In these sources, `ServerLifecycleHooks.java:101` still unloads SERVER only.
`ConfigTracker.java:63-71` has `forceUnload()` that also unloads COMMON, but no
caller of that method was found in these three source archives. Its comment at
line52 explicitly distinguishes the normal server unload from forceUnload.
The call-site inventory is saved separately as `watcher-call-sites.json`.
This is **not proof about every launch/bootstrap dependency**, nor proof that
the newer artifact reproduces or fixes the leak. No newer Forge server,
installer or source archive was executed; the original installation was not
upgraded. There is insufficient evidence to prescribe a version upgrade as a
fix. No product/test source changed and no tests or Minecraft launches were
repeated during this follow-up. Underlying artifact fix attempts remain **0**.

Next required input is a demonstrably fixed upstream shutdown path/artifact or
a reviewed, explicitly scoped shutdown integration decision. Do not continue
blind real-server retries, substitute force termination for normal stop, or
advance this incomplete M2.1 to M3.

## Follow-up correction: patch-source caller found; 26.3 candidate

The preceding source inventory covered `.java` entries only. Further inspection
also included `.java.patch` entries and found the missing dedicated-server
caller. That earlier limited search must not be interpreted as proof of no
fixed shutdown integration.

Direct comparison now shows:

- Installed59.0.5 `DedicatedServer.onServerExit()` bytecode ends after normal
  RCON/query/management cleanup without calling `forceUnload()`.
- Its `DedicatedServer.showGui()` instead calls
  `ConfigTracker.INSTANCE.forceUnload()`; LT's fixed `nogui` launch never calls
  showGui. This explains the otherwise surprising presence of the cleanup
  method without COMMON cleanup in the preserved run.
- Official26.3/66.1.0
  `patches/net/minecraft/server/dedicated/DedicatedServer.java.patch` places
  `ConfigTracker.forceUnload()` immediately after the management-server stop
  cleanup, at the exit-cleanup location. The extracted patch and old bytecode
  are preserved as `new-dedicated-server.java.patch` and
  `installed-dedicated-server-bytecode.log` in the upstream evidence directory.

Thus26.3/66.1.0 is a **source-supported repair candidate**, not an actually
verified runtime repair. No old artifact was patched and no GUI workaround,
forced-exit fallback or timeout change was introduced.

The launch binding now accepts the exact `26.3` version format alongside the
previous1.x format, still requiring matching server/universal Maven identity,
actual server metadata, Java requirement, SHA and all file/path checks.
Unverified26.4/27.1/pre-release formats remain rejected. The fixture supports
explicit version/Java values; new tests cover26.3, unknown releases and Java
metadata mismatch. This only permits artifact validation, not a lifecycle
certification for every Forge release.

Validation: **65PASS/3files**, API typecheck and affected-file lint exit0.
Independent GPT-6.1 Sol High delta/source-evidence review: **P1/P2/P3=0**;
reviewer confirmed the old showGui/new exit-cleanup difference. Logs are
`test-results/m21-release-format-{tests,typecheck,lint,build}.log`.

The official26.3/66.1.0 installer was downloaded and matched against the
official Maven SHA-1; a separate local SHA-256 receipt is saved as
`installer-source-receipt.json`. The embedded install profile reports26.3,
16libraries and5processors (including a client-only processor). The installer
was **not executed**, no server was installed/launched/upgraded and no EULA
was newly accepted. Initial checksum-fetch tooling received binary response
content and failed on `.Trim()`; explicitly decoding ASCII checksum bytes
resolved that tooling error without changing the downloaded artifact or
disabling certificate/checksum checks.

Next step: controlled fresh installation of this official candidate, exact
installed-artifact preflight, then isolated real normal stop/restart evidence.
Until then, the original run and M2.1 actual lifecycle status remain BLOCKED;
the underlying59.0.5 artifact repair count remains0, not a claimed repair.

## Repository state

Uncommitted M1.2 and M2.1 work is retained on
`codex/phase-4-players-properties` at base `0752380`. No commit/push/PR. No P7
or M3 development, no Windows/network/ACL changes, no source-server mutation,
no old CommandStore experiment or forced fixture deletion.
