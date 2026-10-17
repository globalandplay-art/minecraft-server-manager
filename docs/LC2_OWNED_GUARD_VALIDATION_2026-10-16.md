# LC2 owned GuardStore normal component — 2026-10-16

UNWIRED candidate. Source/delta and native pre-run independent SolHigh P1/P2/P3=0; final independent SolHigh evidence review P1/P2/P3=0; normal component Gate accepted. A normal real Windows Store roundtrip and new affected regression have passed. This is not wholeLC2, default Store, crash or maximum physical-capacity PASS. Member writes remain UNWIRED, remote PAUSED, LM1/LM2 NOT STARTED. New changes uncommitted; prior GitHub checkpoint77881234db22e5c17d7372ee00c4da2dc855aa11 remains remote HEAD.

## Store integration

`WhitelistGuardStore.openOwned` is a trusted alternative with no production caller. Default `open`, authentication publication and CommandStore retain their existing paths. Each owned entry starts exactly one real envelope/mutation/activity action; initialization captures immutable physical root identity and namespace state inside its first action and scans internally, never by nesting the public scan method. All later operations compare that root and namespace, including a final Store gate. An externally appearing namespace is not adopted.

The private executor retains one strict WindowsPrivateAclVerifier across actions, preserving its SID pin. Each fresh action receives that instance internally; no setter/verifier, owner, release or raw capability is exposed by the frozen five-method storage facade. The old ACL-only/frozen two-method publication contracts remain. Owned Store legacy publication/ACL properties explicitly reject all calls; default Store properties are unchanged. Owned diagnostics contain fixed envelope status only.

Reads, metadata, canonical identity, directory lists and publication use registered whole tasks with pre/post fences and actual descriptor closure. Stored reads keep one descriptor across ACL-after and final handle/path/time checks. Each stored file retains the original two three-path ACL batches. Exact NUL-separated dev/ino/birth/bytehash fingerprints, known-file memory, manifest/source/revision/identity validation, complete layouts, chunk limits and two directory listings remain. Publication uses the retained component; no generic alreadyLocked/no-op release or reentrant Fake owner was added to product code.

Only Store-generated pre-mutation capacity/conflict outcomes may return as internal tags from a healthy action. They become DomainErrors after successful quiesce, actual drain/release and final admission checks. Poison, deadline or unknown cleanup wins over those tags; unknown settlement prevents future Store admission and retains the owner. Source bytes are synchronously copied; the publication task holds its own copy until raw writes and finally close settle.

## Bounded budgets

Guard limits remain1000 histories,64chunks/256KiB,4096bytes/file. No action splitting resets the combined262144 budget. Directory identity repeats original physical checks without additional ACL queries. Directory listings add two directory ACL batches; each file uses two complete batches, not publication's four-query readback path.

- Largest open: `1000 * (65 * 2 + 4) + 4 = 134004` logical queries;32-query healthy rotations plus at most two additional20s time rotations within50s give at most138194 units.
- Largest create with999 prior maximum guards:133870 scan queries +2 directory +65*13 publication +130 immediate stored-read +130 final verification +4 directory queries =134981. Count-based/time rotations and at most131 extra native-quiesce restarts give at most139333 units. Conservative150000 remains below262144.
- The Fake test observes40queries for a one-chunk create and8 for one subsequent verify, including exact per-file two three-path batches; a separate256KiB/64chunk exact roundtrip passes. These arithmetic/content checks do not establish that maximum physical history completes within50s.

## Validation

- Compatibility before new tests:4files114 PASS/8.12s. Owned focused v1:4files124 PASS/7.14s.
- Focused v2:46 PASS/1 FAIL, exit1. The new empty-namespace replacement fixture accidentally included an empty UUID directory, so open correctly rejected missing manifest before reaching the intended fault. Attempt1 prepares only the namespace and triggers replacement after the entry gate; both list snapshots see the new identity but final Store gate rejects. No product assertion/timeout was relaxed. v3:47 PASS/2.70s; final v4:50 PASS/exit0,2.92s.
- Source review found two P2: legacy helpers attached to the owned Store, and missing final Store physical gate. Each fixed Attempt1 in the owned branch only, with negative tests; independent delta0. Prior design P2 for persistent SID and worst-case query accounting also resolved in source/Fake. No runtime OS error code for these review findings.
- Lint v1/typecheck v2/syntax/diff exit0. Frozen25-file candidate precedes the native execution; post-run25/25 match. API typecheck covers src; Vitest executes tests. Build result is recorded in the final receipt after completion.
- Exactly one fresh normal native run: `lc2-owned-guard-03da5332-f700-4743-b8ae-c542f0b3dd7b`. Real default ACL/native/Node I/O and concrete owner, no injection.4096-byte synthetic valid whitelist plus manifest; open/create/verify/same-owner Store reopen/scan each reports body settled/resources0/mutation+activity released, primary null. Native/source18/18 unchanged. This is normal same-owner Store reopen, not Manager process restart.
- Component29233ms; external actual foreground exit0/30355ms. Owner released/assertHeld rejected; exact byte and manifest hashes verified, no stage; strict fresh fixture cleanup completed and absence verified. Native report and separate foreground receipt remain distinct. No real credentials, user worlds, Minecraft, RCON, network or global system changes.
- Fresh affected19files408 PASS/exit0,47.05s. No whole-project regression for this candidate. The old default native Guard/crash and combined physical-capacity failures remain historical BLOCKED; unchanged default paths have not been rerun as an unexplained retry or silently replaced by this new component.
- Ignored evidence prefix `test-results/lc2-owned-guard-`: frozen-v1.json, focused/compatibility/static/affected logs, UUID native report, native-v1.log, native-exit-v1.json and final-v1.json. Native execution was not repeated after the diagnostic checker issue below.

## Issue ledger

| Issue | Status / severity | Evidence / next action |
| --- | --- | --- |
| LC2-OWNED-GUARD-LEGACY-001 | RESOLVED candidate / P2 | Owned object carried usable old helper properties; explicit frozen deny methods, four no-side-effect checks. Attempt1; source delta0. |
| LC2-OWNED-GUARD-FINAL-001 | RESOLVED candidate / P2 | Empty namespace replacement could become each list's new baseline; final Store gate rejects, baseline never reset. Attempt1; source delta0. |
| LC2-OWNED-GUARD-SID-001 | RESOLVED design/source / P2 | Private executor persists strict verifier across actions; SID-change negative test. |
| LC2-OWNED-GUARD-BUDGET-001 | RESOLVED logical design / P2 | Two file ACL batches and full open/create formulas; physical capacity remains NOT RUN. |
| LC2-OWNED-GUARD-FIXTURE-001 | RESOLVED / LOW | Focused v2 exit1, WHITELIST_GUARD_UNSAFE during openOwned because test precreated an incomplete UUID directory. Exact fixture correction only; v3/v4 pass. |
| LC2-OWNED-GUARD-CHECKER-001 | RESOLVED diagnostic / LOW | First PowerShell receipt checker did not execute: exit1, ParserError/MissingInInForeach (`foreach($r in$run.hashes)`). Attempt1 restores required whitespace; frozen25/native18 and actual exit/fixture proof checked without rerunning native. |
| LC2-SOURCE-LOOKUP-004 | RESOLVED diagnostic / LOW | Literal wildcard argument produced rg os error123; bounded directories plus -g located actual references. No product operation. |
| LC2-PUBLICATION-OWNER-001 | Partially verified / P2 | Normal retained publication and Store passed; active parent-death/crash still open. |
| LC2-CAPACITY-COMMAND-001 | Historical BLOCKED / MEDIUM | PHYSICAL_CAPACITY_OBSERVATION_DEADLINE/exit1 retained, exact old step UNKNOWN. Maximum native Guard/combined Command histories still NOT RUN. |

## Next boundary

Independently accept this scoped evidence, then add fresh-process committed/partial Guard recovery proof under a reviewed isolated harness. Normal same-owner reopen is insufficient. Keep active-helper/Node-I/O interruption distinct from post-commit parent death. Do not switch default Stores, begin member command/API/UI writes or infer maximum physical capacity from the Fake formulas. CommandStore migration must preserve its root receipts, namespace anchors, hashchain witnesses, scan capacity and no-TTL replay under its own single action; no outer held-action wrapper.
