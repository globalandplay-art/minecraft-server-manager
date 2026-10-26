# L1 continuation — Console and lifecycle localization

Date: 2026-10-25. This is a bounded integration checkpoint; **L1 remains IN
PROGRESS**, not FINAL PASS. Existing UI2/M3 reports describe their historical
candidates and remain unchanged. P7 STOPPED; no Git upload or Java launch.

## Implemented

- Console headings, search/filter/scroll controls, command form/help, validation,
  connection/replay explanations, no-data states and submission/result notices
  now render from shared zh-CN/en/ja resources. New-log count has English
  singular/plural forms; reconnect delay uses locale-aware number formatting.
- Start/stop/restart labels, confirmation dialog and its save/disconnect warning,
  operation progress/error/requery explanations and readiness reasons now switch
  at runtime. Unknown backend reason IDs remain visible.
- Validation stores a message key, so an already-visible error also changes
  language without losing invalid input or sending it.
- Fixed LT stream-client notices are localized at presentation through an exact
  allowlist; unknown server details are left verbatim. Stream reducer, WebSocket
  scheduling, auth and API implementations are unchanged.
- Raw Minecraft log text/RCON output, operation kind/step/state/error code and
  original backend error details remain unmodified. No command translation,
  reconnect, retry or lifecycle action is introduced by locale switching.

New resources are in `apps/web/src/i18n/console-lifecycle.ts`, merged by existing
`resources.ts`; presentation helper `console-notice.ts` has no transport access.
Modified production files: Console.tsx, LifecycleControls.tsx and readiness.ts.
Existing input limits, action guards, confirmation focus trap, same-key explicit
confirmation, retry:false and operation polling/reset dependencies are retained.

## Evidence

All paths below are under `test-results/`:

| Verification | Actual result | Evidence |
|---|---|---|
| Console/lifecycle/i18n focused tests |25 PASS,6 files, exit0|`l1-console-focused-final.log`|
| Web typecheck |PASS, exit0|`l1-console-typecheck-v3.log`|
| Web build (includes current test types) |PASS, exit0|`l1-console-build-final.log`|
| Root lint |PASS, exit0|`l1-console-lint-final.log`|
| Final browser-test-only lint |PASS, exit0|`l1-console-browser-lint-final.log`|
| Browser360/768/1440 |3 PASS,16.2s, exit0|`l1-workflow-browser-settled.log`|
| Diff check |PASS, exit0|`l1-console-diff-final.log`|

Tests assert current input/socket/dialog identity, preserved draft/raw strings,
zero automatic commands during locale changes, one intentional command request,
dynamic validation, retained cancel focus, readiness fallback and English plurals.
The intentionally submitted component-test command uses a Fake API response.

Browser tests use actual Chrome/Vite/React with explicitly Fake REST/WebSocket
fixtures. They test all three languages on Console, keep the exact raw log and
draft, confirm a stable socket count and zero mutating requests, and cancel a
localized restart dialog. This is not a real Minecraft command/lifecycle test.
The dialog locale change is driven programmatically through the existing
selector because its correctly modal backdrop blocks toolbar interaction.

Screenshots are in
`l1-workflow-browser-settled/l1-workflows-Console-and-confirmation-locale-integrity-{360,768,1440}-chrome/`:
`console-zh-CN-*.png`, `console-en-*.png`, `console-ja-*.png`, `restart-ja-*.png`.
The360px Japanese Console screenshot was visually checked after explicitly
scrolling to the document top before capture; command focus had caused earlier
full-page screenshots to show a misleading sticky-header position. Earlier
evidence remains intact; screenshot options do not change product behavior.

The first typecheck caught invalid test-only Testing Library `exact` options and
an overnarrow Map key type. They were fixed without weakening assertions;
`l1-console-typecheck-v2.log` is retained. Focused v1/v2 and browser v1/final
evidence also remain. Existing build chunk-size and console color-env advisories
were not suppressed. No legacy LC2 stress tests were run.

## Review and remaining work

Independent GPT-6.1 Sol High `/root/l1_console_review` compared this source with
HEAD, confirmed unchanged transport/guards and no current P1/P2/P3 in this slice.
An initial missing Console heading/eyebrow/operation-prefix translation was fixed
and reread. Final independent source/evidence readback confirms P1=0/P2=0/P3=0,
focused25/6 PASS and settled Chrome3 PASS; the reviewer inspected Japanese mobile
Console/restart and English desktop Console screenshots. This accepts only this
bounded integration, not full L1 final independent signoff.

There are now518 three-language resource keys. The lexical source inventory fell
from781 to682 Chinese literal candidates (`l1-inventory-current.json` versus
`l1-inventory-after-console.json`). These counts are NOT semantic coverage or a
percentage: raw/known technical strings and untranslated UI are both possible.

Next: whitelist/local-whitelist/candidate and operation notices, then add-ons and
world/backup/restore/import workflows, Crash Analysis and remaining presentation
errors/paused-remote copy. Backend/remote functionality stays untouched. Only at
full L1 delivery run the fresh full Web/appropriate affected regression and final
independent review; do not reuse this focused checkpoint as whole-L1 PASS.
