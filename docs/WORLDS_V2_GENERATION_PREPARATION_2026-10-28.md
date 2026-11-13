# V2 world generation preparation — bounded acceptance

Status: independent GPT-6.1 Sol High bounded ACCEPT. Default production remains
on the existing legacy creator; no caller in main/app supplies the V2 option.
This is not usable V2 generation, Phase1 Final or Worlds & Backups V2 Final.

## Implemented transaction

An optional internal constructor dependency reuses WorldCreateService rather
than creating another creator or process supervisor. It is limited to stopped,
unowned Vanilla26.3 with approved5023 metadata, one legacy-observation catalog
entry, and no scoped transaction history. Running instances are not auto-stopped
by this path. Requests are cloned before asynchronous admission.

The executor allocates one UUID, persists schema14, immediately retains the
generation-unverified cause, reserves schema4 and verifies initial readback.
It then reuses the pinned full guard, workspace snapshots, protected properties
rename and legacy pending slot before committing the preparation. The immutable
UUID stays in journal/catalog; the name-derived slot is only compatibility data.
The V2 root identity uses backupDirectoryIdentity; old schema3 keeps its previous
prefixed algorithm. Old world and old backup associations remain unchanged.

Public GET, same-key replay and subscriptions remain interrupted/inspection-
required even if the underlying preparation receipt says succeeded. Generic
confirmation/recovery and ordinary lifecycle cannot remove the reserved cause.
Startup includes schema14 in protected active-state servers, preventing a newly
appeared level.dat from automatically promoting pending state. No new routes,
HTTP flags, UI, Java launch or recovery-release authority were enabled.

## Publication and shutdown protection

The V2 path captures exact root/old-world/workspace identities and control-file
identities/digests. It rechecks the correct before/after properties, staged
snapshots, original/pending active slot, target absence, reserved catalog and
pinned guard at the relevant switch/slot/commit boundary. Approved source
revision and26.3/5023 metadata derive from the same captured private bytes.

Admitted jobs have owned lifetimes, including queued jobs. Close stops admission,
checks cancellation after async verification and immediately before publication,
and drains owned work with a separate5s deadline. It does not kill processes or
delete evidence. Initial receipt-save failure releases its registered owner.
Before production integration, worldCreates.close must be included in the app's
pre-disposal shutdown path; currently no app caller enables the V2 path.

## Verification and review

`worlds-v2-generation-preparation-reviewed-2026-10-28.json`:
**226 PASS / 0 FAIL / 0 pending**, nine affected suites. This includes normal
preparation, eight injected boundaries, late configuration/staging changes,
precommit root/old-directory/target/config/slot changes, close during an async
catalog read, receipt write failure, same-key replay and same-process Fastify
reconstruction. Existing legacy creation/plan behavior is covered separately in
the same run. This is not a full-repository regression.

Earlier preparation/final/controls reports remain retained. The late-controls
focused run was20PASS/41not-selected; those are not additional successes. Review
identified and closed three P2 findings: late-control binding, async close
publication, and approved source revision/metadata snapshot mismatch. The latter
reuses the unchanged world-revision-v1 algorithm through a pure captured-byte
function. No assertions or timeouts were relaxed.

Latest OS evidence:
`worlds-v2-generation-crash-b991a1ed-01a1-4136-96f5-c6ff6db6f800/result.json`.
Three exact owned run/probe boundaries PASS: generation-reserved,
active-state-installed, after-commit. Six distinct Node children closed; Java0.
JsonOperationStore is reloaded in separate processes. UUID/replay, exact phase
checkpoints, configuration/slot values, target absence, full journal and server
bytes are verified; later boundaries require the pinned guard's identity,
ownership, scope/checkpoint checksum and verified payload. Recovery stays closed.
The earlier3c540cce OS report is retained; review strengthened phase assertions
and reran without product changes or deadline increases. Original30s observation
and38s cleanup limits are unchanged.

Scoped ESLint, API typecheck and diff check exit0. Final independent Sol High:
P1/P2/P3=0/0/0, bounded source/evidence ACCEPT. Candidate manifest
`worlds-v2-generation-preparation-candidate-2026-10-28.json`:12/12 fingerprints;
OS source manifest35/35 matched. Reviewer also read retained fixture evidence.

## Data and remaining work

### Follow-up: complete preparation proof

`readPreparedGeneration` is a separate exact committed14 boundary, leaving the
initial zero-checkpoint reservation reader unchanged. It validates the complete
seven-checkpoint sequence, strict detail keys, immutable intent/reservation,
reconstructed admission-record digest and current reserved catalog revision.
`world-generation-prepared.ts` composes this with registered stopped Vanilla,
root/old-world identity, absent target, exact controls and pending slot, closed
workspace, same-snapshot source revision/5023 metadata and full pinned guard/
old-tree verification. It returns cloned metadata and a read-only recheck, not
launch or recovery authority; it is not intended for UI polling.

Review closed P2 inconsistent control reread limits (valid70KiB properties now
work within existing1MiB limit), and P3 workspace files arriving during guard
verification. Original reports are retained. Corrected focused report
`worlds-v2-generation-prepared-proof-fixed-2026-10-28.json`:13PASS/63not-selected.
Final nine-suite affected report
`worlds-v2-generation-prepared-proof-integration-2026-10-28.json`:239PASS/0FAIL/
0pending. Focused13 overlap239. API typecheck/scoped lint/diff exit0.
Independent Sol High final P1/P2/P3=0/0/0, bounded proof ACCEPT; candidate
`worlds-v2-generation-prepared-proof-candidate-2026-10-28.json`,9/9 hashes match.
No Java, world writes or new routes were involved in the verifier itself.

The explicit-execution design can reuse catalog execution intent rather than a
new journal15, but remains unimplemented. Mandatory conditions: orphan execution
receipts must consume the attempt even before marker publication; startup must
protect the execution receipt as well as the parent14; uncertain owned-child
cleanup must retain owner/resources and return CLEANUP_BLOCKED. No existing
generic world-create recovery-owner bypass has been added. One-time execution,
its strict readback, actual launch and final birth/publication remain open.

All new operations used Fake adapters and isolated fixtures. No real server,
world, restic repository, Windows setting or network configuration was changed.
Unit fixtures were cleaned after owned work finished; OS evidence fixtures remain.
No commit/push/merge/PR. P7 remains STOPPED.

Remaining: dedicated explicit lifecycle continuation using the existing exact
child owner, durable/verified launch and normal exit evidence, stable stopped
candidate verification, catalog birth binding/publication and explicit recovery.
An ordinary successful start/stop or candidate-only metadata is not a birth
proof. Unknown interruptions must remain gated. Then connect the controlled
backend/UI and perform separately recorded actual Minecraft generation tests.
