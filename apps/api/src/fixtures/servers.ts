import type { Activity, Metrics } from "@mcsm/contracts";

import { MockAdapter, type MockAdapterFixture } from "../adapters/mock.js";
import type { MinecraftServerAdapter } from "../adapters/contract.js";
import type { Clock } from "../clock.js";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const unavailable = (reason: string) => ({
  status: "unavailable" as const,
  value: null,
  source: null,
  sampledAt: null,
  reason
});

const at = (now: Date, millisecondsAgo: number) =>
  new Date(now.getTime() - millisecondsAgo).toISOString();

const PAPER_FIXTURE: MockAdapterFixture = {
  server: {
    id: "paper-demo",
    name: "Survival · 示例",
    type: "paper",
    minecraftVersion: "1.21.1",
    java: { runtimeVersion: "21.0.4", requiredMajor: 21 },
    detection: { confidence: "high", evidence: ["mock-fixture"], warnings: [] }
  },
  capabilities: {
    mods: false,
    plugins: true,
    rcon: true,
    console: true,
    backup: true,
    worlds: true,
    properties: true
  },
  status: {
    state: "running",
    ownership: "none",
    source: "mock",
    activeOperationId: null,
    recoveryRequired: false
  },
  metrics: (now): Metrics => ({
    players: {
      status: "available",
      value: { online: 4, max: 20 },
      source: "mock",
      sampledAt: now.toISOString()
    },
    tps: unavailable("not-collected"),
    mspt: unavailable("not-collected"),
    cpu: { status: "available", value: 12.4, source: "mock", sampledAt: now.toISOString() },
    ram: {
      status: "available",
      value: { rssBytes: Math.round(1.8 * GIB) },
      source: "mock",
      sampledAt: now.toISOString()
    },
    disk: {
      status: "available",
      value: { totalBytes: 120 * GIB, freeBytes: 72 * GIB, usedBytes: 48 * GIB },
      source: "mock",
      sampledAt: now.toISOString()
    },
    uptime: { status: "available", value: 7_245, source: "mock", sampledAt: now.toISOString() }
  }),
  activity: (now): Activity[] => [
    {
      id: "paper-activity-1",
      occurredAt: at(now, 2 * 60 * 1000),
      kind: "info",
      message: "Mock 状态快照已刷新",
      operationId: null
    },
    {
      id: "paper-activity-2",
      occurredAt: at(now, 18 * 60 * 1000),
      kind: "info",
      message: "示例玩家数量已更新",
      operationId: null
    }
  ],
  alerts: []
};

const VANILLA_FIXTURE: MockAdapterFixture = {
  server: {
    id: "vanilla-demo",
    name: "Vanilla 建筑服 · 示例",
    type: "vanilla",
    minecraftVersion: "1.20.6",
    java: { runtimeVersion: "21.0.4", requiredMajor: 21 },
    detection: { confidence: "high", evidence: ["mock-fixture"], warnings: [] }
  },
  capabilities: {
    mods: false,
    plugins: false,
    rcon: true,
    console: true,
    backup: true,
    worlds: true,
    properties: true
  },
  status: {
    state: "stopped",
    ownership: "none",
    source: "mock",
    activeOperationId: null,
    recoveryRequired: false
  },
  metrics: (now): Metrics => ({
    players: unavailable("server-stopped"),
    tps: unavailable("not-collected"),
    mspt: unavailable("not-collected"),
    cpu: unavailable("server-stopped"),
    ram: unavailable("server-stopped"),
    disk: {
      status: "available",
      value: { totalBytes: 120 * GIB, freeBytes: 72 * GIB, usedBytes: 48 * GIB },
      source: "mock",
      sampledAt: now.toISOString()
    },
    uptime: unavailable("server-stopped")
  }),
  activity: (now): Activity[] => [
    {
      id: "vanilla-activity-1",
      occurredAt: at(now, 45 * 60 * 1000),
      kind: "info",
      message: "示例服务器处于停止状态",
      operationId: null
    }
  ],
  alerts: []
};

const FABRIC_FIXTURE: MockAdapterFixture = {
  server: {
    id: "fabric-partial",
    name: "Fabric 实验服 · 部分信息",
    type: "fabric",
    minecraftVersion: null,
    java: { runtimeVersion: null, requiredMajor: null },
    detection: {
      confidence: "low",
      evidence: ["mock-fixture", "fabric-loader-metadata"],
      warnings: ["示例检测信息不完整，版本与运行状态未知"]
    }
  },
  capabilities: {
    mods: true,
    plugins: false,
    rcon: false,
    console: false,
    backup: false,
    worlds: false,
    properties: false
  },
  status: {
    state: "unknown",
    ownership: "unknown",
    source: "mock",
    activeOperationId: null,
    recoveryRequired: false
  },
  metrics: (now): Metrics => ({
    players: unavailable("probe-unavailable"),
    tps: unavailable("not-collected"),
    mspt: unavailable("not-collected"),
    cpu: {
      status: "stale",
      value: 6.8,
      source: "mock",
      sampledAt: at(now, 60 * 1000),
      reason: "probe-unavailable"
    },
    ram: unavailable("probe-unavailable"),
    disk: unavailable("layout-unverified"),
    uptime: unavailable("probe-unavailable")
  }),
  activity: (now): Activity[] => [
    {
      id: "fabric-activity-1",
      occurredAt: at(now, 60 * 1000),
      kind: "warning",
      message: "示例探测只返回了部分信息",
      operationId: null
    }
  ],
  alerts: [
    { code: "PARTIAL_DETECTION", message: "当前示例无法确认版本、Java 与运行状态" }
  ]
};

export function createMockAdapters(clock: Clock): MinecraftServerAdapter[] {
  return [PAPER_FIXTURE, VANILLA_FIXTURE, FABRIC_FIXTURE].map(
    (fixture) => new MockAdapter(fixture, clock)
  );
}
