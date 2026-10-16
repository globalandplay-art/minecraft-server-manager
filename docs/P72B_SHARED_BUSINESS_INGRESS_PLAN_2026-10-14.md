# P7.2b shared business ingress — next implementation boundary

Design candidate only. No listener, provider, network or production wiring implemented. Begin implementation only after the current native-test/frozen-candidate validation checkpoint is assessed. Full P7.2b remains BLOCKED by native transport prerequisites and foreground publication/watch-close race.

## Current evidence

`buildApp` constructs one AdapterRegistry, OperationService, ServerService, EventStreamService and conditional filesystem services, then registers routes directly. Its owner hooks initialize journals/reconciliation/schedulers and close runtime observers/timers/services. Calling buildApp twice against the same registered runtime would create additional owners and is prohibited.

`HttpAuthentication.installRemote` currently supports an independent test app using the same verifier/session/audit/WS controller. It does not mount actual Manager business routes. The Web client uses relative `/api/v1` requests and same-origin session credentials; a remote deployment needs same-origin built assets, not an arbitrary cross-origin API base. Static asset serving is a separate unimplemented boundary and must not be silently claimed by route mounting.

## Smallest shared-owner slice

1. Separate service construction from route registration inside the existing owner, preserving current construction, startup and shutdown order.
2. Capture an internal service bundle exactly once. Remote mounting receives only that bundle and fixed owner clock/mode/authentication; never user-supplied adapter, journal, root, service factory or arbitrary target.
3. Reuse original route registrar functions and services for both apps. Instantiate read-only performance/crash/inventory/create-plan/export wrappers once as well; do not create a second cache/session owner implicitly.
4. Require configured authentication for remote mounting. No fallback to local anonymous mode. Install server-bound remote authentication/profile before routes; retain disabled boundary by default.
5. Register each app's WebSocket transport using the same authentication controller and EventStreamService. Remote socket close unsubscribes only its own streams; it cannot close shared streams/runtime/local sockets.
6. Keep all startup reconciliation, scheduler/retention timers, operation-store initialization and shutdown with the single Manager owner. Remote ready/close must not execute those hooks again. Block admission until owner initialization completed; failure remains unavailable.
7. Owner preClose retires authentication admission before remote drain and business shutdown. Remote close revokes remote sessions only, while local auth remains usable. Remote transport cannot be attached to a retired owner or reopened through a stale capability.
8. Preserve bounded body limits, trustProxy=false, original error schemas and safe logging on the remote app. No raw Fastify error/request logger or exposed closure/service object. Unknown route/errors still go through auth and fixed sanitized responses.
9. No `main`/configuration/API toggle calls this mounting path yet. No real Serve, listener allocation, automatic reconnect, browser remote verification or claim of private proxy provenance.

## Preconditions identified by independent source review

Route registration reuse alone is insufficient for final mutation admission. Current HTTP onRoute checks immediately before invoking the handler, but `ServerService.requestLifecycle -> OperationService.#mutate` can queue and await adapter preflight/summary before saving a new operation. That path has no request-bound final authorization callback. A remote request must not turn a revoked/closed admission into a new operation after those waits. This is a production integration blocker discovered before implementing remote business mounting, not a claim that this unmapped remote path is currently live.

Before implementation, map every mutating route/service to its actual admission point. Add a narrowly typed request-bound synchronous final admission callback where needed, checked after queues and preflights under the existing operation/instance locking. Do not use global mutable request context, caller-supplied permits or AsyncLocalStorage as implicit authorization. Define the durable-save linearization explicitly: closing after an operation was authentically admitted must not misreport or destructively cancel that operation; closing before admission must produce zero new operation/transaction effects. Async persistence completion alone is not an authorization check. Any uncertainty in this design blocks mounting and requires review before coupled service changes.

Owner initialization requires a monotonic internal lifecycle (initializing/ready/closing/closed/failed), not a boolean or remote app readiness. Gate remote admission on that owner state. Owner must explicitly retain its registered remote app/transport drain capability and invoke it during shutdown; authentication boundary/session close alone does not close the HTTP server. Make drain/close idempotent and bounded; uncertain in-flight admitted operations retain recovery/owner exclusion as existing semantics require. Never let remote-close hooks close owner services.

`installRemote` currently permits only one app for the authentication owner's lifetime. This mounting slice must preserve that restriction. Closing that Fastify app is terminal; manual remote disable/enable and target listener reuse belong to a separately reviewed controller and cannot be promised by reopening a retired app. No implicit second auth install or weakening of the global owner-closed latch.

Design findings SHARED-INGRESS-ADMISSION-001/P2 and SHARED-INGRESS-DRAIN-001/P2: missing awaited business-admission and owner-drain prerequisites identified in the first draft. Both draft findings corrected Attempt1 to make implementation prerequisites explicit; no product fix performed. Independent Sol High delta design review PASS, P1/P2/P3=0. Concrete callback mapping, durable-save linearization and drain ordering still require design/implementation review before mounting; implementation remains NOT STARTED.

## Verification before accepting this slice

- One service constructor/startup/close per owner; remote mounts do not repeat reconciliation/schedulers or adapter observers.
- Both authenticated profiles see the same operation IDs/server state; same-key lifecycle replay and shared operation/instance locking remain unchanged.
- Unauthorized remote reads and mutations have zero service side effects. Forged proxy/Tailnet headers cannot select profile or administrator identity.
- Awaited business admission still rechecks current session/CSRF/reauth/boundary; remote closing during preflight denies new operation admission. Preserve semantics for operations already durably admitted before closure.
- Remote WS authenticates and observes the same stream; closing remote detaches only its subscriptions. Owner close prevents pending/new HTTP and WS access and closes shared services once.
- Owner startup failure, remote construction failure and repeated mount fail closed without losing local ownership.
- Frozen affected and full regressions, three-width auth UI regression as applicable, and independent Sol High source/evidence review. Synthetic route/WS tests are not native/real remote acceptance.

## Retained boundaries

Exclusive ephemeral loopback listener allocation, HTTPS frontend assets and transport binding require a later reviewed controller. Existing local frontend Vite proxy does not prove remote production assets are served. Native daemon identity, selected client build and crash-safe foreground cleanup remain separate blockers; shared business routing does not solve them. No domain or real-network setup is needed for this synthetic construction slice.
