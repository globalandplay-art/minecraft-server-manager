# P6.1b validation and issue ledger

Status: P6.1b PASS; browser process closure verified. Not Phase 6 Final PASS.

## Implementation and review

Read-only session history API and responsive Performance route, demand sampling with per-instance
single-flight and 5-second monotonic cooldown, no backend timers or new Minecraft commands.
Cold start/restart has no historical samples. Failed probes stay failed throughout cooldown;
successful sampling clears the failure. Source metric times never refresh on cache reads.
Disk is labeled used/total/free. Local CPU/RAM/Disk/TPS/MSPT remain unavailable until P6.2.

Independent GPT-6.1 Sol / High review and delta: PASS, P1=0/P2=0/P3=0.
Review findings below were corrected, not waived.

## Validation

- Performance history/service: 8/8 PASS.
- Health/app + performance affected API: 35/35 PASS after feature fixture correction.
- Performance UI: 3/3 PASS; full Web from first check: 134/134 PASS.
- Latest dedicated whole-workspace typecheck/lint/build/diff: PASS.
- Build retained existing >500 kB warning, now 516.02 kB main chunk.
- Frozen full check v2: exit0, contracts6/API1055/Web134, **1195 PASS**;
  lint/typecheck/production build PASS, final diff check PASS.
- Chrome 360/768/1440 assertions: 3/3 PASS; runner remained in teardown and was interrupted,
  exit1. Historical run is not an end-to-end command PASS. Normal host rerun subsequently
  completed 3/3, exit0; affected Phase 1 placeholder browser1/1 exit0. No Minecraft was launched.

## Issues (all historical errors retained)

### P61-FAILURE-001 — P2 resolved

Review found a failed probe could be followed by a successful cached response during cooldown.
No explicit error code. Attempt1: store the failure and rethrow until next successful sampling;
targeted tests verify both failure persistence and recovery, delta review closed finding.

### P61-DISK-001 — P2 resolved

Disk displayed usedBytes without explicit meaning or total/free. No explicit error code.
Attempt1: label all three fields and add UI assertion. UI3/3 and delta review PASS.

### P61-TYPE-001 — resolved

Initial contract declaration preceded responseMetaSchema: TS2448/TS2454 and
`ReferenceError: Cannot access 'responseMetaSchema' before initialization`.
Attempt1: move the new response definition after existing schemas. Contracts build PASS.
Separate route error-reply typing TS2345 corrected with formal ApiErrorResponse union.

### P61-FIXTURE-001 — resolved

`AssertionError: expected 403 to be 200` in performance-service.test.ts: missing allowed Host.
Attempt1: provide 127.0.0.1:8080; no product request guard changed.
Independent dot-path assertion `expected 404 to be 400`: inject normalizes dot segments before
routing. Exact404 retained and added malformed uppercase ID400 assertion. Targeted API PASS.

### P61-FEATURE-001 — resolved

Old app health fixture assumed only dashboard/servers implemented. First check failed this
assertion after performance became implemented. Updated exact performance flag and preserved
remaining false-feature assertion. Removed Performance from the old phase-placeholder browser
case; dedicated new browser suite covers its implemented page. Affected API35/35 PASS.

### P61-E2E-CLOSE-001 — resolved in normal host context

Three Chrome assertions completed but runner did not finish teardown. Interrupted owned runner;
exit1, no explicit application error code. Read-only helper inspection encountered existing
WMI `HRESULT 0x80041003` (Access denied), so helper closure must not be claimed from WMI.
No system repair, timeout increase, unknown process kill or classifier changes performed.
Read-only host WMI confirmed the old helpers had exited and ports released. Attempt1:
run the same browser suite in normal host context, 3/3 exit0; after the affected placeholder
browser1/1 exit0, read-only inspection found no API/Vite/Playwright helper and zero listeners
on 3000/8080. This demonstrates the host-context workaround, not a proven internal WMI root cause.

## Safety and Git

No Java launch, original world access, lifecycle command, arbitrary path API, filesystem write
transaction or Windows modification. No commit/push/PR. Historical test-results remain private.
P6.2 measurements and P6.3 crash analysis have not begun. Phase 7 is out of scope.
