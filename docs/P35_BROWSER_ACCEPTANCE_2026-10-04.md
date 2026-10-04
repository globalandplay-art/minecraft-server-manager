# P3.5 真实浏览器闭环验收

日期：2026-10-04。真实验收 run `p35-browser-441fb968-c099-4892-8560-a58aae9d9fba` 已 PASS；P3.5真实验收PASS，Phase 3 Final Gate仍PENDING；不得进入Phase 4。本轮仅增加验收工具、测试和进度文档，不新增产品功能或修改 Restore/Transaction 语义。

## Git 与执行边界

当前本地 `codex/phase-3-worlds-backups` / `0a021e05bf02e8f1685abe91c494f1679945140c`。用户确认已把该提交推至同名 GitHub 分支并验证 bundle；main 保持 `5920f6d…`。本轮没有提交、推送或合并，不将用户提供的上传证据冒充本轮远端独立检查。

复用已有验收的 plain/canonical 检查、已接受 EULA 和已验证 JAR 来源、Java 25/runtime factory、Done/RCON/世界/端口/diagnostics、精确 child ownership 和正常停止检查。只读取已验证 `p33-create-8b216c11-3aab-46e6-88aa-de2b6eb6892e` 的 JAR/EULA/私有 config 与既有验收报告，不读取其世界；来源前后摘要必须不变。每次创建全新 `p35-browser-UUID` 私有/运行时目录。

真实 wrapper 要求普通 64 位 PowerShell、Perflib 和 CPU counter 预检、`-ConfirmIsolatedBrowser`。端口 3000/8080 冲突立即停止，不接管现有服务；Minecraft/RCON 使用动态独立 loopback 端口。四个端口和本轮 captured Java/Vite/Chrome 全部关闭才能 PASS。

## 三档真实闭环

每个宽度 360/768/1440 都执行完整链路：

1. 管理器启动全新世界，Done/RCON/list/正确世界验证；三个维度放置 A（金块），正常停服。
2. 浏览器创建备份。仅在真实 POST 已返回 202 后切断该浏览器响应；reload 后以相同 key/body 查询接受状态，同 operation ID、一个新增 backup/一个 journal。不会 mock API 结果。
3. 重新启动、三个维度改为 B（钻石块）、停服，浏览器确认 Restore，停服全文件 manifest/hash 核验源 A，并确认 distinct pinned guard。
4. 重启管理器、启动确认 A，再实际改成 C（绿宝石块）、停服。
5. 只对当前 server / Restore / 指定 source backup，在 `new-installed` checkpoint 已持久化后一次性抛错。必须观察 interrupted / RECOVERY_REQUIRED、recovery-required journal、distinct pinned guard；不能将未注入当作失败验收通过。
6. 重启管理器，启动拒绝，浏览器精确定位本次失败 journal，明确 Rollback；先以 guard 和 C 的原始文件清单核验，再重启管理器、启动验证三维 C、正常停服。
7. 核验活动世界、operation/journal、恢复门控解除、pinned backups、确认焦点与三档 overflow / 截图。schedule 和 retention 默认关闭，防止测试期间未授权清理。

Restore/Rollback 字节检查必须先于 Java 启动；正常启动会改变 level.dat/session/region，之后使用 RCON 语义标记验证，不以旧哈希误锁正常游玩。已通过 Import/Archive 的真实证据保留，不重新实现或把本链路说成覆盖所有历史故障点。

## 清理与日志

Chrome launchServer、Vite 和 Java 只使用本轮对象/句柄，不按进程名/端口批量杀。浏览器/context/helper 清理各自有界，即使一个 close 拒绝或挂起，仍关闭剩余 helper、写日志并最终 BLOCKED。Chrome 应急 kill 只清场，不能建立 PASS。

stdout/stderr 内存有 16 MiB 上限，完整 raw 流留在仅运行时私有日志；latest.log 使用 bounded regular-file reader。overflow、ERROR、fatal/Perflib、未分类 WARN、提前退出、日志 flush 失败都阻塞，不关闭诊断。P3.5另有独立的严格 `handleDisconnection() called twice` 分类：仅在每个capture surface都证明warning晚于完整readiness、之后RCON修改成功、受控正常stop及全维度保存、RCON listener停止、exit0、pipes关闭、ports释放时放行。否则仍blocking。未知WARN继续阻塞。raw-private.log不得公开或提交。

## 当前执行证据

- 真实验收 run `p35-browser-441fb968-c099-4892-8560-a58aae9d9fba` 于2026-10-04 PASS：Vanilla 26.3 / Java 25.0.4.1；PowerShell 64-bit；Perflib 10945项/Get-Counter PASS。canonical runtime `.manager` 路径见报告。浏览器宽度360/768/1440均完成备份请求断连后同key确认、A/B世界Restore、`new-installed`故障注入、manager restart、显式Rollback及C标记核验。12次受管Java launch全为exit0/no signal/authorized shutdown/cleanDiagnostics/portsReleased。最终Minecraft/Java/manager/browser helper均停，四个ports释放，active operation为空、recoveryRequired=false、failures为空；来源JAR/EULA/config SHA256前后不变。完整JSON与66项证据保存在忽略的私有 `.manager/p35-browser-441fb968-c099-4892-8560-a58aae9d9fba` 下。旧BLOCKED run不覆盖。



- 新宿主边界 + diagnostics + cleanup 专项 **52/52 PASS**（包括关闭拒绝/挂起仍清理Vite/写日志/返回 BLOCKED）。
- `phase35-browser-synthetic.mjs` 用真实 HTTP / Chrome / Backend transaction / manifest/hash 文件操作，合成生命周期与标记 callback，**三档完整链路两轮 PASS**。最终合成根为 `mcsm-p35-browser-synthetic-wQvACU`，报告明确 `SYNTHETIC_PASS / realAcceptance=NOT_RUN`；没有 Java/RCON 真实证据，不代替真实 Gate。
- 一次真实只读 PreflightOnly run：`p35-browser-a2706d2b-0f9c-431f-8814-d6b425c7caa2`，result/browser=BLOCKED。CPU counter PASS；当前 Codex 上下文 Perflib 不可见。未创建 serverRoot、未启动 Java/Vite/Chrome或修改原世界。
- 最终冻结 `VITEST_MAX_WORKERS=1 npm.cmd run check` exit0：contracts6/API667/Web82共 **755 PASS**，lint/typecheck/production build PASS；JS/PS语法及git diff --check PASS，私有日志 `test-results/p35-final-check.log`。Web既有jsdom navigation提示保留，测试通过不改写为失败。独立SolHigh最终delta CODE/TOOL/TEST-SOURCE Review PASS；审查者未运行tests/Java。此为此前工具开发检查点，仅作历史记录；后续真实run结果见上。
- 允许的普通宿主工具上下文只读复核也返回PathNotFound/ItemNotFoundException（exit1）；没有修系统或进一步试跑。该次Codex工具上下文预检不可用，后续用户普通64位PowerShell真实run已通过。

## Issue Ledger

| ID | 状态 / 严重度 | 原因、原始错误和处理 |
| --- | --- | --- |
| P35-HOST-001 | RESOLVED / HIGH | `HOST_PRECONDITION_UNAVAILABLE` / `HOST_PERFLIB_UNAVAILABLE`，exit1，ItemNotFoundException / HResult -2146233087；先前Codex工具上下文无法读取Perflib，不证明Windows损坏；后续上述普通PowerShell真实验收Perflib 10945项/Get-Counter均PASS，阻塞解除。保留失败历史证据 |
| P35-REVIEW-001 | RESOLVED / MEDIUM | UI journal 行状态是 recovery-required，不是 operation interrupted；按失败operation ID和实际journal状态精确定位，三档实际HTTP合成Browser验证 |
| P35-REVIEW-002 | RESOLVED / HIGH | browser.close拒绝/挂起可能跳过Vite清场；独立bounded cleanup和captured ChromeServer句柄，2项故障测试及三档正常清场通过 |
| P35-FLOW-001 | RESOLVED / MEDIUM | 首轮合成 `locator.click: Timeout 30000ms exceeded`，phase35-browser-flow.mjs submit恢复按钮；旧成功pending尚未被UI消费。等待UI terminal/sessionStorage清空再重启/开始下一次，保持原时限，后两轮三档通过 |
| P35-TOOL-001 | RESOLVED / LOW | 首次生成新工具时换行匹配报 `journal transform failed`，exit1，尚未写runner；规范化换行/显式检查复制边界，Node与PS语法校验通过 |
| P35-DOC-001 | RESOLVED / LOW | 首次文档patch整行上下文匹配失败；原文件未改，读取实际整行后重做。无显式错误码 |

同一根因没有三次不同修复耗尽。环境安全阻塞第一次就停止；任何同一问题耗尽第三次有效修复时，必须在对话输出错误码、日志、源码、每次修改/测试结果，不开始第四次。

P35-HOST-001 原始诊断：

```text
Cannot find path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' because it does not exist.
HOST_PERFLIB_UNAVAILABLE
HOST_PRECONDITION_UNAVAILABLE
HResult: -2146233087
exit code: 1
```

## 普通宿主执行

先确认管理器开发服务已停止，3000/8080空闲，已安装依赖和Chrome。工具源码与独立审查通过后，在普通64位PowerShell执行一次（不需要管理员，不修改execution policy全局设置）：

```powershell
Set-Location 'C:\Users\29104\Documents\Codex\2026-09-27\codex-work-gpt-6-astra-ui-2'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\tests\acceptance\p35-real-browser-acceptance.ps1' -ConfirmIsolatedBrowser -NodeExecutable 'C:\Users\29104\AppData\Local\hermes\node\node.exe'
```

运行后保留新 `.manager/p35-browser-UUID/acceptance-report.json` 与 evidence，并提供终端结果。失败不要立即重跑、删除现场或手工启动验收Java。本次三档真实链路与停止门控均PASS，P3.5真实验收已通过。完整回归及独立Phase3 Final Review仍需完成，才能标记Phase3 PASS；当前不进入Phase4。
