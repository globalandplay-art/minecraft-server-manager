# Minecraft Java Server Manager — UI / UX 规范

状态：设计 v1；Phase 1 深色 Dashboard 与只读 Servers 已在 `apps/web` 实现并通过三档浏览器验收及 GPT-6 Astra UI Review。后续页面仍为阶段合同；所有 Phase 1 服务器和数值均属于 Mock fixture。与 [ARCHITECTURE.md](./ARCHITECTURE.md)、[API_SPEC.md](./API_SPEC.md) 同步。

## 1. 信息架构

主导航依次为 Dashboard、Servers、Players、Worlds、Mods / Plugins、Console、Performance、Backups、Crash Analysis、Settings。Worlds 是一级入口，不隐藏在 Settings。菜单名称保留英文，第一版说明、状态与错误使用中文。

| 导航 | 路由 | 首次实现 | Phase 1 呈现 |
| --- | --- | --- | --- |
| Dashboard | /dashboard | 1 | 完整 Mock 页面 |
| Servers | /servers | 1 只读；2 生命周期 | Mock 列表、切换实例、只读摘要 |
| Players | /players | 4 | Phase 4 解释页 |
| Worlds | /worlds | 3 | Phase 3 首版只读 Vanilla 世界盘点；写操作仍关闭 |
| Mods / Plugins | /addons | 5 | 阶段占位；只显示支持的子类型 |
| Console | /console | 2 | Phase 2 解释页，无日志流或输入框 |
| Performance | /performance | 6 | Phase 6 解释页 |
| Backups | /backups | 3 | Phase 3 手动 world-set 备份与列表；下载 / 恢复仍关闭 |
| Crash Analysis | /crashes | 6 | Phase 6 解释页 |
| Settings | /settings | 4；7 远程 | 只读模式 / 本地连接说明；配置编辑未启用 |

应用级页面使用 `?server=<serverId>` 表示选中实例；选中后导航保留 query，刷新和直接链接仍有效。只读 Servers 卡片“查看 Dashboard”传递相同 serverId。无 query 默认选择列表首个实例；失效 ID 显示“实例不存在 / 已移除”和重新选择，不悄悄切换到另一个实例。列表为空时显示引导，不呈现正常运行示例。

`features`、`capabilities`、`readiness` 全部来自后端。Sidebar 阶段标签来自 health.features，不在 React 根据当前版本猜阶段。引擎不支持的 Mods / Plugins 子类型隐藏；两种都不支持时 /addons 解释“不支持 Mods / Plugins”，侧栏保留清晰的不可用状态以避免导航跳动。Direct route 也校验 capability。Mock Paper 可以有 plugins=true，但 Phase 5 未实现，不能上传。

Settings 是复合应用页，不另设 settings feature：本地模式 / 连接说明始终只读可见；Properties 区域使用 features.properties（Phase 4）与 capabilities.properties / readiness.propertiesChanges；Remote Access 区域使用 features.remoteAccess（Phase 7）。Phase 1 Sidebar 的 Settings 显示“只读”，区域内分别显示后端 feature 提供的阶段标签，不能把 Phase 7 标签错误地禁用整个 Settings 页。

## 2. Dashboard 视觉方案

视觉方向：偏石墨色的服务器管理面板，以清晰信息层级、少量蓝色操作强调和等宽数字建立专业感。不使用像素字体、Minecraft 截图作背景、玻璃效果或大面积渐变。

桌面布局：左侧 224px Sidebar；顶部 64px Header；内容最大宽度 1440px，居中；页面边距 28px，模块间距 20px。

```text
┌────────────────────┬─────────────────────────────────────────────────────────┐
│ MC Server Manager  │ 实例选择: Survival · 示例    本地模式    API: 已连接     │
│                    ├─────────────────────────────────────────────────────────┤
│ Dashboard          │ MOCK DATA · Phase 1 示例，未连接真实 Minecraft           │
│ Servers            │ Dashboard                          最近更新：刚刚       │
│ Players     P4     │ Survival · 示例   Paper 1.21.1   运行中 [Mock]           │
│ Worlds      P3     │ Java 21 · 示例       [启动] [停止] [重启] 全部禁用       │
│ Mods / Plugins P5  │                                                         │
│ Console     P2     │ [Status 运行中] [Players 4/20] [TPS N/A] [MSPT N/A]       │
│ Performance P6     │ [CPU 12% Mock] [RAM 1.8 GiB] [Disk 卷已用] [Uptime 2h]    │
│ Backups     P3     │                                                         │
│ Crash Analysis P6  │ [服务器概览 2/3 宽]                [最近活动 1/3 宽]     │
│                    │ 引擎 / 版本 / 能力 / 数据来源      示例事件，最多 5 条   │
│ Settings           │ Console / Worlds / Backups 阶段入口与简短可用性说明     │
└────────────────────┴─────────────────────────────────────────────────────────┘
```

固定八项指标；顺序为 Server Status、Players、TPS、MSPT、CPU、RAM、Disk、Uptime。宽屏 4 列 × 2 行，每张卡片 128–152px 高；卡片标题 12–13px，主要数值 28px，单位与来源 12px。不用环形仪表盘替代精确数值。Phase 1 没有假的 24 小时趋势图；Phase 6 采集历史后再加入趋势。

- Status：状态点 + 文本，不仅靠颜色；unknown / crashed 各有说明。
- Players：online / max；名单未获取不能从数量虚构头像或玩家。
- TPS / MSPT：取不到显示 N/A，卡片底部“未采集 / 当前服务端未提供”。
- CPU：标注“MC 进程 · 按整机逻辑核心容量归一化”；Phase 1 示例明确标 Mock。
- RAM：显示进程 RSS，不能写成 JVM heap 已用 / 最大；没有 heap 数据就不画比例。
- Disk：显示所在卷 used / total，下方注明“服务端目录所在卷”；不能标成“世界占用”。
- Uptime：将秒数格式化为时 / 分，未知为 N/A，停服不假装保持运行时长。

左下“服务器概览”给 type、MC / Java 版本、支持 Mods / Plugins、Command transport 和告警。服务端目录路径不在 DTO 内，Phase 1 不展示。右下“最近活动”只展示后端活动数据；Phase 1 每条包含示例来源，不在用户点击未实现按钮时新增成功事件。

## 3. Tokens 与组件

| Token | 值 / 用法 |
| --- | --- |
| background | #0B1018 页面 |
| sidebar | #0E1520 导航 |
| surface | #151E2C 卡片 |
| surfaceRaised | #1B2738 菜单 / hover |
| border | #2B3A50 非文字分隔线 |
| textPrimary | #E8EEF7 主文本 |
| textSecondary | #A9B8CD 次级文本 |
| accent | #83ADFF 链接 / focus |
| buttonPrimary | #244FAA 背景，白色文字，hover #1D428F |
| success / warning / danger | #65D6A0 / #F7C96E / #FF9292，搭配状态文本 |
| radius | 卡片 12px、按钮 8px |
| spacing | 4 / 8 / 12 / 16 / 20 / 24 / 32px |
| font | 系统 sans，中文 Microsoft YaHei / PingFang SC；日志和数值 monospace |

文字正文 14px、行高 1.5；标题 24px、次标题 18px。金额式 / 指标式数字用 tabular-nums。重操作按钮至少 44px 点击高，桌面一般按钮不小于 40px。白字只用于深蓝实心按钮，不放在浅色 accent 背景。Phase 1 实际实现后检查文字对比度、focus 和弱文本，设计色值本身不等于已通过可访问性验收。

基础组件包括 AppShell、Sidebar、ServerSwitcher、MetricCard、StatusBadge、ConnectionBanner、CapabilityBadge、ActivityList、EmptyState、ErrorState、PhaseNotice、ConfirmDialog。所有按钮有明确 accessible name，图标带文字或 label；Modal focus trap、Escape、关闭后回到触发控件。

## 4. 响应式设计

| 宽度 | 布局 |
| --- | --- |
| ≥1200px | 224px Sidebar；4 列指标；概览 / 活动为 2:1 |
| 768–1199px | 可收起导航 drawer；2 列指标；概览与活动上下排列 |
| 360–767px | Header 菜单按钮 + 实例名称；drawer 导航；2 列紧凑指标；其余单列 |
| <360px | 支持降为 1 列，不承诺复杂表格体验；页面仍不可横向溢出 |

手机页面左右 16px，指标间距 12px、主要数字 24px。Header 的 mode / 连接状态移到标题下方，长服务器名截断但提供可读完整名称。生命周期操作换行或放入有文字的操作区，不能堆叠 tiny icon。Drawer 打开时锁背景滚动、Esc 关闭，点击路由后自动关闭；不在手机隐藏 Worlds / Backups。

未来表格在手机显示信息卡，文件名可换行；Console 允许内部横向滚动查看单行，页面主体不横滚。使用 prefers-reduced-motion，仅 120–160ms 的 hover / drawer 过渡，不做指标数字翻滚或循环动画。

第一阶段因服务器仅监听本地回环，手机布局用 Playwright / 浏览器模拟检查；能适配手机并不意味着现在可从手机连接电脑。

## 5. 数据状态、错误与刷新

| 情况 | 显示与行为 |
| --- | --- |
| 首次加载 | 卡片 skeleton + loading label；避免显示 0 作为占位 |
| mode=mock | 页面顶部持续可见 MOCK DATA banner，状态附近也标 Mock |
| metric available | 数值、单位、来源、更新时间；mock 数值标示例 |
| metric unavailable | N/A + 人类可读原因；不画归零曲线 |
| metric stale | 保留最后数值，黄色“旧数据”与采样时间，不能作为实时判断 |
| API 请求失败 | 显示 API 断开 / 网络错误，保留缓存并标连接异常；提供重试 |
| 超过 15 秒未成功读取 | 全体旧快照标过期；Status 改为未知并显示上次状态 |
| 合约校验错误 | 显示“后端响应格式异常”，不拼接假成功数据；记录安全 requestId |
| 零服务器 | 空状态 + 本地配置接入说明；Phase 1 不提供未实现注册功能 |
| 无 capability | 解释不支持与来源，不用点按钮后才报错 |
| feature 未实现 | PhaseNotice + 阶段标签；操作禁用，点击入口可了解功能范围 |
| readiness=false | 操作区显示可读原因，例如服务器已运行 / 未接受 EULA / 恢复未完成 |
| 没有玩家 / 活动 | 真空态；只有来源可用才写“暂无在线玩家” |

单一全局 ConnectionBanner 区分“管理器 API 无法连接”与“Minecraft 未运行”。不能因前端断线而把服务器显示为 stopped。错误页面提供 Retry / 返回 Servers，不显示 stack、密码或绝对路径。

health / overview / servers 的刷新周期按 API_SPEC；刷新期间不重置整页，也不产生每 5 秒弹一次的 toast。可手动刷新；连接状态变化用 aria-live=polite，整段日志流不不断朗读。初次 health 失败仍显示应用壳与错误，不挂起导航。

## 6. 关键交互（按对应阶段实现）

**生命周期：** Phase 1 按钮均 disabled，附近固定写“Phase 2 接入本地服务器后启用”，不可只依靠 tooltip。Phase 2 Start 展示启动前置条件；Stop / Restart 显示断开在线玩家、保存与预计等待影响。提交后显示真实 operation step，禁用冲突操作，失败显示诊断与重试条件，不盲目重复发命令。

**Console：** Phase 2 顶部有连接状态、搜索、日志级别和自动滚动开关；正文等宽纯文本，错误高亮但保留完整上下文。滚动离开底部自动暂停滚动并出现“新日志 N 条 / 返回底部”；数据继续接收且缓冲有上限。断线重连 gap 给出“部分日志无法补发”，不能假称连续完整。命令输入不回显秘密，明确标 transport；stdin 提交只提示“已发送”，RCON 输出才提示执行结果。

**Mods / Plugins：** Phase 5 按 capability 选择相应视图；显示 name、version、filename、state、loader、MC 兼容性和待重启状态。拖拽与点击上传用同一输入流程；错误说明大小 / 扩展名 / 不兼容。Disabled / Trash 可见并可 Restore；Delete 文案为“移入回收站”，确认说明恢复路径。运行中默认要求先停服，不能热替换文件。

完成上传后固定显示“上传完成，需要重启服务器才能生效”，提供 [稍后重启] [立即重启]。立即重启触发独立确认；已停止实例显示“下次启动生效”与 [启动服务器]。兼容性 unknown 显示“无法确认”，不能用绿色对勾当保证。

**Worlds：** Phase 3 当前世界居首，主世界与关联维度一起显示。Seed 可以复制，长整数原样展示字符串；设置列说明来自存档或 server.properties。新建 / 上传 / 归档 / 下载当前世界前解释需停服和快照。导入 ZIP 给出容量限制、版本检查、旧世界归档与执行步骤；不能用文件上传成功代表切换完成。

**Restore：** 显示目标日期、scope、版本、大小和当前世界名；用户输入世界名确认覆盖。Phase 3 明确标“仅恢复世界”，来源为 server-snapshot 时也不恢复 JAR / Addons / 配置。明确列出“停服 → 备份当前世界 → 恢复 → 启动 → 检查日志”。每步对应后端 Operation；无法衡量进度就显示 step，不画虚假百分比。失败保留当前状态、pre-restore 快照与 [回滚]，不自动跳回正常 Dashboard。恢复成功后提供查看日志；不能只凭 HTTP 202 toast 宣告成功。

**Backups：** Phase 3 列表展示 Manual / Auto / Snapshot、label、时间、size、pinned 和恢复入口。计划备份默认关闭，timezone 可见，运行中策略为跳过或明确允许停服。Retention 页解释最近份数 / 天数并集保留和 pinned 例外；回收站与备份保留策略是两种机制，不能自动清掉 Addons Trash。

**Properties：** Phase 4 分组显示 Gameplay / Players / Distances / MOTD。保存前显示变更 diff、验证错误和“已备份原配置 / 需要重启”的结果；保存与重启是两个操作。revision 冲突保留用户输入，展示刷新比对入口。Online Mode 变更说明身份校验影响；绝不展示 RCON password 输入回显。

## 7. Phase 1 验收与高级 UI Review

Phase 1 必须交付可运行 Mock Dashboard + 只读 Servers，并真实调用 Fastify；不是静态截图。其余功能仅有清晰阶段说明。

- 360×800、768×1024、1440×900 下，导航、8 指标、实例选择和错误状态无页面溢出，44px 触控目标适用。
- Tab 能遍历导航与实例选择；drawer / dialog focus 正确；焦点可见；文字与背景对比度检查通过。
- Mock 模式持续可见；TPS / MSPT N/A；RAM / Disk 口径准确；没有真实控制、假成功 toast 或无来源活动。
- API 中断、空列表、未知 ID、schema 错误、Unavailable / stale 都能恢复或给出明确解释。
- 输入 query 切换实例不混入旧请求数据；刷新与路由保留选中实例；Server 卡片导航到正确 Dashboard。
- GPT-6 Astra 做实际浏览器 UI Review，确认密度、可读性、手机导航和状态语义；只修有明确价值的问题。

设计 Review 已将“Mock 能力误当已实现”“旧状态当实时”“Disk / RAM 口径混淆”“手机访问与手机布局混淆”列为必验项。当前仅完成设计，不声称上述浏览器验收已通过。
