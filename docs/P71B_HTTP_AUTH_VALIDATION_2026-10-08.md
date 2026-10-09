# P7.1b HTTP authentication — implementation checkpoint

Status: IN PROGRESS. Entry P7.1a engineering PASS (1294 frozen regression tests). No real account, Minecraft instance, Tailscale or host network changes are authorized by this slice. No commit/push/PR.

## Frozen implementation intent

- `MCSM_AUTH=required|off`; unset preserves explicitly staged legacy local behavior only without credential/pending/stage. Credential presence never permits unauthenticated fallback. Required startup verifies private credentials before adapters and initializes protected audit persistence.
- Root-scope authentication at `onRequest`, after existing Host/Origin guards and before body parsing/uploads. Only exact GET `/api/v1/auth/status` and POST `/api/v1/auth/login` are public. Instance data, health detail, downloads, uploads, operations, unknown routes, HEAD/OPTIONS and mutation routes do not bypass session validation.
- Login/session/logout/reauth routes reuse the bounded password/session core. Cookie-only local HTTP profile: HttpOnly, SameSite=Strict, Path=/, no Domain; remote profile remains unavailable. Duplicate/ambiguous cookie data is rejected. Strict login/reauth body limit 2KiB; no secret-bearing query authentication.
- Writes require the existing allowed Origin and intent plus session-bound CSRF before admission. Existing filesystem/lifecycle content-type, identity, idempotency, transaction and recovery gates remain unchanged.
- Reauthentication is bounded, monotonic and session-bound (five-minute window); it does not replace session authentication. Future Access Coordinator will separately define which network actions require recent reauthentication.
- Authentication-required WebSocket upgrades are fail-closed pending P7.2 ticket/revocation integration, including requests with valid HTTP cookies. Legacy local behavior is preserved only with authentication explicitly staged off.
- Audit stores fixed safe event fields only, maximum 1KiB/event, three 10MiB private files, bounded pending appends. Permission/identity or sink failures become sticky unavailable; no new authenticated work may be admitted under uncertain audit state. Login must not leave an issued session after failed success auditing.

## Gates pending

Focused route inventory and security negatives; upload/body parser non-admission; session rotation/logout/expiry/reauth races; protected audit identity and bounds; startup required/off behavior; existing legacy regressions; independent Sol High review; new frozen full regression; lint/typecheck/build/diff.

At most two substantive fixes per independent root cause. Preserve raw failures; no timeout increase, relaxed security assertions or unknown warning suppression. Single writer for coupled auth/app/main/session/audit modules.

The previous P7.1a failure logs remain historical. No current P7.1b test result or final signoff exists at this checkpoint.

Reference: [Fastify hook lifecycle](https://fastify.dev/docs/latest/Reference/Hooks/) establishes `onRequest` before body parsing; inherited root hooks are tested against child plugins and route overrides rather than assumed safe from documentation alone.

## 2026-10-09 independent candidate review (freeze v1)

Independent GPT-6.1 Sol / High: P1=0, P2=1, P3=2. Candidate is not signed off. The 10-file size/SHA256 manifest matched; focused v4 50/50 and native audit 1/1 passed, API lint/typecheck passed. These checks do not replace the pending new frozen full regression.

- P2: onRequest authentication could become stale while body parsing or an asynchronous route preHandler waited; final business-handler admission must revalidate live session, CSRF and audit state. Preserve the early preparse guard and already-admitted transaction semantics.
- P3: login response used creation-time remaining lifetime and hardcoded recent reauthentication after audit waiting; return the current live session view.
- P3: the earlier local Origin rejection omitted the fixed csrf-denial audit event; add safe observation without recording raw headers or changing rejection behavior.

Each root cause starts substantive Fix Attempt 1. One writer handles auth/app/HTTP/test changes. Required next gates: focused regression, independent delta review, new frozen full regression, lint/typecheck/build and diff check. No account initialization, Minecraft launch, remote configuration or Git publication.

Historical fixture failures remain preserved in p71b-http-fixture-v1.log and p71b-focused-v1.log. Header omission, route registration order and persisted audit sequence expectation were fixed without relaxing product constraints. Earlier IN PROGRESS and pending statements above are historical checkpoints, not current final evidence.

## 2026-10-09 Attempt 1 candidate, freeze v2

All three candidate findings received one substantive repair. Root onRoute wraps ordinary HTTP handlers after parser/route hooks, preserves Fastify receiver binding, and revalidates audit/session/CSRF synchronously after any admission-audit wait immediately before calling the original handler. WebSocket handlers remain excluded from signature wrapping and required-mode upgrades remain denied. Login uses the post-audit live session view. Local Origin rejection invokes a fixed event/request-ID observer; sink failure returns safe 503, without hashing the hostile request or collecting raw headers.

Focused v2: 67/67, exit0 (10.58s). New cases cover slow parser and child async preHandler with logout/expiry/audit failure and valid positive admission; logout during admission auditing; an already-admitted operation continuing; controlled clock advancement for login; fixed Origin rejection audit/no hashing/sink failure and legacy behavior. Actual WebSocket route is tested with and without cookies. API typecheck/lint and diff check exit0. Freeze v2 contains 11 files; independent delta review and new full regression remain pending.

A separate mechanical lint failure was preserved: @typescript-eslint/no-this-alias in the wrapper. Its first correction captures lexical arrow closures while retaining the original Fastify handler receiver, without disabling lint rules. Original failure: test-results/p71b-attempt1-lint-v1.log. Final focused/lint/typecheck evidence: test-results/p71b-attempt1-{focused,lint,typecheck}-v2.log.

## Freeze v2 delta review: remaining P2

Independent Sol High verified all 11 file hashes and closed the three original findings, but did not sign off: P1=0/P2=1/P3=0. Auth-success handlers still lacked the synchronous auditReady recheck after their awaited success audit. An active append can complete while another queue overflow/close has made the audit sink sticky unavailable. Login must not issue a cookie, and reauthentication must not update its deadline, under that state. This is the same audit fail-closed final-admission root cause; its narrowly scoped Attempt 2 is authorized. Full regression has not started. No third repair is permitted for an unresolved same root cause.

## Freeze v3: independent static delta PASS, full Gate running

Same audit final-admission root cause Attempt 2 adds synchronous auditReady checks after successful login/reauth audit and before Cookie issuance or reauthentication update. Regression simulates a successful pending record fulfilling after the sink became unhealthy: login returns503/no Cookie and revokes the new session; reauth returns503 without extending the controlled six-minute-old state. Focused 69/69 exit0 (10.60s), API lint/typecheck and diff exit0. All 11 freeze v3 hashes verified independently. Sol High v3 static delta: P1=0/P2=0/P3=0; no unresolved findings. This static result does not replace full Gate evidence.

New single-worker full workspace regression started as test-results/p71b-final-tests.log; final lint/typecheck/build have separate p71b-final-* logs and exit files. All original native tests remain enabled, original timeouts unchanged. Exact commands preserve the check pipeline components while explicitly bounding test concurrency; do not describe this as the default parallel npm run check having passed.

## 2026-10-09 frozen full validation results

New full single-worker regression finished with exit0: contracts7/API1206/Web140, total1353 PASS; API1046.06s, Web67.13s. All native auth/offline/lifetime-lock and audit tests are included, no skips or timeout extensions. Logs: test-results/p71b-final-tests.log and p71b-final-tests.exit.txt. Final lint/typecheck/build each exit0 with separate p71b-final-*.log/.exit.txt evidence. Parent reverified all 11 freeze v3 size/SHA256 entries (mismatch0); diff check exit0. Final independent evidence signoff remains pending at this checkpoint.

Known nonblocking output: existing jsdom navigation-to-another-Document messages and production bundle519.98kB advisory. PowerShell formats native stderr as NativeCommandError in the captured log; actual process exit files and passed suite counts are0/complete. Do not hide this output or reinterpret it as a failing test suite.

## 2026-10-09 Final engineering signoff — PASS

Independent GPT-6.1 Sol / High verified the frozen full results, all11file size/SHA entries, all11 native cases (lifetime lock3/private publication7/audit1), and final lint/typecheck/build exit0. P1=0/P2=0/P3=0. P7.1b HTTP ENGINEERING PASS. Earlier pending statements remain historical checkpoints closed by this result, not rewritten history. Final documentation diff check is required after this closure.

Boundary: no real administrator credential or required-mode environment was enabled. No Minecraft/user world, Tailscale, host network or Windows configuration changes. No commit/push/PR; branch codex/phase-4-players-properties, HEAD eaf9f8520d507a5de8bac1c17ca5cf6f1c478955; preexisting uncommitted Phase6/7 changes preserved. The test process has exited;3000/8080 have no listeners. Do not infer all unrelated host helpers are absent.

Next slice: login/logout/session UI and authenticated WebSocket ticket/revocation integration; only afterwards unified Access Coordinator and the separately gated P7.2b Tailscale stages. required-mode WS still fails closed, remote HTTPS profile is unavailable. Cookie Secure semantics for local HTTP must not be reused for remote access. Audit rotation has bounded private files; Windows fsync/sudden power-loss durability and same-user administrator/malware boundaries remain limitations, not a claim of universal crash durability.
