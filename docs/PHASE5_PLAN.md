# Phase 5 — Adapter / Mods / Plugins

## 最新检查点 — 2026-10-08

P5.5 真实隔离 Paper/Fabric 验收及独立 Sol High 证据 Review PASS（P1=0/P2=0/P3=0）。Paper run `p55-paper-bf6c7480-b3c8-481f-937e-d446086a9266`；Fabric run `p55-fabric-2fe6b07e-dce6-46ec-9e1d-ba19f0db9232`。双方各 7 次显式启动、8 次扩展变更及重建后幂等回放通过，最终 stopped、来源未变化、用户原世界未访问。下文 NOT RUN/BLOCKED 是历史检查点；原证据保留。详见 [P5.5 问题账本](./P55_ISSUE_LEDGER_2026-10-07.md)。Phase 5 整体 Final Gate / 统一 Adapter 最终审查与新冻结回归尚未执行，Phase 5 保持 IN PROGRESS；等待用户明确授权，不进入 Phase 6。

2026-10-05用户明确授权Phase5并取消本轮额度Gate；Phase4 Final PASS事实保留。本轮不commit/push，不调用Astra；高级独立Gate按用户覆盖使用SolHigh。Phase5 IN PROGRESS，不冒充完成。

设计Review精确补充：trash manifest必须绑定删除前state/kind/filename/root/file身份，恢复到删除前state（disabled不能隐式启用）；多metadata的JAR仍只作为一个文件操作。上传限制按实际流式接收字节执行，并设置接收超时、并发/总staging配额与磁盘reserve；引用或身份不确定的partial不能按expiry自动删除。停止实例的“立即生效”使用用户明确start，而非仅适用于running的restart。既有额度阈值仅为历史规则，本轮用户覆盖取消。

## 当前代码与切片

现有MinecraftServerAdapter提供信息/能力/状态，LocalMinecraftServerAdapter组合受管生命周期、RCON、console；不重写已验证的process supervisor。detection-service负责服务端识别，bootstrap/local-config提供注册根目录与ValidatedLaunchPlan。共享事务保持单一主写入者。

- P5.0：Adapter与文件变更设计、安全边界、独立SolHigh设计Review。
- P5.1：识别证据与Addon只读inventory/metadata/能力contracts/API。Vanilla无Addon；Paper仅plugins；Fabric仅mods。先支持有明确证据的类型，未知/冲突不能靠目录名或jar文件名猜测后授权写入。Spigot/Purpur/Forge/NeoForge保留类型和metadata预留，不先开放未验证写流程。
- P5.2：有界JAR上传staging/验证/安装，绝不执行或动态加载上传JAR。保护备份在实际安装前完成。安装成功标restartRequired，用户明确选择稍后/立即重启，后者仍走现有显式lifecycle且受门控保护。
- P5.2 后端核心（2026-10-05）：P5.2a–e 已实现并经独立 Sol High delta Review、1040 项冻结完整回归及 lint/typecheck/build/diff 检查通过。安装要求已停止实例；此切片不实现立即重启 UI。JAR 验证、完整 Paper/Fabric 私有快照、staging、install journal 与启动 reconciliation 详见 [P5.2 收尾记录](./P52_INSTALL_TRANSACTION_2026-10-05.md)。真实 Paper/Fabric 启动验收、UI、Disable/Restore/Trash 仍待后续切片，不能把 Phase 5 标记完成。
- P5.3 Addon 生命周期核心（2026-10-06）：ENGINEERING PASS。Disable / Enable / Trash / Restore 已有本地受保护 API、opaque ID/revision/idempotency、pinned server-snapshot、durable lifecycle journal、操作中断 startup reconciliation 与独立 Trash 列表；没有永久删除、自动清理、自动启动或重启。Sol High 独立 delta Review 与 57 项专项测试 PASS；完整单 worker 回归 1098/1098、lint/typecheck/build/diff PASS。并行全套曾有 9 个原 5 秒事务测试超时，保留原始失败并在单 worker 无改 timeout 地完整通过。真实 Paper/Fabric 启动验收 NOT RUN；本状态不代表插件/模组已由 Minecraft 加载，也不代表 Phase 5 完成。见 [P5.3 生命周期记录](./P53_ADDON_LIFECYCLE_2026-10-06.md)。
- P5.4（2026-10-07）：UI FINAL GATE PASS。能力驱动列表、点击/拖拽上传、安装与 Disable/Enable/Trash/Restore 确认、operation跟踪及错误/unknown/recovery门控完成。22专项、三宽正负浏览器、新冻结1133全套与lint/typecheck/build/diff PASS，独立SolHigh P1=0/P2=0/P3=1。无可信操作ID/上传回执的unknown持续锁定为明确非阻塞限制；真实Paper/Fabric NOT RUN，Phase5仍IN PROGRESS。此前1122基线已失效，TS2367和v2回归超时历史保留，详见 [P5.4 Final Gate](./P54_FINAL_GATE_2026-10-07.md)。
- P5.5：真实隔离Paper/Fabric验收与统一Adapter最终独立SolHigh安全Review、新冻结完整回归。没有实际JAR/已接受EULA及匹配Java证据时真实Gate BLOCKED，不自行下载/接受EULA，不使用用户原世界。

2026-10-07 P5.5 续接：CLI 新冻结 1177 项基线已核验，启动前 harness 两项证据缺口已补齐，3/3 helper/wrapper 回归及独立 Sol High execution-safety delta PASS。当前真实验收仍 BLOCKED：PowerShell `Get-ChildItem Env:` 重复键异常、HRESULT -2147024809，发生在创建隔离目录前；无 Paper/Fabric 启动。普通宿主预检通过后再执行双方 7-start matrix 与最终真实证据 Review。P5.5 PASS 后停止等待用户授权 Phase 5 Final Gate；不进入 Phase 6。详见 [P5.5 问题账本](./P55_ISSUE_LEDGER_2026-10-07.md)。

每切片focused→check→diff→独立Review，通过后下一切片。产品能力仅对已接线且支持的后端开放，不能先宣告完整CRUD。

## Adapter边界

保留当前运行时接口，增加独立Addon provider组合：受可信识别证据约束，提供inventory和可用操作能力；文件服务根据注册serverId推导固定mods/plugins目录。Frontend不识别类型，不传路径、目标目录、shell或Java命令。Loader与能力不能等同于metadata声明。

领域Addon条目：opaque id、kind(mod/plugin)、状态(enabled/disabled/trashed)、filename、可空name/version/loader、声明的Minecraft版本约束、compatibility(unknown/declared-compatible/declared-incompatible)、metadata状态/原因、内容SHA256、opaque HMAC revision。不返回absolute path/秘密/完整文件。不把声明兼容等同于真实加载成功。相同metadata id不自动覆盖或升级；同名、大小写/NFC冲突拒绝。

API草案：GET /servers/:id/addons?kind=mod|plugin；独立上传资源POST /addons/uploads（原始有界application/java-archive内容，filename仅作严格basename验证，不拼接客户路径）；POST /addons/install引用uploadId；POST /addons/:addonId/disable|restore|trash。写请求必须If-Match+UUIDv4幂等键+local-ui/Origin，操作202仅accepted，最终operation成功才显示生效待重启。inventory与upload不是同一资源revision；安装需同时绑定目标inventory revision及上传身份/摘要。

## JAR与metadata

上传64MiB上限；ZIP目录条目最多10000，单metadata256KiB、总metadata1MiB，路径长度/压缩比/总展开512MiB/加密/多盘/重复与大小写NFC冲突/重叠数据等都受限制。不要extract全JAR，只读取允许metadata条目；必须校验ZIP结构、读取实际字节上限、CRC/大小，不信任声明。拒绝symlink特殊文件条目、ZipSlip/绝对路径/反斜杠/ADS/Windows保留名；JAR内容不执行。

读取fabric.mod.json、plugin.yml；预留META-INF/mods.toml与neoforge.mods.toml的保守解析。JSON/type与YAML/TOML不得解释代码、自定义tag或环境变量。过长/缺失/错误metadata明确unknown，未知loader禁止安装；对已安装未知JAR仅只读展示，不能据名称猜测适配。若需新解析依赖，先核对现有锁文件及官方维护文档，避免手写完整YAML/TOML或放宽安全检查。

## 写入、备份与恢复

只允许已停止、ownership none、无活动操作/恢复锁、已知活动世界的受支持实例；不自动stop/restart。写入在现有instance admission锁内重新验证root identity、识别证据、inventory revision、source/target父目录identity、file identity(nlink1/no symlink/junction)、摘要、staging引用。进入锁后的读取使用descriptor与canonical containment，不只先lstat后按路径读取。

固定目录mods/disabled-mods或plugins/disabled-plugins；trash使用服务端固定trash目录内opaque entry子目录与manifest，两个kind及同名历史不得覆盖。变更前创建并核验pinned私有server-snapshot保护备份（含明确addon根与私有配置，不开放下载），不能拿world-set备份冒充完整addon保护。需先验证现有BackupService支持布局；不支持则新backup profile经审查后才能写。保护失败禁止任何移动。

Journal扩展必须兼容Phase3/4：持久intent→same-volume受控rename→源/目标身份与摘要物理核验→持久完成。目标必须不存在，禁止overwrite；跨卷拒绝、不copy/delete降级。安装消耗上传资源的时点必须纳入journal，失败保留原/目标/guard/upload，旧收尾器不得清理引用。

每个checkpoint逐点throw+全新journal/OperationService/app重启测试。重启只在root/source/target/guard/staging/历史operation证据唯一且完全一致时收敛；其他recoveryRequired，禁止自动删除、回滚、再次安装或Java启动。重复幂等请求跨重启返回原operation，不能产生新备份/新journal。NO_ACTIVE_WORLD与旧properties/restore recovery锁继续有效。

## 验证与停止规则

必须覆盖ZIP炸弹/结构异常/metadata污染、文件链接/目录替换/根重新绑定、revision竞态/并发同名、重复幂等与断联、所有rename checkpoint与committed未确认、垃圾条目restore冲突、guard/upload引用与retention交互、秘密隔离、unknown/read-only能力、三宽UI与真实加载日志。真实插件/mod是否生效用实际加载证据，不把文件存在算成功。

同根因最多3次实质修复尝试，第3次仍失败直接在对话输出原错误码/日志/源码及每次尝试，停止该问题；安全不确定首次停止。额度Gate由用户本轮取消，不能将其作为停止理由。保留未提交改动和私有历史evidence，不自动上传。
