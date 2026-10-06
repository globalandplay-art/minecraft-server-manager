# P4.4 真实隔离验收 — REAL ACCEPTANCE PASS

最新宿主 run `p44-properties-80690902-6c9b-48ab-98d9-42413ca0788f` 原始报告已读取核对：result/properties/players=PASS，finalStopped/sourceInputsUnchanged=true，全部六项finalState=true，无活动操作、恢复锁或占用端口。两次受管Java launch分别PID33580/20384，fresh Done、cleanDiagnostics=true、exitCode0/exitSignal=null。配置guard/旧字节、journal、同key重放、Manager重开、实际creative/hard/max3与三维marker检查通过。用户宿主运行，本轮只读核验并同步文档；未启动新Java、未commit/push。

这是明确范围内的真实配置/空玩家名单验收PASS；Phase 4整体Final Review及最终收口仍待完成，不自动进入Phase 5。以下保留此前预检BLOCKED原始记录，不改写历史结果。

新增 `tests/acceptance/p44-real-properties-acceptance.ps1` 与 `phase44-properties-real.mjs`，复用已审查的 Archive 宿主预检、fresh UUID、canonical 检查、独立端口、受管 Java 捕获、诊断分类和归属明确的清场边界。仅复制已确认隔离实例 JAR/已接受 EULA，不读取原世界，不修系统，不自动重试。

流程：生成真实隔离三维 marker → 正常停服 → GET revision → PATCH 五个安全字段 → 202 后等待 operation 成功 → pinned 私有原文件备份/旧文件精确字节核验 → committed journal / 世界摘要不变 / 秘密与未修改配置保留 → same-key replay → Manager 重启 → 无恢复锁 → 明确启动 → CREATIVE / difficulty hard / 最大玩家数3 / 完整空名单 / 三维 marker 验证 → 正常停服。

## 当前证据

2026-10-05 Codex 会话只执行预检，run `p44-properties-cddda35f-ab27-423e-9bec-b12fbea98c20`：exit1，HOST_PRECONDITION_UNAVAILABLE。Get-Counter PASS；Perflib 注册表读取 unavailable，code HOST_PERFLIB_UNAVAILABLE，HResult -2146233087。原始错误：

```text
Cannot find path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' because it does not exist.
```

这是当前工具会话的环境不可用证据，不证明真实宿主 Windows 故障。没有启动 Java、没有创建 server runtime、没有配置写操作、没有 active operation；私有预检报告保留在 `.manager/<runId>/acceptance-report.json`。没有修复尝试或重复测试，不以此报告产品 PASS。

Node / PowerShell 语法检查、lint、diff 检查 PASS；产品源码未改变，946 项冻结完整基线仍为 UI 工程证据，不冒充真实 Java。独立 Sol High PRE-RUN SAFETY REVIEW PASS，无阻塞P1/P2；建议的operation/guard绑定、重开后原请求重放及wrapper完整终态核验断言已补。P4.1 真实玩家验收、P4.3 配置生效验收及 Phase 4 Final Gate 尚未 PASS。

Manager 重启在同一Node进程内关闭并重建应用，不是新Node进程或断电；真实玩家验收为RCON验证完整空名单，不含实际玩家连接。上述限制必须保留。

后续在普通64位宿主 PowerShell 执行新 wrapper。保留历史 BLOCKED，不自动上传 GitHub。
