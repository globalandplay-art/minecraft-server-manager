# LC2 grouped owned publication — component checkpoint

UNWIRED only. No Store/default migration or member command/API/UI writes. Remote PAUSED. No Minecraft, original user world, real credential, network/system or Git publication operation.

## Implementation

The separate trusted `runGroupedPublication` entry exposes the frozen original directory/file methods plus one `publishChunkGroup`. Existing two-method publication and five-method Store facades keep their exact shapes. All share the same one-shot envelope, never a nested or reentrant owner action. The new path does not change default single-file behavior.

Each group has1–8 contiguous indices within0–63. All source references/lengths are bounded and captured once; bytes are copied synchronously into one owned buffer of at most32768 bytes before async work. That copy is also wiped on a synchronous copy error. The registered whole Node task owns it until actual raw operations and descriptor finally-close settle; caller mutation or buffer wipe cannot alter it. Raw I/O uncertainty keeps the owner quarantined.

Both complete retained-owner wrapped command bounds are checked before any group I/O/Create, then checked again at actual native dispatch using the same synchronous executable getter as the native spawn. All parents and all target/stage absences are rechecked before the single finite Create. Every full strict snapshot and every physical empty stage is validated before the first descriptor write. Each exact write/sync/readback closes its descriptor; all stages are checked before one finite no-replace Move. Only complete ordered receipts followed by exact bytes, identity/time checks, final target stability and stage absence can return group hashes. Partial failures retain every stage/target; there is no deletion, copy fallback, overwrite or retry.

The finite native loop is already-issued work. It may settle physically after JS revocation; it cannot yield a success receipt, admit later Node work/group or publish manifest. The parent action retains exclusion until actual process/resource closure, and unknown close remains CLEANUP_BLOCKED. This semantics is explicit and restricted to new private protection-evidence groups; it is not live whitelist mutation authorization. Native active-loop death/exclusion still requires its own proof.

## Validation / issue ledger

- Focused v1:2files116PASS/3.68s. Additional Move-revocation and exact oversized-wrapper zero-I/O cases: v2,2files118PASS/4.02s. All8 Create failure positions and all8 Move positions preserve exact partial layouts and forbid next group/manifest. Deadline tests cover raw open/write/sync/close, long raw writes retain bytes and owner beyond shared cleanup, and unknown native close forbids descriptor writes.
- Typecheck v1 exit2: `TS7034`/`TS7005`, inferred arrays used across async closures in the new group implementation. RESOLVED Attempt1 with explicit entries and BigIntStats array types, no any or behavior relaxation. Typecheck v2 exit0. Original failure log retained.
- Source self-check tightened synchronous reference capture and exception-time buffer wiping before native testing. No assertion/timeout/concurrency/ACL permission change.
- Lint v2 exit0. Independent SolHigh source/delta/pre-run review P1/P2/P3=0. Candidate frozen30 files; pending affected/build/post-run evidence recorded below. No final native PASS inferred from source/Fake review.
- New explicit `lc2-owned-group-native.mjs` is separate from automatic test collection. It uses fresh UUID synthetic8x4096 data, actual owner/default retained ACL/native/Node I/O,50s total with15s owner-release reserve, separate shared5s fixture cleanup/evidence limits, strict identities/layouts/hashes and external actual foreground exit proof. Unknown activity retains known Node/fixture; failure evidence is never deleted or relabelled.

## Remaining scope

Even a normal8-chunk PASS will not prove64-chunk/maximum-history capacity, active-helper or pending Node-I/O death, CommandStore/default integration, complete whitelist member workflow or wholeLC2 Final Gate. Historical default/native/capacity failures and retained fixtures remain unchanged. A new product candidate needs new frozen full-project regression when final integration is complete; earlier full1806 is historical evidence only.

## Accepted normal component evidence
Exactly one native run lc2-owned-group-fd0c4479-9764-46c6-af7f-fe49d6f78807:21293ms component, separate actual foreground exit0/21758ms. All8x4096 bytes/hash receipts and no stages/manifest/layout verified; action released/null/bodysettled/resources0, concrete owner release/assertHeld rejected, activeSteps0, source14/14/frozen30/30, fixture root absence verified. Final independent SolHigh evidence P1/P2/P3=0; NORMAL EIGHT-CHUNK COMPONENT accepted only. New20files476affectedPASS47.66s,118focused4.02s; lint/typecheck/build/diff0, build5.19s with existing543.14KiB warning. Final receipt test-results/lc2-group-controller-final-v1.json. No native retry or new historical PASS claim. Active-group owner death and maximum capacity remain pending.
