# Initial maturity metadata publication — 2026-10-30

Status: bounded ACCEPT, independent6/6hashes, unchanged HEAD, P1/P2/P3=0/0/0.
This is NOT readiness, startup recovery, normal-save or API acceptance.

## Implemented

Backend publishInitialMaturity owns the existing dedicated generation mutation
lease and close-drain lifetime. Immutable intent and fixed stage live in the
existing active-world evidence directory, outside the catalog's strict state.json
closure. Source6 receives fresh full physical proof and exact detached candidate7
preparation; issuer/source/target/world/catalog/root and all four directories are
bound. Stage and intent use wx/fsync/opened bigint object IDs. Same-device bigint
preflight precedes rename. Both source and target directories are synced.

Pre-CAS all awaited work finishes with full source.recheck (including persistent
raw receipt/journal proof). The synchronous bounded final fence holds at most3
read handles, validates contents/checksums, exact bigint objects, size/mtimeNs/
ctimeNs versions, same-device, four directories, state.json-only catalog closure
and original generation stage absence. Authorization directly precedes rename.
Post-CAS receives full7 physical proof, source birth proof and actual installed
stage identity comparisons. proof.recheck is last await, then bounded sync file/
directory/stage closure and authorization directly precede return. Buffers wiped;
all handles close on every path. No shell/nativehelper/globalfs mocks used.

Recovery combinations are explicit: matching source6+intent+stage may continue
ONLY after fresh full proof; matching target7+original stage identity+intent is
read-confirmed without rename and syncs both directories again. Orphan, partial,
conflicting or ambiguous evidence is preserved. No fallback copy, rollback or
unknown deletion. Standalone manually staged7 without intent is rejected.

Result catalogPublicationVerified:true certifies ONLY this metadata CAS. Raw
operation receipts, snapshots and recovery causes are unchanged. Generic reads
still reject7. No process start or real-world write is performed.

## Evidence

- Initial worlds-v2-maturity-publication-2026-10-30.json:4PASS/4FAIL,182NOT RUN;
  native node:fs/promises ESM rename could not be spied. Failure preserved. A
  narrow project rename seam uses the same native rename without extra policy.
- Fenced report15PASS/0FAIL and final20PASS/0FAIL retained as overlapping subsets.
- Final worlds-v2-maturity-publication-reviewed-2026-10-30.json22PASS/0FAIL,
  182NOT RUN. Includes actual publication, before/after rename continuation,
  either-directory sync failures and no-second-rename confirmation; exact bigint
  device predicate and injected mismatch; EXDEV refusal without copy; in-place
  source/stage corruption and same-byte source/stage/intent replacement at final
  fence; persistent receipt drift; revocation; all3 late pending-evidence kinds;
  orphan/partial/manual7 rejection; fresh Fastify reconstruction remains closed.
- No timeout, assertion or concurrency weakened. No broad unrelated regression.
- API typecheck/build/scoped ESLint/diff:exit0. Final candidate6hashes verified by
  independent Sol High, HEAD unchanged. Report/freeze under test-results with
  worlds-v2-maturity-publication-candidate-2026-10-30.json.
- No real cross-volume move, independent OS-process crash, browser or real Java
  test is claimed. Directory-sync behavior retains existing Windows durability
  limits. No locks are bypassed; no OS-level isolation claim against an admin.

Two source P2s (closing content window, pending-evidence window) were fixed and
independently confirmed0/0/0 before final evidence acceptance. Old11/1,24/7,23/1
physical/identity reports remain historical with their documented limits.

Next: READ-ONLY startup classification for fully bound published7 metadata,
without deleting external/unknown causes; then normal owned-stop revision policy
and integrated final readiness. Fresh Fastify test proves CLOSED only, not that
its production lease can already confirm/recover after reconstruction. Do not
claim restart recovery without testing that composition. P7 STOPPED; no Git,
Windows/system/network/ACL or real Minecraft changes. V2 remains IN PROGRESS.
