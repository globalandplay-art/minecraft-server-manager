# Owner retention source extraction — 2026-10-18

Status: source preparation only; LC2 history capacity remains BLOCKED. No compiled helper built or executed, no bootstrap/default change.

The fixed C# literal moved unchanged from windows-owner-retention.ts to windows-owner-retention-native.ts. A pre-edit synthetic baseline independently captures 32 complete wrapper scripts. New parity test PASS: evaluated C# 5243 bytes, SHA-256 fc4cee0f4b50a879885dd6f536949ae90b268cf710f13239f7c4018bb15bcca6; every complete wrapper matches pre-edit bytes/hash. Proof validation is unchanged.

Validation: focused 179 PASS / 1 FAIL, exit1; lint/typecheck/build/diff exit0. Build 4.86s; existing chunk-size warning retained. Full project regression NOT RUN. Logs: test-results/lc2-retention-extraction-*-v1.log.

Failure: native parent-owned Manager lifetime exclusion > rejects a competing process and OS releases parent handles after abrupt parent kill. Error: probe-exited: (empty payload), manager-lifetime-lock.test.ts:19 and :45. The command ran at repository root with --root apps/api. probe resolves test/auth/fixtures/lock-probe.ts against cwd: repository-root target absent, API target exists. This establishes an invocation/fixture path mismatch; child stderr/exit code were not retained, so exact child failure remains UNKNOWN. No rerun, assertion change or native repair. Test also invoked two other native lock cases, which passed; do not describe this run as wholly Fake-only. No Minecraft launched.

A preliminary extraction shell command failed because python was not installed; it made no file changes. Extraction then used native PowerShell text operations.

Candidate: test-results/lc2-retention-extraction-frozen-v1.json. Previous 40/43-file frozen manifests are historical candidates, not hashes of the extracted source. Historical native reports remain unchanged. Retained 1000-history synthetic fixture is not removed. No commit/push/PR.

Next: finish readonly extraction delta review; resolve fixed compiled helper artifact provenance, executable/ancestor pinning and opaque owner bootstrap D1 design before any build/run. Correct cwd is required for any separately authorized future native lock test. Source extraction does not repair the 50s history deadline failure.
Independent GPT-6.1 Sol High delta review completed: P1/P2/P3=0 for source extraction. Literal/wrapper/proof parity independently confirmed. Overall validation remains179PASS/1FAIL; no capacity PASS. D1 remains OPEN.
