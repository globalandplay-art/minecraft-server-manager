# M3-E integrated review and startup reconciliation — 2026-10-24

## Independent finding

Issue: `M3-INSTALL-RECONCILE-REGISTRY-001`, P2, confirmed by independent
GPT-6.1 Sol High integrated review. P1=0/P2=1/P3=0 before repair.
This is independent of the resolved browser deadline issue; timing attempt3
and historical BLOCKED evidence are not reset or rewritten.

`AddonInstallService.reconcileStartup` classified strong physical verification
from the *current* registered loader. A previously committed/succeeded
Forge/NeoForge installation could take the legacy Paper/Fabric terminal fast
path after restart if its server ID was missing or mapped to a different type.
`OperationService.initialize` treats a persisted succeeded outcome as established
and does not supply the missing recovery gate. Registration retirement is only
within the current Manager; retained operation/journal evidence survives removal.

Minimal direction: retain strong verification when either current type is
extended or the persisted install has `confirmUnknownCompatibility === true`.
New-loader installs already require and persist that literal; no migration or
new schema is needed. Continue refusing current extended-loader records missing
the confirmation; preserve legacy Paper/Fabric records without the marker.
Unavailable/replaced adapter must keep recoveryRequired, never resend an install.

## Repair and final validation

One product repair: strong verification also applies when the persisted install
has the explicit confirmation marker. No change to OperationService, journal
schema, physical checks, timeouts or send/retry behavior. Six combinations cover
both original loaders changed to Paper/Fabric or missing registration. Each
must retain operationId, recoveryRequired, interrupted/physical-recovery-required
and RECOVERY_REQUIRED; journal and installed bytes remain unchanged.

The new tests initially incorrectly expected saved success to remain succeeded
after recovery admission. Actual existing OperationService policy changes this
to interrupted. Initial52 PASS/6 FAIL, exit1, retained in
`test-results/m3-reconcile-fix-tests.log`. Correcting this new assertion to the
exact established recovery contract did not change product behavior or weaken
the intended checks. Corrected focused58 PASS, exit0, followed by final
**150 PASS /10 files**, exit0,34.21s:
`test-results/m3-reconcile-final-affected.log`.

Independent GPT-6.1 Sol High integrated and delta Review: **P2 CLOSED,
P1=0/P2=0/P3=0**. This root cause used one substantive product repair.
Explicit missing-confirmation restart coverage remains a nonblocking test
recommendation; that original refusal branch was unchanged.

Root lint/typecheck/production build and diff check PASS, exit0; logs:
`m3-reconcile-lint.log`, `m3-reconcile-typecheck.log`, `m3-reconcile-build.log`.

## Broader baseline and retained limitations

No product source was modified during the initial frozen broad regression.
Contracts28 PASS, exit0 (`test-results/m3-delivery-contracts.log`). API baseline
completed **2788 PASS /155 files**, exit0,658.89s, with original worker/timeout
settings and only three explicitly
deferred old LC2 native experiment files excluded:

- `test/whitelist-native.test.ts`
- `test/whitelist-acl-session-native.test.ts`
- `test/whitelist-sibling-retention-native.test.ts`

This is an explicitly scoped broad regression, **not a whole-repository PASS**.
The excluded tests and historical failures remain intact. Original CLI/log:
`test-results/m3-delivery-api.log`. This baseline predates the repair and must
be read together with the subsequent affected150 PASS, not misrepresented as
a new complete post-repair full run. Web236 PASS/38 files, exit0:
`test-results/m3-delivery-web.log`; UI/contracts source unchanged in this repair.
Prior three-width non-timing browser evidence remains historical for attempt3;
it is not a fresh browser verification of this changed startup path. No browser
rerun or real Minecraft/mod-load test occurred in this slice.

Whole-M3 full-repository regression, advanced Astra Gate, actual Forge/NeoForge
mod loading and new-loader lifecycle extensions are still PENDING/NOT RUN.
No whole-M3 ENGINEERING PASS or real acceptance PASS is claimed.

No Minecraft launch, P7/network/system changes, native LC2 rerun or Git action.
Git upload previously requested by the user remains unfinished: automatic
approval could not complete commit review due to usage limits; no commit/push
was executed. Existing index and uncommitted work are preserved.
