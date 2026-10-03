# Phase 3 实施与验收计划

状态更新：2026-10-03；P3.0、P3.1a、P3.1b、P3.2、P3.3b 与 P3.3c Real Import Acceptance 已分别通过其切片验收。最新真实 Import run `p33-import-dd5f7bee-e0a0-4920-9dc9-484b0ab66404` 报告与原始 evidence 已核验，见 [P3.3c 验收报告](./ACCEPTANCE_P33C_2026-10-03.md)。Phase 3 仍 IN PROGRESS：P3.3 世界归档、P3.4 调度/保留及 P3.5 集成最终验收/Review 尚未完成。历史失败保留，合同与安全 Gate 不变。

## 范围与安全默认值

2026-10-02 用户曾明确要求暂跳 P3.2、推进 P3.3，作为开发顺序例外；既有安全和最终独立签核不变。P3.3 按切片推进：P3.3a 只读计划已通过，P3.2 / P3.3b 的真实启动验收和独立最终 Gate 均已 PASS；Minecraft 日志无 ERROR/WARN，Java 25 依赖兼容性告警已保留并独立评估。计划不持久化、不停服、不改配置、不创建世界；实际执行必须另外确认，在实例锁内重验，不能把预览当成执行授权或事务凭证。受限 ZIP 导入已接通，真实隔离验收和最终 Gate 待完成；归档尚未开放。

P3.3b 创建首先停服（运行时须显式授权），验证并固定旧世界 guard，保存私有配置副本，再以同卷 rename 更新世界名和 Seed，持久化 pending-generation，默认保持停止。旧世界所有维度原地保留；新世界仅在后续明确 start 时生成。schema-3 journal 绑定注册根目录、前后配置摘要和 guard；非终态或物理核验失败保持人工恢复锁，不自动启动/回滚。已确认历史成功允许后续正常游玩；不确定 committed 必须核验完整磁盘和停止态。Windows 目录 fsync / 断电持久性限制不变。

P3.3c 实际 Import/显式恢复真实隔离验收 PASS（run `p33-import-dd5f7bee-e0a0-4920-9dc9-484b0ab66404`），包含真实 ZIP 上传、pinned guard、世界切换/旧树保留、显式启动、受控故障、Manager 重启恢复门控、显式恢复及再次启动。历史 BLOCKED report 不改写。自动暂存过期清理未实现；P3.3 世界归档也尚未开放，故 P3.3/Phase 3 整体仍未完成。实现与早期切片 review 见 [Import 审查](./P33C_IMPORT_REVIEW_2026-10-03.md)、[生命周期报告](./P33C_STAGING_REVIEW_2026-10-02.md) 与 [真实验收记录](./ACCEPTANCE_P33C_2026-10-03.md)。限制：压缩 128 MiB、展开 512 MiB、单文件 128 MiB、10,000 条目、深度 32、压缩比 100；仅接纳已验证安全 Vanilla 布局和同版本 NBT，拒绝链接、路径穿越、冲突、ZIP64、加密和异常头/CRC。失败 staging 保留供其所属事务处理。

首个可写布局只支持已验证的 Vanilla world set。主世界目录来自后端验证后的 `level-name`；其下的 Nether / End 及其他实际存在的受控文件一同处理，不能只复制主世界表面目录。Paper、Fabric 与插件多世界只保留明确的未支持状态。世界版本无法可靠读取时显示 unavailable，并拒绝恢复或导入的版本兼容性承诺。

导入 ZIP 只接受两种结构：归档根直接包含一个 `level.dat`，或唯一的顶层目录包含一个 `level.dat`。其余顶层文件、多世界混装、绝对路径、链接、重复规范化路径和特殊文件均拒绝；提取结果只能进入后端生成的 staging。压缩与展开大小、条目数、路径深度、NBT 解码资源以及卷空间同时受限。

恢复、归档与切换写请求在确认框显示世界名、后端给出的 world revision、目标版本和停服影响。提交时带该 revision；实例锁内重新读取并比对，发生外部变更则 409，保留用户输入并要求刷新。revision 由活动世界身份、受控 `level.dat` 摘要和 `level-name` 值生成，不散列完整配置文件，也不暴露本地路径或秘密。

备份前若实例原本运行，必须取得明确 `allowStop=true`，优雅停服并确认受管子进程退出；备份完成后才尝试重新启动。备份有效但重启失败时保留 complete 归档并报告操作未完成，不删除归档。原本停止则备份后仍保持停止。恢复失败不自动回滚或自动重试启动；仅针对该事务拥有的进程尝试优雅停止，保留新旧文件与 pinned pre-restore 快照，提供显式回滚。无法确认进程退出时保持 recoveryRequired 并停止文件切换。

## P3.2 Restore / Explicit Rollback 安全契约

仅允许把同一 serverId 的完整 Vanilla world-set 恢复到该实例当前配置的 active level-name。拒绝 server-snapshot 恢复、跨实例来源、未知或不受支持的世界布局及版本降级；保留 server.properties、EULA、JAR、addons 和其他非世界文件。请求只接受备份 ID 与确认信息，不接受文件系统路径。完整世界树包含三个维度、玩家数据及 saved data。

恢复请求须携带确认世界名、世界 revision、restoreScope=world-set、明确停服许可和明确启动许可，并有 Idempotency-Key。revision 在实例串行锁内、停服前比对；停服会改变 level.dat，因此停服后重新确认同一实例/level-name/世界身份并计算停止态 revision，不要求它与停服前摘要相同。未经用户同意不启动服务器；失败时不自动回滚或重试启动。

在 manager 私有目录创建 pinned 的 pre-restore world-set guard，必须先完整落盘并验证才可切换。源归档复制到服务器卷内随机 staging，逐文件校验 manifest/hash 并 fsync；只有同卷 rename 能切换 active tree，禁止覆盖式复制回退。事务 journal 为每次 rename 先持久化 intent，再执行、校验磁盘实际布局与摘要，最后持久化完成状态。journal 标明 managerRoot/serverRoot 命名空间，兼容读取既有 schema-1 备份 journal；现有 journal 数据模型不能被 restore 事务误解释。

管理器启动时先扫描非终态 restore journal，再开放写 API。必须以真实路径布局、清单摘要和受管进程状态恢复，不以 UI 步骤或缺失 checkpoint 推断文件未移动。损坏 journal、布局不匹配、进程状态未知时 fail-closed，保留所有版本并设置 recoveryRequired。仅允许与该事务绑定的恢复停服和恢复 admission；禁止通用忽略 recoveryRequired 开关。Rollback 是新的幂等操作，绑定原 restore operation、当前 revision、确认世界名和 guard；先保存当前树，再用已验证 previous 或 guard staging 显式恢复。只清除该事务已解决的 recovery cause；启动必须有单独明确许可。操作结果准确报告 restore resource 与 rollbackAvailable。

新建事务 journal 同时绑定注册实例的规范化根目录身份摘要，不在公开 DTO 或日志中暴露根路径。启动 reconciliation、恢复计划、rollback admission 和执行都必须与当前已注册目录身份匹配。同一 serverId / level-name 改指另一根目录时拒绝旧回滚并保持 recoveryRequired；旧 journal 缺少可信绑定时只可人工恢复，不得静默重新绑定。对 committed 但 operation 结果未确认的事务，必须先验证磁盘布局、来源/guard 与受管进程，再报告成功；历史已确认成功的世界之后正常游玩变化不能被原始清单哈希永久锁定。

验收覆盖每个 journal checkpoint 与 rename 前后中断、管理器重启、状态/版本/确认不符、空间不足、损坏清单、junction/symlink、停服/guard/staging/swap/启动失败、提交中断、rollback 中断与幂等重试，以及和 backup/lifecycle/export 并发。只在隔离测试世界执行真实恢复与回滚；不得对用户现有世界做破坏性验收。Windows 目录 fsync 能力需如实记录，不能宣称超出平台保证的断电持久性。

## 切片与关卡

| 切片 | 交付 | 完成证据 |
| --- | --- | --- |
| P3.0 事务基础与布局 | 私有版本化 journal、共享实例写门控、启动恢复扫描、Vanilla WorldInfo、活动世界身份 | 重复/嵌套根目录拒绝；长 seed 精确；未知版本 unavailable；管理器重启后恢复门控仍有效 |
| P3.1a 手动备份核心 | 停服一致性的 world-set 与私有 server-snapshot、列表、初版 Worlds/Backups UI、容量预检、清单 / 文件落盘 | 包含真实维度的逐文件摘要；幂等重试；停服未确认不复制；原本停止不启动；归档完成后重启失败仍保留；Astra Review |
| P3.1b 受限导出 | world-set 下载、导出前秘密扫描与流式传输；server-snapshot 永不对前端下载 | Secret sentinel 不泄漏；路径与响应头安全；断线可重试；桌面 / 移动端下载 UX |
| P3.2 恢复与回滚 | 仅 world-set 恢复、pinned pre-restore、启动检查、失败显式回滚 | journal/rename/配置/启动前后故障注入；管理器重启能识别现场；旧世界可恢复 |
| P3.3 新建、导入、归档 | 新世界计划、受限 ZIP 导入、活动世界归档后持久化无活动世界 | Zip Slip/链接/重复路径/超限/损坏 NBT/跨版本拒绝；管理器重启后不会误生成空世界 |
| P3.4 调度与保留 | 默认关闭的 IANA 每日计划、revision、并集 retention | DST、跨重启去重、无补积压；pinned/失败现场/事务引用不被删除 |
| P3.5 最终验收 | 独立测试世界的浏览器备份→修改→恢复→失败→回滚闭环 | 三档布局、确认焦点、断线查询、同 key 重试、Phase 1/2 回归、GPT-6 Astra 阶段 Review |

任何切片通过仅表示该切片完成，不能把 Phase 3 标记通过。真实恢复使用独立测试世界，不对用户现有世界故意制造崩溃或覆盖。每个文件切换先持久化意图，完成后持久化结果；启动时先检查 journal，再开放写 API 和调度器。公开 operation step 只供展示，不能作为恢复依据。两个 serverId 不得指向相同或嵌套的 canonical root，私有 managerRoot 不得位于服务端根内。
