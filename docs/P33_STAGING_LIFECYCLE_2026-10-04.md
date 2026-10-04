# P3.3 failed upload / staging lifecycle closure

Status: **PASS** within the failed/abandoned/expired-unclaimed upload scope. Implementation, independent Sol High review, post-fix actual browser acceptance6/6 and final frozen complete check693 all PASS. Archive is PASS; no unresolved Archive issue required the exceptional Astra planning call. No Astra was used. P3.4/P3.5 and Phase3 final remain separate pending gates.

## State and retention

New immutable owners carry createdAt. A separate atomic, identity-bound lifecycle record distinguishes receiving, failed and validated. Consumed/journal-owned uploads remain retained regardless of age. Abandoned receiving and failed uploads become expiry candidates after 24 hours; validated, unclaimed uploads after 7 days. Missing, corrupt, future-dated or legacy lifecycle data never authorizes automatic deletion. Expiry is eligibility, not deletion authority.

Manual discard remains an explicit ID/revision confirmation and may remove a younger, verified unclaimed upload. A durable discard-owner receipt marks discard-pending/cleanup-failed state; automatic cleanup retains it so an explicit retry is required. Unknown staging, pinned evidence, consumed markers, any journal reference (including terminal Import journals needed for reconciliation), non-terminal server transactions, recovery and invalid journal scans prevent cleanup. Global lease plus instance admission serialize upload/import/discard/cleanup.

## Execution and API

POST `/api/v1/servers/:serverId/worlds/import-uploads/cleanup` requires `{ "intent": "cleanup-expired-unclaimed" }`, normal local-origin write guard, and returns safe removed IDs / retained reasons. It never accepts paths or custom TTL. Sweep rechecks root/directory/metadata identities, timestamps, all references and process/recovery state inside admission, then uses existing durable discard receipt and bounded nonrecursive deletion. No worlds, guards, archives, transaction workspaces or evidence reports are swept.

Automatic cleanup defaults OFF. Only explicit `MCSM_IMPORT_AUTO_CLEANUP=true` enables a sweep for the requested registered server before a new valid upload; no startup timer, background polling, duplicate scheduler or cross-server deletion. Unknown results fail closed. The API's explicit sweep also works while automatic mode is off.

## Verification plan

Isolated real filesystem fixtures cover failed/abandoned/validated expiry, future/legacy/corrupt state, markers and journal references, recovery/active operations, root replacement, receipt retry, injected deletion failures and quota release. Existing Import/Archive/Restore tests must retain their invariants. HTTP checks cover strict intent/local origin and safe response. UI preserves explicit discard and shows lifecycle/retention reasons. Focused tests precede complete check; independent read-only Sol High review is required before slice PASS. No real Minecraft restart is necessary for deletion confined to upload-only isolated fixtures; historical Minecraft Import/Archive acceptance is not replaced by these tests.

## Gates and issues

Initial actual remaining allowance: 56% five-hour, 72% weekly; minimum 56%, above the 15% entry gate. Check again at natural implementation/test/review checkpoints; stop new work below 5%. No commit/push, Windows repair, original-world operation or Phase4.

Issue ledger starts empty for this stage; record actual findings and attempts below. Same root cause: at most three diagnosis/change/targeted-test correction attempts; no fourth attempt.

### STG-REVIEW-001 — MEDIUM / RESOLVED

Problem: UI still guaranteed unconditional no automatic cleanup despite the explicit opt-in mode. Impact: incorrect preservation expectation. No explicit error code provided. Raw source: `失败、中断和成功都计入配额，不会自动清理`. Attempt1: changed only the promise to default-OFF/explicit opt-in/new-upload sweep behavior, added UI assertions; UI7 PASS and independent Sol High re-review closed it. Source: WorldImportUpload.tsx, explanatory paragraph. No remaining blocker.

### STG-FIXTURE-001 — LOW / RESOLVED

Two first focused tests attempted a schema1 backup journal with namespace=manager, which that legacy schema rejects. Raw error: `Error: Invalid transaction journal intent`, transaction-journal.ts:443, exit1; upload tests44 PASS/2 FAIL. No product deletion occurred in those cases. Attempt1: use the actual legacy omitted-namespace layout and conservatively protect those references too. Focused upload46+Import47=93 PASS. Later upload52/52 PASS and latest54/54 PASS. No weaker assertion or timeout.

### STG-EXEC-001 — LOW / RESOLVED

First complete check was launched before the final checkpoint/runtime hardening edit. Its long-lived test transform cache mixed earlier service code and later test assertions: API609 PASS/2 FAIL (611 total), contracts5 PASS/Web76 PASS; check exit1 so build not reached. Raw assertions: `expected [ Array(1) ] to deeply equal []` (runtime-after-enumeration), `expected [] to deeply equal [ { …(2) } ]` (terminal checkpoint-only reference). Source: world-import-upload.test.ts:77/142. An independent fresh process against frozen final source passed54/54; no new repair, deletion of tests or retries/timeouts. Final complete check restarted only because this mixed-version run cannot validate final code; its result must be recorded separately.

## Independent review checkpoint

Existing read-only GPT-6.1 Sol / High reviewer closed UI P2 and independently reviewed lifecycle/reference protection, legacy paths, checkpoint-only terminal references, deletion-time runtime state, receipt retry, default-off config, HTTP/privacy and test assertions. Final CODE/TEST-SOURCE signoff PASS, no remaining concrete P1/P2. Reviewer did not execute tests; writer owns actual regression results. No Astra or additional writer.

### STG-CONTRACT-001 — MEDIUM / RESOLVED

First actual Chrome sweep failed6/6: upload was201, but listHTTP200 was rejected by browser TypeBox Value.Check because `expiresAt` used unregistered format=date-time. Raw UI: `后端响应格式异常。`; actual ApiClientError code `SCHEMA_INVALID`, kind=schema. First visible failure: `getByRole('button', { name: '明确丢弃暂存', exact: true })`, `Received: <element(s) not found>`, timeout5000ms, exit1. Later cases hit the same retained three-slot fixture, so absent upload/import success was a downstream symptom, not six separate root causes. Helpers PID24192/24812/13936 all exited; ports released. Raw logs/outcome/screenshots/traces preserved in ignored `test-results/staging-browser-attempt-1` before rerun.

Attempt1: replace format with explicit canonical ISO millisecond/Z pattern, keep month/day/time ranges, add browser Value.Check list contract test plus three invalid time examples. Focused contracts6/6 PASS; independent Sol High delta signoff PASS. Transaction/runtime/cleanup semantics unchanged. Fresh browser run6/6 PASS at360/768/1440,18.7s, exit0; upload/discard and Import/consumed retention all exercised. Captured own API/Vite helpers PID20220/25848 exited, Playwright25820 exit0, ports released; no unrelated process stopped or Minecraft launched. Final post-fix frozen complete check still pending; earlier692 PASS is not post-fix evidence.

## Complete regression history

Frozen-source second complete check exit0: contracts5/API611/Web76, total692 PASS, lint/typecheck/build PASS. This precedes STG-CONTRACT-001 repair; retain it as historical baseline only. The earlier mixed-source complete check failed and is not rewritten. Final complete check must include the new sixth contract test (693 expected if no other changes; actual result authoritative).

## Browser runner and residual state

Ran the existing six Playwright upload/Import cases through an ignored temporary config with webServer=[] and a captured-handle Node wrapper that directly owns the synthetic API/Vite children. This avoids the known Playwright webServer teardown ambiguity without claiming its general Windows root cause was repaired. Both initial-failure and post-fix runs closed all owned helper handles and released ports; no taskkill/unknown PID/system repair. Runner/config/results remain ignored under test-results; synthetic temporary fixtures/evidence are retained, no original Minecraft world was touched.

Consumed/terminal-journal-linked staging remains retained for startup reconciliation even when expiry passes. Unknown metadata, ownerless data and pinned evidence require inspection. A cleanup-failed outcome can be partial: refresh the list before explicit retry; directory removal may have released the quota slot while receipt removal/sync failed. Residual tree-outside receipts/tmp diagnostics are not bulk swept or interpreted as authority to remove replacement directories. This slice does not add automatic unknown-file or transaction-workspace cleanup.

Before final full check, live allowance naturally reset to98% five-hour/68% weekly (minimum68%); no reset credit redeemed. Initial entry gate was56%/72%. No three-attempt issue exhausted; each actual repair above closed on its first distinct correction.

## Final execution gate (12:24 Asia/Shanghai)

Final frozen post-contract-fix `VITEST_MAX_WORKERS=1 npm.cmd run check` exit0: contracts6/API611/Web76, **693 PASS**, lint/typecheck/production build PASS. Actual browser6/6 PASS (18.7s) at360/768/1440; both success and the earlier6/6 FAIL evidence are retained. Independent Sol High final deltas signed off source and test assertions; writer owns execution results. Latest focused upload54/54, earlier upload+Import93/93, UI7/7 and contract6/6 records are historical checkpoints, not additional invented totals.

World Archive and this staging closure meet their defined slice gates. Automatic cleanup remains default OFF; consumed/transaction/recovery/pinned/ambiguous staging stays protected. No new Java, no original-world access, no active operation or recovery created outside isolated fixtures. All browser-owned helper processes stopped and ports released; ignored runner/config/logs/screenshots/traces remain under test-results. Git retains the existing Archive plus new staging changes, no commit/push/PR. Next: P3.4 scheduled backup/retention, then P3.5 final integrated acceptance and Phase3 review; no automatic transition this run.

Final live allowance: five-hour95%, weekly68%, minimum68%. Final git diff --check exit0; branch codex/phase-3-worlds-backups,23 modified/16 untracked (includes existing Archive work). This round's code changes: upload service/routes, app/main option plumbing, shared list/cleanup contracts, upload UI, contracts/API/UI tests and one existing E2E wording assertion. Documentation: API_SPEC, ARCHITECTURE, PROGRESS, PHASE3_PLAN, Archive report/global ledger plus new lifecycle implementation/review reports. Existing Archive/Restore/core journal modifications were preserved. Original guards/journals/archives/consumed staging remain retained; ignored browser artifacts and synthetic temporary fixtures remain as evidence. No Windows/system/account/model setting change, no credit redemption, no commit/push/PR.
