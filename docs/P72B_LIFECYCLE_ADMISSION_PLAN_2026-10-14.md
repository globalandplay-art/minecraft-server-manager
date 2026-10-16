# Lifecycle final request admission — isolated implementation plan

Current candidate1655 full PASS is frozen separately. This is the next bounded slice, not shared business mounting or real provider enablement. No production remote listener will be added.

## Contract

Add a backend-only synchronous admission callback for lifecycle requests. A strict `() => undefined` type excludes accidental async callbacks; it is never decoded from DTO/environment/request arguments or persisted. Only the registrar captures its configured HttpAuthentication/request. Legacy unconfigured local mode keeps its existing behavior; future remote mounting must require authentication and may not omit this callback.

HttpAuthentication gains a non-reauth mutation check using current server-bound profile, live session, CSRF, healthy audit and boundary generation. No new account/session system. Reauthentication is not newly imposed on start/stop/restart; existing assertRecentMutation remains unchanged for operations already requiring it. Required Host/Origin/body guards remain on the original route.

Thread callback from operation registrar -> ServerService.requestLifecycle -> OperationService.requestLifecycle. After the mutation queue wait, check before idempotency/status/preflight; after awaited preflight, check synchronously immediately before store.save invocation. No await may occur between final check and invoking save.

The store.save invocation is the explicit authorization admission boundary: an operation admitted while the grant was valid may finish durable persistence and execute even if the session closes during save. Do not save then reject the grant and strand an operation. Existing save-error, startup reconciliation, operation execution/recovery and shutdown semantics stay unchanged. No session token/callback is stored. A queued/preflight request revoked before that boundary must create zero records/active operation/lifecycle execution effects (already-started read-only adapter preflight queries may have occurred). Idempotent replay requires a current grant after queue waiting.

## Required tests

- Revocation during global mutation queue: zero new records/preflight/execute for denied request.
- Revocation/audit failure/CSRF failure/remote generation closure during awaited preflight: zero record and execute.
- Valid replay returns same operation; revoked replay refuses without a new record.
- Closing after store.save invocation preserves the authentically admitted operation, no duplicate or orphan record; no automatic rollback.
- Real HTTP registrar/ServerService path with test-only fake local adapter and synthetic SessionCore; original lifecycle readiness/body/write guards retained. Local session need not be recently reauthenticated; remote boundary and cookie isolation remain.
- Focused lifecycle/auth and affected regression, independent Sol High source review, new frozen full regression before accepting the changed core candidate.

Backup/Restore/Addons/uploads/commands and the other service paths are not covered by this lifecycle slice. They still require explicit final-admission mapping before shared remote business mounting. No broader coverage, native transport readiness, real remote verification or P7.2b whole PASS claimed.
