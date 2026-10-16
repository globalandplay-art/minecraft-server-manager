# LC2 normal owner/envelope/inert-writer validation — 2026-10-16

Limited component PASS. LC2 member writes remain UNWIRED and LC2 IN PROGRESS. No real server, RCON, world, credentials, remote provider or network operation was performed. No commit/push/PR.

## Candidate and execution

Run `lc2-envelope-writer-c6a9cd7c-3862-4db4-ad43-a78c44e5055f` executed exactly once using the explicit isolated confirmation flag. A fresh printed and confirmed canonical tmp root was used. The native helper payload emitted only fixed inert JSON; no Create/Move or Node publication payload was executed.

The real owner was acquired; its one-shot action envelope registered the owner-wrapped native writer before dispatch. The writer actually closed with exitCode=0/exitSignal=null. The envelope finished with primary=null, phase=released, mutation/activity=released, bodySettled=true and resourceCount=0. The owner was explicitly released and assertHeld subsequently rejected. All probe I/O settled, activeSteps=0, fixtureRemoved=true and cleanupBlocked=false. A separate readonly check confirmed fixture absence and no matching test/probe process.

Component elapsed5723ms. External foreground execution completed with actual exit0 and wall8.2312551s; the component report deliberately cannot self-prove its own process exit. Work timing starts at CLI body entry after module startup. No timer, assertion or security check was relaxed.

## Preserved evidence and checker correction

All evidence is private/ignored under test-results; nothing was overwritten:

- Original component report: `lc2-envelope-writer-c6a9cd7c-3862-4db4-ad43-a78c44e5055f.json`; result COMPONENT_CHECKS_PASS, SHA-256 `6a2e84130bd967d273154bea92f2ae2726730fdd670ec3f7ad934aa26cebf81d`.
- External checker v1: same prefix plus `-external-v1.json`, BLOCKED; SHA-256 `0344c86d84b0fc691c5033bcba92ceea10eaf9cd0dc1f15c268afb3c35365334`. It incorrectly required the internal hash list to be a subset of the external frozen manifest. Predicate internalHashesMatch=false; NO_EXPLICIT_ERROR_CODE. This was not a native process failure. Its surrounding shell continued to print the JSON, so the aggregate shell exit is not a standalone checker exit receipt.
- External checker v2: same prefix plus `-external-v2.json`, PASS. Only the evidence predicate was corrected; no source change or native rerun. External pre-frozen13/13 and internal/current10/10 are independently recorded. The extra internal file whitelist-acl-session.ts was NOT independently included in the external pre-freeze; it is unchanged from HEAD and the writer imports its type only. No claim of14 pre-frozen files.
- `lc2-envelope-writer-native-frozen-v1.json` and `lc2-envelope-writer-native-launch-v1.log` preserve the candidate and foreground execution.

Independent authorized SolHigh evidence review accepted this correction and the narrow normal component PASS, with no new P1/P2. Checker P3 resolved by v2; v1 remains BLOCKED history.

## Affected validation

Latest affected suite:15 files/301 PASS, exit0,17.72s (`lc2-envelope-writer-affected-v1.log`). It covers envelope/resource accounting, writer/payload, ACL session/transport/scope/rotation/budget, owner retention, command store/policy/coordinator and sibling/inert protocols. This is not a full-project or default native store PASS.

Standalone lint/typecheck/build all exit0 (`lc2-envelope-writer-lint-v1.log`, `-typecheck-v1.log`, `-build-v1.log`). Existing Vite543.14KiB chunk warning retained; build5.91s. Diff check exit0. Earlier envelope-only283 PASS and intermediate writer94 PASS remain historical evidence. Final combined evidence/document signoff is separately requested; no new full-project PASS is claimed.

## Issue ledger and remaining gates

| Issue | Status/severity | Evidence and next boundary |
| --- | --- | --- |
| LC2-PUBLICATION-OWNER-001 | OPEN / HIGH P2 | Default private-publication Create/Move helpers still do not retain owner handles. An inert child proof does not close publication lifetime or Node I/O accounting. |
| LC2-ENVELOPE-RELEASE-001 | Explicit limitation / HIGH | Release may occur before a callback throws; no owner-wide quarantine proof. Source reports release-uncertain and cannot claim exclusion. Production integration not accepted. |
| LC2-WRITER-CLEANUP-001 | RESOLVED candidate / HIGH | Pre-run review caught expired close clearing the original work timer. The expired drain now preserves the original15s work timer and exact-child kill request; actual close clears it. Fake boundary tests and source delta passed before native execution. No timeout increased. |
| LC2-CAPACITY-COMMAND-001 | BLOCKED / MEDIUM | Historical combined workload PHYSICAL_CAPACITY_OBSERVATION_DEADLINE/exit1 retained. Exact historical failing step UNKNOWN. Cold-open and root-limit results remain narrower proofs. |
| LC2-NATIVE-CHECKER-001 | RESOLVED evidence / LOW P3 | External/internal manifest scopes differed; v1 rejected an absent map entry. v2 compares each scope directly without changing native evidence or claiming extra pre-freeze. |

Borrowed-lease ACL controller, scoped stores, real publication lifetime, parent-death/crash, default guard and maximum combined capacity Gates remain OPEN/BLOCKED. No UI/API member mutation is enabled. Next is independent design/source review of an UNWIRED borrowed controller, preserving exact owner/ALS identity, query/child budgets, close evidence and shared cleanup; never nest the non-reentrant mutation lock or substitute a Fake reentrant owner.
