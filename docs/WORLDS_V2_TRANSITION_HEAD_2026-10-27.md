# Worlds V2 unified transition preparation — IN PROGRESS

Resumed by the authorized01:16 scheduled task. Natural account window reset was
observed (primary0%used, weekly31%used); no reset credit redeemed. Read-only process
inventory initially received CIM0x80041003 in the sandbox; the authorized elevated
read-only query succeeded and found no matching project tests. No process killed.

## Accepted design and implemented scope

Independent GPT-6.1 Sol High recommends one ordered transition head rather than
two independently linked heads. Replacement must explicitly retire the old
immutable ID, preserve its bytes/guard/provenance and create a new ID; it cannot
reuse a legacy name-derived slot as lineage. Old slot/config bytes normally need
no rewrite for same-name replacement. A pending head, not claimed multi-file
atomicity, is the admission boundary.

Implemented structural projection handles activation and explicit replacement
events. Only replacement may release the live name; retired IDs and directory
bindings cannot become new activation targets or be silently reused. It verifies
sequence/predecessor, current-world continuity, root/catalog/server binding,
unique operation/transaction/guard IDs and safe names. This is NOT a journal
parser, physical proof, recovery confirmation or execution authority.

The activation-only adapter first runs unchanged old chain/source-guard checks.
Event metadata UUIDs are normalized while original journal objects/digests remain
unchanged. Mixed replacement history is explicitly rejected by that old adapter.
Historical path-bound directory identity is distinct from rename-stable staged
object identity; future replacement checkpoints must verify both and containment.

## Catalog compatibility

Schema1: no head. Schema2: exactly activationHead. Schema3: exactly transitionHead.
Mixed/missing/mismatched forms fail closed. Reading does not migrate. A new
verified activation reservation writes schema3 and removes the old field in the
new catalog version. Completing/invalidating a schema2 operation preserves2.
All pending/list/import/audit/startup detection consumers use the effective head.
Original journal bytes, sequence and whole-record/prefix digests remain exact.

The backend read-only projectLegacyTransitions first verifies saved head over
original journal evidence, then projects structural events. It grants no physical
recovery authority and does not accept replacement journals.

## Evidence and open boundaries

Focused64PASS/0FAIL/0pending (head15/history25/projection24), report
`test-results/worlds-v2-transition-head-2026-10-27.json`.
Final affected192PASS/0FAIL/0pending across5suites, report
`test-results/worlds-v2-transition-head-affected-2026-10-27.json`.
Current-source OS report:
`test-results/worlds-v2-repeated-crash-5dfd6cab-2344-4c24-b832-effc6ae35d04/result.json`:
four boundaries PASS, all23 source hashes match, eight owned children closed,
zero Java; pending2 gated/interrupted, complete2 physically confirmed with exact
resource IDs. Both world bytes unchanged. New catalogs are schema3 with no old
activationHead. Existing timeout/protocol/assertions unchanged; harness manifest
only gained the new structural module.
Fresh synthetic React/actual Fastify browser360/768/1440 all3PASS, report
`test-results/worlds-v2-activation-browser-bcc34bb9-fc9f-4fa6-980a-9125fa85da10.json`.
Owned cleanup83aaa814-7e27-4d03-8b83-14b648218b3e: both children closed, forced0.
API typecheck/scoped lint/diff PASS. A test-only prefer-const lint finding was
fixed without assertion changes. Independent Sol High schema3 source review
P1/P2/P3=0; independent Sol High accepted the source, affected suites, OS and
browser evidence. API build exited0. This closes only activation-compatible
schema3 preparation, not replacement or whole-stage acceptance.

Earlier real Vanilla loading and OS interruption reports predate schema3 and
remain historical. No Minecraft start or user world modification in this unit.
No replacement parser/executor, physical retired-proof resolver or same-name
restore acceptance exists yet. V2 remains IN PROGRESS; P7 STOPPED; no Git upload.

Mandatory next boundaries include new-ID intent, pending reservation, upload
claim, guard publication, stage validation, each rename before/after checkpoint,
catalog publication, journal commit, head completion and operation publication.
Incomplete states must remain gated; no automatic replay/rollback/deletion.
