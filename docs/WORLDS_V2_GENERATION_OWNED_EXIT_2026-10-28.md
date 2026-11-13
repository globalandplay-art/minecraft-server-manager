# Worlds V2 — ephemeral owned-child exit verification (2026-10-28)

Scope: read-only in-process binding, not a launcher, cleanup service or birth proof.
Independent GPT-6.1 Sol High final evidence review: bounded ACCEPT, P1/P2/P3=0/0/0; 5/5 frozen SHA-256 matched.

captureGenerationOwnedLaunch is kept beside candidate observation. It reads the
registered Vanilla26.3 adapter's actual runtime observation, binding server,
execution operation, a fresh launch UUID and positive PID only after spawn/ready.
A previously stopped/exited/errored observation cannot create this binding.

The returned closure re-reads the same adapter/runtime on each assertion. It
requires the same launch UUID, PID and owner; stop requested and completed by
the execution operation; actual exit code0, null signal and close; retained
spawn/ready facts and no error. Disposed/missing/replaced observations fail.
Stopped status, successful stop API return, logs or a PID alone are insufficient.

No snapshot is persisted or accepted as a reconstructed process witness. No
process is started, stopped or killed by this function. It does not release an
operation owner or recovery gate, publish a world, or prove saved data validity.
The future coordinator must perform sealing, physical/registered-identity checks,
owned stop/cleanup, candidate validation and publication independently.

## Evidence

Report: test-results/worlds-v2-generation-owned-exit-2026-10-28.json
86PASS/0FAIL/0pending: new Fake observation30, candidate observation12 and
existing LocalMinecraftRuntime44 (controlled owned Node children; no Java).
API typecheck/scoped ESLint/diff: exit0.
Candidate: test-results/worlds-v2-generation-owned-exit-candidate-2026-10-28.json

Remaining: owned cleanup retention and bounded shutdown coordinator, actual
controlled generation, stopped birth/publication, startup integration. V2 remains
IN PROGRESS; no Minecraft/world/system/network/Git publication changes. P7 STOPPED.
