# P5.3 Addon Lifecycle Core — 2026-10-06

## Result

**P5.3 lifecycle core: ENGINEERING PASS.** This is a synthetic engineering result for the lifecycle API and transaction core. Real Paper/Fabric Java acceptance was not run. Phase 5 remains IN PROGRESS.

Implemented for the trusted Paper plugin and Fabric mod namespaces:

- Disable and Enable move one validated addon between its fixed enabled/disabled directories.
- Trash moves enabled or disabled addons into a server-bound private trash entry and writes a durable receipt. There is no permanent-delete endpoint or automatic trash cleanup.
- Restore consumes a receipt and returns the original file to its prior enabled/disabled state. Reusing a consumed receipt is rejected.
- Writes require a registered local server binding with the server stopped and no owned process, an opaque addon ID or trash ID, current inventory revision, UUIDv4 idempotency key, local request guard, no active operation, and no recovery gate.
- Each mutation creates and verifies a complete pinned server-snapshot guard before writing a schema-versioned lifecycle journal intent. Controlled same-volume hardlink publication plus source unlink avoids overwrite and recursive-copy fallback. No operation launches or restarts Minecraft.
- Trash has a separate sanitized list. Its revision includes physical file identity and content hash. Startup and later list/mutation requests reconcile or validate journal-linked trash and restored tombstones; uncertain layouts preserve evidence and require inspection.
- Operation results restored after manager restart retain the resource ID and `restartRequired=true`.

## Review and validation

An independent GPT-6.1 Sol / High delta review passed with no remaining P1/P2/P3 finding in scope. It verified closure of the previously reported read/mutation race, target-junction escape before hardlink creation, historical restored-tombstone successor proof, startup ordering for an interrupted unapplied Trash, and missing lifecycle behavior tests.

Validation after the final source changes:

- P5.3 lifecycle focused suite: **57/57 passed**.
- Full single-worker regression: contracts **6**, API **984**, Web **108**; **1,098/1,098 passed**.
- Lint: passed.
- Typecheck: passed.
- Production build: passed.
- `git diff --check`: passed after the final documentation update.

The first default-parallel full run had 9 timeout-related test failures among 984 API tests; 975 API tests passed, and contracts/Web passed 6/6 and 108/108. The raw Vitest condition was `Test timed out in 5000ms.`; four install-reconciliation assertions observed `running` where a terminal state was expected at the same 5-second wait boundary. No timeout, assertion, or test coverage was weakened. The full API suite then passed with one worker. The first lint attempt also reported two mechanical errors (`prefer-const` and `@typescript-eslint/no-unused-vars`); both were corrected before the final lint/typecheck/build pass.

## Remaining boundaries

- Real Paper 26.2 and Fabric 26.2 server loading and restart behavior: **NOT RUN**.
- Mods / Plugins UI and browser interaction: P5.4, not started.
- Phase 5 real acceptance, unified Adapter final review, and Phase 5 Final Gate: pending.
- Windows directory durability and adversarial same-user filesystem races remain subject to the documented platform limits; this work does not claim power-loss durability beyond the existing journal/filesystem guarantees.
- The working tree includes earlier uncommitted P4/P5.1/P5.2 work. No commit, push, or PR was created.

## Verification record

The parallel run result is preserved in this record and the repository progress history; it was superseded only as current validation by the complete single-worker run, not rewritten as a pass. The focused run had fixture/assertion corrections before reaching 57/57; those intermediate failures were not product acceptance failures. No Minecraft server was started and no user world was accessed.

Next planned slice: **P5.4 Mods / Plugins UI and browser interaction**. Do not enter it until separately requested.
