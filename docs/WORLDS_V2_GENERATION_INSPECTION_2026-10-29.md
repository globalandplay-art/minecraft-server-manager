# Leased published-generation inspection (2026-10-29)

## Scope

Unmounted backend composition of the accepted current-state proof. It acquires
the existing per-instance exclusive lease, checks matching parent14/execution
ownership and invokes the full physical proof plus recheck. It returns only an
inspection summary with inspectionOnly=true and recoveryRequired=true. It does
not write slots/receipts, settle causes, start Java, expose HTTP, or certify ready.

OperationService.runGenerationInspection compares original internal receipts
with persistent owner evidence before and after action, validates parent journal
digest and rejects competing generation receipts. Unrelated historical lifecycle
receipts are allowed. Only exact parent/execution generation/operation/journal
causes are eligible; unknown, external, issue and other owners remain blocked.
The cause set must remain unchanged. Physical IO runs outside the global mutation
queue while the instance lease remains held. The final release callback checks
current state and always removes its own lease, including on failure.

WorldGenerationService.inspectPublished registers an inspection owner before
its first await. close aborts admission and waits for the ongoing read to drain;
it never kills a process or releases a live lease after a timeout race. Closing,
revocation or any drift prevents a successful inspection response. No proof,
recheck callback or private receipt escapes in the summary.

## Review and retained evidence

Independent GPT-6.1 Sol High design review approved this bounded read-only path.
First source review: P1/P2/P3=0/2/0. Findings: final lease-release queue wait needed
another state check; receipt closed set incorrectly included unrelated history.
Both were minimally corrected; final delta signoff remains PENDING until recorded.

Initial focused report worlds-v2-generation-inspection-2026-10-29.json:
57 PASS/0 FAIL. It predates the two review corrections and cannot certify them.
Initial affected report worlds-v2-generation-inspection-final-2026-10-29.json
also predates those corrections; preserve it separately from fresh validation.
Reports live in test-results/. API typecheck, scoped lint and diff check exit0
after the corrections. Final tests and build evidence will be recorded below.

Process inventory via CIM returned access denied (0x80041003); no permission or
system change was attempted. No real Java or browser acceptance was run here.
Fake cleanup/drain and retained evidence rules from the prior current-state
unit remain in force. P7 STOPPED; no Git publication.

## Corrected-candidate evidence

worlds-v2-generation-inspection-reviewed-2026-10-29.json: four API suites,
292 PASS/0 FAIL/0 pending. Covers the final release-queue cause race using public
APIs, unrelated historical lifecycle receipt acceptance and competing-generation
receipt rejection. API build/typecheck/scoped lint and diff check exit0.
Candidate manifest worlds-v2-generation-inspection-candidate-2026-10-29.json
records three source/test files plus the reviewed report (4 hashes).
The independent delta source review closed both P2s (0/0/0). Its final evidence
attempt hit the model usage limit before completion: no final signature was
claimed. A later quota read showed natural primary-window recovery to0% used,
weekly47%; final independent evidence review was resumed, without resetting or
repeating unchanged tests. Final signature remains PENDING until returned.

Final independent GPT-6.1 Sol High evidence review subsequently completed:
4/4 frozen hashes match; four-file report292PASS/0FAIL/0pending independently
read; release sentinel, history acceptance/competing receipt rejection verified.
P1/P2/P3=0/0/0; limited leased read-only inspection ACCEPT. The earlier PENDING
checkpoint and quota failure remain historical, not a missing final signature.
No slot settlement, unlock, API or real Java acceptance is included.

## Remaining delivery boundary (unchanged)

This is an internal prerequisite, not a user-facing recovery feature. Dedicated
resumable pending/active CAS and receipt settlement, a policy for legitimate
subsequent Minecraft saves, final readiness/invalidation, HTTP/UI integration
and scoped fresh real acceptance remain required. Existing startup external
causes are not relabeled or waived by this unit. V2 remains IN PROGRESS.
