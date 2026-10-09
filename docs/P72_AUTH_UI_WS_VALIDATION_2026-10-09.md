# P7.2 Authentication UI / WebSocket integration

Status: IN PROGRESS. Entry: P7.1b HTTP ENGINEERING PASS, 1353 frozen regression tests, independent Sol High P1/P2/P3=0. This is the authentication prerequisite slice in the current PHASE7_PLAN sequence; it is not P7.2b Tailscale Serve. No real administrator initialization, Minecraft/user-world access, host network change or Git publication.

## Implementation boundary

- One Sol High writer for shared auth contracts, HTTP/session/audit, WS route and frontend session integration. Independent Sol High review; no Astra.
- Explicit legacy auth status; status/network/schema failure cannot imply authentication is disabled. Root UI checks status/session before mounting management data views.
- Login/logout/reauth forms keep passwords out of query/mutation caches. Session/CSRF state is memory-only; no storage or URL secrets. Auth generation rejects stale requests/tickets/streams and prevents a late old-session401 from logging out a newer session.
- Every fetch path, including ZIP/JAR upload, uses the same cookie/CSRF/401 policy. Logout/401 cancels reads, clears sensitive caches and closes streams; successful login does not replay commands, uploads or mutations.
- Ticket issuance requires authenticated session, Origin/intent/CSRF, strict server ID and bounded one-use core. Browser offers exactly mcsm.events.v1 and ticket.<token>; only the public protocol may be selected. Existing stream cursor query fields remain non-secret.
- Actual WS upgrade has a final synchronous session/audit/Origin/ticket/resource check; after ticket consumption/reservation no await is permitted before101. Invalid ordinary/unknown paths cannot upgrade. handleProtocols rejection alone is insufficient.
- Real socket resource reservations remain bounded until close. Logout/rotation/expiry/clear closes1008 and releases subscriptions/timers safely; quiet sockets expire, and outbound replay/snapshot/live delivery revalidates after awaits. WS activity never extends idle session deadlines.
- Audit unavailable prevents new upgrades and closes existing streams; cleanup does not depend on a successful close audit. Logger output excludes raw header/body/URL/handshake error secrets.
- Existing transaction/recovery/admission/idempotency and legacy stream semantics remain mandatory. Already-admitted transactions are not canceled by authentication loss.

## Gates

Backend ticket/upgrade/revocation/capacity/expiry/audit negatives; frontend bootstrap/401-generation/cache/upload/stream negatives; strict contracts; 360/768/1440 browser verification; independent Sol High security review; one new frozen full regression including native tests; lint/typecheck/build/diff. Never substitute synthetic sessions for real remote acceptance.

Same independent root cause: at most two substantive repairs; second unresolved failure stops with raw code/log/source/attempts. No timeout increase, assertion weakening, skipped security checks or overwritten historical evidence.

## Pending evidence

No current implementation or test PASS is claimed by this design checkpoint. Gate results, findings and fixes will be appended with actual evidence.

## Backend implementation checkpoint / failures

Shared strict auth contracts built successfully. First API typecheck exited2 with TS2769/TS2345/TS2322 (safe logger serializer / overload shape, callback typing and exact optional hook values). Mechanical Attempt1 narrowed callbacks/defaults and hook declarations; remaining logger err serializer required type/message/stack fields. Attempt2 supplies fixed safe values; API typecheck v3 exit0. No strictness reduction or raw exception serialization. Logs p72-api-typecheck-v1/v2/v3 retained.

First backend focused run:73 PASS/1 FAIL, exit1 (74 cases). test/auth/ws-auth.test.ts:71 expected injectWS rejection, but a request with a valid cookie/protocol ticket and extra query-auth parameter upgraded. This is a real harness-discovered product boundary defect: AJV removeAdditional removed unknown query values before route schema inspection, while the raw-path guard accepted arbitrary queries. New independent root cause P72-WS-RAW-QUERY-001, Attempt1 is narrowly authorized: inspect raw URL before AJV and again before101; accept only existing paired replay cursor fields, reject unknown/secret/duplicate/encoded-key query entries. Preserve the original failing evidence p72-backend-focused-v1.log; no classifier change or assertion weakening. No UI/full PASS is claimed.

## 2026-10-09 continuation and intermediate evidence

The child writer stopped on a real usage-limit error; the parent resumed as the sole writer. No concurrent writer or account setting change. Raw-query Attempt1 closed by focused v2 78 PASS. Expanded v3 had88 PASS/1 FAIL: replacement socket401 after waiting only for the in-memory client's close frame. P72-WS-CAPACITY-FIXTURE-001 Attempt1 waited for server close too and hit the unchanged5000ms test limit; Attempt2 models actual abrupt transport closure on both paired injectWS streams. Selected test PASS, then complete backend v4 90 PASS. No production cap was relaxed. Normal real transport close is not inferred from that abrupt-close fixture.

Independent Sol High backend review found P2=1: SessionCore synchronous pruning can revoke another socket, synchronously exhaust audit and invalidate an earlier ready check. P72-AUDIT-SYNC-PRUNE-001 repaired with final ready checks after consumption/reservation/scheduling, live-check pruning and HTTP core/admission/response work; failed101 releases its reservation and does not restore its one-use ticket. Regression tests cover rejected101 with released capacity, HTTP503 with zero handler admission, and live1008/cleanup with no allowed delivery. Backend focused v5 92 PASS. Additional actual custom-logger secret-capture test passed with all45 WS cases (p72-ws-logger-v1.log). Independent backend source delta review P1/P2/P3=0; final frozen evidence and frontend signoff still pending.

Frontend now has explicit status/session bootstrap, memory-only CSRF/deadline/generation, bounded logout with immediate UI/cache/stream clearing, login/reauth without mutation-cache passwords, upload late-payload guards, one-use WS protocol tickets and1008 sign-out. Web focused v2 18 PASS. First new fixture typecheck failed TS2741 (missing required meta.mode) and TS2769 (Testing Library has no exact role option); narrow fixture Attempt1 fixed formal fields/options, typecheck v2 exit0. Lint v1 found prefer-const for a retained heartbeat handle; cleanup now clears and drops the handle, no timeout or admission change. Browser v1 360/768/1440 three PASS, synthetic auth/loopback mock only; no real credential or remote acceptance. NO_COLOR/FORCE_COLOR warning retained.

All earlier failed logs remain preserved. New frozen full regression, final lint/build/diff and independent final evidence review remain pending. No Minecraft, Tailscale, original-world, system/network or Git publication action.
