# 本地使用指南

本文对应本机 Vanilla 生命周期、RCON / Console，以及已通过切片验收的 Phase 3 Worlds / Backups：备份、受限导出、恢复与显式回滚、新建、导入、归档、每日计划及安全保留。整体阶段签核见 [Phase 3 Final Gate](./PHASE3_FINAL_GATE_2026-10-04.md)。Properties 编辑、Players、Mods / Plugins 和远程访问仍在后续阶段。

## 1. 安装依赖

在 PowerShell 中进入项目目录：

```powershell
cd "C:\Users\29104\Documents\Codex\2026-09-27\codex-work-gpt-6-astra-ui-2"
npm.cmd install --legacy-peer-deps
```

要求：Node.js 22 或更高版本，以及已安装并能运行的 Java 25。管理器不会替你下载 Java、Minecraft JAR 或接受 EULA。

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

归档后无活动世界，Start 会被拒绝；当前没有归档重新激活入口。备份计划和保留策略默认关闭，开启前核对其停服许可与删除范围。已导出并带有 ZIP/cache 文件的备份会被保留为需检查，不在当前自动删除布局范围内；不要手工删除这些文件以绕过保留门控。Properties 编辑、Mods / Plugins 上传、远程访问和任意 Shell 命令仍未提供。不要通过文件管理器移动或覆盖世界目录来代替页面中的事务流程。

如果服务端启动失败，先查看 Console 和 `server.properties` 备份；不要反复点击启动。状态为“需要恢复检查”时，管理器会锁住可能造成进一步文件或进程风险的操作。
