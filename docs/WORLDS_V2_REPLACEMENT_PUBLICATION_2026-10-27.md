# Replacement publication continuation — IN PROGRESS

06:18 scheduled continuation resumed after natural quota reset. Branch
codex/phase-4-players-properties, HEAD bd0f932; existing dirty tree preserved.
Read-only elevated process query succeeded with no Vitest/Playwright matches.
No Minecraft or native helper was started. P7 STOPPED; no Git publication.

## Upload ownership dependency repaired

The upload manager did not include worldReplacement.uploadId in journal
ownership/discard reachability. Added it without introducing a second upload
system. Any matching journal state reserves the retained source even if the
consumed marker is missing. Cross-instance and ambiguous references fail closed.

First60PASS report: worlds-v2-replacement-upload-owner-2026-10-27.json.
Independent Sol High found P2: UUID references can be uppercase in parsed schema12
while the retained artifact ID is lowercase. Attempt1 introduced shared canonical
UUID comparisons for legacy import, independent import and replacement references,
used by both ownership and cleanup. Added actual committed/rolled-back uppercase
journal cases. Final worlds-v2-replacement-upload-owner-reviewed-2026-10-27.json:
62PASS/0FAIL/0pending. Independent Sol High accepted P1/P2/P3=0. Original60 report
retained as pre-fix evidence. API typecheck/scoped lint/diff exit0.

## Publication prerequisite: exact durable invalidation

Added backend-only invalidateReplacement requiring expected catalog byte revision
plus exact original committed mixed history. Checks schema3/root/catalog/sequence,
transaction/intent/prefix/full-record digests. Only changes this exact head back
to pending/null recordDigest, retaining entries and committed journals. Stale
revision/another head/changed record fails; exact pending repeat is a no-op.
No replacement completion, directory move or recovery confirmation exists here.

First worlds-v2-replacement-invalidation-2026-10-27.json:94PASS/0FAIL. Final
worlds-v2-replacement-invalidation-reviewed-2026-10-27.json:94PASS/0FAIL/0pending,
including subsequent different-transaction rejection assertion. Independent Sol
High parsed32 head+62 upload tests and accepted source/final evidence with
P1/P2/P3=0. This accepts metadata gate tightening only. Reports under test-results/.

## Mandatory design findings before completion implementation

### Versioned admission and retained-file proof

New schema13 explicitly binds original properties identity, active-state identity/
checksum and catalog-file identity in a strict approval object. Properties
revision must derive from original identity and intent properties checksum.
No approval means old schema12; approval cannot be silently downgraded to12 or
added to old records. Existing proof/reservation paths still reject13 and the
generic recovery gate remains closed. Independent Sol High accepted storage-only
source/final100PASS with0/0/0. First99PASS/1FAIL report retained: a new fixture
incorrectly expected silent physical confirmation; corrected test asserts the
existing RECOVERY_REQUIRED exception and unchanged gate. Extra persisted
downgrade/missing approval/changed-identity scanner tests pass with raw bytes
preserved:51PASS across replacement and generic journal suites.

Unmounted verifyReplacementApprovalFiles binds uniquely named snapshot checkpoint
identities/checksums, root/workspace identity, properties grammar and strict legacy
active slot bytes. Original properties identity is separate from copied file
identity. Catalog snapshot is byte-digest-bound only; no catalog semantics,
original active/catalog authenticity, live state or full approval is claimed.
No private bytes returned; recheck/cancellation errors sanitized. First10PASS;
duplicate-active-key case added with canonical existing writer format required.
Final combined file/journal proof report:
worlds-v2-replacement-approval-proof-2026-10-27.json62PASS/0FAIL/0pending.
Independent file-proof source/final review PENDING. API typecheck/scoped lint passed
before final canonical-format source delta; rerun required for that delta.

Follow-up independent P2: active.before initially allowed archiveTransactionId,
but existing ActiveWorldStateStore only permits it for state=none. Attempt1 removed
it from the active-slot allowlist and added a valid-UUID/digest-bound rejection
case. Final worlds-v2-replacement-approval-proof-reviewed-2026-10-27.json63PASS;
independent file proof accepted0/0/0. Typecheck/scoped lint rerun exit0.

Pure verifyReplacementCatalogSnapshot reuses the existing catalog shape/entry
invariants, binds byte revision/root/catalog and exact original head/prefix,
checks retirement/birth in both directions and fresh identity/operation/guard.
Normal reads retain anchor/root/observed revision validation. Independent P2
found a missing schema3 requirement for a mixed prefix; Attempt1 added it and a
correct-digest schema2 downgrade rejection.70PASS final after fix. Combined
copy/catalog proof and integration tests72PASS; independent source/evidence
accepted0/0/0, followed by successful final API typecheck/scoped lint/diff.

verifyReplacementAdmissionFiles now binds the retained snapshots to all three
actual originals by file identity AND checksum before reserving a pending head.
The immutable snapshot proof remains distinct. Each original replaced with equal
bytes/new file object is rejected; restoring its owned original object permits
recheck. After an existing pending-head publication the old admission fails,
while immutable snapshot content proof still passes. No lock reentry or store
mutation in this verifier. Final
worlds-v2-replacement-admission-files-final-2026-10-27.json72PASS/0FAIL/0pending;
API typecheck/scoped lint/diff exit0. Independent original-file admission review
PENDING. No actual replacement, world write, Java start or backup creation.

Original-file admission subsequently accepted by independent Sol High0/0/0.
Schema13 has a separate15-marker protocol: intent, workspace, three immutable
approval copies, then pending head/upload/guard/staged/rename/identity checkpoints.
Old schema12/eleven-marker interpretation remains inspection-only. New reservation
requires exactly the first five markers, a matching complete record digest and
before-reservation phase; filesystem proof runs outside the store lock.

Independent P2 design finding required original catalog file identity inside CAS;
review then identified another await window before commit's final read. Attempt1
carried the expected identity into commit's final re-read for schema13 only.
Tests inject same-byte/new-object replacement both after external proof and during
the old-directory check, retaining originals outside the strict catalog directory.
Both reject without publication; restoring the owned originals permits reservation.
The first CAS report exit1 is retained: the initial patch attached the new argument
to the similarly shaped activation return; corrected exact replacement call-site.
No assertion/timeout weakened. Corrected
worlds-v2-replacement-reservation13-cas-v2-2026-10-27.json130PASS/0FAIL/0pending,
API typecheck/scoped lint/diff exit0. Independent final CAS delta review PENDING.
Only a pending head is published; no new-world installation/completion/recovery.

Independent final CAS delta subsequently accepted0/0/0 after parsing130PASS.

## Installed-file and completion primitives — bounded acceptance

Added unmounted installed-file proof: committed13 protocol, exact new object/path
and source content, unchanged original properties/active slot, retained old-world
guard/snapshots and actual consumed marker identity/checksum. Source provider and
runtime are injected Fakes in tests; guard parsing and filesystem data are real
isolated fixtures, including synthetic NBT. Caller must own instance/upload leases.
This does not validate every historical prefix's physical protection or runtime
composition and cannot clear recovery.

Review P2 final-freshness interval: Attempt1 adds a final bounded source/claim/
control/content pass after final guard/snapshot/status checks, with3 late-mutation
cases. Residual final-provider object substitution: Attempt2 adds last identity-only
root/target checks after that pass, with equal-content/new-object test. Original
25/28-test reports retained. Final installed-identity29PASS and independent0/0/0
acceptance, with final API typecheck/scoped lint exit0.

completeReplacement is now an unmounted store primitive: mandatory digest/phase-
bound installed proof before/after publication outside the store lock; pending
head/revision/intent/prefix, exact original entries/copy, object/path checks and
one protected entries+head save. Old identity retires, already allocated new ID is
recorded. Post-proof tail/identity/history rechecked; failure invalidates only the
matching publication. A different head is preserved. Journal/worlds are not rolled
back; recovery remains closed. Actual durable schema13 fixtures now use create/
append15/commit. Fresh completion/head83PASS, independent0/0/0 acceptance.

Added journal-freshness wrapper checking the actual complete scoped transition set
before/after installed-file verification, including issues/recovery flags. Valid
checkpoint-detail drift and mutation during validation reject without rewriting
the evidence. Caller still verifies prefix physical history separately.

Final current candidate report:
worlds-v2-replacement-publication-final-2026-10-27.json259PASS/0FAIL/0pending,
eight suites (10 generic journal,46 head,62 upload,14 library,12 approval,
45 replacement journal,39 protection/publication,31 transition records).
Independent Sol High parsed it and accepted the bounded wrapper/checkpoint0/0/0.
API build and scoped lint exit0 after final source/test changes; final diff exit0.
Broader11-suite408PASS predates late installed freshness fixes, completion and
journal wrapper; it is retained, not presented as current frozen full-suite proof.
No whole-repository regression or V2 final signoff is claimed.

## Next actual work

Wire a controlled replacement executor: existing instance/upload leases and
admission, immutable approvals before pending head, claimed source, verified pinned
guard, staged new world, preserved old directory, new installation, exact journal
publication, full prefix-protection proof and metadata completion. Add dedicated
startup/explicit recovery and shutdown control without replay, then HTTP/UI,
fresh OS-process faults and isolated actual Minecraft replacement acceptance.
All new primitives remain unmounted. No generic recovery clearance or exposed
replacement button. Existing activation stays separate. Restic/new-world creation/
queue/scheduling/retention/UI remain incomplete; hot backup disabled. P7 STOPPED.

Independent review accepted the direction with mandatory P2 design requirements:

1. Any failed post-publication physical check must durably invalidate the exact
   head; do not rely solely on today's unsupported-schema12 recovery cause.
2. Physical callbacks must not reenter WorldLibraryStore's exclusive lock. Prefer
   external proof phases and inside-lock revision/head CAS; bind cloned record,
   original-record digest and phase to each proof.
3. Preserve catalog.before byte hash bound to intent.libraryRevision and the exact
   old prefix/entries; strict active.before; original properties file identity to
   recompute propertiesRevision independently of properties.before copy identity.
4. New-world target object/path/content/upload provenance and retained old-world
   protection all require verification. Existing partial old-world proof is not
   sufficient. Same-name replacement preserves legacy active slot/properties and
   publishes a fresh V2 catalog identity with explicit old identity retirement.

These are design constraints, not approved execution or a Final PASS. Existing
schema12/eleven-marker preparation evidence must not silently become execution
approval. Immutable approval verification, installed proof and exact pending-head
completion are now implemented only as the unmounted primitives described above.
Next is executor integration, whole-prefix physical verification,
shutdown/startup/explicit recovery, fault tests and actual isolated replacement
acceptance. Restic and remaining V2
features stay open; online backup disabled. No user world or backup modified.

## Final bounded checkpoint freeze

Five additional test-only journal-authority cases cover active scoped work,
unknown-scope corruption, identifiable other-server corruption, missing own record
and conflicting scoped records. Focused report
`test-results/worlds-v2-replacement-journal-authority-2026-10-27.json`:
44 PASS / 0 FAIL / 0 pending. Independent Sol High accepted this delta with
P1/P2/P3 = 0/0/0. The earlier 259-test report remains valid for unchanged product
source and excludes these five additions. These overlapping reports are not a
single 303-test run and are not whole-repository regression.

Final test-only delta API typecheck, scoped ESLint and diff check exited 0.
API build and product scoped lint exited 0 after the final product changes.
Candidate artifact
`test-results/worlds-v2-replacement-publication-candidate-2026-10-27.json`
records branch, full HEAD, 27 relevant source/test SHA-256 values and both report
hashes. Independent GPT-6.1 Sol High verified all 27 file hashes and both report
hashes against disk, confirmed the five additions remove no tests and accepted
this bounded checkpoint with P1/P2/P3 = 0/0/0. Executor, prefix physical
integration, startup/explicit recovery/shutdown, HTTP/UI, OS-crash acceptance,
real replacement acceptance and remaining V2 work remain OPEN.
No product execution path was opened; no Minecraft process, user world, backup
repository, Windows configuration or Git publication was changed this continuation.

Safe continuation boundary: final usage read reports primary92% used/8% remaining,
weekly61% used/39% remaining; ordinary usage still allowed, no reset redeemed.
Checkpoint saved near the limit, not a claim of quota exhaustion. Read-only CIM
process query initially denied in sandbox (0x80041003); approved read-only query
then succeeded and found no Vitest/Playwright processes. No processes terminated.
Final documentation diff check exited0. Resume from the executor/prefix physical
integration tasks above; do not restart Phase0 or repeat unchanged passing tests.

## 07:17 continuation inspection

No other live development agent was present; the independent reviewers were
completed. Quota remained available: primary94% used/6% remaining, weekly62%
used/38% remaining. No reset redeemed, no second writer or duplicate test started.

Read-only call-chain inspection confirms a concrete integration boundary:
`WorldActivationHistoryProtection.verify` uses `orderedActivationHistory` plus
`auditActivationHead`; `activationTransitionEvents` explicitly rejects replacement
records. `WorldActivationLiveHistory` also assumes the last event is activation.
Therefore these existing activation-only entrypoints must not be presented as a
mixed-history physical proof or invoked to approve schema13 replacement history.
The replacement journal wrapper proves the exact journal set and the current
installed replacement, not every predecessor's physical protection. Reuse the
retained activation proof callbacks only within their verified scope; a reviewed
mixed-history coordinator remains required before replacement exposure.

No code fix is asserted by this inspection. It narrows the next integration task;
do not weaken the activation rejection to bypass it. Near-limit checkpoint remains
safe: no destructive transaction or actual Minecraft startup initiated.

## 08:18 activation boundary regression

Added two schema12/schema13 regression cases in world-transition-history.test.ts.
Each checks kind-only, payload-only and both replacement discriminators: the old
activation-only projector must reject with RECOVERY_REQUIRED before normalization,
without modifying the supplied record. These deliberately incomplete records test
the discriminator boundary, not full schema13 validation or physical protection.
Focused report worlds-v2-activation-replacement-boundary-2026-10-27.json:
26 PASS / 0 FAIL / 0 pending; API typecheck, scoped ESLint and diff exit0.
Only this test file changed; no product change or replacement exposure. The prior
27-file candidate hashes remain applicable to their listed files; this additional
test is outside that list. Independent GPT-6.1 Sol High accepted the test-only
guard P1/P2/P3=0/0/0 and rechecked original27file/two-report hashes without drift.
Mixed physical coordinator/executor/recovery acceptance remains OPEN. Latest
quota primary97% used/3% remaining, weekly62% used/38% remaining; no reset used.
All test/static commands exited0; no real Minecraft or dangerous operation run.
