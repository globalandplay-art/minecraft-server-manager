# LC2 MAX64 create: preserved native failure

Current narrow maximum-create Gate is covered by subsequent PASS run `lc2-wide-capacity-6065f364-947f-486c-a519-2a9a11c5c1f8` (39721.3965ms product create, actualexit0/44449ms), with new236focused/604affected/static and final independent SolHigh0. See `LC2_STORED_BATCH_VALIDATION_2026-10-17.md`. The original failed run and fixture described below remain unchanged; its precise exhausted await remains UNKNOWN. This subsequent result does not close history/combined/default/crash/wholeLC2 Gates. The following BLOCKED status refers to the preserved earlier run.

Issue `LC2-MAX64-DEADLINE-001`, HIGH / BLOCKED. Run `lc2-wide-capacity-1596158c-21d3-44f2-8fcf-f647afb2e683` remains BLOCKED. Exactly one run; no retry or product repair after it. Product50s deadline unchanged. The new explicit probe's95s administrative budget is separate from the old end-to-end50s Gate and does not extend product work.

## Direct evidence

`test-results/lc2-wide-capacity-1596158c-21d3-44f2-8fcf-f647afb2e683.json`, `lc2-wide-capacity-native-v1.log`, `lc2-wide-capacity-external-v1.json`, and `lc2-wide-capacity-readonly-v1.json` are private ignored evidence. Frozen35/35 and native-source19/19 still match after execution. Source-level independent pre-run review P1/P2/P3=0; new harness syntax/lint/diff exit0. Current synthetic candidate retains188focused/556affected/static/build PASS; these results do not override the native failure.

```text
result: BLOCKED
primary: NATIVE_GUARD_CREATE_FAILED
operationErrorCode: WHITELIST_GUARD_UNSAFE
createElapsedMs: 50030.2962
action primary: deadline
action phase: released
mutation: released
activity: released
bodySettled: true
resourceCount: 0
ownerRelease: released
ownerAssertRejected: true
activeSteps: 0
actual foreground exit code: 1
externalElapsedMs: 54845
```

Setup: owner acquire at10ms, Store open at2618ms, create at2629ms. Failure observed before owner release at52660ms. Component report elapsed54091ms; actual foreground completed at54845ms. These are monotonic observations, not inferred helper timings.

Known fresh fixture retained, not deleted:
`C:\Users\29104\AppData\Local\Temp\mcsm-wide-capacity-1596158c-21d3-44f2-8fcf-f647afb2e683\manager`.
Readonly inspection found exactly one Guard directory, all64 final4096-byte chunks and879-byte `manifest.json`, no stage files. Their hashes are saved. Presence of the manifest proves publication reached it; it does NOT prove final verification or successful receipt delivery. `receipt=null`, `physicalVerified=false` in the original run; those fields remain unchanged. The separate readonly after-run inspection is not substituted for the failed in-action verification.

All action resources settled and owner release positively completed; no retained runner was needed. Post-run project process inventory empty. No process killed, no fixture cleanup, no original world/server/credentials/network/system access. Original `sourceUnchanged=false` means the failure skipped that probe phase, NOT that a change was detected; separate readonly19/19 post-run hashes prove the candidate source stayed unchanged.

## Source bounds and unresolved timing

`whitelist-guard-store.ts` `#ownedExclusive` supplies one absolute50s action. `create` publishes each group then retains original per-file `#read`; manifest publication is last. `#verify` separately reads manifest and64 chunks using original `#read`. `whitelist-owned-publication.ts` `#readFile` brackets each held descriptor with before/after ACL queries and physical/file version checks. `whitelist-action-envelope.ts` records the actual `deadline` primary and drains before releasing.

CONFIRMED: the maximum create reached the unchanged action deadline; it published the manifest but did not return a receipt. UNKNOWN: which exact await exhausted the deadline, individual ACL/helper/Node-I/O timings, and contribution of host load. No claim of ACL permission failure, Windows defect, native helper failure, or exact final-verification substep is justified. Repeated Store per-file readback is a candidate cost visible in source, not a measured sole cause.

Next minimum direction: independently review a wide-only bounded stored-read cohort API, retaining every before/after ACL, root/namespace/directory identity, metadata/time, held-descriptor, exact-byte and known-fingerprint check. It must replace batching granularity, not omit verification, cache physical trust, reset the50s action or change limits. Preserve original single-file/default Store paths. Require deterministic drift/late-I/O/close failure tests, new frozen affected/static/build and independent review before a fresh native capacity candidate. History capacity, CommandStore composition, crash/death and wholeLC2 remain independent open Gates.

No default migration/member writes; LC2 IN PROGRESS, remote PAUSED. No commit/push/PR. Failed fixture and historical failures retained.

## Final independent evidence review

SolHigh confirmed frozen35/35 and run-source19/19, actual foregroundexit1/54845ms, original actiondeadline and successful drain/ownerrelease. BLOCKED remains. The reviewer's fresh direct fixture scan returned `EPERM`; the65-file physical facts therefore rely on the separately saved successful main-runner readonly inspection, not an independent filesystem rescan. No retry/escalation or product conclusion followed that reviewer permission error. Exact timeout await and sole cost source remain UNKNOWN. Narrow next stored-read design approved with no new P1/P2/P3; see `LC2_WIDE_STORED_READ_NEXT_2026-10-17.md`. No post-failure product repair or native rerun performed.
