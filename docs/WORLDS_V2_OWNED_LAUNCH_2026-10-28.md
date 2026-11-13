# Private owned launch observation

Status: bounded runtime facts implemented; no generation lifecycle endpoint.

The existing LocalMinecraftRuntime now retains only its latest launch's private
observation: random launch ID, server, owner operation, PID, actual spawn event,
ready, stop request/operation/completion, error, exit code/signal and close.
Each event closure updates only the exact captured child record. A fresh attempt
clears the old record; getters return copies and return null after closeObserver.
Reconstructed runtime instances have no historical witness. No second supervisor,
PID adoption, persistent database, HTTP DTO or remote functionality was added.

Exit, error and close remain distinct. An error never invents exit0; stop API
completion never means normal exit. Existing start/stop status decisions, signal
handling, port leases and deadlines are unchanged. The API is optional in the
internal runtime contract; existing Fake runtimes remain compatible.

## Evidence

- Focused report `worlds-v2-launch-observation-2026-10-28.json`:5PASS,
  39 not selected. These overlap the full suite.
- Full existing runtime suite:
  `worlds-v2-launch-observation-runtime-2026-10-28.json`,44PASS/0FAIL/0pending.
  Tests use real owned Node children, synthetic readiness and Fake probes,
  not Java/Minecraft. Covers requested exit0/exit2, unexpected exit2, stale
  old-child events, fresh runtime reconstruction, spawn throw, copied data and
  disposal. Existing live-child-error/port test now also asserts no fabricated
  exit before the actual owned child exit/close.
- Scoped ESLint, API typecheck, diff check exit0. An initial TypeScript narrowing
  error was fixed by retaining the exact attachChild result for ready observation;
  no timeout or assertion was weakened.
- Independent Sol High source/evidence delta P1/P2/P3=0/0/0 ACCEPT; the one P3
  missing current-child-error coverage was closed. Final frozen readback5/5
  matched, P1/P2/P3=0/0/0 bounded ACCEPT:
  `worlds-v2-launch-observation-candidate-2026-10-28.json` (five files).

No real Minecraft or world was operated. Test Node processes use exact owned
handles and normal existing fixture teardown. No Git publication/system/network
changes. P7 stays STOPPED; M3 historical evidence is not rewritten.

## Remaining boundary

These process-local facts are not durable birth evidence. A dedicated explicit
generation continuation must bind the prepared reservation, approved registered
execution identity, absent target before launch, exact new launch, readiness,
normal owned stop with actual exit0/signal=null/error=false and close, then
stopped candidate observation and catalog publication. Runtime loss on restart
must leave inspection, never reconstruct success from stale logs/PIDs. No caller
currently uses these facts to start generation, publish worlds or clear recovery.
