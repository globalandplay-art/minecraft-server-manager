# P3.2 / P3.3b Acceptance Report — 真实验收 PASS

后续独立收口已完成：GPT-6 Astra / High 正式签核 **P3.2 Final Gate PASS / P3.3b Final Gate PASS**。见 [独立 Review](./P32_P33B_FINAL_REVIEW_2026-10-02.md)。下文保留真实验收轮及前次失败轮的状态和范围，不把当时 pending 改写成当时已有签核。Phase 3 / P3.3 整体仍 IN PROGRESS。

## 最新验收：2026-10-02 21:07–21:11，北京时间

用户在已验证 `IsAdministrator=False`、Perflib 009 查询 exit 0 的交互式 PowerShell 中运行同一份 Manager 验收脚本。主任务随后直接读取原始 JSON、5 份启动日志、全部 6 次 launch 的 stdout/stderr 和关联 journal/guard，核对其内容，不仅依赖用户粘贴结果。

| 项目 | 最新实际结果 |
| --- | --- |
| runId | `reaccept-b7e1e9b3-372a-4be2-af1d-08a11e179e7b` |
| canonical path | `C:\Users\29104\Documents\Codex\2026-09-27\codex-work-gpt-6-astra-ui-2\runtime\p33-create-8b216c11-3aab-46e6-88aa-de2b6eb6892e` |
| Java / Minecraft | Java 25.0.4.1 / Vanilla 26.3 |
| executable / JVM args | `C:\Program Files\Eclipse Adoptium\jdk-25.0.4.101-hotspot\bin\java.exe`，`-Xms512M -Xmx1G` |
| cwd / 服务端参数 | 上述 canonical path，`-jar <该隔离目录>\server.jar nogui` |
| 环境 | 继承已验证普通 PowerShell；原始报告保留环境摘要和 Java 相关白名单，无 JAVA_TOOL_OPTIONS / JDK_JAVA_OPTIONS / _JAVA_OPTIONS / CLASSPATH |
| Manager 启动 | PASS；首个 PID 24564，后续 PID 20464、26364、6776、2780、20672 |
| Done 证据 | 首次 `[21:07:50] [Server thread/INFO]: Done (0.218s)! For help, type "help"`；全部 6 次 launch 输出均有新 Done |
| RCON / TCP | PASS，已授权的隔离游戏端口 1610 / RCON 1611；RCON 日志 127.0.0.1:1611，验证 `list` 返回 `There are 0 of a max of 2 players online:` |
| 启动日志 | 5 份 latest.log 没有 Minecraft ERROR / WARN，6 次输出没有此前 Perflib / OSHI ERROR；stderr 存在 Java 25 原生访问及弃用 WARNING，见下文逐项分类 |
| source backup | `5babd7fe-c96b-4938-917d-01def3ab4d80`，41 文件，world-set |
| source checksum | `d0ef024fc132547e7f6260770f4d73141457a9aba8c38e6d532ad8b00b2a1f84` |
| pre-restore guard | `355fe912-0439-4d15-bc37-eec4bb254e90`，complete / world-set / pinned=true |
| pre-restore checksum | `4361bc21ee06e4b018ccf5ba57ff27181daf5d951ab722b5818084b3a4ea0783` |
| Restore | PASS，明确启动并核验三维度 diamond 标记；journal 先 committed，随后显式 rollback 后为 rolled-back |
| 故障注入 | `after:rename-old`，operation `885fc912-76b4-4d33-a412-1b8c1457dcec` 为 interrupted，恢复锁正确；重开 Manager 后普通 start 被拒绝 |
| explicit rollback | operation `86ac3200-55f1-4229-9848-ca2a92e2c765` succeeded；guard `1763faf2-da5a-4bd3-b1da-d0dfed950bec` complete / pinned |
| rollback guard checksum | `92a6fd50033b716d30e20ec01a6320a68a7d6b43c1962bc40edee94d916c6b62` |
| 回滚一致性 / 收敛 | 启动前逐文件与 guard 一致；启动后 gold 标记正确，父 journal rolled-back、子 rollback committed，rootIdentity 均存在，recoveryRequired 清除 |
| P3.3b | PASS，新世界 `accept-1e179e7b`，实际 Seed `987654321`，明确启动后生成；旧树逐文件不变，Manager 重启状态正确 |
| crash-report / 最终状态 | 无新增 crash-report；finalStopped=true，6 个测试 PID 全部不存在，退出码均 0 |
| P3.2 真实验收 | **PASS** |
| P3.3b 真实验收 | **PASS** |

最新证据：`.manager/p33-create-8b216c11-3aab-46e6-88aa-de2b6eb6892e/reaccept-b7e1e9b3-372a-4be2-af1d-08a11e179e7b/{acceptance-report.json,source-manifest.json,launch-*-latest.log}`。这些私有文件不上传 Git。用户原世界未被访问/覆盖，手动标准端口进程未被操作。

stderr 的 JVM WARNING 已完整捕获，不能把“Minecraft ERROR/WARN 为零”写成“所有形式的 warning 均不存在”。具体有两组：JNA 5.17.0 调用 java.lang.System::load，Java 提示 restricted native access 及未来版本需明确授权；JOML 1.10.9 调用 sun.misc.Unsafe::objectFieldOffset，Java 提示该方法弃用及未来移除。这些提示是本次 Vanilla / Java 组合的依赖兼容性告警，原始输出保留；本次实际没有拒绝原生调用或导致 shutdown，六次 Done/RCON/exit 0 及世界内容核验提供非阻塞依据。没有添加 --enable-native-access 或弃用告警屏蔽参数，也没有据此承诺未来 Java 版本兼容。其他未知 WARNING 不包含在此分类中。

真实验收之后，主任务再次执行 `npm.cmd run check`，exit 0：contracts 4 / API 403 / web 53 共 **460** 项，lint/typecheck/production build PASS。此前 Chrome 基础 E2E 11/11、export E2E 3/3 有效；此轮无 UI 代码变更，未无变化重复其浏览器套件。这次真实脚本为 Manager API + 实际 Java/RCON/磁盘验收，不冒称新浏览器 Restore 验收。既有真实 360px Restore/Rollback、P3.3b 创建浏览器证据保留。

本轮只有证据核对和文档更新，没有修改核心 transaction / restore semantics，无 commit/push，0 subagent。此前独立源码 Review PASS 与历史署名保留；原来的干净启动验收缺口已补齐。按用户“暂不再跑 Astra”要求，本轮没有新的 Astra Final Gate 签核，项目级最终独立收口仍 **PENDING**，不能把主任务证据核对冒称新的独立审查。Phase 3 / P3.3 整体仍 IN PROGRESS，不启动 ZIP 导入或归档。

## 前次失败验收记录（保留历史）

日期：2026-10-02，北京时间。本轮 0 个 subagent，没有执行新的 Astra Review，没有 commit / push。主任务未更改账户或客户端模型设置。此前源码审查结果保留，不能替代此次真实验收。

## 测试实例与启动记录

Canonical path（写操作前已打印，并验证 realpath、目录属性、注册配置和历史隔离验收身份）：

```text
C:\Users\29104\Documents\Codex\2026-09-27\codex-work-gpt-6-astra-ui-2\runtime\p33-create-8b216c11-3aab-46e6-88aa-de2b6eb6892e
```

这是现有隔离 Vanilla 26.3 实例；没有访问、覆盖或修改用户原世界。启动前确认隔离游戏/RCON 端口未被占用、Manager 返回 stopped/none 且无 recoveryRequired。手动 Java PID 24392 占用 25565/25575，用户明确批准隔离实例继续使用已有端口 1610/1611；未停止或操作该手动进程。未变更端口配置。

| 项目 | 实际结果 |
| --- | --- |
| Minecraft | Vanilla 26.3 |
| Java runtime | 25.0.4.1 |
| Java executable | `C:\Program Files\Eclipse Adoptium\jdk-25.0.4.101-hotspot\bin\java.exe` |
| JVM args | `-Xms512M -Xmx1G` |
| 服务端参数 | `-jar <上述隔离目录>\server.jar nogui` |
| working directory | 上述 canonical path |
| shell / windowsHide | false / true，来自 Manager 原有启动选项 |
| Manager 创建的 PID | 26480 |
| 环境 | 继承验收进程环境；JAVA_HOME 与上述 JDK 一致；未设置 JAVA_TOOL_OPTIONS、JDK_JAVA_OPTIONS、_JAVA_OPTIONS 或 CLASSPATH |
| 权限 | 本轮普通用户身份，TestRunnerIsAdministrator=False；脱离测试沙箱执行，不冒充管理员 |
| 启动 API | 操作 succeeded，Manager 状态 running/managed，进程在 readiness 检查时存活 |
| stdout / stderr | 已捕获，保存在下面的私有 JSON；秘密值已脱敏，环境变量仅保存摘要及 Java 相关白名单 |
| `Done` | `[20:49:01] [Server thread/INFO]: Done (0.407s)! For help, type "help"` |
| RCON 日志 | `[20:49:01] [Server thread/INFO]: RCON running on 127.0.0.1:1611` |
| RCON `list` | 本轮未执行：严格日志检查先发现 ERROR，随后停止；不能用 RCON 已监听冒充 list 通过 |
| 独立 TCP / 世界内容检查 | 本轮未进入此检查；Done 表明启动加载完成，但不能替代内容验证 |
| crash-report | 隔离 crash-reports 目录无报告文件 |
| 最终状态 | Manager stop succeeded；stopped/none，Java PID 26480 已不存在，退出码 0 |

## 阻塞证据与环境比较

这不是 Manager 启动超时或未识别 Done：服务器已进入 running，但实际本次新启动日志包含：

```text
[20:48:52] [ServerMain/ERROR]: Unable to locate English counter names in registry Perflib 009. Counters may need to be rebuilt:
com.sun.jna.platform.win32.Win32Exception: 参数错误。
    at com.sun.jna.platform.win32.Advapi32Util.registryGetStringArray(Advapi32Util.java:921)
    at oshi.driver.windows.registry.HkeyPerformanceDataUtil.mapCounterIndicesFromRegistry(HkeyPerformanceDataUtil.java:274)
```

另有 4 条 OSHI / Perflib WARN：英文名称表回退、Process Loads、Process Virtual Size、Process Resident Size 获取失败，均完整记录，未整体忽略 WARNING。普通权限、沙箱之外直接查询 Perflib 009 仍为参数错误 / exit 1；CPU `Get-Counter` 确实成功。这两种结果可以同时存在，CPU counter 成功不能证明 OSHI 所需的英文名称表可读。

只读观察到手动 Java PID 24392 使用相同 Java executable，但 JVM args 为 `-Xms2G -Xmx4G`，JAR 为相对 `server.jar`；其 cwd、环境、完整本次启动日志和管理员 token 未取得，没有读取原世界来补证。用户报告手动启动无 ERROR，作为用户提供信息保留，当前证据不能确认它与本次 Manager 使用完全相同的运行条件。

最小下一步：在用户已验证成功的那个 PowerShell 会话中只读确认管理员身份、Perflib 009 查询结果及完整启动日志的时间范围；随后对比本报告的 Java/cwd/args/环境。若确有运行权限差异，先确定普通权限下能否读取名称表；不自动把 Manager 改为管理员运行，也不通过 OSHI 开关、过滤 ERROR 或修改 Restore 语义消除表面失败。尚无充分证据认定 Manager bug 或单一系统根因。

## Restore / Rollback / P3.3b 验收结果

| 必须步骤 | 本轮结果 |
| --- | --- |
| Manager 严格启动验收 | BLOCKED：实际 Perflib ERROR |
| 创建本轮 world-set backup / manifest / checksum | 未执行；没有本轮 backup ID |
| pinned pre-restore guard | 未执行 |
| Restore / journal commit / 世界标记恢复 | 未执行 |
| controlled failure injection | 未执行 |
| explicit rollback / recovery 收敛 / 重启验证 | 未执行 |
| P3.3b 新世界明确启动 / Seed / 旧树一致性 | 本轮未执行；此前功能 PASS 仅保留历史证据 |
| P3.2 阶段 | **BLOCKED** |
| P3.3b 阶段 | **BLOCKED** |

按用户要求在第一阶段失败处停止，不为了进入后续验收而绕过门控。现有隔离树因正常启动/保存可能发生预期变化；本轮没有执行世界标记修改、Restore、Rollback 或创建世界事务。旧 journal 和 pinned guard 保留，无新增恢复事务现场。

## 完整回归与变更范围

`npm.cmd run check` 退出码 0：contracts 4 / API 403 / web 53，共 **460** 项测试，lint、typecheck 和 production build 均通过。Chrome Phase 1 浏览器回归 **11/11**，world-set export 浏览器回归 **3/3**（360 / 768 / 1440 px）通过。真实 Restore / Rollback 浏览器闭环因第一阶段阻塞没有执行，不把合成回归视为真实验收。`git diff --check` 通过。

本轮新增 `tests/acceptance/phase3-existing-real.mjs`（测试脚本）、本报告，更新 `docs/PROGRESS.md`。只在 Manager 正常启动边界增加验收进程记录；没有修改任何产品 Java launch、timeout/readiness parser、RCON、transaction 或 restore 核心语义。既有未提交 P3.2 / P3.3 改动全部保留。

私有原始证据目录：

```text
.manager/p33-create-8b216c11-3aab-46e6-88aa-de2b6eb6892e/reaccept-ac4275d2-3cfb-4859-b9f2-a4962f066efe/
```

`acceptance-report.json` 包含 PID、实际参数、环境摘要、stdout/stderr、Done、RCON、ERROR/WARN 和最终状态；`launch-1-latest.log` 为本轮完整启动日志。以下 Git 状态包括此前未提交工作，不表示这些源码都是本轮修改。

## 最终 Git 状态快照

Branch: codex/phase-3-worlds-backups

```text
 M AGENTS.md
 M apps/api/src/adapters/contract.ts
 M apps/api/src/adapters/local.ts
 M apps/api/src/app.ts
 M apps/api/src/infra/runtime-contract.ts
 M apps/api/src/infra/runtime/local-runtime.ts
 M apps/api/src/services/active-world-state-store.ts
 M apps/api/src/services/operation-service.ts
 M apps/api/src/services/server-service.ts
 M apps/api/src/services/transaction-journal.ts
 M apps/api/src/services/world-inventory-service.ts
 M apps/api/test/runtime/local-runtime.test.ts
 M apps/api/test/transaction-journal.test.ts
 M apps/api/test/world-inventory.test.ts
 M apps/web/src/api.ts
 M apps/web/src/pages/WorldsBackups.test.tsx
 M apps/web/src/pages/WorldsBackups.tsx
 M docs/API_SPEC.md
 M docs/ARCHITECTURE.md
 M docs/CODEX_MODEL_ROUTING.md
 M docs/PHASE3_PLAN.md
 M docs/PROGRESS.md
 M packages/contracts/src/index.ts
?? apps/api/src/routes/restores.ts
?? apps/api/src/routes/world-create-plans.ts
?? apps/api/src/services/restore-files.ts
?? apps/api/src/services/restore-service.ts
?? apps/api/src/services/world-create-plan-service.ts
?? apps/api/src/services/world-create-service.ts
?? apps/api/src/services/world-import-archive.ts
?? apps/api/test/restore-service.test.ts
?? apps/api/test/world-create-plan.test.ts
?? apps/api/test/world-create-service.test.ts
?? apps/api/test/world-import-archive.test.ts
?? apps/web/src/pages/RestoreAction.test.tsx
?? apps/web/src/pages/RestoreAction.tsx
?? apps/web/src/pages/WorldCreatePlan.test.tsx
?? apps/web/src/pages/WorldCreatePlan.tsx
?? docs/ACCEPTANCE_P32_P33B_2026-10-02.md
?? docs/PERFLIB_REPAIR_PLAN.md
?? tests/acceptance/phase3-create-real.mjs
?? tests/acceptance/phase3-existing-real.mjs
?? tests/acceptance/phase3-restore-launch-error.mjs
?? tests/acceptance/phase3-restore-real.mjs
```


## 最新证据核对后的 Git 状态（未提交）

Branch: codex/phase-3-worlds-backups

```text
 M AGENTS.md
 M apps/api/src/adapters/contract.ts
 M apps/api/src/adapters/local.ts
 M apps/api/src/app.ts
 M apps/api/src/infra/runtime-contract.ts
 M apps/api/src/infra/runtime/local-runtime.ts
 M apps/api/src/services/active-world-state-store.ts
 M apps/api/src/services/operation-service.ts
 M apps/api/src/services/server-service.ts
 M apps/api/src/services/transaction-journal.ts
 M apps/api/src/services/world-inventory-service.ts
 M apps/api/test/runtime/local-runtime.test.ts
 M apps/api/test/transaction-journal.test.ts
 M apps/api/test/world-inventory.test.ts
 M apps/web/src/api.ts
 M apps/web/src/pages/WorldsBackups.test.tsx
 M apps/web/src/pages/WorldsBackups.tsx
 M docs/API_SPEC.md
 M docs/ARCHITECTURE.md
 M docs/CODEX_MODEL_ROUTING.md
 M docs/PHASE3_PLAN.md
 M docs/PROGRESS.md
 M packages/contracts/src/index.ts
?? apps/api/src/routes/restores.ts
?? apps/api/src/routes/world-create-plans.ts
?? apps/api/src/services/restore-files.ts
?? apps/api/src/services/restore-service.ts
?? apps/api/src/services/world-create-plan-service.ts
?? apps/api/src/services/world-create-service.ts
?? apps/api/src/services/world-import-archive.ts
?? apps/api/test/restore-service.test.ts
?? apps/api/test/world-create-plan.test.ts
?? apps/api/test/world-create-service.test.ts
?? apps/api/test/world-import-archive.test.ts
?? apps/web/src/pages/RestoreAction.test.tsx
?? apps/web/src/pages/RestoreAction.tsx
?? apps/web/src/pages/WorldCreatePlan.test.tsx
?? apps/web/src/pages/WorldCreatePlan.tsx
?? docs/ACCEPTANCE_P32_P33B_2026-10-02.md
?? docs/PERFLIB_REPAIR_PLAN.md
?? tests/acceptance/compare-manual-environment.ps1
?? tests/acceptance/phase3-create-real.mjs
?? tests/acceptance/phase3-existing-real.mjs
?? tests/acceptance/phase3-restore-launch-error.mjs
?? tests/acceptance/phase3-restore-real.mjs
```

