# M3-E — Protected Forge / NeoForge install candidate

## Current follow-up — 2026-10-24

Explicitly authorized attempt3 now has fresh non-timing360/768/1440 browser
PASS under unchanged30000ms: run `m12-real-1d6fc400-4dcb-4bc5-a9d7-0db7785dc934`.
135 affected tests/static/build and independent SolHigh source delta pass.
Final independent evidence review PASS, P1/P2/P3=0; specific browser deadline
blocker resolved for current candidate. Whole-M3 final regression and
advanced Gate remain PENDING. See [current report](./M3_OPERATION_SCOPE_2026-10-24.md).
The previous BLOCKED entries below preserve historical evidence; they do not
override this newer specific browser-gate PASS or constitute whole-M3 PASS.

## Historical original delivery checkpoint

**ENGINEERING DELIVERY GATE: BLOCKED.** Source and scoped checks pass, but the
real browser completion gate did not pass. M3 overall remains IN PROGRESS;
the whole-M3 advanced safety Gate remains PENDING.

Branch `codex/phase-4-players-properties`, baseline HEAD
`2f084f37e8585a046d15e57896e22f0405a76ad1`. No commit/push/PR.

## Implemented candidate

- Existing install service, operation locking, journal, no-replace file
  publication, pinned protection snapshot and startup reconciliation reused.
  New `addonInstallProfile` is separate from lifecycle `addonProfile`:
  Forge/NeoForge installation is implemented, while enable/disable/trash/
  restore remain closed. `installSupported` is separate from writeSupported.
- New-loader install requires literal `confirmUnknownCompatibility=true`.
  It is included in the idempotency fingerprint and persisted journal intent;
  recovery refuses missing consent. This is explicit acknowledgement, **not
  range solving or verification of compatibility/dependencies/code safety**.
  Incoming IDs colliding with enabled or disabled declarations are refused.
- Private addon guards include every server-root entry, including libraries,
  descriptor, existing addons and worlds, with stable directory membership.
  Public backup capabilities were not widened beyond their existing gates.
- New-loader identity includes bounded argv hash and disabled-mods presence/
  physical identity, in addition to the registered complete launcher/Java/
  dependency evidence. Full identity and stopped state are rechecked at
  publication and commit boundaries. Paper/Fabric identity layout is unchanged.
  Previous new-loader stages missing these identity fields fail closed; no
  automatic evidence migration or deletion is performed.
- Consuming a new-loader stage requires the actual matching running
  addon-change operation owning the instance. Read-only consumed verification
  remains usable before operation initialization during restart recovery.
  Formerly succeeded new-loader records are physically reverified at startup;
  drift raises recovery, rather than trusting the saved outcome alone.
- The page adds explicit stopped-instance install confirmation, raw declaration
  and unknown/code-execution warning. It polls the accepted operation, verifies
  the resulting filename/hash and shows manual-start/restart guidance. Unknown
  outcomes retain the accepted operation ID and disable resubmission/upload.
  No automatic Minecraft start, stop or restart is added.

## Scoped verification

Evidence logs are ignored and preserved under `test-results/`.

| Check | Actual result |
| --- | --- |
| Final affected API + journal |75 PASS /6 files, exit0; `m3-install-api-final.log` |
| Complete Web |236 PASS /38 files, exit0; `m3-install-web-final.log` |
| Complete contracts |28 PASS /7 files, exit0; `m3-install-contracts.log` |
| Root lint/typecheck/build |exit0; `m3-install-lint.log`, `m3-install-typecheck-final.log`, `m3-install-build.log` |
| Final diff check |`m3-install-diff-final.log` |
| Independent Sol High implementation/delta review |zero open source P1/P2/P3; browser/performance gate remains BLOCKED |

Tests cover consent absence, declared-ID conflicts, single installation with
complete pinned guard, idempotent replay/conflict, committed/interrupted
restart, before-commit identity drift without consumption, committed-success
drift requiring recovery, actual argv/disabled-directory identity changes,
and preservation of accepted operation IDs after UI interruption.
No new complete API/full-repository regression PASS is claimed. Legacy native
experiments were not rerun. Existing jsdom navigation stderr is retained.

Historical intermediate evidence remains:

- `m3-install-typecheck-v1.log`: exact optional-property typing failure, fixed
  by definite local state values without weakening compiler settings.
- `m3-install-api-v1.log`:47 PASS/3 FAIL; three NeoForge identity tests exceeded
  unchanged5000ms. Removed a redundant fixture closure capture and rejected
  absent registration closure before unnecessary reads. No safety checks,
  assertions, concurrency or timeout were reduced. Isolated15 and subsequent
  default-two-worker68/final75-test runs passed; original failures remain.
- Independent P2 UI finding: unknown outcome unmounted its operation panel,
  losing the accepted ID. Attempt1 keeps a locked panel and tests ID retention.

## Actual browser failure and retained business evidence

Issue: **M3-INSTALL-BROWSER-DEADLINE-001**.
Run: `m12-real-b4dacc05-ebca-4fca-9b50-5e7767c5d52f`.
Original `m21-report.json` remains BLOCKED, cleanup=CLEANUP_BLOCKED.
Error code: NO_EXPLICIT_ERROR_CODE. Raw failed assertion:

```text
expect(locator).toBeVisible() failed
Locator: getByText('安装文件已核验，需要之后手动启动或重启才会加载。管理器未自动启动服务器。')
Expected: visible
Received: <element(s) not found>
Timeout: 30000ms
```

The360px real Chrome → Vite → Fastify flow uploaded, explicitly acknowledged
unknown compatibility and received installation202. It did not finish within
the existing30-second browser assertion. No768/1440 install PASS is claimed.
The UI showed the accepted operation ID while still processing.

Later read-only observation verified operation
`9cea0040-56f4-4c68-b8bb-4dde82cabbf5` succeeded; created15:16:24.146Z,
updated15:17:50.886Z, elapsed86.740s. The install and protection journals are
committed, the guard is pinned, the installed JAR hash equals staged input,
and source inputs remained unchanged. Separate additive
`post-failure-business-proof.json` records this; it does not change the original
acceptance result or prove real Minecraft mod loading.

Confirmed timing observations from the same Manager's saved checkpoints:

- Nested backup intent15:16:40.040Z → payload verified15:16:42.939Z: about2.899s.
- Install intent15:17:04.595Z; staging validated15:17:04.702Z.
- Target installed15:17:22.700Z:17.998s after staging validation.
- Installed verified15:17:29.112Z; before commit15:17:29.119Z.
- Staging consumed15:17:44.951Z:15.832s after before-commit checkpoint.
- Committed15:17:45.027Z → terminal outcome15:17:50.886Z:5.859s.

**CONFIRMED:** operation duration exceeded browser deadline; no false backend
success was inferred from202. **PROBABLE:** repeated complete identity/closure
scans contribute significantly, based on their call chain and long validation
intervals. **UNKNOWN:** exact internal cost distribution and whether a safe
deduplication alone meets30s. Payload-copy time alone does not explain86s.
No performance-root-cause product repair has been attempted (0); timeout was
not increased and no fresh browser rerun was started to seek an accidental PASS.

## Safety and process cleanup

The harness's normal IPC close failed while the operation was still active.
Afterward all instances were confirmed stopped, active operation null and
recovery false. Manager PID37664 was matched to browser parent6012; its only
remaining children were its conhost and workspace esbuild, no Minecraft child.
Initial Stop-Process failed with NullReferenceException and did not stop it.
The exact confirmed Manager PID was then stopped via taskkill exit0; Manager
and both helpers were confirmed gone. No directories/files were removed.
`owned-manager-cleanup.json` is a separate receipt, **not normal shutdown PASS**.
The original CLEANUP_BLOCKED report was not rewritten. No user server/world,
Windows ACL, network or P7 setting was changed. The fresh isolated fixture,
installed inert JAR and full private evidence remain preserved.

## Next bounded task

Investigate the demonstrated repeated validation intervals. Prefer reusing
fresh identity proof within one locked operation where equivalence can be
reviewed; retain registered binding, stage reparse, actual publication/commit
drift checks and conservative recovery. Do not cache across external writes,
omit protection, increase timeout or start another native framework. Only
after a reviewed targeted fix should another browser run be considered.

Do not call this M3-E engineering PASS, final M3 PASS or real mod-load PASS.

## Bounded performance investigation and adjacent-proof repair (Attempt1)

Changes are limited to `addon-upload-service.ts`, `addon-install-service.ts`
and the two new-loader staging/install test files. `validatedSource` returns
its **fresh liveIdentity**, only after receipt identity, payload hash and
complete metadata reparse succeed. Execution entry, after-backup validation
and prepared-source validation use that proof rather than immediately
performing a second complete capture. Each requires the same adapter object.
There is no persistent cache or reuse across those boundaries. Publication,
post-publication, precommit, consumed-record verification and recovery checks
are unchanged. No identity serialization or HTTP contract changed.

The original preflight identity check is retained. Initial attempted removal
changed invalid-registration responses from409 to500 when a stage did not
exist; `m3-install-dedup-focused.log` preserves55 PASS/2 FAIL. Restoring this
early check preserves prior admission/error behavior; final
`m3-install-dedup-focused-v2.log`: **57 PASS/5files, exit0**. New tests prove
the returned proof is the newly captured object (not deserialized identity),
every later validation reacquires proof, and post-backup drift rejects before
target publication. Existing publication/commit/restart fault tests passed.

Independent GPT-6.1 Sol High design and delta review: open **P1/P2/P3=0**.
The reviewer read the final sources/tests and57-test evidence, without edits
or test execution; performance/browser acceptance remains explicitly open.

Read-only bounded measurements used the preserved isolated inert fixture,
no API listener, no Minecraft process, no source-fixture writes. Java was
queried only with its existing `-version` probe. Clock: Node monotonic
`performance.now`, sequential calls, no concurrent test execution:

| Measurement | Milliseconds |
| --- | ---: |
| Registration revalidation | 3848.020 |
| Complete addon identity | 3691.031 |
| Detection including Java probe and complete binding | 1265.267 |
| Single complete NeoForge binding | 1186.044 |
| Complete addon identity recheck | 3676.308 |

Before/after identity matched. Tool and new report:
`test-results/m3-identity-timing-20261023.mjs`,
`test-results/m3-identity-timing-20261023.json` (exit0). No paths, credentials,
raw CLI output or exception data appear in the timing report.

**CONFIRMED:** adjacent duplicate work existed and three scans were removed;
fresh complete identity costs about3.68s in this isolated observation.
**PROBABLE:** repeated full closure validation is a substantial contributor.
**UNKNOWN:** historical internal breakdown, cold/loaded-host behavior and
new end-to-end install time. Do not subtract sampled times from the old86.74s
and call that a measured improvement. No fresh browser run was made, since
this limited change does not establish sufficient evidence for30s completion.
Original browser report and cleanup receipt remain unchanged.

Performance-root-cause substantive repair count **1**. Next bounded decision:
assess reuse of already verified closure metadata inside a single identity
capture while still re-reading and comparing physical files at its final
stability boundary. Current `detectServer` returns no full private closure
proof, so its metadata cannot simply replace explicit binding verification.
Do not add a global cache or remove mutation/recovery verification.

Final static checks: `m3-install-dedup-lint.log`,
`m3-install-dedup-typecheck.log`, `m3-install-dedup-build.log` and
`m3-install-dedup-diff.log` all exit0. No new whole-API/full-repository test
PASS is claimed, and no unchanged Web/contracts tests or legacy native
experiments were repeated. Full regression remains a later delivery Gate.

M3-E ENGINEERING **BLOCKED**, real Minecraft mod-load acceptance **NOT RUN**,
whole-M3 advanced Gate **PENDING**. No Git commit/push/PR or P7 changes.

## Scoped content validation reuse (Attempt2)

`neoforge-launch-binding.ts` now separates pure successful JAR content checks
from physical binding. A private reader created for one addon identity call
can reuse frozen content facts across detection, explicit binding and final
binding. It caches only validated INDEX names and the successful content
checks represented by its key: fresh SHA256, production-classpath flag and
game/universal/loader/ordinary role. It retains no file bytes, filesystem
identity, ownership, binding digest or absence result. Bound:68 entries and
8MiB charged retained strings; saturation falls back to full cold validation.

Every pass still fully reads and hashes files, validates per-file/aggregate
limits and file/directory identities, resolves INDEX names against each current
JAR location, rechecks missing targets, and performs final file/anchor/args/root
stability checks. Binding digest and public DTOs are unchanged. The default
binding reader remains cold; only the builtin NeoForge detector receives this
per-identity reader. Injected test detectors remain unchanged. Forge/Paper/
Fabric execution paths do not use this cache.

Warm-reader tests cover changed content, forbidden game classes, hardlinks,
byte-identical physical replacement, INDEX targets appearing, separate game/
universal validation roles, cold/warm digest equivalence and detection returning
unknown on a fresh read failure. Initial broader run96 PASS/1 FAIL was an INDEX
fixture missing Loader Build-Number, preserved in
`m3-install-scoped-content-tests.log`; required fixture metadata was restored,
not assertions changed. Binding delta30/30 PASS; final affected9 files
**123/123 PASS**, exit0, `m3-install-scoped-content-final.log`.

Read-only sequential timing on the same preserved inert fixture, new additive
`m3-identity-timing-scoped-20261023.json`, exit0:

| Measurement | Milliseconds |
| --- | ---: |
| Registration revalidation (cold/default) | 4114.801 |
| Complete addon identity (scoped content reuse) | 3000.367 |
| Detection including Java probe and cold binding | 1331.848 |
| Single cold complete binding | 1311.009 |
| Complete addon identity recheck | 2942.162 |

These measurements do not establish exact historical attribution or end-to-end
installation improvement. They do not themselves satisfy30s browser acceptance.
Final `m3-install-scoped-lint.log`, `m3-install-scoped-typecheck.log`,
`m3-install-scoped-build.log`, `m3-install-scoped-diff.log` all exit0.
Independent GPT-6.1 Sol High design/source/test/log/cleanup delta review:
open **P1/P2/P3=0**, without reviewer writes or test execution.

The browser harness now records an accepted operation ID before its unchanged
30-second assertion. If that assertion fails, a separate bounded cleanup wait
(60s overall, at most2s per GET) may observe only those accepted IDs belonging
to its still-owned Manager. This never retries a mutation or upgrades a failed
acceptance. It only precedes the existing normal IPC close; uncertain ownership,
unknown state or deadline exhaustion retains CLEANUP_BLOCKED and evidence.
No arbitrary process termination or automatic fixture deletion was added.

One fresh browser run is permitted after the above reviewed candidate; its
result is recorded separately below. No further performance repair is included
in this round. Same-root-cause substantive repair count: **2**.

## Fresh browser result after Attempt2 — HARD BLOCKER

Issue **M3-INSTALL-BROWSER-DEADLINE-001**.
Status **STOPPED AFTER 2 FIX ATTEMPTS**; no Attempt3 and no further rerun.
Run `m12-real-8047946f-a5b2-4a7b-8221-89ee59a7bab6`, original
`m21-report.json` **BLOCKED**, process exit1, explicit error code
**NO_EXPLICIT_ERROR_CODE**. Trigger at
`tests/acceptance/m21-neoforge-registration-browser.mjs:193`:

```text
expect(locator).toBeVisible() failed
Locator: getByText('安装文件已核验，需要之后手动启动或重启才会加载。管理器未自动启动服务器。')
Expected: visible
Received: <element(s) not found>
Timeout: 30000ms
```

| Width | Browser result | Backend operation | Backend elapsed |
| --- | --- | --- | ---: |
| 360 | PASS including registration/removal/restart consistency | 1ce2fd66-d8a5-41c7-ba2e-95dfe1845fa7 succeeded | 28150ms |
| 768 | BLOCKED at unchanged completion assertion | f62f8d45-ec07-4105-962b-19b9ef31bf55 succeeded | 29682ms |
| 1440 | NOT RUN | none | N/A |

360 operation created15:52:28.651Z, updated15:52:56.801Z.
768 operation created15:53:43.210Z, updated15:54:12.892Z.
Separate `post-failure-business-proof.json` verifies768 target JAR hash equals
its validated stage, lifecycle consumed with the matching operation ID,
install journal committed and protection guard pinned. This is additive
read-only evidence; it does **not** change either BLOCKED acceptance report.

Relevant completion code remains `apps/web/src/pages/ModInstallPanel.tsx:16–42`:
poll operation, verify terminal identity, fetch current inventory/status, check
target name/hash, then call `onInstalled`. The backend proof includes every
physical and commit check, rather than returning early to satisfy this UI.
Exact accepted-response, poll, post-result read and render durations were not
captured, so attribution among those stages is **UNKNOWN**. This is the same
unresolved end-to-end deadline blocker; no new independent cause is declared
to restart its repair budget. No crash or corrupt installation is established.

Attempt1 removed adjacent duplicate scans; Attempt2 removed repeated pure
content parsing within a single identity observation. Both passed applicable
source/security tests/reviews, but combined changes still failed the fresh768
completion Gate. Preserve the useful reviewed changes without calling delivery
PASS. No timeout was increased and no safety or business assertion was removed.

Cleanup observation took15ms after browser failure: both accepted operations
were terminal. All3 owned Managers reported normal close with zero Minecraft
launch attempts/children; recorded PIDs27516/35372/21780 were independently
confirmed absent afterward. `sourceInputsUnchanged=true`, `portsReleased=true`,
`forbiddenAddonMutations=0`. No unknown process was terminated and no preserved
fixture was force-deleted. Unlike the old failed run, this run did not require
forced Manager termination or leave a CLEANUP_BLOCKED receipt.

**Safety state:** no Minecraft startup, original source installations untouched,
inert test fixture and all history preserved; P7 remains stopped. Git unchanged
at HEAD2f084f37e8585a046d15e57896e22f0405a76ad1 with uncommitted work retained;
no commit/push/PR. Whole-repository regression and final advanced Gate remain
PENDING, not inferred from123 scoped tests.

**Next action requires technical-owner/architecture decision:** assess the
end-to-end completion contract and remaining physical-validation cost before
authorizing a different bounded approach. Do not perform a third blind repair,
extend30s, bypass final proof, or rerun until green. M3-E **BLOCKED**.

## 2026-10-24 diagnostic follow-up (not a third repair)

A later explicitly continued diagnostic-only run passed all three unchanged
width assertions without product source changes. It captured terminal save,
publication observation, operation-response and UI-confirmation timing, and
retained all three traces. It does not reproduce or rewrite either historical
BLOCKED result, is not delivery acceptance and does not reset the repair count.
See [timing report and limits](./M3_COMPLETION_TIMING_2026-10-24.md).
