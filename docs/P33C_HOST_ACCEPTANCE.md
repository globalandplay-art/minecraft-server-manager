# P3.3c 宿主机真实导入验收

状态：**P3.3c REAL ACCEPTANCE HARNESS READY**。独立 Sol High 审查通过；真实验收尚未执行。该工具不能自行把 P3.3c 标为 PASS。

## 使用方式

在宿主机普通 **64 位 PowerShell** 中执行，不需要管理员权限。关闭占用本项目开发端口的旧任务不是前置条件：Minecraft 使用新选择的两个本机端口；发生端口冲突会记录失败，不操作其他进程。

```powershell
Set-Location 'C:\Users\29104\Documents\Codex\2026-09-27\codex-work-gpt-6-astra-ui-2'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\tests\acceptance\p33c-real-import-acceptance.ps1' -ConfirmIsolatedRecovery -NodeExecutable 'C:\Users\29104\AppData\Local\hermes\node\node.exe'
```

`-ExecutionPolicy Bypass` 仅适用于该新 PowerShell 进程，不改变全局执行策略。`-ConfirmIsolatedRecovery` 明确授权本次新隔离实例的已知故障与显式恢复流程；没有该开关不会启动真实测试，普通异常仍不会自动恢复。`-NodeExecutable` 指定现有 Node，省略时从 PATH 查找。只检查宿主条件、不启动 Java时，可使用 `-PreflightOnly`，无需恢复授权开关。

## 工具执行的操作

1. 创建新 UUID 验收记录，验证 canonical 路径，输出 run ID 和隔离路径。只读检查宿主 Perflib Counter 和一次 Get-Counter；失败归类 environment/precondition，不修复 Windows。
2. 使用此前已验证隔离实例的 JAR 和已接受 EULA，新建 private manager root 与 server root、随机 RCON 密码、两个不同的 loopback 端口。复验来源为原隔离实例下 `reaccept-b7e1e9b3-372a-4be2-af1d-08a11e179e7b/acceptance-report.json` 的 PASS/finalStopped 记录；仅读取配置、该报告、JAR/EULA，不读取该实例世界。不会自行接受 EULA。
3. 通过 Manager 启动 Vanilla 26.3 / Java 25，生成源世界，设置并核验三维度标记，正常停服，创建受限 ZIP 与逐文件摘要。
4. 通过 Manager 准备另一个不同 Seed/标记的目标世界。API 上传、导入预检和明确导入，检查独立 Import journal、源归属与内容、pinned guard 及旧世界保留。
5. 确认导入保持停服后，明确启动，验证进程、Done、端口、RCON/list、导入标记和实际世界文件。
6. 在新隔离实例中用既有 config-installed checkpoint 注入受控失败，验证无误报成功、无自动重试或回滚、重启后恢复门控；明确恢复旧配置和世界引用，保留所有树，再明确启动并核验。
7. 正常 Manager Stop；检查所有捕获 Java 子进程退出、端口释放、无活动操作及 Manager stopped。报告和现场保留，不自动删除。

正常停止不可用时，验收工具仅可对自身捕获并核验身份的子进程做紧急停服；这种结果始终 BLOCKED，不能冒充 Manager 正常停止 PASS，也不解除产品恢复锁。

## 输出与判断

每次运行使用唯一隔离目录，报告位于新 `.manager/<runId>/acceptance-report.json`，原始证据位于该目录的 `evidence/`。这些目录已经 Git ignore，不提交运行配置、秘密、世界或 ZIP。

报告记录宿主检查、环境、源/目标世界、上传、guard、Import、明确启动、失败恢复、最终停止、错误 phase/code/operation ID/日志片段与恢复状态。不会公开 RCON 密码。所有 Java stdout/stderr 和实际 Minecraft 日志保留；除已精确分类的既有 Java 25 兼容性诊断外，ERROR 和未分类告警继续阻塞。所有最终输出在管道关闭后重新核验，不能只相信 HTTP 2xx 或 journal 文本。

成功退出 0；宿主前置条件不可用或验收失败退出非零，并分别归类。Codex 上下文的注册表探测失败只表示 environment-unavailable / inconclusive，不代表宿主 Windows 损坏或产品 Import 失败。

完成后请交回终端结果和 acceptance-report.json 的脱敏内容。核对真实证据后才能判断验收；用户禁用 Astra 的强制 Final Gate 仍单独 pending。不会自动提交、推送、发布或进入下一 Phase。
