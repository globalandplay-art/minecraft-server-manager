# Minecraft Java Server Manager — API 合约

## P7.2 登录 UI / WebSocket（2026-10-09，工程 Final Gate 进行中）

本节描述当前候选实现，尚待新的冻结完整回归和独立最终证据签核；下方 P7.1b 的 WS 全拒绝是保留的历史检查点。不是 Tailscale Serve，也不授权真实账号或远程入口。

`POST /api/v1/auth/ws-ticket` 要求有效 local-http Cookie、允许 Origin、intent 和会话绑定 CSRF；严格 `{serverId}`，返回 `data.ticket/expiresAt` 及正式 meta。Ticket 最多30秒、仅一次消费，绑定会话/服务器/精确 Origin，每会话最多8个 pending。目标不存在仍由事件路由在升级前拒绝；ticket 不授予其他业务权限。

required 模式仅允许 `GET /ws/v1/servers/:serverId/events` 的合法 WebSocket13 握手。浏览器提供恰好 `mcsm.events.v1` 与 `ticket.<token>` 两个子协议，服务端只选择公共协议；Cookie/ticket 不进入 URL或日志。Query 只允许原有配对 `streamId/afterSequence` 回放游标，未知、重复及编码伪装 key 拒绝。实际101前同步重验会话/audit/Origin、消费ticket、预留资源、再检查同步prune后的审计状态。每会话最多4个socket、全局32；配额保持到实际传输关闭。

Logout/rotation/expiry/审计不可用关闭1008并立即停止订阅与发送；静默连接也受限时检查，WS不刷新idle。Frontend 1008或401清空业务视图/缓存并关闭连接；重连每次申请新ticket。所有fetch包括ZIP/JAR上传共享内存CSRF/认证代际保护，晚到旧响应不能作用于新会话。登录不会重放写操作。初始UI仅在显式legacy状态或有效会话后挂载业务页面，失败不退化为无认证。

本地 Cookie/Origin策略保持P7.1b，仅适用于loopback HTTP，不表示未来远程HTTPS profile已实现。

## P7.1b HTTP 认证（2026-10-09，ENGINEERING PASS）

已实现显式 `MCSM_AUTH=required|off` 的本地 HTTP 认证。新冻结完整回归1353 PASS，lint/typecheck/build/diff通过，独立 Sol High 最终工程/证据签核 P1/P2/P3=0。未初始化真实管理员，未启用远程入口。关闭或未设置认证时仅在没有 credential/pending/staged 的情况下保留原本地行为；存在凭证而没有 required 时安全拒绝启动。required 在业务 adapter 创建前验证私有凭证及审计存储。

| 方法 / 路径 | 能力 |
| --- | --- |
| GET `/api/v1/auth/status` | 精确公开路径，无 query；仅 configured/authenticationRequired/auditReady |
| POST `/api/v1/auth/login` | 精确公开路径；严格 username/password JSON，2KiB，密码限流及审计成功后发 Cookie |
| GET `/api/v1/auth/session` | 当前会话 expiresAt/csrfToken/recentReauthentication |
| POST `/api/v1/auth/logout` | 严格空 JSON，立即撤销会话并清 Cookie |
| POST `/api/v1/auth/reauth` | 严格 username/password JSON，2KiB；验证后五分钟单调时间重认证窗口 |

required 模式除精确 status/login 外的 HTTP 请求均需 Cookie 会话，在请求体解析前拒绝未认证上传等请求，并在全部路由 hooks 完成后再次同步验证 session/audit/CSRF，才调用业务 handler。写请求继续要求允许的 Origin、`X-Manager-Intent: local-ui`、会话绑定 `X-CSRF-Token`；原事务、幂等、revision、recovery 及内容类型门控不变。已准入事务不因后续 logout 强制中断。

本地 Cookie 为 `mcsm_local_session`，HttpOnly/SameSite=Strict/Path=/，无 Domain；local-http 不使用 Secure，不能据此用于远程 HTTPS。拒绝重复/不合法 Cookie、Bearer/query/伪造代理身份。全部认证模式响应 no-store。常见拒绝码：401 AUTH_REQUIRED/AUTH_INVALID、403 CSRF_REJECTED/ORIGIN_REJECTED/AUTH_WS_UNAVAILABLE、429 AUTH_THROTTLED、503 AUTH_AUDIT_UNAVAILABLE。限流附 Retry-After。审计失效时不发新 Cookie、不延长重认证、不准入新业务操作。

required 模式 WebSocket Upgrade 一律拒绝，包括有效 HTTP Cookie；ticket/撤销接线与登录 UI 属于后续切片。当前能力不表示 WS 或 Tailscale 前置条件已经全部满足。私有审计仅固定事件/request UUID/可选 operation UUID/序号/UTC，不记录 body/header/URL/密码/token/path；三份各10MiB，单事件1KiB，最多64个待写任务。身份/权限/写入失败进入 sticky unavailable。

详细冻结与失败历史见 [P7.1b 验证记录](./P71B_HTTP_AUTH_VALIDATION_2026-10-08.md)。下方 P7.0 为早期设计记录，当前 HTTP 实现由本节说明，不改写旧设计事实。

## P7.0 认证合约设计（历史设计检查点）

Phase6已PASS，Phase7仅开始安全设计。认证状态/登录/会话/登出/WS ticket拟采用 `/api/v1/auth/*`，正式计划见[PHASE7_PLAN](./PHASE7_PLAN.md)。现有API仍无会话认证，remoteAccess=false；本节不代表端点上线，不变更现有Host/Origin/127.0.0.1门控。

设计范围为单管理员、离线初始化、密码派生哈希、HttpOnly会话cookie、会话绑定CSRF、WebSocket短时单次ticket与撤销、精确同源HTTPS远程profile。Remote不能认证关闭fallback，公网/隧道/账号或系统配置未执行。具体shared schemas在P7.1实施时冻结，现有transaction/recovery/幂等及下载秘密边界保留。

## P6.3b 本地崩溃证据

`GET /api/v1/servers/:serverId/crash-analysis` 只读、注册实例限定，沿用 Host/Origin 和实例ID校验，拒绝全部 query 参数；不接受路径、文件名、规则、命令或 POST。响应 `Cache-Control: no-store`。

`data` 包含 `status`（available/unavailable）、`reason`、原始 `sampledAt`、`minimumIntervalMs=5000`、`incomplete`、`conclusion`、`sources`、`findings` 和固定 `limitations`。Mock 返回 unavailable/local-instance-required、null 时间和空证据。注册身份缺失或文件状态不安全返回409 CRASH_EVIDENCE_UNSAFE；未知实例404。

每实例并发合并，5秒单调时钟冷却；成功快照保留原采样时间，失败在冷却期持续返回错误，不以旧成功掩盖失败。Manager 重启清空，无后台扫描或轮询。

最多4个固定来源，单个64KiB；截断来源只提供 opaque ID/type/truncated 覆盖元数据，不生成 finding/snippet。来源限 logs/latest.log 与标准 server crash report，由注册目录推导；不返回实际文件名、绝对路径或完整日志。`findings` 最多5条固定规则，confidence只允许possible，每条最多2个1000字符片段，excerptLine为脱敏片段相对坐标。证据不完整且无finding返回insufficient-evidence；no-rule-match不表示健康。凭证脱敏及同用户文件系统边界的局限见[P6.3计划](./P63_CRASH_ANALYSIS_PLAN.md)。

页面 `/crashes` 仅点击读取，错误隐藏旧结果，切换实例隔离响应，展示证据范围/时间/不完整与可能性，不提供自动修复或外部上传。

## P6.1b 性能会话历史

`GET /api/v1/servers/:serverId/performance` 为只读接口，沿用 Host/Origin 与实例ID校验。
返回 `data.retention="manager-session"`、`minimumIntervalMs=5000` 和最多120个
`samples[{collectedAt, metrics}]`。metrics 沿用既有来源、sampledAt、status及reason；
响应生成时间不代表指标重新测量。服务端按需采样，同实例合并并发请求，单调时钟
限制5秒内最多一次探测；冷却内探测失败继续返回错误，成功采样后才解除。
没有请求期间不采样，不补历史点；Manager重启清空历史。未知实例404，无POST操作。
CPU/RAM/Disk/TPS/MSPT尚未采集时保持N/A；页面区分磁盘卷已用/总量/可用。

### P6.2 工程接入（真实 Minecraft 验收 PASS）

Windows受管进程CPU由累计CPU时间差按全部逻辑核心容量归一化至0–100%；首个
有效样本因缺少基线仍为N/A。RAM为进程resident working-set，不是JVM heap。
核验受管child、PID、可执行文件和OS创建时间；停止、身份变化、探测失败或不支持
平台均返回unavailable。计数读取完成后生成sampledAt，5秒缓存保留原时间。
Disk为注册根目录所在卷，前后核验根身份，返回total/free/used，不遍历世界目录。
TPS/MSPT继续N/A。客户端不能指定PID、路径、命令或采样器。工程Review已PASS，
真实Java资源验收已由独立隔离run `p62-resources-be2a99dc-294d-4acb-93df-da774276d3b1` 和SolHigh证据Review签核PASS，详见[P62验证](./P62_VALIDATION_2026-10-08.md)。此前待验收记录保留在该验证文档历史章节；Phase6 Final Gate单独记录。

## P5.1b 扩展只读清单（2026-10-05，历史检查点）

`GET /api/v1/servers/:serverId/addons`：仅注册本地 Paper/Fabric，固定 plugins/disabled-plugins 或 mods/disabled-mods，客户端不能传路径。data包含items、opaque revision、writeSupported=false；item包含opaque id、kind、enabled/disabled state、filename、sizeBytes、sha256、nullable name/version/loader/minecraftConstraint、metadataStatus(parsed/invalid/missing)、compatibility=unknown。返回 no-store 和 quoted revision ETag；不返回metadata原文、文件内容、绝对路径或秘密。revision仅为当前进程只读快照，不是未来持久写契约。

未知实例404 SERVER_NOT_FOUND；Mock/不支持类型501 ADDON_UNSUPPORTED；不安全目录/文件409 ADDON_INVENTORY_UNSAFE；单实例reader忙429 ADDON_SCAN_BUSY。仍受现有loopback Host/Origin安全门控。名称/version/Loader来自保守metadata解析，不代表实际可加载或兼容。此段记录 2026-10-05 当时只读阶段；上传/安装和生命周期 API 的当前状态见本节 Phase 5 路由及 [P5.3 生命周期记录](./P53_ADDON_LIFECYCLE_2026-10-06.md)。

## P3.4 每日备份计划与保留策略（2026-10-04）

本地受支持实例新增以下端点。写请求均要求现有 Host / Origin / `X-Manager-Intent: local-ui` 门控、严格 JSON 类型和当前 64 位 hex revision；未知字段、路径字段及隐式类型转换拒绝。冲突返回 409，不自动重试。响应有 meta，公开 DTO 不含私有 owner/root/path 或密码。

| 方法 / 路径（前缀 `/api/v1/servers/:serverId`） | 请求 / 响应 data |
| --- | --- |
| GET `/backup-schedule` | `{ revision, settings, runs }`，最近 30 条运行记录 |
| POST `/backup-schedule` | `{ revision, settings: { enabled, localTime, timezone, allowStop } }`；返回新的 revision/settings/runs |
| GET `/backup-retention` | `{ revision, settings, lastRun }`；lastRun 初始 null |
| POST `/backup-retention` | `{ revision, settings: { enabled, retainCount, retainDays } }`；返回新 revision/settings/lastRun |
| POST `/backup-retention/run` | `{ revision, intent: "apply-backup-retention" }`；返回 revision/settings/lastRun |

schedule 首次 disabled、02:00、Asia/Shanghai、allowStop=false；localTime 必须 HH:mm，timezone 是 Intl 支持的 IANA 时区，保存规范化别名。run 包含 id、localDate、timezone、localTime、claimedAt、operationId（可 null）、state（claimed/submitted/succeeded/failed/skipped/interrupted）及 code（可 null）。日期 claim 先落盘后提交；同日不重复、错过不补跑，失败也消费该日期。运行中默认跳过，保存 allowStop=true 才授权沿用备份停服/恢复原运行态流程。

retention 首次 disabled、retainCount=10（1–100）、retainDays=7（1–365）。按最近份数或最近天数的并集保留，pinned/legacy/失败/引用/不确定现场不清理。lastRun 包含 completedAt、state（completed/blocked/partial）、code、removed IDs 及 retained `{ id, reason }[]`；HTTP 200 不意味着所有备份被删除。实例运行中、恢复门控或部分删除保留现场并报告，不能解释为成功删除。启用后仅新成功普通备份触发检查；无启动或定时清理。完整条件见 [P3.4](./P34_SCHEDULER_RETENTION_2026-10-04.md)。

## P3.3 staging lifecycle closure (2026-10-04)

`POST /api/v1/servers/:serverId/worlds/import-uploads/cleanup` accepts only `{ "intent": "cleanup-expired-unclaimed" }` with existing local Host/Origin/write-intent guards. Response `data` has `removed: UUID[]` and `retained: { id, reason }[]`; reasons are `not-expired`, `requires-inspection`, `referenced`, `discard-pending`, `cleanup-failed`. Paths, exception text, filenames and secrets are not returned. A 200 sweep can retain every record; it does not imply all staging was deleted. Unknown root layout/admission conflict fails closed.

Upload list adds optional `lifecycle` (`receiving`, `failed`, `validated`, `discard-pending`, `requires-inspection`) and `expiresAt`; existing state/revision/explicit discard contracts remain compatible. Expiry is not authorization: failed/abandoned records use 24 hours, validated unclaimed records 7 days. Consumed/journal/pinned/recovery references override expiry forever pending separately authorized reconciliation. Legacy records without trusted lifecycle are retained automatically.

Automatic cleanup defaults disabled. Backend operator may explicitly set `MCSM_IMPORT_AUTO_CLEANUP=true`; it sweeps only the requested server before a new valid upload. No timer/startup sweep/background scheduler is installed. `false` or unset disables it; other values reject startup. Receipt-bearing partial cleanup requires explicit manual retry, not automatic continuation. See [framework](./P33_STAGING_LIFECYCLE_2026-10-04.md).

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

2026-10-02 P3.3a 已实现只读预览 `POST /api/v1/servers/:serverId/worlds/create-plan`，JSON `{ name: string, seed: string }`（seed 留空表示后续随机生成）。返回 200 `{ data: { serverId, name, seed: string | null, minecraftVersion, currentWorldName, worldRevision: string | null, requiresStop, generation: 'on-explicit-start', executionAvailable: false }, meta }`，Cache-Control: no-store。请求需允许的 Host / Origin 和 X-Manager-Intent: local-ui；不接受路径或额外字段；在 AJV 自动转换前拒绝非字符串，Seed 精确校验 signed int64。拒绝危险/保留名、已有目标（不区分大小写）、链接目录、未知版本、外部/未知进程及恢复门控。此接口不持久化、不需要 Idempotency-Key、不改世界或配置；其 revision 只是预览，后续执行必须重新在实例锁内比对。该日期的实际 create/import/archive endpoint 尚未开放；当前开放状态见下表及各日期契约。

2026-10-02 P3.3b 已开放实际创建 `POST /api/v1/servers/:serverId/worlds`：严格 JSON `{ name: string, seed: string, confirmWorldName: string, worldRevision: string, allowStop: boolean }`，必须携带 UUID-v4 Idempotency-Key，返回 202 Operation。缺少 key 返回 428；原始非字符串 Seed 在 AJV 转换前拒绝。实例锁内重验名称、revision、活动世界身份和停服授权；先创建 pinned world-set guard，再保存私有配置前后副本、journal 化原子更新 `level-name` / `level-seed` 与 pending-generation 状态。旧世界目录原地完整保留；不隐式启动，不自动回滚。中断保持恢复门控并保留配置副本与 guard，暂不提供自动解决创建中断的 API。重复请求复用同一操作。配置切换成功后须另行明确 start 才生成新世界。运行实例仅允许 managed，且必须 allowStop=true。计划接口的 executionAvailable 现在表示创建写入者是否存在且 revision 可用；worldChanges readiness 同时反映活动状态和恢复/操作门控。该日期的 Import / archive 尚未开放；后续契约见下文。

worldId 指向后端识别出的 world set；包含 dimensions 和 active 状态。详情字段为 `name, seed, minecraftVersion, sizeBytes, difficulty, gameMode, hardcore, pvp, viewDistance, simulationDistance`，其中每项可探测值以 Metric 包装并注明来源（NBT / properties 来源标签在世界 DTO 另设 fieldSources）。26.3 实际生成 Seed 从 `data/minecraft/world_gen_settings.dat` 的 `data.seed` 读取，fieldSources.seed 为 `world-data`；旧布局仍使用 `level-dat`。有界 NBT 解码保留 signed int64 精度，文件缺失/损坏仍 unavailable，禁止以 server.properties 配置 Seed 冒充世界实际 Seed。世界级不可读值 unavailable，不使用空字符串 / 0 假值。

| 方法 / 路径 | 请求或结果 |
| --- | --- |
| GET /servers/:id/worlds | `{ items: WorldInfo[] }` |
| POST /servers/:id/worlds/actions/save | 无 body 字段；要求可用 transport；返回命令确认，不承诺备份一致性 |
| POST /servers/:id/worlds | 已实现：`{ name, seed, confirmWorldName, worldRevision, allowStop }` + Idempotency-Key，202 Operation；保护并保留旧世界，切换配置，明确 start 后生成新世界 |
| POST /servers/:id/worlds/import-uploads | 已实现：原始 application/zip 流 + X-Upload-Filename；201 仅代表暂存校验，无世界切换 |
| GET /servers/:id/worlds/import-uploads | 已实现：当前实例记录、归属 revision、丢弃可用性和全局配额，无私有路径 |
| POST /servers/:id/worlds/import-uploads/:uploadId/discard | 已实现：JSON confirmUploadId + revision；200 仅丢弃私有暂存，不影响当前世界 |
| POST /servers/:id/worlds/import | 已实现：已校验 uploadId/name/uploadRevision/worldRevision/confirmWorldName/allowStop + Idempotency-Key；202 Operation；pinned guard、同卷切换和恢复门控，成功保持停止 |
| GET /servers/:id/worlds/:worldId/download | 只下载已完成不可变归档；活动世界无已生成快照则 409，GET 不停服 |
| POST /servers/:id/worlds/archive | 已实现：完整active Vanilla world-set归档，绑定worldId/name/revision/intent/allowStop；202 Operation；verified pinned guard和同卷rename，成功持久化none，保持停止 |
| GET /servers/:id/worlds/archives | 已实现：完成且物理核验的独立归档列表；不返回私有路径/秘密，不自动恢复或删除 |
| POST /servers/:id/backups | `{ scope: 'world-set' \| 'server-snapshot', label?, allowStop: boolean }`，202 Operation |
| GET /servers/:id/backups | `{ items: BackupInfo[], nextCursor: null }`；当前首版不分页 |
| GET /servers/:id/backups/:backupId/download | 仅已完成且通过秘密扫描的 world-set attachment；server-snapshot 返回 403 / EXPORT_NOT_SUPPORTED，扫描命中秘密返回 SENSITIVE_ARCHIVE |
| GET /servers/:id/backups/:backupId/restore | 返回恢复预览：确认世界名、worldRevision、备份 ID、Minecraft 版本、空间大小、rollbackAvailable |
| POST /servers/:id/backups/:backupId/restore | `{ restoreScope: 'world-set', confirmWorldName: string, worldRevision: string, allowStop: true, startAfterRestore: boolean }` + Idempotency-Key，202 Operation；在实例锁内先核 revision，再停服、验证 pinned guard、stage 与 journal 化同卷切换；不得自动回滚或未经许可启动 |
| GET /servers/:id/restores | 不缓存的恢复历史，返回原 restore operation、归档 ID、事务状态与 rollbackAvailable |
| GET /servers/:id/operations/:operationId/rollback | 返回仅限该父 restore 的回滚预览与当前 revision；不执行写入 |
| POST /servers/:id/operations/:operationId/rollback | `{ confirmWorldName: string, worldRevision: string, startAfterRollback: boolean }` + Idempotency-Key，202 Operation；仅绑定原 restore 与其 guard 的显式回滚 |
| GET /servers/:id/backup-policy | `{ enabled, localTime, timezone, allowStop, retainCount, retainDays, revision }` |
| PATCH /servers/:id/backup-policy | 同字段白名单 + If-Match；200 保存后的 policy |

所有多步写任务用 Idempotency-Key。create / import / archive 同样必须锁实例、停服、pre-change 快照和 journal，再切换布局；失败保留 rollback。create / import 初版完成后保持停止，用户另行启动；archive 当前世界后 active world 标记未设置，start readiness=false，直到用户创建 / 导入世界。不能因删除当前目录而让 MC 下一次意外生成空世界。

`WorldInfo` 增加无路径的 `worldRevision`：对活动 world identity、配置的 level-name 和有界读取的 level.dat 摘要做版本化摘要。它是写操作的 stale-state token，不是授权凭证。Restore 在 per-server reservation 内、停服前比对；停服会更新 level.dat，停服后重新核对世界身份和 level-name 并记录新的 stopped revision，不比较前后摘要相等。`BackupInfo` 必须包含 architecture 指定的 manifest 字段、state=complete、pinned、sizeBytes、checksum、restart / downtime 信息。未完成归档不出现在可恢复列表；不可按前端提供的文件路径恢复。Restore 仅允许同 serverId 的受支持 world-set，不允许跨实例覆盖或 server-snapshot 整体恢复。

Rollback operation 必须包含 parent restore operation ID、当前 worldRevision、确认世界名及独立的 startAfterRollback 明确许可；它只能通过事务拥有者限定的 recovery admission 处理原事务，不能提供通用 bypass recoveryRequired 参数。API 只有在目标/旧树与 guard 已验证、事务状态可恢复时才报告 rollbackAvailable=true；失败时返回实际 recovery cause 并保留现场。

备份 readiness 仅在能力支持、状态为 stopped，或为管理器拥有的 running 进程且无活动操作 / 恢复门控时 allowed。运行中创建要求请求 `allowStop=true`。后端先估算所有目标文件的大小，预留至少 128 MiB 或估算大小的 5%（取较大值）；空间不足在停服和复制前失败。实际成功写入的 manifest 同时受 64 MiB 序列化 / 读取上限约束。逐文件数据和 manifest 均同步后才允许提交 journal；Windows Node 不支持目录 fsync 时按事务 journal 既有的平台处理规则执行，所有文件仍需先成功 fsync。

当前本地 Vanilla 代码支持 GET worlds / backups、POST backups、经秘密扫描的 world-set 导出/下载，以及 P3.2 的 restore plan/history、显式 restore 与 rollback plan/执行，P3.3 创建/导入/归档和受控 staging 收尾，P3.4 每日备份计划与保留策略。恢复整体拒绝 server-snapshot，包括仅提取其中世界；请求不能提供文件路径。none 的重新激活/归档恢复接口仍未开放。health 的 worlds/backups 仍代表 Phase 3 全部功能完成度，故在完整 Phase 3 完成前仍可返回 implemented=false。

Phase 3 恢复范围仅为同实例 Vanilla world-set。server-snapshot 在恢复流程入口拒绝，不会提取其中世界；其他文件从不切换。完整服务器恢复是后续升级 / Addon batch 工作流的独立设计，当前 API 不接受 restoreScope=server-snapshot，不能用 world-set 结果宣称整服已回滚。

schedule localTime 用 HH:mm，timezone 用支持的 IANA zone；retainCount 范围 1–100，retainDays 1–365；enabled 默认 false，allowStop 默认 false。预恢复 / 升级 / 批量 Addon 快照保持 pinned，不自动清理。Retention 由后端完成且只删除符合策略的备份；不提供任意文件删除 API。

## 7. Phase 4：Players 与 Properties

| 方法 / 路径 | 合约 |
| --- | --- |
| GET /servers/:id/players | `{ availability: 'available' \| 'unavailable', completeness: 'full' \| 'sample' \| 'unknown', items: Player[], sampledAt: string \| null, reason: string \| null }` |
| GET /servers/:id/properties | `{ fields: SafeProperties, revision: string, fieldRules: PropertyRules }`，ETag 与 revision 对应 |
| PATCH /servers/:id/properties | `{ changes: Record<string, string>, confirmOfflineIdentity: boolean }` + quoted If-Match + UUID Idempotency-Key；202 `{ operation, restartRequired: true, restartFields: string[] }`，需轮询 operation 后重新 GET |

Player 为 `{ id: string, uuid: string | null, name: string, online: boolean }`；有已验证 UUID 时作为稳定 id，只有名字时使用 backend opaque session id，不能伪造 UUID。空 items 只有 availability=available 才能解释为无在线玩家。此阶段只查看玩家；kick / ban / op 不隐含在本轮范围中，将来单独设计权限和确认。

P4.1 当前实现：仅受管 running Vanilla 的固定 RCON `list` 完整英文格式；名字、人数、上限、重复项及输出大小全部核对。成功为 available/full；没有可信完整结果为 unavailable/unknown、items=[]、sampledAt=null，reason 为安全枚举，不返回原始日志、异常或秘密。uuid=null，ID 为当前采样会话的后端 opaque 标识，不代表已认证身份或跨重启稳定账号。UI 以15秒采样年龄/查询暂停标记旧数据，错误时不把缓存显示成当前名单；轮询10秒、后台暂停，手动刷新共享命令限流。实例恢复/活动操作/ownership 门控沿用现有 admission。Properties 合约仍为后续切片，尚未启用。

SafeProperties 是 properties 键名白名单：`max-players`（1–10000 的产品上限，仍需版本规则校验）、difficulty、gamemode、pvp、online-mode、view-distance、simulation-distance、motd（UTF-8 ≤ 1024 字节，无 NUL / 换行）。具体距离范围由后端版本 fieldRules 返回，未知版本拒绝未经确认的范围修改。difficulty / gamemode 枚举由后端 schema 提供。rcon.password 等秘密字段在任何 fields、errors、revision diff 中都不得出现。

2026-10-04 实施检查点：`properties-write` 已加入 operation kind 和严格私有 schema6 journal；私有保护备份及 bootstrap 拒绝属于准备内核，不是上述公共配置 GET/PATCH 的实现。当前没有配置保存端点，也没有保护备份下载端点；不返回原配置或私有 manifest/checksum。

保存前将完整原文件备份到后端私有目录，备份失败则不改文件；backupId 仅用于本地受保护恢复，不设通用下载端点。If-Match 冲突先刷新并保留用户编辑；保存只是写入，不执行 restart。

2026-10-05 后端接线状态（替代此前“未启用”作为当前状态，不改写旧检查点）：GET/PATCH `/api/v1/servers/:serverId/properties` 已接入。GET 返回上述 data 和 meta，no-store，ETag 为双引号包裹的 opaque revision；不返回路径、文件身份、原字节、manifest/checksum或密码。PATCH 需允许的 Host/Origin、JSON、`X-Manager-Intent: local-ui`、quoted `If-Match`、UUID v4幂等键。changes 值全部为字符串，只允许六个已开放字段；所有额外字段、路径、秘密字段、非字符串与隐式类型转换先拒绝。当前仅 Vanilla 26.3 的六项产品规则开放；其他版本全部只读，两个距离字段全部只读，不假定上限。

`confirmOfflineIdentity` 必须为布尔；online-mode=false 需 true。max-players 产品上限 10000、枚举 difficulty/gamemode、pvp/online-mode true/false、motd UTF-8字节/控制字符限制继续由后端执行。保存要求已确认 stopped/ownership none、active world、无恢复锁/其他操作，运行中不隐含停服授权。202只是 accepted，不代表写入已成功或 Minecraft 已生效；待 `/operations/:operationId` succeeded 后重新 GET 获取新 revision/字段。operation.result.resourceId 是私有 guard ID，无下载端点；所有修改需要明确后续启动/重启，本接口不会执行。

缺少/无效前置条件428，revision过期409 PROPERTIES_REVISION_CONFLICT，同key不同请求409 OPERATION_CONFLICT，非法请求400，写意图不足403，不具备本地服务501。成功及GET均no-store。bootstrap仅放行root绑定且物理核验成功的committed历史；active/模糊/缺失配置/根目录改变继续阻止启动，无默认配置回退或自动修复。当前是后端接线，表单及真实Vanilla Gate未完成，不能据此标记P4.3/Phase 4 PASS。

## 8. Phase 5 / 6：Addons、指标与 Crash Analysis

| 方法 / 路径 | 合约 |
| --- | --- |
| GET /servers/:id/addons | `{ data: { items, revision, writeSupported }, meta }`；类型从可信服务端 Adapter 推导；只列 enabled / disabled |
| POST /servers/:id/addons/uploads | 原始 `application/java-archive` JAR 上传；返回受限的 validated staging DTO，不执行 JAR |
| POST /servers/:id/addons/install | 严格 JSON `{ uploadId, uploadRevision, inventoryRevision }`；202 addon-change Operation |
| GET /servers/:id/addons/trash | `{ data: { items, revision }, meta }`；Trash 独立列出，不混入正常 inventory |
| POST /servers/:id/addons/:addonId/disable\|enable\|trash | 严格 JSON `{ revision }`；202 addon-change Operation |
| POST /servers/:id/addons/trash/:trashId/restore | 严格 JSON `{ revision }`；202 addon-change Operation，恢复到 Trash 前的 enabled / disabled 状态 |
| GET /servers/:serverId/performance | `{ retention: "manager-session", minimumIntervalMs: 5000, samples: [{collectedAt, metrics}] }`，见顶部P6.1b/P6.2 |
| GET /servers/:serverId/crash-analysis | `{status, reason, sampledAt, minimumIntervalMs, incomplete, conclusion, sources, findings, limitations}`，见顶部P6.3b；不提供独立crashes列表/按文件ID读取接口 |

Addon inventory 条目包括 opaque `id`、`kind`、`filename`、`state`、大小、SHA-256、解析到的 name / version / loader / Minecraft 约束及 metadata 状态；兼容性仍为 `unknown`，不代表实际可加载。列表用不透明 revision 绑定目录和每个文件的物理身份及内容摘要；响应不返回路径、私有目录、journal 或 JAR 字节。Trash 条目使用 `id`（用于 `:trashId` 路径参数），另含 `addonId`、原状态与恢复资格，必须通过独立回收区端点访问。

Addon 安装与生命周期写入需要本地写意图、UUIDv4 `Idempotency-Key` 及 JSON revision；无幂等键返回 428，revision / 状态冲突返回 409。单实例操作串行执行，写前创建完整 pinned 私有 server-snapshot，再写入 transaction journal 并进行文件身份、内容和父目录复核。Disable / Enable / Trash / Restore 仅通过受控同卷无覆盖发布与受控源 unlink 完成；不永久删除、不自动清理 Trash、不自动启动或重启 Minecraft。操作成功返回 `restartRequired=true`，客户端必须等待 operation 成功后再提示用户显式启动 / 重启；旧的“立即重启”UI 尚未实现。

Crash Analysis 是本地固定规则，finding含code、confidence="possible"、title、guidance和evidence[{sourceId,excerptLine,snippet}]；正式边界与上限见顶部P6.3b。不可自动删除Mod、修改properties或上传日志到外部服务。早期ruleId/severity/explanation草案没有成为接口契约。

## 9. 安全与跨阶段合约验收

- 精确 Host / Origin allowlist 与 127.0.0.1 监听见 ARCHITECTURE §10。写请求 JSON / multipart 均要求 `X-Manager-Intent: local-ui`，此标记是本地浏览器请求保护的一部分，不是身份认证。
- GET 无副作用；禁用 CORS 通配符；WS 不能靠 CORS 保护，必须在 Upgrade 检查 Origin，拒绝 null / 缺失 Origin。
- JSON body ≤64 KiB；Addon 单 JAR ≤64 MiB、最多 10,000 ZIP entries、展开总量 ≤512 MiB，单 metadata ≤256 KiB / 总 metadata ≤1 MiB；每实例最多三个私有 addon upload 槽，consumed/failed 记录保留并计入。世界 ZIP 上传及 staging 限额按下文 P3.3c 现行合约，不使用早期草案的 2 GiB 上限。上传限额流式执行，不把整个世界载入内存。
- schema 不得接受未知属性；秘密文件 never serialize。响应里的 message / logs 也脱敏；数据下载只允许已经生成的受控归档，不映射任意文件读取。
- 资源不支持时 UI 与 API 共同拒绝；未知 ID 404；缺失 If-Match 428；冲突 409 / 412；不可用指标 value=null；不可把失败变成成功 envelope。
- Phase 7 开始前另行制定认证 / 授权合约；当前 API 不可直接作为公网 API 暴露。

Phase 1 合约测试验证四个 GET、envelope、feature map、Mock 来源、未知实例、缺失指标、Origin / Host、错误响应无秘密与 API 停止状态。生命周期、WS、上传、恢复、并发与安全文件测试在各自阶段落实。

### P3.3c 当前上传协议（2026-10-02）

`POST /api/v1/servers/:serverId/worlds/import-uploads` 使用原始 ZIP 请求体（不是 multipart 或 JSON）。要求允许的 Host / Origin、`X-Manager-Intent: local-ui`、准确的 `Content-Type: application/zip`、`X-Upload-Filename: encodeURIComponent(file.name)`；拒绝 Content-Encoding 和任意查询参数。声明长度和实际接收都限 128 MiB，接收超时 60 秒；后续结构校验有资源上限，没有单独的总耗时期限。JSON 路由仍保持 64 KiB 限制。

成功 201 `{ data: { id, serverId, minecraftVersion, fileCount, sizeBytes, checksumSha256, state: 'validated', executionAvailable: false }, meta }`，`Cache-Control: no-store`。服务端只接受本地 Vanilla / 已知版本；UUID 为后端生成，不接受目标路径。201 不代表导入、停服或世界切换授权。

恢复/实例操作冲突返回 409；超大 413；类型或编码错误 415；接收超时 408；容量不足或全局三份保留目录已满 507。失败和中断也占配额，重启不清零，没有自动清理或重试；不确定响应可能留下私有上传，请先检查。当前已实现暂存列表与明确丢弃 API；实际 import API 与消费时内容/版本/revision 重验已实现，详见末节；自动过期清理未实现。更宽的通用未来 ZIP 限额不适用于此已实现接口。

### P3.3c 暂存生命周期协议（2026-10-02）

`GET /api/v1/servers/:serverId/worlds/import-uploads` 返回 `{ data: { items: [{ id, state: 'validated' | 'incomplete' | 'identity-unverified' | 'consumed', discardAllowed, revision, importOperationId? }], occupiedSlots, limit: 3 }, meta }`，`Cache-Control: no-store`。items 仅当前注册实例，occupiedSlots 为全部实例/残留目录的占用；空列表不代表全局配额为空。validated 是上传完成标记，不证明未来导入所需的内容重验已通过。

`POST /api/v1/servers/:serverId/worlds/import-uploads/:uploadId/discard` 为严格 JSON `{ confirmUploadId: string, revision: string }`，要求正常 JSON 写门控；确认 UUID 必须等于 URL ID，revision 必须匹配持久化归属与目录身份。200 `{ data: { id, state: 'discarded' }, meta }` 代表私有暂存目录已移除，当前世界不受影响。多余/路径字段、错误确认拒绝；跨实例或不存在记录 404，身份/归属/写锁/恢复冲突 409，且不自动绕过。

新上传绑定注册根目录和暂存目录身份；缺少绑定的旧上传不自动迁移或丢弃。丢弃前完整验证普通目录/文件和无硬链接，先原子发布并同步私有树外归属凭证，逐文件 unlink、逐目录非递归 rmdir。owner 已移除而最后 rmdir 失败时，凭证仅在根及暂存身份匹配时允许用户明确重试，不自动清理。没有归属/凭证的孤立目录、损坏记录保持人工检查。receipt 临时文件不是授权凭证，残留旧凭证不能授权删除被替换的目录。

丢弃客户端等待上限 120 秒；超时或未知响应时不要自动重试，稍后刷新记录确认。没有记录表示目录槽位已释放；服务端仍有活动清理时刷新可能返回 409。该暂存协议本身不执行实际 Import，也不替代其 journal、guard 或最终 Gate。

### P3.3c 实际导入与显式恢复协议（2026-10-03，验收进行中）

以下路径均带 `/api/v1/servers/:serverId` 前缀；POST 要求本地 Host / Origin、`X-Manager-Intent: local-ui` 和严格 JSON，不接受路径或额外字段。

- `POST /worlds/import-plan`：`{ uploadId, name }`，200 返回 serverId、uploadId、name、uploadRevision、minecraftVersion、currentWorldName、worldRevision、requiresStop、fileCount、sizeBytes、checksumSha256、executionAvailable。只读预检不切换。uploadRevision 绑定归属、内容摘要和版本，不能使用列表的丢弃 revision 替代。
- `POST /worlds/import`：`{ uploadId, name, uploadRevision, worldRevision, confirmWorldName, allowStop }`，要求 UUID `Idempotency-Key`，202 返回生命周期 operation。重验源内容、版本和活动世界 revision；必要停服必须明确授权。pinned guard、同卷 staging、切换 journal 均保留，成功后保持停服。
- `POST /worlds/import-recovery-plan`：`{ operationId }`，200 返回 serverId、operationId、previousWorldName、importedWorldName、recoveryRevision、executionAvailable、preservesAllTrees。仅核验拥有当前恢复锁的导入事务，不绕过其他恢复锁。
- `POST /worlds/import-recovery`：`{ operationId, confirmWorldName, recoveryRevision }`，要求新的 UUID `Idempotency-Key`，202 返回 operation。明确恢复旧配置与活动世界记录，所有世界树、上传与 guard 保留，不自动启动。

### 2026-10-04 World Archive当前契约

`POST /api/v1/servers/:serverId/worlds/archive` 严格JSON请求：

```json
{
  "worldId": "world-0123456789abcdef01234567",
  "confirmWorldName": "world",
  "worldRevision": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "intent": "archive-world-set",
  "allowStop": false
}
```

要求正常JSON写门控和UUID v4 Idempotency-Key。202返回生命周期envelope，operation.kind=world-archive，result.resourceId为archive ID，rollbackAvailable=false。确认仅active且安全Vanilla完整world-set；拒绝所有路径/额外字段、隐式类型转换、不符ID/名称/revision、未知/外部进程、分离维度及recovery。运行中allowStop=false返回409 SERVER_MUST_BE_STOPPED；未经确认不停止。成功完整guard/rename/none之后仍stopped；API没有自动rollback、archive restore/delete或none激活入口。

`GET /api/v1/servers/:serverId/worlds/archives` 返回 `{ data: { items: [{ id, operationId, worldId, name, createdAt, guardBackupId, minecraftVersion, fileCount, sizeBytes, checksumSha256 }] }, meta }`，Cache-Control:no-store。仅committed且实际root/archive/guard/receipt核验通过的条目；核验失败409 RECOVERY_REQUIRED且保留全部数据，不返回路径/配置。World inventory在verified none时items=[]。Start/Restart admission和executor返回409 NO_ACTIVE_WORLD，readiness.reason同名；Manager重启后继续拒绝，防止旧level-name生成空世界。历史confirmed archive仍核验不变归档/root，不用旧hash永久锁定合法后继active世界。完整范围/真实Gate见 [Archive报告](./P33_ARCHIVE_2026-10-04.md)。

消费后的暂存列表 state 为 `consumed`，discardAllowed 为 false，可附 importOperationId 供人工检查显式恢复；即使消费标记丢失，持久 journal 引用仍阻止丢弃。缺少已验证 guard / 配置副本的早期中断保持人工恢复锁，不自动猜测或清理。不确定写请求仅允许用户明确使用原 body/key 确认，不自动重试。

上述接口已实现；完整 Import 真实验收与独立最终 Gate 尚未全部完成，不代表 P3.3c PASS。
