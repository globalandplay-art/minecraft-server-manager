# M3-C — Registered loader identity groundwork

Bounded identity integration: PASS. M3 overall remains IN PROGRESS.
This is not Forge/NeoForge upload/install/lifecycle delivery or real mod-load
acceptance. No user-facing write capability was opened.

Branch `codex/phase-4-players-properties`, HEAD
`2f084f37e8585a046d15e57896e22f0405a76ad1`; existing uncommitted work retained.

## Implemented

The existing private `captureAddonAdapterIdentity` now accepts only the
already validated new loader installations: Forge26.3/66.1.0 and the exact
NeoForge26.3.0.95 Server descriptor. It reuses complete lifecycle dependency
binding, registered root/launcher/Java identities and the corresponding
registered `forgeExecutionSha256` / `neoforgeExecutionSha256`.

Both registered plan and fresh detection must have trusted lifecycle evidence;
Minecraft version, required Java25 and full detected Java runtime version
must match the plan. A matching registration of a different Forge release
does not inherit this permission. Missing/null/cross-loader closure evidence,
replaced dependencies, hardlinks, changed Java, unknown evidence and changed
scripts are refused with409 ADDON_ADAPTER_UNTRUSTED.

NeoForge `run.bat` is an exact root-level descriptor, read but never executed.
The new private tuple includes `executionBindingSha256`; after other identity
reads it rechecks complete binding, root, Java and mods-directory identity.
An absent mods directory remains an observation, not permission to create it.

Paper/Fabric serialization and digest are unchanged: the extra field is not
present for them, and explicit legacy-tuple regression assertions cover both.
Public contracts, addonProfile, capabilities, uploads, backup protection,
installation and lifecycle semantics were not widened.

## Changed files in this slice

- `apps/api/src/services/addon-adapter-identity.ts`
- `apps/api/test/addon-loader-identity.test.ts` (new)
- `apps/api/test/addon-adapter-identity.test.ts`
- `apps/api/test/helpers/forge-launch.ts` (optional test release, old default unchanged)
- This report, PROGRESS, M3_SCOPE, TECHNICAL_DEBT and API_SPEC.

## Verification

All evidence is preserved in ignored `test-results/`.

| Check | Actual result |
| --- | --- |
| Initial identity run |18 PASS /1 FAIL; fixture EISDIR, exit1, `m3-identity-focused-v1.log` |
| Intermediate command with three incorrect test paths |27 PASS /3 actual files, exit0; **not six-file evidence**, `m3-identity-affected-v2.log` |
| Correct affected identity/API/upload/install/lifecycle |110 PASS /6 files, exit0, `m3-identity-affected-final.log`; before final Java equality correction |
| Final identity + Forge binding/detection/local config delta |72 PASS /5 files, exit0, `m3-identity-review-delta.log` |
| Final root lint/typecheck/build |exit0, `m3-identity-lint-final.log`, `m3-identity-typecheck-final.log`, `m3-identity-build.log` |
| Diff check after docs |exit0, `m3-identity-diff-final.log` |
| Independent Sol High design/source/delta review |zero open P1/P2/P3 |

These scoped runs are not added together as a new frozen full regression.
Final changed branches and shared fixture users were covered by the72-test
delta; unchanged upload/install/lifecycle evidence remains scoped to the
110-test run. API negative tests still refuse Forge/NeoForge writes with501
and verify server/Manager files unchanged.

The initial EISDIR occurred before the intended capture because the new
fixture used file `rm` on an empty directory. Fix Attempt1 uses `rmdir` on
that owned empty fixture; no assertion, safety check or timeout was relaxed.
Independent review found a P2 full-runtime-version comparison gap; Attempt1
added equality for new loaders only and supported-version mismatch tests.
The earlier weak unsupported-version test was replaced with a freshly
registered, matching66.1.1 closure, proving the exact-version restriction.
Both findings are closed; original logs retained.

No UI/contracts were changed this slice, so previous M3-B browser evidence
was not rerun or represented as fresh M3-C acceptance. No full repository
regression, old native stress test, real server or user-mod loading was run.

## Remaining write gate / next slice

This private identity capture is necessary groundwork, not write approval.
Before production writes, extend the existing inert staging metadata and
durable upload/receipt identity validation without treating multi-mod names
or unresolved versions as concrete values. Define conservative compatibility
admission, including unknown dependencies/ranges, and preserve explicit
unknown state. Revalidate current launcher/dependency/Java/plan arguments
and environment at actual mutation/recovery boundaries, review enabled and
disabled directory identity, then extend the existing pinned-backup,
transaction and recovery services. Do not simply broaden addonProfile.

The earlier16 dependency audit findings (including2 critical) and optional
NeoForge core-JAR ZIP rejection remain separately recorded, not resolved by
this slice. P7 STOPPED. No Minecraft launch, system/network change,
commit/push/PR or original-world operation occurred.
