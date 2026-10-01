# Codex Operating Goal and Model Routing

生效日期：2026-10-01。本次 Model Routing Policy Migration 替代冲突的 ACTIVE FUTURE INSTRUCTION；HISTORICAL RECORD 不改写。本文是项目执行策略，不是账户配置、模型切换器或 Review 签核。

## 1. 执行目标与边界

在全部既有质量、安全、测试和 Review Gate 通过的前提下，最小化到最终 PASS 的总 token / allowance；计算推理、测试、返工、上下文和协调成本，不只看单次调用成本。

产品仍为本地优先的 Minecraft Java Server Manager：React / Vite / TypeScript 前端、Fastify / Node.js / TypeScript 后端、统一 Adapter，管理已有服务端目录。Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 顺序与范围不变。

模型策略迁移时的进度快照见当时的 PROGRESS 记录。此后 P3.1 Final Review / Gate 已通过；当前实际检查点以 [PROGRESS.md](./PROGRESS.md) 顶部最新记录为准。迁移方案中的 P3.1b NEXT 原为旧快照；后续完成记录不改变此前 Review 与真实验收的历史署名。后续变更若使既有验收证据失效，必须重验。

文档迁移不得开展产品开发、启动 Minecraft、操作真实世界、创建子智能体、执行 Astra Review、commit、push 或 PR。用户要求停止使用智能体的限制继续有效，未来预算上限不能解除该限制。

## 2. 默认配置、可用性与优先级

- DEFAULT_ENGINEERING_MODEL = GPT-6.1 Sol。
- DEFAULT_REASONING = Medium。
- DEFAULT_SUBAGENT_BUDGET = 0。
- 普通复杂 Feature 的默认独立 Reviewer = GPT-6.1 Sol / High。
- 模型选择、升级、Review 或代理调度时查本文；接续时查 PROGRESS。其他时候只读任务相关内容。
- 本文与根目录 [AGENTS.md](../AGENTS.md) 是未来策略入口；ARCHITECTURE §13 与 PROGRESS 当前调度摘要同步本文。历史阶段实现者、Review 署名及当时计划保留。
- GPT-6.1 Sol 不可用时临时 fallback 为 GPT-6 Sol / 同 effort；下一次选择重新检查，可用后回到 6.1 Sol。Luna 不可用时记录原因并使用 Sol Medium。旧 5.6 模型只用于有记录的 fallback、对照或用户明确选择。
- 不修改账户设置，不声称 Markdown 切换了活动主模型。有选择能力时显式选择；没有时记录建议路由与限制。工具清单不能证明已调用或额度充足。
- 必需 Astra Gate 的模型不可用时保持 pending，不能用 Sol / Luna 冒充。没有独立执行条件时独立 Review 同样保持 pending；主写入者自检不能冒充独立签核。可在主线程切换 Reviewer 或另一个获授权会话中完成，不要求默认派发 Agent。

## 3. 工程模型分工与 effort

| 模型 / effort | 使用范围 |
| --- | --- |
| GPT-6 Luna / Low | 仓库搜索、文件定位、调用关系、信息提取、机械 rename、lint / 简单类型错误、明确单点修复、文档小修改、简单测试补充 |
| GPT-6 Luna / Medium | 已有明确设计的小功能、普通 React UI、简单 endpoint / CRUD、局部 contracts 同步、明确 fix list、测试覆盖补充、简单重构 |
| GPT-6.1 Sol / Medium | 默认工程；普通完整 Feature、React + Fastify 联动、API / contracts / service、普通文件工作流、Backup 扩展、Operation integration、中型重构、普通 Debug、子阶段开发 |
| GPT-6.1 Sol / High | 复杂事务、并发 / race、疑难 Debug、文件状态转换、事务不变量、安全敏感实现、Restore / Rollback 核心、Adapter 架构、核心模块复杂耦合；普通复杂 Feature 独立 Review |

Luna 不主导 Restore、Rollback、transaction journal、filesystem transaction、Adapter architecture、Auth 或 Remote Access。

升级依据是风险、耦合度、不确定性、状态空间、安全边界与失败后果，不是文件数、diff 长度或表面规模。普通测试失败先定位原因，不自动跳到 Astra High。可以直接选择 Sol High + 必需 Astra Gate，不要求 Luna Low → Medium → Sol Medium → High → Astra Medium → High 逐级尝试。

困难部分解决后降级：Sol High 设计核心 → Sol Medium 正常路径 → Luna 明确测试、文档和机械修改。Astra 完成 Gate 后不继续承担 CSS、lint、普通测试、README 或 CRUD。

## 4. Review 分级与 Astra

| 级别 | 执行者 | 条件及交付 |
| --- | --- | --- |
| R0 — Self Check | 主写入者 | 每个代码任务：相关测试、lint、typecheck、适用 build、diff review；文档任务检查链接、策略一致性与 diff |
| R1 — Luna Review | Luna Low / Medium | 仅简单机械修改，不代替复杂 Feature 或安全 Gate |
| R2 — Sol Review | 优先 GPT-6.1 Sol / High | 普通 / 中型完整 Feature 的默认独立 Review；记录范围、风险、发现与复查证据 |
| R3 — Astra Gate | 按下表选择 effort | milestone、安全 Gate、高后果、不可逆 / 破坏性工作流及重大 Phase 最终验收 |

普通任务：实现 → 自检。中型 Feature：Sol Medium 实现 → Sol High 独立 Review。安全敏感 Feature：Sol Medium / High 实现 → Sol High Review → 必要时 Astra Medium Gate。高后果 Feature：Sol High 核心 → Astra High Gate。适用测试、真实验收与必需 Review 都要完成。

| Astra effort | 使用条件 |
| --- | --- |
| Low | 确有价值的额外独立视角、限定架构或安全检查；普通独立 Review 默认优先 Sol High，Astra Low 不是必经步骤 |
| Medium | milestone、子阶段最终安全 Gate、重大架构决策、P3.1 Final Gate、P3.3 Import、P5 Addons、P6 高风险 Crash Analysis |
| High | 高后果 Restore / Explicit Rollback、data-loss、filesystem durability、crash recovery、Auth / authorization / Remote Access、Adapter 架构最终 Gate、Phase 3 最终闭环、首次正式发布前高级安全 Review |

不是所有涉及文件、安全、原子写或 ZIP 的普通变更都直接 Astra High。依实际后果执行风险 Gate；P3.3 普通导入为 Medium，明显数据损失风险升 High；P3.4 重大清理风险为 Medium，若实际达到不可逆数据损失 / durability 高后果则执行 High。

五个原强制高级节点保留：Phase 1 架构确定后、Adapter 架构完成后、Mods / Plugins 完成后、Remote Access 开始前、第一版正式发布前。Adapter 与 Addons 分别记录；已完成历史节点不重新署名。Astra 不再承担所有阶段默认 Review。

## 5. Phase 3 路由与进入条件

| 子阶段 | 主实现与分工 | Review / Gate |
| --- | --- | --- |
| P3.1b Secure World-set Export | Sol Medium；subagents = 0 | Sol High 独立 Review；不默认单独 Astra |
| P3.1 Final | 修复与测试按实际风险用 Sol Medium / High | Astra Medium；高后果问题触发 High，记录依据 |
| P3.2 Restore / Explicit Rollback | 架构 / 核心事务 Sol High；正常实现 Sol Medium；明确普通测试 Luna Medium | 实现 Review Sol High；Final Safety Gate Astra High |
| P3.3 Create / Import / Archive | 主实现 Sol Medium；普通 UI / CRUD Luna Medium；ZIP、Zip Slip、symlink、路径安全 Sol High | Final security Gate Astra Medium；明显 data-loss 风险升 High |
| P3.4 Scheduler / Retention | Sol Medium；普通 UI / 测试 Luna Medium；DST、时区、重启去重 Sol High | Sol High；重大清理风险 Astra Medium，高后果风险按 §4 升 High |
| P3.5 Phase 3 Final Acceptance | Sol Medium；失败分析 Sol High | Final Phase 3 Gate Astra High |

P3.1b 的未来工作链为 Sol High Review → 修复 → 相关完整测试 → 独立真实测试世界验收 → P3.1 Final Gate。已有历史 Review 与验收保持原署名；不得伪造一次新的 Sol High Review。本地剩余 P1 修复的独立审查纳入待完成的 P3.1 最终复审；不能用旧 P3.1b Review 代替修改后的整体签核。

只有 P3.1b、独立测试世界验收及 P3.1 整体 Review 全部通过，才进入 P3.2。当前只迁移策略，不执行复审或推进阶段。

## 6. Phase 4–7 路由

| 工作项 | 实现 | Review / Gate |
| --- | --- | --- |
| Phase 4 Players | UI / 展示 Luna Medium；主实现 Sol Medium | Sol High |
| Phase 4 server.properties | Sol Medium；file safety / revision / atomic write Sol High | Sol High，通常不需 Astra；出现高后果风险按 §4 |
| Phase 5 Mods / Plugins | CRUD Sol Medium；JAR metadata / 文件安全 Sol Medium / High | Astra Medium 安全 Gate |
| Phase 5 Adapter | 架构 Sol High；实现 Sol Medium / High | 最终 Astra High |
| Phase 6 Performance | Sol Medium | Sol High |
| Phase 6 Crash Analysis | Sol Medium / High | 高风险判断 Astra Medium |
| Phase 7 Auth / Remote Access | 架构与实现 Sol High | Astra High；Remote 开始前检查仍必需 |

## 7. 子智能体预算与单写入者

全部层级默认 0；默认不是多 Agent。用户停止使用智能体的指令优先，本次及当前接续不得派发；下表仅是未来获授权后仍不得超过的上限。

| 主任务层级 | 默认 | 特殊上限 |
| --- | --- | --- |
| Luna Low / Medium | 0 | 0 |
| Sol Medium | 0 | 1 |
| Sol High | 0 | 2 |
| Astra Low | 0 | 0 |
| Astra Medium | 0 | 1 |
| Astra High | 0 | 2；仅大型安全审计可例外 3 |

预算涵盖所有活跃后代，不含主任务，并受环境并发上限约束。使用前说明总工作量减少或独立视角的必要性；计入上下文、整合和返工成本。上限不是默认授权或用满目标。

Agent 优先 READ ONLY：仓库探索、调用图、测试缺口、失败模式、diff Review、安全面分析。OperationService、TransactionJournal、BackupService、Restore、lifecycle、process supervisor、RCON、active world state、共享事务 contracts 必须由单一主写入者负责；禁止多个 Agent 同时修改这些耦合模块。

## 8. 工程、质量与 Git 不变量

以下合同不受模型优化覆盖：

- local-first、仅监听 127.0.0.1、Host / Origin 校验；serverId 映射注册路径，无任意文件路径或任意 shell API。
- canonical path 与 containment 验证、symlink / junction / hard-link 保护；校验扩展名、大小与目标目录，限制上传及归档解压资源。
- per-server locking 与序列化写入、Idempotency-Key、持久化 operation records、durable transaction journal、recoveryRequired 门控。
- 停服确认后的 consistent backup；world-set-only Restore、pinned pre-restore guard backup、explicit rollback；staging、checksum、fsync、安全 rename / atomic replacement 与 crash recovery 检查。
- Restore 必须确认停服、保护备份、验证恢复与显式回滚；不静默重启，不自动接受 EULA；Java 版本检测；RCON 秘密不返回前端。
- 指标无法测量时返回 unavailable / N/A，禁止伪造数据。

每个代码任务保留相关 tests、lint、typecheck、适用 build、diff review；按阶段保留 Playwright、真实 Minecraft、独立测试世界、failure injection 与必需安全 Review。检查受阻如实记录，不冒充 PASS；修改后受影响的证据必须重验。

使用 feature branches 与 Conventional Commits。commit / push / PR 仅在用户授权范围内；上传前检查敏感内容、remote、冲突与不确定性，异常立即停止报告。保留 runtime / 世界 / 备份 / 秘密；禁止 force-push main、rebase、squash 或其他历史改写；失败检查不得合并。

## 9. 历史核验记录与迁移说明

保留历史模型和签核：Phase 1 / 2 的 GPT-5.6 Sol 实现与 GPT-6 Astra Review、P3.0 / P3.1a Astra Review、P3.1b Astra Medium Review、P3.1 首次 Astra High Review 与 P1 发现。新策略不将记录改为 Sol Review，不撤销历史结果，也不自动批准修复后版本。

旧 ACTIVE POLICY 中普通 Review = Astra Low、P3.1b 单独 Gate = Astra Medium、P3.4 默认 Astra Low / Medium 以及按“涉及安全 / 解压 / 原子写”一律 Astra High 的规则，已被本文 R2 / R3 风险路由替代。旧“未来普通实现必须 GPT-5.6 Sol / 所有阶段 Astra”的规则不再有效；历史章节中相同字样只是当时记录。

以下是此前文档迁移记录的本地工具声明清单，保留为 HISTORICAL RECORD，不表示逐个调用成功、当前额度充足或 API 通用参数：

| 模型 ID | 当时环境声明支持的 reasoning |
| --- | --- |
| gpt-6-luna | low, medium, high, xhigh, max |
| gpt-6.1-sol | low, medium, high, xhigh, max, ultra |
| gpt-6-astra | low, medium, high, xhigh, max, ultra |
| gpt-6-sol | low, medium, high, xhigh, max, ultra |
| gpt-5.6-sol | low, medium, high, xhigh, max, ultra |
| gpt-5.6-terra | low, medium, high, xhigh, max, ultra |
| gpt-5.6-luna | low, medium, high, xhigh, max |
| gpt-5.5 | low, medium, high, xhigh |

[OpenAI GPT-6.1 Sol 模型文档](https://developers.openai.com/api/docs/models/gpt-6.1-sol) 可用于核对模型说明；本项目 effort、Review 与预算是用户指定策略，不是官方强制 Gate。本次没有改变账户设置或活动主模型，没有启动 Agent 或执行独立模型签核。
