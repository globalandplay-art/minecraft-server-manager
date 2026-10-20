# LC2 maximum-history continuation — 2026-10-18

Scope: independent history capacity work following the accepted empty-history
MAX64_CREATE_ONLY component. LC2 member mutations remain UNWIRED and remote
access PAUSED. No original world, real server, RCON, real credential, system
configuration or network operation. No Git publication.

## Product candidate

`WhitelistGuardStore.#scan` derives at most1000 directory prefixes once per
scan. The exact original `file.startsWith(prefix)` containment predicate,
separator boundary, current physical scan, ACL checks, hashes, identities,
final namespace listing and known-file verification remain. No cross-action
cache, retention, deadline or capacity change. This removes repeated path
construction from the nested known-file/history loop; it does not identify
the exact await behind the historical MAX64 timeout.

## Synthetic evidence and preserved failures

- v1: new1000-history case exceeded the original5000ms unit budget;
  other5 selected history cases PASS. Raw `lc2-history-focused-v1.log` retained.
- Fixture-only metadata mock recording reduction did not solve it: v2 also
  timed out. v3 after the product prefix hoist passed6 selected cases/4.44s.
- Full focused v4:255PASS/1FAIL; v5:256PASS/1FAIL. The same heavy case timed
  out contextually despite simpler synthetic counters. These are not hidden
  or replaced by the v3 selected PASS. Exact contextual slowdown cause UNKNOWN.
- Move the six complete cases to their own test file using normal existing
  Vitest file isolation; keep5000ms, maxWorkers2 and every business assertion.
  Extract the original shared fixture body unchanged. v6 caught a missing
  shared ACL snapshot import (two `WHITELIST_GUARD_UNSAFE` fixture failures).
  Corrected export/import; preserve v6 and lint-v1 unused-import/type failures.
- v7: **257PASS/4files**,11.19s wall time; no unit timeout change. Includes
 1000 histories with final64 chunks,1001 rejection before reads/publication,
 early/middle/last corruption, exact fresh scan receipts and original tests.
 This is synthetic logical evidence, not Windows capacity performance.

Test-only seeder creates empty private entries through the original native
Create implementation:1 namespace +1000 directories +2000 files. Fixed groups
of at most32 histories/96 entries; no overwrite/move/delete. Its setup ACK is
not an ACL or protection receipt. Copies IDs before validating (rejects sparse
arrays/accessor-invalid copied values). Maximum32-ID command test uses the
real owner-retention wrapper with synthetic proof, plus overlength refusal.
Actual wrapped command is independently bounded before native dispatch.

## Native protocol and scope

`tests/acceptance/lc2-history-open-native.mjs` requires explicit isolated
confirmation and Windows. Fresh UUID synthetic root; original lifetime owner.
Setup has a separate150s administrative budget, unchanged15s per native
writer and exact fsynced Node content. Complete physical inventory precedes
the measured cold open. Store action remains its original absolute50s;
outer55s observes only the existing shared5s drain, never extends success.

Test-only static interception captures the real unchanged executor, forwards
identical arguments/this, and restores the method immediately before await.
It substitutes no adapter, I/O, ACL, run function or deadline. Failed opens
can therefore expose actual drain evidence without inventing a Store result.

Owner release requires settled setup I/O, every setup helper actually closed,
zero open handles, and a released/body-settled/zero-resource action. Unknown
state retains the exact owned Node and fixture; no other process is touched.
Fixtures are deliberately retained even on PASS. No recursive cleanup.
Actual runner exit and source fingerprints require external verification.

The first native Gate is **N1000_C1_PHYSICAL_OPEN_ONLY**. It does not prove
1000x64 chunks, one million retained member objects,999-history-plus-new64
creation, CommandStore/default composition, active-I/O crash or wholeLC2.

Source-bound cost of an unmodified scan, for chunk counts C_i:

- ACL queries Q=4+sum(6+2*ceil(C_i/6)).
- ACL targets T=4+sum(14+4*ceil(C_i/6)+2*C_i).
- Publication work resources W=6+sum(8+3*ceil(C_i/6)), plus ACL sessions.
-1000xC1:8004 queries/20004 targets/11006 work resources, at least251 sessions.
-1000xC64:28004 queries/186004 targets/41006 work resources, at least876 sessions.

These are logical bounds, not measured durations or native PASS.

## Review, frozen candidate and remaining Gate

Independent Sol High source/delta review P1/P2/P3=0. Closed source findings:
seed copied-ID validation, complete wrapped maximum command test, and
preservation of the pre-acquisition root identity baseline. Reviewer verified
all original test bodies and all relocated assertions preserved.

Frozen candidate: `test-results/lc2-history-frozen-v1.json`,40 source/test/probe
files. New23-file affected regression625PASS/46.75s. lint-v2/typecheck-v2/build-v1
actual exits0; production build4.76s retains existing543.14KiB chunk warning.
Syntax/diff check0; frozen40/40 verified. Actual native outcome remains NOT RUN
until final pre-run signoff; wholeLC2 IN PROGRESS. Historical BLOCKED
reports/fixtures remain unchanged. No current full-project regression claim.

## Issue ledger

| Issue | Status | Evidence / next action |
| --- | --- | --- |
| LC2-HISTORY-NATIVE-001 | HIGH / OPEN | Native1000-history50s feasibility unmeasured; run only reviewed frozen candidate. |
| LC2-HISTORY-UNIT-001 | MEDIUM / candidate verified | Original5000ms contextual timeout logs v1/v2/v4/v5 preserved. Relocated intact cases v7PASS; contextual cause UNKNOWN, no native inference. |
| LC2-HISTORY-PREFIX-001 | MEDIUM / candidate verified | Repeated identical path construction confirmed in source; product Attempt1 hoists only bounded prefixes. Fresh affected/static/native gates pending. |
| LC2-HISTORY-SEED-001 | LOW / resolved | Copy-before-validation plus sparse/accessor tests; source-review P3 closed. |
| LC2-HISTORY-SEED-002 | LOW / resolved | Actual owner-wrapped32-ID bound plus overlength test; source-review P3 closed. |
| LC2-HISTORY-FIXTURE-001 | LOW / resolved | Missing extracted snapshot export/import; v6FAIL preserved, v7PASS. |
| LC2-HISTORY-LINT-001 | LOW / resolved | Unused fixture/type imports after extraction, lint-v1 exit1 preserved; exact cleanup verified lint-v2 exit0. |

## First native setup failure and one-line fixture repair

Run `lc2-history-open-a129f676-da38-4cab-a70c-c93c334d591d` is BLOCKED during
seed-empty-private-entries, BEFORE cold open. Namespace writer actual0/null;
second writer `WHITELIST_WRITER_UNSAFE`, actualnull/SIGTERM. Setup handles0,
active steps0, owner/leases released, fixture intentionally retained, original
inputs18/18 unchanged; separate frozen manifest40/40 matches. No product
history timing was measured. Read-only postreceipt confirms namespace entries0
and owned runner absent. Its foreground actual exit code remains UNKNOWN:
PowerShell Process.ExitCode returnednull. Wrapper exit0 is NOT native PASS.

Expression-only read-only reproduction `lc2-history-json-repro-v1.log`:
exit1/null, `PositionalParameterNotFound,Microsoft.PowerShell.Commands.ConvertFromJsonCommand`.
The unparenthesized nativePathData expression was parsed as command arguments.
This reproduces a fixture defect consistent with the failed setup; the
original writer's stderr was not retained and its exact text remains UNKNOWN.
Fixture Fix Attempt1 adds explicit `-InputObject (...)`. New native PowerShell
unit checks all32 decoded IDs/order:16 seed testsPASS/2.24s. No filesystem
Create/owner statement runs in that expression test.

An unexecuted custom supervisor candidate had evidence-reservation/flush
review findings; it was removed in favor of direct foreground invocation.
The new foreground command exclusively reserves its external receipt before
dispatch, resets LASTEXITCODE, records the actual numeric native exit, and
flushes that receipt without overwriting history. A retained Node keeps its
owned tool session; no automatic kill/retry.

Frozen v3 contains40 files, superseding unexecuted v2's41-file supervisor
candidate. lint-v3/typecheck-v3/syntax/diff0. Current product is unchanged
from the prior625 affected/build PASS; fresh affected validation of the
corrected fixture is in progress. A new native run requires this validation
and independent final delta signoff. Historical first report stays BLOCKED.

## Corrected setup: actual native history-capacity failure

Run `lc2-history-open-bca9b9d1-70ac-40d1-984d-e07e548e63b3` completed all
1000 one-chunk synthetic histories,33 setup writers actual0/null and the full
pre-open inventory. Cold open began58562.2098ms after component start, then
failed at50009.0221ms with `WHITELIST_GUARD_UNSAFE`; captured real action has
primary `deadline`, released activity/mutation, bodySettled=true/resource0.
Capture was restored, activeSteps0/openHandles0/owner released, source18/18
unchanged. Native result stays BLOCKED; no later scan/create was attempted.

Direct foreground external receipt
`lc2-history-external-2e788495-48f0-4d68-97f8-e5d11adc4565.json` confirms
actual native exit1/110689ms (not a null Process.ExitCode inference). All40
frozen hashes remain unchanged. Post-read receipt `lc2-history-post-v2.json`
confirms1000 histories/2000 exact files unchanged,3140.64ms, no deletion;
inventory SHA256 `cef3ea7030a14144bd0269fc357ec7cb9e6bbc6b1a3ca22225776bc69ae8b231`.
The known runner3256 is absent. An initial post-reader hit a UTF8 BOM while
parsing the PowerShell-written frozen manifest; only the diagnostic reader
was corrected. That diagnostic issue did not alter fixture or report.

Fresh corrected fixture validation:23files626PASS/49.90s,
lint-v3/typecheck-v3/syntax/diff0. Build-v1 remains applicable to unchanged
product source. Final independent pre-run review P1/P2/P3=0; independent
failure evidence review pending. No full-project or wholeLC2 PASS.

### Current root-cause boundary

CONFIRMED: current native cold open over1000 small histories cannot complete
within the original50s on this run. It fails closed and releases confirmed
resources. Source requires8004 ACL queries and at least251 sessions; observed
first-query/steady-query/session-close/Node-I/O cost split is NOT recorded.
Their individual contribution, sole bottleneck and host-vs-design attribution
remain UNKNOWN. The earlier setup expression defect is separate and resolved.
No performance repair has yet been attempted for this native history deadline.
Next: independent read-only evidence review, then only justified bounded
observations before selecting a performance design. No unchanged native retry,
time/capacity increase, skipped ACL/identity/hash checks or automatic cleanup.

| Additional issue | Status | Evidence / next action |
| --- | --- | --- |
| LC2-HISTORY-NATIVE-001 | HIGH / BLOCKED | bca9b9d1 cold-open50009ms/deadline/WHITELIST_GUARD_UNSAFE/actualexit1. Retain1000-history fixture; evidence review and scoped cost attribution before product fix. |
| LC2-HISTORY-SEED-003 | LOW / resolved | a129f676 setupBLOCKED preserved; expression-only PositionalParameterNotFound reproduced; one-line Fix1 verified32-ID native decode+626affected+successful1000-history preparation. |
| LC2-HISTORY-EXIT-001 | LOW / resolved for new runs | First actual exit remainsUNKNOWN. New direct foreground receipt records numeric actualexit1, exclusive evidence before dispatch. |
| LC2-HISTORY-POST-001 | LOW / resolved | Diagnostic JSON reader encountered leadingBOM; BOM-only reader fix, full2000-file postverificationPASS; no product/fixture change. |
