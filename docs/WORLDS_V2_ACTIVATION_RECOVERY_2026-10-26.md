# Worlds V2 first-activation recovery — scoped integration PASS

Overall Worlds & Backups V2 remains **IN PROGRESS**. This is not delivery of
activation HTTP/UI, repeated switching, replacement, restic or real loading.

Branch: `codex/phase-4-players-properties`.
HEAD: `9f7cf498940b8e8c357b44ba1da8d201751463e4`.
All work remains uncommitted. Earlier UI/L1/M3 changes and evidence are preserved.

## Actual change

`WorldActivationReconciler` verifies one committed first activation with an
explicit sequence1/null predecessor and exactly the required ordered checkpoints.
It binds source import, catalog/root and both immutable IDs/directories; verifies
the entire pinned guard, manifest identity and checksum, old inactive world,
protected config copies, original source and DataVersion. The approved config
must be the exact result of changing only level-name in its before copy.

The newly active target may have saved data changes. It must still have the same
directory object, safe complete layout, readable matching version/DataVersion,
and a strict persistent schema1 active slot. Current settings may change normally
while level-name stays correct; they are not frozen to the old full config hash.
The old inactive world remains bound to the full protection guard contents.

The importer consumes a precise internal proof, including activation/import
transaction IDs, activation operation ID, journal digest, catalog ID/revision,
world/root/name/directory and original checksum. It verifies the actual bindings,
releases the upload lease, obtains a fresh proof and checks it again. Only after
all checks does it synchronously confirm the two exact physical outcomes.
The activation reconciler never prematurely caches success or clears unrelated
recovery causes. No replay, rollback, deletion or evidence repair occurs.

`OperationService` reconstructs the world result from physically verified journal
evidence when a crash happened after commit but before result publication.
Saved success, a matching member/name/list or journal committed alone remains
insufficient proof.

## Actual startup wiring

`app.ts` mounts only read-only recovery: legacy import reconciliation, activation
precheck, V2 import/final proof consumption, then operation-state publication and
active-state initialization. No WorldActivationService executor or new write
route/UI is constructed.

`ActiveWorldStateStore.initialize` accepts an optional protection set. The app
includes activation journals, persisted activation operations, scan recovery
servers and attributable issues. Unknown issues conservatively protect all
registered instances; the existing initial unattributed-issue refusal remains.
Protected missing records are not created, and non-active historical records
are not automatically promoted. Valid ordinary legacy initialization remains.

Archive history is explicitly unsupported by this first-activation profile:
the executor refuses it before admitting writes, and recovery refuses it too.
The old archive reconciler is not given a timestamp-based bypass. Full repeated
activation/legacy archive-chain integration is still required before write UI.

## Findings and repairs retained

Sol High found two recovery P2s in the initial 46-PASS candidate:

1. Early copies/guard checks could become stale during awaited source reads.
2. A supersession proof could become stale before final import confirmation,
   and early activation confirmation could outlive missing journal evidence.

Repaired by final protection/live-file rechecks, precise journal/catalog proof
consumption, a second complete proof after releasing the upload lease, and
deferring both confirmations until final success. Six late-mutation/result
regressions were added. Both independent reviews closed these findings.

Startup review then found two further P2s: a historical pending-generation slot
could be automatically promoted and pass on the next boot; corrupt journal plus
missing operation could evade the missing-slot protection set. Both are fixed,
with consecutive-startup and combined-corruption tests. Both independent source
reviews report **P1=0/P2=0/P3=0** for this slice. Reviewers did not run tests or
sign activation write, repeated-history or real Minecraft Gates.

Earlier JSON reports v1 (46 PASS), v2 (52 PASS) and v3 (54 PASS) remain separate;
their green results did not include the later missing coverage and must not be
treated as final evidence. The intermediate targeted startup run was2 PASS with
54 cases unselected by `-t`, not a whole-file result. Final v4 runs every case.

## Verification actually executed

- `npm.cmd run test --workspace @mcsm/api -- test/world-library-import-service.test.ts --reporter=default --reporter=json --outputFile=../../test-results/worlds-v2-activation-reconcile-2026-10-26-v4.json`
  **56 PASS,0 FAIL,0 skipped**, exit0,59.79s. Includes actual Fastify startup,
  exact result recovery, normal saved target/settings changes, corruption,
  late-proof invalidation and no regeneration across consecutive startups.
- Affected suites `active-world-state`, `world-archive-service`,
  `world-library-store`, `world-activation-journal`, `operation-store`:
  **86 PASS/5files**, exit0,22.05s. With the preceding module this is142 distinct
  focused tests across6files, not the repository's full API suite.
- API typecheck, API production build, changed-file ESLint and diff check:
  **PASS**, exit0. A test-helper prefer-const diagnostic was fixed without
  runtime behavior changes. No timeout or assertion was weakened.
- Final real OS-process evidence:
  `test-results/worlds-v2-activation-crash-f941b360-9920-47d0-a9c1-7dbc23a9fa70/result.json`.
  **6 boundaries PASS**, every owned child closed,0 Java starts, listed source
  hashes preserved. Precommit four cases stay gated. Commit-before-result and
  after-commit cases are physically verified and recover succeeded with the
  exact world ID. The after-commit case retains an explicitly simulated new
  world file; it does not claim real Minecraft saving/loading.

The old five-boundary reports intentionally expected even committed activation
to remain unknown because no physical verifier existed. Those reports remain
unchanged; the new assertions require the implemented verifier, correct result,
no replay and data preservation. They do not rewrite old acceptance outcomes.

The OS tests use independently restarted Node processes with Fake Minecraft and
real filesystem operations. The Fastify startup tests above use a real Fastify
app in the test process. These two types of evidence are separate; neither is
called a real Minecraft load or a real-browser acceptance.

## Safety and remaining scope

No real Minecraft instance, user world, legacy user backup or restic repository
was modified. Only isolated fixtures created protective backups. OS fixture
evidence remains retained; no uncertain process/directory was force-cleaned.
No system/network/ACL setting or Git publication changed. P7 remains STOPPED.

Next: repeated activation/return to the original world with a complete history
chain, strict confirmation API and UI, then independent browser/real loading
acceptance. Interrupted/contradictory activation remains inspection-required;
this slice only recognizes complete committed evidence, not automatic recovery
of partial operations. Replacement, restic, schedules, queue, retention and hot
backup remain unfinished. No V2 FINAL PASS is claimed.

Large-world startup duration and close/cancellation behavior are not certified
by these small fixtures. Before opening activation writes, integrate any heavy
verification with the existing bounded Manager recovery coordinator; do not
raise Fastify timeouts or release instance gates early to conceal slow scans.
