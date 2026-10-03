# P3.3c Host Acceptance Harness Review

日期：2026-10-03。结论：**REAL ACCEPTANCE HARNESS READY**，不是 P3.3c 真实验收 PASS。

## 范围与独立签核

唯一写入者完善 `tests/acceptance/phase3-import-real.mjs` 与 `tests/acceptance/p33c-real-import-acceptance.ps1`；主任务添加 `apps/api/test/acceptance-host.test.ts` 和文档。独立只读 GPT-6.1 Sol / High reviewer 最终签核 readiness 范围 PASS，无具体剩余阻塞。没有修改产品实现或核心 transaction/restore semantics。没有运行真实 Minecraft、主机修复、原世界访问、Git 提交或上传。未调用用户禁止的 Astra。

审查核对：宿主前置条件失败分类与报告保留；新 UUID canonical roots/祖先非重解析检查；已验证来源 JAR/EULA；动态端口、随机凭据脱敏；不同源/目标世界与三维度标记；实际 API ZIP 上传及归属/摘要核验；pinned guard 验证先于切换；既有受控故障、重启门控与明确恢复授权；全部启动输出关闭后的日志重分类；最终正常停止、子进程退出、端口释放、无活动操作。普通异常不自动恢复或重试。

P2 复查关闭：最终管道关闭后遗漏告警检查；PowerShell native stderr/nonzero 导致结构化报告被覆盖；可选 Node 路径必须完全限定，拒绝 drive-relative/root-relative/device namespace 并检查规范化文件和祖先。新增断言覆盖这些边界。

## 验证证据

- 完整回归：contracts 5/API 489/Web 68，共 **562 PASS**；lint、typecheck、production build、git diff --check PASS。
- 上述完整回归先于最后 PowerShell 路径修复；最终 **11/11 acceptance-host 专项测试与 lint PASS**。当前测试库存增加了一项，不声称完整 563 项重新运行。
- 合成测试覆盖解析与安全边界、dot-source 无副作用、UUID/绝对路径、模拟宿主检查成功/不可用、缺少 opt-in/恢复授权的 early exit、前置失败报告、模拟 Node stderr/nonzero 报告保留。注册表/性能计数器均被模拟，未到达 Java。
- 早期专项运行有一项测试自身 JavaScript 路径字符串转义错误，修正后复跑通过；没有删除失败测试或降低断言。
- 既有 Chrome 6/6 验证属于此前 UI 证据；本轮没有 UI 产品改动，未重复浏览器验收。

最终 SHA-256（独立 reviewer 已核对）：

| 文件 | SHA-256 |
| --- | --- |
| `tests/acceptance/phase3-import-real.mjs` | `B4E47FCD129692B18C584CE84D9A8F38A73E3BB3355A5F158C1A443107549AA5` |
| `tests/acceptance/p33c-real-import-acceptance.ps1` | `7910CF3FDA1BF16B426E9A2C131C7941B3F85E81BE18B6D6C0631238C07F81F7` |
| `apps/api/test/acceptance-host.test.ts` | `A183E43919461F53737EB7930D0C902C7AA248F2CA3C6700B4C7B1128BBBED19` |

## 未完成与准确限制

用户须在普通 64 位 PowerShell 手动运行并返回脱敏 acceptance-report.json/日志；只有真实完整证据才能判断 Import 验收。Codex registry 失败仅为 environment-unavailable/inconclusive，不证明 Windows 损坏。宿主实际 preflight/runtime 故障仍会阻塞并保留证据，不修复系统或屏蔽 ERROR。

Manager 验收为进程内实例，原 logger disabled；`manager-events.jsonl` 是实际 API/operation/error 事件证据，不冒称独立 Manager 进程 stdout。Minecraft 每次启动的完整脱敏 stdout/stderr/latest.log 均保存。Windows 目录同步及断电耐久性限制继续保留，不因脚本检查成功作额外保证。仅针对自己创建并核验身份的子进程紧急清理会判 BLOCKED，不替代 Manager 正常停服或解除产品恢复锁。

**真实验收 NOT RUN；强制完整 Import Final Gate pending。** 本次 Sol readiness 审查不替代该 Gate。运行指南：[P33C_HOST_ACCEPTANCE](./P33C_HOST_ACCEPTANCE.md)。
