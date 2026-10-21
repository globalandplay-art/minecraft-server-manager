# M2 first slice: existing trusted Paper/Fabric lifecycle after hot registration

## Scope

M1 instant-loading/isolation slice completed first. This M2 slice reuses existing
P5.5 Paper/Fabric trusted lifecycle, execution identity/binding, registered Java,
EULA checks, OperationService, HTTP API, idempotency and per-instance admission.
No second supervisor, new transaction store or remote mechanism was introduced.
Product code is the reviewed M1 candidate; M2 adds integration tests only.

The target is a newly registered Paper26.3 or Fabric26.2 fixture alongside an
existing Vanilla26.3 fixture. Detection is deterministic and Java/Minecraft is
never executed. Fabric uses the existing synthetic bound launcher/version/library
fixture, with real filesystem identity/hash and launch-binding validation.
These versions describe fixture coverage, not a new real-version certification.

## Verification

`apps/api/test/instance-activation.test.ts` adds seven M2 cases:

- Paper/Fabric: POST start -> operation succeeded/running managed; identical key
  returns the same operation and exactly one start; explicit restart invokes only
  target stop/start; explicit stop ends stopped/none. Original instance never
  starts, stops or closes its observer.
- Each loader: replaced launch JAR never reaches runtime.start.
- Each loader: EULA withdrawal never reaches runtime.start.
- Fabric changed bound library: no start, exact interrupted/RECOVERY_REQUIRED,
  subsequent start409; other instance recoveryRequired remains false.

Initial `m2-hot-lifecycle-v1.log`:16PASS/2FAIL, exit1. Tests incorrectly expected
ordinary failed for malformed Fabric JAR/library. Existing capture binding throws
a non-DomainError; OperationService conservatively preserves recovery for such
errors after entering its execution stage. The test now asserts the exact
interrupted state/code and continued409, rather than accepting arbitrary states.
No product error/recovery semantics, assertions of no execution or timeout were
weakened. Fixture/expectation correction Attempt1; original evidence retained.

Affected `m2-hot-lifecycle-v2.log`: **67PASS/4files**, exit0 (activation18,
lifecycle admission, runtime and Fabric binding). A requested config-file filter
did not correspond to an existing file; it is not counted as executed. Correct
`local-config-lifecycle-p55.test.ts` then ran separately:
**14PASS/1file**, exit0, `m2-existing-loader-config.log`.

Independent GPT-6.1 Sol High read-only M2 integration review: **P1=0/P2=0/P3=0**.
Reviewer did not run tests or Java; execution evidence is recorded above.
Final root lint/typecheck and `git diff --check`: **PASS, exit0**, recorded in
`m2-hot-lint.log`, `m2-hot-typecheck.log`, `m1-m2-diff-check.log`. The production build
from the final M1 product candidate remains valid: subsequent changes are tests
and documentation only. Full Web221, contracts25 and browser3 remain unchanged.

## Status and next slice

**M2 first lifecycle integration slice: verified; full M2 IN PROGRESS.**
No real new Paper/Fabric start or simultaneous real multi-instance/RCON ownership
claim. Historical P5.5 real PASS evidence is preserved, not reused as a fresh run.
Actual port conflicts, OS process/listener ownership and multi-instance RCON
attribution require their own validation before declaring the whole M2 complete.
Forge/NeoForge argument-file startup is not implemented/authorized by this slice.

Next: bounded integration of supported launch descriptors and multi-instance
port/process/RCON checks, then appropriately authorized real lifecycle evidence.
Do not turn unknown loader files into arbitrary scripts or JVM arguments.
Keep existing local auth/Origin/instance guards and uncertainty/recovery behavior.

No real Minecraft, network/system changes, commit, push or PR. P7 STOPPED.
Old CommandStore tests and preserved uncertain fixtures were not run or cleaned.
The repository's historical full API2510PASS/12FAIL remains unresolved; this
affected verification does not manufacture repository-wide green.
