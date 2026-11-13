# Worlds V2 read-only replacement preflight — checkpoint accepted

This is a read-only preparation unit following accepted local activation, not
world replacement delivery. No replacement executor or frontend mutation button
is enabled. Existing independent import and activation remain separate.

`POST /api/v1/servers/:serverId/world-library/replacement-plan` accepts only
`{uploadId}` through existing local HTTP/session/Origin/CSRF boundaries. It uses
the shared instance admission lease and upload lease, verifies local Vanilla26.3
observed version, stopped/unowned state, immutable current catalog identity,
upload ownership/revision, NBT version and conservative layout compatibility.
It rechecks current file inventory, configuration file identity/content, instance
root, active state and catalog revision before returning observations.

Response includes current world ID/name/revision/content hash, upload revision,
catalog/property revisions, source version/size/count. It explicitly states
`executionAvailable:false`, `requiresProtectedBackup:true`,
`serverMustBeStopped:true`, `REPLACEMENT_TRANSACTION_PENDING`.

No identity is allocated, upload claimed, world/configuration modified, backup
created or command issued. This response is not an approval token or promise of
future compatibility. A later executor must revalidate everything, allocate a new
lineage ID in durable intent, verify a pinned guard, preserve the former world,
install through protected staging and reconcile ambiguous interruption states.
The browser cannot select a target filesystem path or override the active ID.

Implementation reuses WorldLibraryImportService's source/current inspection;
only an explicit private read-only purpose bypasses independent import's
new-name-absence check. All actual import execution retains its original
independent path, including observed version and absent-target validation.

Final affected run:155PASS/0FAIL/0pending across two files, exit0. Report:
`test-results/worlds-v2-replacement-plan-final-2026-10-26.json` (114 import/API,
including all7 replacement cases;41 compatibility). Contracts32PASS; final API
typecheck, scoped ESLint and diff check exit0. No timeout/worker changes.
Earlier focused5PASS and intermediate153PASS are retained as earlier candidates.
Independent GPT-6.1 Sol High source and final report review P1/P2/P3=0;
bounded read-only preflight evidence Gate closed. Reviewer independently parsed
155PASS and all7 new cases. Guarded roundtrip3765.69ms stayed within5000ms.
Other static/contract commands are writer-run evidence, not reviewer-run tests.

Cases cover no write/claim/identity allocation, running instance rejection,
cross-registered-instance upload rejection with both catalogs unchanged,
observed target-version drift, newer source rejection, external configuration
change, strict DTO/CSRF/session protection and absent replacement execution.
This unit uses isolated files and Fake Minecraft, not real replacement acceptance.
No real Minecraft run is needed to prove this no-write API unit. V2 remains
IN PROGRESS; P7 STOPPED; no Git upload.

Next execution unit: persist a new immutable lineage ID before changes, bind
exact current lineage/content/config/catalog/source approvals, create and verify
a pinned guard before same-name displacement, retain the old world and recovery
evidence, install from protected staging, then publish catalog/active pointers.
Do not reuse a legacy name-derived backup association or infer completion from
matching names. Execution/recovery design requires independent safety review.

## Next transaction design inspection (not approved for execution)

WorldLibraryStore.recordInstalled can retire an entry and assign a new lineage,
but this alone is not an executable replacement protocol. Its verifyJournal
requires imported entries to remain present with no replacement link, while
WorldActivationLiveHistory derives retained-world proofs from birth imports and
ordered activation departures. Same-name replacement needs consumers that
explicitly verify this transition; the activation head currently binds only
activation evidence. Do not relax those assertions or reuse a legacy name-based
import to bypass lineage checks. A new existing-journal replacement intent and
ordered transition proof must cover backup/staging/catalog/active publication,
future import/activation and startup recovery. Independent Sol High architecture
review requested, recommendation PENDING; no replacement executor implemented.
