# M2.1 NeoForge offline preparation completed

## Current checkpoint

**Offline cache complete; official NeoForge26.3.0.95 installation PASS (exit0).**
**LT production adapter NOT IMPLEMENTED; real NeoForge lifecycle NOT RUN.**

The user supplied the three missing artifacts on the desktop. All three matched
the previously recorded official SHA-1 values, were descriptor-read and copied
without changing/deleting their source files. No retry of the failed downloads
or system/TLS configuration change was necessary.

All30 unique dependencies from the checksum-verified official installer's two
metadata documents were rechecked. The existing Vanilla26.3 bundle still matched
the registered test-JAR SHA-256. The official installer itself was revalidated
against SHA-256
`59ed4c58cc5b49e3df876658196d34c23184f5f73986e352508cdbddc88aa7fb`.

It ran only in the previously prepared short isolated test directory, completed
both server processors, generated patched Minecraft and exited0. No Minecraft
server was launched, EULA newly accepted, original registration/world modified,
or desktop source file deleted. No Java process remained afterward.

## Exact evidence

Ignored preparation evidence:
`.manager/m21-neoforge-install-04159990-16ed-4e7d-a651-05ccb76406b2/offline-resume-75db8e7d-c58e-49a8-94bf-c66ffd45354c`.

- `offline-import.json`: three files imported, source hashes unchanged.
- `cache-recheck.json`:30 official-metadata library checksums and original
  Vanilla bundle verified before installer execution.
- `installer-intent.json`, `installer.log`, `installer-result.json`: actual
  isolated official installation, exit0, no Minecraft launch.
- `installed-inventory.json`: static installed inventory and per-file hashes/
  identities. This is not a runtime/recovery acceptance report.
- `GameLocator.log`, `RequiredSystemFiles.log`, `LibraryFinder.log` and
  `StartupArgs.log`: installed loader12.0.12 bytecode for subsequent dependency
  closure review, not executed loader/server code.

Historical download/path failures and their reports remain untouched. This
new checkpoint supersedes the current missing-dependency blocker only.

## Installed inventory validation

The installed run.bat and win_args match the corresponding files embedded in
the official installer exactly. Their SHA-256 values are:

- run.bat: `daa5720555175902c75914dd82bf8d602d39ee9a53500a27f52e99643c968c3a`
- win_args: `cace6e653aa57f46d99859304a74f7d01c71223ad485a1ff79490d3674e2161f`

The ten-line Windows argument descriptor has fixed opens/exports, IPv6 and
libraryDirectory settings,66 unique classpath JARs, the dedicated
`net.neoforged.fml.startup.Server` main and exact NeoForge26.3.0.95 /
Minecraft26.3 / NeoForm1 values. All66 files and the two additional patched
Minecraft/universal artifacts exist and were identity/SHA-inventoried with
plain canonical ancestor directories and regular single-link file checks.
Patched Minecraft version.json reports26.3 and Java25.

These68 observed file hashes establish this inventory's identity, not a new
claim that every transitive runtime load is already closed or reviewed.
`fullRuntimeClosure=PENDING_REVIEW` remains explicit.

## Next implementation boundary

Complete the loader dependency-closure review, then implement the narrowly
supported NeoForge direct-main/classpath descriptor and connect the existing
registration/start revalidation/runtime. Do not execute run.bat/@argfiles,
user_jvm_args, an installer or Client main as production startup. Reuse existing
process supervision, locks, lifecycle operations and connection ownership.

Then run focused negative/integration checks, independent review and fresh
isolated real NeoForge start/stop/restart evidence. Installation success must
not be called M2.1 or NeoForge lifecycle PASS.

No production source/test change, unrelated regression rerun, commit/push/PR,
M3 work or P7 work occurred in this preparation slice. Forge's existing bounded
BUSINESS PASS and all strict diagnostic/historical failures remain unchanged.
# Later adapter / real lifecycle update

The preparation-only statements below remain historical. Exact-version
NeoForge binding, independent pre-real review and fresh isolated lifecycle
BUSINESS PASS are now recorded in [real checkpoint](./M21_NEOFORGE_REAL_2026-10-23.md).
Strict diagnostics still BLOCKED; installation success alone was never PASS.
