# 实施进度

更新时间：2026-10-01


## Phase 3 当前检查点

### 2026-10-01 P3.1 最终复审 — PASSED

按用户授权执行两次独立只读 Review：GPT-6.1 Sol / High 对 P3.1 修复、导出和下载实现复审 PASS；GPT-6 Astra / Medium P3.1 Final Gate PASS。两位 Reviewer 均确认此前两个 P1 已修复，没有发现阻塞 P3.1 的新问题。独立真实 Vanilla 26.3 / Java 25 测试世界验收及真实浏览器下载报告已核对为 PASS，覆盖 Overworld / Nether / End、manifest 与 ZIP 摘要、server-snapshot 拒绝、管理器重启后持久性及 360px 实际页面下载。具体范围和限制见 Review 报告及上文真实验收记录。

本次复审只读，没有重跑测试或重新启动 Minecraft。过去的全仓 check、lint、typecheck、build 和专项测试结果仍是原有执行记录，不标作本次重跑。边界说明：无法保证抵御拥有相同 OS 写权限的进程在校验后原地改写下载文件；秘密扫描也不覆盖任意 NBT / region 二进制内容。Review 确认二者属于已记录的本地信任边界限制，不阻塞本 Gate。

Phase 3 的 P3.1 已通过既定实现、测试、真实世界验收与独立 Review Gate；当前下一步为 P3.2 Restore / Explicit Rollback 的架构与风险设计。P3.2 涉及文件切换、数据丢失与 crash recovery，核心设计和实现使用 Sol High，且恢复 / 显式回滚必须通过 Astra High 安全 Gate。开始恢复实现前须完成方案、故障状态机、journal/atomic replacement/crash recovery 不变量及测试计划；真实 Restore 只在独立测试世界执行。
### 2026-10-01 接续 — P3.1 真实验收与一致性修复

用户要求停止使用子智能体，后续没有派发或续用任何智能体。P3.1 整体独立只读 Review 已于本轮执行并发现两项 P1：运行时预检与正式备份之间的实例状态发生变化时，可能把 `unknown` 当成 stopped 复制活动世界；备份复制 / 验证失败后仍可能自动启动。现已加入共享严格状态校验、停服后与复制前双重核验；failure path 保留 stopped + recovery-required journal，不自动启动。新增状态变化、运行实例未停成、复制前变 unknown、运行实例未授权及失败 journal 留存测试。人工交接时定向 API 两个文件 44 项通过。新增 Nether / End 维度文件的离线服务测试。

真实验收首次发现 Vanilla 26.3 实际写入 `dimensions/minecraft/{overworld,the_nether,the_end}` 和 `data/minecraft/*.dat`，原有导出白名单不包含本地验证出的这些结构，已用正向精确结构规则增加支持，并为实际维度 region、namespaced saved data 与 `players/data/*.dat` 增加专项测试。另有两次验收运行因验收脚本对旧版 DIM-1/DIM1 假设及二进制 HTTP 响应的 JSON 读取假设而未通过；均修复后以全新隔离世界重跑，成功报告为 **PASS**。

成功报告位于忽略的本地运行时目录 `.manager/p31-real-f4f4c812-aeaa-4442-8778-ad3b9baa887a/acceptance-report.json`。真实 Vanilla 26.3 / Java 25.0.4.1 由管理器启动，测试使用新建独立世界，未访问原世界目录。验证了：运行中未授权备份被拒绝且服务器继续运行；授权后管理器停服并校验 manifest 中 38 个文件（包含 Overworld / Nether / End），同幂等键重试复用操作，随后重启；ZIP 在独立解析器内逐条对 manifest 校验、SHA-256 及响应头一致，未包含 RCON sentinel；修改活动测试世界不更改既有备份或导出；停服实例备份后仍停服；server-snapshot 导出和下载为 403；重启管理器后备份、操作状态及导出仍有效；源服务端 JAR 和 EULA 哈希不变。管理器最后确认 stopped。报告含服务器私密测试路径，仅留在被忽略的 `.manager`。

最终产品代码全仓 `npm.cmd run check` 退出码 0：contracts 4、API 186、web 39；lint、TypeScript、构建全部通过。`git diff --check` 通过。Astra High 首次整体审查找出的两项 P1 已修复并有针对性回归；因用户明确要求停止使用智能体，本轮不安排独立 Astra 复审，**P3.1 整体 Review Gate 仍待独立签核**。

在第一份 PASS 证据（API注入真实 Minecraft）基础上，修正 Vite 根目录后，再次全新运行真实隔离实例及真实 Chrome 测试。最终 PASS 报告位于 `.manager/p31-real-a2b43d35-d6cc-4209-972a-ea21392f39a5/acceptance-report.json`，除上述真实 API 验证，还通过 360px 浏览器 Backups 页面为真实 26.3 测试世界创建 world-set 导出、自动下载 ZIP，逐文件哈希匹配，且页面无运行时错误、没有水平溢出。两次浏览器初试分别遇到 Playwright headless 无已安装二进制（切换为项目既有 Chrome channel）及 Vite 根目录配置错误，均在最后 PASS 运行前修复。浏览器 API / Vite / Java 进程均在脚本结束时收尾，报告确认 Minecraft stopped。原用户世界未被读取。

（截至下方 P3.1 Final Gate 通过前的历史状态。）Phase 3 / P3.1 当时保持 IN PROGRESS，不能进入 P3.2，原因仅为独立整体复审仍待完成。按本次未来调度迁移，P3.1 Final Gate 默认 Astra Medium；若复审范围出现高后果数据损失、durability / crash recovery 等风险，按 CODEX_MODEL_ROUTING 升级 High 并记录依据。此前 Astra High 首审与 P1 发现仍为历史事实，没有补签修复后的版本。后续必须在用户仍授权的情况下，由非主写入者只读复审本轮 P1 修复；用户已要求不使用智能体，本次不得擅自再启动智能体。没有提交或推送。

P3.0 事务基础与只读 Vanilla Worlds 盘点已完成并通过 GPT-6 Astra Review。`npm.cmd run check` 全部通过：contracts 4 项、API 141 项、web 29 项测试，以及 lint、TypeScript 检查和生产构建。Review 确认同实例命令、启停与独占写任务互斥；journal 和活动世界身份持久化在管理器私有目录；Worlds GET 不修改服务器目录；状态不一致或持久化失败时会进入恢复门控。当前 `worlds` feature 仍标记为未实现，因为 P3.1–P3.5 的备份、恢复、世界管理 UI 与验收尚未完成。

P3.1a 手动备份核心已通过 GPT-6 Astra Review，代码已在 `c2bbc33` 本地提交。交付包含停服一致性的 Vanilla world-set / 私有 server-snapshot、manifest 校验、停服前空间估算、逐文件 fsync、完整递归目录链同步（Windows 对 Node 不支持的目录 fsync 错误按事务 journal 相同的平台限制处理）、备份列表、同 payload / 同幂等键恢复重试与 24 小时期限、明确拒绝后的 pending 清理、操作轮询、真实 readiness 与 Worlds / Backups 首版页面。世界版本从 level.dat 探测，不可确认时返回 null。最新全仓 `npm.cmd run check` 通过：contracts 4、API 149、web 34，lint、类型检查和三项生产构建均通过。Playwright E2E 本轮未能启动：取得 loopback 权限后，runner 子进程因 `uv_os_get_passwd returned ENOMEM` 在 web server 启动前退出；不得将此记作 E2E 通过。P3.1a 交付时受限 world-set 下载与秘密扫描尚未实现，单列为 P3.1b；当前进展见下方切片记录。真实独立测试世界验收也尚未执行。此 worktree 没有配置 Git remote，不能 push 或建 PR。

### P3.1b — Secure World-set Export and Download（切片 Review 已通过）

2026-10-01 续接 Review：实际调用 GPT-6 Astra / Medium 独立只读审查及复审，P3.1b 签核 PASS。首次审查发现 P1：stats / advancements 白名单允许 `.JSON` / `.Json`，但生成与下载复核使用大小写敏感判断，导致秘密扫描被跳过；现两处统一为大小写无关 JSON 扩展名检查，新增初次生成、伪造匹配 CRC / manifest / artifact 摘要的缓存下载与复用回归。P2 下载诊断缺口已补“重新校验并下载”，新幂等键通过既有 operation 重新校验，失败显示原因并移除下载链接。Ready 明确表示导出已校验；浏览器原生下载的传输结果仍由浏览器下载列表确认，页面不声明下载完成。缓存损坏安全拒绝，不自动修复缓存。

修复后完整 `npm.cmd run check` 退出码 0：contracts 4、API 172、web 39；lint、typecheck、build 全通过。导出 API 专项 23 项与页面专项 9 项通过。专用隔离浏览器测试 360 / 768 / 1440 三档断言通过，新增重新校验后的二次下载与原 ZIP 字节一致检查；该测试仍只使用合成世界，不替代真实 Minecraft 验收。Astra 查看过三档截图；本轮仅主任务写入修复，一名 Astra 子任务只读审查，无 commit / push、无真实服务器操作。

专用浏览器测试最终退出码 0（3 passed）；Windows runner 收尾再次等待其自启服务进程，已核实进程命令行后仅关闭本轮合成测试 API / Vite，未操作真实 Minecraft。新增 E2E 重试断言后 lint 再次通过。

本切片 Review 与实现已完成；以下候选版本记录保留作为历史。下一步是 P3.1 整体 Review 和独立真实测试世界验收，两项仍待完成，Phase 3 / P3.1 保持 IN PROGRESS，不进入 P3.2 Restore / Explicit Rollback。

2026-10-01 已实现候选版本：从 P3.1a 不可变备份读取并验证 manifest，正向 allowlist 校验 Vanilla 世界文件、检查 payload 清单与目录的完整对应关系，拒绝 traversal、Windows ADS / 保留名、symlink / junction 和硬链接；不读活动世界，不导出 server-snapshot，不包含服务器配置或原始 manifest。文本仅允许世界 JSON（2 MiB 上限），解析后扫描包括转义 key 在内的 password / secret / token / apikey；properties / yaml / toml / cfg 等不属于导出白名单，直接拒绝。NBT、region 和 player binary 不当作文本扫描；扫描不是任意二进制秘密检测保证。

使用最小新增 backup-export operation kind，复用现有持久化操作记录、幂等键、每实例互斥；只读导出在管理器重启后标记 interrupted / EXPORT_INTERRUPTED，不误触世界恢复门控。备份 journal 与生命周期执行语义保持不变。后台生成受限的 stored ZIP（2 GiB 世界数据、60,000 文件，不支持 ZIP64、datapack 或未知布局），逐文件重新计算 manifest SHA-256，临时文件 fsync / rename 后才发布 ready 元数据。每个 backup 复用一个固定 artifact；无副作用的状态 GET 只读取已完成备份与缓存状态，不生成或停服。下载前在同一文件描述符重新校验 ZIP 固定结构、manifest 文件摘要与文本秘密，拒绝额外条目、注释及尾部数据，不能用伪造缓存 checksum 绕过。默认不压缩以保持流式有界内存；大文件下载前的完整验证会增加等待时间。

API：POST /api/v1/servers/:serverId/backups/:backupId/exports（JSON {} + intent + UUID Idempotency-Key，202）；GET 同路径查询 available / ready；GET /api/v1/operations/:id 查询 scanning / exporting / failed 等；GET /api/v1/servers/:serverId/backups/:backupId/download 流式 ZIP，系统生成 filename、no-store、nosniff、Content-Length 与 X-Archive-SHA256。服务端快照返回 403 / EXPORT_NOT_SUPPORTED，秘密扫描命中返回 SENSITIVE_ARCHIVE，缺失备份 404，未生成导出 409。Backups 页展示导出状态、错误、相同幂等键确认与 ready 后浏览器下载 / 手动重试入口；私有快照没有下载操作。

最终验证：lint、全仓 TypeScript 检查与生产 build 通过；contracts 4、API 169、web 38 项测试通过（API 中导出专项 20 项，包含取消后关闭与重试）。全仓 check 在 API 168 项时通过；新增一项取消测试后，API 全套 169 项、API typecheck 与 lint 重新通过。最终代码的专用 Playwright 360 / 768 / 1440 三档共 3 项通过，真实下载字节 SHA-256 与 artifact 状态一致，截图记录在 test-results/screenshots/phase3-export-*.png。git diff --check 通过。隔离 Playwright 使用 tests/phase3-export.config.ts，真实管理器 API / Vite + 临时合成世界，不执行 Java 或真实 Minecraft；普通默认 Mock E2E 会跳过此专用测试。初次拦截式浏览器 fixture 下载未被拦截，失败已如实记录并改为独立真实 API fixture，未把失败当成通过。

Review 自检：server.properties / RCON 配置不进入 ZIP；使用 allowlist + manifest + 内容检查，不仅靠 blacklist；拒绝越界与链接；复用既有备份与 operation，不改 Restore / Rollback / 生命周期架构。私有管理器存储仍属于可信本地用户边界；不保证抵御拥有同一 OS 权限、在校验后持续原地写入文件的进程，需 Astra 检查文件竞态与下载断线资源释放。测试 runner 在 Windows 结束时可能滞留自启开发进程，本轮仅关闭自己启动并已识别 PID 的测试 API / Vite。

本轮按用户要求单主任务实现，没有创建子智能体、没有调用 Astra、没有 commit / push、没有修改真实服务器数据。当前主任务无法通过工具自切模型，没有虚构 GPT-6.1 Sol / Medium 执行署名。前轮模型策略文件与 ARCHITECTURE 的未提交变更单独保留，不算本切片业务改动。

下一步：GPT-6 Astra / Medium 独立安全 Review，然后 P3.1 整体 Review 与独立真实测试世界验收；全部通过才允许进入 P3.2 Restore / Explicit Rollback。当前 Phase 3 / P3.1 仍 IN PROGRESS，本轮在候选实现和验证后停止。

## 授权与推进方式

用户已授权按阶段实施、测试和 Review，并在每个阶段通过后自动连续推进，无需在每个 Phase 结束时重复请求确认。每个阶段仍必须完成与风险相称的测试和 Review，真实记录结果；失败、限制或需要扩大既定范围的决策应明确报告。Phase 1 与 Phase 2 已完成测试及 GPT-6 Astra 阶段 Review；下一阶段为 Phase 3 Worlds / Backups。

之前用于续接工作的 heartbeat automation `minecraft-manager` 已按用户要求关闭。本线程由当前任务继续执行，不依赖后台定时任务。

2026-10-01 Model Routing Policy Migration：普通工程默认 GPT-6.1 Sol / Medium，简单任务用 GPT-6 Luna Low / Medium，默认 subagent budget = 0；普通完整 Feature 的独立 Review 默认 Sol High，Astra Low 仅用于有明确价值的额外独立视角。P3.1b 未来实现 Sol Medium / 0 agents、Review Sol High，不单独默认 Astra；P3.1 Final Gate 为 Astra Medium。P3.2 Restore / Explicit Rollback 最终 Gate、Adapter 最终、Auth / Remote、Phase 3 最终与正式发布前高级安全 Gate 为 Astra High；Import / Addons 等里程碑为 Astra Medium，按实际高后果风险升级。完整规则见 [CODEX_MODEL_ROUTING.md](./CODEX_MODEL_ROUTING.md)，入口见根目录 AGENTS.md。6.1 Sol 不可用时临时 6 Sol / 同 effort，下次选择核验后返回 6.1。用户“不使用智能体”的限制继续有效；不修改账户设置，不声称文件切换主模型，不以自检冒充独立 Review。（策略迁移时的历史检查点：当时未推进产品；其待复审状态已由本文件上方 2026-10-01 P3.1 最终复审记录更新。）

## Phase 1：Dashboard 与只读 Servers

状态：已通过。

计划验收范围：

- React + Vite 在 `127.0.0.1:3000`，Fastify 在 `127.0.0.1:8080`，浏览器通过同源 `/api/v1` 真实联通；
- Dashboard 固定八项指标、持续可见的 Mock 标识，以及 TPS / MSPT 的 `N/A` 语义；
- Servers 列表、实例切换、刷新与 `?server=<id>` 保留；
- 后续 Phase 页面只显示范围与阶段说明；
- 未知实例、空列表、API 断线、响应格式异常、不可用指标与超过 15 秒的旧数据状态；
- 360×800、768×1024、1440×900 的响应式布局和主页面横向溢出检查；
- GPT-6 Astra 使用真实浏览器截图完成 Phase 1 UI Review。

验收记录（2026-09-27）：

- `npm.cmd run check` 通过：ESLint、三 workspace typecheck、contracts 3 项、API 26 项、web 9 项单元 / 集成测试及生产构建全部通过；
- `npm.cmd run test:e2e` 通过：Chrome headless 11/11，真实验证 Vite 3000 → Fastify 8080 链路，并直接核对 8080 health；
- E2E 覆盖八项指标、Mock / N/A、实例 query、阶段占位、未知 ID、空列表、schema 错误、Dashboard 断线旧数据、Servers 失败与 pending 超过 15 秒的降级和恢复；
- 360×800、768×1024、1440×900 均无主页面横向溢出，截图位于 `test-results/screenshots/`；
- 使用非敏感临时 sentinel 验证 Vite 不会通过 `/@fs` 暴露 `.manager`，测试结束后 sentinel 已清理；
- GPT-6 Astra 已完成最终源码与 UI 签核，并实际查看三张浏览器截图；Review 通过，无布局、截断、Mock、N/A 语义或源码阻塞项；
- `npm.cmd ls` 通过；全依赖与 production `npm.cmd audit` 均为 0 vulnerabilities。

Phase 1 过程中发现并修复了 Vite workspace 私有目录暴露、Servers 缓存状态长期保持绿色、pending 读取未过期，以及 unavailable 指标未随整张快照标旧等问题。本地提交由主任务完成；仓库仍未配置 remote，因此 push / PR 未执行。

## 后续阶段

Phase 2–7 的边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)、[API_SPEC.md](./API_SPEC.md) 与 [UI_SPEC.md](./UI_SPEC.md)。Phase 2 的真实 Java 生命周期、Console 和 WebSocket 已完成；Worlds / Backups、Players / Properties、Addons、Performance / Crash Analysis 与 Remote Access 仍未实现。

用户已提供独立的真实测试实例目录，JAR 内 version.json 已确认版本 26.3、java_version=25、stable=true；管理器使用已验证的 Java 25.0.4.1 executable。EULA 已为 true。2026-09-28 复核发现，前一次三个文件的“访问被拒绝”来自沙箱缺少该外部目录的写权限；取得该目录的本轮写权限后，三个文件均可用读写方式打开。不能再将先前的错误归因于旧 Java 进程锁。

2026-09-28 已在同一管理器进程中重新完成真实启动、RCON `list`、重启和停止，相关 operation 均成功；停服后已关闭该管理器进程。Console WebSocket 的真实握手、快照、增量日志和浏览器联调已通过。Phase 2 最终 Astra Review 已通过；没有 Git remote，因此不执行 push / PR。

## Phase 2 当前检查点（2026-09-28）

Phase 2 在 `feature/phase-2-lifecycle-console` 完成主要编码并分成独立本地提交：`5429921`（Vanilla 后端与共享契约）、`21679e5`（生命周期控件与 Console）、`07ba0d1`（浏览器测试与文档）、`8484422`（崩溃后安全手动重启修复）。最终 `npm.cmd run check` 以退出码 0 通过：ESLint、三 workspace typecheck、contracts 3 项、API 109 项、Web 29 项测试与生产构建。前端 Console、生命周期确认、WebSocket 重连/gap、命令输入和过期快照保护已实现。

真实 Vanilla 26.3 实例已完成 dry-run 与 apply 测试设置：原 `server.properties` 已备份到私有 `.manager/setup-backups`，仅更新本机监听、RCON 开关、RCON 端口和随机 RCON 密码，密码未输出。后端重新检测到 Vanilla 26.3、Java runtime 25.0.4.1、required Java 25，状态探测可正确识别停服。

真实生命周期验收已在 2026-09-28 复测：启动 `68e4a7ce-b92d-4428-9496-a1d2acf85824`、重启 `393bec52-dc30-47bc-aaf9-202dd854823b`、停止 `efe17e64-b527-4ab9-ba4c-a6c126853bac` 均为 `succeeded`；`list` 经 RCON 返回 0/20 玩家。再次启动/停止也成功，连接期间 WebSocket 收到 118 条增量日志与 starting→running 状态事件。修复 Fastify WebSocket 路由注册顺序后，真实握手收到 hello/snapshot；新管理器进程中的首次快照正确返回 stopped。真实浏览器只读测试 1/1 通过，桌面、768×1024、360×800 Console 无页面横向溢出；日志正文在 Review 截图中已隐藏。RCON 密码未出现在 Servers、Overview、Logs REST 响应中。

Astra Review 已指出并修复：嵌套保留命令旁路、RuntimeError 安全错误契约、WebSocket 快照序列竞态、操作记录超限拒绝截断、历史 stopped 状态覆盖新 unknown 探测、生命周期 2xx 契约错误、启动时 child-exit/probe 竞态、RCON 超时后旧 socket 回调影响重连。start 已运行 / stop 已停止的无副作用 operation 也按 API 设计对齐并有测试。最终复核还发现异常退出后 `crashed` 永久跳过状态探测，造成手动重启被一直禁用；现已修复为无受管进程时重新探测：确认 stopped 后允许用户手动 start，外部 running 与 unknown 均拒绝，`recoveryRequired` 门控不被清除。真实 Runtime + Adapter + Service 联合测试覆盖上述路径。Astra 复审修复和关键测试后明确签核 Phase 2，无剩余阻塞；桌面/平板/手机 Console 截图确认可读。

无副作用 stop 还通过真实 HTTP 验证：当实例为 stopped/none 且 UI readiness.stop=false（already-stopped）时，POST stop 返回 202，操作最终为 succeeded/completed，服务器没有被再次启动或停止。

Phase 1 浏览器回归在 Phase 2 修改后以 11/11、退出码 0 通过。原 Playwright 自动启动命令嵌套 npm/concurrently 时，11 个场景结束后 runner 无法自行退出；改为分别直接启动 API 与 Vite，并构建共享契约后，完整命令以退出码 0 结束，测试服务退出后 3000/8080 端口已释放。

最终崩溃重试修复后，完整 `npm.cmd run check` 再次以退出码 0 通过（contracts 3、API 109、Web 29）。Phase 1 浏览器 E2E 在本轮以 11/11 再次通过；此前真实 Vanilla 26.3 生命周期、RCON、WebSocket 与 Console 浏览器验收结果仍有效。本阶段没有对用户的真实服务器故意制造崩溃，崩溃路径使用合成进程与真实服务层联合回归。阶段状态：**已通过**。
