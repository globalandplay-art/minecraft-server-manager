# Phase 7 — Authentication / Remote Access

Status: P7.0 DESIGN PASS. Independent SolHigh P1=0/P2=0/P3=0.
2026-10-09 current checkpoint: P7.1b HTTP auth ENGINEERING PASS, frozen v3;
focused 69 PASS, new full regression 1353 PASS (contracts7/API1206/Web140),
final lint/typecheck/build/diff PASS and independent Sol High engineering/evidence
signoff P1/P2/P3=0. Explicit local required mode is implemented; no real credential
was initialized. Login UI and authenticated WS remain future work; required-mode
WS is denied fail closed. No remote service/network settings were enabled.
See P71B_HTTP_AUTH_VALIDATION_2026-10-08.md. The entry text below preserves the
preceding P7.1a checkpoint and does not supersede this current status.
Entry baseline Phase6 FINAL PASS,2026-10-08. P7.1a ENGINEERING PASS:
core, shared Windows Manager lifetime lock, offline init/reset/recover and private
publication verified; new frozen full regression 1294 PASS and independent SolHigh
P1=0/P2=0/P3=0. Next slice P7.1b HTTP authentication and global guards.
Authentication is not integrated or enabled; no real administrator credential was
initialized. See P71A_OFFLINE_VALIDATION_2026-10-08.md for final evidence and limits;
P71A_CORE_VALIDATION_2026-10-08.md preserves the earlier core checkpoint.
P7.0 freezes the security architecture before implementation. Existing runtime,
transactions, recovery and data gates remain mandatory. This document does not
enable authentication, TLS, tunnels, listeners or account credentials.

## Current boundary and threat model

Fastify/Vite currently bind127.0.0.1; Fastify trustProxy=false, exact Host/Origin
allowlists and forwarded-header rejection. JSON writes require Origin plus
X-Manager-Intent. These are browser-request protections, not authentication.
WebSocket requires Origin but no user session. API reads expose management data;
console commands and filesystem writes are high consequence.

Protect against unauthenticated clients, password guessing, session theft/fixation,
CSRF/CSWSH, forged proxy headers, replay, unbounded auth work and credential leaks.
Do not claim protection against a same-user administrator replacing private files,
malware/keyloggers or XSS with arbitrary same-origin execution. Do not weaken
existing filesystem/process identities, locks or recovery to add authentication.

## Scope and sequence

| Slice | Scope | Required gate |
| --- | --- | --- |
| P7.0 | Threat model, contracts, deployment boundaries and independent SolHigh design review | docs consistent, no product or host changes |
| P7.1a | Single-admin password verifier, offline setup/reset, bounded in-memory session/ticket core | filesystem/crypto/expiry/revocation focused tests, SolHigh |
| P7.1b | Authentication HTTP routes/global guards, CSRF and bounded audit | unauthenticated route inventory, Host/Origin/upload/download tests, SolHigh |
| P7.2 | Login/logout/session UI and WebSocket session/ticket integration | expiry/revocation/reconnect/instance separation,360/768/1440, SolHigh |
| P7.3 | Explicit remote profile and same-origin production asset hosting; proxy/TLS transport | selected transport reviewed before any host/account/network change |
| P7.4 | Fresh isolated auth/remote negative and end-to-end acceptance | new full regression, independent SolHigh Final Gate, no original-world mutation |

No multi-user/RBAC, account registration, OAuth, self-service remote setup,
Internet listening, router changes or release automation in the initial scope.
Single admin has full registered-instance access; access to transaction actions
still depends on existing confirmation/admission/recovery rules.
Ordinary implementation SolMedium; security/concurrency/auth SolHigh; no Astra.
Single writer for auth guards/WS/runtime interactions. At most two distinct fixes
per root cause; preserve failures and stop/report on second unresolved attempt.

## Credentials and private persistence

No HTTP setup endpoint or default password. First credential and offline reset
require local CLI explicit action with hidden interactive password entry; no
password argv, environment-variable setup, echo or plaintext file. No automatic
EULA, network or instance mutation. Reset requires manager stopped and preserves
previous private record for controlled recovery; old sessions cannot survive restart.

Initial password:15–128 Unicode code points, UTF8≤512bytes, no implicit trimming
or normalization, allow spaces. Credential record uses versioned Node scrypt,
fresh≥16-byte random salt,64-byte hash, N=2^17/r=8/p=1, bounded maxmem256MiB.
Validate stored parameters against this profile before hashing; constant-time
equal-length hash comparison. Unknown usernames do equivalent dummy-verifier
work after rate admission; public login failure is generic.

Store only username/salt/hash/approved parameters/credential revision in private
manager auth directory. Use existing controlled path/file identity and atomic
publish patterns: reject links/hardlinks/unknown roots, bounded JSON, no overwrite
without verified revision. Windows permission verification is explicit, not a
claim that chmod secures ACLs. If permissions cannot be validated, fail closed
for authenticated/remote operation; do not recursively change user-profile ACLs.
Credentials/secrets must never enter DTO, logs, downloads or server-snapshot
backups. Existing backups only cover registered server roots, not manager auth.

Windows private ACL gate freezes the current process user SID as owner/primary
principal; only that SID, SYSTEM and built-in Administrators are trusted allow
principals. Auth directory,credential record,private reset backup and audit files
must have protected DACLs (no inherited broad allows) and required current-user
rights. Reject other Allow ACEs granting read/list data,write/create/delete,
ownership or permission changes; ambiguous group/conditional ACEs,unknown owner,
unreadable/unparseable security descriptors fail closed. Deny ACEs do not justify
accepting an unverified broad Allow. Existing parent traversal permissions are
not recursively rewritten. Setup may create its own private ACL explicitly;
verification must inspect actual effective rights, not assume a mode flag worked.

## Bounded authentication work

One password hash active globally, no unbounded wait queue; busy429 with
Retry-After. Single-admin limiter:5 admitted attempts per5-minute fixed window,
success resets only after verified password; rejected/busy attempts do not hash.
Use monotonic time and bounded fixed counters, no attacker-keyed unlimited maps.
No reliance on spoofable forwarded IP. Process restart resets counters (explicit
local threat limitation), not credentials. Auth body≤2KiB and strict schema;
full-body streaming uploads may not begin until request authentication passes.

## Sessions and browser state

Opaque256-bit random session token; server stores digest, not raw token. Sessions
in memory only, max8 globally, creation after password verification always issues
fresh token. Idle expiry30minutes, absolute8hours; monotonic deadlines, fixed
configuration in first implementation. Authorized HTTP requests may refresh idle
deadline, including active-page polling; absolute deadline never extends. WS
heartbeats/push do not refresh idle deadline. Logout revokes immediately; offline
credential reset/Manager restart invalidates every session. No JWT persistence.

Cookie only: HttpOnly, SameSite=Strict, Path=/, no Domain. Loopback HTTP development
uses mcsm_local_session without Secure and accepts only existing local authorities;
it is not a remote profile. Remote HTTPS uses distinct __Host-mcsm_session with
Secure; never reuse a development cookie/token as a remote session. No passwords,
session tokens or CSRF tokens in localStorage/sessionStorage or URLs. Frontend
clears sensitive query caches/streams on logout/401. No automatic replay of a
failed mutation after login; uncertain existing operations retain same-key workflow.

One random256-bit CSRF token bound to session, with raw value and validation digest
retained only in its bounded in-memory session record; session bearer token itself
remains digest-only. Authenticated session GET returns the same CSRF value for
reload/new tabs (a digest cannot reconstruct it). Destroy both CSRF values on
logout/expiry/restart and never persist or audit them. Token
returned by authenticated session endpoint to JavaScript memory only. Every
mutation, including logout and WS ticket issuance, requires exact allowed Origin,
appropriate content type, existing intent header and X-CSRF-Token. Reject
null/missing/cross-site Origin and mismatched token; SameSite alone is insufficient.
Login has no prior session: exact Origin, JSON/intent, same-site request checks,
strict body and rate guard; rotate/revoke prior login session if present.

## HTTP contract draft — not implemented

| Route | Access / data |
| --- | --- |
| GET /api/v1/auth/status | Public minimal configured/authenticationRequired state; no credentials/instance data |
| POST /api/v1/auth/login | Strict {username,password}; Origin/intent/rate gates; Set-Cookie, {authenticated:true,expiresAt,csrfToken} |
| GET /api/v1/auth/session | Session required; {authenticated:true,expiresAt,csrfToken}; no session token |
| POST /api/v1/auth/logout | Session+CSRF; revoke, clear matching cookie,close sockets; {authenticated:false} |
| POST /api/v1/auth/ws-ticket | Session+CSRF; strict {serverId}; one-use ticket and30-second expiry |

All auth responses/errors no-store. Minimal unauthenticated liveness/status only;
existing detailed /health, registered-instance metadata, metrics, evidence,
logs, downloads, operations and mutations require authentication once enabled.
Global default-deny guard; explicit method+path public allowlist, no prefix bypass.
Production login SPA assets may be public only from an exact build-manifest
allowlist; no directory listing, private files or API/WS fallback to HTML. Static
serving and login assets are implemented in P7.3 before remote deployment.
Auth failures401 before instance lookup/body processing; authorization denial403;
invalid Origin/CSRF403, strict-body400, busy/rate429, setup-required503 without
private error paths. No accidental CORS wildcard or OPTIONS/write bypass.
All reads remain subject to Host/Origin policy; Authorization bearer fallback
is outside initial scope. Transport must not change Mode or existing DTO meaning.

During implementation auth is explicitly staged off under legacy-loopback profile
to preserve prior local workflows. Authentication-required deployment with missing
credentials fails closed. Remote profile can never allow auth-disabled fallback.
P7 Final documentation must state how user opts into authenticated local mode;
legacy local mode is not remote-ready. No account or config changed by this plan.

## WebSocket contract

Browser obtains ticket via CSRF-protected HTTP and opens existing event URL with
cookie plus Sec-WebSocket-Protocol values mcsm.events.v1 and ticket.<token>.
Response selects only mcsm.events.v1; no secret in query, URL or echoed protocol.
Proxy/server logs must redact full ticket header. Ticket is one-use,30seconds,
bound to session digest, serverId and exact Origin; issuance max8 pending/session,
max4 sockets/session and32 globally. Atomically consume before upgrade; failure
requires new ticket, never replay. Cookie and session remain required.

Revalidate session before replay/subscription and each outbound delivery; absolute
or idle expiry/logout/reset closes socket1008, unsubscribes and cancels timers.
Existing stream cursors, schemas, ordering/backpressure/ping limits remain.
Expiry is not delayed by a silent socket: timer checks nearest session deadline.
No WS commands added. Session loss does not cancel already-admitted filesystem
transactions or trigger rollback; operation executes to its existing safe boundary.
New HTTP commands/mutations require live session at admission, never bypass
transaction locks, idempotency, ownership or recovery because login succeeded.

## Remote transport — pending user choice and later deployment approval

Preferred design is private Tailscale access with TLS reverse proxy to loopback
Manager, never exposing Fastify8080/Vite3000 or RCON publicly. Cloudflare Tunnel
with Access is a separately reviewed alternative, not an automatic deployment.
No provider installation, credentials, DNS/proxy/firewall/ACL changes here.
First remote profile hosts production frontend and /api /ws on one exact HTTPS
origin; dev Vite is not a remote web server. TLS/access layer supplements app
sessions and CSRF, it does not replace them. App still listens127.0.0.1.

Freeze exact hostname, TLS termination and proxy header behavior after transport
choice; current blanket forwarded-header rejection must not be replaced with
trustProxy=true. Only a named loopback proxy and explicit configured authority
may be accepted, with rewritten single-valued Host/forwarding metadata and no
arbitrary client-selected origin/scheme. Direct8080 traffic cannot inherit proxy
identity merely because headers say so. Windows loopback is not proof of a trusted
process; remote guard assumes trusted local OS users, and proxy config/header
boundary must be tested. No IP claim grants app permissions.
Malformed/conflicting Host, forwarded chain, HTTP remote downgrade, unknown origin,
invalid certificates and failed app auth fail closed. Transport disable preserves
private data and restores strictly local configuration; no system-wide changes.

## Audit and gates

Bounded private audit: login failure/success,logout/expiry,auth/CSRF denial,
WS open/close/revocation and mutation admission linked to request/operation IDs.
No password, cookie, ticket, CSRF, raw URL/query, command body, RCON or paths.
Max1KiB/event, max10MiB rotating files,3 files; private identity/retention controls.
Audit sink failure must not corrupt transactions; auth setup/remote preflight
must report unavailable audit and not claim full remote readiness.

Tests: hash profile/credential identity; generic failures; rate/busy bounds;
session fixation/revocation/time jumps/restart; cookie flags; all route inventory
unauthenticated negatives; Origin/CSRF/upload/download auth; ticket reuse/cross
instance/Origin/expiry; WS logout while streaming; no mutation replay on login;
3000/8080 remain loopback; forged proxy/TLS/no-auth remote refusal; secrets absent
from HTTP/WS/audit/download; real remote positive/negative fresh isolated instance.
UI360/768/1440, focused tests, new full check, lint/typecheck/build/diff; independent
SolHigh start/security and Final review. Remote acceptance waits actual selected
transport authorization and evidence; mock transport is not real remote PASS.

## Design review history

Initial independent SolHigh review: BLOCKED P1=0/P2=1/P3=1.
P70-CSRF-001 MEDIUM: digest-only CSRF storage could not reproduce the token
required by session GET/reload. No explicit error code; static design contradiction,
not runtime failure. Attempt1 specifies bounded memory raw+digest CSRF storage,
stable authenticated return and destruction on revocation, bearer remains digest-only.
P70-ACL-001 LOW: private Windows ACL validation criteria unspecified. Attempt1
freezes trusted owner/SIDs, protected DACL, dangerousAllow rejection and ambiguous
descriptor failclosed for credentials/reset backup/audit. No explicit error code.
Independent delta PASS, P1=0/P2=0/P3=0; both findings CLOSED by Attempt1.
Final doc diff check PASS; no product code/tests/deployment performed in P7.0.
Remote choice remains pending; user requested an explanation of the options.
Next slice P7.1a can proceed independently of transport selection.

## Primary references

- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

Parameters/bounds above are project design choices, not claims of implementation.
