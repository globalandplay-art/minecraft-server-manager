# Current technical approval — 2026-10-25

The user's subsequent final-disposition instruction explicitly conveys formal
technical-owner approval of A/C/D/E1 within the exact bounded proposals below.
These technical approvals are distinct from earlier direct user R1/R2 approval.
They are not repairs or global waivers. The proposal-time pending statements
below are historical; original strict Gate remains BLOCKED. Current final
independent signoff is recorded in M3_FINAL_ACCEPTANCE_2026-10-25.md.

# Historical M3 remaining diagnostics — proposed bounded dispositions

Status: PROPOSAL ONLY; no new user waiver is active. R1/R2 remain accepted.
Original strictDiagnostics=BLOCKED; revised final Gate=BLOCKED.
Candidate: branch `codex/phase-4-players-properties`, HEAD
`9f7cf498940b8e8c357b44ba1da8d201751463e4`; clean working tree at review start.
This task changes documentation only. No Minecraft/network/test execution,
classifier change, global allowlist, merge or next-stage work is authorized here.

## Evidence and common health conditions

Raw root R: `.manager/m2-loaders-real-1afb966b-8a8a-4bc3-8343-ff5b12de9f9d/`.
`acceptance-report.json` SHA256:
`9ff761fb8f9927ee48ec0d7c1bd217db4bf82bc85d643ab90d56e17e76495ab4`.
Report readback: businessResult/modLifecycle PASS, strictDiagnostics/result
BLOCKED, noCrashReport/finalStopped/helpersClosed/portsReleased/sourceInputsUnchanged
true, sourceWorldAccessed false. Seven owned children exited normally 0/null;
six target marker load/omission states remain individually evidenced.
Manager replay in this raw report is same-process reconstruction, not an OS restart.
Independent process-session browser evidence remains separately attributed in
[final acceptance](./M3_FINAL_ACCEPTANCE_2026-10-25.md).

Any proposed disposition below requires the complete existing health evidence:
fresh Done, owned process/generation, RCON/list/expected world, game/RCON ports,
no crash or premature exit, explicit normal save/stop, exit0/null, released ports,
closed helpers, unchanged original sources. Missing/unknown health is not PASS.
These are retrospective decisions for preserved evidence, not runtime suppression.

## A — Perflib/OSHI: 32 entries

Exact scope: seven `HkeyPerformanceDataUtil` ERRORs reading English Perflib009,
seven `PerfCounterQuery` WARNs with `0x80070057`, eighteen associated
`minecraft/SystemReport` WARNs for Process Loads/Virtual Size/Resident Size with
the captured null OSProcess cause. R/launch-2-stdout.log:28–96; peer launch1:42–65.
Chain: JNA5.17.0 registryGetStringArray -> OSHI6.9.0 registry counter map/current
process -> Minecraft SystemReport -> CrashReport.preload. This is diagnostic
preloading, not proof of an actual crash. Host registry/environment root UNKNOWN.

Observed impact: Java system-report process telemetry degraded. Owned lifecycle,
RCON and worlds still verified. LT's `process-resources.ts` uses a distinct
Get-Process identity-bound probe; failure returns unavailable/null, never zero.
This source distinction does not prove live LT monitoring works on this host.

Repair: no demonstrated LT M3 defect requires a code change. Actual host-counter
repair remains separate environmental work; do not edit registry/counters now.
Eligible proposal: accept only these linked startup diagnostic failures for the
verified local M3 lifecycle scope, with telemetry limitation disclosed.
Not verified: real LT CPU/RAM accuracy, complete Java process metadata/crash-report
enrichment, host counter health. No unrelated NPE/ERROR or monitoring PASS waiver.
Reopen if identity/stop fails, metadata becomes required for a diagnosis, counters
affect business behavior, or Windows/JDK/OSHI/JNA/artifact changes.
USER DECISION REQUIRED: approve/reject bounded A disposition; not approved here.

## C — Minecraft discovery: 18 entries

Exact scope: 12 Neo classifier entries plus six Vanilla-peer classifier entries.
These counts are distinct full-line strings within each classifier invocation,
not raw occurrences: `import-diagnostics.mjs:14–21` groups identical lines and
retains their source/line occurrences. Never delete repeated raw evidence or
interpret the eighteen entries as eighteen independent connections.
Raw stdout contains 41 C WARN occurrences: 30 Neo (five per launch2–7) and
11 Vanilla peer. All remain preserved. Earlier narrative saying raw repeated
lines were counted separately is superseded by this accounting correction;
the original report/classifier outputs are unchanged. The four-category total
59 is classifier entries, not raw log occurrence count or independent failures.
R/launch-1-stdout.log:85–122 and later
retries; launch2:135–184. Thread `Minecraft Services Discovery`, components
`mojang/RetryableFetch` and `MinecraftServicesDiscoveryService`.
Endpoint `https://discovery.minecraftservices.com/minecraft/client`;
MinecraftClientException -> SocketTimeoutException Read timed out ->
SSLSocketImpl.readHandshakeRecord/startHandshake. Associated
AUTHENTICATION/getPublicKeys unavailability belongs to this precise chain.
Peer Done16:40:08 precedes first warning16:40:09; target launches also reach Done.

Observed impact: authlib asynchronous service discovery/public-key availability
fails. M3 local operations and normal stop succeed; online account login and
secure-chat/public-key behavior are NOT VERIFIED. Not harmless for all gameplay.
Underlying network/proxy/remote-path cause UNKNOWN; TLS read evidence does not
establish DNS failure, HTTP endpoint defect or particular proxy software.

Repair: network prerequisite investigation is necessary before claiming online
authentication acceptance, not an evidenced LT mod-transaction repair. No network
changes or insecure authentication workaround is proposed.
Eligible proposal: accept this exact chain for local M3 artifact/lifecycle only,
explicitly excluding online play/login/security certification. If online-player
authentication is mandatory to the intended delivery, reject this scope reduction
and retain C BLOCKED until healthy-network real-player verification.
Unknown URLs, certificate failures, missed auth errors, changed authlib/network
behavior, and any actual business/stop failure are excluded. Recheck on those
changes and require real authorized-player login before online acceptance.
USER DECISION REQUIRED: approve/reject local-only C scope; not approved here.

## D — controlled marker missing: three entries

R/launch-3/5/7-stdout.log:98–100, main/WARN `ne.ne.ne.co.CommonHooks/WP`:
`The following mods have version differences that were not resolved:`
followed only by `lt_m3_marker (version 1.0.0 -> MISSING)` and
`Things may not work well.` Times16:41:01/16:42:20/16:45:01, before Done.
Exactly disabled/trashed/restored-disabled phases; enabled phases2/4/6 load it.
`m3-build-marker-mod.mjs` creates an annotation constructor emitting a marker,
without registering blocks/items/world content. JAR SHA256:
`bde3a89855657e7e71c0ca950b57adcf54e4d997c96466b794c8c0ee69e4842f`.

Observed impact: expected test-induced missing fixture, not failed installation.
Seed/world existence, normal dimension saves and state transitions are verified;
exhaustive region/player/NBT integrity and arbitrary content-mod removal are not.
Repair: no product fix or fixture redesign warranted by this exact warning.
Eligible proposal: explicit expected-test-artifact disposition for this hash,
these three phases and this isolated world only. Still needs user approval to
change revised acceptance; do not mutate the original classifier or strict Gate.
Any additional missing mod, registry remap/content loss, different artifact/phase,
world failure or unknown warning is excluded and requires new review.
USER DECISION REQUIRED: approve/reject bounded D fixture exception.

## E1 — pipe/no-TTY: six entries

R/launch-2-stderr.log:1, 2026-10-24T08:40:15.413214600Z, main/WARN:
`Advanced terminal features are not available in this environment`.
Same startup message in all six Neo launches, before Done, under owned pipe
stdio. Raw line does not identify a concrete class/logger; do not infer it from
message similarity. Captured output, RCON/list and explicit stop are verified.

Repair: no failure of required M3 output/RCON/stop evidenced; attaching a TTY just
to suppress a warning would alter the tested launch environment unnecessarily.
Eligible proposal: bounded noninteractive-environment limitation, exact message
and launch context only. Interactive terminal editing/advanced features and
arbitrary stdin console commands are NOT VERIFIED by RCON tests. Not a waiver
for missing output, broken stdin, stop failure, ownership errors or other terminal
warnings. Reopen on launch/terminal/JDK changes or any control/capture regression.
USER DECISION REQUIRED: approve/reject bounded E1 disposition.

## Final decision request (not an authorization)

Recommend accepting A as limited telemetry degradation, C as local-only M3 scope
with online authentication expressly excluded, D as the exact expected fixture
warning, and E1 as a pipe-mode advanced-terminal limitation. Each may be approved
or rejected independently. No broad ERROR/WARN/timeout allowance is proposed.
R1/R2 acceptance is not expanded. Until explicit user decisions and subsequent
revised final signoff, all four required dispositions remain outstanding and M3
FINAL BLOCKED. Source/health changes require affected validation, not blind reuse.

Independent GPT-6.1 Sol High review completed read-only. P1=0, P2=0, P3=0;
one nonblocking P3 count-description finding was corrected and independently
closed (C18 distinct classifier strings versus41 raw stdout occurrences).
Reviewer checked report SHA, HEAD, marker hashes, seven normal exits, health
flags and separate identity-bound resource probing. All four proposals are
eligible for explicit user decision only; no waiver was approved by the reviewer.
UNRESOLVED_REQUIRED_GATES=4; REVISED_FINAL_GATE=BLOCKED.
No new source issue severity is inferred from raw warning/error counts.
