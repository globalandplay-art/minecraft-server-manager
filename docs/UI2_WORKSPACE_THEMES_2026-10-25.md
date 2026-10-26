# UI2 — LT Workspace Dual Themes

Date: 2026-10-25 (Asia/Shanghai).

**UI2 FINAL PASS — LT Workspace Dual Themes**

## Candidate and scope

Branch `codex/phase-4-players-properties`; HEAD
`9f7cf498940b8e8c357b44ba1da8d201751463e4` plus preserved uncommitted L1/UI2
work. This is a frontend appearance delivery, not a new M3 acceptance or remote
access implementation. M3 original strict diagnostics/risk evidence is unchanged.
P7 remains STOPPED. No Minecraft instance was launched, no Git upload occurred.

`test-results/ui2-candidate-final.json` records103 frontend/resource/lock/browser
files and SHA-256 manifest `2332b18e21ebbcd686de16ce4b23c816828830b4acc8aeaec883cf2e257166c2`.
The earlier `40b5f4b1006cfeabb311b7ea14567e213a9244dfac9d80a0319c109695963ff2`
candidate differed only in browser screenshot options. Product sources did not
change; final screenshots now fast-forward finite transitions instead of
capturing intermediate palette colors. No business assertion or deadline changed.
No backend or Contracts source differs from HEAD. Existing uncommitted L1 and
historical M3 documentation are retained; they are not all UI2 modifications.

## Implemented

- LT Manager sidebar, compact page breadcrumb/instance toolbar, real connection
  status footer, compact panels and a Servers table with internal horizontal
  scrolling on narrow screens. Existing server selection/removal gates remain.
- Exactly two palettes: warm-white/forest-green Light; graphite/amber Dark.
  System is a preference selecting one of these, not a third palette.
- Shared semantic `--color-*` tokens replace all literal colors in component CSS.
  Common controls, tables, alerts, dialogs, log surfaces and loading states use
  them. No gradients/glass/shadows;4px control corners and6px dialog corners.
- Settings and header selectors switch without reload. Language and appearance
  have separate storage keys. Unknown appearance values follow system; OS
  changes affect system preference only. Restricted storage does not prevent
  switching; truthful persistence failure text is shown.
- Synchronous external head bootstrap sets theme/color-scheme before React.
  Browser access is isolated behind an injectable theme environment, reusable
  by a later desktop host without a dependency on Electron.
- Current configuration draft DOM/value survive both theme and locale changes;
  no save or server command is caused by switching appearance.
- Existing bundled zh-CN/en/ja resources are reused, including ja-JP detection.
  English preferences are preserved. UI2 does NOT complete all L1 translations.

Small-text contrast requires a darker light-mode muted text `#58665D` than the
reference muted swatch. Error tint is near-white `#FCF7F6` so the specified
`#B45049` error text passes4.5:1. Dark key colors and main light colors match the
requested palettes. Status, primary, muted and console contrast are tested.

No extra bottom log feed was invented; Console retains its existing data flow.
Raw logs, RCON output, technical names, paths and API error identifiers are not
translated or rewritten by theme logic.

## Files introduced/changed for UI2

- `apps/web/src/theme/{store.ts,browser.ts,tokens.css}` and three theme test files.
- `apps/web/public/theme-init.js`, `apps/web/index.html`, `apps/web/src/main.tsx`.
- `apps/web/src/components/{Appearance.tsx,AppShell.tsx}`.
- `apps/web/src/pages/{Servers.tsx,Properties.tsx,PhasePage.tsx}` and the
  Properties draft-preservation test; existing business calls remain unchanged.
- `apps/web/src/styles.css` and UI2 entries in the shared i18n resources.
- `tests/e2e/ui2-workspace.spec.ts`, `tests/e2e/ui2.playwright.config.ts`.
- This report, PROGRESS and TECHNICAL_DEBT checkpoints.

## Validation

| Check | Result | Evidence under test-results/ |
|---|---|---|
| Complete Web suite |261 PASS,43 files, exit0|`ui2-web-final.log`|
| Contracts |28 PASS,7 files, exit0|`ui2-contracts-final.log`|
| Lint |PASS, exit0|`ui2-lint-final.log`|
| Whole-project typecheck |PASS, exit0|`ui2-typecheck-final.log`|
| Whole-project production build |PASS, exit0|`ui2-build-final.log`|
| Diff whitespace |PASS, exit0|`ui2-diff-final.log`|
| Chrome responsive/appearance |4 PASS, exit0,38.6s|`ui2-browser-settled.log`|
| Independent Sol High source/evidence review |P1=0/P2=0/P3=0; Final PASS|independent reviewer `/root/ui2_review`, final candidate and document readback|

API suite is NOT rerun: no API/Contracts production source changed, and no theme
code imports or calls backend services. Valid existing M3 API2834/2834 evidence
is reused only for the unchanged backend scope, not claimed as a new UI2 run.
No old LC2 native stress experiment or seven-launch Java lifecycle was repeated.

Browser runs use real Chrome and Vite with injected mock HTTP via the existing
Fastify mock adapter. They are visual/integration evidence, NOT real Minecraft
operation acceptance. Settings covers zh-CN/ja × Light/Dark ×360/768/1440;
nine existing routes are visited in both palettes. Mock-only routes retain
their existing feature placeholders; this does not certify live Console/World
operations. Full Web tests cover existing business UI/confirmation behavior.

Browser assertions include nonoverlapping toolbar controls, no document overflow,
expected body colors, visible focus, persistence/reload, system changes/manual
override, language independence, zero mutating API requests, and pre-React dark
theme with storage denied. Route-ready assertions wait past lazy-loading fallback;
Servers rows and the Dashboard hero must exist before screenshot capture.

Screenshots: `test-results/ui2-browser-settled/ui2-workspace-dual-theme-workspace-{360,768,1440}-chrome/`.
Each contains `zh-CN-light-*.png`, `zh-CN-dark-*.png`, `ja-light-*.png`,
`ja-dark-*.png`, and loaded Dashboard/Servers/Console-route screenshots.
Writer visually inspected loaded1440 dark Servers and360 light Dashboard, plus
both Settings palettes. Japanese text and narrow toolbar wrap without clipping.

## Retained failures, review corrections and limitations

- First Web run:252 PASS/1 FAIL because table conversion omitted the previous
  status label. Label restored, assertion retained; final suite above passes.
- Initial contrast check rejected error tint4.24:1. Tint corrected; test kept.
- Review found1199px drawer gutter, new-log button contrast, loading-bar contrast,
  warning specificity, whitelist breadcrumb and misleading storage error copy.
  Each was corrected without changing operations or weakening assertions.
- Initial page screenshots caught lazy-loading placeholders. Earlier logs/images
  remain; stronger readiness checks and the final browser run supersede them as
  loaded-page visual evidence. Earlier4PASS alone was insufficient for that claim.
- Independent screenshot review caught140ms navigation transition colors in the
  readiness run. Final screenshots disable animations solely during capture;
  settled dark selected background was visually checked. All prior images remain.
- Browser runner exited0; a normal-user read-only process check found no matching
  UI2 Playwright/Vite3019 processes. The initial sandbox CIM access rejection
  (`0x80041003`) did not trigger process termination or any system change.
- Existing JSDOM navigation advisory, Chrome NO_COLOR/FORCE_COLOR warning, build
  >500kB advisory and Git line-ending warnings remain visible, not suppressed.
- L1 full translation coverage is still IN PROGRESS; paused remote panel copy
  and some workflows contain older language text. UI2 new controls are translated.
- Existing dependency audit findings remain separately recorded in technical debt;
  no unrelated package upgrade or risk waiver was performed.

## Final independent decision

Independent GPT-6.1 Sol High `/root/ui2_review` completed source review and final
evidence/document readback, independently recomputed103/103 file hashes and the
final aggregate, inspected six settled screenshots, and confirmed:

```text
P1 = 0
P2 = 0
P3 = 0
UNRESOLVED_REQUIRED_GATES = 0
UI2_FINAL_GATE = PASS
```

**UI2 FINAL PASS — LT Workspace Dual Themes** is limited to this frontend
appearance delivery. It does not certify unfinished L1 translation, real
Minecraft operations, EXE packaging or paused remote access. This is an
independent decision, not writer self-signoff. No commit/push/PR was performed.

## Subsequent UI changes

The later [Performance/shared locale checkpoint](./PERFORMANCE_UI_I18N_2026-10-25.md)
reuses these palettes and records its own changed candidate/tests. It does not
rewrite this original UI2 candidate or its evidence. Further UI/interaction
feedback is planned; do not repeat unaffected validation without a reason.
