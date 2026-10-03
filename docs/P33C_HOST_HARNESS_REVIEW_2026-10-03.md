# P3.3c Host Acceptance Harness Review

## 后续真实宿主 Acceptance 结果核对

用户提供 PASS run `p33-import-dd5f7bee-e0a0-4920-9dc9-484b0ab66404` 后，主任务只读核对了 `.manager/<runId>/acceptance-report.json` 和全部 evidence 文件；未启动服务端或修改报告。`result/import/recovery=PASS`、finalStopped=true、failures=[]，来源输入未变。4 个独立 PID 各自有 fresh Done、RCON 和 list，exit 0/无 signal，全部 child exit/output close；没有 ERROR/fatal/阻塞/未知 WARN/overflow。第 3 launch 有 1 个允许的 `minecraft-cant-keep-up`，sources/occurrences 保留。

文件系统 evidence 中源 ZIP 存在（9,504,606 bytes），报告 archive SHA-256 `f1c6922d722f761ada970a23473102eb2f5b0a264574c46276f940cf38dfac3d`；源维度 diamond/gold/emerald 与 imported-world inventory/hash 一致，upload/import operation 与 pinned guards/journals 相互引用。config-installed 操作真实进入 interrupted/recovery-required；manager 重启后门控有效；explicit recovery operation 恢复旧 config hash 并保留 8 个树；恢复后 marker 验证、Manager stopped/none/recoveryRequired=false、端口释放均通过。报告文件 SHA-256 `A0E9654D09AEA687424B7B1DA13F3CFAD2CAF2A1CFA913BF732B3AE35BD01B41`。

本记录只签认 Harness 实现/诊断修复的独立 Sol High Review；PASS run 的证据由主任务按字段交叉核验，不冒充另一次 Reviewer 签核。它只关闭 P3.3c Real Import Acceptance；Phase 3 还有 P3.3 archive、P3.4 scheduled retention 与 P3.5 end-to-end final acceptance/review，仍 IN PROGRESS。用户要求 subagents=0 且不调用 Astra，所以本轮没有 agent Final Phase Review；因为并非只剩 Final Gate，该 Review 也尚非当前可执行的唯一剩余项。

用户要求的 P3.3c 最终相关 API 回归本轮重跑：diagnostics / host harness / import archive / import service / import upload 共 **203 tests PASS**（5 files，exit 0，46.89s）。更广的完整单 worker lint/typecheck/test/build 基线 600 PASS 在最近 Harness 修复回合已运行；本轮只改文档，没有再重复完整构建。

## 本次诊断分类修复（2026-10-03）

结论：**REAL ACCEPTANCE HARNESS FIX READY**。独立只读 GPT-6.1 Sol / High reviewer 审查及 P2 增量复审 PASS，无具体剩余 P1/P2；仅一个只读 reviewer，未创建下级代理、未调用 Astra。下面原工具首次交付的测试数量和哈希为历史证据，不代表此次改动。

修改文件：`tests/acceptance/import-diagnostics.mjs`（纯 acceptance classifier）、`tests/acceptance/phase3-import-real.mjs`（集成分类、最终启动探测、正常 stop 授权与 premature exit）、`apps/api/test/acceptance-diagnostics.test.ts`，以及本报告、PROGRESS、ACCEPTANCE_P33C 和 P33C_HOST_ACCEPTANCE 共四份文档。产品代码/transaction/JVM/properties 未改。

修复前将 latest.log/stdout/stderr 拼接，把全部 Minecraft WARN 无条件阻塞，随后又放入 generic warnings。修复后完整文本摘要去重并保留 sources/occurrences，只严格锚定 `[HH:mm:ss] [Server thread/WARN]: Can't keep up! Is the server overloaded? Running <整数>ms or <整数> ticks behind`，分类为 `minecraft-cant-keep-up`；不同时间/数值仍为不同摘要，原始证据不变。纯 classifier 不假设启动状态，diagnosticsAllowed 需要完整 verifiedReadiness：同一个 managed live child、fresh Done、RCON/list、正确世界、双端口、无 crash/提前关闭；ERROR/fatal/其他 Minecraft WARN/未知 WARNING/overflow 全部仍阻塞。两条原 Java 25 精确诊断块语义保持。摘要不代表可靠的物理事件计数，occurrences 表示捕获位置。

独立发现并关闭 P2：在明确 stop 前自行正常退出时，旧 readiness 不能让 stop no-op 和最终检查冒称成功。exit 事件永久记录 prematureExit；正常 stop/cleanup 请求前验证同一 owned child 存活且没有已有 Stopping server；最终要求所有输出关闭、exit 0、无 signal，晚到错误仍阻断。stopRequestedAt 是明确停止授权记录，不承诺进程退出与请求之间有原子因果证明。

验证命令与结果（均未启动真实 Java或访问真实 registry）：

| 命令 | 实际结果 |
| --- | --- |
| `npm.cmd run test --workspace @mcsm/api -- --maxWorkers=1 test/acceptance-diagnostics.test.ts test/acceptance-host.test.ts test/world-import-archive.test.ts test/world-import-service.test.ts test/world-import-upload.test.ts` | 首次 201 PASS；P2 增量后最终 203 PASS，exit 0，5 files；其中 diagnostics 40/host 11/import 152 |
| `npm.cmd run check` | exit 1；lint/typecheck PASS；contracts 5/Web 68 PASS；API 526 PASS、1 个既有 Restore 测试超出原 5000ms；build 未由该命令执行 |
| `npm.cmd run lint` → `npm.cmd run typecheck` → `npm.cmd run test --workspaces --if-present -- --maxWorkers=1` → `npm.cmd run build` | 保持原时限、单 worker 复跑完整链 exit 0：contracts 5/API 527/Web 68 = 600 PASS，lint/typecheck/build PASS；先于最后 P2 增量 |
| 最终 `npm.cmd run lint`、`node --check tests/acceptance/phase3-import-real.mjs`、`node --check tests/acceptance/import-diagnostics.mjs`、`git diff --check` | 均 exit 0，P2 增量之后 |

40 项纯合成诊断用例覆盖严格格式与变形、重复来源/不同事件、全部 readiness 缺项、ERROR/Perflib/Windows fatal/未知 WARN、Java 已知块及变体、overflow、晚到诊断、提前退出不可补授权和合法停止后的历史证明。没有增大 timeout、删除测试或 skip 安全断言。最终全套 602 未重新执行；未执行浏览器 E2E 或新真实宿主验收，产品/UI 未改。

历史 run `p33-import-6a566f55-676b-4019-b674-24673ee9633f` 保持 BLOCKED，Import/Recovery NOT STARTED、finalStopped=true；报告 SHA-256 前后均 `CB692336E2E03672151968F9AF8D8D20307C15BA9DE1CB628BE141C274C7C4D4`。本轮没有修改旧 JSON/raw evidence，未 commit/push。

当前审查代码 SHA-256：

- `phase3-import-real.mjs`：`369A623CA866BB576E2538929F6E4B6EDE9C24F7A508734B23201B039E085EC9`
- `import-diagnostics.mjs`：`1CE7D7248C337646E1A095C0AB5CA310CA1F2FBC499B0BB68682C4AFA3F634FA`
- `acceptance-diagnostics.test.ts`：`0B2328FB91E6F9D58730C07F9BF96EA6A595F580D5BF8C1F59C6BE6BD5085148`

下一步由用户在普通 64 位 PowerShell 使用包装器新建 UUID，从新源世界开始完整验收，详见 [运行指南](./P33C_HOST_ACCEPTANCE.md)。本次 scope signoff 不代表真实 P3.3c PASS。

## 原工具交付记录（保留历史）

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

**（原工具交付时的历史状态）真实验收尚未运行。** 该历史 Sol readiness 审查不替代后续真实验收。当前真实 PASS run 见本文上方记录；运行指南：[P33C_HOST_ACCEPTANCE](./P33C_HOST_ACCEPTANCE.md)。
