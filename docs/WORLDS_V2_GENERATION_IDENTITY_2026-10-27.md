# New-world generation identity continuation

Status: IN PROGRESS; reservation data module is UNMOUNTED.

## Rejected boundary attempt

An attempted guard rejected legacy creation whenever a V2 catalog or anchor
existed. Actual Fastify startup already migrates the catalog, so this disabled
existing HTTP creation rather than integrating generation identity.
`worlds-v2-generation-boundary-2026-10-27.json`: 76 PASS / 4 FAIL retained.
The guard helper, writer/plan/app wiring and its three temporary tests were
precisely reverted; no other dirty work was reset. Original creation/plan
regression: `worlds-v2-generation-rollback-2026-10-27.json`, 77/77 PASS, exit0.
Existing assertions and timeouts were unchanged.

## Confirmed current gap

The old writer changes properties and legacy pending-generation state. It does
not reserve an immutable V2 world UUID. After synthetic generation, the catalog
refuses to select the new directory and does not rebind the old UUID.
`worlds-v2-generation-identity-gap-2026-10-27.json`: 1 PASS, 40 not selected.
The test confirms unchanged catalog bytes, preserved old world, pinned guard
and no Java start/stop. This is an isolated synthetic test, not Minecraft loading.

## Implemented bounded module

`world-generation-reservation.ts` defines a strict reservation proposal with a
fresh UUID and exact operation/transaction/catalog/root/revision/old-world/guard
bindings. Reading serialized data preserves the UUID. Unknown fields, physical
identity claims, unsafe target names, reused old UUID and unchanged properties
are rejected. Observation classification never accepts birth or success merely
because level.dat exists; partial/unsafe/mismatched observations require inspection.

This module has no persistence, IO, start, publication or recovery authority and
is not connected to main, routes, journal or catalog. A proposal must not be
regenerated after durable admission; the future journal must persist and verify
the exact accepted UUID before configuration changes.

`worlds-v2-generation-reservation-2026-10-27.json`: 10 PASS / 0 FAIL.
Scoped ESLint, API typecheck and diff check exit0. Independent GPT-6.1 Sol High
implementation/evidence review P1/P2/P3=0/0/0, limited pure-data unit ACCEPT.
This does not accept durable reservation, physical birth or generation execution.

## Next required implementation

### Dedicated reservation readback

`readGenerationReservation` now reads schema4 through a dedicated backend-only
path, not legacy consumer APIs. It requires the exact one-record active schema14
initial boundary with zero checkpoints, matching full-record/intent/reservation
digests; catalog revision and file identity are checked between two journal
observations. Returned metadata is cloned and grants no start, birth, write or
recovery authority. The caller cannot reuse this snapshot as a physical proof.

Missing journal, later checkpoints and committed records are explicitly rejected;
they need dedicated continuation verification rather than relaxed admission.
`worlds-v2-generation-readback-2026-10-27.json`:17PASS/0FAIL; independent Sol High
readback source/evidence review0/0/0 ACCEPT. API typecheck, scoped lint and diff
check exit0. Affected head/store/readback integration:
`worlds-v2-generation-readback-integration-2026-10-27.json`,77PASS/0FAIL/0pending,
exit0 (17+46+14; the standalone17 report overlaps, not an additional count).
No production caller or real Minecraft/world operation was added.

Latest quota observation: primary39% used, weekly99% used, ordinary use allowed;
no reset redeemed. Save this checkpoint before starting long-running work.

### Unmounted catalog reservation continuation

Catalog schema4 now stores the exact schema14 reservation and intent/record
digests separately from present entries. The old world remains present; there
is no invented physical identity for the new world. Only a first-only catalog
with one verified legacy-observation entry and no transition head is eligible.
Caller must retain the instance lease; this method grants no execution authority.

Admission reads the actual journal closed set (one exact active14, zero
checkpoints), catalog revision/root/previous physical identity, target-name
absence, properties digest and strict active-state digest/format. Publication
reuses existing protected catalog save with revision and file identity CAS.

Pending reservation projects a closed head for old transition consumers.
Legacy migration, resolve, activation binding and import audit explicitly reject
it. Journal deletion cannot make an empty import audit accept the reserved
catalog. Mixed heads and invalid reservation structures preserve evidence and
remain inspection-required. New reservation has no production caller.

Evidence: `worlds-v2-generation-catalog-reviewed-2026-10-27.json`,59PASS/0FAIL
(46 existing head +13 catalog tests); legacy store regression
`worlds-v2-generation-catalog-legacy-2026-10-27.json`,14PASS/0FAIL. Scoped lint,
API typecheck and diff check exit0. Earlier7-case and intermediate reports are
retained and overlap these results. Sol High found/closed two P2 and one P3,
final delta0/0/0 accepts the unmounted catalog unit. Candidate manifest
`worlds-v2-generation-catalog-candidate-2026-10-27.json` contains seven hashes;
final Sol High evidence readback7/7 matched, P1/P2/P3=0/0/0, bounded checkpoint
ACCEPT. This is not Phase1/V2 final or birth acceptance.

### Schema14 storage continuation

The existing transaction journal now supports an explicit schema14 worldChange
with the exact generation reservation. It binds inner/outer server, operation,
transaction, resource UUID, root, names, guard, properties and workspace; paths
are exactly source/target/staging in server namespace. Schema3 retains its old
format and cannot carry a reservation. Unknown versions/invalid bindings remain
unreadable and the original evidence is not rewritten.

Generic OperationService startup always assigns a generation-unverified cause,
including committed journals with saved succeeded/queued/running receipts;
prior generic confirmation is revoked. Generic confirm and owned recovery cannot
remove that cause. Legacy WorldCreateService reconciliation rejects schema14
before adapter/state access. These are closed storage/recovery boundaries, not
authorization to execute generation.

Evidence:

- `worlds-v2-generation-journal-2026-10-27.json`: initial35PASS.
- `worlds-v2-generation-journal-integration-2026-10-27.json`: intermediate
  affected integration, retained; predates generic generation gate fixes.
- `worlds-v2-generation-journal-final-2026-10-27.json`:119PASS/0FAIL, five files.
- `worlds-v2-generation-journal-review-delta-2026-10-27.json`:21PASS/0FAIL,
  includes the strengthened zero dependency-touch assertion; overlaps119.
- API typecheck, scoped ESLint and diff check exit0 after correcting a TypeScript
  closure narrowing error in the new path-set check.

Independent review found two P2 gaps (path binding and generic completion) and
one P3 evidence gap; all closed by independent Sol High delta review0/0/0,
unmounted storage ACCEPT. Replacement service affected regression:
`worlds-v2-generation-operation-regression-2026-10-27.json`,110PASS/0FAIL,
exit0. No full-repository/browser/Java rerun is claimed.

Candidate: `worlds-v2-generation-storage-candidate-2026-10-27.json`, seven
source/test files and three result reports. Independent Sol High final readback
10/10 hashes matched, P1/P2/P3=0/0/0; storage bounded evidence ACCEPT.
Tests use isolated files; no running Minecraft or real world was touched.

No production caller creates schema14 yet. Durable schema support is not a
persisted catalog reservation, birth verification or usable V2 new-world feature.
The older group candidate manifest is historical after these shared changes.

Extend existing worldChange intent under an explicit new record version, retain
old records and backup associations, and persist the exact UUID before writes.
Represent reservation separately from present catalog entries; retain the old
world as present. Bind actual generated directory identity to that same UUID
only through bounded physical verification, preferably after normal stop.
Guard startup auto pending-to-active/migrate paths from bypassing this proof.
First implementation should exclude import/activation/replacement histories;
ordinary start must not broadly bypass recovery gates. No automatic start.

No real server/world, backup repository, Windows settings, P7 or Git publication
was changed in this unit. No Phase1/V2 completion is claimed.
