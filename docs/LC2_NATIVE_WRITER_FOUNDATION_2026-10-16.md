# LC2 native writer foundation — 2026-10-16

Superseding checkpoint: subsequent resource-accounting review found synchronous cleanup-reentry could allocate multiple close promises before the original assignment. Writer close now publishes its shared promise before kill callbacks, with a new regression case. Earlier30/237 results and two hashes below are historical, not final-candidate evidence. New combined13files250PASS, latest four-file manifest and review are recorded in LC2_ACTION_RESOURCES_VALIDATION_2026-10-16.md. Native/publication/whole-action Gates remain open.

## Result and boundary

UNWIRED one-shot transport source and Fake validation accepted. This is not native publication, scoped-store integration, default native guard/crash acceptance or LC2 PASS. No production caller imports this component. Existing auth/private-publication paths and their security rules are unchanged. Remote development remains PAUSED/default closed; no Minecraft, real RCON, user-world, credentials, network or system changes.

Source: `apps/api/src/services/whitelist-native-writer.ts`; Fake tests: `apps/api/test/whitelist-native-writer.test.ts`.

The original native publication runner uses15000ms and16KiB, unlike the ACL query5000ms limit. This new dedicated candidate retains15000ms including owner wrapping and process creation, and enforces an aggregate16KiB stdout/stderr bound. Any nonempty stderr or stream error fails closed; strict UTF8 and a single complete JSON document are checked only after actual close0/null. A JSON candidate, exit event, kill return or rejected run never proves successful drain.

The internal constructor requires the exact owner-epoch wrapper capability; there is no identity-wrapper default. It permits one invocation only. Wrapper failure, spawn uncertainty, cancellation or pre-run close consumes that invocation. A factory throw may have created a process, so cleanup remains unknown rather than claiming no child. Timeout/cancel targets only the exact owned ChildProcess, at most once. Repeated close shares one separate5s drain deadline/result; late close cannot erase a failed cleanup. All public errors are fixed codes/reasons with no original exception/cause, raw script, output or path.

The caller still must retain its owner lease and all outstanding Node write/sync tasks until safe completion. This component cannot prove that requirement and does not alter any existing lease release.

## Validation and frozen candidate

- Initial Fake focused:28PASS/exit0 (`lc2-native-writer-focused-v1.log`). No native invocation.
- Review cleanup-start P2 fixed before acceptance: final focused30PASS/exit0,441ms suite/32ms test body (`lc2-native-writer-focused-v2.log`).
- Affected12files237PASS/exit0,17.76s suite (`lc2-native-writer-affected-v1.log`). Selected writer/session/transport/scope/rotation/budget/owner-retention/command-store/policy/coordinator/protocol/inert tests; not the whole project and not native acceptance.
- Full lint0, typecheck0, production build0. Logs `lc2-native-writer-lint-v1.log`, `lc2-native-writer-typecheck-v1.log`, `lc2-native-writer-build-v1.log`. Existing Vite >500KiB chunk warning retained; output bundle543.14KiB. PowerShell formats the native warning as NativeCommandError, but actual process exit is0 and Vite build completed.
- Git diff check0; final all20 changed/untracked text files whitespace scan0 and two-file fingerprints matched. Summary `test-results/lc2-native-writer-final-v1.json`. No new full regression is claimed: known native/default and physical command-capacity blockers remain open.
- Independent authorized SolHigh source/delta review P1/P2/P3=0 within this UNWIRED transport scope. Native owner-wrapper execution and whole publication action are not accepted by this review.
- Final independent readonly source/evidence/document review P1/P2/P3=0, both source fingerprints independently matched, no production caller found. Review confirms237 affected tests are not a full regression and root-boundary PASS does not rewrite command-capacity FAIL.

| Candidate | SHA-256 |
| --- | --- |
| src/services/whitelist-native-writer.ts | BB11D976FEDFAA17AEBA10647C6C0971B6FB5D5F3C5805C5456D885AAB8ED3B1 |
| test/whitelist-native-writer.test.ts | F5FA433B2E0F1FF69DC91414A6FEA5AA19CB7A180C87A3B275E797702C57A90B |

Both paths are relative to apps/api. Private logs/fingerprints remain Git ignored.

## Issue ledger

| Issue | Severity/status | Evidence / action |
| --- | --- | --- |
| LC2-PUBLICATION-OWNER-001 | HIGH / OPEN P2 | Existing private-publication creator and MoveFile helpers run without retained owner handles. A surviving writer could outlive the original owner while a new owner enters. New transport is UNWIRED; no runtime incident/error code is asserted. Next design must cover every native writer plus Node write/sync, exact context revocation and all-task drain. |
| LC2-WRITER-CLEANUP-001 | HIGH / RESOLVED in candidate, Attempt1 | Read-only review found5s cleanup deadline began after cancel/kill. Moved deadline before the first cleanup action, checked known-closed shortcut, and used only remaining wait. Two Fake paths advance synchronous kill to the boundary, with/without immediate close; both reject CLEANUP_BLOCKED. No native failure occurred. Delta review0. |
| LC2-CAPACITY-COMMAND-001 | MEDIUM / BLOCKED | Historical combined command workload PHYSICAL_CAPACITY_OBSERVATION_DEADLINE, exit1. Read-only cold-open25.643s and independent root boundary PASS do not rewrite it; exact old failing step UNKNOWN. See capacity investigation. |
| LC2-DOC-PATCH-001 | LOW / RESOLVED | Two multi-file patch attempts failed verification against a nonexistent README heading; no runtime/product error or change from those failed patches. Applied each document separately against actual content. No explicit OS error code. |

## Next constrained step

Design an action-scoped task registry that retains one real owner mutation lease across all ACL children, native writers and Node filesystem tasks; rejects cross-action or late continuations; revokes further mutation before cleanup; and cannot release on uncertain creation, unknown close or unsettled tasks. Preserve non-reentrant store ownership and every before/after ACL/identity/hash/no-replace check. Do not simply nest current store methods inside WhitelistAclScope. No default integration until this design, native writer retention and capacity/default crash Gates have independent review and validation.

Existing owner-retention sibling PASS proves only its narrow accepted-before-inspection exclusion invariant. Existing capacity budget and factored filesystem passes do not establish maximum combined throughput. LC2 member API/UI writes remain UNWIRED; LC2 IN PROGRESS; LM1/LM2 not started.

## Git

Prior requested GitHub upload succeeded at7613cf1d28949e303b2beaf53f6cdba69c56cb8d on codex/phase-4-players-properties. This newer slice is uncommitted; no second automatic commit/push/PR/merge. Historical private evidence and failed temporary roots are retained.
