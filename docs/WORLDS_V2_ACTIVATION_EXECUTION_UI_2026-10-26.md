# World activation execution UI — 2026-10-26

Status: IN PROGRESS; main remains default-off. No V2 final acceptance claimed.

## Product implementation

- The existing library now offers target selection, exact target-name entry and
  a confirmation dialog. Backend plans bind the original/current/target revisions;
  only the approval DTO is sent, without paths or automatic stopping/starting.
- The original approval and UUID key are stored in sessionStorage before the
  first POST. Double clicks are synchronously guarded. POST retry is disabled.
  Unknown results retain that request; manual acceptance checks reuse the exact
  body/key. Known operation IDs resume through GET only after a page remount.
- Corrupt/unreadable stored requests block new actions and remain untouched.
  Instance changes isolate drafts, queries and late responses; language changes
  retain selected worlds and confirmation input. All new copy has three locales.
- Success requires a fresh successful operation GET, correct operation ID,
  server, kind and target resource, followed by a fresh ready catalog with the
  expected active ID and present target/name. Cached success, HTTP 202, errors,
  interrupted operations or contradictory catalogs cannot release the record.
- Fresh terminal results invalidate the current instance's world/library view.
  Actual Minecraft startup/loading is explicitly not certified by the UI.

## Safety review corrections

Independent GPT-6.1 Sol High found two P2 issues in the candidate: stale cached
operation success, and the existing general 24-hour idempotency expiry allowing
an old browser request to become new. Both were fixed and independently closed
for that source checkpoint (P1/P2/P3=0). World activation keys now remain bound
to stored operations during initialization and dispatch, matching the existing
permanent whitelist approach. Different approvals conflict; ambiguous old keys
mapping to multiple operations fail closed. Other operation TTLs are unchanged.
There is no client-clock-based claim of permanent idempotency or protection
against deletion of all local evidence.

The reviewer subsequently found a further P2 in the production multi-import
composition: an untouched import was sent through the first-only supersession
hook after other worlds had multiple activations. The hook now classifies it as
not superseded, preserving the original byte-for-byte birth/upload checks.
Affected imports still cannot use first-only recovery for a repeated history;
journal issues still reject. Whole-history protection remains in the caller.
The reviewer initially became usage-limited; that PENDING interval is preserved
here. After its stated reset time, independent GPT-6.1 Sol High completed the
final source/evidence delta review: **P1=0/P2=0/P3=0**. It closed this P2 and
verified actual browser reports/screenshots/cleanup and current-source OS
recovery, including 22/22 source hashes. This signs the synthetic execution UI
slice only, not main exposure, real Minecraft or V2 final acceptance.

## Actual verification and retained failures

- First frontend run: 26 PASS/1 FAIL, exit 1; the interrupted test's broad text
  locator matched both a state label and the detailed alert. This was corrected
  to assert the detailed alert. No production safety assertion was removed.
- Next JSON report: `test-results/worlds-v2-activation-ui-2026-10-26.json`,
  29 PASS/2 FAIL, retained. The tests needed to await mutation dispatch and use
  the existing ApiClientError display contract. Their no-replay/no-clear checks
  remain. Final frontend report:
  `test-results/worlds-v2-activation-ui-final-2026-10-26.json`, 31 PASS, exit 0.
- `test-results/worlds-v2-activation-idempotency-2026-10-26.json`: 10 PASS,
  idempotency and existing admission tests, exit 0. Service reinitialization in
  these tests is not claimed as an OS-process restart.
- `test-results/worlds-v2-activation-ui-api-2026-10-26.json`: 148 PASS in five
  affected files, exit 0, before the final untouched-import fix. Final affected
  history/import/idempotency rerun: 133 PASS/0 FAIL/0 pending across three files,
  exit 0, `test-results/worlds-v2-multiimport-final-2026-10-26.json`; not merged
  into the earlier 148 count.
- API/Web typecheck, Web production build, scoped ESLint passed. Build retains
  its nonfatal >500kB chunk warning. Final diff check is recorded at handoff.

## Browser evidence

Actual Chrome + React + Fastify + application services + synthetic NBT and real
isolated files/journals, not mocked HTTP responses and not real Minecraft.
Configuration: `tests/worlds-v2-activation.config.ts`.

First run: 0 PASS/3 FAIL, exit 1, at the exact `getByLabel` selector (the accessible
combobox existed but the wrapping label included option text). No mutation was
sent. The strict accessible-role selector now targets the same combobox/name.
The timeout remains 30000ms. Raw report is retained under
`tests/test-results/worlds-v2-activation-browser-2026-10-26.json` and screenshots/
traces under `test-results/worlds-v2-activation-browser-artifacts/`.
Windows shell-wrapper teardown did not close its two known test Node processes;
after all tests ended they were terminated by verified PID and start time. No
Minecraft was started and no uncertain files were removed. Subsequent harness
uses shell-free owned Node children and private IPC shutdown with bounded joins.

Final run: **360/768/1440 PASS**, 3 tests, exit 0, 23.3s; original 30s assertion
unchanged. Each performed a distinct world switch through the UI, Japanese/
English switching with retained input, real API active-ID verification, Done,
and page reload. Report:
`tests/test-results/worlds-v2-activation-browser-r2-2026-10-26.json`.
Artifacts: `test-results/worlds-v2-activation-browser-r2-artifacts/` and
`test-results/worlds-v2-activation-{360,768,1440}.png`.
Cleanup: `test-results/worlds-v2-browser-cleanup-r2-2026-10-26.json` confirms both
owned children closed, zero forced kills; Manager exit 0. The fresh fixture's
`closed.json` confirms Manager close and zero Java starts/stops. Listening-port
checks afterward found both test ports closed. Test roots/evidence are retained.

## Remaining boundary

Updated current-source OS-process evidence:
`test-results/worlds-v2-repeated-crash-d3d623ae-7051-4a7c-85a3-4bb86feea9bd/result.json`.
All four boundaries PASS, exit 0; two partial heads remain interrupted/gated,
two completed heads become succeeded with the exact resource and own gate
cleared. Every probe reports server bytes unchanged; all owned child processes
closed; zero Java starts. The report includes 22 source SHA-256 values including
the modified operation service. This is actual independent OS Node processes,
not a full Fastify process restart or Minecraft loading proof.

Independent delta review is complete. Authorized real Minecraft world-loading
and whole-stage acceptance remain outstanding. A fresh-copy real harness is
written and statically checked; pre-execution review and actual execution are
required before claiming results. Do not enable main based on this document.
No real Minecraft/worlds, Git publication, P7 or legacy LC2 native experiments.
