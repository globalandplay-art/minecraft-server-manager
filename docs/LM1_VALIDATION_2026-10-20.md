# LM1 performance UI and history

2026-10-20: LM1 frontend engineering checks complete. This is an isolated frontend slice, not a whole-project PASS or real Minecraft acceptance.

## Delivered

- Reuse the existing PerformanceService/PerformanceHistory API, minimum5-second demand-driven samples and maximum120 manager-session snapshots. No API, contract, sampler or native process changes.
- CPU, process RSS, volume free bytes and online-player SVG trends; selectable whole-session, last1-minute and last5-minute ranges anchored to the last collected snapshot.
- Metric sampledAt determines point placement. Genuine zero remains zero. Missing, stale, invalid, backwards, provenance changes and gaps over10seconds break lines; cached observations are not duplicated. No TPS/MSPT inference.
- Pause/resume and manual refresh; hidden-page sampling pauses and visible-page observation resumes. No new persistent history or background timer.
- Server list state is explicitly a timestamped list snapshot. Failed reads retain clearly labelled old data. Memory is RSS, disk is the containing volume, not JVM heap or world size.
- Accessible native SVG and responsive layouts; no chart dependency.

## Validation

| Check | Actual result |
| --- | --- |
| Trend/page focused tests | 13 PASS, exit0 |
| Complete Web suite | 184 PASS /31files, exit0; existing jsdom navigation notices retained |
| Changed TypeScript/test ESLint | PASS, exit0 |
| Web typecheck | PASS, exit0 |
| Web production build | PASS, exit0 /5.24seconds;554.33kB chunk warning retained |
| Browser360/768/1440 | 3 PASS, exit0 /11.6seconds |
| Independent Sol High source review | P1=0/P2=0/P3=0 |
| git diff --check | PASS, exit0; existing LF/CRLF conversion notices retained |

Browser evidence: ignored `test-results/lm1-browser-a389f67e-2770-46a3-85d3-e888ba11827f/.last-run.json`. Browser uses synthetic HTTP via an in-process mock app, not real process metrics, RCON or Minecraft. It verifies four graphs, real-zero points, gaps, range selection, pause/manual refresh, retained error data, N/A, zero writes and no horizontal overflow at all three widths. Directly owned Vite helper was stopped; port3014 subsequently returned ECONNREFUSED. No real server or network configuration was changed.

No repeated full API/native regression: this slice changes frontend only, and unchanged LC2 native failures remain failed. The prior full-project baseline stays exit1, Contracts18PASS/API2491PASS+8FAIL/Web174PASS. The new Web184PASS supersedes only its frontend portion; it does not erase eight API failures or authorize LC2 production writes.

## Limits and continuation

- LC2 production remains BLOCKED/read-only by default. Ordinary guard storage native deadline and deliberate cleanup-blocked evidence remain retained; no fix or rerun here.
- Real Minecraft monitoring acceptance NOT RUN. Backend-supported metrics retain existing availability rules; unsupported TPS/MSPT stays N/A.
- Source inventory also confirms current LocalRuntime metrics() returns players=not-collected. The new player chart correctly remains empty in that production path; synthetic browser player points are not evidence of a new live player collector. Existing ServerService player-list reading is a separate call path and was not silently added to periodic sampling.
- History remains memory-only, resets on Manager restart and has gaps while paused/hidden/unrequested. Range selection does not fabricate recent samples.
- LM2 next: inventory existing trustworthy per-loader metric capability and abnormal-exit/recovery alerts. Do not assume Paper/Fabric commands are verified and do not install plugins or run real servers without authorization.
- Phase7 remote remains PAUSED. No commit/push/PR.
