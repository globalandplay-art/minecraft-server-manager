# Worlds V2 — dedicated generation admission (2026-10-28)

Status: bounded independent GPT-6.1 Sol High ACCEPT; not a generation feature PASS.
HEAD bd0f9324f2406feb9e1eeebe5303e4445bf4d660, branch codex/phase-4-players-properties,
with existing uncommitted work retained. No Git publication.

## Implemented boundary

OperationService.requestGenerationExecution is backend-only, with a strict target
(parent operation/transaction, world UUID, prepared-record digest, registered
execution digest). Its private request implementation cannot be reached through
the ordinary recoveryOwner API. The instance mutation lease checks the exact
committed preparation and allowed recovery causes, actual persisted receipts,
legacy key collisions and absence of a prior related attempt, before and after
awaited preflight. An orphan receipt published before an acknowledgment failure
blocks another attempt even in the same process.

All four trusted callbacks must exist at runtime. Authorization must return
undefined synchronously. The lifetime factory must return a callable release
handle before receipt save. Authorization is checked again immediately before
the execution callback, after persistence. Canonical metadata is durably saved
before dispatch; its recovery gate is retained immediately. Same-key replay
returns the original masked operation permanently and never invokes preflight,
owner acquisition or execution again. A different key cannot retry that world.

This is trusted backend composition, not proof that a callback performed physical
verification or child cleanup. No route or caller has been mounted. The actual
startup ActiveWorldState external gate is deliberately NOT bypassed; future
integration needs a specifically verified/attributed cause, not a general waiver.

## Verification

- Affected integration: 17 files, 384 PASS / 0 FAIL / 0 pending.
  test-results/worlds-v2-generation-admission-integration-2026-10-28.json
- Final strengthened execution suite: 46 PASS / 0 FAIL / 0 pending.
  test-results/worlds-v2-generation-admission-reviewed-2026-10-28.json
  This overlaps integration; counts must not be added. Only positive-case
  assertions changed after integration, and the final suite covers that delta.
- API typecheck, scoped ESLint and git diff check: exit 0.
- Independent GPT-6.1 Sol High: P1/P2/P3=0/0/0, bounded admission ACCEPT,
  candidate manifest 5/5 SHA-256 matched.
  test-results/worlds-v2-generation-admission-candidate-2026-10-28.json
- Initial focused report retained: one fixture passed a string rather than an
  iterable of server IDs to requireRecovery. Fixed fixture, no weakened assertion.
- Review P2 (missing runtime callbacks/release handle) and P3 (callback exceptions
  could conceal incomplete seal in the positive test) fixed and independently closed.

Tests use isolated files, actual preparation/store/catalog and Fake callbacks;
no Java, real Minecraft world, system setting or external repository was changed.

## Remaining required work

Owned-child lifecycle coordinator/cleanup retention, controlled generation run,
stopped birth evidence and same-UUID catalog publication remain OPEN. Generic
OperationService owner release is not proof that a child exited. No recovery gate
is cleared, no new world is published, and no production start is authorized by
this unit. Worlds & Backups V2 remains IN PROGRESS, P7 STOPPED.
