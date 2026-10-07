import type {
  PlayersData,
  CommandResponse,
  LogsResponse,
  Operation,
  Overview,
  Readiness,
  ServerStatus,
  ServerSummary
} from "@mcsm/contracts";

import { randomUUID } from "node:crypto";
import { parsePlayerList } from "./player-list.js";
import { trustedLifecycle } from "./trusted-lifecycle.js";

import {
  isLocalAdapter,
  type LocalMinecraftServerAdapter
} from "../adapters/contract.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import type { ActiveWorldStateStore } from "./active-world-state-store.js";

const unavailable = (reason: string) => ({ allowed: false as const, reason });
const available = () => ({ allowed: true as const, reason: null });

const RESERVED_COMMANDS = new Set(["stop", "restart", "save-all", "save-off", "save-on"]);

function canonicalCommandToken(token: string): string {
  const withoutSlash = token.replace(/^\/+/, "").toLowerCase();
  return withoutSlash.slice(withoutSlash.lastIndexOf(":") + 1);
}

/**
 * Lifecycle and save commands must go through durable operation endpoints.
 * Minecraft's execute grammar is extensible and nested, so this boundary is
 * deliberately conservative: an exact reserved token anywhere in a command
 * is rejected rather than attempting an incomplete parser.
 */
export function isReservedMinecraftCommand(command: string): boolean {
  return command.split(/\s+/u).some((token) => RESERVED_COMMANDS.has(canonicalCommandToken(token)));
}

const mockReadiness = (): Readiness => ({
  start: unavailable("mock-mode"), stop: unavailable("mock-mode"),
  restart: unavailable("mock-mode"), commands: unavailable("mock-mode"),
  backup: unavailable("mock-mode"), restore: unavailable("mock-mode"),
  worldChanges: unavailable("mock-mode"), addonChanges: unavailable("mock-mode"),
  propertiesChanges: unavailable("mock-mode"), commandTransport: "unavailable"
});

export class ServerNotFoundError extends DomainError {
  constructor() {
    super(404, "SERVER_NOT_FOUND", "未找到指定的服务器实例");
    this.name = "ServerNotFoundError";
  }
}

export class OperationNotFoundError extends DomainError {
  constructor() {
    super(404, "RESOURCE_NOT_FOUND", "未找到指定的操作记录");
    this.name = "OperationNotFoundError";
  }
}

function statusReason(status: ServerStatus, action: "start" | "stop" | "restart" | "backup"): string {
  if (status.ownership === "external") return "external-process";
  if (status.state === "unknown") return "server-state-unknown";
  if (action === "start" && status.state === "running") return "already-running";
  if (action === "stop" && status.state === "stopped") return "already-stopped";
  return `state-${status.state}`;
}

export class ServerService {
  readonly #registry: AdapterRegistry;
  readonly #operations: OperationService;
  readonly #commandAttempts = new Map<string, number[]>();
  readonly #playerSessions = new Map<string, Map<string, string>>();

  constructor(
    registry: AdapterRegistry,
    operations: OperationService,
    private readonly activeWorldState?: Pick<ActiveWorldStateStore, "reconcileAfterStart"> & Partial<Pick<ActiveWorldStateStore, "snapshot">>,
    private readonly restoreEnabled = false,
    private readonly worldCreateEnabled = false,
    private readonly addonChangesEnabled = false
  ) {
    this.#registry = registry;
    this.#operations = operations;
  }

  async list(): Promise<ServerSummary[]> {
    return Promise.all(this.#registry.list().map((adapter) => this.#getSummary(adapter.serverId)));
  }

  async get(serverId: string): Promise<ServerSummary> {
    return this.#getSummary(serverId);
  }

  getOperation(operationId: string): Operation {
    const operation = this.#operations.get(operationId);
    if (operation === undefined) throw new OperationNotFoundError();
    return operation;
  }

  getLocalAdapter(serverId: string): LocalMinecraftServerAdapter {
    const adapter = this.#registry.get(serverId);
    if (adapter === undefined) throw new ServerNotFoundError();
    if (!isLocalAdapter(adapter)) {
      throw new DomainError(501, "FEATURE_NOT_IMPLEMENTED", "Mock 模式不提供此功能", "mock-mode");
    }
    return adapter;
  }

  async requestLifecycle(
    serverId: string,
    kind: "start" | "stop" | "restart",
    idempotencyKey: string
  ): Promise<Operation> {
    const adapter = this.getLocalAdapter(serverId);
    let noOp = false;
    return this.#operations.requestLifecycle(
      serverId,
      kind,
      idempotencyKey,
      async (context) => {
        if (kind !== "stop") this.#assertActiveWorld(serverId);
        if (noOp) return;
        if (kind === "start") {
          await adapter.revalidateBeforeStart();
          await adapter.start(context);
          await this.activeWorldState?.reconcileAfterStart(serverId);
        } else if (kind === "stop") {
          await adapter.stop(context);
        } else {
          await adapter.stop(context);
          this.#assertActiveWorld(serverId);
          await adapter.revalidateBeforeStart();
          await adapter.start(context);
          await this.activeWorldState?.reconcileAfterStart(serverId);
        }
      },
      async () => {
        if (kind !== "stop") this.#assertActiveWorld(serverId);
        const summary = await this.#getSummary(serverId);
        const { status } = summary;
        if (status.ownership === "external") {
          throw new DomainError(
            409,
            "ACTION_UNAVAILABLE",
            "当前状态不能执行该操作",
            "external-process"
          );
        }
        const safeNoOp =
          trustedLifecycle(summary.server) &&
          !status.recoveryRequired &&
          status.activeOperationId === null &&
          (
            (kind === "start" && status.state === "running" && status.ownership === "managed") ||
            (kind === "stop" && status.state === "stopped" && status.ownership === "none")
          );
        if (safeNoOp) {
          noOp = true;
          return;
        }
        const readiness = summary.readiness[kind];
        if (!readiness.allowed) {
          throw new DomainError(
            409,
            "ACTION_UNAVAILABLE",
            "当前状态不能执行该操作",
            readiness.reason
          );
        }
      }
    );
  }

  async getLogs(
    serverId: string,
    after: string | undefined,
    limit: number
  ): Promise<LogsResponse["data"]> {
    return this.getLocalAdapter(serverId).getLogs(after, limit);
  }

  async getPlayers(serverId: string, sampledAt: () => string): Promise<PlayersData> {
    const adapter = this.#registry.get(serverId);
    if (!adapter) throw new ServerNotFoundError();
    const missing = (reason: string): PlayersData => ({ availability: "unavailable", completeness: "unknown",
      items: [], sampledAt: null, reason });
    if (!isLocalAdapter(adapter)) return missing("mock-mode");
    try {
      return await this.#operations.runExclusive(serverId, async () => {
        const summary = await this.#getSummary(serverId);
        if (summary.server.type !== "vanilla") return missing("capability-unsupported");
        if (summary.status.state !== "running" || summary.status.ownership !== "managed" ||
          !summary.readiness.commands.allowed || summary.readiness.commandTransport !== "rcon") {
          this.#playerSessions.delete(serverId);
          return missing("managed-rcon-unavailable");
        }
        this.#consumeCommandRate(serverId);
        const result = await adapter.command("list");
        if (result.status !== "executed" || result.transport !== "rcon" || result.output === null) return missing("unconfirmed-response");
        const names = parsePlayerList(result.output);
        if (names === null) return missing("unrecognized-list-response");
        const previous = this.#playerSessions.get(serverId);
        const sessions = new Map(names.map((name) => [name, previous?.get(name) ?? `session-${randomUUID()}`]));
        this.#playerSessions.set(serverId, sessions);
        return { availability: "available", completeness: "full", sampledAt: sampledAt(), reason: null,
          items: names.map((name) => ({ id: sessions.get(name)!, uuid: null, name, online: true })) };
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "RATE_LIMITED") return missing("rate-limited");
      if (error instanceof DomainError && error.code === "RECOVERY_REQUIRED") return missing("recovery-required");
      if (error instanceof DomainError && error.code === "OPERATION_CONFLICT") return missing("operation-active");
      return missing("player-query-failed");
    }
  }

  async sendCommand(serverId: string, command: string): Promise<CommandResponse["data"]> {
    const adapter = this.getLocalAdapter(serverId);
    const normalized = command.trim();
    if (
      normalized.length === 0 || Buffer.byteLength(normalized, "utf8") > 1024 ||
      /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
      throw new DomainError(400, "VALIDATION_ERROR", "命令格式无效", "invalid-command");
    }
    if (this.#containsReservedCommand(normalized)) {
      throw new DomainError(409, "ACTION_UNAVAILABLE", "该命令必须使用专用操作流程", "reserved-command");
    }
    return this.#operations.runExclusive(serverId, async () => {
      const readiness = (await this.#getSummary(serverId)).readiness.commands;
      if (!readiness.allowed) {
        throw new DomainError(
          503, "COMMAND_TRANSPORT_UNAVAILABLE", "当前没有可用的命令传输", readiness.reason
        );
      }
      this.#consumeCommandRate(serverId);
      return adapter.command(normalized);
    });
  }

  async getOverview(serverId: string): Promise<Overview> {
    const adapter = this.#registry.get(serverId);
    if (adapter === undefined) throw new ServerNotFoundError();
    const [summary, metrics, activity, alerts] = await Promise.all([
      this.#getSummary(serverId), adapter.getMetrics(), adapter.getActivity(), adapter.getAlerts()
    ]);
    return { summary, metrics, activity: activity.slice(0, 20), alerts };
  }

  async close(): Promise<void> {
    await this.#registry.close();
  }

  async #getSummary(serverId: string): Promise<ServerSummary> {
    const adapter = this.#registry.get(serverId);
    if (adapter === undefined) throw new ServerNotFoundError();
    const [server, capabilities, baseStatus] = await Promise.all([
      adapter.getServerInfo(), adapter.getCapabilities(), adapter.getStatus()
    ]);
    if (!isLocalAdapter(adapter)) {
      return { server, capabilities, status: baseStatus, readiness: mockReadiness() };
    }
    const operationState = this.#operations.getServerState(serverId);
    const status: ServerStatus = {
      ...baseStatus,
      activeOperationId: operationState.activeOperationId,
      recoveryRequired: baseStatus.recoveryRequired || operationState.recoveryRequired
    };
    const commandTransport = await adapter.getCommandTransport();
    const blockedReason = status.recoveryRequired
      ? "recovery-required"
      : status.activeOperationId !== null
        ? "operation-active"
        : !trustedLifecycle(server) ? "capability-unsupported" : null;
    const noActiveWorld = this.activeWorldState?.snapshot?.(serverId)?.state === "none";
    const canStart = blockedReason === null && !noActiveWorld && status.state === "stopped" && adapter.plan.eulaAccepted;
    const canStop = blockedReason === null && status.state === "running" && status.ownership === "managed";
    const canCommand = blockedReason === null && status.state === "running" && commandTransport !== "unavailable";
    const canBackup = server.type === "vanilla" && blockedReason === null && capabilities.backup &&
      (status.state === "stopped" || (status.state === "running" && status.ownership === "managed"));
    const readiness: Readiness = {
      start: canStart ? available() : unavailable(
        blockedReason ?? (noActiveWorld ? "NO_ACTIVE_WORLD" : !adapter.plan.eulaAccepted ? "eula-not-accepted" : statusReason(status, "start"))
      ),
      stop: canStop ? available() : unavailable(blockedReason ?? statusReason(status, "stop")),
      restart: canStop && !noActiveWorld ? available() : unavailable(blockedReason ?? (noActiveWorld ? "NO_ACTIVE_WORLD" : statusReason(status, "restart"))),
      commands: canCommand ? available() : unavailable(
        blockedReason ?? (commandTransport === "unavailable" ? "transport-unavailable" : statusReason(status, "stop"))
      ),
      backup: canBackup ? available() : unavailable(
        server.type !== "vanilla" || !capabilities.backup ? "capability-unsupported" : blockedReason ?? statusReason(status, "backup")
      ),
      restore: !this.restoreEnabled ? unavailable("feature-not-implemented") : canBackup ? available() : unavailable(blockedReason ?? statusReason(status, "backup")),
      worldChanges: !this.worldCreateEnabled ? unavailable("feature-not-implemented") :
        canBackup && this.activeWorldState?.snapshot?.(serverId)?.state === "active" ? available() :
          unavailable(blockedReason ?? "world-state-unavailable"),
      addonChanges: (() => {
        const supported = (server.type === "paper" && capabilities.plugins) || (server.type === "fabric" && capabilities.mods);
        const reason = !supported ? "capability-unsupported"
          : !this.addonChangesEnabled ? "feature-not-implemented"
            : status.recoveryRequired ? "recovery-required"
              : status.activeOperationId !== null ? "operation-active"
                : status.state !== "stopped" ? status.ownership === "external" ? "external-process" : `state-${status.state}`
                  : status.ownership !== "none" ? "server-ownership-uncertain" : null;
        return reason === null ? available() : unavailable(reason);
      })(),
      propertiesChanges: unavailable("feature-not-implemented"),
      commandTransport
    };
    return { server, capabilities, status, readiness };
  }

  #consumeCommandRate(serverId: string): void {
    const now = Date.now();
    const recent = (this.#commandAttempts.get(serverId) ?? []).filter((value) => now - value < 10_000);
    if (recent.length >= 5) {
      throw new DomainError(429, "RATE_LIMITED", "命令发送过于频繁", "command-rate-limit");
    }
    recent.push(now);
    this.#commandAttempts.set(serverId, recent);
  }

  #assertActiveWorld(serverId: string): void {
    if (this.activeWorldState?.snapshot?.(serverId)?.state === "none")
      throw new DomainError(409,"NO_ACTIVE_WORLD","当前实例没有活动世界，不能启动或重启","NO_ACTIVE_WORLD");
  }

  #containsReservedCommand(command: string): boolean {
    return isReservedMinecraftCommand(command);
  }
}
