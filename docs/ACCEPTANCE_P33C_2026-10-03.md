# P3.3c Import 验收记录

日期：2026-10-03。当前：**REAL ACCEPTANCE HARNESS READY**；真实验收 **NOT RUN，等待用户宿主执行**。P3.3c 仍 IN PROGRESS。

## 当前交付：宿主验收工具就绪

普通 64 位 PowerShell 包装器和现有 Node 验收 helper 已完善，并通过独立 Sol High 审查。执行命令、明确恢复授权、安全边界与报告路径见 [宿主运行指南](./P33C_HOST_ACCEPTANCE.md)，具体检查与版本摘要见 [工具审查记录](./P33C_HOST_HARNESS_REVIEW_2026-10-03.md)。

本轮完整合成回归 contracts 5/API 489/Web 68 共 562 PASS，lint/typecheck/build/diff check PASS；最后路径修复后 11 项专项测试及 lint PASS。宿主 registry/counter 由合成测试模拟，未启动 Java，未执行真实 Import。不能以这些结果宣布 P3.3c PASS。

此前 Codex registry 探测统一归类 **environment-unavailable / inconclusive**；下面保留原始诊断历史，不再作为宿主损坏或产品 Import hard fail。当前包装器由宿主只读检查真实前置条件；不可用时保存 environment/precondition 报告并停止，不修复 Windows。端口现为动态选择，不使用下面历史计划的固定 1610/1611。

## 已完成

完整合成基线 552 项 PASS（contracts 5/API 479/Web 68），lint/typecheck/build PASS；实际 Chrome 三档宽度上传/明确丢弃和合成 Import 6/6 PASS。最后局部拒绝确认修复后定向 18 项、lint/Web typecheck/build PASS。独立 Sol High 源代码实现审查 PASS，证据范围及失败记录见 [审查报告](./P33C_IMPORT_REVIEW_2026-10-03.md)。

## 历史 Codex 执行上下文诊断（非宿主故障结论）

运行前在 Codex 沙箱外执行只读名称表查询：

```powershell
reg.exe query 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' /v Counter /reg:64 > $null
"CounterQueryExit=$LASTEXITCODE"
```

实际输出 `ERROR: The parameter is incorrect.`、`CounterQueryExit=1`。这属于 Codex 当前执行环境的实测结果，不推断用户普通 PowerShell 或全机也失败；用户先前正常交互会话曾返回 0 并完成 P3.2/P3.3b 真实验收。

未重复启动 Minecraft，没有产生本轮真实 Import PASS，也没有新建真实 runtime 实例。未修改注册表、主机权限或屏蔽日志；没有读取用户原始世界。

用户随后要求最多三次尝试，失败后返回错误。三次只读方式的实际结果：

1. 明确使用 System32/reg.exe 与 64 位视图：退出码 1，`ERROR: The parameter is incorrect.`。
2. 无配置 cmd.exe 读取：退出码 1，REG QUERY 语法错误，输出存在编码异常。此项是命令解析失败，不能当作注册表损坏或权限证据，没有宣称排查成功。
3. .NET Registry64 只读接口：OpenSubKey 返回 null，诊断抛出 `Perflib009KeyNotFound`；进程退出码 1，RuntimeException HResult -2146233087。该 HResult 属于诊断异常，不是已证明的原生 Windows 权限错误码。

达到三次后停止环境尝试，没有运行修复注册表或改变权限的命令，也没有开始真实 Java 验收。

## 历史下一步计划（已由上方宿主工具取代）

独立核验 `tests/acceptance/phase3-import-real.mjs` 后，在已验证正常的普通 PowerShell 中明确 opt-in 执行。脚本使用全新 runtime/p33-import-UUID 与 .manager 同名私有目录，仅从此前隔离实例复制 JAR/已接受 EULA；原隔离世界与原始世界均不读取。端口固定 1610/1611，占用立即停止，不操作其他进程。

真实验收必须包括生成隔离世界、实际 ZIP 导入及 pinned guard/摘要、明确启动 Done/RCON/世界标记、受控切换失败、重启门控与明确恢复、再次明确启动以及最终停服。ERROR 和未分类告警保持阻塞。失败现场保留，不自动恢复或清理。由用户贴回报告后核对原始证据，不能根据预期输出宣称 PASS。

用户禁用 Astra，强制完整 Import Final Gate 仍 pending；Sol 审查不代替其签核。无 commit/push。
