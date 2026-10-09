import { Value } from "@sinclair/typebox/value";
import { serverParamsSchema, wsMessageSchema, wsQuerySchema, type ServerParams, type WsMessage, type WsQuery } from "@mcsm/contracts";
import type { FastifyInstance } from "fastify";
import type { Mode } from "@mcsm/contracts";
import type { WebSocket } from "ws";

import type { Clock } from "../clock.js";
import { errorResponse } from "../infra/http.js";
import type { EventStreamService } from "../services/event-stream-service.js";
import type { WebSocketAuthentication } from "../auth/ws-auth.js";

const MAX_BUFFERED_BYTES = 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

export function safeSend(socket: WebSocket, message: WsMessage): boolean {
  if (!Value.Check(wsMessageSchema, message)) return false;
  if (socket.readyState !== 1) return false;
  const payload = JSON.stringify(message);
  const payloadBytes = Buffer.byteLength(payload, "utf8");
  if (
    payloadBytes > MAX_BUFFERED_BYTES ||
    socket.bufferedAmount + payloadBytes > MAX_BUFFERED_BYTES
  ) {
    socket.close(1013, "client-too-slow");
    return false;
  }
  try {
    socket.send(payload);
    return true;
  } catch {
    socket.close(1011, "send-failed");
    return false;
  }
}

export function registerWebSocketRoute(
  app: FastifyInstance,
  streams: EventStreamService,
  clock: Clock,
  mode: Mode,
  authentication?: WebSocketAuthentication
): void {
  app.get<{ Params: ServerParams; Querystring: WsQuery }>(
    "/ws/v1/servers/:serverId/events",
    {
      websocket: true,
      schema: { params: serverParamsSchema, querystring: wsQuerySchema },
      preHandler: async (request, reply) => {
        try { await authentication?.prepare(request, reply); }
        catch { await reply.code(authentication?.ready() ? 403 : 503).send(errorResponse(request.id, clock,
          authentication?.ready() ? "AUTH_WS_REJECTED" : "AUTH_AUDIT_UNAVAILABLE", "Authentication request denied", mode)); }
      },
      preValidation: async (request, reply) => {
        if (request.headers.origin === undefined) {
          await reply.code(403).send(
            errorResponse(request.id, clock, "ORIGIN_REJECTED", "WebSocket需要允许的 Origin", mode)
          );
          return;
        }
        const hasStream = request.query.streamId !== undefined;
        const hasSequence = request.query.afterSequence !== undefined;
        if (hasStream !== hasSequence) {
          await reply.code(400).send(
            errorResponse(request.id, clock, "VALIDATION_ERROR", "streamId与afterSequence必须同时提供", mode)
          );
          return;
        }
        if (!streams.has(request.params.serverId)) {
          await reply.code(404).send(
            errorResponse(request.id, clock, "SERVER_NOT_FOUND", "未找到可订阅的本地服务器实例", mode)
          );
        }
      }
    },
    (socket, request) => {
      const serverId = request.params.serverId;
      const { streamId, afterSequence } = request.query;
      const queued: WsMessage[] = [];
      let unsubscribe = () => {};
      let heartbeat: NodeJS.Timeout | undefined;
      let pongTimer: NodeJS.Timeout | undefined;
      let stopped = false;
      const cleanup = () => {
        if (stopped) return;
        stopped = true; if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        if (pongTimer) clearTimeout(pongTimer);
        unsubscribe(); queued.length = 0;
      };
      const live = authentication?.attach(request.raw, socket, cleanup) ?? (authentication ? undefined : () => !stopped);
      if (!live) { cleanup(); return; }
      const admitted = () => !stopped && live();
      socket.on("error", () => {});
      socket.on("message", () => socket.close(1008, "read-only-stream"));

      let awaitingPong = false;
      socket.on("pong", () => {
        awaitingPong = false;
        if (pongTimer !== undefined) clearTimeout(pongTimer);
      });
      heartbeat = setInterval(() => {
        if (!admitted() || socket.readyState !== 1 || awaitingPong) return;
        awaitingPong = true;
        socket.ping();
        pongTimer = setTimeout(() => socket.terminate(), HEARTBEAT_TIMEOUT_MS);
      }, HEARTBEAT_INTERVAL_MS);

      let queuedBytes = 0;
      let initialized = false;
      let lastDeliveredSequence = -1;
      const deliver = (message: WsMessage): boolean => {
        const sent = admitted() && safeSend(socket, message);
        if (sent && "sequence" in message) lastDeliveredSequence = Math.max(lastDeliveredSequence, message.sequence);
        return sent;
      };
      if (!admitted()) return;
      unsubscribe = streams.subscribe(serverId, (message) => {
        if (!admitted()) return;
        if (initialized) deliver(message);
        else {
          queuedBytes += Buffer.byteLength(JSON.stringify(message), "utf8");
          if (queuedBytes > MAX_BUFFERED_BYTES) {
            socket.close(1013, "initialization-backlog-exceeded");
          } else {
            queued.push(message);
          }
        }
      });
      socket.once("close", cleanup);

      void (async () => {
        if (!admitted()) return;
        const hello = streams.hello(serverId);
        if (!deliver(hello)) return;
        let needsSnapshot = streamId === undefined || afterSequence === undefined;
        if (streamId !== undefined && afterSequence !== undefined) {
          const replay = streams.replay(serverId, streamId, afterSequence);
          if (replay.gap) {
            deliver({
              type: "gap",
              sequence: hello.latestSequence,
              reason: replay.reason ?? "replay-unavailable"
            });
            needsSnapshot = true;
          } else {
            for (const message of replay.messages) if (!deliver(message)) return;
          }
        }
        if (needsSnapshot) {
          const snapshot = await streams.snapshot(serverId);
          if (!admitted()) return;
          if (snapshot.truncated) {
            deliver({
              type: "gap",
              sequence: snapshot.message.sequence,
              reason: "snapshot-truncated-byte-budget"
            });
          }
          if (!deliver(snapshot.message)) return;
        }
        initialized = true;
        for (const message of queued) {
          if ("sequence" in message && message.sequence <= lastDeliveredSequence) continue;
          if (!deliver(message)) return;
        }
        queued.length = 0;
        queuedBytes = 0;
      })().catch(() => socket.close(1011, "stream-unavailable"));
    }
  );
}
