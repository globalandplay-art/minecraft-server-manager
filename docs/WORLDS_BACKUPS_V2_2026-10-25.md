# Worlds & Backups V2 — implementation checkpoint

Status: IN PROGRESS. No V2 engineering or real-Minecraft PASS is claimed.

2026-11-13 update. The opt-in first managed lifecycle now has authenticated
HTTP routes and generated-world result controls for explicit start and
matching stop. Current Fake/API/Web checks and independent Sol High delta
reviews pass. Synthetic-HTTP browser checks and the bounded service-layer
isolated real Java first lifecycle passed independent evidence review.
Main remains opt-in disabled; recovery settlement, separate Node restart and
real HTTP/UI integration remain open. Current evidence
is indexed at the top of PROGRESS.md.

Latest 2026-10-26 activation slice: inactive import, protected switch and return
have passed isolated real Vanilla26.3 loading, independent OS startup observation
and three-width synthetic browser checks. This is not whole V2 acceptance.
See [current evidence](./WORLDS_V2_REAL_ACTIVATION_2026-10-26.md). The baseline and
phase table below describe the original checkpoint; restic/queue/retention/hot
backup/final UI remain unfinished. Local main entry delta signoff is tracked in
PROGRESS; no Git upload.

## Baseline and boundaries

Branch: `codex/phase-4-players-properties`.
HEAD: `9f7cf498940b8e8c357b44ba1da8d201751463e4`.
Existing uncommitted UI2/L1/M3 work is retained. `sources/` remains read-only.
P7 stays STOPPED. No Git publication is authorized.

The user authorizes autonomous phased implementation and isolated real tests.
Destructive fault injection must use isolated worlds, never original user data.
Old backups, guard snapshots, journals, manifests and uncertain evidence remain.

## Phase status

| Phase | Actual state |
| --- | --- |
| 0 baseline and architecture | Read-only inspection and independent Sol High gap review completed |
| 1 worlds | In progress: bounded metadata, version policy, persistent lineage sidecar and read-only API implemented; mutation authority still incomplete |
| 2 restic | Not implemented; no executable downloaded, credentials stored or repository initialized |
| 3 schedules/queue/retention | Not implemented |
| 4 online/VSS | Not implemented; must remain disabled |
| 5 four-tab UI/localization | Not implemented |
| 6 final acceptance | Not run |

## Reuse and required identity boundary

Reuse `WorldImportUploadService`, bounded ZIP/NBT readers, restore tree inventory,
protected staging, `OperationService`, transaction journals, pinned guards and
existing local authentication/instance locks. Do not add LC2 native stores.

The old active-world schema identifies a server/name slot by hashing the server
ID and `level-name`. It cannot identify a replacement world lineage. New logical
world IDs require a versioned registered library and explicit legacy resolver.
Do not overwrite schema 1 records or infer V2 identities from directory names.
Reconcile library, actual directory identity, configured name and active pointer
before publishing write/start readiness. Ambiguity retains recovery gating.

Inactive import must be separate from the old importer, which always changes
the active world. First install a new uniquely identified world without changing
configuration; activation and replacement then use explicit journaled transitions.
Same-name replacement must retain the former lineage and guarded original tree.

Legacy manifests are validated through the current strict public BackupInfo
schema. Do not add required V2 fields there: freeze legacy validation and project
legacy DTOs into a separate discriminated provider response. Keep private guards
on Legacy. Restic must restore to verified staging, never over an active tree.

The existing daily scheduler has durable claims but no waiting queue. A V2 queue
must persist ordering, approval, immutable world identity/revision and repository
identity; preserve unknown dispatched jobs at restart instead of replaying them.
Legacy retention includes manual backups and is server-scoped. V2 auto-only
per-world retention must use a separate opt-in positive eligibility policy.

## Implemented read-only preparation

`readWorldMetadata` reuses the existing bounded gzip/NBT parser to observe
`Data.Version.Name` and `Data.DataVersion`. Missing/invalid values stay null.
`assessWorldCompatibility` is a pure policy, not a full compatibility preflight:
only matching Vanilla 26.3 version observations with matching valid numeric
DataVersions are classified compatible; demonstrably newer data blocks; unknown
profiles, version conversion and incomplete evidence stay unknown.
Every result has `loadVerified:false`. Synthetic numeric fixture values are not
the authoritative DataVersion mapping for real Minecraft 26.3.

These helpers are not exposed as browser claims or write authorization. Layout,
dependencies, capacity, registered identity and upload revisions still need
integration into the real preflight and revalidation under the operation lock.

## Validation on this checkpoint

- `npm.cmd run test --workspace @mcsm/api -- test/world-compatibility.test.ts test/world-inventory.test.ts`: 30 PASS, 2 files, exit 0.
- `npm.cmd run typecheck --workspace @mcsm/api`: PASS, exit 0.
- `npm.cmd run lint`: PASS, exit 0.
- `git diff --check`: PASS, exit 0; existing LF/CRLF notices are retained.
- Independent GPT-6.1 Sol High scoped source review: P1=0/P2=0/P3=0.
- Independent architecture review identified integration risks above; these are
  unresolved implementation work, not final safety acceptance.
- No new browser/full regression/restic/Minecraft acceptance run.

No Minecraft instance was started or stopped; no world, backup, repository,
credential, system/network setting or historical recovery evidence was changed.

## Next implementation boundary

Define and test versioned world-library identity reconciliation, preserving old
records and recovery causes. Then implement inactive staged import and explicit
activation/replacement, followed by folder upload and end-to-end UI/API tests.
Complete applicable Import/Restore safety Gates before declaring those writes
accepted; the historical M3-only review exception does not waive V2 requirements.

Continue subsequent phases autonomously within the standing authorization.

## Continuation: persistent lineage observation and API

Implemented `WorldLibraryStore` with independent random `worldv2-<UUID>` IDs.
Storage is separate from schema-1 active state, legacy manifests and journals.
The permanent sibling adoption anchor binds catalog ID/server/root; catalog-only
loss, surviving-anchor directory loss, unknown stages, corrupt records and an
existing empty catalog directory require inspection rather than new adoption.
File and directory identity checks reuse existing verified readers/helpers;
publication retains file synchronization and the existing Windows directory
synchronization limits. Failed publication evidence is not automatically removed.

The backend-only installation record method retires rather than removes a prior
same-name lineage and requires a distinct preallocated ID from its caller.
Commit/recovery never mint a replacement ID. Repeated operations must match ID, name,
physical directory, predecessor and original admission revision. This method is
not connected to a production write endpoint: the future transaction controller
must pre-persist the chosen identity and prove the journal/lease/guard boundaries.

`GET /api/v1/servers/:serverId/world-library` is integrated behind the existing
application Session/Origin boundary. It returns redacted observed entries,
catalog revision, selected observed identity and inspection state. Every response
has `mutationsAvailable:false`. Startup observes only Vanilla active states that
passed existing reconciliation and have no recovery gate. Failed sidecar
observation preserves legacy behavior and leaves V2 writes disabled.

`legacySlotId` is a historical slot reference, never a proved lineage-to-backup
mapping; `legacyBackupAssociation` stays `unverified`. No legacy record is edited,
deleted or rebound. Dynamic registrations/pending generation/archived states
without an adopted catalog currently require later identity integration; the
GET does not create a missing catalog or fabricate an active lineage.

The backend `resolve` helper binds a revision to logical ID, directory identity
and safely observed `level.dat` checksum. It is not a complete world-tree hash,
not a snapshot or queue execution permit, and has no production mutation caller.

### Validation and reviews

- Affected legacy world import/create/archive/restore plus active-state/library:
  6 files, 207 PASS, exit 0, 54.67 seconds. Later delta touched only library
  observation/resolution/projection/tests and received focused checks below.
- Latest identity/API/startup/authentication/Origin/lineage tests: 14 PASS,
  exit 0. These include same-name replacement, exact retry, stale/retired binding,
  reconstructed-store missing catalog, interrupted adoption and preservation of old data.
  The final focused rerun also proves the preallocated ID is returned unchanged,
  changing ID on replay is rejected, and a new operation at the current catalog
  revision cannot reuse an existing ID. One coverage review caught an assertion
  that originally failed earlier at stale-revision validation; it was corrected
  to exercise the duplicate-ID boundary. No product guard was weakened.
- Contracts: 30 PASS, 8 files, exit 0 (includes 2 new identity contract tests).
- API typecheck: PASS, exit 0.
- Lint first found four unused redaction variables; replaced with explicit DTO
  allowlist. Root lint then PASS; final changed-file ESLint PASS, exit 0.
- Final `git diff --check`: PASS, exit 0.
- Independent GPT-6.1 Sol High scoped source/delta review: P1=0/P2=0/P3=0.
- Independent GPT-6 Astra High current-slice safety review: PASS, P1=0/P2=0/P3=0,
  **only sidecar observation and GET**. This follows the still-applicable non-M3
  repository routing; it does not waive future Import/Restore Gates.
- No new real-Minecraft, browser, restic, full-project or V2 final acceptance.

### Required conditions before mutation authority

1. Persist new random world ID in a recoverable intent *before* installation;
   cross-check operation/journal, full verified source, predecessor and catalog
   at every installation/catalog/configuration/active-pointer crash boundary.
2. Detect rollback/omission of a newer catalog using independent durable journal
   and backup evidence. The immutable anchor currently binds the catalog/root,
   not its newest state. An older valid state can be accepted in a fresh process.
3. Complete removal of the entire library namespace and every anchor cannot be
   proved by this same-domain sidecar. Cross-check adoption evidence outside it
   or require explicit inspection before making it a write authority. Complete
   deletion of all independent evidence remains an unavoidable local audit limit.
4. A directory inode/birthtime does not prove unchanged content lineage; same-
   directory content replacement and region/dimension changes require complete
   operation-specific evidence. `ready` means sidecar observation only, never
   start/write readiness. Recheck actual configuration and all recovery causes.
5. Implement inactive import, explicit activation/replacement and restart/fault
   tests before enabling write capabilities. No V2 mutation acceptance is claimed.

No Minecraft/world/backup/restic repository/system configuration was changed.
No commit, push, PR or merge. Existing UI/L1/M3 changes remain preserved.

## Next unit: journal-bound inactive import preparation — safety Gate PENDING

The existing journal now supports a separate strict schema 9 / kind
`world-library-import`. It records a preallocated new lineage, current lineage
and revision, catalog revision, root identity, properties checksum, verified
upload identity/revision/checksum/version, and exact source/target/staging paths.
It permits stopped-only admission with `allowStop:false`; legacy schemas 1–8
retain their validation and transaction semantics. The upload service includes
these intents in claimed-source ownership and deletion protection.

`OperationService` requires physical verification of new terminal intents even
when a stored operation says succeeded. Unknown or corrupt evidence retains a
recovery gate; no executor, world data installation or public V2 write route
exists yet. This is preparation, not a completed inactive import implementation.

Independent review found a P2 string-coercion defect in the new schema and a P3
missing saved-success regression case. Payload and ownership fields now require
actual strings; array coercion is rejected. A subsequent review found the same
class at the persisted record state boundary; schema 9 now also requires string
state and checkpoint names. Directly corrupted persisted records are tested with
a saved-success operation, and remain intact while the scanner flags corruption.
All review findings and fixes are retained here; final safety re-signoff is not
claimed from developer tests.

- Final affected journal/upload/operation-store tests: **95 PASS / 4 files**,
  exit 0, 5.17 seconds, 2026-10-25 17:47 local run.
- API typecheck: PASS, exit 0.
- Final changed-file ESLint and `git diff --check`: PASS, exit 0.
- Independent Sol High journal review closed its original strict-payload finding
  before the final persisted-state delta; that last delta still needs review.
- Advanced safety reviewer identified the persisted-state defect. After the fix
  and 95-PASS run, its re-review failed with **usage limit reached**. Therefore
  this newer journal unit's final independent safety Gate is **PENDING**. The
  earlier observation/GET slice PASS remains scoped and unchanged.

Tests reconstruct stores/OperationService objects in one test process. They are
not independent OS-process crash/restart acceptance. That proof and actual
installation/recovery tests remain required before enabling mutation authority.

### Historical resume point after reviewer availability returns (superseded below)

1. Independently re-review the schema-9 persisted state/checkpoint string checks,
   direct corruption tests and new terminal-outcome recovery predicate. Do not
   repeat unchanged 207-test legacy checks without a new affected-code reason.
2. Finish the inactive import executor under the existing instance/upload leases:
   revalidate the plan and complete source, persist the already-chosen ID in the
   intent, stage/verify/install a *new* directory, commit the matching library
   entry, and verify properties/current active world remain unchanged.
3. Cross-check committed journals against the catalog on startup so a rolled-back
   or omitted catalog cannot become write authority. Interrupted installation
   remains recovery-required, never automatically replayed.
4. Add interrupted-boundary/retry tests and applicable independent safety review
   before exposing a mutation endpoint, then continue activation/replacement and
   folder import. Restic/scheduling/queue/retention/UI remain later task phases.

This is a reviewer execution-capacity block, not a new user-permission request.
No Minecraft, real-world, backup, repository or system operation was performed.

## Continuation: inactive installation, HTTP/UI and folder import

The independent review was retried successfully; the historical usage-limit
failure above is not a current blocker. Both independent Sol High and advanced
safety review signed the backend/journal integration within scope. Advanced
review found one UI P2: a later401/403 could discard the original unknown request.
All submission failures now retain pending body/key. Regression covers network
loss, manual401/403, remount, no automatic resend and exact-key confirmation.
Independent re-review closed it: P1=0/P2=0/P3=0. Folder transport's independent
Sol High review likewise reports0/0/0. No writer self-signoff used.

Implemented:

- `WorldLibraryImportService`: stopped Vanilla26.3 inactive installation only;
  source/target/current-world identity and complete-tree checks, durable chosen
  ID before installation, guarded workspace identities, startup journal/catalog
  audit and physical terminal confirmation. No automatic recovery execution.
- Strict `/world-library/import-plan` and `/world-library/import` routes with
  existing local Session/Origin/CSRF/final admission checks and stable key/body
  replay. `mutationsAvailable` describes this limited inactive-import capability,
  not activation, replacement, restic or hot backup.
- `WorldIndependentImport` and `WorldLibraryList`: localized explicit planning,
  confirmation, persisted pending request, operation status and final list
  verification. Instance changes reset UI state; language changes preserve input.
- `worldFolderArchive`: browser directory selection becomes an uncompressed
  bounded ZIP, then the existing backend validates it again.128MiB includes all
  headers;10000 files/max32 relative segments, required root level.dat, strict
  paths/case/NFC/file-directory conflict checks, CRC/UTF-8 directory records,
  cancellation and no automatic upload. ZIP upload stays available.

Actual verification (2026-10-25):

- API executor/HTTP/folder pipeline:18 PASS/1file, exit0,9.98s.
- Web importer/upload/library/ZIP:42 PASS/4files, exit0,4.00s before final
  nonblocking cancellation/Unicode coverage addition; see final run below.
- Contracts world-library suite:2 PASS/1file, exit0. This is a focused count,
  not a full repository contract count.
- API/Web typecheck and scoped ESLint:PASS, exit0; diff PASS. JSDOM emitted two
  existing navigation-not-implemented notices; no browser result inferred.
- Real owned Node OS-process crash/probe: seven boundaries PASS in
  `test-results/worlds-v2-import-crash-4804aa4a-dd3d-4f71-bb82-d09272c22e7b/result.json`.
  That historical report lacks source hashes; it is not current-candidate
  seven-boundary certification. Final affected two-boundary run PASS:
  `test-results/worlds-v2-import-crash-28c2a457-aacc-4d93-bc24-ce96e2952d2e/result.json`.
  It records10 source hashes independently matched to current backend core,
  child PID/close evidence, no duplicate install and original-world preservation.
  Every child closed, no force deletion; isolated fixtures remain as evidence.

Limits: no new browser-width or real Minecraft loading acceptance; no Java
started. Inactive imports do not enable activation/replacement. Existing consumed
uploads retain their evidence and use staging quota; cleanup lifecycle is not
silently weakened. Interrupted imports require inspection. Restic, secure
credentials, schedules, queue, retention, VSS and four-tab delivery remain work.
No actual user world, legacy backup, repository, system setting or Git publication
was changed. P7 STOPPED. Overall V2 remains IN PROGRESS.

### Final focused validation for this continuation

- Final Web43 PASS/4files, exit0,4.33s, includes mid-read cancellation and
  non-ASCII ZIP entry names:
  `test-results/worlds-v2-folder-web-2026-10-25-v1.json`.
- Other affected API124 PASS/6files, exit0,5.67s:
  `test-results/worlds-v2-identity-integration-2026-10-25-v1.json`.
  Combined with executor/HTTP/folder18 PASS, this is142 distinct focused API
  tests across7files, not the full repository suite.
- Focused Contracts2 PASS. API/Web production build and typecheck PASS, exit0.
  Web build retains the existing >500kB bundle warning; no threshold was changed.
- Scoped ESLint PASS; git diff --check PASS, with existing CRLF conversion notices.
- No new browser/Minecraft acceptance, no full stage-delivery regression and no
  full V2 signoff. The earlier JSDOM navigation notices remain explicitly noted.

Next work must preserve completed inactive import evidence while implementing
activation/replacement. In particular, legitimate changes after activation must
not be mistaken for incomplete immutable-import proof; an explicit journal-bound
supersession rule is required before exposing that write path. Never loosen the
current exact-content reconciliation merely to allow an active world to change.
