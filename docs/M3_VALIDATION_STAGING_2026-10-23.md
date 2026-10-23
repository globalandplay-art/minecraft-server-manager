# M3-D — Forge / NeoForge inert upload validation

M3-D bounded inert staging engineering: PASS. Independent GPT-6.1 Sol High
source/final evidence review: zero open P1/P2/P3. M3 overall: IN PROGRESS.
This slice adds usable upload validation, not
Forge/NeoForge installation or real mod-load acceptance.

## User behavior and implementation

The existing Mods inventory page now offers “上传校验（不安装）”. A selected JAR
is uploaded through the existing local guarded endpoint to the Manager's
private `addon-uploads` storage. The server's mods directory is not altered.
The page displays the actual stage filename/size/hash, all declared mod names,
IDs and versions, and explicitly says “暂存校验通过，尚未安装”. Unresolved version
expressions stay raw. Compatibility stays unknown: Minecraft/loader/dependency
ranges are not evaluated or represented as a compatibility PASS.

The new inert staging profile is separate from `addonProfile`, which remains
Paper/Fabric-only. Installation, enable/disable, trash and restore are still
closed for Forge/NeoForge. `markConsumed` refuses these stages and
`verifyConsumed` returns false. Reading a validated source only rechecks
evidence and grants no write permission.

Existing registered execution identity capture is required before creating a
stage and after payload parsing. Reopening verifies owner/instance/root,
directory, revision, current complete adapter identity, payload size/hash and
the entire reparsed declaration graph. A locally recomputed receipt checksum
cannot substitute altered declaration contents. The new private graph has a
64KiB metadata limit and the complete serialized validated record must fit the
existing128KiB JSON reader; no existing64MiB upload/60s stream limit changed.

The upload response retains the legacy Paper/Fabric shape and adds strict
Forge/NeoForge variants with matching descriptor source/loader, nullable
single-name/version projection, required declaredMetadata,
compatibility=unknown and executionAvailable=false. No arbitrary file path,
command, port or new endpoint is introduced. Local Host/Origin/intent and
existing configured authentication still apply.

The page prevents concurrent selection, does not retry uploads, locks further
uploads on a lost/unknown response, and keys state by instance/type/version.
An old-instance completion cannot populate the newly selected instance.
Each instance has the existing maximum3 retained stages (failed records count
toward quota). No new automatic deletion or discard facility was introduced.

## Candidate and checks

Branch `codex/phase-4-players-properties`, HEAD
`2f084f37e8585a046d15e57896e22f0405a76ad1`. Earlier uncommitted work retained.

| Verification | Actual evidence in ignored test-results |
| --- | --- |
| Final affected API |120 PASS /7 files, exit0; `m3-staging-api-final.log` |
| Complete contracts |28 PASS /7 files, exit0; `m3-staging-contracts-final.log` |
| Complete Web |233 PASS /38 files, exit0; `m3-staging-web-final.log` |
| Root lint/typecheck/build |exit0; `m3-staging-lint.log`, `m3-staging-typecheck-final.log`, `m3-staging-build.log` |
| Diff check |`m3-staging-diff.log`, repeated after documentation |
| Independent Sol High review |source, final logs/report and three staging screenshots verified; zero open P1/P2/P3 |

The Web log preserves existing jsdom document-navigation stderr despite exit0.
This is not a new complete API or whole-repository regression PASS. Old LC2
native experiments were not run; historic full-regression failures remain.

## Real browser evidence

Run `m12-real-7554c82f-9980-4f9c-87a0-b50953e234c6`, report `m21-report.json`:
actual Chrome → Vite → production Fastify, no route interception, widths
360/768/1440 PASS. Three real NeoForge upload POSTs returned201; private
payload hashes, complete declarations, registered adapter IDs and validated
lifecycle records matched. They remained unchanged after Manager restarts.
Seven Manager sessions closed, no Minecraft launch attempts/children,
forbidden addon mutations0, source inputs unchanged and ports released.
`staged-mods-360.png`, `staged-mods-768.png`, `staged-mods-1440.png` and each
width's trace are preserved in the run directory. The360 screenshot was
visually inspected: wrapping remains bounded and staged/not-installed status
is explicit. The harness permits only exactly three upload201 requests;
installation or lifecycle mutation would fail the gate.

This real browser fixture is NeoForge26.3.0.95. Forge staging is covered by
the affected API/identity/metadata tests; no real Forge browser/mod-load test
is claimed. No EULA acceptance or Minecraft server launch occurred.

## Files in this slice

- `apps/api/src/services/addon-upload-metadata.ts` (new shared staging projection)
- `apps/api/src/services/addon-upload-service.ts` and `addon-adapter-identity.ts`
- `apps/api/test/addon-loader-staging.test.ts` (new) and `addons-api.test.ts`
- `packages/contracts/src/index.ts` and `test/mod-metadata.test.ts`
- `apps/web/src/pages/ReadonlyMods.tsx`, `Addons.tsx`, `Addons.test.tsx`
- `tests/acceptance/m21-neoforge-registration-browser.mjs` (opt-in inert staging)
- Progress/scope/API/user-guide/debt documentation and this report.

## Historical failures retained

- `m3-staging-api-v1.log`:91 PASS/1 FAIL; the newly added HTTP test connected
  its error handler with the wrong signature and omitted the guard hook.
  Fixture correction reused the established guarded route-test pattern;
  unchanged403 expectation then passed. No production guard was weakened.
- `m3-staging-api-delta.log`:21 PASS/2 FAIL; an existing read-only fake
  inherited a private-field Mock method that became reachable when inert
  upload was added. Its getStatus now explicitly supplies stopped/unowned
  fixture state. The intentionally incomplete registration still returns409
  ADDON_ADAPTER_UNTRUSTED; install/trash still501; all side-effect checks remain.
  The identity helper now rejects missing path evidence with a fixed409 rather
  than allowing an unclassified path-resolution exception.
- `m3-staging-contracts.log`:27 PASS/1 FAIL; Value.Check lacked the UUID
  registry used by the browser. The test registers the same strict UUID rule
  and restores the prior registry; no production schema constraint changed.
- `m3-staging-browser-v1.log`:ERR_ASSERTION during source preflight because
  LT_NEOFORGE_TEST_SOURCE was absent. No Manager/test root was started by that
  failed invocation. The next invocation supplied the previously verified
  source path; no source guard or timeout changed.

## Remaining work

Forge/NeoForge protected installation and lifecycle remain NOT IMPLEMENTED.
The whole-M3/Addons final advanced safety Gate remains pending; this scoped
Sol review does not replace that milestone Gate.
Before opening them, review dependency/compatibility admission, actual
mutation-time plan/arguments/environment and both addon-directory identities,
pinned backup support, persisted operation/receipt schemas and recovery.
Extend existing transactions; do not create a replacement framework or use
the staging response as proof of successful installation.

Real user-mod loading NOT RUN. Existing dependency audit16 findings (including
2 critical) and optional NeoForge core-JAR ZIP rejection remain recorded in
the technical-debt register. P7 STOPPED. No Minecraft/server/world operation,
network/system change or Git commit/push/PR is authorized by this delivery.
