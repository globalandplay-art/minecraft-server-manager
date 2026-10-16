# P7.2b native publication timeout investigation — 2026-10-14

Status: BLOCKED. Historical full regression failure not reproduced by the single targeted observation; no underlying repair, attempts0/2. No real credentials, Minecraft, Tailscale or network changes. No new full-regression signoff.

## Historical failure and static chain

Preserved full log: `test-results/p72b-remote-auth-mv6nxijr-full-check.log`.

- `apps/api/test/auth/credential-writer.test.ts:23:3`, native initialization/reset backup scenario:180010ms.
- `apps/api/test/auth/credential-writer.test.ts:43:46`, before-publish interruption/explicit recovery scenario:180007ms.
- Both raw errors: `Error: Test timed out in 180000ms.` npm exit1, no native error code/HResult/helper category or stage in that full log.

Fixture includes `mkdtemp/mkdir -> ManagerLifetimeLock.acquire -> action -> restore mocks -> lock.release -> rm`. Test23 includes init, reader/password verification, rejected init/reset, valid reset, exact backup/current bytes, per-file ACL checks and deliberate broad-ACL rejection. Test43 includes init, reset interruption, reader rejection, preserved backup, explicit recovery, committed revision and pending-file absence. These are asynchronous multi-step scenarios, not one ACL invocation.

`CredentialWriter.publish/recover -> gate/record/expectCurrent/commit -> private-publication + WindowsPrivateAclVerifier -> native helper`; lock acquire/release also use native helper. ACL helper remains5000ms/64KiB, native publication helper15000ms/16KiB; no limits changed. Native creation/publication/lock scripts use Add-Type, while ACL query script does not. Existence of compilation does not prove it caused either timeout.

Installed Vitest runner `withTimeout/withCancel` rejects its wrapper/aborts the test signal; the fixture/action/native helper do not consume that signal. Therefore test timeout alone is not proof the underlying action and fixture completed. No current evidence proves historical background overlap, lock/cleanup failure or eventual publication state. Do not delete unknown fixtures or terminate unknown helpers.

## Single bounded observation

Run: `p72-native-observe-d6ce4d54-12ab-4f77-9abc-fa8ffb170f65`.

Only the first failed scenario was selected by its full test name. Existing maxWorkers2 retained; only one file/test selected, so this does not reproduce full-suite load or cross-worker contention. Six unrelated cases excluded by name filter; no test source or assertion changed.

Test-only execFile wrapper forwarded the original executable/arguments/options/callback values unchanged. Node hrtime records anonymous call/fixture identity, spawn observation, callback category, exit and close. It does not modify helper scripts, stdout/stderr or output buffers. Events are memory-bounded4096; no original output, paths, ACL data, passwords or encoded commands recorded. Internal PowerShell timing remains UNKNOWN. Temporary fixture-specific rm guard permits only10s cleanup wait for that fixture's tracked children, retains directory on uncertainty, does not extend test/helper limits. No cleanup wait was required by this run's final state.

- Test PASS, exit0,148351ms; file148354ms, runner148.78s.
- Helper calls52; cumulative call-to-callback147014.1005ms; maximum3460.5519ms.
- Worker maximum active helpers1; no cross-worker concurrency claim.
- Helper-timeout0; event overflowfalse; final tracked children0.
- Fixture cleanup-enter -> cleanup-complete recorded; all52 children close recorded.
- Native source/test/config fingerprints8/8 unchanged.
- Temporary setup/config/reporter entry files removed after run; copies preserved inside evidence root. No production/test source instrumentation remains.

Evidence: run.log, run.json, tests.json, worker JSON, summary.json, helper-summary.json, freeze-before/after.json and observation source copies under `test-results/p72-native-observe-d6ce4d54-12ab-4f77-9abc-fa8ffb170f65/` (Git ignored).

## Conclusions and limits

CONFIRMED: this successful first scenario spends almost its entire elapsed time in many serialized helper calls. Test/helper timeout standards and permission checks are unchanged; owned cleanup completed in this observed run.

PROBABLE: cumulative helper costs leave limited180s budget and may explain sensitivity to full-run conditions. Earlier preserved successful sampling also recorded52 calls/159.2s and54 calls/161.3s for these scenarios. These are separate historical runs, not timing from the failed full suite.

UNKNOWN: exact failed-full-run last stage; per-helper timing in that failed run; startup versus script execution contribution; concurrency/resource causation; historical delayed callbacks/cleanup; whether second failed case has the same immediate cause. The current observation cannot mark either historical failure RESOLVED.

Minimum next step: independently review preserving each full publication/interruption/recovery invariant while reducing scenario overaggregation or safely reducing repeated helper launch costs. No permission checks may be removed, unsafe pooling introduced, or timeouts raised. A second run without an evidence-driven change is not a repair and cannot establish final PASS. New frozen full regression remains required after any accepted substantive correction.

Issue REMOTE-AUTH-NATIVE-TIMEOUT-001: HIGH/BLOCKED, historical error above, repair attempts0/2. P7.2b production prerequisites and real remote authorization remain unchanged.

## Recovery-chain observation and limited test candidate

Second, distinct target run: `p72-native-recovery-observe-d62c19f5-9ecf-4401-ab35-68037dc313d1`, before-publish interruption/recovery only. PASS156224ms, exit0.54 helper calls/155258.5268ms cumulative, maximum3531.0491ms, active helper maximum1, remaining children/stages0, overflowfalse, fixture cleanup complete. All8 source/test/config hashes unchanged. No script/output instrumentation; PowerShell internal stages UNKNOWN. Temporary entry files withdrawn, exact observation copies retained in that evidence root.

Fixed Node stage observations: init success38128.6101ms; reset expected failure53346.085ms; reader-open success2974.3164ms; pending reader-read expected failure0.4153ms; recover success49172.4787ms; recovered reader-read success6634.0927ms. Original assertions prove injected interruption and exact recovery behavior; stage labels alone do not identify the injected error or helper's internal phase. Historical full-run failure remains not reproduced.

Independent observer review identified a P2 before reuse: blocked cleanup returned a resolved rm Promise. It did not occur in the first successful run. Fixed Attempt1 by retaining directory and throwing fixed CLEANUP_BLOCKED; final hook also records and hard-fails on pending children, pending observed public stages or overflow. Independent Sol High delta review P1/P2/P3=0. This is observation-layer repair, not native product repair. Pending-stage/child records are bounded evidence; no claim that cancellation automatically drains transactions.

Limited test candidate: first native scenario's final static file/directory ACL checks use existing verifyMany in batches<=8 instead of one helper per file. Every original target and every64-digit digest assertion remains, with added count check; broad-ACL negative remains. Product code, timeouts, concurrency and before-publish scenario unchanged. Independent Sol High static review P1/P2/P3=0. Original runner targeted verification PASS/exit0,143.87s test duration,144.34s runner; no observation hooks. This is test launch-overhead reduction Attempt1; it cannot be claimed to fix the second failure or prove the historical root cause. Native product repairs remain0/2.

## New frozen full regression

Candidate prefix: `p72b-native-batch-93f50be1-6cf1-4317-a929-12c40898a9b3`.350 source/test/config files frozen; end-of-run350/350 unchanged. `npm.cmd run check` with original maxWorkers2: exit1. Contracts13 PASS; API1461 PASS/1 FAIL (90 files,653.25s); Web163 PASS. All native credential-writer cases passed in this full run. Lint/typecheck passed; production build NOT RUN because test stage failed. No claim that the historical native timeouts have a confirmed resolution.

The new independent failure is `apps/api/test/addon-inventory.test.ts:36:67`, `binds revision to physical file identity even when replacement bytes are identical`: `AssertionError: expected '0b3c3672ea0b3c333e1f34f2fcfca4d1b0fd6…' not to be '0b3c3672ea0b3c333e1f34f2fcfca4d1b0fd6…' // Object.is equality`. Log preserves original wrapped text. No errno/HResult; runner exit1. This is revision equality, not unsafe-read exception. This Addon source/test was not modified by the batch candidate.

### ADDON-FILE-IDENTITY-001 — HIGH/BLOCKED; exact historical cause UNKNOWN; repairs0/2

Current shared reader uses Number Stats dev/ino and birthtimeMs for file identity and Number dev/ino for physicalIdentity. Precision loss is a real code-level risk when IDs exceed2^53; hashing cannot recover rounded information. It remains a hypothesis for the failed real test, not proven by that log.

Single synthetic proof: `test-results/p72-file-identity-proof-b4d0f900-358e-4654-b4ff-a3e1f03ec47f.json`. Fresh owned UUID fixture, exact installed/replacement sequence, both files coexisting and opened-handle bigint identity validated. `exactIdsDifferent=true`, `numberIdsSafe=false`, `numberIdsEqual=false`, `legacyIdentityEqual=false`, `revisionEqual=false`; replacement exact ID preserved, bytes/checksum same, preciseBirthtimeEqual=true. Hypothesis NOT REPRODUCED in this single sample. File handles closed and owned fixture removed; no original world or existing transaction accessed. No repeated proof or root repair performed.

Do not silently replace the shared identity hash: properties schema6 source/guard identities and Addon install schema7 checkpoints persist old hashes; lifecycle has another Number-based implementation and schema8 receipts/journals. A global change can make unchanged historical resources fail reconciliation. No checksum fallback, accepting arbitrary old/new hash, rewriting journal, forced recovery or unsafe migration is allowed. Lossless opened/named/after checks and explicit persisted-identity version/compatibility semantics must be designed before any coupled source change. Whole candidate/P7.2b remains BLOCKED.
