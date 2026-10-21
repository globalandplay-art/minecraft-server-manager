# M1 instant loading and multi-instance isolation

## Delivered slice

Candidate based on `d2dadab4c144e5031490e0d2da4b34556524d366`, branch
`codex/phase-4-players-properties`; local changes, no commit/push/PR.

Existing-directory registration now persists and immediately loads a fresh ID.
The Servers list/selector refresh without restarting Manager or old adapters.
No Minecraft launch, world generation, RCON enablement or server-file change is
performed by registration. Existing instance state, stream identity and metrics
history remain intact. Newly loaded performance IDs are admitted only after
registry lookup; unknown IDs remain404.

The coordinator reuses the shared RuntimeFactory, registry, OperationService,
transaction journal, active-world state and event streams. It rejects a closing
Manager, existing ID/history/recovery, old controlled namespace evidence and
unreadable/ambiguous ownership metadata. Scans of random-ID owner stores are
bounded. Only the new Vanilla active-world record is initialized; no global
reconciliation or scheduler reset. Event and registry attachment has no await
between its two publication steps. Failed attachment detaches in-memory state
and closes the new observer while retaining saved registration and physical
evidence. Initialization failures also close partially-created runtime observers.

Response distinguishes saved from loaded: `loaded=true/restartRequired=false`
means usable in this Manager. Otherwise the registration is pending, with a safe
error code and no automatic retry. Existing user settings/evidence are retained.

## Verification

- Affected API59PASS/6files (activation, registration, active-world, stream,
  lifecycle admission and local runtime); additional stream/app/HTTP-auth64PASS.
- Performance fix integration19PASS/3files, including activation11 tests and
  unchanged old-instance sample history. These suites overlap; counts are not
  summed as a unique full regression.
- Contracts25PASS/6files; full Web221PASS/37files.
- Browser360/768/1440:3PASS. Checks actual React save/refresh, two visible cards,
  single submission, reload persistence and no horizontal overflow. Fake HTTP.
- Root lint/typecheck/build and `git diff --check`: PASS, exit0. Final static
  checks after M2 test additions are `m2-hot-typecheck.log`/`m2-hot-lint.log`;
  `m1-m2-diff-check.log` records the final whitespace check.
- Independent GPT-6.1 Sol High final source/delta review: P1=0/P2=0/P3=0.
  The discovered P2 (new ID missing from PerformanceHistory) is fixed and tested.

Logs: ignored `test-results/m1-hot-*.log`. Original failure logs retained:
`m1-hot-api-v1.log` used an invalid LogEntry fixture, fixed to the real contract;
`m1-hot-types-v1.log` TS2379 optional journal corrected by conditional spread;
`m1-hot-affected-v1.log` had two original5000ms test timeouts under concurrent
validation load. The deterministic Fake fixture now hashes small inert Java
identity bytes instead of the large real Node executable; those bytes are never
executed. The subsequent affected suite passed. No timeout, assertion, concurrency
parameter or production identity requirement was weakened.

## Gate and limits

**M1 instant-loading / multi-instance isolation slice: ENGINEERING PASS.**
Isolation evidence covers registered files, whitelist, logs, metrics/history,
stream/replay IDs, per-instance exclusion/recovery and attachment failure/shutdown.
It is not a claim of real simultaneous Java/RCON port ownership verification,
all-loader M1 completion, M2 completion or repository-wide final PASS.

No new real Minecraft launched. Historical P5.5 Paper/Fabric acceptance is not
relabelled as a fresh hot-registration run. Forge/NeoForge launch descriptors,
first Java-profile setup, automatic port correction, replacing/removing existing
registrations and automatic retry of pending activation are outside this slice.
External same-user configuration races and Windows power-loss durability retain
the previous documented limits. Legacy full API2510PASS/12FAIL, strict real
diagnostics BLOCKED and old native failures remain unchanged. Perflib is an
independent deferred host issue; no old CommandStore experiments rerun. P7 STOPPED.

Next: M2 integration of existing trusted Paper/Fabric lifecycle with newly loaded
instances; actual supported boundaries and new tests must be reported separately.
