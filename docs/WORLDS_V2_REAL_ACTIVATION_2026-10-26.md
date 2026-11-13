# Worlds V2 real activation checkpoint — 2026-10-26

Branch `codex/phase-4-players-properties`, base HEAD `bd0f932`; uncommitted
candidate. This is an activation slice, not Phase 1 or Worlds & Backups V2 final
acceptance. P7 remains STOPPED; no Git upload.

## First real run and minimum repair

Preserved report:
`test-results/worlds-v2-real-6cd8cf2e-ed11-4903-9e0f-265fca07aa2b/result.json`.
First world generation/save succeeded, then import preflight rejected the real
Vanilla 26.3 layout with `WORLD_COMPATIBILITY_UNVERIFIED`. Its DataVersion5023
world uses `dimensions/minecraft/{overworld,the_nether,the_end}`. The previous
blanket rejection of all `dimensions/` paths incorrectly rejected this observed
standard layout. No imported world was installed; owned Java exited normally.

Attempt 1 adds a shared conservative layout predicate, consumed by import,
activation planning, live history and recovery. Namespaced layouts require
readable exact26.3 metadata, DataVersion5023, exact standard dimension paths and
no mixed legacy layout. Custom namespaces/dimensions, case aliases, unknown
versions and ambiguous evidence remain blocked. Metadata/path checks are not a
promise that every world will load. Empty custom directories are outside the
file-inventory predicate's proof. Existing identity/hash/revision checks remain.

Focused46PASS; affected180PASS/0FAIL across four files. Reports:
`test-results/worlds-v2-standard-dimensions-focused-2026-10-26.json` and
`test-results/worlds-v2-standard-dimensions-affected-2026-10-26.json`.
Original timeouts and worker limits unchanged. Independent Sol High signed the
repair and pre-execution gate with P1/P2/P3=0.

## Real business retry

Report: `test-results/worlds-v2-real-59143d91-0c48-4291-b2c6-e70f64954a9f/result.json`.
Fresh owned UUID copy, verified source JAR and previously accepted EULA only;
original user worlds were not read or modified. Three actual Minecraft starts
loaded original, imported and returned original worlds, respectively. Each
reached managed/Done/RCON-ready state and stopped normally with exit0. Both
dormant world content checks passed. Import and two activation transactions are
committed; no journal issues. Owned children closed, forced terminations0,
Manager closed, original source unchanged.

Adjacent `candidate-observation.json` records14 source hashes and source mtimes
before the fixture. It is a **post-run observation, not a pre-execution freeze**.
The later main entry flag is a separately reviewed composition delta.

Business PASS is separate from diagnostics: strict diagnostics NOT_ASSESSED.
Each captured stdout has10 WARN and1 ERROR; additional stderr Java warnings are
not included in those counts. Perflib/COM, authentication service discovery,
JNA and Unsafe messages are not newly waived. Real CPU metrics and online
player authentication are not certified by this run.

## Independent process and browser evidence

`startup-observation-33505cd0-fbf2-455c-9e14-76088c703ce6.json` in the successful
run directory: a new OS Manager process recovered the actual saved history,
published available recovery and stopped state, and confirmed both world trees
and server.properties unchanged. No Minecraft server launch; Java-version
metadata probes allowed. All14 stages passed; library reconciliation615.85ms.
Manager closed normally. Observer pre-execution review P1/P2/P3=0 after fixing
nested canonical-path checks to precede file reads.

Fresh synthetic React + actual Fastify browser report:
`test-results/worlds-v2-activation-browser-ed338ae3-3974-4495-a57e-5bd7e64b5137.json`:
360/768/1440 all3PASS, no Minecraft. Cleanup report
`test-results/worlds-v2-browser-cleanup-195c39b4-8e20-44ce-b6c7-a336b9676e7b.json`:
both owned children closed, forced0. Per-run UUID artifact paths preserve older
reports and traces. Independent Sol High parsed these reports and the real run.

## Local entry delta and remaining work

`main.ts` now supplies trusted `worldActivationExecution:true` only in its
existing local composition block. The reusable buildApp default remains false;
no request/environment flag, automatic switch or Minecraft start is added.
Final entry checks:148PASS/0FAIL/0pending across3files, report
`test-results/worlds-v2-local-entry-2026-10-26.json` (import/activation107,
idempotency6, HTTP authentication35). API build, scoped main ESLint and
git diff --check exited0. The guarded roundtrip remained4617.8714ms within its
unchanged5000ms limit. Independent GPT-6.1 Sol High parsed the final test report,
reviewed the local-only flag and accepted this local exposure checkpoint with
P1=0/P2=0/P3=0. Build/lint/diff are writer-run evidence; the reviewer did not
claim to execute them. No full-stage or release signoff is implied.

World replacement/new-world identity integration, restic, scheduling/queue,
retention, unified four-tab UI and final stage regression remain unfinished.
Hot backup remains disabled. Older crash evidence predates the layout repair;
it is retained as historical evidence, not relabeled as fresh source validation.
