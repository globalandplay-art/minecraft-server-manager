# LC2 envelope-bound ACL controller — 2026-10-16

UNWIRED Fake-only binding/lifecycle candidate. Not a real ACL child, scoped-store, publication, member API or real RCON PASS. LC2 IN PROGRESS; remote PAUSED; no Git publication.

## Implemented boundary

WhitelistEnvelopeAclAction owns one internal one-shot WhitelistActionEnvelope using the exact same owner/root. Only after the envelope takes its real mutation/activity lease does it capture owner.nativeAclChildWrapper for that epoch. A private Controller borrows the capability; no nested WhitelistAclScope.run or public store method is called, and no Fake reentrant owner is substituted in product code.

The body gets only a frozen four-method ACL facade: verify, verifyMany, verifyNativeSnapshot and quiesce. No owner, raw capability, wrapper, factory, token, release or default inspector entry is exposed. Trusted constructor-injected Fake session composition is not an HTTP/environment switch. Production main has no caller.

Every controller failure synchronously invokes its private cancellation hook on that sole envelope, even if malformed input or a rejected snapshot occurs before any session exists. Catching the returned error cannot rehabilitate admission. Errors contain a fixed code only. Existing ACL validation and one pinned SID are reused across snapshots, rotation and quiesce.

Each session factory attempt is registered before invocation as a lifetime resource. Normal lifetime success settles only after actual close and all raw query promises settle; query replies are independent. A factory throw remains unknown and retains the owner. Failure cleanup rejects the lifetime result but separately checks physical close/raw settlement, never assuming rejection means exit. Normal body completion is wrapped with idle quiesce and registered-resource retirement; unawaited/overlapping queries poison the action. Physical drain may release a failed action, but cannot turn it into success. Unknown drain retains mutation/activity and reports CLEANUP_BLOCKED.

One logical query deadline is min(work deadline, now+5000ms), covering retirement, startup, raw reply and ACL snapshot verification. Healthy rotation retains32query/20s thresholds;64query/40s lower session ceilings remain. Combined query/new-child units are charged before retirement/factory, never reset/refunded by quiesce. A final threshold fence after synchronous owner/health checks catches crossing20s before dispatch. An expired query never receives a replacement deadline. Shared outer5s cleanup remains unchanged; quiesce closes only ACL children and cannot release the owner itself.

## Validation and chronology

Intermediate focused3files61 PASS and71 PASS retained. Source review found one P2 group: threshold could cross during synchronous validation and a replacement unit was reserved only after retirement. Substantive Attempt1 adds the final threshold fence and reserves query+child before any healthy retirement; three owner/health/exhausted-budget tests verify it. Final focused3files74 PASS/exit0,827ms (`lc2-envelope-acl-focused-v3.log`). Source/delta independent SolHigh P1/P2/P3=0.

Cases include one lease/no helper for empty body, fixed facade, exact batches, normal idle-child close before release, caught pre-session failures, SID continuity, healthy rotation, shortened remaining query budget, no replacement after deadline, combined budget, caught query failure, unknown factory, unawaited raw settlement, unconfirmed close, owner drift, escaped facade/context, overlapping queries/actions and synchronous deadline cost. The new controller itself has only Fake sessions in these cases; lower-layer inert parser tests do not establish real controller binding.

First frozen6-file manifest v1 and affected16files343 PASS/18.11s retained. Lint v1 exit1 found three unused Fake parameters (no product or assertion failure). Attempt1 explicitly consumes those arguments with void; no behavior/contract change. The new frozen manifest `test-results/lc2-envelope-acl-frozen-v2.json` was then used for fresh affected16files343 PASS/exit0,18.29s (`lc2-envelope-acl-affected-v2.log`);6/6 unchanged afterward. Final lint v2/typecheck v3/build v1/diff exit0, build5.54s, existing543.14KiB chunk warning retained. Summary `lc2-envelope-acl-final-v1.json`. Final independent evidence review is requested separately. No complete-project regression or controller-native run is claimed.

## Issue ledger

Final independent readonly candidate/evidence/document review P1/P2/P3=0; six hashes independently matched and no production caller found. Acceptance is the UNWIRED Fake-only binding/lifecycle scope above.

| Issue | Status/severity | Evidence and boundary |
| --- | --- | --- |
| LC2-ENVELOPE-ACL-ROTATION-001 | RESOLVED candidate / HIGH P2 | Source-review finding; final pre-dispatch threshold and atomic query/child reservation, Attempt1. Fixed-budget owner/health tests pass. No runtime OS error code. |
| LC2-ENVELOPE-ACL-PREFAIL-001 | RESOLVED design / HIGH P2 | Private synchronous fail hook poisons the envelope before returning caught input/snapshot errors, including zero-session case. No public bypass. Fake coverage only. |
| LC2-ENVELOPE-ACL-LINT-001 | RESOLVED / LOW | Lint v1 exit1, @typescript-eslint/no-unused-vars for three Fake parameters; explicit void uses only, Attempt1. New lint and fresh frozen343 affected PASS. Original failing lint preserved. |
| LC2-PUBLICATION-OWNER-001 | OPEN / HIGH P2 | No Node I/O or Create/Move publication migration; old default helpers remain outside this borrowed controller. |
| LC2-ENVELOPE-RELEASE-001 | Explicit limitation / HIGH | No owner-wide quarantine for released-then-throw uncertainty. Default integration remains barred. |
| LC2-CAPACITY-COMMAND-001 | BLOCKED / MEDIUM | Historical PHYSICAL_CAPACITY_OBSERVATION_DEADLINE/exit1 remains, exact historical failing step UNKNOWN; maximum combined history NOT RUN. |

## Next gate

Freeze and independently accept affected/source evidence first. Next choose and review either a minimal isolated normal real ACL/rotation probe or the Node task/publication lifetime foundation; do not nest existing store locks or bypass descriptor/ACL/hash checks. Actual controller/native ownership, store publication, parent-death/crash and maximum capacity need their own evidence before member writes can be enabled.

Independent concrete-owner inspection narrows the generic release limitation: current ManagerLifetimeLock mutation/activity release closures only update internal synchronous state and contain no external callback/await. No observed product defect justifies adding shared authentication quarantine now. Future production composition must use the actual acquired ManagerLifetimeLock object, not an injected release adapter. Generic Fake released-then-throw tests still document uncertainty without claiming global exclusion. Native acquire/owner.release ownership-unknown remains subject to the existing fatal-ownership contract. Publication/helper lifetime remains a separate OPEN P2.
