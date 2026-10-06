# P4 Properties — 安全写入核心设计

2026-10-05当前状态：配置reader/guard/journal/cutover/bootstrap/API/UI已实现并通过工程Gate，真实隔离配置验收run `p44-properties-80690902-6c9b-48ab-98d9-42413ca0788f` PASS；整体FinalGate以PROGRESS最新记录为准。下文“尚未实现/保守拒绝”等为2026-10-04设计阶段历史快照，保留原始语义，不描述当前状态。

2026-10-04；用户要求优先高工作量核心任务。本文件实施设计已完成独立 Sol High DESIGN PASS，不代表接口已实现。P4.1 完成执行 Gate 后按本设计先实现文件安全/事务内核，再接普通表单；无 Astra。

当前实现检查点：reader/精确 patcher 前置核心已通过 Review 和 867 项冻结全套；schema 6 journal、私有 guard 和 bootstrap 前置拒绝已进入独立准备切片验证，见 [P4.3 准备记录](./P43_PROPERTIES_FOUNDATION_2026-10-04.md)。以下描述完整保存方案；真正配置切换、终态物理收敛、配置 API 和 UI 尚未实现。当前 bootstrap 保守拒绝整个本地 API，不以此冒充最终按实例恢复 UX。

## 已核验的复用点与缺口

- `config/properties.ts` 已有 Java properties 转义/continuation/注释保留更新；应复用语义，但其现有通用读取器不足以单独证明 nlink=1、打开前后 inode/mtime/root 不变。新增配置专用 bounded reader，不无意义改动全部 Phase 3 读取逻辑。
- `backupDirectoryIdentity` / `plainRestoreDirectory` 可核验 canonical root identity；注册路径由 backend 推导。请求不含路径/命令/秘密字段。
- `OperationService.runExclusive` 已阻止恢复/活动操作，可用于读；写入须持久 operation + admission，不使用读锁冒充 durable write。
- 设计时 journal kinds 没有 properties-write；准备切片已新增 schema 6/kind 和 operation contracts，保持旧 world records可读。完整 startup 物理 reconciliation 仍待保存切片。不得借用 world-create/import journal 或把配置原文写到公共 Operation.result。
- **bootstrap先后约束**：当前main先createLocalAdapters，registration会在journal扫描前必读server.properties。实现新kind前必须增加严格、root-bound的中断预检bootstrap：仅持久registration与匹配的properties intent可识别缺失配置窗口并保留恢复锁，不能生成默认配置或放宽一般缺失文件。无法建立安全adapter时受影响实例保持不可启动并提供安全恢复状态；不得因重建adapter先失败跳过事务证据。
- **精确文本保留约束**：现有updatePropertiesText会统一换行，不能用于承诺逐byte保留的混合CRLF/LF或CR-only文本。配置专用patcher须保留原始line terminator/byte spans，只替换最后有效目标逻辑项（含continuation）；首次实现不支持的布局应明确拒绝，不能偷偷规范化非目标文本。

## 公共输入与安全读

沿用 GET/PATCH 合约、If-Match 和明确 X-Manager-Intent。白名单仅 max-players/difficulty/gamemode/pvp/online-mode/view-distance/simulation-distance/motd。严格禁止额外键/控制字符；版本 fieldRules 只在实际验证的版本上发布可编辑范围，未知范围 read-only。缺失/无效值显示 unknown，不虚构默认值。UI 对 online-mode=false 额外解释身份风险并明确确认。

完整原文件仅后端持有；1MiB有界、descriptor read、常规文件/nlink1、dev/ino/size/mtime、canonical root前后重验。返回安全字段与有效性规则，不输出 rcon.password、完整配置、底层异常、secret diff。安全字段自身出现敏感赋值形式也须在输出/日志做保守校验，不能盲信字段名就安全。

revision 用服务实例私有随机 key 的 HMAC-SHA256，绑定 serverId/root identity/完整原文件；不向外返回完整配置的普通SHA。key可仅内存持有：API重启后旧If-Match失效并要求刷新，安全但会冲突，不伪装稳定revision。恢复journal使用后端私有摘要，不依赖易失HMAC作真实性判断。Idempotency请求不持久化原配置或密码；只保存严格安全的changes/请求fingerprint，same-key/body不得产生重复写。

## 首版写门控与事务顺序

首版只允许受管确认 **stopped / ownership none / no recovery / no other operation / ActiveWorldState active** 的 Vanilla；running或unknown明确拒绝，不隐含stop。注册root、world binding、原文件identity和If-Match在admission内全部重验。任何状态变化先Conflict，不能覆盖离线编辑。level-name、端口、RCON、EULA不属于允许变化；更新前后解析秘密/未知字段语义一致，非目标物理文本保留。

1. 分配operation/transaction ID，写入root-bound durable intent；尚无文件切换。
2. 从已验证descriptor读取原bytes，将完整保护副本写入manager私有properties-backups/opaqueID，以wx、0600、fsync、manifest/checksum/owner核验后pinned。API仅返回opaque backupId，绝不开放下载/Export/普通文件读取。
3. server root内同卷受控workspace写prepared新文件（wx、fsync）；绑定original/prepared identity与摘要。两个目录跨卷时保护副本可copy，但**配置切换不跨卷且不copy-delete降级**。
4. guard完成后、rename前再次重验source/root/revision/stopped/admission，持久replace-intent。
5. 原配置受控rename至workspace old slot，再prepared rename至固定server.properties；每步先intent、后物理核验、后completion。original missing窗口中的所有lifecycle入口已因active durable operation锁定。重启不允许Java默认生成配置。
6. 读回完整文件并核验期望、安全字段、非目标字段及identity；persist committed，再公开成功字段/revision/backupId/restartRequired/restartFields。服务器保持stopped，不自动启动。
7. journal/old copy/guard保留到明确安全策略；本切片不新增自动删除或通用恢复文件接口。

## 中断与重启收敛

startup必须在生命周期入口开放前扫描新kind，核对root identity、guard与prepared/old/target布局、校验摘要及durable operation结果。不能仅相信committed journal。尚未确认的committed必须物理核验；历史已确认成功之后的合法离线配置编辑不能被旧摘要误锁。root改绑、旧record缺binding、文件缺失/链接、多种布局或不匹配均 recoveryRequired，不猜测、不自动覆盖、不启动Java。

配置恢复为后续明确的properties-specific确认操作，只使用对应已验证guard、绑定原root并保持停止；不能套用world Rollback以覆盖secret配置，也不能通过此恢复清除不相关Phase 3 recovery原因。实施时若自动化恢复接口尚未完成，partial现场必须明确人工恢复锁且保留完整old/guard，不把失败说成可安全继续。

## 必须的测试与 Gate

- properties转义/Unicode/CRLF/continuation/重复键：仅目标最后有效项改变，秘密和未知字段不丢失；拒绝损坏文本/控制字符/过大文件。
- symlink/junction/hardlink、root改绑、inode替换、revision冲突、active operation/recovery/NO_ACTIVE_WORLD、running/external/unknown门控。
- guard写失败/校验失败：原配置逐byte不变；不能发布成功。checkpoint逐个注入中断、Manager重启、文件缺失窗口Start拒绝、secret不进响应/日志/operation、same-key恢复请求不重复写。
- 历史确认成功后离线合法编辑不得因旧摘要被误锁；unconfirmed committed、root变更或unknown布局必须fail-closed。
- UI保留冲突草稿、显示重启字段、不自动restart；最小已支持版本规则fixture需实际依据，不硬编码推断26.3上限。
- 最终独立 Sol High Review + focused/full/lint/typecheck/build/diff；真实验收仅fresh UUID隔离 Vanilla，验证配置实际启动生效、RCON秘密仍有效及正常停服。

本文件避免提前绕开已有门控；恢复接口、journal schema扩展和原子切换属下一高风险内核实现范围，尚未实现/PASS。

独立 Sol High 架构审查判定 DESIGN PASS；bootstrap与精确字节patch两项集成约束已明确。该结论仅是设计，绝不代表 properties-write 或真实验收PASS。下一实施起点是配置专用reader/字节patcher，然后root-bound bootstrap/journal，最后保护备份与切换。
