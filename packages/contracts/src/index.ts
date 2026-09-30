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

export const backupsResponseSchema = strictObject({
  data: strictObject({ items: Type.Array(backupInfoSchema, { maxItems: 1000 }), nextCursor: Type.Null() }),
  meta: responseMetaSchema
});
export type BackupsResponse = Static<typeof backupsResponseSchema>;

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
  Type.Literal("restore"),
  Type.Literal("rollback"),
  Type.Literal("world-create"),
  Type.Literal("world-import"),
  Type.Literal("world-archive"),
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
      rollbackAvailable: Type.Boolean()
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
