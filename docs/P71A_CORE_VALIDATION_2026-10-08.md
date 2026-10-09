# P7.1a isolated authentication core

Scope: password verifier, bounded memory sessions/CSRF/tickets/socket admission,
read-only private credential reader and conservative Windows ACL validator.
No HTTP/WS/main integration, account setup, credential writing or network changes.
Full P7.1a remains IN PROGRESS; this report is not an authentication deployment.

## Evidence

- Focused API `vitest run test/auth --maxWorkers=1`: 44/44 PASS, three files.
- API TypeScript `tsc -p apps/api/tsconfig.json --noEmit`: exit0.
- Independent GPT-6.1 Sol High read-only frozen core review: P1=0/P2=0/P3=0 remaining.
- Full `npm.cmd run check`: lint/typecheck PASS; default parallel tests FAILED
  (API1127 PASS/4 timed out at unchanged5000ms; contracts7/web140 PASS), exit1.
  Log `test-results/p71a-core-check.log` preserved private/ignored.
- Full single-worker workspace tests: contracts7/API1131/web140 =1278 PASS,
  exit0, `test-results/p71a-core-single-worker.log`. Production build PASS exit0
  separately in `test-results/p71a-core-build.log`; no timeout/assertion changes.
  Existing519.98kB chunk warning and Web jsdom navigation messages retained.
- Existing tracked diff check exit0; new source files also require lint/typecheck
  and focused validation, since Git diff does not include untracked files.

## Issue ledger

- P71A-RUNNER-001: initial test command ran from repository root while config
  includes `test/**/*.test.ts`; exit1 `No test files found`. Corrected cwd to
  apps/api; not a product root cause or a substantive fix attempt.
- P71A-SERIALIZATION-001 RESOLVED, Attempt1. Assertion originally:
  `expected '{"attempts":{}}' to be '{}'`; focused run 24 PASS/1 FAIL, exit1.
  TypeScript parameter properties were enumerable. PasswordVerifier dependencies
  and CredentialReader private path/ACL were changed to ECMAScript private fields.
  Original assertion retained; focused44 PASS. No credential hash/password leak
  was observed in the failing assertion.
- P71A-ACL-FLAGS-001 RESOLVED, static P3. Added numeric ACE flags upper bound so
  values above32-bit range cannot truncate into accepted flags; negative test PASS.
- P71A-SOCKET-ID-001 RESOLVED, static P3. Reject non-string IDs before regex
  coercion. No runtime error code; review delta closed.
- P71A-REGRESSION-001: default parallel run exit1, four existing transaction
  tests failed with `Error: Test timed out in 5000ms.` Locations: properties
  startup reconciliation, Fabric lifecycle, tombstone reconciliation and restore
  after:staging-verified recovery. No product fixes or higher timeouts applied;
  unchanged full single-worker regression passed. Retain parallel failure as
  a test execution limitation rather than rewrite it as PASS.

## Pending gates and next implementation boundary

1. Shared Manager lifetime exclusion: offline credential changes must use the
   same lock as Manager startup/lifetime. Port availability is insufficient.
   No automatic stale-lock deletion or PID-only ownership inference.
2. Explicit hidden-input local init/reset CLI; reject argv/env/noninteractive
   secrets. Never set credentials as part of tests or Manager startup.
3. Protected private-directory creation, native Windows ACL positive/negative
   tests, bounded atomic credential publication and verified reset backup.
4. Interruption/restart/concurrency tests and independent SolHigh review of that
   writer/lifecycle scope. Existing Minecraft transaction invariants stay intact.
5. Only after fullP7.1a Gate: HTTP routes/default deny, CSRF/audit, then login UI
   and WS authenticated tickets/revocation. Reauthentication and unified Access
   Coordinator must be complete before P7.2b Tailscale A/B/C.

Injected ACL snapshots validate parser/policy, not actual Windows effective
permissions. Same-user filesystem replacement is not OS isolation. Core socket
admission does not close real sockets; transport timers/revocation belong to the
later integration gate. No existing local route is claimed authenticated.

No Astra, commit, push, PR, credential setup or real Tailscale operation.
