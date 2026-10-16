# LC2 Native / fresh-process validation — 2026-10-14

## Current result: SAFETY BLOCKED

Prior UNWIRED Synthetic integration PASS (1806 tests,379 hashes) remains historical evidence for that candidate. Two new test files implement a native guard roundtrip and two owned-process death checkpoints using the actual private publication/ACL/ManagerLifetimeLock primitives. Product code was not changed in this slice. Native/fresh-process Gate is NOT PASS; whole LC2 remains IN PROGRESS. No real RCON/Minecraft/world/network/system/Git operations.

## First native execution

Prefix `lc2-native-94f9ae1b-c719-48aa-8c78-dd1d2318c29d`; ignored test-results holds raw .log, -result.json and -checkpoint.json (test fingerprints).

- Exit1; Vitest reports3 FAIL.
- Only the guard roundtrip actually ran:50015ms, then CLEANUP_BLOCKED. No fixed successful drained acknowledgement arrived within the shared50s observation deadline.
- Guard process-death and dispatch-intent process-death cases returned PRIOR_NATIVE_FAILURE_STOP in1ms each; neither launched. These are stopped dependent tests, not independent product failures.
- Original test60s, ACL helper5000ms and native publication limits unchanged. No retry/full regression/build after failure. Do not use earlier lint/typecheck success to override this failure.

Raw terminal errors:

```text
Error: CLEANUP_BLOCKED
fixture test/whitelist-native.test.ts:29:102
Error: PRIOR_NATIVE_FAILURE_STOP
fixture test/whitelist-native.test.ts:21:27
npm error code 1
```

The fixture finally error masks the preceding observation error in Vitest output. Source has the fixed NATIVE_OBSERVATION_DEADLINE timer and measured total is50.015s, but no child-stage message was observed; do not claim a specific helper timeout/ACL denial. Production helper-stage root is UNKNOWN. Further timing/diagnostic design should preserve both primary error and cleanup outcome separately, without weakening cleanup proof or raising deadlines.

## Safety state / retained evidence

Test fixture `mcsm-whitelist-native-U5toGW` under the test process TEMP directory was retained. Readonly inventory found manager.lifetime.lock (0 bytes), guard00.bin (69 bytes) and manifest.json (862 bytes). File presence does not establish verified guard completion, owner release or process health. No user data/credential content was read.

CIM process query failed: HResult=-2146233088. Generic Node enumeration cannot establish fixture/helper ownership. No unknown process terminated, no retained directory removed. Current child/helper exit state UNKNOWN; cleanup remains CLEANUP_BLOCKED. No more native tests or dependent writes may start until identity and exit state are proven. Do not operate broad process names or force-delete this root.

## Review and issue ledger

- LC2-NATIVE-CLEANUP-001 / P2 / resolved pre-run Attempt1: static review found closed Node without drained proof could permit deleting a directory while a native helper remained. All child modes now require matching drained ACK; reader/roundtrip require exit0/signalnull. Unknown live/closed child retains root. Outer failure gate includes cleanup, shared50s budget checked before child spawn, separate bounded5s close wait, original60s test unchanged. Writer IPC explicitly ref'ed. No product repair.
- LC2-NATIVE-OBSERVATION-001 / HIGH / SAFETY BLOCKED: actual first native attempt supplied no drained ACK within50s; CLEANUP_BLOCKED, exit1. Underlying performance/owner/helper cause UNKNOWN; substantive root fixes0/2. Two dependent cases were stopped; no second run. Cleanup preserves the fixture as designed.
- LC2-NATIVE-PROCESS-001 / MEDIUM / BLOCKED: readonly process ownership query unavailable (HResult=-2146233088); generic Node IDs insufficient for cleanup. No system changes or broad termination. No fixes attempted.

## Minimal next step

First obtain readonly ownership/exit evidence from the host for this specific test probe and its descendants. If exit cannot be proven, retain the root and stop. Then independently design bounded fixed stage/anonymous process-identity evidence and preserve the original error beside cleanup status. Do not assume total duration means PowerShell startup, permissions or performance is the root. Do not retry until the unsafe/unknown process state is resolved. Current native candidate remains BLOCKED; no HTTP/UI or real-runtime integration admission.

## Independent final evidence review

Independent Sol High confirms SAFETY BLOCKED, no new proven product P1/P2; P3=1 diagnostic insufficiency (finally masks primary error). Native first-run/stopped-case distinction and retained-root safety verified from raw logs/source. No test, process query or cleanup executed by reviewer. Prior Synthetic PASS remains limited and intact. No quota-exhaustion claim; execution stopped for unconfirmed process safety, not allowance.

## Later bounded diagnostic

2026-10-14 LC2 native diagnostic BLOCKED: one bounded roundtrip exit1; owner acquisition4160ms/stores9ms then guard-create at4170ms;50s deadline without terminal. Errors NATIVE_OBSERVATION_DEADLINE+CLEANUP_BLOCKED preserved separately. Specific helper/performance root UNKNOWN, underlying fixes0/2. Recorded child33144 subsequently absent, only pre-run PS+query/no compilers observed; both test roots retained. Historical Native BLOCKED unchanged. See LC2_NATIVE_DIAGNOSTIC_2026-10-14.md. Production writes closed/LC2 IN PROGRESS, Remote PAUSED, no Git publication.
First native result remains BLOCKED; no overwritten evidence or native success claim.
