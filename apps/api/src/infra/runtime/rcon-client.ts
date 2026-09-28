import net from "node:net";

import { validateMinecraftCommand } from "./command-validation.js";
import { createRedactor, type Redactor } from "./redactor.js";

const AUTH_PACKET_TYPE = 3;
const COMMAND_PACKET_TYPE = 2;
const MIN_PACKET_LENGTH = 10;
const DEFAULT_MAX_PACKET_LENGTH = 64 * 1024;

export type RconErrorCode =
  | "RCON_AUTH_FAILED"
  | "RCON_CONNECTION_FAILED"
  | "RCON_DISCONNECTED"
  | "RCON_PROTOCOL_ERROR"
  | "RCON_TIMEOUT";

export class RconError extends Error {
  constructor(
    readonly code: RconErrorCode,
    message: string,
    readonly commandDispatched = false
  ) {
    super(message);
    this.name = "RconError";
  }
}

export interface RconClientOptions {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly getPassword: () => Promise<string>;
  readonly timeoutMs?: number;
  readonly maxPacketLength?: number;
  readonly redactor?: Redactor;
  readonly socketFactory?: () => net.Socket;
}

interface RconPacket {
  readonly requestId: number;
  readonly type: number;
  readonly body: string;
}

interface PendingRequest {
  readonly mode: "single" | "barrier";
  readonly chunks: string[];
  readonly resolve: (value: string) => void;
  readonly reject: (error: RconError) => void;
  timeout: NodeJS.Timeout;
  readonly barrierRequestId: number | null;
  barrierSent: boolean;
  readonly commandDispatched: boolean;
  readonly expectedResponseType: number;
  responseBytes: number;
}

export function encodeRconPacket(requestId: number, type: number, body: string): Buffer {
  if (body.includes("\0")) {
    throw new RconError("RCON_PROTOCOL_ERROR", "RCON packet body contains NUL.");
  }
  const bodyBytes = Buffer.from(body, "utf8");
  const packetLength = 4 + 4 + bodyBytes.length + 2;
  const packet = Buffer.allocUnsafe(packetLength + 4);
  packet.writeInt32LE(packetLength, 0);
  packet.writeInt32LE(requestId, 4);
  packet.writeInt32LE(type, 8);
  bodyBytes.copy(packet, 12);
  packet.writeInt16LE(0, 12 + bodyBytes.length);
  return packet;
}

export class RconClient {
  private readonly timeoutMs: number;
  private readonly maxPacketLength: number;
  private readonly socketFactory: () => net.Socket;
  private readonly externalRedactor: Redactor;
  private socket: net.Socket | null = null;
  private receiveBuffer = Buffer.alloc(0);
  private authenticated = false;
  private connecting: Promise<void> | null = null;
  private nextRequestId = 1;
  private authRequestId: number | null = null;
  private activeSecret: string | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly barrierOwners = new Map<number, number>();

  constructor(private readonly options: RconClientOptions) {
    if (options.host !== "127.0.0.1") {
      throw new RconError("RCON_CONNECTION_FAILED", "RCON is restricted to 127.0.0.1.");
    }
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
      throw new RconError("RCON_CONNECTION_FAILED", "RCON port is invalid.");
    }
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxPacketLength = options.maxPacketLength ?? DEFAULT_MAX_PACKET_LENGTH;
    this.socketFactory = options.socketFactory ?? (() => new net.Socket());
    this.externalRedactor = options.redactor ?? createRedactor();
  }

  async connect(): Promise<void> {
    if (this.authenticated && this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectAndAuthenticate();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async execute(command: string): Promise<string> {
    const validated = validateMinecraftCommand(command);
    await this.connect();
    const requestId = this.allocateRequestId();
    const barrierRequestId = this.allocateRequestId();
    const output = await this.sendRequest(
      requestId,
      COMMAND_PACKET_TYPE,
      validated,
      "barrier",
      barrierRequestId
    );
    return this.redact(output);
  }

  close(): void {
    this.failConnection(new RconError("RCON_DISCONNECTED", "RCON connection closed."));
  }

  private async connectAndAuthenticate(): Promise<void> {
    this.failConnection(new RconError("RCON_DISCONNECTED", "RCON connection replaced."));
    const socket = this.socketFactory();
    this.socket = socket;
    this.receiveBuffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    socket.on("data", (chunk) => this.onData(socket, chunk));
    socket.on("error", () => {
      this.failConnection(
        new RconError("RCON_CONNECTION_FAILED", "RCON connection failed."),
        true,
        socket
      );
    });
    socket.on("close", () => {
      this.failConnection(
        new RconError("RCON_DISCONNECTED", "RCON connection closed."),
        false,
        socket
      );
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new RconError("RCON_TIMEOUT", "RCON connection timed out."));
      }, this.timeoutMs);
      const onError = () => {
        clearTimeout(timer);
        reject(new RconError("RCON_CONNECTION_FAILED", "RCON connection failed."));
      };
      socket.once("error", onError);
      socket.connect(this.options.port, this.options.host, () => {
        clearTimeout(timer);
        socket.off("error", onError);
        resolve();
      });
    });

    if (this.socket !== socket || socket.destroyed) {
      throw new RconError("RCON_DISCONNECTED", "RCON connection was replaced.");
    }

    const password = await this.options.getPassword();
    if (this.socket !== socket || socket.destroyed) {
      throw new RconError("RCON_DISCONNECTED", "RCON connection was replaced.");
    }
    this.activeSecret = password;
    const requestId = this.allocateRequestId();
    this.authRequestId = requestId;
    try {
      await this.sendRequest(requestId, AUTH_PACKET_TYPE, password, "single");
      if (this.socket !== socket || socket.destroyed) {
        throw new RconError("RCON_DISCONNECTED", "RCON connection was replaced.");
      }
      this.authenticated = true;
    } finally {
      this.authRequestId = null;
    }
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId = this.nextRequestId >= 0x7fff_ffff ? 1 : this.nextRequestId + 1;
    return requestId;
  }

  private sendRequest(
    requestId: number,
    type: number,
    body: string,
    mode: PendingRequest["mode"],
    barrierRequestId: number | null = null
  ): Promise<string> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new RconError("RCON_DISCONNECTED", "RCON connection is unavailable."));
    }
    const encoded = encodeRconPacket(requestId, type, body);
    if (encoded.length - 4 > this.maxPacketLength) {
      return Promise.reject(new RconError("RCON_PROTOCOL_ERROR", "RCON packet length is invalid."));
    }
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.clearPending(requestId, pending);
        const error = new RconError(
          "RCON_TIMEOUT",
          "RCON request timed out.",
          pending.commandDispatched
        );
        reject(error);
        this.failConnection(error);
      }, this.timeoutMs);
      this.pending.set(requestId, {
        mode,
        chunks: [],
        resolve,
        reject,
        timeout,
        barrierRequestId,
        barrierSent: false,
        commandDispatched: type === COMMAND_PACKET_TYPE,
        expectedResponseType: type === AUTH_PACKET_TYPE ? 2 : 0,
        responseBytes: 0
      });
      socket.write(encoded);
    });
  }

  private onData(socket: net.Socket, chunk: Buffer): void {
    if (this.socket !== socket) return;
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
    while (this.receiveBuffer.length >= 4) {
      const packetLength = this.receiveBuffer.readInt32LE(0);
      if (packetLength < MIN_PACKET_LENGTH || packetLength > this.maxPacketLength) {
        this.failConnection(new RconError("RCON_PROTOCOL_ERROR", "RCON packet length is invalid."));
        return;
      }
      const totalLength = packetLength + 4;
      if (this.receiveBuffer.length < totalLength) return;
      const packetBytes = this.receiveBuffer.subarray(4, totalLength);
      this.receiveBuffer = this.receiveBuffer.subarray(totalLength);
      if (packetBytes[packetLength - 2] !== 0 || packetBytes[packetLength - 1] !== 0) {
        this.failConnection(new RconError("RCON_PROTOCOL_ERROR", "RCON packet terminator is invalid."));
        return;
      }
      const packet: RconPacket = {
        requestId: packetBytes.readInt32LE(0),
        type: packetBytes.readInt32LE(4),
        body: packetBytes.subarray(8, packetLength - 2).toString("utf8")
      };
      this.onPacket(packet);
    }
  }

  private onPacket(packet: RconPacket): void {
    if (packet.requestId === -1 && this.authRequestId !== null) {
      const pending = this.pending.get(this.authRequestId);
      if (pending) {
        this.clearPending(this.authRequestId, pending);
        pending.reject(new RconError("RCON_AUTH_FAILED", "RCON authentication failed."));
      }
      this.failConnection(new RconError("RCON_AUTH_FAILED", "RCON authentication failed."));
      return;
    }

    const barrierOwner = this.barrierOwners.get(packet.requestId);
    if (barrierOwner !== undefined) {
      const owner = this.pending.get(barrierOwner);
      this.barrierOwners.delete(packet.requestId);
      if (owner) {
        if (packet.type !== 0) {
          this.failConnection(new RconError("RCON_PROTOCOL_ERROR", "RCON response type is invalid."));
          return;
        }
        this.clearPending(barrierOwner, owner);
        owner.resolve(owner.chunks.join(""));
      }
      return;
    }

    const pending = this.pending.get(packet.requestId);
    if (!pending) return;
    if (packet.type !== pending.expectedResponseType) {
      this.failConnection(new RconError("RCON_PROTOCOL_ERROR", "RCON response type is invalid."));
      return;
    }
    pending.responseBytes += Buffer.byteLength(packet.body, "utf8");
    if (pending.responseBytes > this.maxPacketLength) {
      this.failConnection(new RconError("RCON_PROTOCOL_ERROR", "RCON response is too large."));
      return;
    }
    pending.chunks.push(packet.body);
    if (pending.mode === "single") {
      this.clearPending(packet.requestId, pending);
      pending.resolve(pending.chunks.join(""));
      return;
    }
    if (pending.mode === "barrier" && !pending.barrierSent && pending.barrierRequestId !== null) {
      const socket = this.socket;
      if (!socket || socket.destroyed) {
        this.clearPending(packet.requestId, pending);
        pending.reject(new RconError(
          "RCON_DISCONNECTED",
          "RCON connection is unavailable.",
          pending.commandDispatched
        ));
        return;
      }
      pending.barrierSent = true;
      this.barrierOwners.set(pending.barrierRequestId, packet.requestId);
      socket.write(encodeRconPacket(pending.barrierRequestId, 0, ""));
    }
  }

  private clearPending(requestId: number, pending: PendingRequest): void {
    clearTimeout(pending.timeout);
    if (pending.barrierRequestId !== null) this.barrierOwners.delete(pending.barrierRequestId);
    this.pending.delete(requestId);
  }

  private failConnection(
    error: RconError,
    destroy = true,
    expectedSocket?: net.Socket
  ): void {
    if (expectedSocket !== undefined && this.socket !== expectedSocket) return;
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.activeSecret = null;
    this.receiveBuffer = Buffer.alloc(0);
    for (const [requestId, pending] of this.pending) {
      this.clearPending(requestId, pending);
      pending.reject(pending.commandDispatched
        ? new RconError(error.code, error.message, true)
        : error);
    }
    this.barrierOwners.clear();
    if (destroy && socket && !socket.destroyed) socket.destroy();
  }

  private redact(value: string): string {
    let result = value;
    if (this.activeSecret) result = result.split(this.activeSecret).join("[REDACTED]");
    return this.externalRedactor.redactText(result);
  }
}
