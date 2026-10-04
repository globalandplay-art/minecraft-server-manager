# P4.2 配置前置安全核心

用户要求优先高工作量核心。已完成未接入 API 的身份读取、私有 revision、秘密过滤和精确文本准备；不代表配置保存事务或 Phase 4 已完成。

## 实现边界

- 有界 UTF-8 descriptor 读取，拒绝 BOM、损坏文本、链接及多硬链接，读取前后核验文件与根目录身份。
- 仅返回八个白名单字段；缺失或无效值为 null。HMAC revision 绑定服务、根目录与完整文件，重启后失效。
- 复用运行时敏感键规则，全部重复敏感项参与脱敏；安全字段保持 last-wins。
- 纯文本 patcher 保留非目标字节布局、混合换行及重复项，仅替换最后有效目标项；禁止路径、RCON、level-name 和非完整 Unicode 输入。
- 保守拒绝旧 helper 可能误读的注释末尾反斜线、重复 Unicode u 和悬空 continuation；没有修改 Phase 3 通用解析器。

Java Properties 的注释不延续、Unicode 转义仅一个 u；依据 [Java 25 Properties 文档](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Properties.html)。当前子集明确拒绝未支持格式，不悄悄重写。

## 验证与审查

- 最终专项：reader、patcher、runtime redactor **44 PASS**，日志 `test-results/p42-core-delta.log`。
- 独立 Sol High 初次核心审查发现两项 P2：重复敏感键漏脱敏、孤立代理字符 UTF-8 语义变化。均完成第 1 次修复并通过专项；独立只读 Sol High delta review **CORE REVIEW PASS**。冻结全套 `VITEST_MAX_WORKERS=1 npm.cmd run check` exit0：contracts6/API774/Web87，共 **867 PASS**；lint、typecheck、production build 均 PASS，日志 `test-results/p4-core-frozen-check.log`。
- 较早完整检查在源码增量期间运行，保留记录但不能作为最终冻结基线。
- 无真实 Java 启动、原世界操作或配置写入；无 commit/push。

## 问题账本

| ID | 严重性 | 状态 | 原始问题 / 错误码 | 处理与验证 |
|---|---|---|---|---|
| P42-SECRET-001 | HIGH | 已解决 | 重复敏感键较早值遗漏；无显式错误码 | 全部逻辑项参与脱敏；新增重复凭据测试 |
| P42-UTF8-001 | MEDIUM | 已解决 | lone surrogate 落盘变 U+FFFD；无显式错误码 | 输入 UTF-8 往返校验；两项回归 |
| P42-GRAMMAR-001 | MEDIUM | 已修复 | 注释延续/重复 u/末尾 continuation 可能误解；无显式错误码 | 编辑专用子集拒绝；六项回归 |

没有任何问题达到三次失败阈值，未放宽安全断言。

## 下一高风险内核

按已审查设计实现 root-bound bootstrap 和 properties journal：先处理配置缺失窗口的重启门控，再实现私有 pinned guard 与同卷切换及逐检查点中断验证。之后接入配置只读规则、保存 API、表单和隔离真实验收。保存接口目前不存在，不允许直接将纯 patcher 用于落盘。

实际集成顺序已核对：`main.ts` 当前先调用 `config/bootstrap.ts` 的 `createLocalAdapters`，再创建 journal；`config/local-config.ts` 验证 registration 时必读配置。因此不能只在 `app.ts` 的 reconcile hooks 新增服务，必须先实现只读 preflight。该 preflight 只承认匹配注册 root identity 的新 journal，不放宽一般缺失配置文件校验。若 adapter 无法安全建立，实例继续不可启动，保存现场并返回安全诊断。

下一切片的单写入者改动集中于 journal schema、bootstrap/local-config、operation admission 和 properties transaction service；先逐一测试缺失 target、old/prepared 双存在、root 改绑、伪造或旧缺绑定 journal、未知 layout，再实现真正写入。不会为赶进度将 `runExclusive` 读锁误当持久事务。
