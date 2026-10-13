# P7.2b ingress boundary foundation — 2026-10-13

Status: unwired pre-auth request-shape foundation implemented and affected checks passed. Whole P7.2b remains BLOCKED. This is not authenticated ingress completion or real remote acceptance.

## Implemented scope

`apps/api/src/auth/tailscale-ingress-boundary.ts` is a synchronous, default-closed boundary with immutable, canonical ASCII MagicDNS authority and exact HTTPS origin. A dedicated listener/controller can use it in a later reviewed integration. It is not wired into `buildApp`, `main`, HTTP authentication, WebSocket authentication or a provider. It neither creates a listener nor changes any route, session, journal or network configuration.

It rejects non-approved loopback peers, wrong authority/origin, wire-level duplicate security headers, ambiguous forwarding and Funnel-marked requests. Pinned Tailscale v1.98.8 [Serve proxy implementation](https://github.com/tailscale/tailscale/blob/v1.98.8/ipn/ipnlocal/serve.go#L965-L1001) supplies X-Forwarded-Host/Proto/For plus identity metadata. The boundary only checks forwarding consistency with its constructor-fixed origin; it never derives a principal, client address or secure-cookie policy from these fields. Identity/app-capability metadata grants no Manager permissions. Missing Funnel metadata cannot prove private provenance.

An `assertRequest` success returns nothing and means request shape only, not authenticated or safe service admission. Loopback source and expected header values do not prove proxy ownership. No request parameter/header can select this class as the active ingress or change its authority. Internal `open()` is not exposed via an API; it may only be called after all controller prerequisites in the integration below are met.

## Required next integration

1. Dedicated exclusively bound Manager loopback listener, not local8080 guard exceptions or forwarding to Minecraft/RCON. Production remains unavailable until reviewed owner/watch/route/Funnel evidence exists.
2. Reuse the one administrator account/verifier/audit/session core. Add explicit server-selected remote-https session and Secure/HttpOnly/SameSite cookie handling, independent of local-http cookies. No trustProxy or Tail identity authorization. Keep trusted-local-OS-user threat boundary explicit.
3. Exact remote Origin/CSRF and authenticated WebSocket ticket handshake; shared core must support both endpoints without duplicate socket-revocation observer registration, global session clearing or audit disposal when only remote ingress closes.
4. Recheck owner, admission, authentication and audit synchronously after asynchronous hooks immediately before each business or WS admission. Closing must also revoke/drain existing remote sockets; this class alone cannot do so.
5. Same-origin production assets plus HTTP/WS positive/negative integration and three-width browser validation. After substantive integration obtain fresh frozen full regression and independent Sol High signoff.

Native build prerequisite NATIVE-BUILD-001 and session publication/watch-close race TS-PROD-SESSION-RACE-001 remain blocking. Real Tailscale and remote-device verification remain NOT RUN/NOT AUTHORIZED. No claim of public reachability or remoteVerifiedAt.

## Validation and issue ledger

- Initial boundary focused tests: 46 PASS, exit0.
- Affected boundary/HTTP/WS/session/sensitive-admission tests: 139 PASS in5 files, exit0, 13.98s. This includes46 boundary tests; totals are not additive.
- Repository lint/typecheck/production build: exit0. Existing538.45kB Web chunk warning retained; no warning threshold changed.
- No full project regression or new browser run claimed for this unwired slice. Earlier1579 full result is historical and cannot sign off new integrated ingress.
- Independent Sol High initial read-only review: P1=0/P2=0/P3=1. INGRESS-DOC-001: annotation said Funnel could never be admitted; actual code rejects only marked requests. Corrected at Attempt1 to state the controller must independently verify Funnel-off/ownership. NO_EXPLICIT_ERROR_CODE, no runtime failure. Independent Sol High final delta review PASS, P1/P2/P3=0; source/test fingerprints matched, finding closed at Attempt1.
- Production root-cause repair count remains0/2. No failed targeted tests or retry, timeout changes, security relaxation, actual credential initialization, system changes, Minecraft or provider execution.
- No commit/push/PR. Existing dirty investigation files retained, all historical BLOCKED evidence preserved. Report remains local; final source fingerprints and review recorded after delta check.

## Frozen candidate evidence

Boundary SHA256: `0E6FDC5AC8889094FF16C26935EAB4C1430102770C5CCF7439D9D65C229C47E7`.
Test SHA256: `0E18E0FB5B4B1A480F02D910BEE754ACC8B67CAFAA72BCBCA40F1A2E9AAF7726`.
Execution report: `test-results/p72b-ingress-boundary-b7fc76b0-2eab-4db6-a773-e89519ba379f.json` (Git ignored). Diff check exit0. Only comments changed after executable checks; no semantics changed. Review verified source fingerprints, and used the main-thread test/build evidence without rerunning tests.
