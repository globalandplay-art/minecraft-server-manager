# P7.2 frozen final regression — BLOCKED

Branch `codex/phase-4-players-properties`; HEAD `c5beb16daf79b8b769ad6af495633f12944fff72`. Eleven candidate source/test fingerprints matched before/after. One new `npm.cmd run check` execution only, elapsed 424.26 seconds, exit 1.

Private ignored evidence: `test-results/p72-final-31ede8c3-8b82-432e-b613-6a802b08abef/` contains freeze-before/after, result.json and check.log (sensitive-looking diagnostic lines redacted). Original historical evidence is not overwritten.

## Results

- Lint/typecheck: PASS.
- Contracts: 7 PASS.
- API: 1260 PASS / 9 FAIL, 5 failed / 69 passed files.
- Web: 153 PASS, all 27 files PASS.
- Production build: NOT RUN in this check because test stage exited nonzero. Earlier targeted-slice build is historical evidence, not this Final Gate baseline.
- Diff check: PASS.
- Independent GPT-6.1 Sol High combined eleven-file source review: P1=0/P2=0/P3=0; necessary HTTP/WS/session/frontend call boundaries reviewed. This is source review only, not approval of failing regression.

## Failures and attempts

1. Native ACL: audit ring fails `AUTH_PRIVATE_UNSAFE [audit:directory-acl;acl:helper-timeout]`; credential init/reset and before-publish recovery fail `AUTH_PRIVATE_UNSAFE [acl:helper-timeout]`. Direct timeout classification reproduced under full regression; performance cause UNKNOWN, underlying repairs 0/2. Prior audit failure was file-acl-before; preserve both, do not invent equivalence of the underlying bottleneck.
2. Addon install (three cases): intent-written interruption, before-commit interruption, unchanged committed install reconciliation. At `addon-install-service.test.ts:58`, `expected 'running' to match /^(succeeded|failed|interrupted)$/u`. No explicit errno/HTTP code; Node assertion. Root cause UNKNOWN, repairs 0/2; no timeout increase or retry.
3. Lifecycle Fabric flow and restored-tombstone flow: `Test timed out in 5000ms`. Performance root UNKNOWN, repairs 0/2. The tombstone cleanup-isolation repair was Attempt 1 and remains distinct from performance remediation. No ENOTEMPTY or CLEANUP_BLOCKED reported in this run; this does not prove the cleanup race impossible.
4. Archive legacy Restore/Rollback startAfter=false negative test: `Test timed out in 5000ms`, `world-archive-service.test.ts:98`. Root cause UNKNOWN, repairs 0/2. No evidence justifying weakening the safety check.

Historical serialization and Headers failures did not recur; their first fixes and independent reviews remain recorded separately. All above failures are blockers for a final regression PASS. No repair performed after this failed run; no blanket rerun. Temporal overlap does not prove all failures share host contention or a single root cause.

## Safety and next action

The check process exited. No Minecraft/Tailscale/Cloudflare, real credentials, Windows changes, commit/push/PR. Full-suite helper identity was not instrumented; do not claim all host helpers or all synthetic fixture directories clean. No unknown processes terminated or historical evidence deleted.

Next: bounded read-only analysis of full-load ACL timeout and newly observed transaction wait failures, preserving fixed categories and existing deadlines. Collect only the evidence needed to distinguish resource contention from product/fixture defects; any new sampling or substantive repair requires its scoped decision. Do not enter Tailscale or mark P7.2 PASS.
