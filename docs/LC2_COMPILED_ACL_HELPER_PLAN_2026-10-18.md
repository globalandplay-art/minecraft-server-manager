# LC2 next repair: fixed compiled ACL helper — design candidate

Source-only framework. No executable has been built, published or run. No
default authentication/verifier/Store/RCON/API change. LC2 member writes remain
UNWIRED, remote PAUSED. This document is not a safety Gate PASS or performance
claim. Read current PROGRESS and the history/timing evidence first.

## Why this direction

The unchanged1000-small-history reader needs8004 ACL queries and at least251
sessions. One bounded observation completed30x32 queries and one rejected
first query within50017.6405ms. First-call boundaries account for43285.6721ms
versus2694.0943ms for930 subsequent calls. This confirms repeated first-call
work dominates that sample; it does not isolate pure PowerShell startup,
owner bootstrap, Add-Type, provider initialization or IPC.

Prefer evaluating a fixed precompiled owner-retaining ACL executable over
increasing session/query limits or removing checks. Merely precompiling one
Add-Type component may leave other first-call costs dominant. Neither option
has a predicted PASS duration. Maximum64-chunk histories remain unmeasured.

## Invariants

- Keep32-query healthy rotation, existing64-query session cap, at most8
  targets/frame, existing byte/frame/output limits, original5s request
  deadline,20s healthy rotation,40s child lifetime,50s action and shared5s
  drain. No timer resets or failure retry/fallback.
- Same user/SYSTEM/Administrators ACL policy, protected descriptors, SID
  continuity, complete ACL snapshots and before/after physical checks.
- Same actual owner epoch and opaque kernel lock retention. Never close
  retained handles early; actual OS child close remains required.
- No prewarming outside admission, global child pool, cached ACL answers,
  skipped history, automatic deletion or source-overwriting optimization.
- Failed/corrupt/missing helper closes only whitelist writes. Existing local
  authentication and server read/lifecycle interfaces remain unchanged.

## Artifact trust and build boundary

Use one fixed Windows-only console program, with no network, shell, general
script executor, arbitrary command or target-write operation. Source and
dependencies are fixed and versioned. Only trusted platform framework/system
dependencies; reject unexpected sidecars/configuration and search-path loads.

An explicit isolated build step may invoke a verified absolute platform
compiler with argument arrays, bounded time/output and fixed source. The
observed presence of csc.exe is not its provenance verification. Build output
has private ACLs, exact bounded bytes/hash, compiler/source/target identity and
a versioned artifact manifest. A locally generated hash alone is not trust.
No compiler installation/download or system change. No runtime compile in an
authentication request or silent feature-enable/startup path.

Generated binaries and build evidence stay private/ignored. Production
packaging and artifact provenance are separate Gates, not solved by an
arbitrary helper pathname or environment override.

## Executable identity and TOCTOU — blocking design condition

Hash-then-spawn-by-path is insufficient. Node fs.open's normal Windows sharing
does not provide the needed deny-write/deny-delete exclusion. Before spawn:

1. Bind canonical trusted artifact root, directory/file identities, private
   ACLs, link/reparse exclusions, source/manifest revision and expected hash.
2. Hold native directory handles excluding deletion/replacement and native
   artifact handles excluding write/delete across validation and process
   creation. Revalidate the full identity/ACL/hash through the pinned objects.
3. Confirm the child corresponds to that exact admitted executable and native
   process creation identity. Retain pins through actual child closure.
4. Parent death or an uncertain spawn must not release exclusion prematurely.
   The child must retain required artifact/owner protection before any query.

A single action-scoped trusted native pin bootstrap may be viable, avoiding
per-session PowerShell/Add-Type. Its precise handle duplication, close order,
response-loss state, owner death and resource registration require separate
design signoff. Do not implement a pathname-only shortcut if native image
pinning cannot be proved. Same-user administrator tampering remains an
explicit platform boundary, not a claim of complete local hostile-user safety.

## Owner bootstrap and protocol

Do not recover raw proof by parsing generated PowerShell text. Design an
internal, unforgeable, epoch-bound constructor capability for the fixed
verified artifact. No HTTP/config/env input can provide a path, proof,
bootstrap command, executable or session factory.

The helper verifies parent process creation identity, owner root/kernel
handles, file/directory identity and native private ACLs before consuming the
first query. Wrong/dead/replaced owner rejects without a query. Query
semantics must match the current framed protocol, integer/order/target/bounds
and fixed response schema. No paths/proof/ACL snapshots in public diagnostics.

Unknown bootstrap outcome or missed response is not permission to repeat
handle duplication or launch another child. Register work/resources before
native dispatch and preserve existing8-active/262144-total accounting. New
pin/child resources consume that budget; do not expand it to fit the design.

## Implementation and completion order

| Gate | Concrete work | Completion evidence |
| --- | --- | --- |
| D1 | Resolve artifact pin/bootstrap/parent-death design | Independent SolHigh closes every P1/P2; explicit close/uncertainty state table. |
| D2 | Fixed source, protocol and trusted artifact descriptors | Exact baseline snapshot parity and all malformed input/output/size/identity tests; no execution. |
| D3 | Isolated build + original owner-retention semantics | Verified compiler/artifact/source identities, no-replace publication, no secrets; independent review. |
| D4 | Dedicated UNWIRED session/controller composition | Same promises/deadlines/rotation and resource rules; collision/drift/crash/response-loss/Fake failures; no default wiring. |
| D5 | One fresh native small-profile probe | Exact ACL/snapshot/identity/close parity against current rules; source fingerprints and retained diagnostics. |
| D6 | Real interrupted child/owner and pin lifetime | New owner refused until all actual child/pin resources close; uncertain state retained. |
| D7 | Native capacity | Separate1000-small cold open,999-history+new64,1000x64 and maximum-member memory cases under original budgets. |
| D8 | Composition and final integration | CommandStore/recovery/default migration, member API/UI only after all prerequisites; fresh full regression/browser/review and separately authorized real server acceptance. |

Do not implement all Gates in parallel or report a compiled helper component
as LC2 completion. Main transaction/auth/kernel ownership stays one Sol
writer. Mechanical test/document work may be delegated only under current
authorization. Independent review remains Sol High, no Astra.

## Immediate next action

2026-10-19 update: D1 source-design received independent Sol High signoff after
closing two P2 and one P3 design findings. See
[the precise topology and interruption table](LC2_COMPILED_HELPER_D1_2026-10-19.md)
and [review record](LC2_COMPILED_HELPER_D1_REVIEW_2026-10-19.md).
Next is D2 source-only protocol, bounded handle inventory and typed closure proof.
Artifact/compiler/dependency trust, actual pinning and native capacity remain
unimplemented/unverified. No executable build/run is authorized by D1 signoff.
The original next-action paragraph below is retained as the prior checkpoint.

Finish D1 with an exact native handle pin/owner-bootstrap design and review.
Existing generic owner wrapper API does not by itself solve executable-image
TOCTOU. Until D1 is closed, do not build/run a new executable, change the
current transport, retry the capacity run or open whitelist member writes.
Preserve both native BLOCKED runs and the successful diagnostic observation.
