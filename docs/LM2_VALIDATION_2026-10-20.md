# LM2-A: observation-based monitoring notices

## Delivered scope

Performance now displays a bounded monitoring notice panel using existing API fields only:

- List-snapshot abnormal exit, recovery-required and unknown state; timestamp and explicit warning that this is not live process confirmation.
- Unavailable and stale metric names, and failed-read snapshot warnings.
- Explicit TPS/MSPT unavailable semantics. No inference from CPU, player counts or logs.
- No automatic action, command, thresholds, timers, persistent alert history or backend change. No status-to-crash-cause inference.

This is LM2-A UI engineering completion only, **not whole LM2 PASS** and not new TPS/MSPT collection.

## Source capability inventory

| Existing production path | Verified from current source |
| --- | --- |
| LocalRuntime.metrics | TPS, MSPT and players currently return not-collected; uptime uses managed process state |
| LocalJavaAdapter.getMetrics | Reuses runtime metrics plus managed process resources and volume reading |
| PerformanceService | Adapter metric samples only; no extra commands; minimum5seconds and120 manager-session points |
| ServerService.getPlayers | Separate Vanilla-only read under shared operation lock, fixed list command, parsed bounded response; not connected to metric history |
| Existing Dashboard | Already shows status, metric availability and detection warnings; unchanged |

There is no verified per-version TPS/MSPT producer to wire here. Vanilla/Paper/Fabric command formats, timing windows and provenance have not been validated by this work. A server being a supported loader is not evidence of a supported metrics command. Keep N/A until a trustworthy source and version rule exist. Do not install a plugin/mod, start a real server, issue experimental commands or expand remote access.

## Checks

- Focused trend/page/notices:17PASS, exit0.
- Fresh complete Web suite:188PASS/32files, exit0. Existing jsdom navigation notices retained.
- Web typecheck, changed-product ESLint, Web production build:PASS/exit0. Build5.10seconds;556.23kB chunk warning retained.
- Independent Sol High source review and type-only delta:P1=0/P2=0/P3=0. Reviewer did not run tests.
- An initial typecheck failed TS2375 because exactOptionalPropertyTypes rejects explicit undefined for optional Metrics. Attempt1 adds explicit undefined to the two component prop types; no runtime/assertion/strictness change. Final typecheck passed; the original failure remains in this record.

Final browser360/768/1440:3PASS/exit0/9.8seconds; the extended fixture verifies monitoring notices, TPS/MSPT unavailable explanation and failed-read wording alongside the original trend checks. Evidence:ignored `test-results/lm1-browser-3fb268b1-93c6-4500-b01b-d49edf8ce36a/.last-run.json`. Changed browser ESLint and git diff --check PASS/exit0. Directly owned Vite stopped; port3014 ECONNREFUSED. No whole API/native rerun:frontend-only slice, existing eight API failures remain BLOCKED and LC2 production member writes remain unavailable by default.

## Remaining work

1. Design a bounded trusted metric source for the exact supported server/version, with genuine sample windows, source identity, timeout/failure semantics and zero lifecycle mutation. Keep unsupported cases unavailable.
2. Obtain separate isolated real-Minecraft acceptance authorization before validating any proposed source on a running server.
3. Only after genuine samples exist, define defensible alert thresholds, bounded persistence and notification policy as separate work. No RAM heap percentage from RSS, and no TPS inference.

Real monitoring acceptance NOT RUN. Phase7 remote PAUSED. No commit/push/PR or system changes.
