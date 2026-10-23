# M3-B — Forge / NeoForge declared mod metadata

Bounded read-only engineering delivery: PASS. M3 overall: IN PROGRESS.
Branch: `codex/phase-4-players-properties`; baseline HEAD:
`2f084f37e8585a046d15e57896e22f0405a76ad1`. Changes remain uncommitted.

## Delivered behavior

The existing inventory endpoint and Mods page now read Forge
`META-INF/mods.toml` and NeoForge `META-INF/neoforge.mods.toml` through the
existing bounded safe ZIP reader. One JAR may declare multiple mods; each
mod's ID, name, version and dependencies are displayed and searchable.
Raw loader and dependency version ranges are declarations, not evaluated
compatibility. Missing values remain unknown; `${file.jarVersion}` remains
visibly unexpanded. No manifest substitution, JAR execution or recursive
configuration scan is performed.

Inventory items optionally expose `declaredMetadata` with loader/source,
modLoader/loaderVersion, and bounded mods/dependencies. The legacy top-level
loader remains null for these formats. Concrete single-mod versions may be
projected at top level; multi-mod or unresolved versions are not fabricated.
`compatibility=unknown` and `writeSupported=false` remain explicit.
Upload/trash DTOs and the Paper/Fabric-only write profile are unchanged.
No new endpoint or arbitrary file-path input is introduced.

## Parsing and resource limits

Pinned `smol-toml@1.9.1` parses inert TOML, with fatal UTF-8 handling,
256KiB descriptor limit, maximum depth32, parsed graph limit8192 values,
32 mods, 64 dependencies per mod, bounded strings and unsafe-key rejection.
Only plain/null-prototype tables are accepted; datetime objects cannot
masquerade as tables. Dependency lookup uses own-property checks.
Serialized declared metadata across an inventory is capped at1MiB; excess
fails closed with `ADDON_INVENTORY_UNSAFE`, without partial truncation.
Foreign descriptors do not grant another loader's compatibility.

Format references: [Forge mod files](https://docs.minecraftforge.net/en/latest/gettingstarted/modfiles/),
[NeoForge mod files](https://docs.neoforged.net/docs/gettingstarted/modfiles/),
[parser source](https://github.com/squirrelchat/smol-toml).
The consulted NeoForge documentation describes26.1: it supports the format
design, not a claim that arbitrary26.3 mods are compatible or loadable.

## Verification and evidence

All logs below are preserved under ignored `test-results/`:

| Check | Result / evidence |
| --- | --- |
| Initial affected API including upload/install/lifecycle |137 PASS /6 files, `m3-metadata-api-v1.log` |
| Additional inventory aggregate-budget verification |24 PASS, `m3-metadata-budget-v1.log` |
| Final parser/inventory/API delta |57 PASS /3 files, `m3-metadata-delta-final.log` |
| Complete contracts |27 PASS /7 files, `m3-metadata-contracts-v1.log` |
| Complete Web |229 PASS /38 files, `m3-metadata-web-final.log` |
| Final affected lint, root typecheck/build |exit0; `m3-metadata-lint-delta.log`, `m3-metadata-typecheck-final.log`, `m3-metadata-build-final.log` |
| Diff whitespace check |exit0, repeated after documentation |
| Independent Sol High source/delta/evidence review |zero open P1/P2/P3; Sol6 fallback for unavailable6.1 |

These are scoped runs, not additive counts from one new complete API run.
No new full API regression or unchanged legacy native stress run is claimed.
Existing jsdom navigation stderr remains in the passing Web log.

Actual Chrome → Vite → Fastify browser run:
`m12-real-1d1f2d1a-5c36-4e38-a172-9019fdbf46a6`, report `m21-report.json`.
360/768/1440 PASS, with raw dependency/UI range assertions, multiple-mod
names, unexpanded version and name/ID search. Screenshots and traces remain
in that run directory. Seven Manager sessions closed; zero Minecraft
launches, zero addon mutations, source inputs unchanged and ports released.

The browser run preceded the final plain-table/own-property parser correction.
Its ordinary `sample` table fixture has equivalent behavior under both
predicates; the independent reviewer accepted the final57-test delta covering
the changed datetime/constructor branches without repeating the browser.
Do not describe the earlier browser as literally run on the final source.

## Preserved failures and limitations

An optional read-only probe of the installed NeoForge26.3.0.95 universal
core JAR was rejected by the unchanged ZIP reader before TOML parsing:
409 `ADDON_JAR_UNSAFE`, reason `addon-jar-unsafe`. Raw output is preserved in
`test-results/m3-metadata-installed-readonly.json` (raw log despite suffix,
not a successful JSON receipt). Exact ZIP rejection condition is UNKNOWN;
fix attempts0. No bypass, file modification or server launch followed.
This core artifact is not a user-mod load acceptance fixture, and its
rejection does not prove all NeoForge mods invalid. Real user-mod loading
and broad artifact compatibility remain NOT RUN.

Root dependency audit exited1 with16 findings:2 critical,11 high,2 moderate,
1 low, preserved in `test-results/m3-metadata-audit.json`. The only new locked
package is smol-toml1.9.1, not named by this audit; findings concern existing
locked packages, including critical concurrently/shell-quote. No automatic
dependency upgrade was attempted. Release/security triage remains required;
this bounded delivery is not a repository security or release Gate PASS.
M2.1 strict diagnostics and historical full-regression/LC2 failures remain.

## Next boundary

Review exact loader compatibility and trusted Addon identity integration
before extending existing upload/install/lifecycle transactions. Do not
enable write controls solely because metadata parses. Real mod-load testing
needs its own identified/authorized fixture and evidence. P7 remains STOPPED.
No commit, push, PR, Minecraft launch or original-world operation occurred.
