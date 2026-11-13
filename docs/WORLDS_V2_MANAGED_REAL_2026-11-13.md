# First managed generated-world lifecycle — 2026-11-13

Status: IN PROGRESS; Phase 1 is not complete. P7 remains STOPPED.

The isolated runner uses the previously authorized Vanilla 26.3 source JAR
and existing accepted EULA, without reading the original world. Managed mode
allows at most three Java launches, enforced before spawning. Independent
GPT-6.1 Sol High pre-execution review: P1/P2/P3 = 0/0/0.

## Preserved first attempt

Evidence: `test-results/worlds-v2-generation-real-bc298932-2073-4fe8-b637-7fe970196bfd/result.json`.
The command was `node --import tsx tests/acceptance/worlds-v2-generation-real.mjs --execute --managed`.
Exit code 1, BLOCKED. Baseline and generated-world Java processes both exited
normally with code 0; generation's persisted raw result was succeeded.
No third launch occurred. Both child handles closed without force termination;
generation service and manager cleanup completed. Source hashes were unchanged.

The runner then used the legacy preparation execution-seal reader after opting
into published-catalog mode. It rejected the new catalog with
`World identity requires inspection`. The targeted harness correction uses
the existing published-evidence reader in managed mode and still checks the
exact execution operation ID and world ID. Legacy mode retains its old reader.
Product validation and recovery gates were not relaxed. This failed attempt
is retained and is not counted as a successful managed-lifecycle acceptance.

## Corrected fresh-UUID run

Evidence: `test-results/worlds-v2-generation-real-2da13004-fe58-4a92-ab7b-6c88db79ca5d/result.json`.
The same command completed with exit code 0 and four business checks PASS.
Baseline generation, isolated new-world generation and first managed start/stop
used exactly three Java children. All closed with code 0 and no signal,
output overflow or spawn error. No forced termination was needed. Manager and
generation cleanup completed; original source hashes remained unchanged.
The start and matching stop records were reloaded through a new OperationService;
the recovery gate remained true. Each launch retained 10 WARN and 1 ERROR entries:
these logs are not waived or certified by the business PASS. Independent
GPT-6.1 Sol High evidence review accepted this narrow business scope at
P1/P2/P3 = 0/0/0, including candidate hashes, launch/stop receipts and logs.
This is not Phase 1 or V2 Final PASS.

## Scope boundaries

Independent Node reopen also passed: `reopen-13568.json` in the successful
run directory. Command:
`node --import tsx tests/acceptance/worlds-v2-managed-reopen.mjs worlds-v2-generation-real-2da13004-fe58-4a92-ab7b-6c88db79ca5d`.
Exit code 0. Actual buildApp startup and HTTP world-library read returned
inspection-required, generated world present, no active world, and both
mutation/activation capabilities false. Minecraft launches were hard-rejected
and remained zero; fixed, hash-verified Java version detection was permitted.
Independent Sol High reviewed this evidence at P1/P2/P3 = 0/0/0.
This proves a separate Node process reopen, not an operating-system reboot,
recovery settlement, or real browser interaction with the backend.

Chrome checks passed at 360/768/1440 with three languages, using synthetic HTTP;
they do not prove real Minecraft or real backend browser integration. Separate
buildApp tests use real Fastify/authentication with a Fake runtime. Browser
evidence review found no P1/P2/P3; process cleanup was observed by the primary
executor, without a persisted independent process audit.

The Java runner uses service calls, not HTTP/UI. Its OperationService recovery
check is in-process; the separate reopen script adds independent Node evidence.
Recovery unlock, unrestricted ordinary lifecycle, strict diagnostics, restic,
online backups and whole-V2 acceptance remain outside these results.

## Next implementation boundary: recovery settlement

Independent Sol High design review identified two coupled requirements before
any recovery release: schema7 ordinary-reader/mutator acceptance and legal
successor-state semantics. Clearing OperationService causes alone is unsafe
and would not make the current catalog usable. Reusing the historical stop
tree checksum forever would incorrectly re-lock after legitimate later use.

Reuse the existing startup stop inspection lease, exact cause census, physical
checks, schema2 confirmation, journal location/digest and mature catalog /
publication checks. Retain immutable raw generation/start/stop evidence and
idempotency scopes. A dedicated append-only settlement must be server-created
from these checks under one lease, read back after persistence and rechecked;
it cannot accept client-provided evidence digests or cause lists. Terminal
operation projection must remain consistent across get/list/replay/events.

The settled catalog view must preserve the UUID and genesis history through
later controlled imports, activations and ordinary lifecycle changes. Missing
or unknown successor evidence must remain fail-closed. Do not simply whitelist
schema7 globally, rewrite raw receipts, or use generic recovery confirmation.

Required targeted cases include missing/corrupt/conflicting settlement,
confirmation v1 rejection, extra cause/receipt, physical/catalog/journal
replacement, write/readback drift, interrupted settlement followed by separate
Node recovery, key replay, and legal successor followed by another reopen.
The strict settlement descriptor and write-once OperationStore sidecar are now
implemented. Targeted storage/lifecycle tests passed 59/59; API typecheck and
scoped lint passed. Independent Sol High: P1/P2/P3 = 0/0/0 for this layer only.
There is no issuer, schema8 publication, terminal projection or recovery release.
The matcher checks lifecycle/confirmation/revision bindings; it does not prove
preparation/execution or catalog/genesis object authenticity. These remain
mandatory responsibilities of the same-lease issuer/consumer.

The real-run candidate predates this OperationStore edit; retain it as scoped
historical evidence, not final acceptance of the later current tree. Targeted
store and lifecycle checks cover this edit without replaying the unchanged
three-Java scenario.

Implementation notes from independent design review: preserve schema8 in
withTransitionHead/withExistingHead; existing empty-genesis callers in
orderedWorldTransitionRecords, projectTransitionHistory and replacement
snapshot checks must select the verified immutable genesis. Reuse
projectGenerationWorldHistory, which also rejects generation operation,
transaction and guard ID reuse. Keep inactive imports in auditImportBindings.
Apply verified settlement at startup only after active-state and catalog /
journal audit, so later startup classification cannot silently re-add causes.
