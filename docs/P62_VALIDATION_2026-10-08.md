# P6.2 — owned process and registered volume measurements

Status: P6.2 PASS — ENGINEERING AND REAL HOST EVIDENCE REVIEW PASS.
The earlier NOT RUN checkpoint remains historical below. No Java launched in
the 06:10 blocked attempt because the host gate rejected before the runner.
The later ordinary host run below supplies actual Java resource evidence.
Phase 6 remains IN PROGRESS. No Phase 7, commit, push or PR.

## Implementation and boundaries

Windows CPU uses cumulative CPU time from the exact managed child, normalized
against all logical processors. The first observation is unavailable until a
second valid counter sample exists. RAM is resident working-set bytes, not JVM
heap. PID, executable, OS creation time and current child ownership are checked;
stopped/changed/unreadable processes return unavailable, never synthetic zeros.
The fixed read-only PowerShell helper accepts only a validated numeric PID,
with 2500 ms timeout and 4096-byte output limit. Unsupported platforms return
unavailable. API clients cannot select a PID, path or command.

Runtime reads use a per-child single flight and five-second monotonic cache.
Cached timestamps remain unchanged; new timestamps are recorded after the
counter read completes. Restart resets the baseline and child-bound cache.
Disk reports the registered root's volume, not world size; root identity is
verified before and after bigint statfs and unsafe values are rejected.
TPS/MSPT remain unavailable without a reliable server source.

## Verification

- Focused process/volume/runtime tests: 30 PASS.
- Workspace typecheck and lint: PASS.
- Windows process reader smoke: PASS for its own Node PID. This is explicitly
  not Minecraft acceptance and does not substitute for the real Java gate.
- Chrome Performance 360/768/1440: 3 PASS, exit0; evidence
  `test-results/p62-browser.log`. Existing NO_COLOR/FORCE_COLOR warnings retained.
- Independent GPT-6.1 Sol / High delta review: PASS, P1=0/P2=0/P3=0.
- New frozen full check: `test-results/p62-check-v1.log`, exit0:
  contracts6/API1064/Web134 = 1204 PASS; lint/typecheck/production build PASS.
  Diff check PASS before this evidence-only update; existing LF/CRLF warnings
  and 516.08 kB bundle warning retained. No source/test changes after the freeze.

## Allowance stop

The live five-hour window reported used97%, remaining3% after the completed
check. This execution stops at the user's requested threshold; no new tests,
implementation, review or real launch follows. The existing one-shot continuation
at 2026-10-08 06:05:24 Asia/Shanghai advances only one next slice and then stops;
it does not inherit the continuous-to-3% instruction. No Minecraft was started
in this slice, and the completed full-check/browser command sessions exited0.

## Issue ledger

P62-REVIEW-001 — MEDIUM / RESOLVED: initial runtime integration coverage was
missing. Added concurrent reads, cache expiry/timestamp preservation, stopped
process, restart baseline and pending-read shutdown rejection tests. Focused
30 PASS and independent delta close this review finding. No explicit error code.

P62-TIME-001 — LOW / RESOLVED: initial sample timestamp preceded the bounded OS
probe. Generate timestamp after reading and ownership validation. Independent
delta review closed the finding. No explicit error code.

P62-TOOL-001 — LOW / RESOLVED: an inline Node smoke invocation lost native-shell
quotes and returned SyntaxError / exit1 before the probe ran. A saved .mjs
smoke script passed. No product or diagnostic classifier change was made.

P62-REAL-001 — required gate / NOT RUN: no Minecraft instance has been started
in this slice. No original world has been accessed. Do not mark P6.2 final PASS.

## Exact next checkpoint

The frozen full-check exit and totals are confirmed. Next implement/review an opt-in
fresh UUID Vanilla resource acceptance using only the previously accepted
isolated JAR/EULA source. Verify fresh Done/RCON/world/ports and unchanged source;
measure real RAM, warm CPU baseline then bounded CPU, volume arithmetic;
verify stopped/restarted child isolation and normal explicit shutdown with
exit0/no signal. Preserve raw diagnostics, reject unknown ERROR/WARN, and retain
the report outside Git. No Windows repair or user-world access is authorized.
Only then close P6.2 and proceed to bounded P6.3 crash/log analysis.

## One-shot continuation — 06:10 host gate BLOCKED

Added `tests/acceptance/phase62-resources-real.mjs` and
`tests/acceptance/p62-real-resources-acceptance.ps1`, derived from the existing
P4.4 isolation/diagnostics/owned-child cleanup scaffolding. No product code or
existing test semantics changed. New scope is two explicit Vanilla launches,
real CPU/RAM and volume arithmetic, stopped resources unavailable, reconstructed
Manager history and new-child sample isolation. No configuration write transaction
or implicit restart is part of this acceptance.

Run: `p62-resources-c6154a9d-ea82-4efa-93fe-2d404fa4a4dc`.
Report: `.manager/p62-resources-c6154a9d-ea82-4efa-93fe-2d404fa4a4dc/acceptance-report.json`.
SHA256: `71D52FE9BA41E980CE3EEF0264955FBEC833C090A74B9BDC7F068301547BBC9A`.
Result/resources BLOCKED. CPU counter preflight PASS; registry lookup unavailable.
The runtime directory does not exist; no Java/Manager runner/operation was started,
no original world accessed. Report's minecraftStopped/managerStopped=false are
unestablished prelaunch fields, not proof of a surviving child. Do not change the
historical report or claim finalStopped=true when the report does not supply it.

Verification this continuation: JS syntax, PowerShell parser, lint and diff PASS;
shared acceptance diagnostic tests78 PASS. Missing opt-in/invalid UUID rejected
before instance creation. The Windows JSON-encoded path rejection proof PASS.
Independent Sol High startup safety Review PASS, P1=0/P2=0/P3=0. Previous1204 full
regression remains the unchanged product baseline; no claim of a new full run.
The named `import-diagnostics.test.mjs` initial invocation failed before testing
because that file does not exist; actual API diagnostic test files then78 PASS.

### Continuation issue ledger

P62-HARNESS-PATH-001 — MEDIUM / RESOLVED. Initial `JSON.stringify(payload)`
path assertion searched raw Windows backslashes and could miss serialized path
leakage. Attempt1 matches JSON-encoded paths case-insensitively; a positive leakage
proof and independent delta review close it. No explicit runtime error code;
this was a review finding. Only the new acceptance harness changed.

P62-HOST-001 — HIGH / BLOCKED (real acceptance gate), environment precondition.
Fix attempts0; one host invocation, no retry, no Windows/network/classifier repair.
Codes: `HOST_PRECONDITION_UNAVAILABLE`, `HOST_PERFLIB_UNAVAILABLE`; PowerShell
HResult=-2146233087, wrapper exit1. Exact diagnostic:

```text
Cannot find path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' because it does not exist.
BLOCKED (environment-unavailable/precondition-failure): HOST_PRECONDITION_UNAVAILABLE
```

Source: `p62-real-resources-acceptance.ps1`, Get-HostPreconditions line51:

```powershell
$counter = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' -Name Counter -ErrorAction Stop).Counter
```

This context cannot establish the registry prerequisite; it does not prove host
Windows is damaged. Next run the frozen wrapper in ordinary64-bit host PowerShell
with `-ConfirmIsolatedResources` and the known Node executable. If that still
blocks, preserve the new report and diagnose read-only; do not lower the gate.

The single continuation stops here. P6.3/Phase7 NOT STARTED; no commit/push/PR.
The COUNT=1 automation remains a single execution. An attempt to additionally
set its status PAUSED was rejected by automatic approval for lack of explicit
pause authorization; no workaround or successor schedule was created.

## Later ordinary host PASS — 2026-10-08 08:00

User ran the frozen wrapper in ordinary host PowerShell. New run:
`p62-resources-be2a99dc-294d-4acb-93df-da774276d3b1`.
Result/resources PASS, finalStopped=true, failures=[], sourceInputsUnchanged=true.
Report SHA256: `56CA82DE7A7CCF00B96269CBD208C08C94F169502D2563009E5E7D7596F024FD`.
Both report copies and launch log/stdout/stderr/manager-events remain private
under `.manager/<runId>/evidence`, excluded from Git.

Two explicit managed launches (PIDs32560/25304) reached fresh Done, RCON/list,
expected world and both ports. Each had no crash/premature shutdown and normal
explicit stop, exitCode0/exitSignal=null; output pipes closed. All finalState
fields true, no active operation, recoveryRequired=false, no emergency cleanup.
The exact recorded PIDs were absent and7161/7162 had no listeners on read-only
verification. Current source JAR/EULA/config hashes match recorded sourceHashes.
No original user world was accessed.

Actual sample: initial CPU unavailable/cpu-baseline-pending; later owned-process
CPU0.16016765820840198%, RSS780910592bytes, volume total214755700736bytes /
free18356162560bytes / used196399538176bytes. These are historical measurements,
not current host usage. TPS/MSPT remained unavailable. Restart produced a new
RAM timestamp and CPU baseline-pending; reconstructed history contained only
the new session sample. Stopped resources unavailable was asserted.

Raw JVM JNA native-access/JOML1.10.9 Unsafe warnings were retained and handled by
the existing Vanilla diagnostic rules; no classifier/timeout/assertion/product
changes were made for this run. Unknown ERROR/WARN still block.

Old host BLOCKED report remains unchanged (SHA71D52FE9...BBC9A). P62-HOST-001 is
superseded for the acceptance gate by this new host PASS, not rewritten as PASS.
Independent GPT-6.1 Sol / High final evidence review PASS, P1=0/P2=0/P3=0.
Report/evidence copies and captured streams agree. Together with unchanged
product1204 full regression,30 focused,3 browser and lint/typecheck/build/diff,
this closes P6.2 only. Phase6 Final Gate remains pending.
Do not advance to P6.3 or commit/push/PR automatically.
