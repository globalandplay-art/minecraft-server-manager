# Protected generation startup classification (2026-10-29)

## Problem and minimal change

The active-state initializer deliberately returns recovery for a known protected
pending-generation slot. The app previously assigned every returned cause to
generic external, making even the dedicated read-only generation inspector
permanently unavailable after restart. Unknown failures must remain external;
the solution is classification before assignment, never removal of external.

OperationService retains a private strict clone of its completed initialization
scan. Entry to initialization and any failure clear the scan and typed slot
cache. Synchronous requireStartupWorldRecovery checks a unique committed14,
matching original parent/execution receipts, a closed generation cause set,
and the exact eight-field descriptor bound to server/name/legacy slot ID and
four SHA-256 values. It adds generation-slot:<parent> without removing any gate.
Unknown/missing/throwing lookup, unrelated issue/cause, existing external or
missing/failed initialization cache retains/adds external.

The inspection lease admits that reserved cause only with the exact cached
parent/execution descriptor. It captures the cache and detects changes, passes
a clone into the action, and inspectPublished passes it into full current-state
verification. Slot/properties checksum AND file identity must still match. No
descriptor-free fallback is allowed for a reserved slot cause.

app startup uses its existing scan/initialization sequence and the optional typed
descriptor getter. No new global startup scan phase or native process is added;
the dedicated metadata validator performs its existing scoped journal reads.
Existing injected stores without the getter retain their external behavior.
No active snapshot, slot, receipt, startup permission or ready marker is created.
All world-list mutation capabilities remain closed. No new HTTP endpoint exists.

## Validation checkpoint

Initial focused startup report:65PASS/1FAIL, retained. The actual app still had
external from legacy import audit, which rejects every generation catalog.
Independent review classified this remaining integration conflict P2. The minimal
compatibility branch accepts only schema6 with no target import journal/entry
and complete published metadata dependencies, under the same library exclusive
lock, matching catalog revision/file identity plus birth checksum/identity.
It means there is no ordinary import work; it is not physical verification.
Schema4/5, missing/bad/mixed evidence still rejects; existing external is never
removed. Both cached-store and genuinely fresh active-state app reconstructions
are tested. The former preserves the original two-item assertion; the latter
has no trusted snapshot and remains an empty inspection list. Both retain
closed actions and require full leased physical proof with typed descriptor.

API typecheck and scoped lint exit0. Focused startup report is running; final
independent Sol High review and affected-module evidence remain PENDING until
recorded below. Tests cover valid immutable descriptor, unknown/malformed/throwing
lookup, failed initialization cache, stale file identity, existing external,
and real Fastify reconstruction without enabling world actions.

Previous inspection manifest/292PASS and independent0/0/0 remain historical
evidence for their exact candidate. Current source changes need this unit's
fresh evidence; they do not retroactively change the earlier accepted scope.

## Additional retained validation history

startup-reviewed report:226PASS/1FAIL. This run still applied the cached-store
two-item expectation to a genuinely fresh protected state store. It correctly
returned an empty inspection list because no trusted snapshot was published.
The test now covers both variants: original cached two-item assertion retained,
fresh empty/no-snapshot asserted, all actions closed, both require full proof.

Independent review also identified that the generic inspection receipt reader
allows viewing failed execution evidence. The audit compatibility exception now
separately requires succeeded/interrupted, without altering that older reader.
A run already started before this correction is retained as nonfinal; corrected
candidate validation and independent evidence readback are required next.

That pre-correction startup-final report has231PASS/1FAIL: execution46PASS,
ordinary library import114PASS, generation service71PASS/1FAIL (failed execution
receipt wrongly accepted by the new exception). The report is not renamed to
PASS. Stable-source focused72-case validation is separate. The last product
delta adds only the new exception's terminal-state predicate; unchanged ordinary
import/execution paths are not repeatedly rerun. API build/typecheck/lint/diff0.

## Stable validation

startup-stable report:72PASS/0FAIL/0pending on the final source, including both
Fastify reconstruction variants and all new compatibility negatives. Separately
reused unaffected execution46PASS and ordinary import114PASS; do not describe
this combination as a fresh232-case run. Independent Sol High accepted the
evidence scope and found P1/P2/P3=0/0/0 in source review. API build/typecheck,
scoped ESLint and diff check exit0. Freeze startup-candidate contains8 files:
six production/test files, the stable report and retained231/1 report. Final
independent hash readback PENDING at this checkpoint.

Final independent GPT-6.1 Sol High readback completed:8/8hashes match HEAD
bd0f9324f2406feb9e1eeebe5303e4445bf4d660, diff0, fresh72PASS/0FAIL/0pending,
unaffected160 reused separately, original65/1,226/1,231/1 retained. P1/P2/P3=0/0/0;
limited ACCEPT for startup classification and schema6 no-import-work branch.
This supersedes the prior pending checkpoint only for this scope. Fresh Fastify
with Fake runtime is integration evidence, not real Minecraft or Java acceptance.

## Delivery status (unchanged, after validation)

Classification only. Pending/active CAS, partial receipt settlement and final
readiness remain unimplemented. Future legitimate game saves need a reviewed
policy; exact birth bytes are not a permanent post-save world identity rule.
No new real Minecraft/browser acceptance; V2 IN PROGRESS; P7 STOPPED.
No commit/push/merge/PR or Windows/system changes.
