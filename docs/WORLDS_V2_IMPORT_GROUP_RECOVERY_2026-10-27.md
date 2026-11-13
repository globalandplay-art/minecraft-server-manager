# First replacement and ordinary import receipt recovery

Status: bounded checkpoint ACCEPT; independent final evidence readback complete.
Production replacement remains disabled.

This continuation changes the earlier runtime candidate. Its hashes and test
reports remain historical evidence, not a freeze of the current source.

## Bounded implementation

The existing physical birth audit now supplies exact import operation,
transaction, world and full-record digest claims. OperationService compares
these against a fresh closed set of committed schema9 import journals alongside
the single committed schema13 replacement. Every receipt is checked before
the first save. All members remain masked during settlement; full-group CAS,
physical proof and admission checks precede final synchronous gate release.
Any failure regates the whole group without replaying file transactions.

Failed import receipts retain their raw failed state across initialization.
An expired historical import key does not overwrite a newer operation's key
mapping. Existing TTL and request identity metadata are preserved.

This does not enable activation/replacement mixed histories, repeated
replacement, ambiguous receipts, or production writes. It is not Phase1/V2 PASS.

## Evidence obtained

- `worlds-v2-import-group-focused-2026-10-27.json`: 16 PASS, 0 FAIL,
  93 not selected; covers exact claims, all-receipt prechecks, partial save,
  replay/GET/event masking, reused historical key and final failures.
- `worlds-v2-import-group-http-2026-10-27.json`: original 1 FAIL retained.
  Test selected a journal using the wrong kind spelling, yielding TypeError.
- `worlds-v2-import-group-http-fixed-2026-10-27.json`: 1 PASS, 0 FAIL,
  109 not selected. Authenticated Fastify verification settles both receipts
  while journal/catalog/active-state bytes remain unchanged; no start/stop.
  This is same-process reconstruction with MemoryOperationStore, not OS restart.
- API typecheck, scoped ESLint and diff check passed at this checkpoint.
- Independent GPT-6.1 Sol High bounded source/evidence review: P1/P2/P3=0/0/0.
  Broader integration, OS evidence and final freeze remain open.

Affected replacement/import integration: **224 PASS / 0 FAIL / 0 not selected**,
`worlds-v2-import-group-integration-2026-10-27.json`, exit0. This is not a full
repository regression. No Web/Contracts changes in this unit; prior results
remain historical and are not counted as a new full-stage validation.

The OS harness adds a separate replacement-import-recovery flavor. It creates
an independent import before replacement and checks its receipt after a new
process reloads JsonOperationStore. Existing 30s observation / 38s cleanup
limits, owned child handles and previous modes are unchanged.

Latest OS report: `worlds-v2-replacement-import-recovery-crash-3915cc7c-65b6-46cd-a4a6-0e06ac1243e6/result.json`.
Both selected boundaries PASS, four distinct run/probe child processes closed,
Java0. Before explicit verification both receipts remain interrupted/gated.
The commit-only boundary remains gated; completed head explicitly settles both
correct resource IDs. All scoped journal records and server bytes remain equal.
This is independent OS service-layer recovery with real JsonOperationStore,
not real Fastify OS restart or actual Minecraft acceptance.

The earlier `dd2cbb7d-0ae4-475a-84c2-75771417e5f1` OS report is retained. Independent
review requested stronger evidence assertions (pre-verification masking,
resource IDs, whole journal set, birth IDs and store source hash); the latest
report includes them. No product repair or timeout change was needed.

Candidate manifest: `worlds-v2-import-group-candidate-2026-10-27.json`, six
source/test files and four result reports. Independent GPT-6.1 Sol High final
readback: P1/P2/P3=0/0/0; candidate10/10 and OS source31/31 hashes match.
Earlier evidence-assertion P3 closed. Focused reports overlap integration224 and
must not be added to that count. Acceptance is limited to this group recovery.

Next implementation checkpoint: new-world creation must bind a fresh immutable
world identity using existing `world-create-service.ts` / plan / journal and
catalog mechanisms. Do not enable production replacement or inherit previous
world backup identity. Arbitrary mixed transition recovery remains gated.

No real Minecraft/world operations, Git uploads, Windows settings or P7 changes
were performed for this unit. Prior test evidence is retained.
