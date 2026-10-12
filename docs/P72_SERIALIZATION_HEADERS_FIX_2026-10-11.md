# P7.2 serialization and Headers fixes

Phase Final Gate: **BLOCKED**. Branch `codex/phase-4-players-properties`, base HEAD `c5beb16`. No commit/push/PR.

## Scope and first repair attempts

- Authentication serialization (Attempt 1): `HttpAuthentication.websocket` is backed by a runtime private field and exposed through a getter. WebSocket session/audit dependencies now use runtime private fields. Existing JSON `{}` assertion remains; direct JSON and enumerable-key checks cover the WebSocket object as well. Session, ticket, audit and revocation control flow remains unchanged.
- Headers assertions (Attempt 1): legacy apiP2 fixtures now inspect `Headers.get`/`has`, retaining exact intent, content type, idempotency-key and absence checks. No frontend product code changed.

## Validation

- API bootstrap/HTTP/WS focused tests: 93 PASS, exit 0.
- Web apiP2/authState focused tests: 10 PASS, exit 0.
- Project lint, typecheck, production build: exit 0.
- Build retains the Vite chunk-size warning (>500kB); no threshold change.
- Diff check passed before this documentation update; final check follows.
- Independent GPT-6.1 Sol High four-file delta review: PASS, P1=0/P2=0/P3=0; source review only, not a full Phase Gate.

## Preserved blockers and evidence

Historical full regression remains FAIL: `test-results/p72-final-check-2026-10-11.log`; no new full regression was run. Native ACL timeout remains UNKNOWN, underlying repair count 0/2. Revised timing sample `p72-observe-3fabe435-c577-493e-8cca-8e87048476e4` did not reproduce timeout; all 122 tracked helpers closed, five frozen diagnostic fingerprints restored. The sampling PASS does not resolve historical failures.

Addon lifecycle 5000ms timeout/ENOTEMPTY still needs separate read-only diagnosis. No ACL weakening, timeout increase, native test rerun, real credential initialization, Minecraft launch or remote-network action. A new frozen full regression and final independent signoff remain required for P7.2 PASS.
