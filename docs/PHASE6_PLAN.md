# Phase 6 — Performance / Crash Analysis

Status: PASS — Phase6 Final Gate2026-10-08. Phase5 Final PASS is the entry baseline.
Final evidence: [Phase6 Final Gate](./PHASE6_FINAL_GATE_2026-10-08.md), new1234-test
regression, overall browser7/7 and independent SolHigh P1/P2/P3=0.

P6.1a/P6.1b PASS (2026-10-08): bounded demand API/UI, independent Sol High delta PASS,
new full regression1195 PASS, browser360/768/1440 PASS. P6.2 PASS with new1204
regression and isolated real host run be2a99dc plus independent SolHigh evidence
review; see [P62 validation](./P62_VALIDATION_2026-10-08.md). P6.3a/b PASS with
new1234-test regression, browser5/5 and independent SolHigh P1/P2/P3=0;
see [P63b validation](./P63B_VALIDATION_2026-10-08.md). P6.4 PASS; see
[validation and historical issues](./P61B_VALIDATION_2026-10-08.md).

## Scope and sequence

- P6.0 PASS: inventory existing metric sources and freeze API/UI boundaries.
- P6.1a: bounded, in-memory, per-registered-server performance history foundation.
- P6.1b: read-only performance API, bounded sampling and responsive Performance page.
- P6.2: improve reliable process/volume measurements where supported; unsupported metrics remain unavailable.
- P6.3: bounded local crash/log analysis, redacted evidence, explicit confidence and limitations.
  - P6.3a PASS: internal fixed-path reader and possible-cause engine; conservative truncated-source exclusion, 19 focused tests, new 1223-test full regression and independent Sol High review PASS. See [validation](./P63A_VALIDATION_2026-10-08.md) and [frozen plan](./P63_CRASH_ANALYSIS_PLAN.md).
  - P6.3b PASS: registered-only read API, bounded scan service, responsive manual-refresh page and acceptance.
- P6.4 PASS: browser/isolated acceptance, new frozen regression and independent Sol High Final Gate.

No Phase 7, remote access, automatic repair, addon installation or new lifecycle semantics.

## Existing foundation

The local adapter delegates getMetrics to the runtime snapshot. Dashboard already renders
metric status, source and sampledAt and displays unavailable values as N/A.
Performance is connected by P6.1b; Crash Analysis is connected by P6.3b.
P6.1a was initially unconnected; P6.1b reuses the history through the read-only API.
P6.1's historical snapshot measured managed-launch uptime only. P6.2 now adds
owned Windows process CPU/RAM and identity-checked volume capacity, with engineering
review PASS and real Minecraft acceptance PASS. TPS/MSPT remain not-collected.
Players are available through the separate read-only player endpoint.
The plan above describes intended measurement scopes, not claims of existing measurements.

## Measurement contract

CPU and RAM must describe the owned Minecraft process, never silently substitute the Manager
or host. Disk describes the registered root's volume, with total/free/used explicitly labeled;
it is not world size. Uptime describes the current managed launch. TPS/MSPT require a verified
server-specific source; no inference from CPU, log lag or arbitrary commands.
Keep original metric timestamps and stale/unavailable reasons; collection time is separate.
Mock values remain explicitly mock. No interpolation, persistence or fabricated history.

## History and API boundary

GET /api/v1/servers/:serverId/performance returns bounded session history; the page labels
measurement scope. Clients cannot supply paths, PIDs, commands or sample buffer capacities.
The registered-server set bounds keys; at most 120 samples per server. Manager restart clears
history. Demand sampling deduplicates in-flight reads and enforces a minimum 5-second
monotonic interval per instance; there are no backend timers. UI polling pauses when hidden
and disposes on unmount. No requests means no collection and no invented gap points.
Failed probes remain errors throughout cooldown and clear only after a successful sample.
Original metric timestamps are retained; API response generation never makes cached samples fresh.

## Crash analysis boundary

Only backend-derived registered log/crash paths; reject links and unsafe filesystem identities.
Bound file count, bytes and line length. Redact credentials before response and never expose
absolute paths. A matched rule yields evidence and confidence, not a certain root cause.
Unknown or truncated evidence remains explicitly incomplete. No uploads to external services,
automatic repair, registry edits or deletion. Freeze the response schema after inspecting the
existing log reader and redaction rules.

## Gates

Each slice: focused tests, typecheck/lint/build as applicable, independent Sol High review.
UI: 360/768/1440 browser acceptance. Final: new full regression and diff check, preserve prior
failed evidence. Real process tests use isolated instances only; no user world access.
Same root cause: at most two distinct fix/verification attempts, then stop and report original
error codes/logs, relevant source, attempts and safe continuation. No Astra, no automatic Git
upload. P6.1a tests alone do not constitute Phase 6 PASS.
