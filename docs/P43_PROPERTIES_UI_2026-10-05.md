# P4.3 配置页面工程验收

UI 工程切片 PASS；P4.3 / Phase 4 整体尚未 PASS，真实 Vanilla 配置生效验收未运行。

本地 Settings 接入配置 GET/PATCH，Mock 页面保留。字段可编辑性遵循后端规则；距离及未确认版本只读，不猜测缺失值。保存展示差异，要求明确保护备份确认；关闭 online-mode 另需身份风险确认。只允许已停止、无恢复锁/其他操作且状态采样未过期的实例提交。

202 仅表示已受理。页面读取匹配 operation，只有 succeeded、无 error 且存在 guard 引用才显示已保存；不自动启动或重启。未知响应冻结草稿，仅允许用户明确复用原 body/revision/idempotency key 核对，不自动重发。恢复锁保持禁止新保存。HTTP 或执行期 revision 冲突必须成功刷新后重新确认，刷新失败不能解除门控。

## 审查与验证

- 独立 Sol High 发现 P2：撤销的编辑可能在冲突刷新后重新成为变更。已修复：撤销删除 dirty 项，刷新只保留真正修改且仍可编辑的字段；回归验证 PATCH 不含撤销字段。
- 补齐 HTTP / 异步冲突的刷新门控。21 项页面/字段专项通过，包含错误 operation ID/server/kind、错误成功响应、缺少 guard、刷新失败及未知结果原请求核对。
- 三宽 360/768/1440 HTTP/Chrome：SYNTHETIC_PASS。实际调用配置服务并验证 pvp 改变、秘密不出现在响应/DOM、距离只读、无横向溢出。报告 `test-results/p43-properties-browser-report.json`：helpersClosed/httpPortsFree/Chrome closed=true，cleanupErrors=[]。这些是合成世界文件，未运行 Java，不是实际 Minecraft 生效证据。
- 独立 Sol High UI CODE / TEST-SOURCE / HARNESS / DOC REVIEW PASS，无未解决产品 P1/P2。
- 冻结源码新完整 `npm.cmd run check` 显式 exit0：contracts6/API832/web108，共946 PASS；lint/typecheck/production build PASS。日志 `test-results/p43-ui-check-final.log`。先前后端 925 PASS 不充当本次修改后的基线。jsdom 两条 navigation 未实现诊断保留，测试没有失败。

## 限制与下一步

Receipt 仅在当前页面保留，跨刷新/导航恢复尚不支持；响应不确定时不要离开页面或重复发新请求，先核对操作记录。自动状态老化及卸载隔离还需进一步专项覆盖，不能宣称跨页面恢复支持。

本轮没有访问用户原世界、修改系统、运行真实 Java、commit 或 push。测试 evidence 保留在 Git ignore 的 test-results。后续为 fresh isolated Vanilla 的配置保存、显式启动、生效与秘密隔离验收，以及 P4.4 整体 Final Gate。
