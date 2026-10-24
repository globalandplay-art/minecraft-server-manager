> 2026-10-25 final-signoff update: user expressly accepted only R1/R2.
> Their bounded decisions are now ACCEPTED_RESIDUAL_RISK; the earlier pending
> language below is historical. A/C/D/E1 remain unapproved required categories.
> Original strict results stay BLOCKED; revised final Gate stays BLOCKED.
> See [authoritative final decision](./M3_FINAL_ACCEPTANCE_2026-10-25.md).

# M3 final diagnostics — 2026-10-24

## 2026-10-25 targeted follow-up (supersedes earlier evidence gaps below)

See [targeted diagnostics](./M3_TARGETED_DIAGNOSTICS_2026-10-24.md).
Fixed normal logging and real fatal mod-constructor/crash paths are verified.
A non-Minecraft standalone control independently reproduces the exact native
availability/DebugFile interaction with the original artifact/configuration;
Manager is not a necessary trigger. This narrows B's attribution to an
UPSTREAM DEFECT for that precise interaction; the known event loss remains.
Subsequent fixed ERROR/FATAL chains are readable, not arbitrary-error completeness.
The single warm early-JFR observation covers Done+3s without reproducing lag;
historical E2 root remains UNKNOWN. Periodic averages are not worst single ticks.
Independent Sol High targeted source/evidence review P1/P2/P3=0.
No product/dep/classifier changes, no seven-start repetition. Risk proposals
remain NOT ACTIVE/PENDING USER APPROVAL. Original strict and M3 Gates BLOCKED.
Earlier descriptions of missing control/fatal/early-window evidence below are
historical checkpoints, not the current follow-up conclusion.

Original strict Gate: **BLOCKED**. Whole M3: **BLOCKED**.
Suggested adjusted Gate: **PENDING USER APPROVAL**, not implemented or applied.
There is presently insufficient evidence to recommend unconditional final release.

## Candidate and preserved evidence

Branch `codex/phase-4-players-properties`, HEAD
`d8bb9b4b9dd27d5dd864beae7793c9bc1f4762a7`. Existing uncommitted M3 work
is retained. This investigation changes documentation/evidence only: no new
production, harness, classifier, dependency, JVM, network or system changes.
The original33-file frozen manifest and subsequent capability-test-only hash
were checked before the single newly authorized API regression.

Evidence shorthand R means
`.manager/m2-loaders-real-1afb966b-8a8a-4bc3-8343-ff5b12de9f9d/`.
R has launch logs directly in its root, **not** an `evidence/` child.
`test-results/m3-final-diagnostic-events-20261024-v1.json` records exact
line-numbered diagnostic/timing events and original report/stream SHA256.
Raw logs and original BLOCKED report are unchanged.

R/acceptance-report.json proves business/modLifecycle PASS, six expected
load/omission scenes, seven normal tracked Java exits0/null, no crash report,
finalStopped/helpersClosed/portsReleased/sourceInputsUnchanged true.
Its strict result remains BLOCKED:19 ERROR lines,51 Minecraft WARN lines,
six unclassified terminal warnings; no capture overflow or premature exit.
These counts describe this run, not a proposed allowance quota.
The report also retains20 `fatalRuntimeDiagnostics` string matches. Their
saved index (`test-results/m3-final-fatal-diagnostic-index-20261024-v1.json`)
contains the Perflib ERROR/WARN/Win32Exception and registry stack signatures,
not20 proven process crashes. This heuristic remains unchanged and blocking;
do not erase its entries or infer fatal lifecycle exits from the field name.

## A — Windows Perflib / OSHI

Classification: **ENVIRONMENT LIMITATION** for the observed Windows-counter
read failure. Exact host configuration cause remains unknown; not proof of a
corrupt registry, nor permission to repair it. Associated Minecraft null-process
SystemReport handling is a third-party degradation, not an LT exception.

- First peer occurrence: R/launch-1-stdout.log:42,16:40:00, ServerMain/ERROR;
  warning at65, Done at79,16:40:08, stop at249,16:45:36.
- Neo occurrence: R/launch-2-stdout.log:28,16:40:17, main,
  `os.dr.wi.re.HkeyPerformanceDataUtil/`: `Unable to locate English counter
  names in registry Perflib 009. Counters may need to be rebuilt:`.
- Stack29–49: JNA5.17.0 `Advapi32Util.registryGetStringArray` →
  OSHI6.9.0 `mapCounterIndicesFromRegistry` → process map/current process →
  Minecraft `SystemReport.putSoftware` → `CrashReport.preload`.
  `CrashReport.preload` is initialization, not evidence of a generated crash.
- Line50: `os.ut.pl.wi.PerfCounterQuery/`, `Error 0x80070057`.
  Lines51/66/81: `minecraft/SystemReport` fails Process Loads, Virtual Size,
  Resident Size; following stack contains null OSProcess dereference.
- Seven ERROR/seven counter WARN and18 SystemReport WARN across the run.
  The six Neo launches consistently show the three null-process failures.

LT process ownership does not depend on these Java logs. See
`apps/api/src/infra/runtime/local-runtime.ts:245` (owned child/generation),
`:644` (owned socket/PID validation), and
`apps/api/src/infra/runtime/process-resources.ts:10` (fixed Get-Process probe,
CPU TotalProcessorTime, RAM WorkingSet64, executable and start identity).
Sampler lines38–59 rejects identity/probe failure with unavailable/null;
it does not substitute zero or trust OSHI values. Counter collection does not
grant ownership or determine successful stop. Normal owned exits and RCON/seed
proof establish those M3 functions for this run independently.

Dashboard real CPU/RAM acceptance: **NOT VERIFIED BY THIS RUN**. Existing
sampler unit tests cover failure/PID-reuse behavior; they cannot certify the
current host's live metrics. No safe proven in-scope fix exists without touching
third-party startup behavior or the host; no such change was attempted.

Primary source: [OSHI6.9.0 registry reader](https://github.com/oshi/oshi/blob/oshi-parent-6.9.0/oshi-core/src/main/java/oshi/driver/windows/registry/HkeyPerformanceDataUtil.java).
It explicitly reads Perflib009. Source fallback capability is not evidence that
Minecraft obtained valid process counters here.

## B — NeoForge DebugFile / Log4j

Classification: **UNRESOLVED** for complete causal attribution; strongly
supported upstream-defect mechanism with actual logging degradation. There is
no local Manager-independent control run proving the complete attribution.
This is not merely a cosmetic Windows message or an observed LT exception.

R/launch-2-stderr.log:11–60 and62–111 show two16:40:24 Server-thread ERRORs:
`An exception occurred processing Appender DebugFile` →
`AppenderLoggingException` → `NoClassDefFoundError` for
`io.netty.channel.kqueue.Native` / `io.netty.channel.epoll.Native`.
Platform initialization causes report OSX/BSD-only / Linux-only native support.
This precedes fresh Done at launch-2-stdout114,16:40:26. It repeats twice in
each of six Neo starts:12 appender failures. Java25, NeoForge26.3.0.95,
FML12.0.12, Log4j2.26.0, Netty4.2.16.Final are the observed artifact combination.

Official correspondences:
[NeoForge issue3224](https://github.com/neoforged/NeoForge/issues/3224),
[Log4j issue4028](https://github.com/apache/logging-log4j2/issues/4028),
[Log4j change4049](https://github.com/apache/logging-log4j2/pull/4049).
These support the mechanism, not permission to replace a trusted JAR or assume
a newer version is compatible. Local configuration and bytecode/source review
must determine the exact local behavior; issue similarity alone is insufficient.

The independent investigation found FML12.0.12 JAR's log4j2.xml:49/71/75 with
Root=all, DebugFile=debug and %xEx;
Netty's trace-enabled branch attaches the unsupported-native cause to a DEBUG
event. Extended stack rendering attempts initializing class loads; LinkageError
escapes Exception-only handling and the appender rejects the event.

**Real loss:** the KQueue/Epoll availability DEBUG events are not fully written
to debug.log. INFO-filtered stdout/latest.log are not alternate copies of that
DEBUG event. Their successful later output cannot prove losslessness.
All six retained debug logs (debug.log and debug-1 through debug-5.log.gz)
lack those two availability events while recording later Done and stop.
Final debug.log:292–296 transitions from Starting/DualStack into NIO; final
launch-7-stderr:11–60/62–111 captures the two failed appender calls.
There is no evidence proving these are the only potentially lost events.
Other startup, Done, world-save/stop and RCON evidence survives; stderr captures
the appender failure. No deliberate crashing-mod test was run in this turn.
Crash-handler behavior under an arbitrary future fatal mod failure remains
NOT VERIFIED; this error path can impair extended throwable diagnostics.

Therefore a general DebugFile allowance is not justified. A narrowly scoped
acceptance of these two optional-transport probes could be considered only if
the owner accepts their specific missing DEBUG events AND adequate fatal-mod
diagnosis is separately demonstrated. That condition is currently unfulfilled.
No trusted dependency/configuration was modified; no seven-start rerun occurred.

## C — Minecraft services discovery

Classification: **ENVIRONMENT LIMITATION** for the captured TLS-handshake
read timeout; exact proxy/remote-path cause **UNRESOLVED**.

R/launch-1-stdout.log:85–121,16:40:09, Minecraft Services Discovery/WARN:
`Failed to connect`; exact URL
`https://discovery.minecraftservices.com/minecraft/client`.
`MinecraftClientException` → `SocketTimeoutException: Read timed out` →
`SSLSocketImpl.readHandshakeRecord/startHandshake` → HttpsClient.afterConnect.
Line122: AUTHENTICATION/getPublicKeys discovery unavailable.
This specific attempt reached TLS handshake reading. It does not prove DNS
failure, certificate rejection, a particular proxy product or HTTP endpoint bug.
The report contains18 blocking discovery-warning entries across the run:
12 NeoForge and6 Vanilla peer. Raw repeated lines are counted separately. Peer retries
occur during its longer lifetime, so these must not be collapsed into one event.

The services query is Java authlib's asynchronous retry path, not LT network
configuration. It did not prevent the proven M3 local install/lifecycle/RCON
scenes or normal shutdown. Real online account authentication/player join:
**NOT VERIFIED**; unavailable public-key endpoints may affect it. RCON is no
substitute. No new host network probe is needed to classify the preserved stack;
current connectivity would not retroactively diagnose that failure.

Potential scoped acceptance would explicitly exclude online login/secure-chat
acceptance and require a later real authorized-player login test after network
health is restored. It cannot label authentication healthy or suppress other
TLS/certificate/connection failures.

## D — Missing controlled marker

Classification: **CONTROLLED TEST ARTIFACT**, bounded to this annotation-only
marker and these omission phases; not a general missing-mod allowance.

R/launch-3/5/7-stdout.log:98–100:
`ne.ne.ne.co.CommonHooks/WP`, main/WARN,
`The following mods have version differences that were not resolved:` followed
by exactly `lt_m3_marker (version 1.0.0 -> MISSING)` and its advisory line.
Times16:41:01 /16:42:20 /16:45:01; before their respective Done lines112.
These correspond exactly to disabled / trashed-enabled / restored-disabled.
Installed/enabled/restored-enabled launches2/4/6 contain the marker output and
do not contain that missing-marker block. No extra missing mod was identified.

`tests/acceptance/m3-build-marker-mod.mjs` builds a constructor-only annotation
class that prints a unique marker; it registers no blocks/items/world content.
Source SHA3637ae6ad87050e10a9e34334055da1bd06c12044030046b849f00fce4d46f0d;
JAR SHAbde3a89855657e7e71c0ca950b57adcf54e4d997c96466b794c8c0ee69e4842f.
Harness verifies seed111111, expected loaded/omitted state, other-instance
isolation, world level.dat existence and normal dimension saving/shutdown.
This proves bounded test-world continuity, **not exhaustive region/player/NBT
integrity**. No second independent rerun was performed; six scenes already
give repeated state-transition observations. Arbitrary mod world removal stays
outside this proposed artifact exception.

## E1 — no-TTY

Classification: **ENVIRONMENT LIMITATION** for missing advanced terminal support.
R/launch-2-stderr.log:1 at08:40:15Z (=16:40:15 Asia/Shanghai), main/WARN:
`Advanced terminal features are not available in this environment`.
Exactly six Neo starts show it before Done. Harness uses owned pipe stdio,
not an interactive console. Captured output and RCON list/seed/explicit stop
work in these scenes. Interactive editing/terminal features were not tested.
Do not extrapolate RCON evidence to arbitrary stdin/interactive-console tests.
No generic terminal-warning rule is proposed.

## E2 — Can't keep up

Classification: **UNRESOLVED** root cause; real tick lag was reported.
`minecraft/MinecraftServer`, Server thread/WARN, stdout182 in launches3–7:

| Launch | Time | Done time | Behind | Ticks |
|---|---|---|---|---|
|3|16:41:06|16:41:03|2115ms|42|
|4|16:41:45|16:41:42|2172ms|43|
|5|16:42:25|16:42:22|2019ms|40|
|6|16:43:12|16:43:10|2002ms|40|
|7|16:45:06|16:45:03|2109ms|42|

They occur shortly after startup and after initial saving, before explicit stop.
The logs do not contain trustworthy concurrent CPU/disk/MSPT profiles that can
attribute the lag to the host, save operation, authlib or LT. No sustained TPS
acceptance follows from such short scenes. World-save/normal-stop evidence
does not prove performance harmlessness. No product performance fix is justified
without attribution; no broad WARN exception is recommended.

## Proposed risk decisions — NOT ACTIVE

All proposals apply only to the exact recorded Java25/loader/artifact identities,
fresh local M3 fixture scope and complete health evidence. Require fresh Done,
owned live process, expected marker/seed/world, RCON/ports, no crash/premature
shutdown, normal explicit exit0/null, immutable source inputs and closed helpers.
Never match on severity or substring alone; preserve full raw logs.

|Item|Possible bounded acceptance|Danger signals still blocking|Unverified scope / expiry|
|---|---|---|---|
|A|Exact OSHI6.9.0 Perflib009 ERROR + fixed0x80070057 WARN and directly associated SystemReport null-process blocks before Done|Other ERRORs, identity/probe failure, fabricated metrics, any crash or failed stop|Live LT monitoring excluded; recheck after OS/OSHI/JVM/loader change|
|B|No current release recommendation; optional probe-event loss requires explicit owner decision and additional fatal-mod evidence|Any other appender/native/class error, absent required logs, unobservable failure cause|Fatal mod diagnostic completeness unverified; recheck with reviewed upstream solution|
|C|Exact discovery URL + captured TLS-handshake timeout and associated fixed endpoint-unavailable chain only|Unknown URL/cause, certificate errors, actual join/auth failures presented as PASS|Online auth excluded; expires on networking/authlib change; actual login verification required|
|D|Exact CommonHooks three-line block naming ONLY this hash-bound marker in launches3/5/7|Other missing mods/registry/data-remap warnings, unexpected stage/member/hash, world failures|Only annotation fixture; no arbitrary user-world applicability|
|E1|Exact startup no-advanced-terminal message in this pipe-stdio fixture|Input/output/stop failure or different terminal error|Interactive Console excluded; recheck on launcher/terminal change|
|E2|No automatic acceptance proposed|Repeated/longer lag, save or stop errors, absent metrics|Performance cause and steady-state behavior unverified|

No classifier implementation, retrospective PASS, risk approval or global
timeout change is part of this report. B and E2 remain evidence limitations
preventing an assertion that all remaining issues are harmless/non-core.

## Validation and review

Historical API v1:2832 PASS /2 FAIL, exit1, unchanged original log.
Test-only capability correction:6 PASS, exit0, independently reviewed valid.
New authorized API v2: **2834 PASS /0 FAIL**,157/157 files, exit0,
duration680.87s, start21:51:54 Asia/Shanghai; output
`test-results/m3-final-api-20261024-v2.log`. Three deferred files excluded:
`whitelist-native.test.ts`, `whitelist-acl-session-native.test.ts`,
`whitelist-sibling-retention-native.test.ts`. They remain DEFERRED, not PASS.
No old LC2 native experiment was run.

Same unchanged product candidate: Web243 PASS, Contracts28 PASS,
lint/typecheck/build/diff PASS from final-v1 logs. They are reused, not rerun or
added to API counts. Browser360/768/1440 PASS with unchanged30000ms assertions
and actual independent Manager worker rebuild; real MC report replay is only
same-process app/adapter/JsonStore reconstruction.

Forge historical six lifecycle scenes passed with seven normal exits, but its
original run retained a startup-recovery timeout; do not silently relabel that
old overall report. Subsequent current startup/browser proofs are separate.
NeoForge six real scenes/normal exits are independently verified above.

Independent GPT-6.1 Sol High diagnostics report review: **P1/P2/P3=0** after
closing one nonblocking P3 count-attribution correction (discovery18=Neo12+
Vanilla6). Reviewer independently checked raw logs, all six debug logs and
relevant upstream/local artifact configuration. Review agrees that B cannot
be waived based on Done or issue similarity and that E2 remains unresolved.
Final regression/integration review completed independently: **P1/P2/P3=0**.
Reviewer verified API v2, reused Web/contracts/static/build evidence, frozen
candidate, original evidence hashes and browser/real-business boundaries.
Review explicitly supports neither conditional nor unconditional Final release
at present: B's diagnostic coverage and E2's performance attribution remain
insufficient. This finding is not a newly discovered product-source defect,
nor permission to treat the risks as accepted. Post-test owned Java/test process
count is0 (`m3-final-diagnostics-cleanup-20261024-v1.json`); final diff exit0.
Previous source
P1/P2/P3=0 and this report review do not approve any risk acceptance.

Post-investigation integrity check: original report and14 stream hashes
unchanged; all33 frozen code/test candidate hashes match; zero product or
classifier changes in this turn. See
`test-results/m3-final-diagnostics-integrity-20261024-v1.json`.

Release decision: **M3 BLOCKED**. No commit/push/PR/merge. P7 STOPPED.
