# LC1.1 dynamic configuration

**Current disposition:** LC1 scoped real business PASS. Perflib is separately
ENVIRONMENT/DEFERRED and does not negate successful configuration editing or
block unrelated M1 work. No whole-repository PASS is claimed; see
[independent Perflib attribution](./PERFLIB_INVESTIGATION_2026-10-21.md).

**Latest validation, 2026-10-21:** registered Vanilla real business checks PASS:
dynamic discovery, exact protected save, Manager restart replay and actual
difficulty/gamemode/player-limit effect. Complete real acceptance remains
BLOCKED by host Perflib `0x80070057`; no whole-project PASS. Original test files
restored and Java stopped. See [LC1/LC2 actual validation](./LC12_REAL_VALIDATION_2026-10-21.md).
Older NOT RUN/authorization/full-regression statements below remain historical.

**Current authorization (2026-10-21):** real LC1 testing on registered Vanilla 26.3 test instance `vanilla-26-3` is now covered by the user's [standing full local-operation grant](./TEST_INSTANCE_AUTHORIZATION_2026-10-21.md); no repeated launch/file/configuration approval is required there. The dated validation and NOT RUN evidence below remain historical facts, not an instruction to request authorization again.

## Scope and current Gate

Vanilla `server.properties` end-to-end candidate implemented and scoped validation passed. Final project Gate remains BLOCKED by the LC2 failures below; ENGINEERING PASS is NOT claimed. LC2 remains independently BLOCKED; LM1/LM2 status is unchanged. Phase 7 remote remains PAUSED. No commit/push/PR or real Minecraft acceptance is authorized.

## Implemented

- Existing registered-root, descriptor/identity checked PropertiesReader supplies one consistent snapshot. No client path/file selection reaches filesystem APIs.
- Public optional `discovery` extends the existing GET response, preserving old fields/revision/fieldRules. Source file ID is fixed; no absolute paths, file bytes or private snapshots are returned.
- Actual observed keys appear once, grouped as core/known/unknown. Core descriptions do not imply that absent keys exist or have migrated. No migration claim is made without version evidence.
- Up to512 public fields,128-character keys,1024-character string values; omitted sensitive/unsupported/over-limit entries are counted, not deleted. `rawValue` is the Java-decoded string before type inference, not the original byte/escape spelling. Original bytes are retained only in the existing backend transaction.
- Exact true/false and conservative finite decimal values are display candidates only. Unknown fields, remote switches and unknown versions never gain write permissions through inference.
- Existing Vanilla26.3 six-field write rules are reused: motd, max-players, difficulty, gamemode, pvp, online-mode. Online-mode=false still needs explicit offline identity confirmation. A target must actually exist once and have a safe value; removed/duplicate targets are rejected before intent creation.
- Existing protection guard, journal, revision, idempotency, lock, stopped/ownership/active-world/recovery gates and incremental text patching remain in place. Unrelated unknown entries, comments, order, escapes and mixed newlines are not regenerated.
- Revisions now include file identity as well as server/root/content binding, detecting same-content atomic replacement.
- Frontend reuses PropertiesPage/Fields; dynamic fields support Chinese/key search and fixed file filter. Verified MOTD always uses a text control even when its current value resembles a number/boolean.
- Page mount/focus/manual refresh and visible-page30-second polling observe changes. No persistent filesystem watcher or background scanning service is added. Draft and disk are not automatically overwritten; added/modified/removed keys and file replacement are compared. Explicit comparison acceptance resets save/offline confirmation. Invalidated drafts remain visible and block writes until explicitly discarded, including after another refresh.
- Conventional credential keys, known copied secret values, URL userinfo and private absolute paths are withheld from discovery/legacy fields and rejected in proposed writes. This is conservative bounded detection, not a guarantee to recognize arbitrary unknown binary/unstructured secrets.

## Compatibility

| Provider/config | Discovery | Editing |
| --- | --- | --- |
| Vanilla26.3 server.properties | Implemented | Six already verified fields only |
| Other registered local server.properties versions/types | Read-only projection through existing registration/adapter capability | Unavailable |
| Paper YAML / Spigot YAML | Not implemented in this slice | Unavailable |
| Fabric/Forge/NeoForge mod directories/config formats | Not implemented; no recursive scanning or mod execution | Unavailable |

Unknown versions do not inherit26.3 write rules. Paper/Spigot YAML adapters and separately verified YAML parsing/editing remain later work after the Vanilla Gate. This is not full Paper/Fabric/mod configuration support.

## Historical issues retained

- Initial contract insertion had a TypeScript syntax error caused by string replacement expansion; corrected without changing strictness.
- API key-list assertion was updated for the deliberate additive discovery contract; existing offline-confirmation fixture now includes online-mode explicitly rather than relying on insertion of an absent key.
- Existing frontend conflict tests were extended to explicitly accept the comparison before re-confirming save.
- Initial browser fixture visited `/properties`; the real route is `/settings`. Corrected the fixture and selected the original-key code node explicitly; no timeout/business assertion weakening.
- Independent review found conventional secret aliases, hidden invalidated drafts, inferred MOTD controls, and refresh silently dropping blocked drafts. Necessary fixes and regressions are included; final delta signoff is recorded below when complete.
- Historical LC2 native/capacity failures and all private evidence remain unchanged. They are not automatically LC1.1 product defects or permission to weaken gates.

## Validation

Final full `npm.cmd run check`: exit1. Contracts18PASS; API2510PASS/12FAIL across146files (143pass/3fail); Web207PASS/35files. API duration645.11seconds. The raw failure output contains14 reports because two cleanup errors are reported in addition to the12 failed tests; do not count this as14 distinct product defects.

| Failed file | Tests failed | Actual evidence |
| --- | --- | --- |
| whitelist-acl-session-native.test.ts | 7 | Prototype assertion expected queries23/targets63, observed17/51; secondary CLEANUP_BLOCKED; dependent cases PRIOR_NATIVE_FAILURE_STOP. This specific counter mismatch is observed, not repaired or classified as a harmless assertion error. |
| whitelist-native.test.ts | 3 | NATIVE_OBSERVATION_DEADLINE; guard-created45570ms, then original50s deadline; secondary CLEANUP_BLOCKED; dependent cases stopped. |
| whitelist-physical-capacity.test.ts | 2 | PHYSICAL_CAPACITY_OBSERVATION_DEADLINE; replay45050ms, original50s deadline; dependent PRIOR_PHYSICAL_CAPACITY_FAILURE_STOP. |

No LC1.1 property/discovery test failed in the full run. The12 failures do not turn the earlier8 failures into resolved issues; they are this run's actual result. No native repair, timeout increase, assertion weakening or test skip was performed for LC1.1. Relevant earlier native repair counters remain unchanged.

Focused candidate evidence: initial API properties/discovery integration124PASS/5files; subsequent sensitivity/identity affected set78PASS/3files (overlaps, do not sum). Final Web full207PASS includes the last refresh/blocked-draft regression. Dedicated discovery UI, MOTD string grammar, copied-secret suppression, same-content file replacement, missing/duplicate target and zero-intent tests are included.

Final independent GPT-6.1 Sol High scoped source/delta review: P1=0/P2=0/P3=0. All findings above were fixed and the final on-disk refresh implementation was verified by the independent reviewer. This is source signoff, not a substitute for the failed project Gate.

Final browser360/768/1440:3PASS/exit0,9.0seconds. Covers actual Settings route, metadata-discovered additions/removals, draft preservation, external comparison, unknown read-only fields, exact PATCH body/revision/CSRF, operation-confirmed save and no horizontal overflow. Fake in-process API only; not real Minecraft acceptance.

Final project lint, project typecheck, all-workspace production build: PASS/exit0. Main frontend chunk419.80kB/gzip127.45kB; Properties chunk15.55kB/gzip6.26kB. `git diff --check`:PASS. The full check's initial lint/typecheck preceded the final Web-only refresh correction; these final separate checks cover that delta. API/contract source was unchanged during the full run; Web full executed after the correction. No second full API run was performed.

Raw logs and result: ignored `test-results/lc11-final-2f864112-b6db-4f90-8a6d-cfc14e79f8dc/`. Historical failed browser traces are retained under ignored lc11-browser UUID directories; final browser traces are a new run, not an overwrite. Post-validation fingerprints are not represented as a pre-run freeze.

The directly owned Vite session was explicitly stopped. A read-only global CIM inventory was denied with0x80041003; no system repair or unknown-process termination was attempted. Native failed fixtures remain retained with their CLEANUP_BLOCKED evidence; global helper absence is NOT claimed.

Real Minecraft acceptance NOT RUN. Paper/Spigot YAML and mod configuration adapters NOT IMPLEMENTED. No commit/push/PR, real server/world mutation, remote activation or Phase7 resumption.
