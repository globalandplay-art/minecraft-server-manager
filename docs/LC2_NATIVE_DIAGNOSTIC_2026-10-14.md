# LC2 Native guard diagnostic follow-up — 2026-10-14

## Result

BLOCKED. One new, explicitly bounded diagnostic-only roundtrip, not an underlying repair or production acceptance. Historical first native run remains unchanged. No full regression, real Minecraft/RCON/network/system/Git actions. Root fixes0/2.

## Recovery before diagnostic

Readonly NtQueryInformationProcess command-line inspection matched only the fixed probe script and retained fixture name internally; no raw command lines were printed. All Node queries succeeded, matched0/unreadable0. Existing non-query PowerShell started2026-10-13, before old fixture creation2026-10-14T21:32:23.7200198+08:00; no pwsh/csc/cvtres found. This proves no matching live probe in that snapshot, not historical successful drain. Old fixture retained.

## Observation candidate

Two test-only files changed: whitelist-native.test.ts and fixtures/whitelist-native-probe.ts. At most16 fixed stage events over independent IPC, Node monotonic elapsedMs; no raw helper stdout/stderr or output-buffer changes. Parent stage whitelist does not grant drained status or settle waiting. Primary and cleanup errors retained separately via AggregateError. Product ACL/publication/identity rules unchanged. Work50s, cleanup5s, test60s, ACL helper5000ms unchanged. Independent pre-run Sol High delta P1/P2/P3=0; lint/typecheck PASS.

## Actual diagnostic run

Prefix `lc2-native-diagnostic-8a47c8d9-1120-4a57-a5e8-3007015d0a93`; raw log/result in ignored test-results. Exit1. Exactly one roundtrip executed; two process-death cases unselected by the bounded targeted diagnostic (not waived for final Gate).

| Fixed stage | Child monotonic elapsedMs |
| --- | ---: |
| owner-acquire | 0 |
| stores-open | 4160 |
| stores-opened | 4169 |
| guard-create | 4170 |

No guard-created or drained terminal was observed before the50s parent deadline. Parent and child clocks are distinct; stage elapsed measurements compare only child events, not absolute parent time. IPC delivery latency not measured. Cannot infer internal helper stage or assume guard-create never subsequently finished.

Original errors:

```text
Error: NATIVE_OBSERVATION_DEADLINE
Timeout.<anonymous> test/whitelist-native.test.ts:84:73
Error: CLEANUP_BLOCKED
fixture test/whitelist-native.test.ts:31:102
npm error code 1
```

Confirmed: the observation limit expired while last observed outer step was native guard creation. Owner acquisition/stores-open had completed. UNKNOWN: which private creator/publisher/ACL query/readback consumed the remaining interval; individual helper timeout vs accumulated execution cost; CPU/disk/compilation cause. Do not call this an ACL policy violation or owner-reacquisition failure.

## After-run safety

Recorded child PID33144 subsequently absent from Get-Process. PowerShell query showed only the old pre-run user process and the query itself; no pwsh/csc/cvtres. No kill performed. Both fixtures U5toGW and SWVmo4 retained; neither deletion nor successful historical drain claimed. These snapshots do not establish the missing roundtrip result.

## Issue ledger / next direction

- LC2-NATIVE-OBSERVATION-001 / HIGH / BLOCKED: outer stage localized to guard-create; performance root stillUNKNOWN, underlying repair0/2. No timeout increase or safety-check reduction, no blind retry.
- LC2-NATIVE-PRIMARY-ERROR-001 / P3 / RESOLVED: prior finally masked primary error; test diagnostic amendment now separately retains original deadline and cleanup. One diagnosis-only run verifies visibility, not product/native success.
- LC2-NATIVE-PROCESS-001 / MEDIUM: CIM remains unavailable; readonly native command-line query supplied current absence evidence without system modifications. Preserve original HRESULT and historicalUNKNOWN. No network/system change or broad cleanup.

Next first perform static inventory of exact native guard creation calls, then design local call-category/count/timing observation that forwards the same primitives unchanged. Any future sampling must again prove process safety, remain bounded, preserve primary/cleanup separately and retain failures. No immediate product performance patch is justified from outer-stage timing alone. Native Gate and whole LC2 remain unfinished; production member mutations closed.

Independent Sol High final evidence review: no new proven product P1/P2; direct product fix not justified. Confirms last observed outer stage guard-create and primary/cleanup separation; internal cause UNKNOWN/root fixes0/2. Static successful path20 native calls (6 compiled publication+14 ACL) is a hypothesis inventory only. Next bounded observation design saved in LC2_NATIVE_TIMING_PLAN_2026-10-14.md; no third native run performed.
