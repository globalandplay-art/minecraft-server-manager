# P7.2 bounded regression

Authorized remediation: bound API test-file concurrency with `maxWorkers: 2` in `apps/api/vitest.config.ts`. No product code, assertions, selected tests, ACL criteria, helper deadlines or test deadlines changed. Existing uncommitted work is retained.

## Validation

One complete `npm.cmd run check` execution: contracts 7/7, API 1269/1269 (74 files), Web 153/153 (27 files); all 1429 tests passed. API duration 638.32s. Lint and typecheck completed successfully; the command reached and completed all production builds. Evidence: ignored `test-results/p72-bounded-workers-check.log`.

The PowerShell redirected invocation returned wrapper exit 1 with NativeCommandError records for stderr diagnostics. The npm native exit code was not separately recorded by that invocation; do not report it as exit 0. No test failures occurred in its captured results. A subsequent explicit production build recorded `BUILD_NATIVE_EXIT=0`, shell exit 0. Existing jsdom navigation diagnostics and Vite >500kB chunk warning remain recorded; neither was suppressed or its threshold changed. `git diff --check` passed.

Independent GPT-6.1 Sol High configuration review: P1=0/P2=0/P3=0. Explicit concurrency/locking/security race tests remain present. Cross-file stress above two workers is no longer part of default API regression; worker count is not a global native-helper process limit.

## Conclusion and limitations

All nine previously failing cases pass with bounded scheduling. This resolves the observed default-regression failures in this candidate; it does not establish the precise historical PowerShell performance bottleneck or prove that unrestricted high-worker stress is safe. Historical full-load failures remain unchanged. ACL permission rejection and 5000ms fail-closed helper timeout remain enforced.

No real credentials, Minecraft/world operations, remote access configuration, system modifications, commit, push or PR. P7.2 Final Gate is not automatically signed off: preserve the wrapper exit limitation for final evidence review. Remediation attempt 1 for bounded regression scheduling; historical underlying ACL bottleneck remains UNKNOWN.
