# P5.1b 只读元数据与 API

当前实现：GET /api/v1/servers/:serverId/addons，注册本地 Paper/Fabric 的启用/禁用 JAR 清单；不可提供客户端路径。返回 opaque ID/revision、文件名、实际大小、SHA256、可解析名称/版本/Loader、声明 Minecraft constraint；compatibility 始终 unknown，writeSupported=false。no-store 与 quoted ETag；并发扫描 429 ADDON_SCAN_BUSY。Mock/其他类型 501。

## 安全与范围

64MiB 单 JAR、256MiB 清单、1000 项；固定目录、descriptor/nlink/根及目录身份、末尾内容摘要重验。ZIP 结构/metadata 大小、压缩比、路径、重复与特殊文件、local header/data descriptor/区间和 metadata CRC/实际 inflate 核验。Fabric JSON schema1；Paper plugin.yml 为保守 YAML 子集。解析失败显示 invalid/missing，不猜测名称或版本。

不是完整安装校验：非 metadata payload 不验证 CRC/实际 inflate；paper-plugin.yml、Forge/NeoForge TOML 尚未解析；无法据此宣称真实 Paper/Fabric bootstrap 或生命周期通过。无上传、安装、禁用恢复/trash API，无自动启动，无 UI。

## 验证与 Review

P5.1b 独立 GPT-6.1 Sol High CODE REVIEW PASS，无未关闭 P1/P2。补测后 DELTA TEST-SOURCE REVIEW PASS，审查者未运行测试；主任务实际运行 57 项专项 PASS。包含有效 Fabric/Paper ZIP→inventory→HTTP、enabled/disabled、signed/unsigned descriptor 与 CRC 损坏、symlink/错误 local offset、末尾文件变化。Fabric 空名称/版本已拒绝。

新冻结完整回归显式 CHECK_EXIT=0：contracts6/API900/Web108，共1014 PASS，lint/typecheck/production build通过。test-results/p51-metadata-api-check-final.log 是失败历史，不得引用为 PASS；最终新日志 p51-metadata-api-check-v2.log。独立SolHigh代码、补测和cleanup delta审查均PASS。P5.1b只读工程切片PASS，不是完整P5.1或Phase5最终PASS。

## Issue ledger

- P51-ZIP-BOM / P51-ZIP-DEFLATE / P51-YAML-KEY：独立审查 P2 已关闭。保留 BOM、完整压缩输入消费及复杂 YAML 键拒绝；每项首次实质修复及专项/delta 审查通过。
- P51-FABRIC-EMPTY：空 name/version 原可作为 parsed；首次增加非空校验，专项通过。
- P51-API-FIXTURE：初次 TypeError adapter.subscribe is not a function，补测试 adapter 的 observer 接口后通过；没有改产品契约。
- P51-CLEANUP-PORT：完整回归 API 897 PASS/2 FAIL，exit1。原始错误 `expected [...] to have a length of 2 but got 3`；增加断言诊断后确认 `listen EADDRINUSE: address already in use 127.0.0.1:3000`。首次实质修复让合成测试选独立端口；真实 helper 默认仍3000。新增占用端口反例仍必须拒绝并保留日志，3专项PASS；独立复审与新完整回归待确认。未操作未知进程。
- 工具历史：npm.ps1 执行策略拒绝改用 npm.cmd；离线依赖 ENOTCACHED 后授权正常安装 js-yaml，审计0漏洞；内联诊断因 Windows 参数引号 SyntaxError，改用测试的详细断言捕获真实错误，未改系统。

cleanup独立delta审查PASS，确认真实调用仍用默认3000，未弱化清场Gate。新完整回归通过确认该项RESOLVED；失败历史不改写。

没有接受新 EULA、运行真实 Java、访问用户原世界、commit 或 push。P5.2 保护前置参见 P52_PROTECTION_PREREQUISITES.md；只读设计核验已完成，尚未签实现。版本绑定profile、锁内guard入口、可信启动证据及新类型生命周期需先完成。
