# LC2 whole-action ownership — design candidate

Design accepted for the first Fake-only resource/registry foundation; implementation has separate source/test Gates. No product integration, native writer execution, API/member mutation or new network authorization. Remote PAUSED; LC2 IN PROGRESS. Design acceptance does not authorize a borrowed-lease controller or store migration.

## Problem established from current source

`WhitelistGuardStore.#exclusive` and `WhitelistCommandStore.#exclusive` each take the real non-reentrant `beginOfflineMutation` and release in finally. Their open methods immediately scan; later create/admit/append/verify calls scan again. Wrapping these public methods in a second real `WhitelistAclScope.run` cannot work: the second acquisition correctly returns busy. A Fake owner that pretends the lease is reentrant would bypass the production safety problem.

`WhitelistAclScope` currently tracks only its ACL session queries/children, outstanding results and close. Its quiesce retires an ACL child without releasing its owner lease. It cannot track publication helpers or Node filesystem promises. `private-publication.ts` currently calls the original15000ms native runner for Create/Move and performs separate Node open/write/sync/close. Those writer helpers do not retain owner handles. A helper surviving owner death is therefore a separate P2 even though ACL sibling retention already passed its limited exclusion test.

The new `WhitelistNativeWriter` solves only an UNWIRED transport boundary: mandatory owner wrapper, one shot,15s/16KiB, success after actual close0/null, fixed errors, shared5s drain. It does not acquire a lease or track Node filesystem tasks. Its Fake source Gate does not close the publication P2.

`SyntheticWhitelistCoordinator` already takes a separate beginActivity around admitted work while stores take individual mutation leases. This activity must stay held through terminal persistence and all child/task drain; it is not a replacement for the mutation lease and is not a real RCON causality proof.

## Invariants

1. One real owner, one canonical registered manager root, one root identity and one mutation epoch per action. A new token is minted for every action; no global pool or request/environment switch.
2. Capture `nativeAclChildWrapper(root)` only after acquiring that exact lease. Every fixed native writer and ACL child must pass through that wrapper before any filesystem mutation/query. The retained handles remain OS-exit-owned, never released early by script completion/receipt.
3. Registry records a task/child creation attempt before invoking the trusted factory. Factory throw cannot establish no child/work was created. Mark uncertainty and retain the lease unless the registry has explicit creation-not-started evidence from its own pre-call rejection.
4. A rejected promise, success JSON, child exit event, kill return, request completion or timeout never equals drain. Native drain requires actual close; Node drain requires its complete trusted task promise, including nested handle close/finally, to settle.
5. A task may mutate only while its exact token is active in the action's AsyncLocalStorage, its owner/root identity remains valid, its work deadline has not passed and mutation admission is open. Check before every primitive, after each awaited step and immediately before irreversible publication. Caller-supplied flags/paths cannot enable this capability.
6. Any registered task failure synchronously poisons/revokes the action before exposing that rejection to the body; catching it does not rehabilitate admission or success. Body completion/failure also revokes admission synchronously before cleanup. If body returns with registered work still outstanding, its result is unsafe even if later drain succeeds: omitted post-write checks cannot be inferred. Late continuations, old capabilities and callbacks from another action cannot spawn or issue a new filesystem mutation. Already-submitted Node I/O may still complete and must be tracked, not assumed cancelled.
7. Releasing the real mutation lease requires complete creation/child/task drain evidence. Unknown creator, unknown child close, unsettled Node I/O or invalid final identity => CLEANUP_BLOCKED, retain lease/activity/evidence, deny another action. Do not release from a generic finally.
8. Drain success does not change a failed operation into success. Preserve primary result and cleanup outcome separately; uncertain mutation remains recovery-required until existing evidence reconciliation proves its terminal state.

## Registry lifecycle and internal shape

Proposed private states: idle → running → draining → released, or retained. No reset/retry for a poisoned instance. A released instance may serve a later action only with a fresh epoch; retained never admits another action.

An internal action capability contains only bound methods, not a raw release function, owner proof, paths, process handles or a mutable public token. Only trusted LC2 implementation code receives it. Proposed responsibilities:

- `assertActive`: verifies exact action context, admission, owner/root binding and monotonic work deadline. No implicit extension.
- `nodeTask`: registers before invoking a trusted bounded closure; tracks its actual promise including handle cleanup. Any invocation throw/rejection permanently poisons/revokes the action before delivering the error, even if the body catches it. Closure uses a separate mutation-fence method for every write/sync/rename boundary. The promise must represent all nested work; spawning an unregistered promise is prohibited. Body completion with outstanding work is recorded as primary unsafe, never success after eventual drain.
- `nativeTask`: registers creation first, wraps a fixed script, constructs one dedicated writer, tracks run and actual close independently. Run rejection poisons further mutation; exact-child cancellation/drain continues. No automatic retry or replacement.
- `acl`: eventual delegation requires a private borrowed-lease ACL controller, with existing SID pin,5000ms per-query limit,64KiB protocol and262144 accounting unchanged. Do not call current WhitelistAclScope.run from inside this registry: it acquires a second non-reentrant lease. First registry implementation exposes only constructor-registered Fake resources and no production ACL delegation. Borrowed-lease controller design/source/integration needs separate review. ACL quiesce must close only the ACL child, never the action/owner.
- `drain`: closes admission first and establishes one absolute5000ms cleanup deadline before the first cancellation/kill. All resource waits share remaining time, not5000ms per resource. Repeated drain shares one result. Post-fences apply even when synchronous cancellation consumes the budget or all tasks appear closed immediately.

Do not retain one unbounded task record per successful syscall. Keep only a bounded active registry and aggregate counters, with a separately bounded uncertainty list. The eventual bound must be explicitly derived from actual store sequencing and maximum histories; exceeding it refuses new work before factory invocation and never drops existing resources. No maximum-capacity PASS is inferred from choosing a bound. Parallel writes are not introduced to optimize throughput.

### Work deadlines

Keep the original ACL5000ms and native publication15000ms limits including wrapper/startup. Existing test bodies and50s observation fences remain unchanged. Registry work deadline may only shorten a primitive's original limit. Cleanup has its own5000ms and never rehabilitates work timeout. There is no automatic whole-history scan retry, timeout increase or assertion change.

The eventual registry must account for Node filesystem calls that have no intrinsic OS cancellation deadline: a work timeout revokes future steps, but an already-issued call remains in the active set until its full task settles. If this exceeds cleanup, retain the lease and report CLEANUP_BLOCKED. Do not claim JavaScript can cancel an already-dispatched filesystem write.

Revoked mutation admission must not prevent drain-only close/finally or deferred buffer wiping. Cleanup gets only the pre-registered resource closure/settlement capability, not permission to write/sync/publish again. Do not reopen admission to finish cleanup; wait for already-submitted I/O and actual handle close, then wipe bytes no longer in use. Cleanup cannot append a new recovery journal after revocation; preserve existing intent/stage for subsequent explicit reconciliation.

## Store migration boundary — not implemented

First implement and Fake-test only the standalone registry. Keep all existing store constructors, default publication/auth helpers, persistence bytes and public methods unchanged.

Before a later store migration, choose one audited private action entry path. The action must acquire the real owner lease exactly once; scoped store internals may borrow that exact capability after identity/token checks, rather than taking a second lease. Default callers still use existing exclusive methods. No public `alreadyLocked` boolean, Fake/reentrant owner, arbitrary adapter/CLI from HTTP or optional permission bypass is allowed. Scoped stores must not escape their active capability or be reused after revocation.

Each existing read must retain descriptor identity, canonical path, link count, size, exact bytes/hash and before/after ACL checks. Each create/write/publish must retain private ACL creation, exact-stage readback, no-replace publication and post-publication physical verification. No existing checks are removed to fit performance budgets.

Node mutation sequence for a future scoped write: assert → track private Create helper with retained owner handles → actual close and original output/snapshot validation → assert → track descriptor open/identity validation/write/sync/close task, fencing between awaited steps → assert → ACL verification/readback → assert → tracked no-replace Move helper → actual close → assert → physical readback. The buffer remains owned until task settlement and is wiped only afterward; timeout must not wipe bytes still referenced by an in-flight write.

Every action entry must include its actual scans: open already scans; create/admit/append can scan before and after publication. Existing130456 per-create guard accounting is not automatically an open+create or coordinator-level bound. Current4999-pair cold-open25.643s does not pass the combined command workflow. Avoid redesigning acceptance to hide the historical50s failure.

## Required tests before any integration

- One acquisition/release on successful action; no release while ACL child, writer child or Node task remains active.
- Valid native JSON followed by nonzero/late close; factory created-then-throw; lost close; cancellation/kill failure; late actual close after a failed drain. Unknown state never authorizes release.
- Body returns while a tracked Node write promise is pending: admission closes immediately; old continuation cannot issue the next sync/publication, cleanup waits only for its actual handle-finally settlement. Timed-out write bytes remain intact until settlement.
- Node task rejects and body catches: action remains permanently unsafe and cannot schedule another task; successful drain still cannot produce operation success. Drain-only handle close remains permitted without restoring mutation admission.
- Cross-action/worker callback, retained old capability, nested action and owner/root/epoch drift rejected before any side effect. Authentication is rechecked later at the unchanged final admission boundary; registry is not an auth bypass.
- Same shared5s cleanup for multiple resources; synchronous cancellation cost included; no unknown process termination, directory deletion or PID-name matching.
- Capacity exhaustion before scheduling, bounded active resources, exact successful counters, no silent eviction of unknown resources. Healthy ACL rotation retains all required queries.
- Real isolated parent-death later: before retention, after retention/before mutation, while native writer is admitted, while Node I/O has been submitted and after completion/receipt loss. A new owner must never overlap a surviving writer; active queries and writes must be distinguished.
- New scoped guard/create and command/admit/append physical/native tests, exact-byte hash and crash/restart reconciliation after design/source/native fixture review. No real credentials, user worlds or RCON.

## Gate sequence

Design review → standalone UNWIRED registry/Fake tests → source/delta review → isolated inert native writer retention fixture design/review/run → independently reviewed scoped-store migration → bounded physical/native capacity and fresh-process crash validation → affected/frozen full regression and final review. Only then consider member API/real RCON capability work. Every arrow requires its own actual evidence; this document claims none of the later Gates.

Current blockers: publication owner-retention/whole-action drain P2, original default native guard/crash Gate, combined command-capacity50s FAIL and maximum combined resource performance NOT RUN. No LC2 final PASS, LM1/LM2 start or remote resumption follows from this design.

## Independent design review

Authorized SolHigh design/delta review P1/P2/P3=0 after two P2 contracts were clarified (Attempt1 each, no runtime error): nodeTask failure permanently revokes before delivery even when caught; early body return cannot become success after drain. Production ACL delegation cannot nest current WhitelistAclScope.run, so first implementation has no production ACL delegation. Drain-only close/finally/wipe remains available without reopening mutation admission. Publication P2 and all native/integration/capacity Gates remain open.

First implementation is deliberately narrower: `WhitelistActionResources` accounts constructor-injected Fake resource results/drain proofs and delegates action assertion/revocation to trusted callbacks. It does not acquire/release a real owner, supply AsyncLocalStorage action binding, implement Node I/O primitives, wrap native factories or integrate existing stores. Those missing responsibilities remain explicit future work, not proven by resource-accounting tests.
