# Worlds V2 replacement history and old-world protection

Status: old-world protection, pending reservation and properties-copy deltas
independently accepted by GPT-6.1 Sol High, each P1/P2/P3=0. Final combined
checkpoint accepted after independent readback of15 source/test hashes and the
72-test report hash. Preparation-only acceptance, not execution or V2 Final PASS.
This is not replacement execution acceptance or V2 final acceptance.

## Implemented boundary

- Mixed activation/replacement history consumes original journal objects, keeps
  original head digests, and verifies sequence, retirement and catalog bindings
  in both directions. Orphan retired entries and orphan replacement births fail
  closed. Independent review found the missing inverse check; Attempt1 added it.
- Eleven strict replacement markers bind guard manifest bytes, guard directory,
  workspace, preserved old object and installed new object/path separately.
- An unmounted read-only protection verifier reuses BackupService.exportSource
  and the existing tree/identity readers. It verifies a pinned complete Vanilla
  26.3 world-set guard and the separately preserved old directory. Rechecks retain
  manifest identity/checksum and directory object checks; failures are sanitized.
- The existing guard manifest hashes paths WITH the world-name prefix. The
  current-world digest hashes relative paths WITHOUT that prefix. They are
  separately checked, not incorrectly required to equal one another.
- Returned file metadata is copied, so callers cannot mutate the recheck closure.
  This verifies only immutable old-world protection: not live new-world content,
  catalog/head approval snapshots, upload provenance, active state or recovery.
  It cannot clear recovery or invoke a filesystem mutation. The retained
  properties.before copy is checked before/after tree verification: exact
  intent-bound checksum, UTF-8 without BOM/NUL, single unambiguous level-name.
  This proves copy content, not the original file identity/propertiesRevision,
  live configuration or the rest of the approval state.

## Actual verification

- `worlds-v2-mixed-head-affected-2026-10-27.json`: historical244 PASS before the
  inverse-binding repair; not final evidence for later changes.
- `worlds-v2-mixed-head-inverse-final-2026-10-27.json`:39 PASS before the later
  guard-prefix semantic correction; retained as that candidate's evidence.
- `worlds-v2-mixed-head-guard-semantics-2026-10-27.json`:39 PASS after correction.
- `worlds-v2-replacement-protection-2026-10-27.json`:11 PASS/1 FAIL; new test
  fixture called requireRecovery with a string instead of its iterable contract.
  Corrected the fixture to `["test"]`; product guard/expectations unchanged.
- `worlds-v2-replacement-protection-final-2026-10-27.json`:51 PASS/0 FAIL/0 pending,
  three files; includes12 protection tests using real isolated filesystem data
  and actual legacy manifest validation, not real Minecraft world loading.
- Independent GPT-6.1 Sol High parsed51PASS and accepted the bounded immutable
  old-world protection checkpoint with P1/P2/P3=0. Static results writer-reported.
- Subsequent backend-only reserveReplacement publishes ONLY a pending schema3
  tail after original head/revision/catalog and old path/object checks. No entry
  retirement/data move/completion or recovery clearing. New12 reservation tests
  include restart gating, repeated reservation and generic completion rejection.
  `worlds-v2-replacement-reservation-2026-10-27.json`:63PASS/0FAIL/0pending.
  API typecheck and scoped lint exit0 for this delta. Review found P3 missing
  nonempty-history coverage. Attempt1 added4 tests: valid post-activation
  reservation, wrong current world, reused guard and reused operation, with
  exact unchanged catalog bytes on rejection. Independently accepted after
  parsing67PASS/0FAIL/0pending in
  `worlds-v2-replacement-reservation-reviewed-2026-10-27.json`.
- `worlds-v2-replacement-reservation-affected-2026-10-27.json`:272PASS/0FAIL across
  eight affected suites. Includes28 head tests and12 protection tests, so it
  predates the last4 history cases and5 properties cases; not current full-suite
  evidence. No historical or newly failed report was removed.
- Properties-copy delta:17PASS/0FAIL/0pending in
  `worlds-v2-replacement-properties-proof-2026-10-27.json`; independent Sol High
  accepted P1/P2/P3=0. Tests include missing/changed copy, wrong world, duplicate
  key and invalid UTF-8, with semantically invalid bytes deliberately digest-bound.
- Final combined candidate:
  `worlds-v2-replacement-protection-reviewed-final-2026-10-27.json`:72PASS/0FAIL/
  0pending across3files. API typecheck/build and scoped lint exit0 after source
  delta. No stage-delivery/full-repository or real replacement acceptance run.
- Final independent Sol High confirmed32 head/reservation +17 protection/
  properties +23 mixed-record tests =72PASS, all15 candidate hashes/report hash
  match, P1/P2/P3=0 for the combined preparation checkpoint. Static results are
  writer-run evidence; reviewer did not rerun tests or change files.
- API typecheck and scoped ESLint exit0. No timeout/assertion relaxation.

All reports above are under test-results/. No legacy failures overwritten.
No real Minecraft process, user world, existing backup or restic repository was
modified for this unit. No Git publication or system/network/ACL change.

## Remaining mandatory work

Persist/revalidate approval snapshots; verify replacement upload provenance,
new-world identity, mixed consumers and active/head state; implement protected
replacement execution and dedicated startup/explicit recovery with shutdown
coordination. Schema12 remains recovery gated, including committed claims;
generic recovery cannot confirm it. Replacement mutation routes remain absent.
New-world creation, restic, scheduling, queue, retention, recovery and four-tab
three-language UI delivery remain incomplete. P7 STOPPED; hot backup disabled.

## Resume checkpoint

Branch codex/phase-4-players-properties, HEAD bd0f932; dirty working tree retained.
Candidate source/test hashes and final report hash are recorded separately in
`test-results/worlds-v2-replacement-protection-candidate-2026-10-27.json`.
Last quota observation: five-hour99% used/1% remaining, weekly47% used/53%
remaining; ordinary usage still allowed, not reported exhausted. No reset credit
redeemed. Safety checkpoint prepared near the limit under the continuation rule.
All unit test/build commands have exited; no Minecraft/native helper was launched
for these units. No repository initialization, credentials, backup creation or
real-world replacement was performed. Prior authorized real activation evidence
remains scoped to its earlier candidate, not proof of schema12 replacement.

Next: bind the remaining immutable approval/catalog/active evidence, then add
dedicated pending-head publication of verified new identity plus old retirement
and exact committed mixed history. Before runtime exposure, implement full
new-world/upload/physical-head proof, explicit recovery and shutdown handling,
failure injection, fresh OS restart and isolated actual replacement acceptance.
Do not call generic recordInstalled while a replacement tail is pending; do not
use completeActivation or generic recovery to confirm schema12 transactions.
