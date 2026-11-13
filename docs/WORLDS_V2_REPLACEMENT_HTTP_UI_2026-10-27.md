# Worlds V2 first replacement HTTP/UI — IN PROGRESS

## Implemented bounded scope

App-owned recovery/shutdown wiring accepted independently by Sol High0/0/0:
203 affected API tests, then1 focused test for the mechanical lint-only capture
change (83NOTRUN). Startup retains replacement recovery; close joins actual
paused proofs before observer disposal. No automatic startup settlement/replay.

First-transition replacement routes now use the same runtime operations,
upload lease, backup provider and catalog. Existing replacement-plan URL retained.
Trusted BuildAppOptions.worldReplacementExecution enables the execution candidate;
main does NOT set this option. Default preview remains false and execution/
verification routes are absent (404), preserving the historical boundary.
No request field or production environment variable can enable this flag.

Strict eight-field approval, UUID Idempotency-Key, exact current-world name,
file/content/catalog revisions and existing request/auth guards remain. Explicit
verification accepts only operationId and intent=confirm-current-state; backend
builds the proof. Waiting rechecks session and mutation authority. Interrupted
Manager outcomes require explicit verification, never a new data operation.

React replacement section is separate from the default independent import.
It persists original request/key before sending, isolates each instance, preserves
drafts on language changes, never automatically resends, and checks returned
operation ownership. Saved success alone is not UI success: user explicitly
verifies, then a fresh list must show the new active identity and old retired
identity. Storage conflicts preserve evidence, including conflicting operationId.
New text supports zh-CN/en/ja. Existing untranslated surrounding pages remain debt.

## Evidence and preserved failures

- HTTP focused initial5PASS, expanded security9PASS/84NOTRUN.
- Initial affected211PASS/1FAIL: old default route-absence test received400 instead
  of404. Fixed product route registration, not the historical assertion.
- Final affected212PASS/0FAIL/0pending across replacement/import/startup modules:
  `test-results/worlds-v2-replacement-http-final-2026-10-27.json`.
- Web initial6PASS/2FAIL were tests expecting raw exceptions (presentation correctly
  localizes them) and switching before a deferred call started. Test setup fixed.
  Next8PASS/8FAIL: old isolated upload tests lacked the app QueryClientProvider;
  supplied provider without deleting old checks. Those failures are preserved.
- Independent P3 found storage operationId conflict handling; fixed and tested.
- Final affected Web49PASS/0FAIL/0pending across4files:
  `test-results/worlds-v2-replacement-web-final-2026-10-27.json`.
- Independent HTTP+UI bounded review0/0/0; browser evidence readback pending.
- Contracts34PASS, API/Web typecheck, scoped ESLint, all-workspace build and diff
  passed. Vite's existing >500kB main-chunk warning remains; not silently changed.

Real React + Fastify browser, synthetic worlds (NO Java), three fresh instances:
360 light7.4s,768 dark6.5s,1440 light6.7s; all3PASS. Language switching checked
en/ja/zh-CN without losing confirmation. Actual HTTP/files/journals used, no
intercepted fake responses. All three saved fresh IDs and retired originals.
`test-results/worlds-v2-replacement-browser-6744b3a7-f36b-4b39-bb71-053ead60c0e7.json`.
Cleanup: `test-results/worlds-v2-browser-cleanup-ec5d92e6-c609-45d1-b1d5-d2bf7df5cb8e.json`;
both owned children closed, forced0. Screenshots retained in report artifacts.

Independent Sol High accepted the browser source/evidence0/0/0. Synthetic fixture
closed.json also confirms managerClosed=true/javaAttempts=0. Updated-candidate
independent OS reconstruction5PASS at
`test-results/worlds-v2-replacement-recovery-crash-a1dbd167-479c-427a-9dd9-bdc914493c6b/result.json`.

## Real isolated Vanilla replacement

After independent execution-preflight review0/0/0, existing owned real harness
ran --execute --replacement. Only verified authorized source JAR/already accepted
EULA were copied into a fresh UUID test root; no original world read or changed.
Generated/stopped real world snapshot uploaded, then an old-only marker added to
the isolated current world. Actual API replacement installed the earlier snapshot,
kept the original marker/tree, and assigned a fresh world ID. Explicit proof passed.
In-process Manager reconstruction stayed gated until explicit proof (NOT an OS
restart claim). The replacement then actually loaded, RCON list worked, world
saved and stopped, and post-save mutable current-state verification passed.

Result: `test-results/worlds-v2-replacement-real-1a1ac29b-0ee4-442e-a033-57a49e4003e6/result.json`.
Business PASS,2Java starts, both exit0/signalnull, forced0/allclosed/Managerclosed.
Original source JAR/EULA/config/authorization unchanged. All owned evidence kept.
Source scope is restoring a generated isolated world snapshot, not arbitrary
world compatibility. No real players/authentication or other loaders certified.
WARN/ERROR logs retained: WMI/Perflib, Minecraft service discovery and JNA/Unsafe
warnings observed. No registry/network/Java-flag changes or new diagnostic waiver.
diagnostics=NOT_ASSESSED, not strict diagnostics or whole-stage PASS. Final
independent real-result evidence readback accepted0/0/0 below.

## Remaining boundaries

Mixed live-history and ordinary import recovery causes remain gated; do not clear
them to pass a replacement-only proof. Production main remains disabled. Real
Minecraft first-replacement business acceptance passed above, bounded evidence
readback accepted below. Manager in-process
reconstruction is distinct from the separately tested independent OS processes.
No final V2/Phase1 or arbitrary-world compatibility claim. New-world identity,
restic, scheduling/queue/retention, full four-tab UI and hot backup remain open.

## Final bounded evidence readback

Independent Sol High accepted real first-replacement business0/0/0, including
50 retained-tree/guard file hashes, two normal owned Java exits and source
invariance. Current OS5-boundary report30source hashes matched. This does not
waive diagnostic warnings or permit unrelated versions/layouts.

Broader integration checks (no product changes after the above candidate):
full Web334PASS/0FAIL/0pending; Contracts34PASS; root lint/typecheck/build and
diff exit0. API whole-repository regression NOT RUN; affected212PASS is not a
whole-API claim. Existing activation React/Fastify browser regression also3PASS
(360/768/1440), report
`test-results/worlds-v2-activation-browser-662e69d6-ed18-4565-94e3-434fb9f224e3.json`;
cleanup39f3af3d-1bf8-4733-be30-deca97de376e, owned children closed/forced0.
Original failed reports remain retained. No Git/system/network changes.

Final candidate readback: independent Sol High0/0/0, bounded ACCEPT. Artifact
`test-results/worlds-v2-replacement-runtime-candidate-2026-10-27.json` has52
source/test hashes and15report/log hashes;67/67 matched. It does not certify all
API tests, Phase1 completion, production enablement or V2 Final. Remaining Gates
above stay OPEN. No source/report changes followed this readback.
