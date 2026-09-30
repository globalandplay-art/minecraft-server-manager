# Minecraft Java Server Manager — API 合约

状态：设计 v1；Phase 1 已在 `packages/contracts` 与 `apps/api` 实现 §4 的四个 GET 端点并通过测试。其余为后续合约，不创建空操作端点；实现必须与 [ARCHITECTURE.md](./ARCHITECTURE.md) 和 [UI_SPEC.md](./UI_SPEC.md) 一致。

## 1. 连接与责任边界

- REST 后端：`http://127.0.0.1:8080/api/v1`；前端只请求同源 `/api/v1`，开发时由 Vite 3000 代理。
- WebSocket：同源 `/ws/v1/servers/:serverId/events`，Phase 2 加入；后端为 8080，不单开公开端口。
- 所有路径参数是后端生成的不透明 ID；客户端不传本地绝对路径、Java executable、shell 参数或 RCON 密码。
- 后端负责类型检测、能力 / 阶段门控、状态判断、有效配置、文件 metadata 与所有系统 IO。前端仅呈现和提交受限输入。
- UTC ISO 8601 时间、字节大小整数、seed 为十进制字符串；UI 转换本地时区。游标为不透明字符串，不是文件偏移请求参数。

## 2. 响应、错误与版本

```ts
type Mode = 'mock' | 'local';
interface ResponseMeta {
  requestId: string;
  generatedAt: string; // UTC ISO 8601
  mode: Mode;
}
type ApiResponse<T> = { data: T; meta: ResponseMeta };
type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: { fieldErrors?: Record<string, string[]>; reason?: string };
  };
  meta: ResponseMeta;
};
```

REST 成功 JSON 除下载文件外统一 envelope；下载使用 Content-Disposition: attachment，无原始路径。错误也有 meta，不能附 stack、环境变量、完整路径、密码或底层原始异常。输入 schema 禁止多余属性，properties secrets 既不收也不发。变更合约保持 `/v1` 内向后兼容，破坏性变更才升级版本。

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR / INVALID_ARCHIVE | 输入或归档结构错误 |
| 403 | ORIGIN_REJECTED / HOST_REJECTED / UNSAFE_PATH / EXPORT_NOT_SUPPORTED / SENSITIVE_ARCHIVE | 来源、Host、目标路径或含秘密的导出不允许 |
| 404 | SERVER_NOT_FOUND / RESOURCE_NOT_FOUND | 未注册实例或不存在的资源 |
| 409 | OPERATION_CONFLICT / ACTION_UNAVAILABLE / SERVER_MUST_BE_STOPPED / NAME_CONFLICT / RECOVERY_REQUIRED / VERSION_INCOMPATIBLE | 状态不允许、安全恢复未完成或资源冲突 |
| 412 | REVISION_MISMATCH | If-Match 与当前配置 / 文件 revision 不符 |
| 413 | UPLOAD_TOO_LARGE | 大小、解包或 staging 配额超限 |
| 415 | UNSUPPORTED_FILE_TYPE | 非允许的 .jar / .zip 或 Content-Type |
| 428 | PRECONDITION_REQUIRED | 需要 If-Match 的端点未提供 revision |
| 429 | RATE_LIMITED | 请求 / 命令 / 连接过量，含 Retry-After |
| 501 | FEATURE_NOT_IMPLEMENTED / CAPABILITY_UNSUPPORTED | 当前阶段没有实现或 Adapter 不支持 |
| 503 | COMMAND_TRANSPORT_UNAVAILABLE / SERVER_PROBE_UNAVAILABLE | 已实现的依赖暂不可用 |
| 504 | OPERATION_TIMEOUT | 同步探测 / 命令超时 |
| 500 | INTERNAL_ERROR | 已记录脱敏诊断的意外错误 |

长任务已被接受后失败以 Operation.state=failed 和 error.code 表达，不能因为曾返回 202 就显示“成功”。客户端不自动重试有副作用的请求；使用同一 Idempotency-Key 查询是否已接受。

## 3. 核心数据结构

以下 TypeScript 用于说明共享 schema；实际 JSON Schema 与静态类型在 Phase 1 由 contracts 包一处生成。

```ts
type Feature = 'dashboard' | 'servers' | 'lifecycle' | 'console'
  | 'worlds' | 'backups' | 'players' | 'properties'
  | 'addons' | 'performance' | 'crashAnalysis' | 'remoteAccess';
type FeatureState = { implemented: boolean; phase: number };
type Features = Record<Feature, FeatureState>;
type ServerType = 'vanilla' | 'paper' | 'spigot' | 'purpur'
  | 'fabric' | 'forge' | 'neoforge' | 'unknown';
type MetricSource = 'mock' | 'process' | 'filesystem' | 'status-query'
  | 'rcon' | 'log' | 'plugin' | 'jmx';
type Metric<T> =
  | { status: 'available'; value: T; source: MetricSource; sampledAt: string }
  | { status: 'unavailable'; value: null; source: null; sampledAt: null;
      reason: string }
  | { status: 'stale'; value: T; source: MetricSource; sampledAt: string;
      reason: string };
interface ServerInfo {
  id: string;
  name: string;
  type: ServerType;
  minecraftVersion: string | null;
  java: { runtimeVersion: string | null; requiredMajor: number | null };
  detection: {
    confidence: 'high' | 'medium' | 'low';
    evidence: string[]; // 安全的相对证据标签，不是原始文件全文
    warnings: string[];
  };
}
interface Capabilities {
  mods: boolean; plugins: boolean; rcon: boolean;
  console: boolean; backup: boolean; worlds: boolean; properties: boolean;
}
type ActionAvailability = { allowed: boolean; reason: string | null };
interface Readiness {
  start: ActionAvailability;
  stop: ActionAvailability;
  restart: ActionAvailability;
  commands: ActionAvailability;
  backup: ActionAvailability;
  restore: ActionAvailability;
  worldChanges: ActionAvailability;
  addonChanges: ActionAvailability;
  propertiesChanges: ActionAvailability;
  commandTransport: 'rcon' | 'stdin' | 'unavailable';
}
interface ServerStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed' | 'unknown';
  ownership: 'managed' | 'external' | 'none' | 'unknown';
  source: 'mock' | 'process' | 'status-query';
  observedAt: string;
  activeOperationId: string | null;
  recoveryRequired: boolean;
}
interface ServerSummary {
  server: ServerInfo;
  capabilities: Capabilities;
  status: ServerStatus;
  readiness: Readiness;
}
interface Metrics {
  players: Metric<{ online: number; max: number }>;
  tps: Metric<number>;
  mspt: Metric<number>;
  cpu: Metric<number>;
  ram: Metric<{ rssBytes: number }>;
  disk: Metric<{ totalBytes: number; freeBytes: number; usedBytes: number }>;
  uptime: Metric<number>;
}
interface Activity {
  id: string;
  occurredAt: string;
  kind: 'info' | 'warning' | 'error';
  message: string;
  operationId: string | null;
}
interface Overview {
  summary: ServerSummary;
  metrics: Metrics;
  activity: Activity[]; // 最近 20 项，先脱敏
  alerts: { code: string; message: string }[];
}
```

Metric 不使用 NaN / Infinity / -1 作为不可用标记。TPS / MSPT 为每秒 ticks / 每 tick 毫秒；CPU 是 Minecraft 进程使用率，0–100%，按机器逻辑核心总容量归一化；RAM 为 MC 进程 RSS，Disk 为 serverRoot 所在卷，Uptime 单位秒。进程不存在时 CPU / RAM / Uptime unavailable，不显示零占用的假采样。known stopped 是真实状态，不能把探测失败当 stopped。

capabilities 是引擎 / 布局支持，不是实现完成度或连接状态；rcon=true 不等于已启用。features 从 health 获取，readiness 提供动作当前不可用原因（例如 mock-mode / feature-not-implemented / eula-not-accepted / external-process / rcon-disabled / recovery-required）。未知动作条件必须 allowed=false，reason 有可解释值；allowed=true 时 reason=null。

## 4. Phase 1 必须实现的 API

| 方法 / 路径 | data 结构 | 用途 |
| --- | --- | --- |
| GET /health | `{ status: 'ok', apiVersion: '1', features: Features }` | 管理器健康、当前模式、功能阶段 |
| GET /servers | `{ items: ServerSummary[] }` | 所有实例，第一版不分页，允许空列表 |
| GET /servers/:serverId | `ServerSummary` | 实例详情 / capability |
| GET /servers/:serverId/overview | `Overview` | Dashboard 单次快照 |

上述路径均以 `/api/v1` 为前缀。health 的 status 表示 API 服务健康，不代表 Minecraft 运行。Phase 1 仅 dashboard / servers 的 implemented=true；phase 映射为 dashboard / servers=1、lifecycle / console=2、worlds / backups=3、players / properties=4、addons=5、performance / crashAnalysis=6、remoteAccess=7。Performance 卡片展示在 Dashboard 中，Phase 6 前只有有明确 mock 来源的展示或 unavailable，不意味已实现 Performance 页面。

示例：`GET /api/v1/servers/paper-demo` 的 Mock DTO（示例时间与版本是 fixture，不是检测结果）：

```json
{
  "data": {
    "server": {
      "id": "paper-demo",
      "name": "Survival · 示例",
      "type": "paper",
      "minecraftVersion": "1.21.1",
      "java": { "runtimeVersion": "21.0.4", "requiredMajor": 21 },
      "detection": { "confidence": "high", "evidence": ["mock-fixture"], "warnings": [] }
    },
    "capabilities": {
      "mods": false, "plugins": true, "rcon": true,
      "console": true, "backup": true, "worlds": true, "properties": true
    },
    "status": {
      "state": "running", "ownership": "none", "source": "mock",
      "observedAt": "2026-09-27T00:00:00.000Z",
      "activeOperationId": null, "recoveryRequired": false
    },
    "readiness": {
      "start": { "allowed": false, "reason": "mock-mode" },
      "stop": { "allowed": false, "reason": "mock-mode" },
      "restart": { "allowed": false, "reason": "mock-mode" },
      "commands": { "allowed": false, "reason": "mock-mode" },
      "backup": { "allowed": false, "reason": "mock-mode" },
      "restore": { "allowed": false, "reason": "mock-mode" },
      "worldChanges": { "allowed": false, "reason": "mock-mode" },
      "addonChanges": { "allowed": false, "reason": "mock-mode" },
      "propertiesChanges": { "allowed": false, "reason": "mock-mode" },
      "commandTransport": "unavailable"
    }
  },
  "meta": {
    "requestId": "req-demo-1",
    "generatedAt": "2026-09-27T00:00:00.000Z",
    "mode": "mock"
  }
}
```

overview 示例中的不可用 TPS 固定为：

```json
{ "status": "unavailable", "value": null, "source": null, "sampledAt": null, "reason": "not-collected" }
```

健康检查 10 秒轮询，选中实例 overview 5 秒轮询；列表 15 秒轮询。页面不可见时暂停 overview / list 并降频 health；切换实例取消过时请求。读请求 5 秒超时，最多重试 2 次并退避，不重试 4xx。API 失败与 schema 错误不能回退为客户端 Mock。一次读取错误保留上次数据并标记连接异常，超过 15 秒无成功快照标记旧数据；服务器状态显示“未知（上次：运行中）”，不能继续当作当前 running。

Phase 1 预留路径若被请求返回 404 / RESOURCE_NOT_FOUND，不模拟 202。只有在某领域端点实际接入后，才可返回 501 表示某 adapter 或能力不受支持。

## 5. Phase 2：生命周期、操作与 Console

| 方法 / 路径 | 请求 | 成功 |
| --- | --- | --- |
| POST /servers/:id/actions/start | `{}` | 202，`{ operation: Operation }` |
| POST /servers/:id/actions/stop | `{}` | 202，同上 |
| POST /servers/:id/actions/restart | `{}` | 202，同上 |
| GET /operations/:operationId | 无 | 200，`Operation` |
| GET /servers/:id/logs | `after?`, `limit=200`（1–500） | 200，`{ items: LogEntry[], nextCursor: string, truncated: boolean }` |
| POST /servers/:id/commands | `{ command: string }` | 200，`{ status: 'executed' \| 'submitted', transport: 'rcon' \| 'stdin', output: string \| null }` |

所有写请求必须满足 §9 的保护。start / stop / restart 需要 `Idempotency-Key`（随机 UUID）：同实例 / 路由 / key / 相同 payload 在 24 小时窗口内返回同一 operation；同 key 不同 payload 返回 409。Operation service 从 Phase 2 建立持久化最小记录，Phase 3 增加文件事务 checkpoint。普通 command 不自动去重 / 重试；stop / save-all 等保留命令经统一锁与专用工作流，不能绕开活动恢复任务。

```ts
interface Operation {
  id: string;
  serverId: string;
  kind: 'start' | 'stop' | 'restart' | 'backup' | 'restore'
    | 'rollback' | 'world-create' | 'world-import' | 'world-archive'
    | 'addon-change';
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted';
  step: string;
  progress: number | null; // 0–100，仅实际可衡量时存在
  createdAt: string;
  updatedAt: string;
  result: { resourceId: string | null; rollbackAvailable: boolean } | null;
  error: { code: string; message: string } | null;
}
interface LogEntry {
  id: string;
  cursor: string;
  timestamp: string | null; // 无可靠时间戳则为 null
  level: 'debug' | 'info' | 'warn' | 'error' | 'unknown';
  text: string; // 脱敏纯文本，绝不能 innerHTML
  source: 'latest.log' | 'stderr';
}
```

生命周期与文件写操作共享 per-server 锁；已经有活动操作返回 409 和安全 reason，可由 status.activeOperationId 查询当前进度。start 到已经 running、stop 到已 stopped 都按无副作用成功 operation 处理；readiness 可在 UI 禁止无意义操作。无 force-kill 或任意 command execution API。

WS 握手通过后，后端发 hello，然后 snapshot，再发送增量；命令仍用 REST，不通过 WS 送任意文本。消息合约：

```ts
type WsMessage =
  | { type: 'hello'; streamId: string; latestSequence: number }
  | { type: 'snapshot'; sequence: number; status: ServerStatus; logs: LogEntry[] }
  | { type: 'log'; sequence: number; entry: LogEntry }
  | { type: 'status'; sequence: number; status: ServerStatus }
  | { type: 'operation'; sequence: number; operation: Operation }
  | { type: 'gap'; sequence: number; reason: string };
```

连接 query 可带 `streamId` / `afterSequence`（必须同时存在）请求重放。streamId 改变或超出 2,000 行窗口，发 gap + 最新 snapshot。sequence 在 stream 内单调递增，快照代表某 sequence 时刻完整状态；客户端据此去重，不能混合两个 stream。每 30 秒 ping，10 秒未 pong 关闭；重连按 1 / 2 / 4 / 8 秒退避，上限 15 秒加 jitter。发送缓冲超过 1 MiB 关闭慢客户端（1013）并允许补发；错误消息脱敏，非法 Origin 直接拒绝 Upgrade。暂停滚动仍接收数据，仅受控缓冲，不暂停网络。

## 6. Phase 3：Worlds 与 Backups

worldId 指向后端识别出的 world set；包含 dimensions 和 active 状态。详情字段为 `name, seed, minecraftVersion, sizeBytes, difficulty, gameMode, hardcore, pvp, viewDistance, simulationDistance`，其中每项可探测值以 Metric 包装并注明来源（NBT / properties 来源标签在世界 DTO 另设 fieldSources）。世界级不可读值 unavailable，不使用空字符串 / 0 假值。

| 方法 / 路径 | 请求或结果 |
| --- | --- |
| GET /servers/:id/worlds | `{ items: WorldInfo[] }` |
| POST /servers/:id/worlds/actions/save | 无 body 字段；要求可用 transport；返回命令确认，不承诺备份一致性 |
| POST /servers/:id/worlds | `{ name, seed?, difficulty, gameMode, hardcore, allowStop: boolean }`，202 Operation；准备新 world set，安全更新活动世界配置，归档旧世界 |
| POST /servers/:id/worlds/import | multipart .zip + allowStop；202 Operation；与 create 相同的切换保护 |
| GET /servers/:id/worlds/:worldId/download | 只下载已完成不可变归档；活动世界无已生成快照则 409，GET 不停服 |
| POST /servers/:id/worlds/:worldId/archive | `{ allowStop: boolean }`，202 Operation；inactive 世界直接归档，active 世界先一致性快照并停止使用，不能运行中移走目录 |
| POST /servers/:id/backups | `{ scope: 'world-set' \| 'server-snapshot', label?, allowStop: boolean }`，202 Operation |
| GET /servers/:id/backups | `{ items: BackupInfo[], nextCursor: null }`；当前首版不分页 |
| GET /servers/:id/backups/:backupId/download | 仅已完成且通过秘密扫描的 world-set attachment；server-snapshot 返回 403 / EXPORT_NOT_SUPPORTED，扫描命中秘密返回 SENSITIVE_ARCHIVE |
| POST /servers/:id/backups/:backupId/restore | `{ restoreScope: 'world-set', confirmWorldName: string, startAfterRestore: true }`，202 Operation；固定停服 → pre-restore → 恢复世界 → 启动 → 检查 |
| POST /servers/:id/operations/:operationId/rollback | `{ confirmWorldName: string, startAfterRollback: boolean }`，202 Operation；恢复 rollback / pre-restore，先核对实例状态 |
| GET /servers/:id/backup-policy | `{ enabled, localTime, timezone, allowStop, retainCount, retainDays, revision }` |
| PATCH /servers/:id/backup-policy | 同字段白名单 + If-Match；200 保存后的 policy |

所有多步写任务用 Idempotency-Key。create / import / archive 同样必须锁实例、停服、pre-change 快照和 journal，再切换布局；失败保留 rollback。create / import 初版完成后保持停止，用户另行启动；archive 当前世界后 active world 标记未设置，start readiness=false，直到用户创建 / 导入世界。不能因删除当前目录而让 MC 下一次意外生成空世界。

`BackupInfo` 必须包含 architecture 指定的 manifest 字段、state=complete、pinned、sizeBytes、checksum、restart / downtime 信息。未完成归档不出现在可恢复列表；不可按前端提供的文件路径恢复。restore 验证同实例或经专门 import 工作流检查布局，不允许任意跨实例覆盖。

备份 readiness 仅在能力支持、状态为 stopped，或为管理器拥有的 running 进程且无活动操作 / 恢复门控时 allowed。运行中创建要求请求 `allowStop=true`。后端先估算所有目标文件的大小，预留至少 128 MiB 或估算大小的 5%（取较大值）；空间不足在停服和复制前失败。实际成功写入的 manifest 同时受 64 MiB 序列化 / 读取上限约束。逐文件数据和 manifest 均同步后才允许提交 journal；Windows Node 不支持目录 fsync 时按事务 journal 既有的平台处理规则执行，所有文件仍需先成功 fsync。

当前代码仅开放 Vanilla 的 GET worlds、GET backups、POST backups 三条路径。world-set 与私有 server-snapshot 都会停服后复制并生成 SHA-256 manifest；server-snapshot 不提供下载。受限 world-set 下载、实际 payload 二次验证、restore、world CRUD 与 backup policy 尚未实现，health feature 继续返回 implemented=false；UI 会明确标注不支持的动作。

Phase 3 恢复范围仅 world-set；从 server-snapshot 选择世界恢复时，只使用 manifest 的世界项，其他文件不切换。完整服务器恢复是后续升级 / Addon batch 工作流的独立设计，当前 API 不接受 restoreScope=server-snapshot，不能用 world-set 结果宣称整服已回滚。

schedule localTime 用 HH:mm，timezone 用支持的 IANA zone；retainCount 范围 1–100，retainDays 1–365；enabled 默认 false，allowStop 默认 false。预恢复 / 升级 / 批量 Addon 快照保持 pinned，不自动清理。Retention 由后端完成且只删除符合策略的备份；不提供任意文件删除 API。

## 7. Phase 4：Players 与 Properties

| 方法 / 路径 | 合约 |
| --- | --- |
| GET /servers/:id/players | `{ availability: 'available' \| 'unavailable', completeness: 'full' \| 'sample' \| 'unknown', items: Player[], sampledAt: string \| null, reason: string \| null }` |
| GET /servers/:id/properties | `{ fields: SafeProperties, revision: string, fieldRules: PropertyRules }`，ETag 与 revision 对应 |
| PATCH /servers/:id/properties | `{ changes: Partial<SafeProperties> }` + If-Match；`{ fields, revision, backupId, restartRequired: true, restartFields: string[] }` |

Player 为 `{ id: string, uuid: string | null, name: string, online: boolean }`；有已验证 UUID 时作为稳定 id，只有名字时使用 backend opaque session id，不能伪造 UUID。空 items 只有 availability=available 才能解释为无在线玩家。此阶段只查看玩家；kick / ban / op 不隐含在本轮范围中，将来单独设计权限和确认。

SafeProperties 是 properties 键名白名单：`max-players`（1–10000 的产品上限，仍需版本规则校验）、difficulty、gamemode、pvp、online-mode、view-distance、simulation-distance、motd（UTF-8 ≤ 1024 字节，无 NUL / 换行）。具体距离范围由后端版本 fieldRules 返回，未知版本拒绝未经确认的范围修改。difficulty / gamemode 枚举由后端 schema 提供。rcon.password 等秘密字段在任何 fields、errors、revision diff 中都不得出现。

保存前将完整原文件备份到后端私有目录，备份失败则不改文件；backupId 仅用于本地受保护恢复，不设通用下载端点。If-Match 冲突先刷新并保留用户编辑；保存只是写入，不执行 restart。

## 8. Phase 5 / 6：Addons、指标与 Crash Analysis

| 方法 / 路径 | 合约 |
| --- | --- |
| GET /servers/:id/addons?kind=mod\|plugin&state=enabled\|disabled\|trashed | `{ items: AddonInfo[] }`；kind 必填，state 默认返回全部 |
| POST /servers/:id/addons?kind=mod\|plugin | multipart 单 .jar，202 addon-change Operation；完成 result.resourceId 指向 addonId |
| POST /servers/:id/addons/:addonId/disable | 202 addon-change Operation |
| POST /servers/:id/addons/:addonId/restore | 202 addon-change Operation，恢复 disabled / trashed；重名 409 |
| DELETE /servers/:id/addons/:addonId | 202 addon-change Operation，只移到 trash；重复删除幂等 |
| GET /servers/:id/performance | `Metrics`，Phase 6 才是真采集 |
| GET /servers/:id/crashes | `{ items: CrashInfo[] }`，仅注册日志路径 |
| GET /servers/:id/crashes/:crashId/analysis | `{ findings: Finding[], confidence, evidence: LogEntry[], limitations: string[] }` |

`AddonInfo` 包括 id、kind、filename、state、entries（name / version / loader / minecraftRange）、compatibility（status / reason）、checksum、revision、restartRequired。metadata 缺失保留安全文件名并标记 unknown；不返回路径。文件状态与运行中是否已经加载区分，restartRequired 表示磁盘变更待应用，不能宣称运行实例已禁用某插件。disabled restore 到 enabled；trashed restore 到删除前的状态，不把原来 disabled 的文件直接启用。

Addon 所有写操作默认要求 stopped；单文件写前创建文件回滚副本，失败即停止。操作完成提供 `restartRequired` 的可查询 AddonInfo；UI 提供稍后 / 立即重启的明确选择。“立即重启”只在 readiness.restart.allowed=true 时使用 restart API，已停止实例则提供“启动服务器”。普通上传绝不隐含重启。批量大改将来使用独立 batch endpoint、pre-change server-snapshot 与完整回滚工作流，不能拼多个并行请求绕开快照。

Crash Analysis 是本地规则，finding 含 ruleId、severity、title、explanation、evidenceIds、suggestedAction；把推测明确标记为推测。不可自动删除 Mod、修改 properties 或上传日志到外部服务。

## 9. 安全与跨阶段合约验收

- 精确 Host / Origin allowlist 与 127.0.0.1 监听见 ARCHITECTURE §10。写请求 JSON / multipart 均要求 `X-Manager-Intent: local-ui`，此标记是本地浏览器请求保护的一部分，不是身份认证。
- GET 无副作用；禁用 CORS 通配符；WS 不能靠 CORS 保护，必须在 Upgrade 检查 Origin，拒绝 null / 缺失 Origin。
- JSON body ≤64 KiB；单 JAR ≤100 MiB；ZIP ≤2 GiB，解包 ≤8 GiB、100,000 entries，metadata ≤1 MiB；staging 总配额默认 12 GiB，卷剩余空间预留至少 1 GiB。上传限额流式执行，不把整个世界载入内存。
- schema 不得接受未知属性；秘密文件 never serialize。响应里的 message / logs 也脱敏；数据下载只允许已经生成的受控归档，不映射任意文件读取。
- 资源不支持时 UI 与 API 共同拒绝；未知 ID 404；缺失 If-Match 428；冲突 409 / 412；不可用指标 value=null；不可把失败变成成功 envelope。
- Phase 7 开始前另行制定认证 / 授权合约；当前 API 不可直接作为公网 API 暴露。

Phase 1 合约测试验证四个 GET、envelope、feature map、Mock 来源、未知实例、缺失指标、Origin / Host、错误响应无秘密与 API 停止状态。生命周期、WS、上传、恢复、并发与安全文件测试在各自阶段落实。
