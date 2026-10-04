# P3.5 Warning Classification Fix — 2026-10-04

Status: HARNESS FIX READY; real acceptance remains BLOCKED / awaiting a new run.

## Root cause and historical evidence

The harness treated every Minecraft warning other than the existing exact timing warning as blocking. The shutdown assertion is generic: the historical launch has no ERROR/fatal/unknown warning, but an exact Server thread warning `handleDisconnection() called twice` entered blockingMinecraftWarnings.

Historical run: p35-browser-4c145881-8043-4ca1-9d1d-c231a598e45a. Report SHA256: A257E0294BCD662FD3B9EF8986B7CF7CEE36F22CDDDA0DB90747EF8F34B6667B. Historical report/logs remain unchanged and BLOCKED.

Launch 3 raw log: Done/RCON 14:43:46; RCON block changes 14:44:10 and 14:44:21; warning 14:44:30; another successful RCON block change 14:44:31; authorized stop/save players/save worlds/all three dimensions/RCON listener stop 14:44:35. Exit code 0; no premature exit; final state confirms Java and browser helpers stopped, all ports released, no active operation or recovery lock. TCP readiness probes open and close sockets, and the RCON client has explicit socket destruction paths; these establish controlled connection closure but do not identify the precise originating connection. No product bug is demonstrated by this evidence.

## Limited change

Only P3.5 uses the new phase35-diagnostics.mjs extension. Shared import-diagnostics.mjs and all product transaction/lifecycle code remain unchanged. Exact full timestamped Server thread warning only; classification name minecraft-handle-disconnection-duplicate-after-ready.

Each occurrence on each capture surface must follow the recorded complete-readiness line boundary and Done/RCON lines, precede normal stop, and have a subsequent successful RCON block-change line. Normal save players/worlds/Overworld/Nether/End and RCON listener stop must follow. Full readiness, no ERROR/fatal/unknown generic warnings, no capture overflow/premature exit, authorized observed shutdown, exit 0/no signal, owned output closure and released ports are required. Missing evidence blocks. Exceptions or explicit save failure remain fatal. Other unknown Minecraft warnings remain blocking. All raw warnings/sources/occurrences remain preserved. Runtime stop and final reclassification invoke the same pure helper and saved launch context.

## Validation

Initial focused helpers/diagnostics: 88 PASS. Complete-readiness boundary increment: 89 PASS. Latest classification suite: 39 PASS. lint and node syntax checks PASS. Latest full npm.cmd run check: exit 0; contracts 6 / API 706 / Web 82 = 794 PASS; lint/typecheck/build PASS. Full check log: test-results/p35-warning-check.log (ignored private artifact). Independent GPT-6.1 Sol / High CODE / TEST-SOURCE Review PASS (existing archive_independent_review, read-only, no tests or Java execution by reviewer); no P1/P2. Confirmed per-surface readiness/partial-line fail-closed boundary, normal stop and final classification consistency. Signoff is tool readiness only, not real P3.5 or Phase 3 PASS. Historical report hash rechecked unchanged after validation.

No real Java rerun, Windows repair, commit, push or main merge in this task.
