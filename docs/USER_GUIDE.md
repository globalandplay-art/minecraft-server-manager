# 本地使用指南

## 添加多个本地服务端

进入 **Servers → 添加服务器实例**，填写唯一实例标识、显示名称、已有服务端的绝对目录和启动JAR文件名，选择复用一个现有实例的可信Java配置。点击“检查实例”，确认检测结果后勾选确认并保存。

保存只增加LT登记，显示“待重启Manager加载”，不会启动Minecraft、修改世界、开放端口或接受EULA。请先在LT正常停止受管服务器，再手动重启Manager；新实例加载后可通过Dashboard/实例选择器切换。若游戏端口重复，需要自行正确配置后再运行；登记不会自动改端口。Forge/NeoForge未支持的启动方式仍不可开服。

网页尚不提供第一份Java配置初始化；复用现有可信配置可以避免执行浏览器指定的任意程序。具体范围见 [M1](./M1_REGISTRATION_2026-10-21.md)。

本文对应本机 Vanilla 生命周期、RCON / Console、Worlds / Backups、Players / Properties、LT 本地白名单，以及 Paper/Fabric Addons。整体签核以 [PROGRESS](./PROGRESS.md) 最新检查点为准；远程访问开发已暂停，入口默认关闭。

## 本地登录

只有此前离线初始化已完成并明确启用 required 的本地管理器，才使用已有管理员账号登录；网页不会创建账号或自动启用认证。页面先检查认证状态，服务不可用时显示检查提示，不开放管理页面。未初始化的显式 legacy 本地模式仍按原方式使用，不应对外开放。

登录后“再次确认身份”可重新验证当前账号；“退出登录”立即隐藏本页面管理数据并断开日志连接。若网络异常，页面明确提示服务端退出未确认，可以手动重新检查会话。会话失效需重新登录，之前命令、上传及其他写操作不会自动重发；已由后端接收的操作应通过操作状态确认，不能根据退出页面推断其取消。

密码与会话CSRF不保存到浏览器持久存储。当前仅提供本地HTTP认证及日志WS接线，不提供真实Tailscale/Cloudflare远程入口，完整签核状态见PROGRESS。

## Performance / Crash Analysis

在导航选择 Performance 查看所选实例的会话快照。最多120条记录，最短5秒采样间隔，无请求时不采集或补点；页面隐藏时暂停轮询。Manager重启清空历史。CPU是受管Minecraft进程占全部逻辑CPU容量的百分比；RAM是驻留工作集，不是JVM堆。磁盘显示注册目录所在卷的已用、总量、可用字节，不是世界大小。停止后CPU/RAM不可用；首个CPU计数尚无差值时也不可用。来源或身份无法核验时显示N/A，TPS/MSPT当前保持N/A，不根据日志延迟估算。

Crash Analysis 只在点击“读取崩溃证据”后扫描，5秒内复用同一原始快照，不自动重试或修复。仅支持注册本地实例，Mock显示分析不可用。固定读取latest.log和最多三个标准崩溃报告，不接受用户路径或外部上传。只匹配内存分配、端口绑定、Java版本、watchdog和扩展依赖的固定签名；每项仅为“可能”，请核对完整异常后判断。

截断来源（超过64KiB）只报告覆盖信息，不输出finding或片段；证据不完整且无匹配时显示证据不足。无匹配不表示健康。显示的行号是脱敏片段内相对坐标，不是原文件行号。凭证和绝对路径在返回前脱敏，但不能保证发现任意未知非结构化秘密；勿把页面当作可公开分享完整日志的保证。读取失败会隐藏旧结果并显示错误，修正实例文件状态后可手动重试。不提供自动修复、进程终止或网络调整。

## 1. 安装依赖

在 PowerShell 中进入项目目录：

```powershell
cd "C:\Users\29104\Documents\Codex\2026-09-27\codex-work-gpt-6-astra-ui-2"
npm.cmd install --legacy-peer-deps
```

要求：Node.js 22 或更高版本，以及已安装并能运行的 Java 25。管理器不会替你下载 Java、Minecraft JAR 或接受 EULA。

## 本地配置页面

在 Settings 选择实例，页面按后端规则展示 `server.properties` 的安全字段。当前仅已确认 Vanilla 26.3 的六项字段可编辑；视距、模拟距离和其他未确认版本只读。缺失值不会自动填入默认值。

先在 Servers 明确停服，再查看变更并勾选保护备份确认。关闭正版验证还需要单独确认身份风险。点击“备份并保存配置”后，“已受理”只表示请求进入处理；等待页面确认“已保存”。管理器不会自动启动或重启，需在 Servers 明确操作。

版本冲突时保留真正修改的草稿，成功刷新后重新确认。结果不确定时不要重复提交新请求；当前页面可明确使用原请求核对结果。请求凭证不跨页面刷新或导航保存，请等待结果再离开；出现恢复锁时先核对操作记录，不重复保存。Phase 4 已通过隔离 Vanilla 真实配置生效及 Players 只读验收。

## LT 白名单管理

选择服务器后打开 Whitelist，点击读取或刷新已保存的成员清单。当前只支持已注册、已确认版本为 Vanilla 26.3 的实例；其他版本和 Paper/Fabric 暂不可用。

页面将 `server.properties` 中的 `white-list` / `enforce-whitelist` 保存值与成员文件分开显示。保存值不代表运行中服务器已经生效；清单中的 UUID 只是文件记录，不代表管理器已验证账号身份。缺失文件显示不可用，不会当作空清单；有效的空数组才显示零名成员。

页面可见时每 5 秒顺序读取名单和历史候选，隐藏时暂停；切换实例会取消旧实例读取。刷新失败保留旧快照并禁用修改。

本地 Vanilla 26.3 由 LT 管理且正在运行、当前 RCON 连接可信且可用、运行时名单与保存名单一致时，可以输入 3–16 位字母/数字/下划线玩家名添加，也可以从当前实例 `usercache.json` 的历史候选选择。缓存记录不保证账号当前有效，账号解析由 Minecraft 完成。候选不可读时仍可手动输入；不会自动批准或创建 UUID。

删除按钮会要求确认玩家名和目标服务器。添加、删除均只发送一次固定原生命令，然后检查响应、相关保存错误日志、进程运行状态及实际文件结果，不通过控制台任意命令或直接覆盖成员文件。响应丢失、日志不可观测或证据不一致时显示“结果未知”，不会自动重发；请手动刷新核实后再决定下一步。

RCON 不可用、实例停止、版本不支持或存在恢复/操作冲突时保留只读。不会自动开服、停止、重启或启用 RCON。已有管理员认证启用时沿用 Session/CSRF/近期身份确认；未配置账号的既有本地模式继续受 Host/Origin/本地操作意图校验。两项白名单配置开关及实时开关状态仍只读/未知。本轮不提供拒绝日志候选或申请队列。真实 Minecraft 验收尚未执行，详见 [LC2 本地 MVP](./LC2_LOCAL_MVP_2026-10-21.md)。

## Mods / Plugins

选择可信 Paper 或 Fabric 实例后打开 Mods / Plugins，页面根据后端能力展示插件或模组清单。名称、版本和 Loader 是 JAR 元数据声明，不保证兼容；不要将 Unknown 当作已验证兼容。

先在 Servers 明确停服，再点击或拖拽上传单个 `.jar`（最大 64 MiB）。上传成功仅表示私有暂存通过验证；确认安装并等待 operation 成功后，才表示文件已经安装。每次文件变更先建立完整私有 pinned 保护快照，成功提示需要重新启动；返回 Servers 后由用户明确启动。

Disable / Enable 在启用和禁用目录之间移动；Trash 是可恢复的软删除，恢复保持删除前的 enabled / disabled 状态。没有永久删除或自动清理 Trash。冲突、pending、unknown 或 recoveryRequired 时页面拒绝新变更；无可信回执的 unknown 需人工核验，不能凭刷新认定未提交。每实例最多保留三个上传暂存槽，consumed/failed 证据也占用配额；当前无自动清理，不手工删除引用中的证据来绕过门控。

## 2. 配置你的服务端

先查看实际的 JAR 文件名和 Java 路径：

```powershell
Get-ChildItem "C:\Users\29104\Desktop\Game\minecraft服务端\minecraft26.3" -Filter *.jar
Get-Command java
java -version
```

在项目根目录创建 `.manager\config.json`。`.manager` 是私有目录，不能提交到 Git。将下面两个占位符替换成实际值：

```json
{
  "schemaVersion": 1,
  "servers": [
    {
      "id": "vanilla-26-3",
      "name": "Vanilla 26.3",
      "root": "C:\\Users\\29104\\Desktop\\Game\\minecraft服务端\\minecraft26.3",
      "javaExecutable": "<Java 25 的 java.exe 绝对路径>",
      "jarFile": "<服务端 JAR 文件名>",
      "jvmArgs": ["-Xms2G", "-Xmx2G"],
      "serverArgs": ["nogui"]
    }
  ]
}
```

`root` 和 `javaExecutable` 必须是绝对路径；`jarFile` 只能填写服务端目录内的单个 `.jar` 文件名。服务端必须已接受 EULA，且应先处于停止状态。

## 3. 准备本地测试设置

先执行预览，不会修改服务端文件：

```powershell
npm.cmd run prepare:local-test -- --server-id vanilla-26-3
```

确认预览内容后再显式应用：

```powershell
npm.cmd run prepare:local-test -- --server-id vanilla-26-3 --apply
```

应用会先备份原始 `server.properties`，然后设置本机监听、RCON 开关、RCON 端口和随机密码。密码不会显示在终端，也不会返回给浏览器。

## 4. 启动管理器

在同一个 PowerShell 窗口执行：

```powershell
$env:MCSM_MODE = "local"
npm.cmd run dev
```

打开 <http://127.0.0.1:3000>。后端健康检查地址是 <http://127.0.0.1:8080/api/v1/health>。管理器只监听本机，不对局域网或公网开放。

## 5. 日常操作

在 Servers 或 Dashboard 选择 `Vanilla 26.3`：

- 点击“启动”启动由管理器创建的 Minecraft 进程。
- 点击“停止”执行优雅停服并等待保存完成。
- 点击“重启”先停服，再重新启动并检查启动日志。
- 打开 Console 查看实时日志；连接断开时页面会提示，不能把缺失日志当作连续完整日志。
- 命令输入用于 Minecraft 命令，优先走 RCON。`stop`、`restart` 等生命周期操作应使用页面专用按钮。

管理器只能控制它自己启动的 Java 进程。若 Minecraft 是在另一个窗口或其他工具中启动的，管理器会把它识别为外部进程，不会偷偷停止或接管。

## 6. 停止管理器

先在网页中停止 Minecraft，确认状态变为已停止，再回到运行 `npm.cmd run dev` 的 PowerShell 窗口按 `Ctrl+C`。

## 7. 重要限制

当前本机 Vanilla 版本提供 Worlds / Backups、受限 world-set 下载、恢复与显式回滚、新建世界、受限 ZIP 导入、完整世界归档、每日计划和安全保留策略。进入 Worlds / Backups 后按页面确认世界名称、revision 和停服/启动授权；失败时保留 guard、journal 与现场，按明确恢复入口处理。完整操作说明见 [README 使用指南](../README.md#使用指南)。

归档后无活动世界，Start 会被拒绝；当前没有归档重新激活入口。备份计划和保留策略默认关闭，开启前核对其停服许可与删除范围。已导出并带有 ZIP/cache 文件的备份会被保留为需检查，不在当前自动删除布局范围内；不要手工删除这些文件以绕过保留门控。远程访问和任意 Shell 命令仍未提供。不要通过文件管理器移动或覆盖世界目录来代替页面中的事务流程。

如果服务端启动失败，先查看 Console 和 `server.properties` 备份；不要反复点击启动。状态为“需要恢复检查”时，管理器会锁住可能造成进一步文件或进程风险的操作。
