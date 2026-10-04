# P3.3 World Archive independent review

Date: 2026-10-04 Asia/Shanghai. Reviewer: independent read-only GPT-6.1 Sol / High (`archive_independent_review`). No Astra was called. The reviewer neither changed files nor executed tests or Java. This record preserves the actual review findings and the subsequent independent re-review.

## Reviewed scope

Archive service/routes, schema-5 journal, operation admission and idempotency, active-world state, lifecycle gates, inventory, contracts, UI, regression tests and isolated host acceptance tools. Review checked complete Vanilla world-set preservation, pinned guard, root/world/destination identity, intent-before-rename ordering, physical verification, restart reconciliation, durable none, path/secret boundaries, UI confirmation and retry, isolated JAR/EULA provenance, captured child ownership, final diagnostics and stopped state.

## Findings and closure

### ARC-REVIEW-002 — P2, blocking lifecycle bypass — CLOSED

Before the fix, a successful Restore followed by Archive left a valid previous tree and pinned Restore guard. The old rollback plan could accept the missing active directory, install that previous tree and call `adapter.start`, while durable active-world state remained `none`. This bypassed the archive no-active-world contract. It was a source-proven review finding, not a failed real Minecraft run; no fabricated runtime error code is assigned.

The fix in `apps/api/src/services/restore-service.ts` checks bounded persisted state independently of optional dependency injection. Plans, history/parent admission, requests, queued execution, filesystem cutover and the final Java start check reject archived none with HTTP 409 / `NO_ACTIVE_WORLD`. Missing or unsafe state in the presence of an archive retains recovery gating. Legacy restore recovery without an archive can still recover a missing world. The rename/rollback mechanism itself was not replaced and no none-to-active feature was added.

New tests cover real service/API Restore → Archive → rollback for both explicit start options, preserved world/state/journal data and unchanged Java calls, plus queued execution revalidation. Independent re-review confirmed the fix and found no new concrete P1/P2 in this delta.

### ARC-REVIEW-003 — P2, deterministic failure UI retry — CLOSED

Before the fix, an accepted operation could fail before transaction intent with a deterministic revision/stop conflict and no recovery requirement. The component cleared session storage but kept the old submission, permanently hiding the new confirmation form until a full reload.

The UI now releases only deterministic failed submissions, resets confirmation and retains visible failure feedback. A subsequent explicit confirmation uses a new idempotency key. Interrupted or `RECOVERY_REQUIRED` outcomes retain operation lookup and cannot be automatically resubmitted. Independent re-review checked the new component assertions and closed the finding.

## Signoff and limits

Independent **CODE/TOOL REVIEW PASS** after the two repairs. No other concrete P1/P2 was found in the reviewed scope. Execution validation is recorded separately by the writer; the earlier 657-test full result predates these repairs and cannot establish the repaired baseline.

After independent re-review, the writer completed focused API Archive 46 + Restore 59 (105/105), UI 7/7 and typecheck. The repaired full `npm.cmd run check` with `VITEST_MAX_WORKERS=1` completed at 07:36 with exit 0: contracts 5, API 586, Web 75, **666 tests PASS**, plus lint/typecheck/build. The two newly introduced fixture failures and their corrective test changes remain recorded in the global ledger; no safety assertion or timeout was weakened. Final documentation diff checks passed. This execution evidence closes the repaired-code regression gate, not the real acceptance gate.

The 07:14 one-time continuation was consumed and its automation was set to PAUSED; no subsequent run was created. Staging was not started because Archive's required real gate remains blocked, despite sufficient observed allowance.

Post-repair browser regression was also run once: `npm.cmd run test:e2e -- --config tests/phase3-archive.config.ts`, exit 0, Chrome 360/768/1440 **3/3 PASS**, total 2.0 minutes including teardown. Windows helper teardown stalled again; only this run's stdout-owned API/Vite PIDs 2504/2660 were stopped after matching executable and exact launch time, and their exit was verified. This closes the relevant repaired-UI browser check; the automatic teardown limitation is recorded separately and no real Minecraft was launched. Full 666-test regression was not repeated.

Real Archive remains **BLOCKED / NOT RUN**. Preflight run `p33-archive-8e46db7c-561c-4ea7-b3c5-5f9981337eb3` could not read Perflib in the Codex execution context and did not launch Java or create a world. This code/tool review does not replace real acceptance, mark P3.3/Phase 3 PASS, authorize staging admission, or justify Windows repair.

Evidence and complete issue history: [implementation and acceptance](./P33_ARCHIVE_2026-10-04.md), [global issue ledger](./P33_GLOBAL_ISSUE_LEDGER_2026-10-04.md). The original failed reports remain intact.
