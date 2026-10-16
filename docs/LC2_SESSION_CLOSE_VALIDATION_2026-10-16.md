# LC2 dedicated ACL session close — 2026-10-16

New UNWIRED session-only candidate following the completed normal inert-writer component. No store, owner-scope or member mutation wiring. Old native reports/hashes remain their historical candidates, not current-session proof. LC2 IN PROGRESS; remote PAUSED; no Git publication.

## Change

WhitelistAclSession.close(deadline?) publishes its one shared Promise before any callback/EOF/kill. A caller may only shorten the existing5s cleanup. Invalid/expired/extended inputs permanently fail cleanup before new EOF/kill, block new queries and preserve existing query5s and child40s supervision. An existing query may settle by its actual result; that cannot rehabilitate the failed close.

A valid close arranges its original exact-child timeout reaction in the remaining budget. A late event-loop timer may still request that exact child kill once, without new waiting time. A non-timer post-fence does not dispatch a late kill, nor cancel the already-arranged reaction. Only actual close clears lifetime/cleanup timers. Failure and physical closure remain separate; late exit cannot change the cached failed result.

When a trusted factory synchronously reenters valid close before returning its child, creation uncertainty rejects the existing query; no frame is dispatched. Once that exact child is returned and listeners installed, only that known child can receive the existing failure kill request. No guessed PID or unknown process termination.

No ACL rules, inspect script, JSON framing,64KiB output cap,64query limit,40s lifetime,5s query deadline, test timeout/assertion/concurrency or shared authentication helper was changed.

## Validation chronology

- Initial4files103focused PASS/exit0; initial lint/typecheck0 retained as intermediate candidate.
- Independent SolHigh review found two P2: non-timer post-fence cancelled the valid timeout reaction; valid close during factory construction did not revoke the pending query. Each corrected in substantive Attempt1 before any new native acceptance.
- Revised4files104focused PASS/exit0,6.47s (`lc2-session-close-focused-v2.log`). Includes synchronous reentry, invalid/shortened/expired deadlines, remaining query/lifetime supervision, factory reentry, late timer vs non-timer fence and actual-close timer clearing.
- Latest affected15files314 PASS/exit0,19.73s (`lc2-session-close-affected-v1.log`), including six actual Windows inert parser/pipe cases with no filesystem/ACL inspector access.
- Final lint/typecheck/build/diff exit0 (`lc2-session-close-lint-v2.log`, `lc2-session-close-typecheck-v2.log`, `lc2-session-close-build-v1.log`). Vite5.48s, existing543.14KiB chunk warning retained. Frozen4/4 (`lc2-session-close-frozen-v1.json`) unchanged after affected tests. Summary `lc2-session-close-final-v1.json`; final evidence review recorded after completion.
- Independent source/delta SolHigh P1/P2/P3=0 after the two corrections. No old owner/native probe rerun or new default/native-store PASS.
- Final independent readonly evidence/document review P1/P2/P3=0; frozen4/4 independently matched. This accepts the session-only slice, not real controller/store integration.

## Issue ledger

| Issue | Status/severity | Resolution and limits |
| --- | --- | --- |
| LC2-SESSION-CLOSE-REENTRY-001 | RESOLVED candidate / HIGH P2 | Pre-published shared result; synchronous factory close now revokes query before frame. Fake test proves zero frames and only returned exact child cancellation. No native error code; source-review finding, Attempt1. |
| LC2-SESSION-CLOSE-REACTION-001 | RESOLVED candidate / HIGH P2 | Already-admitted cleanup reaction survives failed post-fence; late actual close clears it. Fake timer and non-timer paths remain distinct. No native error code; source-review finding, Attempt1. |
| LC2-PUBLICATION-OWNER-001 | OPEN / HIGH P2 | Dedicated session drain cannot establish publication-helper lifetime, Node I/O settlement or production owner-wide quarantine. |
| LC2-CAPACITY-COMMAND-001 | BLOCKED / MEDIUM | Historical combined50s workload failure remains unchanged; maximum combined workload NOT RUN. |

Next is a new independently reviewed Fake-only envelope-bound ACL controller; public stores still acquire their own non-reentrant lease and cannot be called within an already-owned action. No default wiring, maximum-capacity, crash, real RCON or LC2 final PASS is inferred.
