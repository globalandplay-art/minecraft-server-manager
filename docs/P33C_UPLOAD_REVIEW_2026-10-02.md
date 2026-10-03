# P3.3c 上传与校验切片

日期：2026-10-02。状态：**上传切片 PASS；P3.3c 整体 IN PROGRESS**。

后续已完成暂存列表、明确丢弃与根/目录身份绑定，见 [生命周期审查](./P33C_STAGING_REVIEW_2026-10-02.md)。以下保留上传切片当时的状态；完整 Import 事务仍未实现。

用户已要求停止使用 GPT-6 Astra，本轮没有调用。独立 GPT-6.1 Sol / High 只读审查者对上传切片最终签核 PASS，无剩余发现。该签核不是完整 Import 的最终安全 Gate。

## 实际交付

- `POST /api/v1/servers/:serverId/worlds/import-uploads` 接收原始 `application/zip` 流，201 返回共享 contracts 定义的公开校验摘要。
- Host / Origin、本地操作意图、Content-Type、Content-Encoding、声明长度和查询字段在接收前验证；文件名经过百分号解码和无路径 `.zip` 验证。
- 服务端只支持已注册本地 Vanilla、已知版本和明确受管运行或停止状态；共享实例锁和恢复门控保持生效。全局上传 admission 串行化。
- 实际接收上限 128 MiB，接收超时 60 秒；随后 ZIP 校验按既有展开大小、单文件、条目、深度、压缩比和版本限制执行，没有额外的校验总耗时期限。
- 私有 `.manager/world-imports/<随机 UUID>/` 保存 ownership、原始 ZIP、校验世界树与逐文件摘要。公开响应不含路径、RCON 密码或其他配置。
- 全部实例共享最多三份保留目录，每次预留最坏 128+512 MiB 及磁盘安全余量。失败、中断和管理器重启后的残留都计入配额；拒绝异常目录或链接。当前不自动清理，也没有删除 API。网络未确认时不自动重试。
- Worlds 页面本地模式下提供点击/拖拽选择、大小校验、上传及结果展示，明确说明“已暂存，尚未导入”。没有世界切换、停服或启动入口。

上传只写私有暂存文件，不改已注册服务端文件、现世界、properties、活动世界状态或事务 journal，也不启动 Java。测试使用合成临时目录，不访问用户原存档。

## 验证与失败记录

- 最终 contracts 5、API 419、Web 56，共 **480 项测试 PASS**。API 全套使用 `--maxWorkers=1`；前端同样单 worker。没有增加测试超时阈值。
- `lint`、`typecheck`、生产 `build`、`git diff --check` PASS。
- 新上传服务专项 16 项：流式超限、接收超时、中断保留和解锁、链接目录拒绝、跨服务器 admission、重建服务后的配额、HTTP 原始流和公开 schema、原世界不变。已有 ZIP helper 77 项仍通过。
- Chrome 使用实际合成 local API / Vite 在 360、768、1440px 上传 ZIP：3/3 PASS，201 摘要、前端实际 Value.Check、成功提示、按钮状态与无水平溢出均验证。截图在忽略的 `test-results/screenshots/phase3-upload-*.png`。这是上传浏览器验收，不是 Minecraft 导入验收。
- 首次默认并行 `npm run check` FAIL：三项既有 backup/export/restore 测试发生等待 running / 5 秒超时。其余已执行测试通过；降低并行度后 API 全套 PASS，保留失败事实，不改阈值或产品事务逻辑。
- 初次浏览器轮失败后沙箱测试进程未正常退出；只核验并结束本轮启动参数对应的 Node 进程。宿主权限复测定位到实际产品集成问题：TypeBox 的 `format: uuid` 未在前端注册，后端 201 仍被浏览器拒绝。已改为共享 UUIDv4 正则，增加 contracts 回归并重跑三种宽度全部 PASS。没有调整主机设置或隐藏日志。
- 独立审查指出配额说明应在上传前显示、旧“上传未开放”文案应更新；已修复并复审 PASS。审查者只读核对源码、测试和浏览器脚本，执行结果由主任务记录，没有冒称审查者重跑测试。

## 仍未交付的边界

1. 暂存列表、明确丢弃/过期处理与安全清理生命周期；失败证据不能未经验证自动删除。
2. 消费暂存时绑定注册根目录的 durable identity、重验文件与摘要、版本、世界 revision 和明确操作确认；当前 owner 的 canonical path 只是上传归属信息，不能授权事务。
3. Import 停服授权、pinned pre-change guard、同卷 staging/rename、journal、重启物理核验、失败保持 recovery lock 和显式恢复、活动世界状态安装。不能直接调用 Create 然后复制文件替代事务。
4. 导入确认 UI、故障注入和独立真实隔离 Minecraft 导入验收。
5. 完整 P3.3c 独立安全 Gate。用户禁止 Astra 的情况下保持 pending，不能把此次 Sol 上传切片签核替代完整 Gate。

原有 P3.2 / P3.3b PASS 保留；没有 commit、push 或进入后续 Phase。
