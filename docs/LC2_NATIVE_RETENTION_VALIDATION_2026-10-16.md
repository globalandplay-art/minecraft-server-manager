# LC2 native owner-retention primitive — 2026-10-16

## Current conclusion

The limited retention-exclusion invariant is now validated: after the original owner process dies, an independently surviving, already admitted helper retains the exclusive native handles until its actual exit. Independent GPT-6.1 Sol High final source/evidence review: P1/P2/P3=0 within this primitive scope. Frozen8/8 independently matched.

This does not validate production transport, a blocked Get-Acl call, default guard/crash integration, maximum physical history, or the entire LC2 feature. Member writes remain UNWIRED, default native Gate BLOCKED, LC2 IN PROGRESS, remote Phase7 PAUSED. No real Minecraft/RCON, user-world, credential, network or system repair operation was performed.

## Isolation and test design

- The test controller owns two ordinary sibling ChildProcess objects: an isolated owner Node and a read-only PowerShell helper. It does not request detached execution, Job breakaway, elevation or a production spawn change.
- The owner acquires the existing native ManagerLifetimeLock, holds the same mutation lease, creates one new private empty test file, and validates its ACL using the existing SID-frozen WindowsPrivateAclVerifier. A one-use wrapped fixed script passes through private test IPC only, bounded11000 characters. Native handles, script, paths and ACL snapshots never enter public diagnostic payloads.
- The original wrapper validates and duplicates the actual owner handles. The helper's first real Get-Acl result must match the canonical fingerprint produced by that verifier. Only fixed bounded metadata is emitted; any stderr, invalid UTF8, extra/unknown/reordered event or output over4096 bytes fails.
- The second fixed request reaches `accepted-before-inspection`: accepted with retained handles, before its second actual Get-Acl. It is not described as a blocked Get-Acl call. Fixed stdin gates reject unknown input/EOF and have a finite12s test-only wait.
- After killing only the exact owned owner object and confirming its actual close, a fresh contender must report BUSY while the still-owned helper is live both before and after. RELEASE then permits the second real Get-Acl and fingerprint verification. Helper actual close0/null is required before a new contender can acquire and release the owner lock.
- Existing50s work/5s shared cleanup/60s native test limits remain. The first helper bootstrap observation is bounded5s. This is a retention primitive experiment, not evidence that a production pending query may exceed its original5000ms deadline.
- Unknown cleanup preserves the directory and reports CLEANUP_BLOCKED. Failed fixture directories are retained. There are no metadata-PID kills or generic process cleanup.

## Fresh evidence

PASS run: `lc2-native-sibling-retention-ad447e9a-dc31-43a5-ab1d-ad60dc3696ae`.

- One native case PASS, exit0; body24.38s, suite24.76s.
- Source manifest8/8 matched before and after execution; independently rehashed.
- The passing reporter suppresses test console metadata. All ordering/health claims above are supported by frozen-source strict assertions plus the PASS result; no unrecorded PID or per-step timing is invented.
- Post-run read-only process inventory found no matching test/helper process. Successful fixture cleanup was part of the test; the two failed roots below remain retained.
- Affected regression `lc2-sibling-affected-e6e8803a-0e9b-4957-ba6f-b4af5f6e805d`:11files213PASS/exit0,13.31s. Full repository lint and typecheck exit0. No new full-project regression/build or default native Gate PASS is claimed from this test-only change.

Private logs, manifests and result summaries are preserved under ignored `test-results/`; they are not Git uploads.

## Issue ledger and preserved failures

| Issue | Severity/status | Evidence, correction and verification |
| --- | --- | --- |
| LC2-SCOPE-ACTIVE-DEATH-001 | HIGH / limited primitive RESOLVED | Successful native sibling case proves surviving accepted helper exclusion after owner death. Previous default active-parent and idle handoff evidence remain complementary. Production/default guard/crash Gates are not closed by this result. |
| LC2-NATIVE-CUMULATIVE-001 | HIGH / BLOCKED | Original default guard exceeds50s due cumulative native invocations. Scoped mechanism remains UNWIRED; no default-store fix is claimed. Historical logs unchanged. |
| LC2-SIBLING-CLEANUP-001 | MEDIUM / RESOLVED before native run | Review P2: directory removal was only checked after awaiting. Added a race bounded by the existing cleanup deadline plus post-fence, no reset. Attempt1; no runtime error code. Delta review0. |
| LC2-SIBLING-SANITIZATION-001 | LOW / RESOLVED before native run | Review P3: preparation filesystem exceptions could print raw details. Added fixed-code preparation/main failure boundaries; no raw cause/stack or script output. Attempt1; no runtime error code. Delta review0. |
| LC2-SIBLING-PATH-001 | MEDIUM / RESOLVED fixture | Run `7eb50d65-c0ab-4370-a8b0-b3bfae3c63f4`:FAIL/exit1,300ms, `RETENTION_OWNER_PREPARATION`, frozen8/8; root `mcsm-sibling-retention-PLmDUy` retained. Root-relative `test/fixtures/...` files did not exist when the runner used repository cwd; actual files were under apps/api. Attempt1 changed both owner/contender paths to import.meta.url-relative file URLs. Next run reached ownerPrepared/helper creation, confirming this boundary fixed. Historical exact Node stderr was not captured and remains UNKNOWN. |
| LC2-SIBLING-ARGUMENT-001 | MEDIUM / RESOLVED fixture | Run `bb4f2e67-37bf-4ad1-8e89-df3a371ddede`:FAIL/exit1,13.51s, `RETENTION_HELPER_EARLY_CLOSE`; ownerPrepared=true/helperCreated=true/helperActualClose=true/exit1/null/protocolPhase0; frozen8/8; root `mcsm-sibling-retention-aMjCMx` retained. Review identified a bare static-method expression in a PowerShell command parameter. Inert fixed-string stub proved bareMatches=false/wrappedMatches=true. Attempt1 added parentheses around nativePathData only; fingerprint algorithm/security rules unchanged. Subsequent native PASS verifies the correction; historical underlying exception was not captured and is not rewritten. |
| LC2-SYNTHETIC-DIAGNOSTIC-001 | LOW / historical FAIL retained | First synthetic canonical probe `46e40e65-f22a-40ea-937d-43253b8cb6b8` returned stderrPresent=true; detailed old stderr meaning UNKNOWN. It lacked the script-local progress preference used by the actual helper. Aligned synthetic probe `32955e46-23d0-4542-9319-bce3ed299a06` PASS,162bytes/equal fingerprint/no stderr. Neither modifies or passes a historical native result. |

Original diagnostic excerpts:

```text
7eb50d65-c0ab-4370-a8b0-b3bfae3c63f4: Error: RETENTION_OWNER_PREPARATION
bb4f2e67-37bf-4ad1-8e89-df3a371ddede: Error: RETENTION_HELPER_EARLY_CLOSE
{"ownerActualClose":false,"ownerExitCode":null,"ownerExitSignal":null,"ownerPrepared":true,"helperCreated":true,"helperActualClose":true,"helperExitCode":1,"helperExitSignal":null,"protocolPhase":0,"elapsedMs":13489}
```

The false owner-close field describes the moment of the second failure, before its controlled finally cleanup. Actual cleanup subsequently completed and a read-only inventory found no matching child; no history field is overwritten.

PowerShell's argument/expression distinction is documented by [Microsoft's PowerShell5.1 parsing reference](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing?view=powershell-5.1). The inert argument-binding result is `lc2-powershell-argument-binding-79ba7196-0736-43d9-a5ef-1ec466cb79bb`.

## Git and continuation

The preceding authorized upload completed on branch `codex/phase-4-players-properties`, commit `7613cf1d28949e303b2beaf53f6cdba69c56cb8d`; remote matched and working tree was clean at that checkpoint. It contains prior LC1/LC2 foundations and progress, not a claim of finished LC2. New sibling fixture work described here remains uncommitted; no automatic second upload, PR or merge.

Next: review and validate scope budget/rotation against maximum retained histories, then integrate an owner-scoped verifier only after that Gate. Keep all existing checks and the owner lease through actual helper close. Re-run default native guard/fresh-process recovery after integration. Add/remove API, real RCON and member UI remain gated. No LM1/LM2 or remote expansion in parallel.
