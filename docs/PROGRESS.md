# 实施进度

更新时间：2026-09-28

## 授权与推进方式

用户已授权按阶段实施、测试和 Review，并在每个阶段通过后自动连续推进，无需在每个 Phase 结束时重复请求确认。每个阶段仍必须完成与风险相称的测试和 Review，真实记录结果；失败、限制或需要扩大既定范围的决策应明确报告。Phase 1 与 Phase 2 已完成测试及 GPT-6 Astra 阶段 Review；下一阶段为 Phase 3 Worlds / Backups。

之前用于续接工作的 heartbeat automation `minecraft-manager` 已按用户要求关闭。本线程由当前任务继续执行，不依赖后台定时任务。

普通实现与测试由 GPT-5.6 Sol 执行；阶段 Review 由主任务显式调用真实 GPT-6 Astra 子任务。当前主任务自身的模型设置不作为 Astra Review 署名或通过证据。

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
