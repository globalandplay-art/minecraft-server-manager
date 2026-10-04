# Phase 4 — Players / server.properties

2026-10-05最新接线：配置bootstrap/app/GET/PATCH后端工程切片及独立SolHigh审查PASS，108专项及新冻结925完整测试PASS、lint/typecheck/build PASS；UI及真实配置保存/启动验收尚待完成，P4.3/Phase 4整体未PASS。以PROGRESS顶部及P43_API_STARTUP_2026-10-05.md为准；下面初始顺序和历史阶段范围保留。

2026-10-04: 用户明确授权进入 Phase 4。Phase 3 Final PASS 基线为 `39beabc`；PR #1 未合并，不修改 main。在 `codex/phase-4-players-properties` 保留依赖并独立开发。不调用 Astra。

## 顺序与 Gate

1. **P4.0 设计边界**：沿用 API_SPEC 第 7 节、loopback/Origin、实例锁和恢复门控。每个切片 tests、lint/typecheck/build、独立 Sol High review 通过后推进。
2. **P4.1 在线玩家只读**：固定 `list`，仅受管 running Vanilla + RCON。完整名单必须严格解析且计数一致；无法验证返回 unavailable，禁止空名单冒充无人在线。名字不能推断 UUID；仅后端 opaque session ID。无 kick/ban/op、无额外任意命令入口。UI 提供刷新、采样时间、不可用/错误状态，小屏可读。
3. **P4.2 配置只读 / 规则**：按已注册根目录读取有界、无链接的 server.properties，仅白名单安全字段返回。版本范围由后端规则确定；未知版本禁止未经确认的距离修改。revision 需抗离线猜测秘密，不返回原文件或私密差异。
4. **P4.3 配置保存**：If-Match + 明确意图；实例 admission 内核对 root、revision、ownership、运行/恢复状态；完整原文件先写入私有保护备份、验证和持久化，再原子更新。保留注释、未知配置和秘密；备份不设下载接口。保存不自动重启，列出 restartFields。中断/不确定现场 fail-closed，避免破坏 Phase 3 journal/NO_ACTIVE_WORLD。
5. **P4.4 最终验收**：独立测试目录、受影响回归、新完整 check、真实受管 Vanilla RCON/配置重启与秘密隔离证据、独立 Sol High final review。未满足不得标记 Phase 4 PASS。

同根因最多三次实质不同诊断/修复/针对性验证；第三次仍失败直接在对话报告错误码、原始日志、源码、尝试及安全状态。安全不确定首次停止。无任意路径、shell、凭据传给前端，不触碰用户原世界。

本轮 P4.0 / P4.1 开发，不提前实现配置写入。切片 Gate 通过前不上传；完成切片后的 Git 安全收口沿用用户既有授权，不自动合并。

后续用户要求优先高工作量任务：先审查 [Properties事务内核设计](./P4_PROPERTIES_TRANSACTION_DESIGN.md)，再实施安全reader、保护备份、durable journal/恢复门控及原子切换；普通表单和机械文档随后。切片顺序及全部验收Gate不变。
