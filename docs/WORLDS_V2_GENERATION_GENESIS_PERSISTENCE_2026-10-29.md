# Immutable generation genesis persistence — 2026-10-29

Status: affected integration161PASS/0FAIL; final independent evidence limited ACCEPT; readiness closed.

## Implemented

`world-generation-genesis.ts` preserves the exact canonical schema-6 catalog
snapshot in the existing active-world evidence directory, using a derived
server/execution identifier. `sealPublishedGenesis` owns the existing dedicated
instance mutation lease and service close-drain lifetime. No route is mounted.
No catalog version, operation receipt, active snapshot or recovery cause changes.

The entry requires an already active slot and an existing verified completion.
Completion is checked in explicit existing-only mode: deletion cannot silently
recreate evidence. The original catalog is bounded to 1 MiB and checked against
its original revision and strict genesis metadata. New snapshots use wx, fsync,
opened-file identity and exact readback; matching existing evidence is read-only.
Conflicting/partial evidence is retained and rejected, never repaired/deleted.

After writing, a new complete current-state proof is required, followed by
completion, CAS intent and installed-slot checksum/identity, directory identity,
fixed-stage absence and snapshot checksum/identity checks. No world readiness
or current-lifecycle authority is inferred. The future mature catalog must bind
the returned snapshot checksum AND identity; this unit alone is not an anchor
accepted after migration and does not authorize subsequent gameplay revisions.

## Independent review and history

Independent GPT-6.1 Sol High initially found two P2s: completion recreation race
and incomplete post-write CAS link checks. Both were fixed and independently
confirmed closed; source-level limited ACCEPT, P1/P2/P3=0/0/0. Final evidence review completed: six hashes and unchanged HEAD verified; limited ACCEPT.

Retained reports:
- worlds-v2-genesis-persistence-2026-10-29.json: 4 PASS, 0 FAIL.
- worlds-v2-genesis-persistence-final-2026-10-29.json: 5 PASS, 1 FAIL;
  outer OperationService propagated exact authorization 'revoked', rather than
  helper RECOVERY_REQUIRED. Test now requires the exact original rejection and
  still requires evidence retention and closed recovery.
- worlds-v2-genesis-reviewed-2026-10-29.json: 8 PASS, 1 FAIL; late-intent fault
  hit unchanged default 5s deadline at 5020ms (STACK_TRACE_ERROR).
- worlds-v2-genesis-linked-2026-10-29.json: fresh 9 PASS, 0 FAIL;104 NOT RUN.
  One redundant pre-write full tree scan removed with independent approval;
  completion's full post-proof, source binding and NEW post-write full proof
  remain. No timeout, safety assertion or concurrency setting changed.

Final integration: worlds-v2-genesis-integration-2026-10-29.json, 161 PASS/0 FAIL/0 pending (service115 + execution46), exit0. Includes additional snapshot same-byte identity replacement and active-without-completion rejection. Candidate: worlds-v2-genesis-candidate-2026-10-29.json, six SHA-256 entries and unchanged HEAD.
Scoped ESLint and API typecheck passed before final integration; final build and
diff check follow. No Java, browser, real world, system or Git upload operation.
No new OS-process crash acceptance. V2 IN PROGRESS; P7 STOPPED.

Next: mature catalog reference and genesis-aware transition interpretation,
normal owned-stop revision policy, final guarded readiness projection, HTTP/UI
and isolated real acceptance. No earlier Gate can substitute for those steps.

Final independent GPT-6.1 Sol High evidence readback:6/6 SHA-256 match, HEAD unchanged, P1/P2/P3=0/0/0, limited ACCEPT. This does not certify mature catalog/readiness/recovery release/ordinary lifecycle/API/real Minecraft.
