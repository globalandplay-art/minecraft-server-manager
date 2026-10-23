# M3-E single bounded completion timing diagnostic — 2026-10-24

## Result and unchanged Gate

**DIAGNOSTIC COMPLETED; HISTORICAL FAILURE NOT REPRODUCED.**
One fresh instrumented browser run, no repeat:
`m12-real-1d913f05-d570-46ff-94ac-bb5cffe505e5`, exit0.
Original360/768/1440 sequence and30000ms completion assertions all passed.
The report explicitly sets `diagnosticOnly=true` and
`deliveryAcceptance=NOT_ELIGIBLE_TIMING_RUN`. It is not a new uninstrumented
delivery Gate and does not rewrite either historical BLOCKED run.

**M3-INSTALL-BROWSER-DEADLINE-001 remains HARD BLOCKER, repair count2.**
No third product repair was performed. No production source changed. This
sample cannot determine the missing historical768 failure timeline or prove
performance stability across host/load conditions. Do not rerun until green.

## Observation scope

Only two test files changed:

- `tests/fixtures/m12-manager.mjs`: opt-in `LT_M3_COMPLETION_TIMING` wraps the
  original operation-store save and the existing EventStream subscription.
  Original save/await/error and synchronous listener behavior are retained;
  the subscribe prototype is restored immediately after app construction.
  Bounded in-memory fixed events are written only during owned fixture close.
- `tests/acceptance/m21-neoforge-registration-browser.mjs`: opt-in passive
  request/response/finished callbacks for fixed endpoints; operation responses
  provide only validated ID/state. No extra HTTP request or UI fetch override.
  Assertion start/pass/fail is timestamped without changing its30000ms limit.
  Existing60000ms cleanup is unchanged. Failure tracing is retained before
  context close; that branch was **not exercised**, since this sample passed.

Observation caps:2000 events per collector,32 outstanding browser-body tasks,
64KiB operation-body parse cap with declared/actual-size checks. Endpoints are
the owned production app's contract/store-bounded operation/install responses;
the size check is not claimed as a generic streaming HTTP reader. No raw
headers, bodies, credentials, stack traces or private filesystem paths enter
the timing events. No operation retry or additional persistence is introduced.
Failure of a diagnostic file write does not block normal IPC shutdown.

Independent GPT-6.1 Sol High actual-delta review before execution found no
open P1/P2/P3 and approved this single diagnostic scope. This is not final M3
security/release signoff.

## Measured phase durations

All values below are milliseconds. Each difference uses exactly one process's
monotonic clock. Manager clocks are scoped by recorded PID/file; the harness
uses its own clock. No Manager-versus-browser timestamp subtraction is used.

| Phase | 360 | 768 | 1440 |
| --- | ---: | ---: | ---: |
| Manager: queued publication observed → terminal publication observed | 26696.935 | 26448.383 | 26762.888 |
| Manager: terminal save begin → original save resolved | 9.126 | 4.470 | 8.822 |
| Manager: save resolved → existing publication listener observed | 0.054 | 0.032 | 0.077 |
| Harness:202 accepted observed → first terminal body observed | 27520.636 | 26533.407 | 27458.055 |
| Harness:202 accepted observed → success visibly confirmed by assertion | 28193.184 | 27198.466 | 28186.103 |
| Harness: terminal body observed → assertion confirms success | 672.547 | 665.059 | 728.049 |
| Harness: final addons request observed → request finished observed | 28.477 | 29.432 | 28.006 |

`operation-emitted` is a listener observation after in-memory publication,
not the precise Map-write timestamp. Network events are callback observations,
not wire-arrival timestamps. Assertion confirmation includes Playwright's
visibility sampling; the665–728ms interval is **not actual React render time**.
Final addons timing is callback-observed HTTP completion, not server CPU time.
No claim about the exact save/publication/render delays of the old failed run
is made from these new measurements.

## Evidence integrity and safety

Run-root evidence under
`test-results/m12-real-1d913f05-d570-46ff-94ac-bb5cffe505e5/`:

- `m21-report.json`:3 widths PASS;3 accepted installs;7 normal Manager closes.
- `completion-timing-analysis.json`: per-operation, per-clock derivation.
- `manager-37772-timing.json`, `manager-31184-timing.json`,
  `manager-29896-timing.json`: the three installation-owning Manager clocks;
 7 Manager timing files are retained in total, including restart sessions.
- `neoforge-360-trace.zip`, `neoforge-768-trace.zip`,
  `neoforge-1440-trace.zip`: complete successful traces.
- Normal screenshots, private operation/journal/staging/protection evidence.

All collectors: no overflow/dropped events, no outstanding browser tasks at
save, no Manager timing-write failure. All7 recorded Manager PIDs were
independently confirmed absent after normal shutdown. `noMinecraftLaunch=true`,
`sourceInputsUnchanged=true`, `portsReleased=true`, forbidden addon mutations0.
No unknown process termination, force-cleaning, system/network/ACL or P7 change.
No real Minecraft mod-load acceptance is claimed.

241 product source files under API/Web/contracts matched before/after SHA256:
`test-results/m3-completion-source-before-20261024.json` and
`test-results/m3-completion-source-after-20261024.json`. Existing unrelated
uncommitted work remained. HEAD is
`2f084f37e8585a046d15e57896e22f0405a76ad1`, branch
`codex/phase-4-players-properties`; no commit/push/PR.

Syntax checks for both files, focused ESLint and `git diff --check` passed.
No product tests, full regression, typecheck or build were repeated: this
diagnostic did not change product sources. Earlier123 focused tests remain
historical evidence, not a new full-project PASS.

## Conclusion and next decision

**CONFIRMED FOR THIS SAMPLE:** all three unchanged assertions passed;
the installation's background execution span is roughly26.45–26.76s, while
terminal save and final inventory read are milliseconds. It does not support
a long terminal-save/publication stall as the dominant current cost.

**PROBABLE:** the30s completion budget has limited headroom for backend
validation plus polling/confirmation. No claim is made that host contention
caused the historical failure, nor that these observations fixed it.

**UNKNOWN:** the exact phase responsible for the historical768 miss, host/load
variance and stable worst-case latency. No independent new root cause has
been established; repair count is not reset.

Do not edit the frontend or add a third backend optimization on this evidence.
The next technical decision is whether a reviewed, different backend strategy
can satisfy the existing completion budget while preserving every physical,
durability and recovery check. Any further substantive repair requires an
explicit new decision beyond the two-attempt stop. Do not quietly relax30s,
remove final verification or convert this diagnostic PASS into delivery PASS.

No second diagnostic run is scheduled or executed. M3-E stays BLOCKED, whole-M3
advanced/final regression Gates remain pending, and P7 stays stopped.

Final independent GPT-6.1 Sol High evidence audit independently recalculated
the timing values from461 browser events and7 Manager records, verified all241
source fingerprints individually and confirmed normal Manager exits. No new
P1/P2/P3; conclusion remains historical failure NOT REPRODUCED, not resolved.
