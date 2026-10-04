# P4.3 配置切换核心开发记录

## 范围与当前状态

本轮未接线后端核心工程检查及独立 CODE / TEST-SOURCE REVIEW PASS，不是 P4.3 整体 PASS。新增 PropertiesWriteService 和 committed 物理核验：停服/ownership/活动世界/revision 门控、私有 pinned guard、intent-before-mutation、同卷旧配置保留和配置安装、提交前后物理重验、未确认成功的重启核验。没有公共保存路由或 UI，没有启动 Java，没有访问用户原世界，没有 commit/push。

默认允许修改六项：max-players、difficulty、gamemode、pvp、online-mode、motd。距离字段因版本规则未确认保持只读；禁用 online-mode 必须显式确认。原始配置及密码只在私有 guard/旧配置槽内保留，journal 和公共 reader 返回不含这些字节。

现有 bootstrap 仍保守拒绝 properties journal；本轮新服务未在 app 注册。这是明确的下一集成任务，不能宣称生产重启恢复已经完成。没有自动回滚或恢复端点。

## 验证

- 四份专项：properties-write-core、properties-foundation、properties-reader、properties-patch，共 89 PASS，其中 10 项新核心测试。
- 新测试包含成功精确字节切换、四个中断 checkpoint 的保留、revision 冲突、提交后篡改拒绝、物理 committed 确认、状态查询期间篡改拒绝、真实 OperationService 的两次重启和中间合法离线编辑。
- 独立 Sol High 未接线后端核心 CODE / TEST-SOURCE REVIEW PASS；不替代集成、公共 API 或整体阶段签核。
- 第一次冻结完整 check 显示 contracts 6/API 823/Web 87，共 916 PASS，lint/typecheck/production build 完成，但外层 PowerShell exit 1，Web jsdom stderr 被记录为 `NativeCommandError: Not implemented: navigation to another Document`，该次不签完整 Gate PASS。保留 `test-results/p43-write-core-check.log`；随后以 cmd 原生重定向和显式 npm exit code 重跑同一冻结代码，结果如下，不引用此前 906 PASS。
- 最终冻结重跑 `VITEST_MAX_WORKERS=1 npm.cmd run check`：显式 `CHECK_EXIT=0`；contracts 6/API 823/Web 87，总计 **916 PASS**，lint/typecheck/production build PASS。日志 `test-results/p43-write-core-check-final.log`，原始 jsdom stderr 仍保留。首次外层 exit 1 不改写。最终 diff 检查在文档收口后执行。
- 仅临时隔离文件系统 fixture，不是 Vanilla/Java 真实验收；mock admission fixture 不验证持久请求 admission/idempotency，须另补真实 OperationService 请求链测试。

## 问题账本与历史失败

1. HIGH / RESOLVED：NTFS 配置同名替换可能继承此前名称的创建时间，原先将 prepared 与 installed 的完整 birthtime 身份直接比较会误拒绝。首次专项 exit 1，正常保存报 HTTP 409 `RECOVERY_REQUIRED`，最后 checkpoint 为 `properties-installed`。改为先验证 prepared 的 dev/ino 对象及 checksum，再持久化移动后的完整身份并在所有后续核验使用该身份。第一次实质修复后成功用例 PASS；没有放松文件对象或内容断言。
2. MEDIUM / RESOLVED：测试误读取 guard 下的 `server.properties`，实际文件为 `original.properties`。首次 6 项中 5 FAIL/1 PASS；四个中断测试报 `ENOENT`。修正路径后 5 PASS/1 FAIL，剩余是上述核心身份问题。两次失败保留为历史，未冒充首次通过。
3. HIGH / RESOLVED：prepare-intent 回调后需重新核验原配置与 workspace，before-commit 回调后需重新核验布局/目标/旧槽。开发自查修复，未有运行时错误码。
4. HIGH / RESOLVED：独立 Sol High 指出 committed 后、发布 succeeded 前若 callback 改变文件还会误报成功；现在完整重验，提交后修改测试拒绝 `RECOVERY_REQUIRED`，保持 committed journal 证据，不改终态或自动回滚。
5. HIGH / RESOLVED：未确认 committed 的状态查询 await 期间替换目标可能被错误确认。二次读取重新绑定安装身份/checksum，世界核验后再做完整物理核验；故障测试保持恢复锁。
6. HIGH / RESOLVED：既有 OperationService 重启确认成功会写 step=`committed`，只认 `completed` 将正常后续离线编辑误锁。接受严格 succeeded、error=null、kind/server/guard 匹配的两种 step；真实 OperationService 跨两次重启测试 PASS。
7. LOW / RESOLVED：PowerShell 对 native stderr 的包装返回 exit 1，原文 `NativeCommandError` / `Not implemented: navigation to another Document`；完整 suite 仍显示全部 PASS 并执行构建。第一次包装修复改用 cmd 原生重定向并显式捕获退出码，最终 `CHECK_EXIT=0`，未修改产品、测试断言或诊断输出。

所有问题没有第三次仍失败的修复链，没有启动第四次尝试。保护副本、journal、旧配置不自动删除。Windows directory fsync 和同用户文件系统竞态限制沿用既有设计，不声称具备完整断电耐久性或对恶意同用户进程的隔离。

## 精确下一步

1. 当前未接线核心完整回归和独立源码/测试审查已通过；后续集成必须建立自己的验证证据。
2. 将 bootstrap 对 committed 的物理校验和严格历史 outcome 判定接入注册加载；active/模糊/根目录变更继续 fail-closed，不能从 guard 生成默认配置。
3. 在 app 启动顺序中接入配置 reconcile，发生在 OperationService.initialize 前；覆盖真实 OperationService 持久 admission/idempotency 与加载链中断。
4. 定义并接入受保护的 GET/PATCH 合同及 UI、重启提示，最后进行 fresh isolated Vanilla 验收。
5. 全部必须 Gate 满足后才能标记 P4.3 / Phase 4 PASS。
