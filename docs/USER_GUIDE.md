# 本地使用指南

本文对应当前已验收的 Phase 2：本机 Vanilla 服务端的检测、启动、停止、重启、RCON 命令和实时 Console。Worlds、Backups、Properties、Players、Mods / Plugins 及远程访问仍在后续阶段开发中。

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

当前版本不提供 Worlds / Backups、世界恢复、Properties 编辑、Mods / Plugins 上传、远程访问或任意 Shell 命令。不要在当前版本通过文件管理器直接移动或覆盖真实世界目录来模拟这些功能；Phase 3 会提供带备份、校验和回滚的安全流程。

如果服务端启动失败，先查看 Console 和 `server.properties` 备份；不要反复点击启动。状态为“需要恢复检查”时，管理器会锁住可能造成进一步文件或进程风险的操作。
