# Worlds V2 — immutable generation birth evidence (2026-10-28)

Status: implementation and focused tests complete; independent review PENDING.
No production route, catalog publication, recovery release or new Java run.

The internal runner now persists a bounded immutable birth-observation receipt
only while its original in-process normal-exit witness is still available. Strict
schema binds execution/server/world/preparation/parent/registered identity, launch
UUID (not PID), candidate directory/object/level identities and checksum, supported
version/dataVersion and current properties checksum/identity/digest.

WorldLibraryStore uses its fixed validated sibling path, exclusive wx creation,
fsync, exact canonical readback and matching catalog5/anchor/parent14/receipt set.
The mandatory live callback rechecks actual candidate, registered identity,
normal owned exit, authorization and closing before/after publication. Complete
old-world/guard/control proof runs before and after the writer; it is not called
inside the library exclusive callback to avoid reentrant lock deadlock.

Any existing, partial, corrupted or write-after-failure evidence is retained;
no overwrite, deletion or automatic repair. readGenerationBirth is explicitly
inspectionOnly:true. It checks historical binding but does NOT make a record
consumable, prove current physical state, publish a catalog entry or clear gates.
A write followed by failed live/control verification remains inspection evidence;
future publication must require its own valid completion and physical proof.

The prior56d1b65c real candidate PASS cannot be retroactively given birth evidence:
its runtime was already closed. That result remains valid for its earlier source
candidate only; this new writer needs future fresh UUID live-process acceptance.
No repeated Minecraft lifecycle test was run in this unit.

## Verification in progress

- Focused birth-storage report:
  test-results/worlds-v2-generation-birth-storage-2026-10-28.json (PASS).
- Affected integration: running at checkpoint; final report will be
  test-results/worlds-v2-generation-birth-integration-2026-10-28.json.
- API typecheck and scoped ESLint: exit0.
- Independent GPT-6.1 Sol High source/evidence review requested, PENDING.
- Tests use isolated files, actual preparation/receipts and Fake runtime only.

Next: close review findings; finish fault coverage; freeze and sign off this unit;
then durable birth consumption/catalog publication and required real validation.
Worlds & Backups V2 IN PROGRESS. P7 STOPPED. No Git publication, system/network/ACL
changes, user-world edits or historical backup/native fixture deletion.

## 2026-10-29 review closure

The interrupted source fix is now covered by tests using the required sixth
synchronous guard. Directory IO-window revocation/closing and last-live callback
birth tamper/delete regressions pass; missing/async final guards fail closed.
The writer rechecks checksum/identity/canonical payload after async verification,
and synchronously reauthorizes immediately before wx and successful return.

Final report test-results/worlds-v2-generation-birth-final-2026-10-29.json:
13files327PASS/0FAIL/0pending. Focused reviewed report25PASS overlaps, not additive.
API typecheck, scoped ESLint and diff check exit0. Independent GPT-6.1 Sol High
P1/P2/P3=0/0/0, bounded immutable inspection-only birth evidence ACCEPT.
Candidate manifest test-results/worlds-v2-generation-birth-candidate-2026-10-29.json
6/6 SHA256 matched; HEAD unchanged bd0f9324f2406feb9e1eeebe5303e4445bf4d660.

No Java launched in this unit. Existing real56d1b65c evidence is not reused as
acceptance of new writer. No birth consumption, catalog entry publication, active
slot promotion, API/UI exposure or recovery release is authorized by this Gate.
Next composition must verify a successful bound completion plus present physical
state; inspectionOnly records and generic operation success alone are insufficient.
Historical20PASS/322PASS candidates and2P2 review remain retained, not overwritten.
