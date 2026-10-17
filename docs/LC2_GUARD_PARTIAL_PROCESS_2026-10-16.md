# LC2 controlled partial Guard / fresh-process refusal — 2026-10-16

Candidate scope: controlled refusal before actual manifest-stage open, followed by owner-process death and a fresh reader rejecting incomplete evidence. No product changes. Independent pre-run SolHigh P1/P2/P3=0; final independent SolHigh evidence review P1/P2/P3=0; scoped component Gate accepted. This is not death during an actual pending syscall, active helper or arbitrary partial rename, and is not a default Store, CommandStore, physical-capacity or wholeLC2 PASS.

## Exact fault and ownership proof

Standalone explicitly confirmed script only, fresh UUID tmp manager. Writer acquires a real Manager owner and uses openOwned with trusted test constructor composition. Native Create/Move, ACL queries and every other Node operation are real. The only fault is at exact `manifest.json.stage`/`r+`, before issuing actual fs.open. It sets one fixed flag and rejects; no OS permission failure is fabricated. Already-returned real FileHandles are tracked and removed only after actual close. ACL session factory returns the actual WhitelistAclSession object without wrapping its query/Promise/timeout; all created sessions must confirm actual close.

Writer must prove source4096bytes committed, empty manifest stage, missing final manifest, fixed WHITELIST_GUARD_UNSAFE and retained/bodysettled/cancelled/held lease state. Retained logical resource count alone is not physical-drain proof: independent actual session closure and returned-handle set0 are also mandatory. Only then does it send a strict fixed14-key/4KiB nonce+role+PID checkpoint and pause without releasing its owner. Driver kills only that known fork handle and waits for actual close.

New reader acquires a new actual owner and attempts full openOwned scan. It must fail with WHITELIST_GUARD_UNSAFE and must have observed the original lstat Promise's ENOENT at the exact missing final manifest. The observer returns the original Promise unchanged and does not manufacture or swallow its error. A different preflight failure cannot qualify. Actual owner release must succeed, all actual sessions/handles close, then fixed DONE and actual reader exit0/null are required. No retry, repair, promotion or deletion of stage occurs in either Store path.

Before/after data-tree checks require identical directory/file identities, canonical paths, ordinary single-link files, exact4096 source/hash and empty stage/hash, and strict layout without final manifest. Lock-file inspection follows actual reader release/exit, as established in the committed-case harness correction. Driver's single50s work, separate shared5s fixture cleanup and5s evidence phase do not extend product50s/ACL5000ms/writer15s limits. Unknown child/owner/I/O state retains the known driver and fixture. Generic fixture removal is allowed only after both children actually close and the partial tree is proven unchanged; it is not product stage cleanup.

## Actual evidence

- Exactly one native run `lc2-owned-guard-partial-ee6994b7-dc46-47a0-9477-d7204e94973c` completed component checks in26753ms; independent external foreground exit0/27825ms.
- Writer42672: open action released; deliberate pre-open refusal produced WHITELIST_GUARD_UNSAFE, retained/cancelled/bodysettled, mutation+activity held, logical resourceCount2. Both logical entries remaining does not mean live helpers: actual helpersClosed=true and handlesClosed=true were required and observed. faultApplied=true, missingManifestObserved=false, ownerReleased=false. Intentional termination actually closed null/SIGTERM.
- Reader35136: faultApplied=false, fixed WHITELIST_GUARD_UNSAFE, exact final-manifest ENOENT observed, actual helper/handle closure, owner released, actual process exit0/null. It never rewrote the incomplete Guard.
- Each emitted exactly one valid IPC message; stdout/stderr bytes0, protocolFailed=false. Both actual child closes, strict before/after partial trees and release-time lock check passed. Native source18/18 and external frozen27/27 match; successful fixture removed and absence verified. No previous failed fixture removed.
- Source/syntax/targeted lint exit0. Product files remain byte-identical to the accepted owned Guard50 focused/408 affected/lint/typecheck/build candidate; those are the same candidate's evidence, not a new full regression. Native scripts are explicit and outside automatic test collection. No full-project regression for the current LC2 integration; old default/crash/capacity BLOCKED records unchanged.
- Ignored reports/logs: `test-results/lc2-owned-guard-partial-ee6994b7-dc46-47a0-9477-d7204e94973c.json`, `lc2-guard-partial-frozen-v1.json`, `-native-v1.log`, `-native-exit-v1.json`, `-final-v1.json`. No native retry or product repair attempt was needed in this case.

## Remaining Gates

| Gate | State |
| --- | --- |
| Normal retained publication / normal owned Guard | Accepted scoped component evidence |
| Committed Guard + owner death + new reader | Accepted scoped component evidence |
| Controlled pre-open refusal + owner death + new-reader fail-closed | Accepted scoped component; final independent SolHigh P1/P2/P3=0 |
| Actual pending Node I/O / active helper death | NOT RUN for owned Guard integration |
| Default Stores / CommandStore action migration | Unchanged / pending |
| Maximum physical Guard/combined Command capacity | NOT RUN; historical deadline BLOCKED retained |
| Fresh whole-project frozen Final Gate / member API and real RCON | NOT RUN / UNWIRED |

Remote remains PAUSED; no real credentials, Minecraft, user world, network or global system change. No commit/push/PR. This bounded negative case does not clear a product recovery state or authorize member changes.
