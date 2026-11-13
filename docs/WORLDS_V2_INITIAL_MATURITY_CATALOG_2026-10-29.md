# Initial maturity catalog READ/PREPARE boundary — 2026-10-29

Status:229 affected PASS/0FAIL/0pending; independent4/4hashes,0/0/0 bounded ACCEPT. No publication.

## Implemented

A SEPARATE initial schema7 format binds the fixed issuer proof and keeps exactly
the two original schema6 snapshot entries, including order, timestamps, origin,
operation/admission metadata and legacy association fields. It contains no fake
activation head or rewritten generation evidence. Ordinary recordSchema, type,
private read and head paths remain strictly1..6, so old list/mutators fail closed
on7. There is NO schema7 publisher or automatic migration.

prepareInitialGenerationMaturity requires an explicit issuer proof from a trusted
caller and produces a detached candidate plus original source checksum/legacy
identity/bigint object witness. It writes no files. Service prepareInitialMaturity
adds the existing dedicated instance lease, owner lifetime and full current-state
proof before/after. Detached candidate mutation is not publication authority.

inspectInitialGenerationMaturity explicitly reads7 for metadata inspection. It
verifies the declared fixed issuer anchor, original immutable6 bytes and exact
entry equality. It does not authenticate schema7 publication itself: every result
has inspectionOnly:true, recoveryRequired:true, catalogPublicationVerified:false.

The exact original committed14 parent journal, base4/5/admission reconstructions,
checkpoint names/details/hashes, reservation and prepared-record digest are
verified by the extracted shared verifyPublishedSnapshot. Original parent and
execution raw receipt digest must match the issuer evidence. Extra scoped
journals, relevant/global issues and other pending receipts reject. No original
evidence is inferred or reconstructed from7. Issuer/snapshot/journal/receipt
observations are repeated before return.

Both new methods clone caller aliases before waiting and normalize new errors.
After the LAST catalog-file read, a shared closing check re-enumerates exact
state.json-only catalog closure, verifies original catalog/evidence/library/root
directory identities and original generation-stage absence, then sync authorizes.
Unknown/partial/pending evidence remains untouched.

## Review and verification

Independent Sol High accepted the bounded READ/PREPARE design. Source review
found final pending-evidence closure P2 and error/alias consistency P3; both
closed, source P1/P2/P3=0/0/0, bounded source ACCEPT. Final evidence pending.

- Initial report worlds-v2-initial-maturity-2026-10-29.json:11PASS/0FAIL,149NOT RUN.
- Final focused worlds-v2-initial-maturity-final-2026-10-29.json:17PASS/0FAIL,
  149NOT RUN. Includes full-service lease preparation, unchanged source files,
  staged7 explicit inspection/default rejection, exact entry/order/origin/issuer/
  world/journal/receipt/pending tampering, bigint catalog replacement, late stages
  in prepare/inspect, malformed JSON and binding alias capture.
- API typecheck/build, scoped ESLint, diff:exit0.
- Affected generation service/execution/catalog regression started once, owned
  exec session43073; report worlds-v2-initial-maturity-integration-2026-10-29.json.
  If interrupted, poll this session/check final report; do NOT start duplicate.

No real Java, browser or OS-process crash run. Only isolated Fake fixtures were
manually installed with7 to test inspection, not production publication. No user
world, raw receipts, original backups, Windows settings or Git upload modified.
Old23/1 UNKNOWN evidence and pre-issuance identity limitations remain historical.

Next: reviewed schema7 publication/startup/admission composition and normal
owned-stop observed revisions; integrate together before any ready or recovery
release. V2 IN PROGRESS; P7 STOPPED. No API or mature-world usability Gate passed.

Final readback2026-10-30: old exec43073 is no longer present; completed integration report229PASS/0FAIL/0pending (service166,execution46,catalog17). Independent Sol High4/4hashes, unchanged HEAD,diff0, bounded ACCEPT for READ/PREPARE only. No rerun. Freeze test-results/worlds-v2-initial-maturity-candidate-2026-10-30.json. Historical running/PENDING notes above reflect prior checkpoint only.
