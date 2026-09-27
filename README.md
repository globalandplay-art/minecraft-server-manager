# Minecraft Java Server Manager

一个本地优先的 Minecraft Java 服务端管理界面。Phase 1 提供可运行的 Mock Dashboard、只读 Servers 页面，以及由 Fastify 提供的真实 API；所有数据仍是后端 fixture，不会启动或修改 Minecraft 服务端。

## 环境要求

- Windows PowerShell
- Node.js 22.23.1（当前验证环境）
- npm（请在 PowerShell 中使用 `npm.cmd`）
- 本机安装的 Google Chrome（E2E 测试使用其 headless channel）

仓库当前没有配置 Git remote。运行与测试均为本地操作，不会创建远程仓库、推送分支或发布站点。

## 安装与启动

```powershell
npm.cmd install --legacy-peer-deps
npm.cmd run dev
```

当前使用 npm 10 时，普通 peer resolver 会在 Vitest 4.1.11 的 optional browser peer 上触发 npm 内部 `edgesOut` 崩溃，因此干净安装固定使用 `--legacy-peer-deps`。仓库仍由 `package-lock.json` 锁定完整版本；安装完成后应以 `npm.cmd ls` 和 `npm.cmd audit` 检查依赖树。

开发入口是 <http://127.0.0.1:3000>。Vite 在该地址提供前端并将同源 `/api/v1` 请求代理到 Fastify；Fastify 只监听 `http://127.0.0.1:8080`。两个服务都使用固定端口，端口被占用时不会自动切换。

`localhost` 在部分 Windows 环境会解析到 IPv6，因此开发时优先使用上面的 `127.0.0.1` 地址。服务只监听本机回环地址；响应式手机布局用于浏览器模拟测试，并不表示物理手机可以从局域网访问。

## 检查与构建

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd run test:e2e
```

`check` 运行仓库的静态检查和单元测试，`build` 构建各 workspace，`test:e2e` 启动真实的 3000 + 8080 开发闭环并运行 Playwright。E2E 产物和 UI Review 截图写入 `test-results/`。

## Phase 1 数据语义

页面持续显示 `MOCK DATA`，表示浏览器确实调用了 Fastify API，但 Fastify 返回的是受控 fixture，而非真实 Minecraft 进程数据。CPU、RAM、Disk 和 Uptime 等可用示例会标明 Mock 来源；无法采集的 TPS / MSPT 显示 `N/A` 及原因。`N/A` 表示没有可信值，不等于零。

RAM 的口径是 Minecraft 进程 RSS；Disk 是服务端目录所在卷的已用 / 总空间。Phase 1 中这些值仍是示例。启动、停止、重启、Console、Worlds、Backups、Players、Properties、Addons、Performance、Crash Analysis 和 Remote Access 不执行真实操作，只展示对应阶段说明或禁用原因。

Phase 1 的范围仅包括：

- Dashboard 的八项指标与最近活动；
- 多个 Mock 实例的选择、刷新和 URL `?server=<id>` 持久化；
- 只读 Servers 列表与详情入口；
- 未知实例、空列表、API 断线、响应格式异常和旧数据状态；
- 后续功能的阶段占位说明。

真实 Java 进程管理从 Phase 2 开始；备份 / 世界、配置、Addons、性能采集与远程访问分别留在后续阶段。当前版本不会下载 Java 或服务端 JAR，不会接受 EULA，也不会读写服务端目录。
