# P3.4 每日计划备份与安全保留策略

日期：2026-10-04。**P3.4 PASS**：实现、独立源码审查、最终冻结全套及三档 Browser Gate 通过；Phase 3 仍 IN PROGRESS，本轮不进入 P3.5 或 Phase 4。

## 每日计划

本地 Vanilla 实例在 Worlds / Backups 配置每日 HH:mm 与 IANA 时区，首次默认关闭（02:00 / Asia/Shanghai）。运行中默认跳过；只有保存明确的 allowStop 授权才复用既有优雅停服、完整 world-set 备份和原运行态重启流程。停止中的实例备份后保持停止，不接受前端传入文件路径或 auto kind。

计划持久化绑定注册根身份及 revision。每 15 秒检查当前本地分钟；错过不补跑。先持久化日期 claim，再提交实例串行操作。按规范化时区保存已消费日期高水位：DST 重复小时、重启、系统时间倒退及同日改时间均不重复；DST 不存在的时间不补跑。每实例保留最近 30 条公开运行记录、最多 64 个时区高水位；执行失败也消耗当天 claim。历史 pending 只核对操作终态，不自动重试。损坏或根身份不匹配的单实例计划保持拒绝，不阻断其他实例和管理器只读启动。

提交、admission 和执行前检查注册根身份、关闭门控及活动世界；none 状态不能计划备份。管理器关闭同时封闭调度与保留入口，并等待已提交操作终态。

## 保留策略

首次默认关闭；默认最近 10 份或最近 7 天，两者满足任一即保留。只有 unpinned、complete、manual/auto 的 world-set 才可能成为候选。snapshot、pinned guard、失败现场、legacy 无 owner、事务或恢复引用、未来日期、身份或文件结构不确定均保留。

启用后，仅成功的新普通备份触发本实例检查；无启动清理、无后台清理定时器。另有明确手动运行按钮。清理要求停止态且 ownership=none，不自行停服；运行中或 recovery 状态返回 blocked。页面会明确提示永久删除风险，并区分 completed / blocked / partial，200 响应不能被当作所有数据已删除。

新备份写私有 owner.json，绑定 serverId、注册 root、备份目录身份及创建时间；不进入导出 payload 或前端 DTO。清理使用共享 instance lease，核对自己的 committed journal / succeeded operation、所有其他 journal 和恢复引用，再验证完整 manifest/hash、目录身份和有界清单。只接受 manifest.json、owner.json、payload 的受控布局；拒绝链接、多链接文件、额外未知内容。

删除前在备份目录外持久化 deleting receipt，然后再次核验引用和身份；按已验证清单逐文件 unlink、逐目录 rmdir，不递归 rm、不 copy/delete fallback。完成后记录 deleted receipt。任意中断保留 partial receipt 和剩余树，重启仍报告 inspection-required，即使 manifest 已被删除也不会误报 completed；不自动继续删除。过期不是删除授权。

Windows 目录 fsync / 断电耐久性和同用户外部文件系统变更的既有边界保留，不声称平台之外的原子性。旧备份和 guard 缺少可信 owner 时不会被自动迁移或删除。

## API 与页面

- GET / POST `/api/v1/servers/:serverId/backup-schedule`：读取或带 revision 保存 settings。
- GET / POST `/api/v1/servers/:serverId/backup-retention`：读取或带 revision 保存 settings。
- POST `/api/v1/servers/:serverId/backup-retention/run`：仅接收 revision 和 `intent: apply-backup-retention`。

所有写操作复用本地 Host / Origin / write-intent 门控，拒绝未知字段、字符串布尔和路径字段。公开响应不包含根路径、owner、密码或原始异常。UI 使用保存后的 revision，不自动重试 mutation；冲突保留输入，用户明确刷新再确认。

## 验证与证据

专项第一轮 API 57/57、相关 Web 15/15 PASS；之后补充运行中授权备份与同时关闭入口的回归，最终数量以冻结全套为准。

实际 Chromium 360 / 768 / 1440 三档 3/3 PASS（19.7s）：保存每日计划、reload 保留设置、明确启用 retention，真实 HTTP 调用在新合成隔离目录删除两份旧备份并保留最新一份。使用实际 BackupService、journal、manifest/hash 和文件删除，不模拟 HTTP 响应。没有运行 Java，没有访问用户原世界。受控 helper 全部退出、3000/8080 端口释放。私有证据：`test-results/policy-browser.log`、`policy-browser-outcome.json` 及截图，不提交。

独立 GPT-6.1 Sol / High 只读 CODE / TOOL / TEST-SOURCE Review PASS；审查者未运行测试、Java或写文件，执行证据由主任务提供。详见 [审查记录](./P34_REVIEW_2026-10-04.md)。本切片没有重新执行真实 Minecraft；完整浏览器备份→恢复→故障→回滚的真实闭环属于 P3.5，不冒报完成。

## P3.4 ISSUE LEDGER

没有同一根因耗尽三次不同修复；如之后耗尽，必须停止并在对话输出真实错误码、原始日志、源码和三次尝试。以下均保留首次失败，不以复跑掩盖。

| ID | 严重度 / 状态 | 证据与修复 | 位置 |
| --- | --- | --- | --- |
| P34-REVIEW-001 | HIGH / RESOLVED | 日期 witness 与公开 runs 可不一致；核对 runs 对应日期高水位，损坏拒绝 | backup-schedule-service.ts load |
| P34-REVIEW-002 | HIGH / RESOLVED | 排队后根变化或关闭未重验；在提交/admission/executor 验证 root、closed、active | schedule assertActive / BackupService preflight |
| P34-REVIEW-003 | HIGH / RESOLVED | 关闭可能遗留已提交操作；等待所拥有操作终态，拒绝关闭后排队动作 | schedule close |
| P34-REVIEW-004 | MEDIUM / RESOLVED | 损坏计划影响全管理器初始化；每实例隔离且 GET 保持拒绝 | schedule initialize |
| P34-REVIEW-005 | HIGH / RESOLVED | manifest 删除后 partial 树被列表漏掉；独立扫描外置 receipt，重启保持 partial | retention unresolvedReceipts |
| P34-REVIEW-006 | MEDIUM / RESOLVED | 顺序 await retention close 期间 scheduler 可触发；同时调用两个 close 后 Promise.all | app.ts onClose / backup-policy-close.test.ts |
| P34-FIXTURE-001 | LOW / RESOLVED | Windows `EPERM: operation not permitted, symlink`；改为实际 directory junction，未跳过安全断言 | backup-schedule.test.ts |
| P34-BOUNDARY-001 | MEDIUM / RESOLVED | `RESTORE_LAYOUT_UNSAFE` 未归一为 `SCHEDULE_STATE_UNSAFE`；把 load 的目录/身份检查纳入 fail-closed 边界 | schedule load |
| P34-FIXTURE-002 | LOW / RESOLVED | `Invalid transaction journal intent`；schema-1 fixture 错传 manager namespace，改用合法旧 schema，并断言 reference 确实安装 | backup-retention.test.ts |
| P34-REGRESSION-001 | MEDIUM / RESOLVED BY VERIFICATION | 首次混合源码全套 Archive 既有测试超5秒失败；相同源码/时限/断言两分支专项通过，最终冻结全套也通过；不宣称已确认具体业务根因 | world-archive-service.test.ts legacy Restore/Rollback |

最终冻结 `VITEST_MAX_WORKERS=1 npm.cmd run check` exit0：contracts6/API654/Web82共 **742 PASS**，lint/typecheck/production build PASS；`git diff --check` PASS。日志为私有 `test-results/p34-final-check.log`。独立Review与Browser Gate结合上述结果确认P3.4 PASS。没有未解决blocker或三次修复耗尽的问题。下一步P3.5真实集成浏览器闭环及Phase3 Final，不把P3.4合成filesystem验收说成新Java验收。用户授权的专用GitHub子智能体只在这些Gate通过后进行安全检查、提交和推送。

### 首次完整回归原始错误

首次完整检查与 Browser 运行有重叠，且启动后仍有最后增量，不是最终冻结源码结果。唯一失败是既有测试时限，未确认更具体的业务根因。保持原源码 / 5 秒时限 / 断言复核两个分支均通过（3.90s tests，5.47s 总耗时）；这是诊断复核，不计为不同修复，也不把首次失败改为 PASS。

```text
FAIL test/world-archive-service.test.ts > P3.3 complete world-set archive > rejects direct and API legacy Restore/Rollback after archive (startAfter=false)
Error: Test timed out in 5000ms.
test/world-archive-service.test.ts:98:23
Tests 1 failed | 652 passed (653)
npm error code 1
```

相关源码为 `it.each([false,true])`：创建备份→Restore→Archive，再对 direct 与 API Restore/Rollback 逐个断言 `NO_ACTIVE_WORLD` / 409，并核验世界、none状态和 journal 未变。没有显式 errno / HTTP 失败码；`npm exit 1` 是测试失败退出码，409 是预期断言，不是运行故障。没有加 timeout、删除/跳过安全断言或修 Windows。
