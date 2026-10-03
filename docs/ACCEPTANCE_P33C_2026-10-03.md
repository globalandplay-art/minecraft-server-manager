# P3.3c Import 验收记录

日期：2026-10-03。当前：**P3.3c Real Import Acceptance PASS**，真实 run `p33-import-dd5f7bee-e0a0-4920-9dc9-484b0ab66404`。P3.3c Import 与恢复验收完成；Phase 3 仍 IN PROGRESS。

## 修复后真实验收 PASS

已核对 [结构化验收报告](../.manager/p33-import-dd5f7bee-e0a0-4920-9dc9-484b0ab66404/acceptance-report.json) 和本地 `evidence/` 下全部原始输出、日志、manager-events、inventory、guards 与 journals。报告 `result/import/recovery=PASS`、`finalStopped=true`，`failures=[]`，sourceInputsUnchanged=true。Host preflight 读取 Counter 10945 项且 Get-Counter 成功；Windows 普通 64 位 PowerShell、Vanilla 26.3、Java 25.0.4.1。

4 个受管 Java 启动均有 fresh Done/RCON/list，出口码 0、无 signal、stdout/stderr 管道关闭，无 ERROR、fatal、阻塞或未知 WARN、无 overflow/crash。第 3 次启动有 1 条精确分类的 `minecraft-cant-keep-up`，其余 diagnostics 满足通过条件。测试使用新隔离 UUID，源/目标/导入世界的三维度 diamond/gold/emerald 标记哈希经导入验证；真实 API ZIP 上传、消费状态与 pinned protection guard 通过，旧目标树保留且导入后明确启动通过。

既有 `config-installed` 受控故障未被误报成功；Manager 重启后门控生效、没有自动重试，显式恢复还原旧配置和活动世界引用、保留 8 棵树，随后明确启动与标记验证通过。最终 manager state stopped/ownership none/recoveryRequired false，无 active operation，Java 子进程均退出、管道关闭、端口释放。原始 BLOCKED runs 均保留；特别是 `p33-import-6a566f55-676b-4019-b674-24673ee9633f` 仍为原始 BLOCKED，未编辑其报告或日志。此次 PASS 报告 SHA-256：`A0E9654D09AEA687424B7B1DA13F3CFAD2CAF2A1CFA913BF732B3AE35BD01B41`。

本次只验证 P3.3c Import/恢复验收，不表示 P3.3 归档或 Phase 3 全部完成；也不替代单独的项目 Final Review。运行参数、逐字段核验及测试基线见 [Harness Review](./P33C_HOST_HARNESS_REVIEW_2026-10-03.md)。

## 宿主验收工具与阻塞历史快照（已完成并被本次 PASS 更新）

### 宿主运行历史与分类修复（2026-10-03）

真实 run `p33-import-6a566f55-676b-4019-b674-24673ee9633f` 保持 **BLOCKED**。Host preflight PASS（Counter 10945 项、Get-Counter PASS），源世界 PASS；目标世界已具备存活 managed Java、fresh Done、RCON/list、正确世界加载与端口证据，但 diagnostics gate BLOCKED。唯一 Minecraft 告警为 `[22:59:37] [Server thread/WARN]: Can't keep up! Is the server overloaded? Running 3081ms or 61 ticks behind`；errors/fatalRuntimeDiagnostics 为空，没有 Perflib/crash/premature shutdown。Import/Recovery 均 **NOT STARTED**；finalStopped=true。未修改该运行的 JSON、stdout/stderr/latest.log 或世界。

原分类器把同一行 latest.log/stdout 各算一次，并再次放入 unclassifiedWarnings；四个数组项不代表四次卡顿。修复仅影响下一次新 UUID：严格匹配 Server thread/WARN 的整数毫秒/ticks 性能警告，记录完整文本、来源和每个 capture occurrence；完整文本去重，不合并不同时间戳或数值。仅在 managed process/fresh Done/RCON/list/正确世界/双端口/无 crash 或提前关闭全部核验后允许该分类。ERROR、Windows runtime fatal、其他 Minecraft WARN、未知 Java WARNING、overflow 继续阻塞。最终关闭后的复核保留此前已验证的启动证据，同时重新检查所有晚到诊断。

真实状态仍 **BLOCKED**；本轮不运行 Java、不修改 JVM flags/properties/产品事务/Windows、不 commit/push。工具修复测试与独立只读 Sol High Review 结果见 [工具审查记录](./P33C_HOST_HARNESS_REVIEW_2026-10-03.md)。

分类修复专项最终 203 PASS（诊断 40、宿主边界 11、Import archive/service/upload 合计 152），独立只读 Sol High 复审关闭提前正常退出 P2 并签核范围 PASS。完整单 worker 基线 600 PASS（contracts 5/API 527/Web 68）；最后生命周期增量后专项/lint/两 helper 语法/diff check PASS。完整检查首次并发执行一项已有 Restore 测试超出原 5000ms，第二次保留时限、单 worker 完整回归通过；历史失败结果仍记录，不冒称第一次 npm check PASS。细节见工具审查记录。

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
