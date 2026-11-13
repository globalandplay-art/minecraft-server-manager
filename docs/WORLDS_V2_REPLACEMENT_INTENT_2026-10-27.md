# Replacement schema12 inspection — IN PROGRESS

No replacement executor or writable REST endpoint is enabled. This unit lets
the existing journal inspect explicit replacement intent while keeping every
such instance blocked pending a dedicated physical verifier.

Schema12 fixes new and previous immutable IDs, same-name confirmation, observed
Vanilla26.3, root/catalog/current-content identities, separate path-bound and
rename-stable current directory identities, properties revision/checksum,
owned source upload revision/checksum, guard ID, sequence/predecessor and exact
owned workspace/preserved-old-world paths. Missing/extra fields, unsafe names,
wrong resource or confirmation, self predecessor, running/allow-stop intent and
invented target directory identity are rejected. The target does not exist at
intent time; later checkpoints must prove staging and installed object identity.

Operation kind world-replace is readable but not exposed as a mutation route.
Its idempotency keys survive expiry/restart and conflicting histories fail closed.
All journal states and stored receipts retain a replacement-unverified cause;
unsupported receipts become interrupted, never verified success or rollback.
No startup replay, world rename or data write is implemented by this unit.

## Independent findings and repairs

P2 Attempt1: startup protected-active-server classification originally covered
only activation; now includes replacement-first journals and receipts. Actual
buildApp tests cover journal/receipt-only × missing/pending state, verify exact
absence/bytes and denied start without adapter invocation.

P2 Attempt1: generic resolveOwnedRecovery retained the gate but could rewrite an
interrupted replacement receipt to failed/rolled-back. It now refuses the ID
before cause/receipt mutation. Tests combine terminal journal and stored receipt
and verify exact stored evidence unchanged. Generic physical confirmation also
refuses known replacement IDs; premature markers are removed at initialization.

Earlier54PASS precedes those repairs and remains historical. Post-fix focused
32PASS; final affected106PASS/0FAIL/0pending across6suites, report
`test-results/worlds-v2-replacement-intent-affected-2026-10-27.json`.
Contracts32PASS; API/Web typecheck, API build, scoped ESLint and diff exit0.
Independent GPT-6.1 Sol High post-fix source and final106-test evidence review
accepted, P1/P2/P3=0 for inspection-only scope. No test assertions/timeouts
weakened; no original evidence overwritten.

Next: exact mixed transition/checkpoint projection, unified durable-head proof,
retired world physical provenance, then protected execution and interruption
acceptance. Existing schema3 real-load proof still incomplete; earlier real
Minecraft run predates schema3. P7 STOPPED; no Git upload or real world changes.
