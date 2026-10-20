# LC2 D1 source-design review — 2026-10-19

Scope: documentation and existing source inspection only. Independent reviewer:
GPT-6.1 Sol / High, read-only agent `lc2_d1_review`. No product/test modification,
test execution, executable build/run, Minecraft, network configuration or Git
publication. The main writer alone edited the design documentation.

## Retained first review and resolutions

| ID | Initial severity | Finding | Resolution | Final state |
| --- | --- | --- | --- | --- |
| LC2-D1-CLOSE-001 | P2 | Worker process observation authority and close-evidence path were undecided. | Bootstrap holds the native process handle; waits actual exit, obtains exit result, drains both pipes and closes local handles; a bound terminal witness is accepted by a distinct transport. Lost witness is unknown, never inferred from broker exit/Job cleanup. | RESOLVED by document revision, independently delta-reviewed. |
| LC2-D1-EPOCH-001 | P2 | Broker could not inspect the owner's private JavaScript epoch. | Node checks exact captured epoch/action before reserving and issuing each one-shot generation permit. Native validates fixed pipe/order/deadline and kernel owner. Already-dispatched cancellation race remains tracked and uncertain. | RESOLVED by document revision, independently delta-reviewed. |
| LC2-D1-RETIRE-001 | P3 | Closing a resource after its result settled could leave it registered until seal fails. | Registered result settles at terminal closure; readiness is separate; body closes and awaits each tracked start promise before returning. | RESOLVED by document revision, independently delta-reviewed. |

No explicit runtime error code: these were design findings, not executed failures.
Initial P1=0/P2=2/P3=1 is retained. Final delta review: actionable P1/P2/P3=0,
limited D1 source-design signoff. This is not a native safety/performance PASS.

## Verification and limitations

- Existing extraction candidate fingerprint rechecked: 46/46 source/test files
  match `test-results/lc2-retention-extraction-frozen-v1.json`.
- Only design/review/progress documents change in this slice. No tests were rerun;
  historical extraction remains 179 PASS / 1 FAIL. The exact probe child exit
  remains UNKNOWN; no product PASS inferred from the working-directory mismatch.
- Platform primitives checked against Microsoft Learn: native file sharing,
  explicit handle inheritance, creation-time Job membership and kill-on-last-Job-
  handle-close. These references do not prove this proposed composition works.
- No compiler provenance, artifact binary, pinning implementation, deadline
  calibration, parser, inherited-handle crash test or capacity result exists for
  the proposed transport. D2/D3/D5/D6/D7 remain pending.
- LC2-HISTORY-NATIVE-001 remains BLOCKED: unchanged original 50s budget failed.
  Existing retained reports and 1000-history test fixture remain untouched.
- No member writes or remote access enabled. No commit/push/PR.

## Next bounded slice

D2: fixed source-level protocol/descriptor and bounded handle inventory; pure
deterministic parser, ownership, deadline and terminal-witness tests. No native
dispatch, build, default session replacement or capacity retry until their own
prerequisites and independent review are satisfied.
