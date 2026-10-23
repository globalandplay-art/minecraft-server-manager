# M3-E operation-scoped validation reuse — 2026-10-24

## Authorization and scope

The user's explicit “批准执行” authorized one additional bounded repair and
verification round beyond the prior two-round stop. This is attempt **3** of
`M3-INSTALL-BROWSER-DEADLINE-001`, not a new issue or reset of its history.
Branch: `codex/phase-4-players-properties`; baseline HEAD:
`2f084f37e8585a046d15e57896e22f0405a76ad1`. Existing unrelated work is retained.

Only successful pure NeoForge content-validation facts may survive between
the eight complete identity observations of one admitted installation. Every
physical read, hash, identity, registered execution binding, Java/environment,
directory and absent-target check remains. No global cache, parallel file
reads, new persistence framework or relaxed deadline is introduced.

## Implementation

- `neoforge-launch-binding.ts`: retain existing bounded 68-entry/8MiB content
  reader; explicit disposal clears facts and refuses further use.
- `addon-adapter-identity.ts`: operation-local scope binds exact adapter,
  server/root, registered execution evidence and approved full identity.
  Recheck ownership before/after awaited capture; invalidate on failure.
  Preserve distinct injected verifiers and default cold capture behavior.
- `addon-install-service.ts`: scope exists only during admitted NeoForge
  execution, verifies active operation/registry/recovery/abort state and is
  disposed in `finally`, including interruptions.
- `addon-upload-service.ts`: optional internal forwarding through existing
  source validation/consumption proofs. No request DTO or public bypass.
- Direct identity/install tests cover physical replacement, scope isolation,
  registration changes, awaited ownership loss, recovery, abort and release.

Preflight, independent upload and restart reconciliation keep their original
cold paths. Guard/backup/journal/publication ordering, API/UI/authentication,
test assertions/concurrency and original 30000ms browser deadline are unchanged.

## Validation before browser

- Final affected API tests: **135 PASS / 9 files**, exit0, 33.66s.
  `test-results/m3-operation-scope-final-tests.log`.
- Root lint/typecheck/production build: PASS, exit0.
  Logs: `m3-operation-scope-lint.log`,
  `m3-operation-scope-final-typecheck.log`, `m3-operation-scope-build.log`.
- `git diff --check`: PASS, exit0; existing line-ending notices are preserved.
- Independent GPT-6.1 Sol High source and final-test delta review:
  **P1=0/P2=0/P3=0**, accepted one fresh non-timing browser run.

## Fresh browser outcome

**PASS**, exit0, single authorized run:
`m12-real-1d6fc400-4dcb-4bc5-a9d7-0db7785dc934`.
`LT_M3_COMPLETION_TIMING` is absent; this report has no diagnostic-only flag.
Original 360/768/1440 order, 30000ms completion assertion and existing cleanup
boundaries remain unchanged. All three widths completed installation, immediate
list verification, Manager restart/durability, registration removal and restart
consistency. Target SHA, pinned protection backup, committed journal and consumed
stage receipt are asserted in the existing harness.

| Width | Browser result | Operation ID | Recorded createdAt-to-updatedAt span |
| --- | --- | --- | --- |
| 360 | PASS | 4199a236-0b9e-42eb-bf50-efe6fec1a8ae | 24063ms |
| 768 | PASS | c53f14fc-6393-47d4-802d-662aea6829da | 23439ms |
| 1440 | PASS | eb23ac25-5009-4612-9f6a-3e899ef53207 | 23622ms |

These recorded spans precede completed terminal publication and are **not**
precise browser-visible latency or guaranteed future margin. The actual
unchanged browser assertions passed; no timing instrumentation was enabled.

All seven Manager sessions produced `type=closed`, zero child/launch attempts
and normal exit logs. Source inputs unchanged; ports released; forbidden addon
mutations=0; exactly three upload and three install requests. No force cleanup
or Minecraft launch. Three traces/screenshots and full private evidence are in
`test-results/m12-real-1d6fc400-4dcb-4bc5-a9d7-0db7785dc934/`.

Independent GPT-6.1 Sol High final evidence review: **PASS, P1=0/P2=0/P3=0**.
All three traces retain timeout30000 and successful `matches:true` completion
assertions; observed assertion spans25162.928/24120.446/25117.065ms respectively
(assertion observation, not exact paint latency). Reviewer independently
matched persisted operations, committed journals, consumed payload receipts,
target list SHA and pinned guard checksums, plus restart readback with stopped
instances and recoveryRequired=false. All seven recorded PIDs are absent and
normal exit0 evidence agrees. Target test JAR removal after hash verification
is expected isolated-fixture cleanup, not missing installation proof.

The specific `M3-INSTALL-BROWSER-DEADLINE-001` gate is **RESOLVED FOR CURRENT
CANDIDATE / FRESH BROWSER PASS**. This one run does not promise future timing
margin or retroactively prove the historical failure phase.

## Historical evidence and remaining delivery gates

Prior original/attempt2 BLOCKED runs and diagnostic-only timing PASS are not
rewritten. The historical exact failure phase remains UNKNOWN. Pure-content
reuse is a bounded optimization, not proof of that historical root cause.

Whole-M3 final full regression and applicable advanced safety Gate remain
PENDING. Real Minecraft/mod loading is NOT RUN in this slice. P7 remains
STOPPED. No commit, push, PR or system/network change is authorized or performed.
