# LC2 RCON MVP — implementation and delivery status

Date: 2026-10-20. Baseline commit: 14acfdd585dc965439e45c32c94ab5588e9d562e.
Branch: codex/phase-4-players-properties. No commit/push/PR authorized.

## Scope and current user availability

MVP scope is local, managed, running Vanilla 26.3; one named player per add/remove.
Saved-list reading and refresh remain available in production.

The dedicated RCON transport, durable business controller, authenticated HTTP
member/recovery routes and React confirmation/status UI are now implemented as
an explicitly constructed candidate. Fake integration is NOT real Minecraft
acceptance. Production main does not supply the member-controller factory:
production remains membershipWritable=false, and mutation requests fail closed.
Do not describe LC2 as ENGINEERING PASS or production-ready yet.

No offline whitelist.json writer, UUID input, Paper/Fabric support, batch,
implicit Minecraft lifecycle, remote access or new generic transaction system.
Phase 7 remote remains PAUSED. LM1/LM2 not started by this task.

## Reused implementation and minimum additions

- WhitelistService, bounded whitelist reader and member policy remain the saved
  file/name/revision/one-member comparison foundation.
- RconClient.executeGuarded performs synchronous final admission after auth,
  before command bytes. Failed admission allocates no pending timer/request;
  async return values reject safely without unhandled Promise rejection.
- LocalMinecraftRuntime.openWhitelistSession captures exact child/launch and
  opaque generation. Fixed list/add/remove only, no stdin; one mutation per
  session, concurrent calls reject, post-send loss preserves dispatched=true.
  It is transport mechanics, NOT proof that a TCP endpoint belongs to that child.
- WhitelistRconCoordinator reuses OperationService, CommandStore, GuardStore and
  ManagerLifetimeLock activity/exclusion. No second supervisor or new writer.
- Exact before guard -> durable intent -> durable dispatch boundary -> fresh
  revision -> synchronous recent-auth admission -> one command -> file/list/file
  bracket -> exact one-member delta + version rule -> exact after guard -> bound
  receipt checkpoint -> common terminal operation.
- Optional bounded RCON evidence in existing version-1 checkpoints binds operation,
  request, generation, before guard, after guard, response and canonical names hash.
  Old records remain readable; evidence cannot appear before a response or change
  during recovery. Two guards reduce retained-operation capacity; known insufficient
  guard capacity rejects before dispatch. Unexpected publication failure retains
  recovery, not success or a retry.
- Startup uses archived evidence, never today's matching membership as a receipt.
  A before-guard without command intent remains owned by its durable operation
  and recovery-gated. Unknown guards fail closed. Unsafe member initialization
  disables member writes while leaving local Manager startup usable.
- Explicit recovery verifies complete archived evidence only. No resend, reverse
  command, implicit rollback or deletion. Missing response evidence stays blocked.
- POST /api/v1/servers/:serverId/whitelist/members accepts only action/name/revision/
  confirm plus UUID Idempotency-Key. POST .../whitelist/recover accepts only
  operationId/confirm. Both require configured admin authentication, CSRF/Origin,
  recent reauthentication and final admission recheck. Existing operation GET reused.
- React page supports name entry, single add/remove confirmation, operation ID and
  bounded status polling (30 observations), uncertain-result lockout, manual refresh
  and evidence-only recovery confirmation. A 202 is not displayed as success.

## Real production prerequisites still OPEN

1. A reviewed concrete observation adapter proving registered root, exact managed
   generation and RCON endpoint ownership. Reachable loopback plus password alone
   is not that proof. Candidate factory is trusted code construction only, never
   HTTP/config/environment controlled; main provides none.
2. Verified Vanilla 26.3 add/remove/list response, locale and save/persistence rules.
   Tests deliberately use FAKE strings, not purported Minecraft grammar. No default
   production rules are supplied. Separate real-server authorization is required.
3. Applicable final safety/durability Gate and production composition/interrupt
   verification. Sol source review is not an Astra High signoff or real acceptance.

These are actual production-path gaps, not errors repaired by extreme history or
compiler experiments. Real Minecraft acceptance: NOT RUN. No real server, user
world, credential, system-permission or network changes were performed.

## Deferred work (not automatic MVP prerequisites)

| Debt | Reason / risk | Trigger and future verification |
| --- | --- | --- |
| Offline whitelist.json edits | Outside running-command MVP; UUID/identity/publication/recovery remain necessary for offline editing. | Separately scoped offline feature with exact backup/atomicity/recovery tests. |
| Compiled helper D3 signer/build research | Alternative transport is not selected by production member wiring. Historical BLOCKED remains unchanged. | Reopen only if a selected production dependency genuinely requires it. |
| 4,999 history pairs / maximum combined capacity | Not required to implement a bounded first release. Existing limits still fail closed. | Reopen when supported retention/history limits demand that workload; do not increase deadlines. |
| UNWIRED wide/native optimization | Component passes are not production integration. | Explicit dependency decision and affected interruption review. |
| Repeated full checks/hashes of unchanged code | No value from repeating identical evidence. | Focused changes -> focused checks; integrated slice -> one final full check; substantive final changes invalidate affected evidence. |

Native private ACL/publication used by the selected command/guard stores remains a
real dependency. This task does NOT replace it with an unprotected JSON store or
waive necessary ordinary-operation/interruption safety checks. Historical evidence
and failures are retained; no D3, capacity, offline or helper experiment was rerun.

## Issue ledger

- RCON-ASYNC-ADMISSION/P2: source review found discarded rejected async permits;
  Attempt1 consumes invalid rejection without awaiting/authorizing. Rejected-Promise
  negatives pass at client and session boundaries. No explicit error code from review.
- LC2-RCON-RULE-ASYNC/P2: review found ignored async verification results; Attempt1
  enforces synchronous rule completion and validates parser results. Live/historical
  rejection tests pass. No explicit error code from review.
- LC2-RCON-LIST-RACE/P2: review found stale after capture across list await; Attempt1
  brackets list with a second full revision/byte validation in preview and commit.
  Fault test retains recovery/one before guard, no false receipt. No explicit error code.
- LC2-RCON-PREINTENT-GUARD/P2: review found legitimate orphan-before-intent startup
  rejection; Attempt1 maps exact before guard to durable common operation and keeps
  recovery. Member init errors no longer prevent local app startup. Fault tests pass.
- LC2-RCON-RECOVERY-REFRESH/P3: same operation ID hid post-recovery list refresh;
  Attempt1 explicitly refreshes operation and whitelist. UI test passes.
- LC2-BROWSER-FIXTURE/P3: first browser run failed before login because fixture
  auth/status contained forbidden meta. Snapshot showed 'backend response format'
  rejection; locator timed out at original 30000ms. Attempt1 removes only the extra
  fixture field; no auth/schema/timeout/assertion weakened. Original artifacts kept
  under test-results/lc2-members-browser-artifacts. CLI teardown did not finish and
  its owned session was interrupted (exit1); known reported Node PIDs disappeared
  and port3013 returned ECONNREFUSED. Broad CIM query was denied (0x80041003); no
  unknown process was killed. Recheck uses a directly owned Vite helper rather than
  Windows shell-tree teardown; no change to test deadlines or concurrency.
- LC2-PORT-PROBE/P3: first Node -e probe failed before networking due PowerShell
  quote stripping (SyntaxError/exit1); corrected once using stdin script. Port probe
  then returned ECONNREFUSED/exit0. This was not a product or port ownership test.

## Validation

Accepted component evidence: guarded RCON/runtime38 PASS; affected server/policy48
PASS; latest coordinator/receipt14 PASS; page8 PASS. Counts overlap between runs
and are not summed as a unique full-suite total. No claim that focused passes
complete LC2 or validate real RCON semantics. Source/delta Sol High review found
P1=0/P2=3/P3=2 in business integration; all code issues corrected in Attempt1,
final delta/evidence review pending. Transport final review P1/P2/P3=0.

Final browser/full-regression/static results will be recorded after actual exit.

## Next delivery decision

Finish candidate validation and record exact blockers. Production stays read-only
until all three prerequisites above pass. If further LC2 safety work would expand
outside this MVP, retain this candidate and prioritize independently useful LM1,
as authorized by the user's fallback; do not resume D3 as the default next task.

## Final validation checkpoint

- Independent Sol High final source/delta review: P1=0/P2=0/P3=0. This does not
  replace real storage/production durability or the pending applicable Astra Gate.
- New frozen full check: exit1; original 22 candidate files matched22/22 after
  completion. Subsequent edits are reporting/docs only, not product/test changes.
- Contracts:18PASS. API:2491PASS/8FAIL,3failed/141passed files. Web:174PASS.
- Lint/typecheck:PASS in the same check. Complete production build, separately
  after the failed check skipped its build stage:PASS/exit0. Existing >500kB chunk
  warning retained. diff check:PASS (Git LF/CRLF conversion notices only).
- Raw check log/result/candidate manifest/build log:
  test-results/lc2-rcon-final-c75fdd6b-73c0-4b67-be9b-ca3c7c702059/.
- Final browser:360/768/1440,3PASS/9.3s/exit0. Final marker:
  test-results/lc2-members-browser-e06fe912-8ff8-4860-a70a-e0fb5b2c3cdf/.last-run.json.
- Browser correction history: Attempt1 removed forbidden auth/status.meta;
  Attempt2 corrected fixture session expiry from2099 to the same2026 date so its
  declared duration is30minutes, within the unchanged8hour auth bound. The second
  failure was Invalid session deadline by source and displayed generic login error.
  Earlier failed artifacts (including8f033301/230e9448/6d0112d8 roots) remain. No
  third repair, product-auth change, timeout increase or assertion relaxation.

### Full-check failures and delivery impact

1. LC2-ORDINARY-NATIVE-GATE — BLOCKED, production dependency, fixes0/2.
   test/whitelist-native.test.ts:104: NATIVE_OBSERVATION_DEADLINE; ordinary
   roundtrip50023ms. Secondary CLEANUP_BLOCKED at:47 deliberately retained an
   unacknowledged fixture. Exact inner await/root cause UNKNOWN. The last48.077s
   sample had ACL batch active270ms, not evidence of helper-timeout or invalid ACL.
   Two dependent guard/dispatch death tests failed PRIOR_NATIVE_FAILURE_STOP and
   did not execute their acceptance bodies. No OS error code was supplied here.
   PID5400 later absent is not proof of all helper closure/owner release. Failed
   fixture remains; no force-kill/delete or unchanged rerun was performed.
2. LC2-ACL-PROTOTYPE — DEFERRED, fixes0/2. First affected case:
   test/whitelist-acl-session-native.test.ts:96, assertion:
   expected 'failed' to be 'retained-parent'. Two dependent cases report
   PRIOR_NATIVE_FAILURE_STOP. This alternative prototype is not the selected
   production controller transport; its acceptance is not claimed. Preserve
   failure and reopen only if a production dependency selects it.
3. LC2-PHYSICAL-CAPACITY — DEFERRED, fixes0/2.
   test/whitelist-physical-capacity.test.ts:47:
   PHYSICAL_CAPACITY_OBSERVATION_DEADLINE. Next case:
   PRIOR_PHYSICAL_CAPACITY_FAILURE_STOP. Extreme10000-entry/4999-pair work remains
   outside MVP prerequisite scope. It was still included by the unchanged full
   suite; no failure was removed or skipped to label that suite green.

Result: reviewed source/Fake implementation and browser closure are available for
continuation, but LC2 ENGINEERING/PRODUCTION PASS is NOT attained. Production
member controls stay unavailable. Real RCON observation adapter/endpoint binding,
verified Vanilla26.3 response/persistence rules, ordinary native Gate and final
applicable safety signoff are still needed. Recommend LM1 as independent useful
work; do not resume compiler/capacity experiments by default. No Git publication.
