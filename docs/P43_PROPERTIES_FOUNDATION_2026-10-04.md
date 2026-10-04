# P4.3 配置事务准备切片

2026-10-04。继 P4.2 reader / 精确文本准备核心后，用户授权继续。单一写入者，独立只读 Sol High Review；无 Astra。

## 当前范围

- `TransactionJournalStore` schema 6 / `properties-write`，独立于世界 Restore / Import；绑定 root、world identity/revision、原文件 identity、前后摘要、guard ID 与固定工作区。禁止隐式停服、客户端路径、秘密正文或混用世界事务 payload。
- 新 backend-only descriptor reader 校验 canonical file、nlink=1、打开前后 identity/size/mtime/ctime；有界读取完整原字节。
- 私有 guard 放在 manager 的 `properties-backups/<serverId>/<opaqueId>`，原字节只写 `original.properties`。文件 wx/0600/fsync、独立 pinned manifest 和原文件/目录/副本 identity/摘要核验完成后才写 journal checkpoint。仅返回 opaque guardId，没有下载 API。现有/半写目录保留且拒绝覆盖。
- `loadLocalRegistrations` 在构建 launch plan、读取必须的 server.properties 之前扫描 journal。存在 properties 事务或当前注册实例的损坏 journal 时返回 `RECOVERY_REQUIRED`；不生成默认配置，不启动 Java，不自动修复。
- `OperationService` 将新 kind 的未确认终态纳入既有 recovery gate；不只凭 committed journal 发布成功。

**准备切片不是配置保存功能。** 尚无 cutover、PATCH/GET 配置路由、可编辑版本规则、表单或配置恢复 API。当前 bootstrap 保守阻止整个本地 API（包括 terminal properties 记录）；未来真正保存接入前必须实现终态物理收敛，以及已确认成功后合法离线编辑不被旧摘要误锁。不能将暂时门控宣称为最终 UX 或完整 P4.3 PASS。

## 验证

- 当前 focused：foundation39、既有 journal10、reader/patcher/runtime redactor44，共 **93 PASS**；`test-results/p4-properties-foundation-focused-layout-final.log`。增量前的 88/90 PASS 记录保留；最后补充目录清单不变断言后，最终906项全套通过。
- lint PASS；typecheck 第一次失败后修复并 PASS。独立只读 **Sol High PREPARATION CORE REVIEW PASS**，随后私有树隔离 P2 修复获 **CODE DELTA PASS**；最终冻结全套 `VITEST_MAX_WORKERS=1 npm.cmd run check` exit0：contracts6/API813/Web87，共 **906 PASS**；lint/typecheck/production build 均通过，`git diff --check` exit0。记录 `test-results/p4-properties-foundation-final-check.log`。**准备切片工程 Gate PASS**；独立只读 Sol High 最终 **PREPARATION GATE SIGNOFF PASS**，核验93专项、906全套、最后目录不变断言、历史证据与范围声明。完整 P4.3 仍未完成。
- 覆盖每个 guard preparation 中断、source 原字节不变、partial guard 保留、元数据/副本篡改、hardlink/junction/root 替换、异步前后源变化、伪造调用者意图、缺配置窗口和未知终态拒绝。
- 没有运行 Java、访问原世界、删除历史 evidence、commit 或 push。测试临时目录均由 fixture 创建并在 teardown 回收。

## Issue Ledger

### P43-LAYOUT-001 — HIGH / RESOLVED（Review P2）

自检发现 manager 包含注册实例时，若实例恰在 properties-backups 树内，私有 guard 可能被写入服务器树。无显式错误码；尚无真实配置操作或秘密泄露事件。独立 Sol High 确认风险，并暂挂旧签核直到修复。

Attempt 1：create/verify 的任何文件 IO 前拒绝私有备份树与注册根双向包含，Windows 路径大小写归一，保留 canonical/identity 后续核验。三个隔离 fixture：备份根、本实例子目录拒绝且源字节/目录清单/成功checkpoint不变；正常 manager/instances/server 创建/verify成功。93项专项 PASS，独立 CODE DELTA PASS。修复后最终906项全套 PASS。没有修改全局 registration 支持策略。

### P43-FIXTURE-001 — LOW / RESOLVED

首次专项退出码 1：测试调用了不存在的 `operations.stateFor`。

```text
TypeError: operations.stateFor is not a function
test/properties-foundation.test.ts:151:23
```

Attempt 1：核对实际 `OperationService.getServerState`，只修正测试调用，保留 recoveryRequired=true 安全断言；41 项复跑 PASS，新增专项后 88 PASS。原日志 `test-results/p4-properties-foundation-focused-1.log` 保留。无产品事务失败、无源码数据切换。

### P43-TYPE-001 — LOW / RESOLVED

首次 typecheck 退出码 2：TypeScript 在回调中不保留 unknown object property 的数组 narrowing。

```text
src/services/transaction-journal.ts(251,74): error TS18046: 'value.paths' is of type 'unknown'.
src/services/transaction-journal.ts(251,92): error TS7006: Parameter 'item' implicitly has an 'any' type.
```

Attempt 1：在 Array.isArray 已验证后保留局部 paths 绑定，回调参数保持 unknown，继续逐字段验证，未放宽 schema。typecheck exit0；日志 `test-results/p4-properties-foundation-typecheck.log` 和 `...-typecheck-2.log` 保留。

### P43-REVIEW-001 — LOW / RESOLVED

只读审查指出 schema6 worldId 的 String 强制转换可能接受单元素数组；没有显式错误码、不是运行时失败。Attempt 1：增加 string 类型校验并补数组输入拒绝测试，90 项专项 PASS。不修改旧 schema。

### P43-REVIEW-002 — LOW / RESOLVED

审查指出原测试标题声称 legacy backup，但实际上只覆盖 unrelated server；没有显式错误码。Attempt 1：修正标题，新增真实 schema1 backup journal 兼容测试，90 项专项 PASS。

### P43-BASELINE-001 — LOW / RESOLVED

首次完整运行在审查增量期间进行，exit1：contracts6/Web87 PASS、API809 PASS/1 FAIL。保留真实失败，不把它改写为 PASS。

```text
FAIL test/properties-foundation.test.ts > properties durable foundation (no config cutover) > rejects invalid journal array-world-id
AssertionError: promise resolved "{ schemaVersion: 6, …(5) }" instead of rejecting
```

源模块可能在先前测试中已加载，而后增加了对应回归测试；该运行不是冻结版本。本项不再增加安全语义修改，完整日志 `test-results/p4-properties-foundation-full-check.log` 保留；已修复 schema6 的90项专项通过后，重新启动独立冻结全套 `...-frozen-check.log`，最终结果单独记录。没有跳过测试、放宽断言或增大超时。

没有任何问题达到三次失败阈值。

较早 `p4-properties-foundation-frozen-check.log` exit0（contracts6/API810/Web87，共903 PASS，lint/typecheck/build通过），是在私有树隔离修复前开始的记录；该 PASS 保留但不能替代修复后的最终 `p4-properties-foundation-final-check.log`。

## 下一步

准备切片 Gate 通过后，在现有 durable operation + instance admission 内核对 Vanilla/stopped/ownership none/active world/revision，再接私有 guard、同卷 prepared/old/target intent 及物理核验；实现 startup terminal reconciliation 后才能开放真正保存。所有中断、未知 root、缺失 target 都保持恢复锁，未经明确操作不自动 stop/start/repair/delete。

Windows 目录 fsync 和同用户文件系统攻击边界仍沿用已有平台限制，没有承诺断电时所有 rename 均严格耐久。
