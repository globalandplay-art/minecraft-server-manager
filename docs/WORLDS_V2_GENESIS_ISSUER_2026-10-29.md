# Durable genesis reference issuer — 2026-10-29

Status: bounded ACCEPT for issuance/historical verification; independent6/6hashes, unchanged HEAD, P1/P2/P3=0/0/0.

## Implemented scope

`sealPublishedGenesisReference` owns the existing instance mutation lease and
service owner/close-drain lifetime. It requires a fresh full current published
proof, an active slot equal to the original completion-installed slot, original
consumed receipt bindings and EXISTING snapshot/completion evidence. This entry
never invokes CAS or creates missing snapshot/completion data.

It derives a fixed .generation-reference.json file and writes deterministic
schema-version2 metadata with wx, file sync, directory sync, opened-handle bigint
object identity and exact path readback. The payload binds the six immutable
snapshot/completion/intent/birth/execution/catalog-anchor bigint objects,
root/evidence/library identities, registration, original receipt/proof digest and
v1 snapshot/completion checksums/legacy IDs. An existing equal anchor is read-only;
partial or conflicting canonical data is retained and rejected. Failure/closing/
revocation after writing preserves evidence, not fake rollback or success.

Fresh full verification and all strong historical links are repeated after the
write. Final directory identities and fixed-stage absence are checked after the
last anchor await, followed by synchronous guard and return. The issued file's
checksum and bigint object identity are returned OUTSIDE its own payload.

`inspectIssuedGenerationReference` requires that external exact issuer proof,
reads the derived fixed durable anchor, verifies all six stored strong objects,
then rechecks anchor/directories/stage. Detached schema2 data cannot establish
issuer provenance. A future mature catalog must authenticate and retain that
external proof, not accept arbitrary caller-supplied v2 metadata.

## Limits

Issuance establishes object provenance FROM ISSUANCE ONWARD, not retroactively
for older numeric identities. It does not repair the prior23/1 UNKNOWN-cause
negative or erase its evidence. Existing global identity formats are unchanged.
The v1 inspector remains historical-links-only; new observed object metadata is
not permission to operate an instance.

No mature catalog, normal gameplay revision, start/write admission, operation
success/receipt settlement, recovery clear, API or real Minecraft is certified.
All generation recovery causes remain. No world or server mutation occurs here.

## Verification

- Initial issuer6 PASS/0 FAIL,130 NOT RUN; pre-final-boundary checkpoint.
- Final issuer18 PASS/0 FAIL,130 NOT RUN. Includes same-byte replacement of each
  of six links; external issuer proof rejects replaced anchor; final stage fault
  rejects in write/read entries; close/revocation retain evidence; missing original
  evidence creates no files; post-write snapshot drift rejects.
- Strengthened confirmation2 PASS/0 FAIL,147 NOT RUN. Reconstructed service
  preserves original checksum AND bigint identity after lost response; a valid
  but conflicting canonical anchor remains untouched. One case overlaps the18;
  these totals are not added. No timeout/concurrency/assertions weakened.
- API typecheck/build, scoped ESLint, git diff --check: exit0.
- Candidate: test-results/worlds-v2-genesis-issuer-candidate-2026-10-29.json,
  six hashes and unchanged HEAD bd0f9324f2406feb9e1eeebe5303e4445bf4d660.
- Independent Sol High design ACCEPT; source0/0/0 after closing final-stage P2;
  final six-hash/evidence readback matched unchanged HEAD; bounded ACCEPT,0/0/0.

No full unrelated regression, browser, real Java or OS-process crash run; only
isolated Fake fixtures. Intentional historical CLEANUP_BLOCKED fixtures remain
outside this unit. No Git upload, Windows/system/network/ACL changes. P7 STOPPED.
V2 IN PROGRESS. Next: integrate authenticated issuer proof with mature catalog,
normal owned-stop revisions and all admission states as one reviewed candidate.
