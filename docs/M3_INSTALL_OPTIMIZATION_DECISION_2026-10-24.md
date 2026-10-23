# M3-E next implementation decision — 2026-10-24

## Subsequent explicit decision and execution

The user approved execution (“批准执行”), granting the required one-round
exception beyond the prior two-round stop. Attempt3 is implemented and one
fresh non-timing three-width browser run passed with unchanged30000ms.
See [implementation, validation and remaining Gates](./M3_OPERATION_SCOPE_2026-10-24.md).
The original proposal/approval-needed language below is retained historical
decision context, not a current request for repeated authorization.

## Status and authorization boundary

**ARCHITECTURE REVIEW COMPLETE — CONDITIONAL DESIGN ACCEPTANCE ONLY.**
No product code, tests, configuration, preserved evidence or runtime were
changed/executed during this review. HEAD remains
`2f084f37e8585a046d15e57896e22f0405a76ad1`, branch
`codex/phase-4-players-properties`; existing uncommitted work remains.

M3-INSTALL-BROWSER-DEADLINE-001 remains HARD BLOCKER after2 substantive repair
rounds. The subsequent single timing run did not reproduce the failure and
was explicitly diagnostic-only. This document neither resets that count nor
authorizes another repair. A further implementation would be the next repair
round for the **same issue**, requiring an explicit exception to the recorded
two-round stop; it must not be relabeled as a new root cause.

## Selected strategy

Reuse successful pure NeoForge content facts for **one accepted installation
execution**, rather than recreating them independently for each identity call.
Extend the existing scoped content reader; do not introduce a new database,
file publisher, native helper, global cache, operation framework or supervisor.

The current execution makes8 complete identity observations: entry, after
guard, after prepared-source validation, before target link, after publication,
before commit, during stage consumption, and final consumed verification.
Each currently creates its own reader. The first two preflight observations
remain outside the proposed execution scope, as do upload, restart and recovery.

This reuses deterministic ZIP/content facts only when **freshly read bytes**
produce the same SHA256 and complete validation role. Physical evidence and
authorization are never memoized. The already reviewed key remains role
(game/universal/loader/ordinary), classpath flag and fresh hash;68-entry/8MiB
bounds, immutable facts and cold fallback remain unchanged. INDEX references
are re-resolved for the current relative location and absence is checked anew.

## Mandatory invariants

Every original boundary retains full file reads/hashes, physical identity,
directory/root/absence checks, per-file and aggregate limits, Java bytes/version,
environment, argv and registered closure checks, final stable re-reads and
comparison to the operation's approved identity. No complete identity/binding,
ownership, authorization, revision or absence result is cached.

The private execution scope must be bound to the exact adapter reference,
server/root and approved registration, and to the current running operation.
Before **and after** each awaited observation it must reject wrong/inactive
operation, stopped-state/ownership/recovery drift, abort or changed binding.
Dispose in execute's `finally` on success, error and interruption; clear the
facts and reject all use after disposal. No scope is stored on the shared
service, selected by HTTP/environment, persisted, migrated or reopened.

Upload and install constructor-injected test verifiers must remain distinct.
Scope reuse must not silently replace either custom verifier with the builtin
one: each service preserves its own existing delegate and call behavior. The
shared pure reader is used only for the genuine builtin NeoForge path. Default
Paper/Fabric/Forge behavior, standalone upload/preflight/recovery and prior
identity serialization remain unchanged.

## Bounded implementation footprint (not implemented)

1. `addon-adapter-identity.ts`: private scope/factory that delegates complete
   physical capture while optionally retaining the pure reader; preserve the
   existing public cold capture path and constructor-injection semantics.
2. `neoforge-launch-binding.ts`: reuse existing bounded content facts; add
   explicit disposal if needed. No new file-reading or validation algorithm.
3. `addon-install-service.ts`: create one scope only in accepted execute,
   forward it to the existing8 observations, and dispose in `finally`.
   Keep the existing transaction, guard, publication and checkpoint ordering.
4. `addon-upload-service.ts`: private trusted-construction scope forwarding
   through validatedSource/markConsumed/verifyConsumed, retaining each method's
   complete checks and its own injected verifier. No new HTTP DTO or client
   option, and no relaxed stage-consumption rule.
5. Directly affected tests: prove cold/warm identity equivalence and unchanged
   refusal on byte drift, same-byte physical replacement, links, INDEX target
   appearance, role change, adapter/root/registration mismatch, owner/recovery
   loss during an awaited read, abort, disposal and separate injected hooks.
   Preserve existing commit/restart fault tests, assertions and timeouts.

No change to OperationService, transaction journal format, protection backup,
UI/authentication, process lifecycle, concurrency or the30s completion Gate.
No LC2 native tests or P7 work.

## Alternatives rejected or deferred

| Option | Decision | Reason |
| --- | --- | --- |
| Skip hashes or reuse mtime/old complete identity | Reject | Would weaken actual physical drift checks |
| Global/service-wide cross-request cache | Reject | Unnecessary lifetime/isolation surface |
| Faster UI polling or early success | Reject | No proven UI defect; cannot replace final proof |
| Raise30s or delete final assertion | Reject | Violates the retained acceptance contract |
| Parallel physical-file reads | Defer | Changes I/O ordering, memory and failure draining; larger proof burden |
| New native persistence/helper framework | Reject | Unrelated to the demonstrated current cost |

## Evidence and expected benefit limits

The diagnostic measured backend execution26.45–26.76s, terminal save4–9ms,
final list read28–29ms and total assertion confirmation27.20–28.19s.
That identifies backend work as the dominant duration in that sample; it does
not measure the standalone share removable by this proposal. No seconds saved,
stable30s margin or historical root cause is promised. Physical reads remain
and may dominate, so the actual benefit may be insufficient.

If specifically authorized, implement only this scoped strategy, run affected
tests/static checks and independent Sol High delta review, then perform one
fresh **non-timing** three-width acceptance with the original30s assertion.
Do not follow failure with another automatic repair, concurrency change,
timeout increase or rerun. Keep the diagnostic hook disabled for final
acceptance; full delivery regression and applicable advanced Gate are separate
and remain required. Source changes invalidate affected prior validation.

Independent Sol High review conditionally accepts pure-content scope reuse
under these invariants, preferring it to parallel physical validation. This
is design review only; implementation/security/acceptance Gates remain pending.

## Concrete decision needed

Approve or reject **one further bounded implementation/verification round for
this specific operation-scoped pure-content strategy**, explicitly beyond the
existing two-round stop. It does not authorize Git, Minecraft startup, P7,
system/network changes or lowering safety/time limits. Until that decision,
retain the present reviewed code, all evidence and BLOCKED status.
