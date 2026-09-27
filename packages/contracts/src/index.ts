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
