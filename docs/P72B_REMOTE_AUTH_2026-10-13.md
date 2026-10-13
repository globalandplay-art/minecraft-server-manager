# P7.2b isolated remote authentication integration — 2026-10-13

Status: isolated implementation and targeted checks complete; full regression FAILED. Current candidate remains BLOCKED, production unwired, real provider/remote acceptance NOT RUN/NOT AUTHORIZED.

## Scope and behavior

`HttpAuthentication.installRemote` is a construction-only hook for a distinct app using the same account verifier, audit, SessionCore and single WebSocketAuthentication controller as local management. Production `main`/`buildApp` do not call it. No listener was added, Tailscale invoked or live network changed. Test HTTP injection and in-memory WebSocket streams use synthetic accounts/audit only.

Server-owned WeakMap context selects remote-https, fixed origin and request generation; no header or request parameter can select a profile. Cookie parsing shares existing duplicate/length/token rules. Remote cookies use `__Host-mcsm_remote_session; Secure; HttpOnly; SameSite=Strict; Path=/` without Domain. Local cookies and local-http remain separate. Cross-profile tokens are rejected even if their cookie name is changed. Tail identity/capabilities never grant Manager authorization. Existing CSRF, intent, password, recent authentication, audit and final admission checks are reused.

Remote close synchronously revokes only remote profile sessions/tickets and their shared-controller WebSockets, preserving local sessions and audit. Closing the lifetime-owning local app first irreversibly retires all profile admission, closes the remote boundary, then closes shared WebSockets/sessions; audit disposal remains with that owner. Reopening a shape boundary cannot resurrect a retired Manager. Request-generation checks reject work spanning close/reopen. WebSocket final admission checks profile/boundary after scheduling immediately before101; subsequent delivery remains subject to session/audit/boundary liveness.

This is not a production transport or complete Manager business-route/asset integration. A dedicated exclusively bound loopback listener, trusted route/owner/watch/Funnel checks and shared business-service mounting still require a reviewed integration. Do not call `buildApp` twice against the same runtime to manufacture remote integration: duplicate service/scheduler/reconciliation ownership must be avoided. Remote metadata is not proxy identity proof. Future Cloudflare ingress must have its own reviewed configuration boundary; this slice permits one Tailscale remote install only.

## Current validation

- Existing boundary/local HTTP/WS/session/sensitive-admission:139 PASS, exit0 after initial refactor.
- Remote suite first execution:7 PASS/2 FAIL, exit1. Both fixture defects preserved below.
- Remote after fixture corrections and owner fix:9 PASS, exit0.
- Affected suite with owner test:149 PASS, exit0; subsequent WS/expiry/audit coverage:152 PASS, exit0 (13 remote tests included).
- After cleanup fixture delta:13 remote PASS, exit0. Full candidate includes this delta; do not sum overlapping counts.
- Frozen v1 full `npm.cmd run check`: exit1; Contracts13 PASS, API1459 PASS/3 FAIL, Web163 PASS. Lint/typecheck passed; production build NOT RUN within that failed command. Preserve `test-results/p72b-remote-auth-mv6nxijr-full-check.log` and `-full-result.json`.
- One full-regression failure was confirmed and repaired below. Current v2 affected regression: seven files/165 PASS, exit0. Current standalone lint/typecheck/production build exit0; existing web chunk-size warning retained. Diff check exit0.
- Current v2 manifest `test-results/p72b-remote-auth-mv6nxijr-frozen-v2.json`:350/350 hashes verified, only `ws-auth.ts` changed from frozen v1. No new full regression was run after that change; v1 cannot sign off v2.
- Original two-worker API settings and5000ms limits unchanged. No assertion removed, timeout increased or security check reduced.
- Current v2 original authentication browser specification:360/768/1440 PASS, browser exit0, owned children closed and port released. Evidence: `test-results/p72a-auth-browser-34af4a3c-f9d3-4450-a5c4-a4274a8ee927/result.json`. Checks local UI regression/mock business APIs, not real remote HTTPS/cookie/phone behavior. Earlier browser run is retained as historical evidence.
- Independent Sol High static candidate and final evidence/document delta review:P1/P2/P3=0; reviewer independently verified v2 hashes350/350 and browser3 PASS/owned cleanup, retained native root UNKNOWN and full-v2 NOT RUN. This is source/evidence review, not a passing full regression or production/remote signoff.

## Issue ledger

### REMOTE-AUTH-OWNER-001 — P2 / fixed Attempt1, static review closed

Independent static review found local `preClose` originally cleared sessions/WS but left remote admission open until audit `onClose`; pending remote login could create a new session during owner shutdown. No live credential/network failure was executed. NO_EXPLICIT_ERROR_CODE. Added irreversible request-profile closed latch and admission-first owner shutdown. Test holds close before audit disposal and proves pending/new login/business denial despite boundary reopening, no cookie and zero writes.

### REMOTE-AUTH-FIXTURE-CLEANUP-001 — P2 / fixed Attempt1, static review closed

Independent review found pending audit/owner-close test gates could remain unresolved on an assertion failure, blocking fixture teardown. No observed hang; static finding, NO_EXPLICIT_ERROR_CODE. Added unconditional finally release and waits for owned pending promises.13 tests passed afterwards; no test deadline/concurrency/assertion changes.

### REMOTE-AUTH-FIXTURE-RECENT-001 — test defect / resolved Attempt1

Raw assertion: `AssertionError: expected 200 to be 403 // Object.is equality`, initial `remote-auth.test.ts:86:119`, test `requires CSRF and recent reauthentication for protected writes`, exit1. Existing SessionCore treats password login as recent authentication for five minutes. Test was incorrectly expecting login not to satisfy recent authentication. Added deterministic monotonic test-clock advance past five minutes, then required explicit reauthentication. Product contract unchanged; subsequent test PASS.

### REMOTE-AUTH-FIXTURE-WIRE-001 — test defect / resolved Attempt1

Raw error: `Error: Unexpected server response: 403`, `@fastify/websocket/index.js:83:16`, test `remote WebSocket uses same core, consumes ticket once and closes when ingress closes`, exit1. `injectWS` does not generate rawHeaders by itself; the new fixture lacked the wire-level Host required by the boundary. Added realistic rawHeaders, preserving duplicate rejection. Success/ticket replay/close tests now pass; no boundary relaxation.

### REMOTE-AUTH-TYPE-001 — resolved Attempt1

Raw TypeScript error: `TS2379: Argument of type ... boundary: TailscaleIngressBoundary | undefined ... is not assignable to parameter of type 'Reservation' with 'exactOptionalPropertyTypes: true'`. Original location `ws-auth.ts:88:48`, tsc exit2. Declared the always-present reservation field as `TailscaleIngressBoundary | undefined`; no any/strictness changes. Subsequent typecheck passed.

### REMOTE-AUTH-EDIT-001 — mechanical tool issue / resolved

First bounded edit transformation aborted with `Error: replacement missing`, Node exit1, before writing HTTP/WS files. The script's replacement expected CRLF while input used LF. Normalized line endings for in-memory replacement and kept the abort-before-write check. This was not a product execution or security repair.

## Retained blockers and next step

### REMOTE-AUTH-SERIALIZATION-001 — confirmed / resolved Attempt1

Full v1 `test/auth/bootstrap.test.ts:45:55`, test `startup explicitly required auth profile > fully verifies credential record and private audit before constructing required auth`: `AssertionError: expected '{"profiles":{}}' to be '{}' // Object.is equality`, command exit1. TypeScript private constructor parameter property was enumerable. Replaced it with JavaScript `#profiles`, preserving the existing non-enumerable authentication contract. Bootstrap and affected tests165 PASS; typecheck/build PASS. No assertion or security relaxation. This change invalidates v1 as final evidence for v2.

### REMOTE-AUTH-NATIVE-TIMEOUT-001 — HIGH / BLOCKED / root UNKNOWN / repairs0/2

Full v1 native offline credential publication failures:

- `test/auth/credential-writer.test.ts:23:3`: `creates protected native ACL objects, publishes init and preserves exact verified reset backup`,180010ms.
- `test/auth/credential-writer.test.ts:43:46`: `fails closed after before-publish interruption and explicit recovery verifies commit`,180007ms.

Raw error for both: `Error: Test timed out in 180000ms.` Full command exit1; NO_EXPLICIT_NATIVE_ERROR_CODE/HResult/helper stage emitted. These tests wrap fixture acquisition, action, release and directory cleanup. Exact last step, body versus cleanup, helper state and underlying cause remain UNKNOWN. No evidence justifies calling this ACL noncompliance, helper-timeout, or proven Windows resource contention. Native writer/reader/helper/ACL test and product files are unchanged; that does not rule out indirect load effects. No repair or rerun performed. Runner exited, but log does not prove every native helper/fixture cleanup completed; no unknown process terminated or directory deleted.

Minimum next action: read-only native publication/fixture timing and cleanup forensics using preserved logs/source, identify the last observable stage and ownership evidence before any separately scoped diagnostic run or repair. Keep original180000ms test/5000ms ACL limits, assertions and concurrency. New frozen full regression remains required after resolving these failures.

NATIVE-BUILD-001: supported native toolchain/development headers/import library not confirmed; native client NOT BUILT. TS-PROD-SESSION-RACE-001: foreground publication/watch-close race unresolved. Neither changed by auth integration; implementation repair count0/2 for those roots. Complete P7.2b remains BLOCKED regardless of isolated checks.

Next priority: investigate the native regression blocker above. Dedicated listener/controller, same-origin assets and business-route mounting with one shared service owner, native transport/session boundary resolution and new final gates remain pending. Do not install toolchains, initialize real credentials, mutate Tailnet/network/Minecraft or perform Git publication automatically.
