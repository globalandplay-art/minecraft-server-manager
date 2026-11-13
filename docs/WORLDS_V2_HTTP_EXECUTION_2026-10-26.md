# Activation HTTP execution candidate — isolated integration

Production activation routes are still unmounted. This checkpoint wires the
candidate route to an actual WorldActivationService with catalog-head protection
inside a real Fastify test application, existing HttpAuthentication/SessionCore,
shared journal/file/operation store fixture and isolated Minecraft directories.
No real Minecraft process is started. No production source changed in this unit.

## Covered behaviors

- HTTP202 admits the actual asynchronous transaction; success is asserted only
  after the executor's terminal operation, committed journal/head and exact
  installed configuration are checked. Original-world bytes remain unchanged.
- Identical key/body returns the same operation with one activation journal;
  changed body/same key conflicts rather than running again.
- Stale approval has zero new intent, catalog/config or operation-store changes.
- Missing/invalid UUID key, invalid CSRF/Origin, coercible IDs, arbitrary target
  path/allowStop and incorrect world-name confirmation fail before admission.
  Each negative request verifies unchanged persisted state, not only HTTP code.
- Session revocation and genuine SessionCore expiry after awaited
  source validation both reject with401 before operation persistence. Only the
  injected test monotonic clock advances; product session limits are unchanged.
  At8h+1 both idle/absolute bounds have elapsed; this does not isolate which
  deadline alone rejected the session.
- Interruption after configuration installation yields unknown/recovery-required;
  reusing the same key returns that same operation without another switch.

## Evidence

`test-results/worlds-v2-activation-http-2026-10-26.json`:4PASS/93filtered,exit0.
`test-results/worlds-v2-activation-http-negative-2026-10-26.json`:1PASS/97filtered,
exit0, including8 rejected request variants.
`test-results/worlds-v2-activation-session-2026-10-26.json`:2PASS/97filtered,exit0,
revoked/expired session variants. These are targeted runs, not full API results;
the revocation case overlaps the first report and counts must not be added.

Final affected HTTP/startup selection:
`test-results/worlds-v2-http-execution-final-2026-10-26.json`.
Actual10PASS/0FAIL/89filtered,exit0,21.31s, including the six actual executor tests
plus preparation and affected startup/import-auth checks. API typecheck/scoped
lint/diff PASS. Independent GPT-6.1 Sol High test/evidence scope P1/P2/P3=0; the
reviewer read source/focused reports but ran no tests/edits/Git/Astra. Final10-test
run is writer evidence; candidate-only limits below remain mandatory.

## Limits before production exposure

The manually registered candidate controller uses the fixture OperationService;
the composed app has its own normal operation-query service. Tests deliberately
assert actual executor/store outcomes and DO NOT claim live app GET-operation
or WebSocket publication wiring. That shared production composition must be
implemented and verified before opening writes or UI. Plan still reports
executionAvailable=false/loadVerified=false; no availability assertion is widened.

Same-instance cancellation/recovery leases, operation query/event integration,
truthful enablement capability, full browser confirmation and real Minecraft
world loading remain separate work. No V2 FINAL PASS, real Java, Git upload or P7.
