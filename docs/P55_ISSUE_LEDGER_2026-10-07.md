# P5.5 issue ledger

## Phase 5 overall closure — 2026-10-08

Overall Final Gate PASS, independent Sol High review/delta P1=0/P2=0; two existing nonblocking P3 limitations recorded in [final gate](./PHASE5_FINAL_GATE_2026-10-08.md). P55 real evidence remains immutable. Overall review found one P2 capacity root across Restore count/bytes, target entries and Trash entries; minimal checks plus post-scan identity order resolved it, verified by 64 lifecycle tests and new frozen 1184-test complete check. Fixture ERR_ASSERTION failed/interrupted and journal count 1/2 failures, and helper ERR_MODULE_NOT_FOUND invocation error, remain preserved in ignored logs and final report. No unresolved blocking issue, Minecraft launch, original-world access or Git mutation in this closure. The previous scoped P5.5 P3=0 conclusion remains accurate for that narrower review.

## Latest scoped closure — 2026-10-08

P5.5 real isolated acceptance and independent GPT-6.1 Sol / High evidence review: **PASS; P1=0, P2=0, P3=0**. This closes the interrupted review, not the overall Phase 5 Final Gate.

| Evidence | Paper | Fabric |
| --- | --- | --- |
| PASS run | `p55-paper-bf6c7480-b3c8-481f-937e-d446086a9266` | `p55-fabric-2fe6b07e-dce6-46ec-9e1d-ba19f0db9232` |
| Report SHA-256 | `9340b14bd4b2944e0d3c5bed7fddbf3bb6b5195396c8bc6d204c16018d3e14a8` | `abe0889ee97ad609bba60da0a180da9663503c4390e3f46cb1d5c41e3471290f` |
| Explicit launches / addon mutations | 7 / 8 | 7 / 8 |
| Guard payload files independently checked | 1,480 | 760 |
| Current unchanged source whitelist files | 107 | 51 |
| Final stopped / source unchanged / helpers closed | true / true / true | true / true / true |

Evidence roots: `.manager/<PASS run>/evidence`; root/evidence report copies have identical hashes. Full original logs, manager events, 22 successful durable operations and 16 committed transactions were reviewed. All 16 guards are pinned/complete with matching owner/root/directory identities, manifests and individual payload hashes. Each mutation's same-key replay and Manager recreation preserve the original operation; no implicit launch occurs. Native Paper RCON plugins and Fabric loader lists agree with per-run initializer markers: baseline absent, installed present, disabled absent, enabled present, trashed absent, restored-enabled present, restored-disabled absent. Final disabled files, trash/restored receipts and consumed upload references match the journals.

All 14 launches have healthy Done/RCON/list/world/ports, normal explicit Manager shutdown, exitCode=0, exitSignal=null, and final diagnostic gates. No crash reports, failures, active operations or recoveryRequired remain. Source identities/hashes and Java identity remain unchanged; original user worlds were not accessed. This continuation started no server and ran no new tests; no product changes or Git mutation occurred.

| Issue / historical checkpoint | Closure |
| --- | --- |
| P55-HOST-ENV-001 | Original Desktop environment failure remains historical BLOCKED; ordinary host fresh PASS runs satisfy the acceptance precondition without claiming the Desktop issue was repaired. |
| Paper diagnostic evidence association, terminal precision | Scoped classifiers/regressions were reviewed previously; the new Paper PASS closes real acceptance. Earlier BLOCKED runs remain unchanged. |
| Fabric JOML 1.10.8 classifier gap | Attempt 1 scoped classification/review passed; new Fabric PASS closes real acceptance. Earlier Fabric BLOCKED remains unchanged. |
| P55-LOAD-PROOF-001 / P55-TRANSACTION-PROOF-001 | RESOLVED, independently verified against actual native loading, durable journal/replay and physical guard payload. |
| Final evidence Review usage-limit interruption | RESOLVED: remaining physical checks and independent signoff completed on 2026-10-08. |

Nonblocking limitations: reservations are released before Java binds, with conflict checks at each launch; this acceptance does not cover sudden power loss or player sessions; Manager is in-process with API/operation event evidence rather than independent Manager stdout. No P3 finding was raised. Historical tables/NOT RUN/BLOCKED below describe their original checkpoints and are not current status; no historical report, log or SHA was modified. Phase 5 Final Gate is pending explicit user authorization; no commit/push/PR in this closure.

User override: maximum **2 substantive repairs per root cause**; second failed verification means STOP / HARD BLOCKER. Security uncertainty keeps real execution stopped until independent review. No commit, push or PR.

| Root cause | Original evidence | Repairs | Current verification |
| --- | --- | --- | --- |
| Missing Paper/Fabric lifecycle wiring | `local-config.ts` required Vanilla; `ServerService` globally blocked all non-Vanilla lifecycle/commands | 1 implementation of previously missing design | Shared trusted lifecycle predicate; focused tests pending final independent signoff |
| Fabric execution identity did not bind the actual bundle/loader/dependencies | detector only inspected `versions`; actual unattended launcher executes `.fabric/server` and manifest Class-Path | 1 implementation; review closure additions are recorded below | Exact descriptor identities, hashes and parent identities required by registration/start/addon capture |
| First new test fixtures appended malformed ZIP bytes | `p55-core-focused-v1.log`: `Invalid comment length. Expected: 7. Found: 0`; six assertions used malformed replacement | 1 | Fixture now adds a valid ZIP comment; subsequent focused v2 46/46 and v3 74/74 PASS |
| First new test attempted `rm` on an empty directory without recursive flag | v1 `EISDIR` for its own temporary `versions/26.3` directory | 1 | Correct fixture cleanup; v2/v3 PASS |
| Fabric ambiguous Properties/manifest parsing and resource overrides | Independent review: Java last-property and manifest semantics differed from first-match parsing | 1 | Strict two-property grammar, duplicate fields/metadata rejection and resource override refusal; v3 74/74 PASS |
| Fabric outer/transitive Class-Path and late ambiguous versions | Independent review: unbound recursive classpath and only initial member-set check | 1 | Outer/nested nonempty Class-Path refused; final versions set rechecked; v3 74/74 PASS |
| Fabric missing binding migration bypass | Independent review: optional-field test skipped the new physical binding | 1 | All Fabric addon captures require nonempty execution binding; missing/null negative tests PASS in v3 |
| Paper manifest execution ambiguity | Frozen independent review: duplicate Main-Class / duplicate manifest ZIP / outer Class-Path could disagree with Java | 1 | Paper high-confidence evidence now comes from descriptor-verified strict metadata and rejects all three inputs; v4 focused rerun in progress |

No real server launch has occurred at this checkpoint. Previously accepted EULA/source root/Java 25.0.4.1 were read-only verified; source worlds, properties, plugin/mod directories and user configuration contents were not read. Complete source dependency whitelist/hashes and fresh isolated harness remain pending. Historical synthetic evidence is not real acceptance.

## Desktop continuation — pre-run closure and host blocker

The paragraph above is the historical CLI checkpoint. Latest evidence now confirms focused v4 77/77, manifest v7 44/44, and frozen check v1 exit 0: contracts 6/API 1040/Web 131 = 1177. Product files were not changed during this continuation, so that product baseline remains applicable. Host-boundary v1 was FAIL (`ERR_ASSERTION`: SwitchParameter `{IsPresent:true}` versus boolean); v2 is PASS, not a rewrite of v1. Wrapper forwarding of PreflightOnly/custom Node is independently reviewed and closed.

| Issue | Severity/status | Attempt / verification |
| --- | --- | --- |
| P55-LOAD-PROOF-001 | P2 RESOLVED | Attempt 1: require initializer marker plus current-session Paper RCON plugins or Fabric native loader listing, including negative states. New focused helper tests PASS; independent Sol High delta PASS. |
| P55-TRANSACTION-PROOF-001 | P2 RESOLVED | Attempt 1: compare complete pre-operation tree with pinned guard manifest/payload/checksum/root owner; verify source/target/consumed upload/trash receipt, restartRequired and unrelated files; re-read committed journal and successful replay after manager recreation. Independent Sol High delta PASS. |
| P55-HOST-ENV-001 | HIGH BLOCKED, host/precondition | No repair attempted. Paper PreflightOnly failed before any isolation root was created. Direct read-only Env enumeration reproduces the exception below. Real Paper/Fabric NOT RUN. |

New helper/wrapper regression: `test-results/p55-harness-delta-v1.log`, 3/3 PASS, exit 0. Node syntax checks PASS. No product, transaction or recovery semantics changed; no repeated full product regression. Execution-safety Sol High delta review PASS, P1=0/P2=0. This is pre-run signoff only; final independent real-evidence review is NOT RUN.

Host error evidence:

```text
BLOCKED: An item with the same key has already been added.
System.ArgumentException: 已添加了具有相同键的项。
FullyQualifiedErrorId: System.ArgumentException,Microsoft.PowerShell.Commands.GetChildItemCommand
HResult: -2147024809 (0x80070057)
Microsoft.PowerShell.Commands.EnvironmentProvider.GetSessionStateTable()
```

Location: `p55-real-addons-acceptance.ps1`, Java environment override preflight, `Get-ChildItem Env:`. This is evidence about this execution context, not proof of a damaged Windows installation or a Minecraft defect. Do not change Windows settings or weaken the override checks. Next: read-only verify the same environment enumeration in a normal host PowerShell; if that passes, run the wrapper preflight there before any real acceptance. P5.5 remains BLOCKED; no server was launched, source world was not accessed, no commit/push/PR occurred. Both new harness roots remain at one substantive repair; no failed second repair or attempt-counter reset.
