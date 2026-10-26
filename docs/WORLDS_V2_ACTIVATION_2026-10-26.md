# Worlds V2 activation preparation — IN PROGRESS

Latest continuation supersedes the earlier "no startup verifier" checkpoint:
[first-activation physical recovery](./WORLDS_V2_ACTIVATION_RECOVERY_2026-10-26.md)
is now integrated read-only. The activation write executor/API/UI remains closed.
Earlier failure reports and scoped signoffs below remain historical evidence.

Branch `codex/phase-4-players-properties`, HEAD
`9f7cf498940b8e8c357b44ba1da8d201751463e4`. Existing uncommitted work retained.
This checkpoint extends the October25 V2 report; it does not replace its evidence.

## Implemented scope

- `apps/api/src/services/world-activation-plan-service.ts`: read-only first
  activation preparation for a separately imported inactive Vanilla26.3 world.
  Holds existing instance read admission, requires stopped/unowned process,
  rejects active/unknown targets, checks random lineage IDs and library revision,
  verifies original committed import evidence, complete current/target trees,
  metadata/profile and properties identity plus bytes. Rechecks after awaited
  work. Returns opaque revisions, executionAvailable=false and loadVerified=false.
- `world-library-import-service.ts`: extracts the unchanged complete startup
  verification into `verifyCommitted`; both startup and read-only activation
  preparation reuse it. Only startup's successful caller marks physical
  confirmation. The new helper never changes recovery state or writes evidence.
- `world-library-import-service.test.ts`: covers no-write preparation, changed
  inactive content, missing original journal, current target, invalid ID, running
  process, unknown version, late current-tree change, and same-content properties
  replacement. No activation execution route or UI is exposed.

## Verification

- Latest affected suite23 PASS/1file, exit0,15.04s; raw structured report:
  `test-results/worlds-v2-activation-preflight-2026-10-26-v1.json`.
- API typecheck and changed-file ESLint PASS. No whole-project regression was
  repeated for this bounded backend slice. Web code unchanged in this slice.
- Shared recovery refactor revalidated at `independent-identity-installed` and
  `independent-after-commit` in actual separate owned Node processes:2 PASS,
  exit0. Evidence:
  `test-results/worlds-v2-import-crash-7994c753-969a-4d07-a679-92ec835501ef/result.json`.
  Contains source hashes and child close records; fixtures retained. No Java.
- Independent GPT-6.1 Sol High source review: P1=0/P2=0/P3=0.
- Independent advanced safety delta review: P1=0/P2=0/P3=0; it independently
  checked10/10 source hashes in the new crash report. Its earlier usage-limit
  failure is historical; retry succeeded. Neither reviewer ran tests or signed
  activation writes, supersession, actual loading or the final V2 Gate.
- Sol High suggested same-content properties replacement coverage; the added
  test passed without product-code modification and preserves the replaced file
  within its isolated fixture. No original assertion/timeout was weakened.

## Required activation transaction, not yet implemented

The current inactive import proof intentionally binds its exact imported tree.
After legitimate Minecraft use that tree changes. Therefore activation needs
its own durable journal evidence before any write path is opened:

1. Bind root/catalog/current/target lineage and directory identities, both
   revisions, original import transaction/checksum, and activation chain head.
2. Recheck stopped state and original full imported content; create and verify
   current-world protection backup and configuration protection copies.
3. Persist intent before switching `level-name`; update the compatible legacy
   active slot and verify the immutable V2 lineage binding. Do not auto start.
4. Commit only after physical configuration/state/guard verification. Use an
   explicit predecessor/sequence chain, not timestamps, to verify subsequent
   activation history. Missing/contradictory/uncommitted evidence stays gated.
5. Only a verified activation chain may supersede the corresponding historical
   exact-content requirement. Retain import proofs and sources. After use,
   verify directory identity, layout, version and current revision; do not
   require original imported bytes forever and do not broadly bypass checks.
6. `ActiveWorldStateStore.installImportedWorld` is only a final checked primitive;
   it still uses legacy name-derived slot IDs and clears its internal marker.
   It is not a generic recovery authority. Never clear unrelated recovery causes.

The first-preparation service currently supports original imported targets only;
returning to a previously activated world requires the future activation-chain
verifier. It is not represented as available today. Guard creation, executor,
explicit recovery, API/UI, crash tests and real Minecraft activation remain work.

No user server, world, backup, restic repository, system/network setting or Git
publication was changed. V2 remains IN PROGRESS; P7 remains STOPPED.

## Continuation: durable activation intent and restart gating

Implemented the schema10 `worldActivation` payload in the existing transaction
journal, not a second transaction store. It binds root/catalog, immutable source
and target lineage, both world/content revisions and directory identities,
original import transaction/checksum, configuration before/after hashes,
protection backup ID, workspace and explicit sequence/predecessor. Four exact
source/target/staging/rollback paths are required. It is stopped-only and cannot
request an implicit stop. Unknown/malformed types fail before intent publication.

The reserved `world-activate` OperationKind is accepted by existing operation
storage; no route, UI, execution controller or automatic activation was added.
Both startup journal and operation passes require physical confirmation for
activation, including committed records and saved successes with missing journals.
No activation record currently grants permission to skip original imported-tree
verification. Chain continuity, guard checks and the executor remain incomplete.

### Failures retained and repairs

Initial targeted run:52 PASS/1 FAIL, exit1. Exact failing test:
`activation schema10 evidence > persists exact first activation bindings and
keeps unverified committed evidence gated`, test line36 at that candidate.
Assertion: `expected false to be true`, recoveryRequired actualfalse/expectedtrue.
Cause: OperationService's first terminal-journal pass had not included the new
activation payload, even though the saved-operation pass had been updated.
Repair attempt1 added activation to that first pass and its mandatory physical
confirmation condition. Original assertion was retained.53 PASS followed;
report `test-results/worlds-v2-activation-journal-2026-10-26-v1.json` retained.

Independent review then found P2/P3 foundation correctness issues: predecessor
self-check compared against operationId rather than transactionId, and a test
fixture used obsolete storage fields. Fixed by case-insensitive record-level
transactionId self-check, two self-cycle regressions, and real StoredOperation
`requestFingerprint`/`expiresAt` fields. No timeout/assertion was weakened.
Both independent reviewers closed their findings; scoped P1=0/P2=0/P3=0.
The advanced reviewer classified its initial findings P3/P3 while Sol High used
P2/P3; both original attributions are retained rather than silently normalized.

### Current evidence

- Journal/operation tests55 PASS/4files, exit0,1.63s:
  `test-results/worlds-v2-activation-journal-2026-10-26-v2.json`.
- Contracts30 PASS/8files, exit0,1.28s. API typecheck/scoped ESLint/diff PASS.
- Two affected real owned Node-process crash/restart boundaries passed again
  after schema10/operation changes:
  `test-results/worlds-v2-import-crash-f8c4e8b8-89d7-4efb-a51c-4d9fc3295b31/result.json`.
  No Java launched; fixtures/evidence retained and child close confirmed.
- New recheck of importer/preflight/HTTP suite is recorded separately in
  `test-results/worlds-v2-activation-preflight-2026-10-26-v2.json`.

These are preparation/integration results, not activation-write signoff or V2
final acceptance. Next implementation remains actual protected activation and
lineage-aware committed-history reconciliation, then HTTP/UI wiring. Original
world data, backup repositories and P7 behavior were untouched. No Git upload.

## Continuation: actual first-activation execution candidate

`WorldActivationService` now performs the first stopped Vanilla26.3 activation
using existing OperationService, schema10 journal, Legacy manifest/export checks,
restore copy/inventory helpers and ActiveWorldStateStore's checked final primitive.
It is NOT mounted by app.ts and has no production API/UI. Subsequent activation
history is explicitly unavailable, rather than being guessed from timestamps.

Implemented order: final approval/instance/source proof; durable intent; exact
current/target inventories; pinned world guard; verified config before/approved
copies and staged config; rechecked guard/copies/identity; config rename; checked
legacy active slot; full final verification and commit. No data tree is deleted
or replaced, and no automatic stop/start occurs. Both worlds remain in place.
Source import journal and activation intent must remain unchanged. Pending
results are not replayed; same key returns its original operation.

The planner's new internal `inspectUnderLease` avoids nested operation admission
during already-admitted preflight/execution. The ordinary `plan` still takes its
own read admission. `WorldLibraryStore.activationBinding` returns catalog and
directory ownership only to backend callers; it is not serialized in HTTP.

### Independent findings, repairs and retained failure

Sol High first found two P2s: guard manifest/export checks did not revalidate
payload contents, and the final checkpoint was followed by commit without a new
double-tree check. Both were fixed. Guard validation now checks exact payload
root and full original files, pinned manifest content/identity and guard directory
identity. Final checkpoint is followed by both tree hashes and catalog/active
lineage checks. Damage-injection regressions cover each case.

The first payload repair called a world-root helper on its wrapper directory.
That helper correctly required root level.dat and rejected normal completion:
33 PASS/1 FAIL, exit1, expected succeeded/actual interrupted at the first activation
test. Original structured evidence remains:
`test-results/worlds-v2-first-activation-executor-2026-10-26-v1.json`.
Repair attempt1 corrected the call to payload/currentName, requiring the wrapper
to contain exactly that one root. No helper/timeout/assertion was loosened.
34 PASS followed, retained in the v2 JSON at the same report prefix.

Advanced safety review then found one P2: config protection copies were verified
only after overwriting server.properties. The fix pins and journals both copy
identities/checksums and verifies them after awaitable boundaries and before
rename, as well as before commit. Four regressions damage each copy at each of
two boundaries and require original config/active slot/world to remain unchanged.
Both independent reviewers closed all findings: scoped P1=0/P2=0/P3=0.

A subsequent typecheck reported TS7034/TS7005 for protectedCopies closure inference
(exit2); an explicit array element type fixed it, with no runtime change. Final
API typecheck, changed-file lint and diff checks pass.

### Verification and actual safety scope

- Final38 PASS/1file, exit0,31.32s; no individual timeout was changed:
  `test-results/worlds-v2-first-activation-executor-2026-10-26-v3.json`.
  Includes successful first activation/pinned backup/replay, four in-process
  interruptions, damaged stage/guard/copies, late current/target changes,
  failed backup verification and stale approvals, plus retained import/HTTP tests.
- Real separate owned Node-process cases: activation-intent-persisted,
  activation-guard-verified, activation-config-installed, activation-state-installed,
  activation-after-commit. Final five-boundary PASS report:
  `test-results/worlds-v2-activation-crash-5e889bc2-f93a-4c88-88f4-0ba6bfae3c99/result.json`.
  It includes listed source hashes, PID/close records, stable key/operation/world
  IDs, no replay, unchanged server bytes during probe, original world and guard
  preservation,0 Java starts. Fixtures retained. This is Fake Minecraft with
  actual Node OS-process termination, not real Minecraft or completed recovery.
- Earlier five-boundary candidate report is retained independently:
  `test-results/worlds-v2-activation-crash-1f6f2b16-48f7-492a-8297-afdeca9cc7ac/result.json`.
  It precedes the final protection-copy fix and is historical evidence only.
- Every activation outcome, even after committed, is EXPECTED to remain recovery
  gated after restart until a dedicated physical-history verifier exists. The
  process test does not reinterpret that gate as a successfully recovered switch.
- No new browser acceptance/full regression/real Minecraft load was run. The test
  cases created only owned isolated guard backups; no real user world, legacy
  backup, restic repository, system setting or Git publication was changed.

Next required work: committed activation-history and supersession validation,
restart/unknown recovery handling, repeated activation support, and only then
strict API/confirmation UI and real loading acceptance. Keep production wiring
closed until those Gates pass. V2 remains IN PROGRESS, P7 STOPPED.
