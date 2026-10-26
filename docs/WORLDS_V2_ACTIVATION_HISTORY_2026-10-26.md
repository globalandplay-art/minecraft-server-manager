# Activation history continuation — IN PROGRESS

## Implemented scope

`orderedActivationHistory` orders by explicit sequence, never timestamps. It
rejects missing first/middle records, forks, bad predecessor links, noncommitted
transitions, root/catalog drift, inconsistent permanent world/name/directory
bindings, and reused transaction/operation/guard IDs. Bindings include inactive
worlds and the original world when revisited.

The reconciler reuses its existing scan and still permits only a single first
transition after full physical checks. No activation writer/API/UI is mounted.
This is structural validation, not repeated activation delivery.

## Evidence

Initial focused history/journal tests: 29 PASS, exit 0. Initial importer/recovery
integration: 56 PASS, exit 0; retained report
`test-results/worlds-v2-history-integration-2026-10-26.json`.
Final tests after consolidating the check into the existing scan: 85 PASS across
3 files, 0 FAIL, exit 0, 58.03s. Report:
`test-results/worlds-v2-history-final-2026-10-26.json`.
API typecheck, scoped ESLint and diff checks passed. No full regression,
new browser acceptance or fresh OS-process crash run in this delta.

Independent Sol High and advanced source delta: P1/P2/P3=0, limited to these
structural checks and retention of first-only recovery. Not repeated-write or
complete V2 signoff. These tests use Fake Minecraft and isolated filesystems.

The prior six-process crash report belongs to the previous candidate: 16/17
listed source hashes still match; the reconciler changed and the new history
module is not listed. Preserve it as historical evidence, not a fresh crash run.

## Remaining boundary

A valid prefix cannot prove its final transition was not deleted. This helper
is not a durable head anchor and cannot clear recovery gates alone. Historical
guard payloads and live world evidence still require physical verification.
Complete deletion of local evidence cannot be disproved by the local ledger.

Next: versioned source evidence distinguishing an import birth from a legacy
world's prior activation guard; durable chain head; physical historical guard
validation with legitimate world saves; repeated execution/crash tests; bounded
startup verification; explicit confirmation API/UI. Do not repurpose the field
`sourceImportTransactionId` for an activation ID. Archive history stays blocked.

No Java starts, real world changes, Git publication or P7 work in this delta.
