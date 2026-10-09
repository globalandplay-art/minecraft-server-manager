import { type Static, Type, type TSchema } from "@sinclair/typebox";

const strictObject = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

export const modeSchema = Type.Union([Type.Literal("mock"), Type.Literal("local")]);
export type Mode = Static<typeof modeSchema>;

export const timestampSchema = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$"
});

export const featureStateSchema = strictObject({
  implemented: Type.Boolean(),
  phase: Type.Integer({ minimum: 1, maximum: 7 })
});
export type FeatureState = Static<typeof featureStateSchema>;

export const featuresSchema = strictObject({
  dashboard: featureStateSchema,
  servers: featureStateSchema,
  lifecycle: featureStateSchema,
  console: featureStateSchema,
  worlds: featureStateSchema,
  backups: featureStateSchema,
  players: featureStateSchema,
  properties: featureStateSchema,
  addons: featureStateSchema,
  performance: featureStateSchema,
  crashAnalysis: featureStateSchema,
  remoteAccess: featureStateSchema
});
export type Features = Static<typeof featuresSchema>;

export const serverTypeSchema = Type.Union([
  Type.Literal("vanilla"),
  Type.Literal("paper"),
  Type.Literal("spigot"),
  Type.Literal("purpur"),
  Type.Literal("fabric"),
  Type.Literal("forge"),
  Type.Literal("neoforge"),
  Type.Literal("unknown")
]);
export type ServerType = Static<typeof serverTypeSchema>;

export const serverInfoSchema = strictObject({
  id: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,62})$" }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  type: serverTypeSchema,
  minecraftVersion: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  java: strictObject({
    runtimeVersion: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    requiredMajor: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
  }),
  detection: strictObject({
    confidence: Type.Union([
      Type.Literal("high"),
      Type.Literal("medium"),
      Type.Literal("low")
    ]),
    evidence: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 32 }),
    warnings: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 32 })
  })
});
export type ServerInfo = Static<typeof serverInfoSchema>;

export const capabilitiesSchema = strictObject({
  mods: Type.Boolean(),
  plugins: Type.Boolean(),
  rcon: Type.Boolean(),
  console: Type.Boolean(),
  backup: Type.Boolean(),
  worlds: Type.Boolean(),
  properties: Type.Boolean()
});
export type Capabilities = Static<typeof capabilitiesSchema>;

export const actionAvailabilitySchema = Type.Union([
  strictObject({ allowed: Type.Literal(true), reason: Type.Null() }),
  strictObject({
    allowed: Type.Literal(false),
    reason: Type.String({ minLength: 1, maxLength: 128 })
  })
]);
export type ActionAvailability = Static<typeof actionAvailabilitySchema>;

export const readinessSchema = strictObject({
  start: actionAvailabilitySchema,
  stop: actionAvailabilitySchema,
  restart: actionAvailabilitySchema,
  commands: actionAvailabilitySchema,
  backup: actionAvailabilitySchema,
  restore: actionAvailabilitySchema,
  worldChanges: actionAvailabilitySchema,
  addonChanges: actionAvailabilitySchema,
  propertiesChanges: actionAvailabilitySchema,
  commandTransport: Type.Union([
    Type.Literal("rcon"),
    Type.Literal("stdin"),
    Type.Literal("unavailable")
  ])
});
export type Readiness = Static<typeof readinessSchema>;

export const serverStatusSchema = strictObject({
  state: Type.Union([
    Type.Literal("stopped"),
    Type.Literal("starting"),
    Type.Literal("running"),
    Type.Literal("stopping"),
    Type.Literal("crashed"),
    Type.Literal("unknown")
  ]),
  ownership: Type.Union([
    Type.Literal("managed"),
    Type.Literal("external"),
    Type.Literal("none"),
    Type.Literal("unknown")
  ]),
  source: Type.Union([
    Type.Literal("mock"),
    Type.Literal("process"),
    Type.Literal("status-query")
  ]),
  observedAt: timestampSchema,
  activeOperationId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  recoveryRequired: Type.Boolean()
});
export type ServerStatus = Static<typeof serverStatusSchema>;

export const serverSummarySchema = strictObject({
  server: serverInfoSchema,
  capabilities: capabilitiesSchema,
  status: serverStatusSchema,
  readiness: readinessSchema
});
export type ServerSummary = Static<typeof serverSummarySchema>;

export const metricSourceSchema = Type.Union([
  Type.Literal("mock"),
  Type.Literal("process"),
  Type.Literal("filesystem"),
  Type.Literal("status-query"),
  Type.Literal("rcon"),
  Type.Literal("log"),
  Type.Literal("plugin"),
  Type.Literal("jmx")
]);
export type MetricSource = Static<typeof metricSourceSchema>;

const metric = <T extends TSchema>(value: T) =>
  Type.Union([
    strictObject({
      status: Type.Literal("available"),
      value,
      source: metricSourceSchema,
      sampledAt: timestampSchema
    }),
    strictObject({
      status: Type.Literal("unavailable"),
      value: Type.Null(),
      source: Type.Null(),
      sampledAt: Type.Null(),
      reason: Type.String({ minLength: 1, maxLength: 128 })
    }),
    strictObject({
      status: Type.Literal("stale"),
      value,
      source: metricSourceSchema,
      sampledAt: timestampSchema,
      reason: Type.String({ minLength: 1, maxLength: 128 })
    })
  ]);

export const playersMetricSchema = metric(strictObject({
  online: Type.Integer({ minimum: 0 }),
  max: Type.Integer({ minimum: 0 })
}));
export const numberMetricSchema = metric(Type.Number({ minimum: 0 }));
export const cpuMetricSchema = metric(Type.Number({ minimum: 0, maximum: 100 }));
export const ramMetricSchema = metric(strictObject({
  rssBytes: Type.Integer({ minimum: 0 })
}));
export const diskMetricSchema = metric(strictObject({
  totalBytes: Type.Integer({ minimum: 0 }),
  freeBytes: Type.Integer({ minimum: 0 }),
  usedBytes: Type.Integer({ minimum: 0 })
}));
export const uptimeMetricSchema = metric(Type.Integer({ minimum: 0 }));

export const metricsSchema = strictObject({
  players: playersMetricSchema,
  tps: numberMetricSchema,
  mspt: numberMetricSchema,
  cpu: cpuMetricSchema,
  ram: ramMetricSchema,
  disk: diskMetricSchema,
  uptime: uptimeMetricSchema
});
export type Metrics = Static<typeof metricsSchema>;


export const worldFieldSourceSchema = Type.Union([
  Type.Literal("level-dat"),
  Type.Literal("world-data"),
  Type.Literal("server-properties"),
  Type.Literal("filesystem"),
  Type.Null()
]);
export type WorldFieldSource = Static<typeof worldFieldSourceSchema>;

export const worldDimensionSchema = strictObject({
  id: Type.String({
    minLength: 1,
    maxLength: 256,
    pattern: "^[a-z0-9_.-]+:[a-z0-9_./-]+$"
  }),
  kind: Type.Union([
    Type.Literal("overworld"),
    Type.Literal("nether"),
    Type.Literal("end"),
    Type.Literal("custom")
  ])
});
export type WorldDimension = Static<typeof worldDimensionSchema>;

const worldBooleanMetric = metric(Type.Boolean());
const worldIntegerMetric = metric(Type.Integer({ minimum: 0 }));

export const worldInfoSchema = strictObject({
  worldId: Type.String({ minLength: 1, maxLength: 128, pattern: "^[a-z0-9-]+$" }),
  worldRevision: Type.Optional(Type.Union([Type.String({ pattern: "^[0-9a-f]{64}$" }), Type.Null()])),
  active: Type.Boolean(),
  dimensions: Type.Array(worldDimensionSchema, { minItems: 1, maxItems: 256 }),
  name: metric(Type.String({ minLength: 1, maxLength: 128 })),
  seed: metric(Type.String({
    minLength: 1,
    maxLength: 20,
    pattern: "^-?(?:0|[1-9][0-9]{0,18})$"
  })),
  minecraftVersion: metric(Type.String({ minLength: 1, maxLength: 64 })),
  sizeBytes: worldIntegerMetric,
  difficulty: metric(Type.Union([
    Type.Literal("peaceful"),
    Type.Literal("easy"),
    Type.Literal("normal"),
    Type.Literal("hard")
  ])),
  gameMode: metric(Type.Union([
    Type.Literal("survival"),
    Type.Literal("creative"),
    Type.Literal("adventure"),
    Type.Literal("spectator")
  ])),
  hardcore: worldBooleanMetric,
  pvp: worldBooleanMetric,
  viewDistance: worldIntegerMetric,
  simulationDistance: worldIntegerMetric,
  fieldSources: strictObject({
    name: worldFieldSourceSchema,
    seed: worldFieldSourceSchema,
    minecraftVersion: worldFieldSourceSchema,
    sizeBytes: worldFieldSourceSchema,
    difficulty: worldFieldSourceSchema,
    gameMode: worldFieldSourceSchema,
    hardcore: worldFieldSourceSchema,
    pvp: worldFieldSourceSchema,
    viewDistance: worldFieldSourceSchema,
    simulationDistance: worldFieldSourceSchema
  })
});
export type WorldInfo = Static<typeof worldInfoSchema>;

export const activitySchema = strictObject({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  occurredAt: timestampSchema,
  kind: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error")]),
  message: Type.String({ minLength: 1, maxLength: 512 }),
  operationId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()])
});
export type Activity = Static<typeof activitySchema>;

export const alertSchema = strictObject({
  code: Type.String({ minLength: 1, maxLength: 128 }),
  message: Type.String({ minLength: 1, maxLength: 512 })
});
export type Alert = Static<typeof alertSchema>;

export const overviewSchema = strictObject({
  summary: serverSummarySchema,
  metrics: metricsSchema,
  activity: Type.Array(activitySchema, { maxItems: 20 }),
  alerts: Type.Array(alertSchema, { maxItems: 20 })
});
export type Overview = Static<typeof overviewSchema>;

export const responseMetaSchema = strictObject({
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  generatedAt: timestampSchema,
  mode: modeSchema
});
export type ResponseMeta = Static<typeof responseMetaSchema>;

export const playerSchema = strictObject({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  uuid: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  name: Type.String({ pattern: "^[A-Za-z0-9_]{1,16}$" }),
  online: Type.Boolean()
});
export type Player = Static<typeof playerSchema>;
export const playersDataSchema = Type.Union([
  strictObject({ availability: Type.Literal("available"), completeness: Type.Literal("full"),
    items: Type.Array(playerSchema, { maxItems: 10000 }), sampledAt: timestampSchema, reason: Type.Null() }),
  strictObject({ availability: Type.Literal("unavailable"), completeness: Type.Literal("unknown"),
    items: Type.Array(playerSchema, { maxItems: 0 }), sampledAt: Type.Null(), reason: Type.String({ minLength: 1, maxLength: 128 }) })
]);
export const playersResponseSchema = strictObject({ data: playersDataSchema, meta: responseMetaSchema });
export type PlayersData = Static<typeof playersDataSchema>;
export type PlayersResponse = Static<typeof playersResponseSchema>;

export const healthDataSchema = strictObject({
  status: Type.Literal("ok"),
  apiVersion: Type.Literal("1"),
  features: featuresSchema
});
export type HealthData = Static<typeof healthDataSchema>;

export const healthResponseSchema = strictObject({
  data: healthDataSchema,
  meta: responseMetaSchema
});
export type HealthResponse = Static<typeof healthResponseSchema>;

export const serversResponseSchema = strictObject({
  data: strictObject({ items: Type.Array(serverSummarySchema) }),
  meta: responseMetaSchema
});
export type ServersResponse = Static<typeof serversResponseSchema>;

export const serverResponseSchema = strictObject({
  data: serverSummarySchema,
  meta: responseMetaSchema
});
export type ServerResponse = Static<typeof serverResponseSchema>;

export const overviewResponseSchema = strictObject({
  data: overviewSchema,
  meta: responseMetaSchema
});
export type OverviewResponse = Static<typeof overviewResponseSchema>;

export const worldsResponseSchema = strictObject({
  data: strictObject({ items: Type.Array(worldInfoSchema, { maxItems: 1000 }) }),
  meta: responseMetaSchema
});
export type WorldsResponse = Static<typeof worldsResponseSchema>;

export const worldArchiveRequestSchema = strictObject({
  worldId: Type.String({ pattern: "^world-[a-f0-9]{24}$" }),
  confirmWorldName: Type.String({ minLength: 1, maxLength: 128 }),
  worldRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  intent: Type.Literal("archive-world-set"),
  allowStop: Type.Boolean()
});
export type WorldArchiveRequest = Static<typeof worldArchiveRequestSchema>;
export const worldArchiveInfoSchema = strictObject({
  id: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
  operationId: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
  worldId: Type.String({ pattern: "^world-[a-f0-9]{24}$" }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  createdAt: timestampSchema,
  guardBackupId: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
  minecraftVersion: Type.String({ minLength: 1, maxLength: 64 }),
  fileCount: Type.Integer({ minimum: 1 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  checksumSha256: Type.String({ pattern: "^[a-f0-9]{64}$" })
});
export type WorldArchiveInfo = Static<typeof worldArchiveInfoSchema>;
export const worldArchivesResponseSchema = strictObject({
  data: strictObject({ items: Type.Array(worldArchiveInfoSchema, { maxItems: 1000 }) }),
  meta: responseMetaSchema
});
export type WorldArchivesResponse = Static<typeof worldArchivesResponseSchema>;

export const worldCreatePlanRequestSchema = strictObject({
  name: Type.String({ minLength: 1, maxLength: 64 }),
  seed: Type.String({ maxLength: 20, pattern: "^(?:|-?(?:0|[1-9][0-9]*))$" })
});
export type WorldCreatePlanRequest = Static<typeof worldCreatePlanRequestSchema>;
export const worldCreateRequestSchema = strictObject({
  ...worldCreatePlanRequestSchema.properties,
  confirmWorldName: Type.String({ minLength: 1, maxLength: 128 }),
  worldRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  allowStop: Type.Boolean()
});
export type WorldCreateRequest = Static<typeof worldCreateRequestSchema>;
export const worldCreatePlanResponseSchema = strictObject({
  data: strictObject({
    serverId: serverInfoSchema.properties.id,
    name: Type.String({ minLength: 1, maxLength: 64 }),
    seed: Type.Union([Type.String({ maxLength: 20 }), Type.Null()]),
    minecraftVersion: Type.String({ minLength: 1, maxLength: 64 }),
    currentWorldName: Type.String({ minLength: 1, maxLength: 128 }),
    worldRevision: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
    requiresStop: Type.Boolean(),
    generation: Type.Literal("on-explicit-start"),
    executionAvailable: Type.Boolean()
  }),
  meta: responseMetaSchema
});
export type WorldCreatePlanResponse = Static<typeof worldCreatePlanResponseSchema>;

export const backupScopeSchema = Type.Union([Type.Literal("world-set"), Type.Literal("server-snapshot")]);
export type BackupScope = Static<typeof backupScopeSchema>;
export const backupInfoSchema = strictObject({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  serverId: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,62})$" }),
  scope: backupScopeSchema,
  kind: Type.Union([Type.Literal("manual"), Type.Literal("auto"), Type.Literal("snapshot")]),
  label: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  state: Type.Literal("complete"),
  pinned: Type.Boolean(),
  createdAt: timestampSchema,
  minecraftVersion: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  serverType: serverTypeSchema,
  includedRoots: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 64 }),
  fileCount: Type.Integer({ minimum: 1 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  checksumSha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  wasRunning: Type.Boolean(),
  restarted: Type.Boolean(),
  downtimeMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
});
export type BackupInfo = Static<typeof backupInfoSchema>;

export const backupCreateRequestSchema = strictObject({
  scope: backupScopeSchema,
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  allowStop: Type.Boolean()
});
export type BackupCreateRequest = Static<typeof backupCreateRequestSchema>;

export const backupScheduleSettingsSchema = strictObject({
  enabled: Type.Boolean(),
  localTime: Type.String({ pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" }),
  timezone: Type.String({ minLength: 1, maxLength: 64 }),
  allowStop: Type.Boolean()
});
export type BackupScheduleSettings = Static<typeof backupScheduleSettingsSchema>;
export const backupScheduleUpdateSchema = strictObject({
  revision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  settings: backupScheduleSettingsSchema
});
export type BackupScheduleUpdate = Static<typeof backupScheduleUpdateSchema>;
export const backupScheduleRunSchema = strictObject({
  id: Type.String({ pattern: "^[a-f0-9-]{36}$" }),
  localDate: Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
  timezone: Type.String({ minLength: 1, maxLength: 64 }),
  localTime: Type.String({ pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" }),
  claimedAt: timestampSchema,
  operationId: Type.Union([Type.String({ pattern: "^[a-f0-9-]{36}$" }), Type.Null()]),
  state: Type.Union([Type.Literal("claimed"), Type.Literal("submitted"), Type.Literal("succeeded"), Type.Literal("failed"), Type.Literal("skipped"), Type.Literal("interrupted")]),
  code: Type.Union([Type.String({ maxLength: 128 }), Type.Null()])
});
export type BackupScheduleRun = Static<typeof backupScheduleRunSchema>;
export const backupScheduleResponseSchema = strictObject({
  data: strictObject({ revision: Type.String({ pattern: "^[a-f0-9]{64}$" }), settings: backupScheduleSettingsSchema,
    runs: Type.Array(backupScheduleRunSchema, { maxItems: 30 }) }),
  meta: responseMetaSchema
});
export type BackupScheduleResponse = Static<typeof backupScheduleResponseSchema>;

export const backupRetentionSettingsSchema = strictObject({ enabled: Type.Boolean(),
  retainCount: Type.Integer({ minimum: 1, maximum: 100 }), retainDays: Type.Integer({ minimum: 1, maximum: 365 }) });
export type BackupRetentionSettings = Static<typeof backupRetentionSettingsSchema>;
export const backupRetentionUpdateSchema = strictObject({ revision: Type.String({ pattern: "^[a-f0-9]{64}$" }), settings: backupRetentionSettingsSchema });
export type BackupRetentionUpdate = Static<typeof backupRetentionUpdateSchema>;
export const backupRetentionRunRequestSchema = strictObject({ revision: Type.String({ pattern: "^[a-f0-9]{64}$" }), intent: Type.Literal("apply-backup-retention") });
export type BackupRetentionRunRequest = Static<typeof backupRetentionRunRequestSchema>;
export const backupRetentionResultSchema = strictObject({ completedAt: timestampSchema,
  state: Type.Union([Type.Literal("completed"), Type.Literal("blocked"), Type.Literal("partial")]),
  code: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  removed: Type.Array(Type.String({ pattern: "^[a-f0-9-]{36}$" }), { maxItems: 1000 }),
  retained: Type.Array(strictObject({ id: Type.String({ maxLength: 128 }), reason: Type.String({ maxLength: 128 }) }), { maxItems: 1000 }) });
export type BackupRetentionResult = Static<typeof backupRetentionResultSchema>;
export const backupRetentionResponseSchema = strictObject({ data: strictObject({ revision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  settings: backupRetentionSettingsSchema, lastRun: Type.Union([backupRetentionResultSchema, Type.Null()]) }), meta: responseMetaSchema });
export type BackupRetentionResponse = Static<typeof backupRetentionResponseSchema>;

export const backupsResponseSchema = strictObject({
  data: strictObject({ items: Type.Array(backupInfoSchema, { maxItems: 1000 }), nextCursor: Type.Null() }),
  meta: responseMetaSchema
});
export type BackupsResponse = Static<typeof backupsResponseSchema>;

export const backupParamsSchema = strictObject({
  serverId: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,62})$" }),
  backupId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" })
});
export type BackupParams = Static<typeof backupParamsSchema>;
export const restoreRequestSchema = strictObject({
  restoreScope: Type.Literal("world-set"),
  confirmWorldName: Type.String({ minLength: 1, maxLength: 128 }),
  worldRevision: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  allowStop: Type.Literal(true),
  startAfterRestore: Type.Boolean()
});
export type RestoreRequest = Static<typeof restoreRequestSchema>;
export const rollbackRequestSchema = strictObject({
  confirmWorldName: Type.String({ minLength: 1, maxLength: 128 }),
  worldRevision: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  startAfterRollback: Type.Boolean()
});
export type RollbackRequest = Static<typeof rollbackRequestSchema>;
export const restorePlanSchema = strictObject({
  worldName: Type.String({ minLength: 1, maxLength: 128 }),
  worldRevision: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  backupId: Type.String({ minLength: 1, maxLength: 128 }),
  minecraftVersion: Type.String({ minLength: 1, maxLength: 64 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  rollbackAvailable: Type.Boolean()
});
export const restorePlanResponseSchema = strictObject({ data: restorePlanSchema, meta: responseMetaSchema });
export type RestorePlanResponse = Static<typeof restorePlanResponseSchema>;
export const restoreHistoryResponseSchema = strictObject({
  data: strictObject({ items: Type.Array(strictObject({ operationId: Type.String({ minLength: 1, maxLength: 128 }), backupId: Type.String({ minLength: 1, maxLength: 128 }),
    state: Type.String({ minLength: 1, maxLength: 32 }), rollbackAvailable: Type.Boolean() }), { maxItems: 1000 }) }), meta: responseMetaSchema
});
export type RestoreHistoryResponse = Static<typeof restoreHistoryResponseSchema>;
export const backupExportResponseSchema = strictObject({
  data: strictObject({
    backupId: Type.String({ minLength: 1, maxLength: 128 }),
    state: Type.Union([Type.Literal("available"), Type.Literal("ready")]),
    sizeBytes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    checksumSha256: Type.Union([Type.String({ pattern: "^[0-9a-f]{64}$" }), Type.Null()])
  }),
  meta: responseMetaSchema
});
export type BackupExportResponse = Static<typeof backupExportResponseSchema>;

export const errorDetailsSchema = strictObject({
  fieldErrors: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 256 }))
});

export const apiErrorResponseSchema = strictObject({
  error: strictObject({
    code: Type.String({ minLength: 1, maxLength: 128 }),
    message: Type.String({ minLength: 1, maxLength: 512 }),
    details: Type.Optional(errorDetailsSchema)
  }),
  meta: responseMetaSchema
});
export type ApiErrorResponse = Static<typeof apiErrorResponseSchema>;

export const serverParamsSchema = strictObject({
  serverId: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,62})$" })
});
export type ServerParams = Static<typeof serverParamsSchema>;

export const operationKindSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("stop"),
  Type.Literal("restart"),
  Type.Literal("backup"),
  Type.Literal("backup-export"),
  Type.Literal("restore"),
  Type.Literal("rollback"),
  Type.Literal("world-create"),
  Type.Literal("world-import"),
  Type.Literal("world-import-recovery"),
  Type.Literal("world-archive"),
  Type.Literal("properties-write"),
  Type.Literal("addon-change")
]);
export type OperationKind = Static<typeof operationKindSchema>;

export const operationSchema = strictObject({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  serverId: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,62})$" }),
  kind: operationKindSchema,
  state: Type.Union([
    Type.Literal("queued"),
    Type.Literal("running"),
    Type.Literal("succeeded"),
    Type.Literal("failed"),
    Type.Literal("interrupted")
  ]),
  step: Type.String({ minLength: 1, maxLength: 128 }),
  progress: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  result: Type.Union([
    strictObject({
      resourceId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
      rollbackAvailable: Type.Boolean(),
      restartRequired: Type.Optional(Type.Boolean())
    }),
    Type.Null()
  ]),
  error: Type.Union([
    strictObject({
      code: Type.String({ minLength: 1, maxLength: 128 }),
      message: Type.String({ minLength: 1, maxLength: 512 })
    }),
    Type.Null()
  ])
});
export type Operation = Static<typeof operationSchema>;

export const logEntrySchema = strictObject({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  cursor: Type.String({ minLength: 1, maxLength: 256 }),
  timestamp: Type.Union([timestampSchema, Type.Null()]),
  level: Type.Union([
    Type.Literal("debug"),
    Type.Literal("info"),
    Type.Literal("warn"),
    Type.Literal("error"),
    Type.Literal("unknown")
  ]),
  text: Type.String({ maxLength: 8192 }),
  source: Type.Union([Type.Literal("latest.log"), Type.Literal("stderr")])
});
export type LogEntry = Static<typeof logEntrySchema>;

export const emptyRequestSchema = strictObject({});
export type EmptyRequest = Static<typeof emptyRequestSchema>;

export const commandRequestSchema = strictObject({
  command: Type.String({ minLength: 1, maxLength: 1024 })
});
export type CommandRequest = Static<typeof commandRequestSchema>;

export const lifecycleActionResponseSchema = strictObject({
  data: strictObject({ operation: operationSchema }),
  meta: responseMetaSchema
});
export type LifecycleActionResponse = Static<typeof lifecycleActionResponseSchema>;

const safePropertyKeys = ["max-players", "difficulty", "gamemode", "pvp", "online-mode", "view-distance", "simulation-distance", "motd"] as const;
export const propertiesResponseSchema = strictObject({ data: strictObject({
  fields: strictObject(Object.fromEntries(safePropertyKeys.map((key) => [key, Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])]))),
  revision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  fieldRules: strictObject(Object.fromEntries(safePropertyKeys.map((key) => [key, strictObject({
    editable: Type.Boolean(), restartRequired: Type.Boolean(), reason: Type.Union([Type.String(), Type.Null()])
  })])))
}), meta: responseMetaSchema });
export const propertiesWriteRequestSchema = strictObject({
  changes: Type.Object(Object.fromEntries(safePropertyKeys.filter((key) => key !== "view-distance" && key !== "simulation-distance")
    .map((key) => [key, Type.Optional(Type.String({ maxLength: 1024 }))])), { additionalProperties: false, minProperties: 1, maxProperties: 6 }),
  confirmOfflineIdentity: Type.Boolean()
});
export type PropertiesWriteRequest = Static<typeof propertiesWriteRequestSchema>;
export const propertiesWriteResponseSchema = strictObject({ data: strictObject({
  operation: operationSchema, restartRequired: Type.Literal(true), restartFields: Type.Array(Type.String(), { minItems: 1, maxItems: 6 })
}), meta: responseMetaSchema });
export type PropertiesResponse = Static<typeof propertiesResponseSchema>;
export type PropertiesWriteResponse = Static<typeof propertiesWriteResponseSchema>;

export const operationResponseSchema = strictObject({
  data: operationSchema,
  meta: responseMetaSchema
});
export type OperationResponse = Static<typeof operationResponseSchema>;

export const logsResponseSchema = strictObject({
  data: strictObject({
    items: Type.Array(logEntrySchema, { maxItems: 500 }),
    nextCursor: Type.String({ maxLength: 256 }),
    truncated: Type.Boolean()
  }),
  meta: responseMetaSchema
});
export type LogsResponse = Static<typeof logsResponseSchema>;

export const commandResponseSchema = strictObject({
  data: strictObject({
    status: Type.Union([Type.Literal("executed"), Type.Literal("submitted")]),
    transport: Type.Union([Type.Literal("rcon"), Type.Literal("stdin")]),
    output: Type.Union([Type.String({ maxLength: 65536 }), Type.Null()])
  }),
  meta: responseMetaSchema
});
export type CommandResponse = Static<typeof commandResponseSchema>;

export const operationParamsSchema = strictObject({
  operationId: Type.String({ minLength: 1, maxLength: 128 })
});
export type OperationParams = Static<typeof operationParamsSchema>;

export const logsQuerySchema = strictObject({
  after: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 200 }))
});
export type LogsQuery = Static<typeof logsQuerySchema>;

export const wsQuerySchema = strictObject({
  streamId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  afterSequence: Type.Optional(Type.Integer({ minimum: 0 }))
});
export type WsQuery = Static<typeof wsQuerySchema>;

export const wsHelloMessageSchema = strictObject({
  type: Type.Literal("hello"),
  streamId: Type.String({ minLength: 1, maxLength: 128 }),
  latestSequence: Type.Integer({ minimum: 0 })
});
export const wsSnapshotMessageSchema = strictObject({
  type: Type.Literal("snapshot"),
  sequence: Type.Integer({ minimum: 0 }),
  status: serverStatusSchema,
  logs: Type.Array(logEntrySchema, { maxItems: 2000 })
});
export const wsLogMessageSchema = strictObject({
  type: Type.Literal("log"),
  sequence: Type.Integer({ minimum: 1 }),
  entry: logEntrySchema
});
export const wsStatusMessageSchema = strictObject({
  type: Type.Literal("status"),
  sequence: Type.Integer({ minimum: 1 }),
  status: serverStatusSchema
});
export const wsOperationMessageSchema = strictObject({
  type: Type.Literal("operation"),
  sequence: Type.Integer({ minimum: 1 }),
  operation: operationSchema
});
export const wsGapMessageSchema = strictObject({
  type: Type.Literal("gap"),
  sequence: Type.Integer({ minimum: 0 }),
  reason: Type.String({ minLength: 1, maxLength: 256 })
});
export const wsMessageSchema = Type.Union([
  wsHelloMessageSchema,
  wsSnapshotMessageSchema,
  wsLogMessageSchema,
  wsStatusMessageSchema,
  wsOperationMessageSchema,
  wsGapMessageSchema
]);
export type WsMessage = Static<typeof wsMessageSchema>;

export const worldImportUploadResponseSchema = strictObject({
  data: strictObject({
    id: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }), serverId: Type.String({ minLength: 1, maxLength: 63 }),
    minecraftVersion: Type.String({ minLength: 1, maxLength: 128 }),
    fileCount: Type.Integer({ minimum: 1, maximum: 10_000 }),
    sizeBytes: Type.Integer({ minimum: 1, maximum: 512 * 1024 ** 2 }),
    checksumSha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    state: Type.Literal("validated"), executionAvailable: Type.Literal(false)
  }), meta: responseMetaSchema
});
export type WorldImportUploadResponse = Static<typeof worldImportUploadResponseSchema>;

const uploadIdSchema = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" });
export const worldImportUploadParamsSchema = strictObject({ serverId: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{0,62})$" }), uploadId: uploadIdSchema });
export const worldImportUploadsResponseSchema = strictObject({ data: strictObject({
  items: Type.Array(strictObject({ id: uploadIdSchema,
    state: Type.Union([Type.Literal("validated"), Type.Literal("incomplete"), Type.Literal("identity-unverified"), Type.Literal("consumed")]),
    discardAllowed: Type.Boolean(), revision: Type.String({ pattern: "^[0-9a-f]{64}$" }), importOperationId: Type.Optional(uploadIdSchema),
    lifecycle: Type.Optional(Type.Union([Type.Literal("receiving"), Type.Literal("failed"), Type.Literal("validated"), Type.Literal("discard-pending"), Type.Literal("requires-inspection")])),
    expiresAt: Type.Optional(Type.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{3}Z$" }))
  }), { maxItems: 3 }), occupiedSlots: Type.Integer({ minimum: 0, maximum: 3 }), limit: Type.Literal(3)
}), meta: responseMetaSchema });
export type WorldImportUploadsResponse = Static<typeof worldImportUploadsResponseSchema>;
export const worldImportDiscardRequestSchema = strictObject({ confirmUploadId: uploadIdSchema, revision: Type.String({ pattern: "^[0-9a-f]{64}$" }) });
export type WorldImportDiscardRequest = Static<typeof worldImportDiscardRequestSchema>;
export const worldImportDiscardResponseSchema = strictObject({ data: strictObject({ id: uploadIdSchema, state: Type.Literal("discarded") }), meta: responseMetaSchema });
export type WorldImportDiscardResponse = Static<typeof worldImportDiscardResponseSchema>;
export const worldImportCleanupRequestSchema = strictObject({ intent: Type.Literal("cleanup-expired-unclaimed") });
export const worldImportCleanupResponseSchema = strictObject({ data: strictObject({
  removed: Type.Array(uploadIdSchema, { maxItems: 3 }),
  retained: Type.Array(strictObject({ id: uploadIdSchema, reason: Type.Union([
    Type.Literal("not-expired"), Type.Literal("requires-inspection"), Type.Literal("referenced"), Type.Literal("discard-pending"), Type.Literal("cleanup-failed")
  ]) }), { maxItems: 3 })
}), meta: responseMetaSchema });
export type WorldImportCleanupResponse = Static<typeof worldImportCleanupResponseSchema>;

const importRevisionSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const worldImportPlanRequestSchema = strictObject({ uploadId: uploadIdSchema, name: Type.String({ minLength: 1, maxLength: 64 }) });
export type WorldImportPlanRequest = Static<typeof worldImportPlanRequestSchema>;
export const worldImportRequestSchema = strictObject({ ...worldImportPlanRequestSchema.properties,
  uploadRevision: importRevisionSchema, worldRevision: importRevisionSchema,
  confirmWorldName: Type.String({ minLength: 1, maxLength: 128 }), allowStop: Type.Boolean() });
export type WorldImportRequest = Static<typeof worldImportRequestSchema>;
export const worldImportPlanResponseSchema = strictObject({ data: strictObject({
  ...worldImportPlanRequestSchema.properties, serverId: Type.String(), uploadRevision: importRevisionSchema,
  minecraftVersion: Type.String(), currentWorldName: Type.String(), worldRevision: importRevisionSchema,
  requiresStop: Type.Boolean(), fileCount: Type.Integer(), sizeBytes: Type.Integer(), checksumSha256: importRevisionSchema,
  executionAvailable: Type.Literal(true)
}), meta: responseMetaSchema });
export type WorldImportPlanResponse = Static<typeof worldImportPlanResponseSchema>;
export const worldImportRecoveryPlanRequestSchema = strictObject({ operationId: uploadIdSchema });
export type WorldImportRecoveryPlanRequest = Static<typeof worldImportRecoveryPlanRequestSchema>;
export const worldImportRecoveryRequestSchema = strictObject({ operationId: uploadIdSchema,
  confirmWorldName: Type.String({ minLength: 1, maxLength: 128 }), recoveryRevision: importRevisionSchema });
export type WorldImportRecoveryRequest = Static<typeof worldImportRecoveryRequestSchema>;
export const worldImportRecoveryPlanResponseSchema = strictObject({ data: strictObject({ serverId: Type.String(), operationId: uploadIdSchema,
  previousWorldName: Type.String(), importedWorldName: Type.String(), recoveryRevision: importRevisionSchema,
  executionAvailable: Type.Literal(true), preservesAllTrees: Type.Literal(true)
}), meta: responseMetaSchema });
export type WorldImportRecoveryPlanResponse = Static<typeof worldImportRecoveryPlanResponseSchema>;

export const addonsResponseSchema = strictObject({ data: strictObject({
  items: Type.Array(strictObject({ id: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    kind: Type.Union([Type.Literal("mod"), Type.Literal("plugin")]), state: Type.Union([Type.Literal("enabled"), Type.Literal("disabled")]),
    filename: Type.String({ maxLength: 200 }), sizeBytes: Type.Integer({ minimum: 1, maximum: 67108864 }), sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    name: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]), version: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    loader: Type.Union([Type.Literal("fabric"), Type.Literal("paper"), Type.Null()]), compatibility: Type.Literal("unknown"),
    minecraftConstraint: Type.Union([Type.Array(Type.String({ maxLength: 128 }), { maxItems: 16 }), Type.Null()]),
    metadataStatus: Type.Union([Type.Literal("parsed"), Type.Literal("invalid"), Type.Literal("missing")]) }), { maxItems: 1000 }),
  revision: Type.String({ pattern: "^[a-f0-9]{64}$" }), writeSupported: Type.Boolean()
}), meta: responseMetaSchema });
export type AddonsResponse = Static<typeof addonsResponseSchema>;
export const addonTrashResponseSchema = strictObject({ data: strictObject({
  items: Type.Array(strictObject({ id: Type.String({ format: "uuid" }), addonId: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    kind: Type.Union([Type.Literal("mod"), Type.Literal("plugin")]), filename: Type.String({ minLength: 5, maxLength: 200 }),
    originalState: Type.Union([Type.Literal("enabled"), Type.Literal("disabled")]), sizeBytes: Type.Integer({ minimum: 1, maximum: 67108864 }),
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }), name: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    version: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]), loader: Type.Union([Type.Literal("fabric"), Type.Literal("paper"), Type.Null()]),
    compatibility: Type.Literal("unknown"), minecraftConstraint: Type.Union([Type.Array(Type.String({ maxLength: 128 }), { maxItems: 16 }), Type.Null()]),
    metadataStatus: Type.Union([Type.Literal("parsed"), Type.Literal("invalid"), Type.Literal("missing")]),
    createdAt: timestampSchema, restoreAllowed: Type.Literal(true) }), { maxItems: 1000 }),
  revision: Type.String({ pattern: "^[a-f0-9]{64}$" })
}), meta: responseMetaSchema });
export type AddonTrashResponse = Static<typeof addonTrashResponseSchema>;
export const addonLifecycleRequestSchema = strictObject({ revision: Type.String({ pattern: "^[a-f0-9]{64}$" }) });
export type AddonLifecycleRequest = Static<typeof addonLifecycleRequestSchema>;
export const addonUploadResponseSchema = strictObject({ data: strictObject({
  id: Type.String({ format: "uuid" }), kind: Type.Union([Type.Literal("mod"), Type.Literal("plugin")]),
  filename: Type.String({ minLength: 5, maxLength: 200 }), sizeBytes: Type.Integer({ minimum: 1, maximum: 67108864 }),
  checksumSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }), revision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  name: Type.String({ minLength: 1, maxLength: 128 }), version: Type.String({ minLength: 1, maxLength: 128 }),
  loader: Type.Union([Type.Literal("fabric"), Type.Literal("paper")]),
  minecraftConstraint: Type.Union([Type.Array(Type.String({ maxLength: 128 }), { maxItems: 16 }), Type.Null()]),
  state: Type.Literal("validated"), executionAvailable: Type.Literal(false)
}), meta: responseMetaSchema });
export type AddonUploadResponse = Static<typeof addonUploadResponseSchema>;
export const addonInstallRequestSchema = strictObject({ uploadId: Type.String({ format: "uuid" }),
  uploadRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }), inventoryRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }) });
export type AddonInstallRequest = Static<typeof addonInstallRequestSchema>;

export const performanceResponseSchema = strictObject({ data: strictObject({
  retention: Type.Literal("manager-session"), minimumIntervalMs: Type.Literal(5000),
  samples: Type.Array(strictObject({ collectedAt: timestampSchema, metrics: metricsSchema }), { maxItems: 120 })
}), meta: responseMetaSchema });
export type PerformanceResponse = Static<typeof performanceResponseSchema>;

export const crashAnalysisResponseSchema = strictObject({ data: strictObject({
  status: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
  reason: Type.Union([Type.Literal("local-instance-required"), Type.Null()]),
  sampledAt: Type.Union([timestampSchema, Type.Null()]), minimumIntervalMs: Type.Literal(5000),
  incomplete: Type.Boolean(),
  conclusion: Type.Union([Type.Literal("possible-causes"), Type.Literal("no-rule-match"), Type.Literal("insufficient-evidence"), Type.Literal("unavailable")]),
  sources: Type.Array(strictObject({ id: Type.String({ pattern: "^(latest-log|crash-[1-3])$" }),
    source: Type.Union([Type.Literal("latest-log"), Type.Literal("crash-report")]), truncated: Type.Boolean() }), { maxItems: 4 }),
  findings: Type.Array(strictObject({
    code: Type.Union([Type.Literal("out-of-memory"), Type.Literal("port-bind"), Type.Literal("java-version"), Type.Literal("watchdog"), Type.Literal("dependency")]),
    confidence: Type.Literal("possible"), title: Type.String({ maxLength: 128 }), guidance: Type.String({ maxLength: 512 }),
    evidence: Type.Array(strictObject({ sourceId: Type.String({ pattern: "^(latest-log|crash-[1-3])$" }),
      excerptLine: Type.Integer({ minimum: 1, maximum: 2048 }), snippet: Type.String({ maxLength: 1000 }) }), { maxItems: 2 })
  }), { maxItems: 5 }),
  limitations: Type.Array(Type.Union([Type.Literal("bounded-local-evidence"), Type.Literal("possible-not-certain"),
    Type.Literal("excerpt-line-not-file-line"), Type.Literal("no-automatic-repair")]), { maxItems: 4 })
}), meta: responseMetaSchema });
export type CrashAnalysisResponse = Static<typeof crashAnalysisResponseSchema>;

const authTokenSchema = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });
export const authStatusResponseSchema = strictObject({ data: Type.Union([
  strictObject({ configured: Type.Literal(false), authenticationRequired: Type.Literal(false), auditReady: Type.Literal(false) }),
  strictObject({ configured: Type.Literal(true), authenticationRequired: Type.Literal(true), auditReady: Type.Boolean() })
]) });
export type AuthStatusResponse = Static<typeof authStatusResponseSchema>;
export const authCredentialsRequestSchema = strictObject({
  username: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$" }),
  // Backend additionally validates 128 Unicode code points and 512 UTF-8 bytes.
  password: Type.String({ maxLength: 256 })
});
export type AuthCredentialsRequest = Static<typeof authCredentialsRequestSchema>;
export const authSessionResponseSchema = strictObject({ data: strictObject({
  authenticated: Type.Literal(true), expiresAt: timestampSchema, csrfToken: authTokenSchema, recentReauthentication: Type.Boolean()
}), meta: responseMetaSchema });
export type AuthSessionResponse = Static<typeof authSessionResponseSchema>;
export const authLogoutResponseSchema = strictObject({ data: strictObject({ authenticated: Type.Literal(false) }), meta: responseMetaSchema });
export type AuthLogoutResponse = Static<typeof authLogoutResponseSchema>;
export const authWsTicketRequestSchema = strictObject({ serverId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }) });
export type AuthWsTicketRequest = Static<typeof authWsTicketRequestSchema>;
export const authWsTicketResponseSchema = strictObject({ data: strictObject({ ticket: authTokenSchema, expiresAt: timestampSchema }), meta: responseMetaSchema });
export type AuthWsTicketResponse = Static<typeof authWsTicketResponseSchema>;
