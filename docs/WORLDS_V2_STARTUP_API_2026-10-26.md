# Worlds V2 startup integration and API preparation

## Production read-only startup

The existing ManagerStartupRecovery task now contains ordered legacy and V2
recovery phases. Multiple activation transitions use its existing bounded deferred
admission; no global Fastify timeout is increased. The ordering remains restore,
world create/import, activation, independent import, archive/properties, add-ons,
operation publication, active-state/catalog observation and schedules.

Catalog head mode is read without mutation. Schema1 first activations retain the
old reconciler/importer path. Head-bearing or damaged catalogs skip the old
first-only precheck to prevent contradictory early recovery marks; whole-history
proof consumption handles them fail-closed. Activation writers remain unmounted.

The live reader checks cancellation before/through bounded loops and at final
return. The importer checks again after awaited verification and immediately
before synchronous confirmation. Manager close aborts admission and joins the
actual task before releasing adapters. Pending recovery keeps HTTP and existing
WebSocket admission closed via the shared coordinator.

Actual affected report
`test-results/worlds-v2-startup-integration-2026-10-26.json`:138PASS/0FAIL/4files,
exit0,98.34s. Covers legacy/current app, startup coordinator, library identity,
and importer with repeated real Fastify reconstruction. This is in-process real
Fastify with Fake Minecraft, not a full Fastify OS restart or Java acceptance.
API typecheck/build/scoped lint/diff passed.

Independent Sol High found a P3 close-test evidence gap: releasing immediately
did not prove close joined a held task. Test now waits for closing state, asserts
close unsettled and zero physical confirmations, releases and joins, then asserts
zero confirmations again. Focused report
`test-results/worlds-v2-close-proof-2026-10-26.json`:1PASS/91filtered,exit0,3911ms.
Independent source/evidence review closed P3: P1/P2/P3=0 within startup scope.
Only that test changed after the138-test run; no product source changed for it.

## Unmounted activation API candidate

Contracts add exact plan request, approval and response. Revision hashes and
opaque world IDs are required; no path, arbitrary command, port or allowStop
parameter is accepted. Existing controller uses the shared approval type.

`routes/world-activation.ts` is a candidate, NOT registered by app.ts. It reuses
existing local write/origin/session boundaries, rejects extra/coercible fields
before AJV stripping/coercion, validates UUID idempotency keys and provides the
existing post-wait authentication admission callback. No-executor mode refuses
activation; the existing plan remains executionAvailable=false/loadVerified=false.
Production activation API/UI and positive HTTP execution are NOT delivered by
this checkpoint. Executor-route final validation still precedes exposure.

Contracts31PASS,exit0. Candidate real Fastify test uses actual import/planning
services and checks strict fields, arrays, absent auth, bad CSRF/Origin and denied
execution with zero activation journals/unchanged properties. Final focused report
is `test-results/worlds-v2-api-candidate-2026-10-26.json`.
Actual2PASS/91filtered,exit0: API candidate1839ms and strengthenedclose3141ms.
Independent GPT-6.1 Sol High source/evidence candidate scope P1/P2/P3=0; reviewer
checked exact JSON and source, ran no tests/edits/Git/Astra. Positive executor
HTTP tests, waiting-session expiry/revocation and production exposure remain
unsigned. No automatic enabling follows from candidate-contract review.

No new browser, true Minecraft, full repository, V2 final, Git or P7 action.
