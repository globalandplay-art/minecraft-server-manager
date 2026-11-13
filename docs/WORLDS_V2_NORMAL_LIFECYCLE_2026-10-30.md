# Ordinary owned lifecycle observation (2026-10-30)

Status: bounded observer ACCEPTED; revision publication NOT IMPLEMENTED.
Worlds & Backups V2 and generated-world ordinary readiness remain IN PROGRESS.

## Implemented boundary

`world-owned-lifecycle.ts` reuses the existing registered adapter/runtime
observation. It captures an actual fresh ready launch while running, with
registered execution digest, root mapping, server and start operation A. On
every use it requires the same adapter/runtime/launch/process and a distinct
stop operation B, completed stop API, actual exit and close, zero exit code,
no signal and no observed process error. Registration and synchronous admission
are rechecked. The private closure is detached from mutable caller input.

This differs from first-generation execution, which intentionally uses one
operation for both launch and stop. That original observer is unchanged.
The new observer is currently unused by production paths. It performs no
filesystem writes, process control, receipt updates or recovery release.
It is not a supervisor and cannot be reconstructed after Manager restart.

Its result says `owned-normal-lifecycle-only` and `inspectionOnly: true`.
It does not certify current world bytes, executable bytes on disk, a durable
start/stop outcome, safe revision publication or readiness. A cached registered
execution digest is not a replacement for actual executable revalidation.

## Evidence

- `test-results/worlds-v2-normal-owned-lifecycle-2026-10-30.json`:
  51 PASS / 0 FAIL = 21 new observer tests + 30 existing generation tests.
- After independently suggested observation-disposal and asynchronous-admission
  boundary cases, `worlds-v2-normal-owned-lifecycle-final-2026-10-30.json`:
  53 PASS / 0 FAIL / 0 NOT RUN = 23 new + 30 existing. Results overlap and are
  not added to the preceding report.
- API typecheck and scoped ESLint exit 0. Diff check exit 0.
- Independent GPT-6.1 Sol High: P1/P2/P3 = 0/0/0; 2/2 hashes and unchanged HEAD
  verified against `worlds-v2-normal-owned-lifecycle-candidate-2026-10-30.json`.
  Bounded ACCEPT for the unused observer. Typecheck/lint are writer-reported.

Separate startup compatibility evidence:
`worlds-v2-maturity-startup-compatibility-2026-10-30.json` has 145 PASS / 0 FAIL:
17 catalog, 14 historical metadata and 114 import tests. This is not a full
repository regression. Built native ESM app and maturity-publication modules
also loaded in both import orders with exit 0; no app or Minecraft was started.

## Required integrated next step

Do not clear recovery from this observation. Before any normal-save revision
can be published, the same integrated candidate must bind:

- A previously verified catalog, immutable world identity, registered root,
  active mapping and prior observed revision.
- Durable open-run intent before Java dispatch; exact start A and stop B
  operation receipts and their target/launch association. Existing generic
  lifecycle receipts alone do not contain a world/launch/revision binding.
- A previous-launch ID sampled before the controlled start and a lease/owner
  guard that expires outside the stop/revision scope.
- Actual executable revalidation and stable stopped world inventory, including
  directory identity, version/layout, active properties and current revision.
- One committed revision per launch, interrupted-publication handling and
  startup uncertainty gating. Lost open-run evidence or unexplained offline
  changes remain inspection-required; never infer every byte's writer from
  a normally exited process.
- Compatible mature catalog/history readers, operation projection and active
  state admission before any start/write capability is released.

The first schema-7 physical check remains exact birth-state verification.
Do not remove birth hashing, invent a legacy activation, rewrite old receipts
or treat directory identity alone as acceptance of changed data. HTTP/UI and
isolated real-Minecraft acceptance follow only the reviewed integrated path.

Independent sequencing review requires the open-run nonce/start binding to be
durable before dispatch. The actual runtime launch UUID is assigned around
spawn, so seal that observed UUID afterward before controller success/readiness;
a crash in the unsealed gap remains blocked. Persist stop B's link to that
sealed launch before stop dispatch. Require durable terminal receipts and the
live witness before revision acceptance. Keep the open-run marker blocking
until revision publication AND receipt consumption are durably verified, with
idempotent continuation for their interruption gap: an in-process lease does
not make them crash-atomic. Preserve referenced raw receipt bytes during startup
normalization. These sequencing requirements are reviewed design constraints,
not implemented persistence or permission to release recovery.

No real Minecraft, world, backup, repository, Windows setting or remote access
was changed by this unit. P7 STOPPED; no Git upload.
