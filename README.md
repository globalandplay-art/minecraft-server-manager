# Minecraft Java Server Manager

一个本地优先的 Minecraft Java 服务端管理界面。默认的 Mock 模式保留受控示例数据；本机 Vanilla 模式支持启动、停止、重启、Console 日志、RCON 命令，以及已完成验收的 Worlds / Backups 基础流程。自动化测试、真实 Vanilla 生命周期和浏览器 WebSocket 联调均已通过。下面的“使用指南”适合快速开始；详细约束见 [本地使用指南](./docs/USER_GUIDE.md)。

## 环境要求

- Windows PowerShell
- Node.js 22.23.1（当前验证环境）
- npm（请在 PowerShell 中使用 `npm.cmd`）
- 本机安装的 Google Chrome（E2E 测试使用其 headless channel）

运行与测试均为本地操作；服务端默认只监听 `127.0.0.1`，不会自动开放到局域网或公网。

## 安装与启动

```powershell
npm.cmd install --legacy-peer-deps
npm.cmd run dev
```

当前使用 npm 10 时，普通 peer resolver 会在 Vitest 4.1.11 的 optional browser peer 上触发 npm 内部 `edgesOut` 崩溃，因此干净安装固定使用 `--legacy-peer-deps`。仓库仍由 `package-lock.json` 锁定完整版本；安装完成后应以 `npm.cmd ls` 和 `npm.cmd audit` 检查依赖树。

默认启动的是 Mock 模式。开发入口是 <http://127.0.0.1:3000>（也可使用 <http://localhost:3000>）；Vite 在该地址提供前端，并将同源 `/api/v1` 和 `/ws` 请求代理到 Fastify。API 基址是 <http://127.0.0.1:8080/api/v1>（或 <http://localhost:8080/api/v1>），健康检查可直接访问 <http://127.0.0.1:8080/api/v1/health>。Fastify 只监听 `127.0.0.1:8080`，WebSocket 使用同一个后端端口，不另开监听端口。两个开发服务都使用固定端口，端口被占用时不会自动切换。

`localhost` 在部分 Windows 环境会解析到 IPv6，因此开发时优先使用上面的 `127.0.0.1` 地址。服务只监听本机回环地址；响应式手机布局用于浏览器模拟测试，并不表示物理手机可以从局域网访问。

## 使用指南

### 快速体验 Mock 模式

Mock 模式不启动真实 Minecraft，也不会修改服务端文件，适合先查看 Dashboard、Servers、Console 占位和响应式布局：

```powershell
npm.cmd install --legacy-peer-deps
npm.cmd run dev
```

然后打开 <http://127.0.0.1:3000>。页面显示 `MOCK DATA` 时，数据来自受控 fixture；它不代表真实 Java 进程状态。

### 连接本机 Vanilla 服务端

1. 确认服务端已经自行接受 EULA，并且当前处于停止状态。管理器不会替你接受 EULA、下载 Java 或下载 JAR。
2. 在项目根目录创建 `.manager\config.json`，填写服务端目录、Java 25 的 `java.exe` 和 JAR 文件名。`root` 与 `javaExecutable` 必须是绝对路径，`jarFile` 只能是服务端目录内的文件名。
3. 先运行准备预览：

   ```powershell
   npm.cmd run prepare:local-test -- --server-id vanilla-local
   ```

4. 确认预览无误后再应用本机设置：

   ```powershell
   npm.cmd run prepare:local-test -- --server-id vanilla-local --apply
   ```

   该操作会备份原始 `server.properties`，再设置 `server-ip=127.0.0.1`、RCON 开关、RCON 端口和随机密码。RCON 密码不会显示在终端或返回到前端。

5. 在当前 PowerShell 会话启动本机模式：

   ```powershell
   $env:MCSM_MODE = "local"
   npm.cmd run dev
   ```

6. 打开 <http://127.0.0.1:3000>，在 Dashboard 或 Servers 中选择实例。后端健康检查地址是 <http://127.0.0.1:8080/api/v1/health>。

### 日常操作

- 使用“启动”“停止”“重启”按钮管理生命周期；停止会等待 Minecraft 优雅保存并退出。
- 在 Console 查看实时日志并发送普通 Minecraft 命令。`stop`、`restart` 等生命周期命令必须使用专用按钮。
- 管理器只控制自己启动的 Java 进程；外部窗口启动的进程不会被接管或强制停止。
- Worlds / Backups 的写操作会要求确认世界、版本或 revision，并在需要时明确授权停服。恢复失败时会保留保护备份并进入恢复门控，不会自动重试或静默回滚。
- P3.3 的世界导入只接受受限 Vanilla world-set ZIP；归档、计划备份和保留策略仍按项目进度逐步开放。

### 停止与故障处理

先在页面中停止 Minecraft，确认状态为已停止，再回到运行开发服务的 PowerShell 按 `Ctrl+C`。如果页面显示“需要恢复检查”，先保留 `.manager` 和服务端目录中的现场，不要删除 journal、guard、staging 或备份，也不要反复点击启动；应根据页面操作状态和 [实施进度](./docs/PROGRESS.md) 进行人工恢复。

`.manager/`、`runtime/`、服务端目录、世界存档、备份、日志和凭据均属于运行时数据，已被 Git 忽略，不能提交到仓库。

## Phase 2 本机 Vanilla 模式

本机模式读取仓库根目录下的私有文件 `.manager/config.json`。该目录已被 Git 忽略；不要提交其中的本机路径、操作记录、备份或 RCON 凭据。配置缺失时，API 会正常启动并返回空的服务端列表。配置使用严格结构，未知字段会被拒绝：

```json
{
  "schemaVersion": 1,
  "servers": [
    {
      "id": "vanilla-local",
      "name": "Vanilla 26.3",
      "root": "C:\\path\\to\\server",
      "javaExecutable": "C:\\path\\to\\java.exe",
      "jarFile": "server.jar",
      "jvmArgs": ["-Xms2G", "-Xmx2G"],
      "serverArgs": ["nogui"]
    }
  ]
}
```

`root` 和 `javaExecutable` 必须是本机绝对路径；`jarFile` 只能是 `root` 内的单个文件名。启动参数必须写成数组，不能写成 shell 命令字符串。也可将 `MCSM_MANAGER_ROOT` 设为另一个本机绝对目录，让管理器从该目录读取 `config.json` 并保存自己的私有数据。

先确保 Minecraft 服务端已可靠停止，并自行阅读、接受 Mojang EULA。准备工具不会接受 EULA，也不会下载 Java 或服务端 JAR。先执行 dry-run，检查它计划修改的字段：

```powershell
npm.cmd run prepare:local-test -- --server-id vanilla-local
```

确认预览无误后，可显式应用测试设置：

```powershell
npm.cmd run prepare:local-test -- --server-id vanilla-local --apply
```

`--apply` 会先把原始 `server.properties` 备份到 `.manager/setup-backups/<server-id>/`，然后只设置 `server-ip=127.0.0.1`、`enable-rcon=true`、`rcon.port` 和随机生成的 `rcon.password`。密码不会输出到终端。该步骤会真实改写服务端文件，请保留备份，并在测试结束后按自己的运行要求恢复配置。

在当前 PowerShell 会话中选择本机模式并启动开发环境：

```powershell
$env:MCSM_MODE = "local"
npm.cmd run dev
```

浏览器仍访问 <http://127.0.0.1:3000>；前端通过同源 API 和 WebSocket 与本机后端通信。管理器只会停止自己在当前进程中启动的 Java 子进程；它不会接管或停止外部启动的 Minecraft 进程。管理器异常重启后，未完成的操作会标记为中断并要求恢复确认，不会自动重放。

当前本机模式只覆盖 Vanilla 生命周期、受限命令和 Console。Worlds、Backups、Players、Properties、Addons、Performance、Crash Analysis、Remote Access、文件上传和任意路径访问仍未实现。Console 命令有长度、控制字符和保留命令限制；生命周期操作应使用页面中的专用按钮。

## 检查与构建

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run test:e2e
```

`check` 运行仓库的静态检查和单元测试，`build` 构建各 workspace，`test:e2e` 先构建共享契约，再分别启动本地 3000 + 8080 开发服务运行 Mock Playwright 场景，并在结束时关闭测试启动的服务。E2E 产物和 UI Review 截图写入 `test-results/`。

真实本地实例的只读浏览器联调需预先启动本机模式的 API 和前端，并显式指定实例 ID：

```powershell
$env:MCSM_REAL_SERVER_ID = "vanilla-local"
npx.cmd playwright test tests/e2e/phase2-real.spec.ts
Remove-Item Env:MCSM_REAL_SERVER_ID
```

该场景检查 Dashboard、Console WebSocket 与桌面/平板/手机布局，不发送 Minecraft 命令或生命周期操作；截图会隐藏日志正文。

## Mock 数据语义

页面持续显示 `MOCK DATA`，表示浏览器确实调用了 Fastify API，但 Fastify 返回的是受控 fixture，而非真实 Minecraft 进程数据。CPU、RAM、Disk 和 Uptime 等可用示例会标明 Mock 来源；无法采集的 TPS / MSPT 显示 `N/A` 及原因。`N/A` 表示没有可信值，不等于零。

RAM 的口径是 Minecraft 进程 RSS；Disk 是服务端目录所在卷的已用 / 总空间。Mock 模式中这些值仍是示例，启动、停止、重启和 Console 不执行真实操作。Worlds、Backups、Players、Properties、Addons、Performance、Crash Analysis 和 Remote Access 仍只展示阶段说明或禁用原因。

Phase 1 的范围仅包括：

- Dashboard 的八项指标与最近活动；
- 多个 Mock 实例的选择、刷新和 URL `?server=<id>` 持久化；
- 只读 Servers 列表与详情入口；
- 未知实例、空列表、API 断线、响应格式异常和旧数据状态；
- 后续功能的阶段占位说明。

真实 Java 进程管理由 Phase 2 本机模式提供；备份 / 世界、配置、Addons、性能采集与远程访问分别留在后续阶段。正常启动不会下载 Java 或服务端 JAR、接受 EULA 或改写既有服务端配置；只有显式执行上述 `prepare:local-test --apply` 才会按说明备份并修改 `server.properties`。
