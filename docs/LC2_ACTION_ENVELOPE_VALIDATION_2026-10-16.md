2026-10-16 superseding component checkpoint: one normal real owner/envelope/inert-writer execution now PASS; see LC2_ENVELOPE_WRITER_NATIVE_VALIDATION_2026-10-16.md. Earlier Fake-only/NOT RUN statements below describe the prior source slice, not the newest component evidence. Production/member/store/publication/crash/capacity Gates remain open.

# LC2 action envelope — 2026-10-16

UNWIRED owner/context envelope source accepted; current validation is entirely Fake. No native owner or writer execution, store/ACL borrowing, filesystem/RCON/API wiring or actual member mutation. LC2 IN PROGRESS; remote PAUSED/default closed; LM1/LM2 not started. Prior authorized upload ecda55f547c0cdfc47e66ad25950c65550465b33 succeeded; this slice is uncommitted, with no new upload authorization inferred.

## Implementation

`WhitelistActionEnvelope` binds a single real-owner interface, normalized root, stable root identity, one mutation lease/activity and a unique AsyncLocalStorage Symbol. The first run/cancel consumes the instance. Body capabilities expose only assertActive/start, never owner, root, private proof, token, release or drain. Every admission/result validates phase, current ALS context, owner/root identity and a required finite monotonic absolute work deadline. Timer input is bounded to Node's supported signed32-bit timer range; this is not an extension to ACL5000ms/native writer15000ms or existing tests.

Acquisition attempts are recorded before calling owner APIs. Unknown activity/mutation acquisition retains the instance; the exact owner API's AUTH_BUSY contract means rejection before acquiring that mutation, so its known activity can be ended. Shared auth and its actual mutation/release implementation were not changed.

First failure fixes a sanitized primary category, revokes admission and establishes one absolute5000ms cleanup deadline. Body timeout does not mean the body settled. Actual body settlement and resource drain are concurrently observed under the same deadline; unknown resources or unfinished body retain known lease/activity and report CLEANUP_BLOCKED. Late results cannot rewrite primary failure. Final owner validation and both releases are time-fenced, including synchronous callback cost. Closed/drained work can release before returning a failed primary; cleanup success does not turn that primary into operation success.

Important limit: release callback may release and then throw. The envelope reports release-uncertain, retains any not-yet-released activity, permanently denies reuse and never claims the mutation lease is still actually held. Owner-wide quarantine/termination is NOT implemented by this candidate. Global exclusion cannot be asserted from an uncertain or already-released mutation lease. Fake tests explicitly exercise this distinction.

`WhitelistActionResources.drain(deadline?)` now accepts only an earlier valid absolute deadline within its own5000ms window. Invalid/expired deadlines fail closed; repeated calls share the original result. The envelope does not nest WhitelistAclScope.run or use a Fake reentrant owner. Borrowed ACL, native writer factories and Node I/O primitives remain separate Gates.

## Validation

- Intermediate focused37PASS and44PASS, exit0, retained in `lc2-action-envelope-focused-v1.log` / `-v2.log`; they are not the final candidate.
- New frozen affected14files283PASS/exit0,20.48s suite (`lc2-action-envelope-affected-v1.log`), including final envelope/resource plus writer/session/transport/scope/rotation/budget/owner-retention/command-store/policy/coordinator/protocol/inert tests.
- Final lint0/typecheck0/build0: `lc2-action-envelope-lint-v2.log`, `lc2-action-envelope-typecheck-v2.log`, `lc2-action-envelope-build-v1.log`. Existing543.14KiB chunk warning retained, Vite build5.57s. No timeout/assertion/security weakening.
- Frozen manifest4/4 reverified (`lc2-action-envelope-frozen-v1.json`), summary `lc2-action-envelope-final-v1.json`; source/delta independent authorized SolHigh P1/P2/P3=0. Final evidence review recorded separately when complete.
- Final independent readonly source/evidence/document review P1/P2/P3=0; four hashes independently matched4/4 and no production envelope caller found. No full/native acceptance was claimed.
- No new full-project regression or real native PASS claim; known default/native and combined physical command-capacity failures remain open. No historical run was overwritten.

| apps/api relative candidate | SHA-256 |
| --- | --- |
| src/services/whitelist-action-envelope.ts | 90037ab6c2d6577da6702df3a5ecb96b520be248834b120de6d3e39f77aa7d72 |
| test/whitelist-action-envelope.test.ts | 09c543195ce80bf75746e8ec8cdd5ea98ae4bbb2955fffc9c5cc2911182dcd7a |
| src/services/whitelist-action-resources.ts | 2e6d6a219cfb88c4553cda76754ae45a2d2e23c4436fa20d92e6d37f8a2a4e14 |
| test/whitelist-action-resources.test.ts | 511f05887dab774955253ed853933ecac1e3b507cc33ec7507ab7a3b7f472b9b |

## Issue ledger

| Issue | Severity/status | Evidence and action |
| --- | --- | --- |
| LC2-PUBLICATION-OWNER-001 | HIGH / OPEN P2 | Existing default native publication paths remain unretained; envelope/source Fake proof does not change them. No runtime error code asserted. Native retention, borrowed controller, scoped stores and crash/default capacity still required. |
| LC2-ENVELOPE-RELEASE-001 | HIGH / explicit limitation | Unknown release may mean actual release already occurred. No owner-wide quarantine contract; source reports uncertainty and does not release remaining activity/retry. Fake actual-state assertions confirm it does not claim held. Not accepted for production integration. |
| LC2-ENVELOPE-TIME-001 | HIGH / RESOLVED candidate | Self/source review P2: synchronous owner identity checks could consume time between a pre-check and dispatch/result/release. Added post-check fences at all such boundaries; separate resource-factory, body-result, pre-acquisition and pre-release Fake cases. Follow-up initial identity callback cancel now also prevents activity acquisition. No native incident or OS code; substantive correction1 with source delta, existing deadline unchanged. |
| LC2-CAPACITY-COMMAND-001 | MEDIUM / BLOCKED | Historical PHYSICAL_CAPACITY_OBSERVATION_DEADLINE/exit1; exact old failing stage UNKNOWN. Previous cold-open and independent root boundary PASS remain limited. No product optimization attempted. |
| LC2-SOURCE-LOOKUP-002 | LOW / RESOLVED | A read-only guessed manager-lifetime-lock-native.test.ts lookup returned PathNotFound/ObjectNotFound. Actual test discovered by listing: auth/manager-lifetime-lock.test.ts. No files or test behavior changed by the failed read. |

## Next gate

First obtain final evidence signoff for this frozen candidate. Then independently design/source-review a single normal native component probe using only a fresh, printed/confirmed canonical tmp root, real owner acquisition, this envelope and a fixed inert owner-wrapped writer script. No private credential files, Create/Move payload, parent death, RCON/world/network or product integration. It must distinguish actual native child close, envelope lease/activity release, real owner release and exact controller child close; failure/unknown ownership preserves the fixture and does not kill unknown helpers. This would prove only normal owner/envelope/writer transport, not publication semantics or crash/default capacity.

Only after later native and borrowed-controller design Gates may store migration be considered. Preserve all exact ACL/identity/content/no-replace checks and the common operation/recovery contract.
