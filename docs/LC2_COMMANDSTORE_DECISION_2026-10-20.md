# LC2 CommandStore stop-loss decision — 2026-10-20

## Decision

DEFER online member mutations. Retain production read-only whitelist; do not resume native CommandStore optimization or wire a replacement on this slice. This is a scope decision, NOT LC2 write ENGINEERING PASS, a resolved dispatch failure, or a green project baseline. Phase7 remains PAUSED.

## Actual dependency, not historical intent

- main.ts buildApp supplies no whitelistMembers factory. app.ts constructs the optional coordinator only through trusted constructor injection. Production read-only WhitelistService uses registered root identity, PropertiesReader, readStoredWhitelist and shared OperationService, not CommandStore/GuardStore/native writer for membership reads.
- The candidate WhitelistRconCoordinator does require commands.admit(intent-persisted), commands.append(dispatch-intent), then generation-bound session mutation. It later persists bounded response evidence linked to before/after guards, verifies it and reconciles on startup. CommandStore cannot be removed from that candidate without a replacement satisfying these same invariants.
- Thus CommandStore is NOT a live production dependency today, but IS a direct dependency of the current proposed online-write implementation. Native persistence is not intrinsically mandatory; its guarantees are mandatory. Do not call it offline-only.
- Session/CSRF/recent authentication, registered execution/RCON identity, shared operation exclusion and durable intent/idempotency/recovery remain required for any later write implementation.

## Existing alternatives evaluated

| Mechanism | Reuse decision |
| --- | --- |
| OperationService + JsonOperationStore | Keep for operation admission/status/restart idempotency. It is not a private append-only dispatch boundary/evidence ledger and does not establish the CommandStore namespace, checkpoint/witness and response/guard bindings. Not a safe drop-in replacement alone. |
| TransactionJournalStore | Existing world/properties/addon schema and atomic file replacement are valuable, but no whitelist send-boundary schema/controller or equivalent private evidence contract. Adapting it is a separate migration/security/crash validation project, not an immediate small fix. |
| AccessOperationStore | Append-only private storage, but provider/configuration/revision contract is Access-specific. It uses the same WindowsPrivateAclVerifier/private-publication primitives; swapping names would neither establish whitelist semantics nor prove performance improved. |
| WhitelistAclScope / GuardStore | Reused default guard composition; actual guard crash/restart PASS. The ACL scope is single-query/non-reentrant while CommandStore scans up to eight independent chains. Direct substitution without action-local serialization/drain and publication quiescence is unsafe. No new pool/framework introduced. |
| Compiled D3, owned/wide writer alternatives, offline whitelist.json | Not selected by current production main or RCON coordinator. Their signer/provenance/performance research is not a prerequisite for read-only delivery. Preserve source and failed evidence. |

## Timeout evidence and limits

Preserved dispatch-canonical-request.log: command intent admission began28485ms; at32057ms command directory creation completed2421ms and ACL-many was active. The original shared50s deadline expired before dispatch checkpoint, with NATIVE_OBSERVATION_DEADLINE and secondary CLEANUP_BLOCKED. No recovery reader launched. Late inner await UNKNOWN because bounded observer cap was exhausted; do not claim exact write/sync/commit/scan causality. No proof of Minecraft command transmission; this fixture uses SyntheticRuntime, not real RCON.

Do not repeat the prior targeted native run solely to complete a timing table. The premise for this task's conditional performance branch (an unavoidable currently selected production dependency) is not met. A single immediate alternative cannot be shown safe from current code. Architecture decision is taken now rather than another native round. No change to50s, ACL checks, assertion, cleanup or helper lifetime; retained scene not deleted or forcibly cleaned.

## Debt classification and reopening triggers

| Classification | Item | Gate / trigger |
| --- | --- | --- |
| MUST_FIX before any online write release | Durable intent and dispatch boundary, restart-safe idempotency, no resend on uncertainty, trusted response/file evidence, native dispatch interruption closure | Candidate remains disabled until implementation and actual applicable evidence pass. The required guarantees are not deferred while enabling writes. |
| MUST_FIX before any online write release | Production observations binding, real Vanilla26.3 grammar/save behavior and authorized isolated acceptance | Fake correctness is not production acceptance; no default rule added. |
| DEFERRED | Current CommandStore native dispatch50s optimization / its unresolved failure | Reopen only with an explicit bounded online-write implementation decision; not a blocker to read-only or independent monitoring development. |
| DEFERRED | Offline whitelist.json writes, arbitrary UUID, compiled D3 signer/native bootstrap, unselected owned/wide integration | Outside online MVP and not used by read-only path. Reopen only when that implementation is deliberately selected. |
| DEFERRED | Extreme historical/capacity combinations and unselected helper experiments | Historical evidence and tests retained. Previously passed direct capacity/detached selections remain their own evidence, not all combinations or full baseline. |
| SUPERSEDED | None of the unresolved CommandStore paths | No safe production replacement has been implemented; do not relabel a failure as superseded merely because scope changed. |

## Delivery and validation

Existing saved-member read, refresh, version/path/recovery unavailable reasons and disabled mutation controls retained. Members API rejects missing production coordinator; authentication/recent mutation required before submission. No generic Console route fallback, new store, environment switch or Fake production adapter.

This slice: product/test source changes NONE. Isolated existing API whitelist tests16PASS /exit0, Web Whitelist tests8PASS /exit0. Logs: test-results/lc2-debt-path-2026-10-20/readonly-decision-{api,web}.log. These are read-only/Fake checks, not native dispatch or real Minecraft acceptance. No full regression/lint/typecheck/build rerun for documentation-only decision; previous failures remain open and no whole-projectPASS claimed.

LC2 readonly boundary is retained and focused-verified; online mutations NOT DELIVERED. LM1 is independent and can proceed: docs already record LM1 history UI implemented, so resume its actual remaining checkpoint rather than reimplementing it. LM2 trusted TPS/MSPT remains separate; N/A without a trusted source. No commit/push/PR, Minecraft launch, user world/system/network changes or historical evidence removal.