# P7.2 lifecycle test cleanup checkpoint

P7.2 Final Gate: **BLOCKED**. No commit/push/PR, Minecraft or remote-network action.

## Evidence and scope

Historical full regression `test-results/p72-final-check-2026-10-11.log` preserves `Test timed out in 5000ms` and `ENOTEMPTY` deleting the synthetic fixture's transactions directory. Static inspection found direct afterEach deletion while operations run in background microtasks. Historical overlap is PROBABLE; the performance bottleneck and exact timeout checkpoint remain UNKNOWN.

Only test code changed: the restored-tombstone/restart test uses a fixture cleanup gate. Body promise, pending mutate/restore calls and its own active operation must all settle before directory removal. Teardown closes admission for this fixture, waits at most 2000ms independently of the unchanged 5000ms test deadline, and throws `CLEANUP_BLOCKED` without deletion if quiescence is unconfirmed. Retained gate identity also protects late-created roots from subsequent teardown. Other fixture gates/unknown processes are not waited on or terminated. No product transaction, journal, recovery or lifecycle implementation changed.

## Validation and review

- Cleanup helper tests: 3 PASS, exit 0.
- Original failed target at unchanged test timeout: 1 PASS, 63 not selected, body 2.00s, exit 0.
- Affected addon-lifecycle file plus cleanup helper: 67 PASS, 35.47s, exit 0.
- Lint and typecheck: exit 0.
- Independent GPT-6.1 Sol High three-file delta review: PASS, P1=0/P2=0/P3=0; read-only review, not independent test execution.
- Diff check passed; final documentation diff is checked separately.
- No new project-wide regression or production build: only test/helper/documentation changed in this cleanup slice. Previous serialization slice build evidence does not constitute a new full Final Gate.

## Attempts, unresolved items, next action

Cleanup-isolation repair: Attempt 1 targeted verification PASS. Performance-timeout root repair: 0/2 (not fixed). Native ACL timeout root repair: 0/2; fixed-candidate native failure remains preserved, later samples NOT_REPRODUCED, not RESOLVED. No safety assertion or timeout relaxed. This passing run did not exercise an actual Vitest timeout; unit tests cover unsettled body/work retention and rejection of new submissions.

Before P7.2 PASS, technical review must decide how to validate the historical intermittent failures, then authorize/perform a new frozen full regression and final independent signoff. Do not continue sampling automatically, reinterpret historical failures or enter Tailscale.
