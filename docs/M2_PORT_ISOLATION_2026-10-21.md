# M2: same-Manager port arbitration and RCON launch binding

## Scope and implementation

Branch `codex/phase-4-players-properties`, baseline HEAD
`d2dadab4c144e5031490e0d2da4b34556524d366`. Existing uncommitted M1 work retained.
This slice extends the existing runtime; no new supervisor, native helper,
CommandStore dependency, system configuration or remote work.

- `infra/runtime/port-reservations.ts`: synchronous atomic game/RCON TCP port
  arbitration within one factory. Roles must use distinct valid ports; cross-role
  conflicts reject before spawning with safe `INSTANCE_PORT_CONFLICT`. Each launch
  has its own Symbol owner; idempotent old release cannot remove a later owner.
- `local-runtime.ts`: shared factory reservations, role-bound RCON port, release
  only on child exit or failed spawn without PID. Readiness timeout, stop failure,
  live-child error and observer shutdown cannot free an uncertain live process's
  ports. An independent exit listener survives observer shutdown.
- RCON configuration reads reject a different RCON port or enabled/null state
  after launch. Console/stop use existing executeGuarded and verify captured child,
  current lease, expected lifecycle state, no recovery and same client at dispatch.
  Whitelist retains its existing generation/admission/single-send checks and now
  also binds the launch lease. No uncertain automatic retry or stdin fallback.
- `app.ts`: hot registration requires the explicit factory used by initial local
  adapters. When unavailable, save succeeds as pending instead of inventing an
  independent factory. Production main already shares one factory for both paths.

Reservations do **not** bind OS sockets or prove an OS listener PID. Another
process/Manager can still race for a port. No external process is stopped or
adopted. This limited protection cannot stand in for full M2 real RCON ownership.

## Tests actually executed

All logs below remain ignored in `test-results/`; no old logs overwritten.

| Candidate | Result | Evidence |
| --- | --- | --- |
| Initial focused runtime + new port unit tests |39PASS/2files, exit0|m2-port-runtime-v1.log|
| Affected runtime/RCON/server/config/activation/whitelist/auth |139PASS/8files, exit0|m2-port-affected-v2.log|
| Factory correction: activation/registration/app |61PASS/3files, exit0|m2-port-factory-delta.log|
| Final runtime including simultaneous distinct ports |35PASS/1file, exit0|m2-port-runtime-final.log|
| Final root typecheck |PASS, exit0|m2-port-typecheck-final.log|
| Final root lint |PASS, exit0|m2-port-lint-final.log|
| Final production build |PASS, exit0|m2-port-build-final.log|
| Diff check |PASS, exit0|m2-port-diff-final.log|

Suites overlap; do not sum them as a unique full regression. Final added tests
check game/RCON and cross-role conflicts, partial-acquire rollback, invalid/self
ports, late duplicate release, synchronous spawn failure, actual owned Node child
exit, live-child error, timeout plus observer close, RCON role drift/disable with
zero stdin, and distinct-port children alive concurrently with isolated stop.

For Console/stop/whitelist, controlled executeGuarded waits at its callback
boundary, A exits, B starts and takes the same in-memory RCON port, then A resumes.
No command reaches the write log; Console/whitelist reject, while stop may finish
because A has already exited. This is a generation race test using a Fake RCON
boundary, not a real OS RCON listener ownership test. Test children are isolated
Node fixtures, not Minecraft or unknown user processes.

No timeouts, assertions, existing security requirements or concurrency parameters
were relaxed. No legacy native/crash/capacity tests were run. Web/contracts/browser
code did not change this round; earlier evidence is retained, not rerun needlessly.
No repository-wide full API regression is claimed; historical2510PASS/12FAIL
remains, as does the separate strict Perflib real-acceptance BLOCKED record.

## Review and issue ledger

- Design Sol High review required guarding actual dispatch, per-launch ownership
  and RCON role (not just membership in the game/RCON port set). Implemented.
- `M2-FACTORY-SHARING-001`, P2, RESOLVED: independent source review found buildApp's
  fallback created a new factory per added instance. That branch is now pending
  without an explicitly shared factory; regression asserts201/saved/not loaded,
  no new runtime/start and404 for the inactive ID. Fix Attempt1, no runtime error
  or explicit error code was produced by this source-review finding.
- Final independent GPT-6.1 Sol High delta review: **P1=0/P2=0/P3=0**, scoped source
  signoff. Reviewer inspected the61PASS log, did not execute tests or Minecraft.

## Result and remaining work

**This M2 arbitration/dispatch slice: ENGINEERING PASS. Full M2: IN PROGRESS.**
Remaining: real OS game/RCON listener attribution and external port races; fresh
authorized real multi-instance lifecycle/RCON acceptance; verified Forge/NeoForge
launch descriptors. A single authorized Vanilla test registration does not
silently authorize other real instances. No actual Minecraft launched this round,
no original worlds accessed, no network/system changes, no commit/push/PR.
P7 remains STOPPED. Existing historical evidence and uncertain fixtures retained.
