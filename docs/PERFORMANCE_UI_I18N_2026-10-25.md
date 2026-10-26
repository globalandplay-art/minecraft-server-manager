# Performance Workspace and shared locale fixes — checkpoint

User subsequently requested fewer repeated checks because further UI/interaction
changes are planned. No additional regression or browser runs are scheduled.
The results below were already obtained before that instruction.

## Delivered changes

- Shared navigation, dynamic Mods/Plugins breadcrumbs, common page headings,
  Servers titles/actions and login branding use the existing L1 resources.
  Chinese navigation now reads 仪表盘/服务器/玩家/世界管理/模组或插件/控制台/
  性能监控/备份/崩溃分析/设置; English and Japanese mappings are verified.
- Performance uses a compact six-metric strip, a single switchable history plot,
  sampling sidebar, bounded history table (12 rows initially; at most120 samples)
  and collapsed technical explanations. CPU/RAM/TPS/MSPT/player/disk readings
  retain original status/source data; unsupported TPS/MSPT remain N/A.
- Existing poll/visibility/pause/manual refresh rules are unchanged. Missing,
  stale, invalid and source-changing observations do not generate synthetic
  points or zero-filled lines. One valid point is a dot, not a fabricated curve.
- Demo Settings no longer mounts the stopped remote access component. Its
  protected requests had produced401 and global signed-out state despite the
  mock API correctly declaring no password. This fix removes those requests;
  it does not weaken authentication, ignore401 or initialize credentials.
- Fixed client-owned error advice is localized only at presentation. Original
  Error.message/stack, backend diagnostic text/codes and request behavior remain.
- Formal en-US/ja-JP choices/system preferences use the same existing locale
  core; legacy en/ja storage and selector values remain compatible. There are
  586 matching three-language resource keys. This is not full L1 completion:
  remaining add-on/world/backup/whitelist workflow copy stays active L1 work.

## Existing evidence

All log paths are under `test-results/`:

| Check | Result | Log |
|---|---|---|
| Complete Web |276 PASS,46 files,exit0|`perf-ui-web-final.log`|
| Contracts |28 PASS,7 files,exit0|`perf-ui-contracts-final.log`|
| Root lint |PASS,exit0|`perf-ui-lint-final.log`|
| Web typecheck |PASS,exit0|`perf-ui-typecheck-final.log`|
| Project typecheck |PASS,exit0|`perf-ui-project-typecheck-final.log`|
| Project production build |PASS,exit0|`perf-ui-project-build-final.log`|
| Chrome360/768/1440 |3 PASS,26.5s,exit0|`performance-ui-browser-v2.log`|
| Diff |PASS,exit0|`perf-ui-diff-final.log`|

Browser evidence uses real Chrome/Vite and actual Fastify Mock responses;
the fixture only enables the Performance feature flag for UI testing. Auth
status/access responses are not overridden. Settings opens without a password,
no remote requests are sent and no mutating request is issued. It is not real
Minecraft acceptance. Screenshots cover zh-CN/en/ja, both Performance palettes,
Servers and desktop/mobile navigation at all three widths.

Screenshot roots:
`test-results/performance-ui-browser-v2/performance-ui-Workspace-l-*-chrome/`.
Files include `performance-{zh-CN,en,ja}-{light,dark}-{width}.png`,
`servers-{locale}-{width}.png`, and `navigation-{locale}-{width}.png`.
Chinese1440 light and Japanese360 dark Performance, English768 navigation and
English1440 Servers were inspected by the independent reviewer.

Initial focused failures reflected the deliberately replaced four-chart layout
and different visible-copy counts. Tests now assert the required single plot,
six compact metrics, truthful stale/N/A states and bounded rows; safety/data
assertions and timeouts were not weakened. First complete Web result271PASS/
4FAIL contained old English label assertions; those four expected labels were
updated to the user-required Chinese, with47 affected tests passing before the
final complete276PASS run. First browser run failed on an outdated button name;
the actual label was used, deadlines unchanged. All old logs/traces remain.

## Independent review and candidate

Independent GPT-6.1 Sol High `/root/performance_ui_review` reviewed production
changes, error-presentation delta, tests/logs and four representative screenshots:
**P1=0/P2=0/P3=0**, source and scoped evidence accepted. No writer self-signoff.
Full L1 final signoff is outside this review. No extra document review round is
requested while the user plans further UI changes.

Branch `codex/phase-4-players-properties`, HEAD
`9f7cf498940b8e8c357b44ba1da8d201751463e4`, with preserved uncommitted work.
`performance-ui-candidate-final.json` records111 frontend/test/resource files;
aggregate SHA-256 `bff41bb885deeb9fe8121389403bbb2e48ffed89bd305c7a7f199b81133848d4`.
No backend/Contracts production diff. API suite was not rerun: unchanged backend
evidence remains applicable; API/CSRF/401 presentation tests are in Web coverage.

Modified scope: Performance/Trend/trend parser, semantic styles, AppShell/common
headings/Servers and add-on headings, demo Settings, locale resources/preferences,
the existing API error display helper, related tests/browser fixtures and docs.
Existing jsdom navigation messages, color-environment warning and575.37kB build
chunk advisory remain visible. No unrelated dependency audit issue was waived.

P7 remains STOPPED. No Minecraft lifecycle, legacy LC2 native experiment, system
change, credential initialization, Git commit/push/merge/PR or EXE work occurred.
Next action: user-directed UI/interaction changes, with only affected checks when
needed. Previous UI2/M3 evidence remains historical and unchanged.
