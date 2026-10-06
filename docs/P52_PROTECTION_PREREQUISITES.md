# P5.2 安装事务前置框架

2026-10-05：本文件最初记录的保护备份前置阻碍已由 P5.2 后端核心处理，并经独立 Sol High delta Review。原始分析保留如下作为设计历史；当前实现状态见 [P5.2 收尾记录](./P52_INSTALL_TRANSACTION_2026-10-05.md)。

## 已确认的阻碍与执行顺序

初始检查发现现有 BackupService.create 明确只允许 Vanilla，旧 server-snapshot 根集合不完整。P5.2 已新建 Paper/Fabric 私有快照 profile：以注册服务端根目录当时的完整顶层条目为集合，递归复制并核验普通文件、目录身份与目录成员在复制前后未变化；manifest 记录服务端类型与 Minecraft 版本，snapshot pinned 且不能通过公共导出 API 下载。无法读取或核验的 symlink、junction、hardlink、特殊文件、超额内容及变化中的目录 fail closed。

Paper 布局不可固定假设为旧 Bukkit 分离维度。官方 [26.1 公告](https://papermc.io/news/26-1/) 明确新维度与 per-world 配置位于 world/dimensions 下；旧布局与迁移残留必须按版本和实际证据分别核验，冲突则拒绝，不自动迁移测试源世界。

先完成可信 Adapter 类型/版本/启动依赖识别，再定义各类型完整、私有且不可下载的保护 profile。确认世界布局及所需配置、启用与禁用扩展、回收站、启动依赖的支持边界；无法证明完整时拒绝安装。新 profile 必须经独立 Sol High 审查，不更改 Vanilla 已有备份/恢复语义。

1. 核验注册 root identity 和可信类型证据，定义 Paper/Fabric 保护集合；未知布局拒绝。
2. 有界上传至私有 staging：实际字节限制、单次与总额度、接收超时、目录/文件身份、哈希和 server binding。未知或被事务引用的 partial 保留，不按时间直接删除。
3. 校验上传 JAR 的全部 ZIP 结构与安装所需内容完整性。当前 reader 对所有普通成员做有界解压、实际输入消耗、展开长度与 CRC 校验，再只解析 allowlist metadata；JAR 不会被解压到磁盘或执行。
4. 安装请求绑定 inventory revision、upload identity/checksum 和幂等 key；在 instance admission 内重新核验受管停止状态、无 recoveryRequired、活动世界及全部身份/引用。
5. 完整保护写入并验证后 pinned；持久化 journal intent 后才执行同卷、不覆盖 rename。上传 consumed 必须纳入同一事务证据。
6. 物理核验成功才 commit，返回需要显式启动/重启，不自动启动。失败保留 staging、原/新文件、guard、journal 并 fail-closed。
7. 所有 checkpoint 注入失败并以新 Journal/OperationService 重建核验；真实 Paper/Fabric 验收仅使用已核对的专用或 fresh UUID 隔离实例。

## 当前限制

用户已授权两个专用测试实例；本次没有启动它们。P5.2 后端核心已实现安装 API，但没有 UI、Disable/Restore/Trash，也没有 Paper/Fabric 真实 Java 启动验收。不得通过修改 capability 或删除 Vanilla gate 绕过后续验收。
