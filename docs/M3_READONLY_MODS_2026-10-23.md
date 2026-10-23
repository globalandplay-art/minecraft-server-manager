# M3-A — Forge / NeoForge read-only mod inventory

Later update: [M3-B](./M3_MOD_METADATA_2026-10-23.md) adds bounded declared
TOML metadata/search with its own evidence. Statements below about metadata
not being parsed describe M3-A only. Writes remain closed in both slices.

**Bounded read-only functionality and engineering checks: PASS.**
M3 overall remains IN PROGRESS; no Forge/NeoForge mutation support is claimed.

Final independent source/evidence review also completed with zero open
P1/P2/P3: final three-width receipts, six successful addon GETs, seven closed
Managers, zero launches/writes, final screenshot and static/test logs verified.

## Delivered scope

The existing Addons API and UI now expose a read-only file inventory for
registered Forge and NeoForge instances. The Mods navigation entry is marked
read-only. Users can list JAR filenames, containing directory, byte size and
SHA-256; search filenames and manually refresh. Directory location is shown
as `mods` or `disabled-mods`, not a claim of actual runtime loading.

Forge/NeoForge metadata is not parsed yet: name/version/loader and compatibility
remain unknown. Embedded Fabric metadata is deliberately not trusted as Forge
metadata. Invalid JAR structures remain explicit. There is no JAR execution,
recursive folder scanning, arbitrary path input or new endpoint/framework.

## Boundary

`addonProfile()` remains Paper/Fabric-only and is still used by all existing
upload/install/lifecycle services. Only the inventory selects a separate
Forge/NeoForge read profile. `writeSupported=false` even when the Manager has
transaction support. Direct upload, install and trash requests return501;
tests verify server bytes and Manager directory entries remain unchanged.

The separate React read-only component has no mutation hooks or controls.
Existing Paper/Fabric Addons behavior remains in its managed component. No
server capability or public contract enum was widened to authorize writes.

Existing file containment, directory/file identity rechecks, hardlink checks,
size/count/allocation bounds and the one-scan busy guard are reused unchanged.
Failures do not become an empty successful inventory. A failed refresh labels
retained data as stale; pending reads hide cached entries/counts. Query keys
are separated from managed Addons and scoped by instance/loader/version.

## Validation

- Affected API inventory/upload/install/lifecycle:109 PASS /5 files.
- After adding explicit mutation-route negatives, the affected API file
  passed6/6; its earlier fixture-only404-vs501 failure is retained.
- Complete final Web suite:228 PASS /38 files, exit0.
- Final root lint/typecheck/production build: exit0.
- Diff check recorded in `test-results/m3-readonly-diff-final.log`.
- Independent Sol High review used6Sol fallback after6.1 reviewer capacity
  was unavailable. Initial cache P2 and mutation-coverage P3 were corrected;
  final source/delta review has zero open P1/P2/P3 in this bounded scope.
- Real browser opt-in reuses `m21-neoforge-registration-browser.mjs` with
  `LT_M3_READONLY_INVENTORY=1`: real Chrome/Vite/Fastify, fresh contained files,
  two inert test JARs, long-name wrapping/search/refresh and no write controls.
  Final post-icon run `m12-real-707f4a7f-a9f2-417c-8f3c-b93d9bc80ad7`:
  **360/768/1440 PASS**, exit0. Seven Manager sessions closed with zero
  launch attempts/children and zero addon mutation requests; source inputs
  unchanged, copied files preserved, ports released and no cleanup error.
  `m21-report.json`, `readonly-mods-<width>.png` and Playwright traces remain
  under its ignored test-results directory. Mobile refresh icon was visually
  checked on the final screenshot.

Retained logs: `test-results/m3-readonly-api-v1.log`, `-api-v2.log`,
`-api-v3.log`, `-web-v3.log`, `-web-final.log`, final lint/typecheck/build logs
and the browser reports. Contracts did not change; the unchanged M2.1
contracts26PASS remains applicable. No new full-repository API PASS or M3
overall Final PASS is claimed. Deferred LC2 native suites were not rerun.

## Fixed issues / retained failures

1. Cache review: a managed-loader/same-ID cached list could be presented under
   a new directory label. The read profile now has its own loader-scoped key,
   refresh-on-mount and no cached entries while fetching; regression coverage
   preloads both managed and read-only caches.
2. API negative-test fixture initially did not register write routes, yielding
   404 instead of the required501. The fixture now supplies a separate Manager
   root and real transaction journal, proving actual route rejection without
   weakening the501 assertion or product guards.
3. Initial real run `m12-real-bef071d2-f25e-4e5a-9356-eeb79810d464` remains
   BLOCKED: width360 passed, then a readonly GET returned429 (`ERR_ASSERTION`,
   `429 !== 200`). All owned processes closed, sources unchanged, zero addon
   writes and ports released. No Minecraft was launched.
4. The observed StrictMode observer teardown cancelled a signal-consuming
   query while backend scanning continued. The second mount started another
   GET into the unchanged scan-busy guard. Attempt1 retains the in-flight
   bounded GET across remounts (30s cache, no consumed cancellation signal),
   preserving instance-scoped results. Existing5s HTTP timeout is unchanged.
   Only `ADDON_SCAN_BUSY` allows at most two read retries; mutation behavior
   is untouched. Manual refresh uses `cancelRefetch:false`.
5. Deterministic StrictMode/different-instance late-result tests passed.
   Attempt1 real run `m12-real-1015137a-38da-4584-9542-46790081cb22` passed
   360/768/1440, seven closed Managers, zero launches/writes, source unchanged
   and ports released. Then a mobile screenshot revealed a blank text-only
   refresh button; the existing RefreshCw icon was added with an SVG assertion.
   Final browser verification covers this cosmetic delta separately; it is
   not another fix attempt for the already verified429 cause.

## Limits / next slice

- No Forge/NeoForge upload/install/disable/enable/trash/restore yet. These
  controls remain closed until loader metadata and adapter write identity are
  validated and reviewed.
- No actual Minecraft mod load acceptance in M3-A; all browser EULA fixtures
  remain false and a pre-spawn fixture guard forbids Minecraft launches.
- Metadata formats/version rules are the next slice, then reuse existing
  staging/install/lifecycle transactions. Do not rebuild the framework.
- Normal instance switching and late different-ID results are isolated.
  Same-ID/same-type/version live external root remapping during an unfinished
  read is not identifiable from current public ServerSummary; normal UI
  removal clears queries. Reload after external configuration/Manager changes.
- M2.1 strict environment/artifact diagnostics and prior full-regression
  failures remain independent and unchanged. P7 stays STOPPED.

No commit/push/PR, system/network changes, original server/world writes or
Minecraft launch. M3 overall remains IN PROGRESS.
