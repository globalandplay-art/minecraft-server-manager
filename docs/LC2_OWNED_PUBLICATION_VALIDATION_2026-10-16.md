# LC2 owned publication component — 2026-10-16

UNWIRED component candidate: one normal real Windows publication has passed, plus Fake faults and affected regression. Final independent Sol High evidence review P1/P2/P3=0; normal component Gate accepted. LC2 member writes remain UNWIRED/IN PROGRESS; store migration, crash and maximum-capacity Gates remain open. Remote PAUSED. New work is not committed or uploaded.

## Implemented boundary

WhitelistEnvelopeAclAction.runPublication consumes the same one-shot envelope as its existing ACL-only run. Its callback receives only frozen createDirectory/publishFile methods. Both share one busy fence. Relative paths are restricted to the backend guard namespace, lowercase UUIDv4 and 00–63.bin/manifest.json; no shell, absolute path, destination or release capability is exposed. Trusted constructor test dependencies have no request/environment switch. Existing stores, authentication publication and production routes are unchanged.

The task owns a synchronous copy of at most4096 bytes until submitted I/O and descriptor finally finish. Every Node task/native factory is registered before work starts. Late open returns are registered then closed without further writes; failed/unknown open or close cannot prove drain. ACL child retirement precedes each retained native Create/Move. The exact acquired owner epoch wrapper is used, and success requires actual child close0/null, private ACL snapshots, canonical ordinary single-link files, identity/time/byte verification and no-replace Move flags8. Shared failure cleanup remains one absolute5s; no retries, deletion or copy/delete fallback. Unknown physical settlement retains the owner; a late drain never converts the failed primary into success.

Readback keeps its descriptor open across ACL-after, then rechecks handle/path identity, timestamps, ACL fingerprint and exact bytes. Same-user hostile filesystem races are detected at these boundaries, not claimed to be an atomic hostile-owner sandbox. Concrete ManagerLifetimeLock releases remain unchanged.

## Evidence

- Source review found one P2: descriptor had closed before ACL-after. Attempt1 holds it through the last physical checks, with content/identity/version mutation cases verifying a live handle, rejection, preserved target and actual close before release. Independent delta P1/P2/P3=0.
- Focused v1:48, v2:102, v3:105 and final v4:4files108 PASS/exit0,1.08s. Earlier passes are retained, not substituted for the final candidate.
- Native probe underwent independent readonly pre-run review P1/P2/P3=0, syntax check, lint/typecheck and a19-file freeze. Readonly process preflight found no matching test/probe. Exactly one fresh isolated normal run executed: `lc2-owned-publication-2d8eb714-174c-4702-ad9d-247409401ade`.
- Default real ManagerLifetimeLock plus default real ACL/native/Node I/O created the private namespace and UUID directory and published4096 synthetic bytes. Hash `1252602fa849acee588b513308777634f80524cf4d9a76c5efd20b837e4b3315`; receipt and physical readback agree, no stage remains. Envelope body settled/resources0/mutation+activity released, then Manager owner released and assertHeld rejected. No injected runner or ACL snapshots.
- Component17562ms; external foreground exit0/18297ms. The report's runnerActualClose remains EXTERNAL_VERIFICATION_REQUIRED; the separate external receipt supplies that proof. Exact fresh fixture removed after release, strict identity/layout/hash revalidation; absence verified afterward. Internal source13/13 and external frozen19/19 match. Normal actual-close enforcement is source-bound; no individual per-helper OS telemetry or crash proof is claimed.
- New affected19files392 PASS/exit0,47.06s (`lc2-owned-publication-affected-v1.log`). Lint v2/typecheck v3/build v1/diff exit0; build5.75s with existing543.14KiB chunk warning. PowerShell represents the warning on stderr as NativeCommandError text, but actual build exit is0. API tsconfig typecheck covers src; tests execute through Vitest.
- Ignored evidence: `test-results/lc2-owned-publication-frozen-v1.json`, focused/affected/static logs, the UUID report, native-v1.log, native-exit-v1.json and final-v1.json. No whole-project regression for this candidate. Historical failed native/default/capacity receipts are unchanged.

## Issue ledger

| Issue | Status / severity | Evidence and next step |
| --- | --- | --- |
| LC2-PUBLICATION-READBACK-001 | RESOLVED candidate / P2 | Source-review ACL-after handle lifetime gap; Attempt1 plus three mutation cases and independent delta0. No runtime OS error code. |
| LC2-PUBLICATION-OWNER-001 | Partially verified / P2 | Normal owner-retained native Create/write/sync/Move/readback component passed; store integration, parent-death and crash safety are NOT established. |
| LC2-CAPACITY-COMMAND-001 | Historical BLOCKED / MEDIUM | PHYSICAL_CAPACITY_OBSERVATION_DEADLINE/exit1 retained; historical exact failing step UNKNOWN. Maximum combined history still NOT RUN. |
| LC2-STORE-INTEGRATION-001 | OPEN / P2 | GuardStore/CommandStore still use their existing exclusive/default publication paths. No nested lock/Fake-owner integration is allowed. |

## Next

First accept the source-bound evidence independently. Then migrate GuardStore's internal execution strategy under its own single action, preserving scans, descriptors, ACL checks, hashes, known-file memory and capacity/conflict semantics. Read/list/directory inspection must be tracked and fenced under that same action; publication success alone does not authorize an untracked store callback. Default store behavior stays unchanged until the owned path is separately proven. CommandStore follows GuardStore proof, then fresh-process crash/capacity and full frozen regression before any member API/RCON writes. No real credentials, user world/server, network or system configuration was touched.
