# LC2 action resource accounting — 2026-10-16

## Current boundary

UNWIRED resource-accounting core only; not a whole-action registry or product integration. `WhitelistActionResources` receives constructor-only trusted assertion/revocation and Fake resources, records creation attempts before invoking factories, and separately tracks result settlement/physical closure. It performs no filesystem/native/network operation, owner acquisition/release, authentication, AsyncLocalStorage token construction or production ACL delegation. No production caller is added.

Any task failure poisons/revokes before error delivery, even when the body catches it. Body completion with outstanding work is unsafe; later drain never rehabilitates the primary result. Unknown creation remains retained. A maximum8 active resources and262144 creation attempts prevents unbounded bookkeeping; capacity rejection happens before the excess factory. These bookkeeping constants are not a physical maximum-history throughput claim.

One5s cleanup deadline begins at the first public drain call, including revoke and synchronous cleanup cost. Its Promise is published before any external callback, so synchronous reentry shares the same result. All known resource drains and result settlements remain observed; no additional cleanup is started after the shared deadline is exhausted. Unknown creation/close/unsettled work, revocation failure or expired cleanup rejects CLEANUP_BLOCKED. No raw native errors, output or paths enter public errors. The outer integration still must retain its real lease/activity on uncertainty and validate final owner identity; this component cannot enforce those unimplemented duties.

## Source and evidence

- `apps/api/src/services/whitelist-action-resources.ts`
- `apps/api/test/whitelist-action-resources.test.ts`
- Same-slice correction: `apps/api/src/services/whitelist-native-writer.ts` and its test now publish the shared close promise before callbacks can reenter.

Initial resource-only focused9PASS/exit0 (`lc2-action-resources-focused-v1.log`). Independent source review found cleanup reentry and per-resource deadline issues; corrected at Attempt1, then delta P1/P2/P3=0. Fresh affected13files250PASS/exit0,19.72s suite (`lc2-action-resources-affected-v1.log`) includes final resource and writer tests plus session, transport, scope, rotation, budget, owner-retention, command-store, member policy, synthetic coordinator, sibling protocol and inert fixture tests.

Latest lint0, typecheck0 and production build0 (`lc2-action-resources-lint-v2.log`, `lc2-action-resources-typecheck-v2.log`, `lc2-action-resources-build-v1.log`). Existing543.14KiB Vite chunk warning retained; successful build5.13s, process exit0. Final summary `test-results/lc2-action-resources-final-v1.json` reverified four hashes4/4. Full project regression NOT RUN; current native/default and physical command-capacity failures are not removed or skipped to claim a full PASS. No real native writer or Minecraft run.

Frozen manifest: `test-results/lc2-action-resources-frozen-v1.json`:

| File (apps/api relative) | SHA-256 |
| --- | --- |
| src/services/whitelist-native-writer.ts | 06a3faa5a45182174589307381f58c80174d788a7fa24498c78ff2657164ede0 |
| test/whitelist-native-writer.test.ts | 10d9eb6e958609e4055c10308ac3c640ee04d349356a7656d8edf754ac318ade |
| src/services/whitelist-action-resources.ts | 83eeeff98ff27906a41bd89deeb90c90933ea76861cea546a8151c6069f87b47 |
| test/whitelist-action-resources.test.ts | 5622eb626ba06aa8f95b3a2a2b5c7bab6d1a88bebd34518f08c5ab3f9fe43038 |

Final authorized independent SolHigh source/evidence/document review P1/P2/P3=0, four hashes independently matched4/4; no production calls to either component. Git diff check0 and all23 changed/untracked text files whitespace/final-blank scan0 (`lc2-action-resources-whitespace-v1.json`). This closes only the stated UNWIRED accounting/source slice, not any remaining real-owner or native Gate.

## Issue ledger and preserved history

| Issue | Severity/status | Evidence / next action |
| --- | --- | --- |
| LC2-PUBLICATION-OWNER-001 | HIGH / OPEN P2 | Default private publication helpers still do not retain exact owner handles. Whole-action lease/task integration, real native writer retention and crash/default capacity Gates are unproved. No explicit runtime error code; design finding. |
| LC2-RESOURCE-REENTRY-001 | HIGH / RESOLVED candidate, Attempt1 | Shared drain Promise was assigned after synchronous callback entry. Publish Promise first, keeping original deadline; Fake revoke/resource reentry tests. Same pattern corrected in writer kill/close with its own regression. No native incident; independent delta0. Earlier writer30/237/hash evidence retained as historical. |
| LC2-RESOURCE-DISPATCH-001 | HIGH / RESOLVED candidate, Attempt1 | An earlier synchronous cleanup could exhaust5s but later cleanup would still be invoked. Check same deadline before each resource call; later resource stays unstarted/retained. Fake boundary test and delta0. No timeout limit changed. |
| LC2-DESIGN-FAILURE-001 | HIGH / RESOLVED design, Attempt1 | Explicitly require permanent poison for swallowed nodeTask failure and unsafe body-return with outstanding work. Design delta0; full registry remains unimplemented. |
| LC2-DESIGN-ACL-001 | HIGH / RESOLVED design, Attempt1 | Prohibit nesting current WhitelistAclScope.run under a new owner lease. First resource core has no ACL delegation; private borrowed-lease controller needs separate review. |
| LC2-CAPACITY-COMMAND-001 | MEDIUM / BLOCKED | PHYSICAL_CAPACITY_OBSERVATION_DEADLINE, old suite exit1, exact failing step UNKNOWN. Cold-open and independent root-limit PASS do not rewrite it; product performance fixes0. |
| LC2-SOURCE-LOOKUP-001 | LOW / RESOLVED | Two read-only source lookups guessed obsolete coordinator filenames; PowerShell PathNotFound/ObjectNotFound, no source changed. Actual source is whitelist-synthetic-coordinator.ts; read before designing integration. No product/runtime failure. |

No fixture/test timeouts, assertions, ACL standards, original auth/private-publication runner, store bytes, default exclusive paths or recovery semantics were relaxed. Historical failed roots/evidence remain preserved. Build size warning remains visible. See capacity/retention/writer reports for all earlier failures and limits.

## Precise continuation

Next implement and independently review the real-owner/AsyncLocalStorage action envelope around this resource core, still UNWIRED. It must own one actual non-reentrant mutation lease, bind root/epoch/context, retain it and beginActivity through all resources and final persistence, reject late/cross-action continuations and separate primary/cleanup outcomes. No borrowed owner or reentrant Fake should be used to claim production correctness.

Then independently design/review the borrowed-lease ACL controller and fixed native writer/Node filesystem primitives; preserve every required ACL/identity/byte/hash/no-replace check. Native fixture design/review precedes real isolated execution. Only after those Gates and maximum-history/default crash validation may scoped store migration/API work be considered. Member writes UNWIRED; LC2 IN PROGRESS; remote PAUSED; LM1/LM2 NOT STARTED.

Git remains on codex/phase-4-players-properties at7613cf1d28949e303b2beaf53f6cdba69c56cb8d (the already successful authorized upload). All newer files are uncommitted. No automatic second upload, PR or merge; private test-results/runtime/.manager stay ignored.

Actual safe-handoff allowance reading: primary used97%/remaining3%, weekly used46%, ordinaryUsageAllowed=true. This is near exhaustion, not an assertion that quota is already exhausted; no reset credit was used. No owned native child/transaction was started by these two Fake-only slices, and every test/build command completed with recorded process exit. No claim is made about unknown system processes. Preserve all23 working-tree entries and failed historical roots. Resume from the real-owner/context envelope design/source review above; do not rerun accepted primitives merely because the task resumes.
