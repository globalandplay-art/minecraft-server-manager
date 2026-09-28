import net from "node:net";

const MAX_STATUS_PACKET_BYTES = 1024 * 1024;

function encodeVarInt(value: number): Buffer {
  let current = value | 0;
  const bytes: number[] = [];
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (current !== 0 && bytes.length < 5);
  return Buffer.from(bytes);
}

function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarInt(bytes.length), bytes]);
}

function frame(payload: Buffer): Buffer {
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

function readVarInt(buffer: Buffer, offset: number): { value: number; bytes: number } | null {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    if (offset + index >= buffer.length) return null;
    const byte = buffer[offset + index] ?? 0;
    value |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) === 0) return { value: value >>> 0, bytes: index + 1 };
  }
  throw new Error("invalid VarInt");
}

export interface MinecraftStatusEndpoint {
  readonly host: "127.0.0.1";
  readonly port: number;
}

export type MinecraftStatusProbeResult = "running" | "stopped" | "unknown";

function isMinecraftStatus(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    version?: { name?: unknown; protocol?: unknown };
    players?: { online?: unknown; max?: unknown };
  };
  const version = candidate.version;
  const players = candidate.players;
  return Boolean(
    version &&
    typeof version.name === "string" &&
    version.name.length > 0 &&
    Number.isInteger(version.protocol) &&
    players &&
    Number.isInteger(players.online) &&
    Number.isInteger(players.max) &&
    (players.online as number) >= 0 &&
    (players.max as number) >= 0 &&
    (players.online as number) <= (players.max as number)
  );
}

export async function probeMinecraftStatus(
  endpoint: MinecraftStatusEndpoint,
  timeoutMs = 2_000,
  signal?: AbortSignal
): Promise<MinecraftStatusProbeResult> {
  if (endpoint.host !== "127.0.0.1") return "unknown";
  const socket = new net.Socket();
  const handshakePayload = Buffer.concat([
    encodeVarInt(0),
    encodeVarInt(-1),
    encodeString(endpoint.host),
    Buffer.from([(endpoint.port >>> 8) & 0xff, endpoint.port & 0xff]),
    encodeVarInt(1)
  ]);
  const request = Buffer.concat([frame(handshakePayload), frame(Buffer.from([0]))]);

  return new Promise<MinecraftStatusProbeResult>((resolve) => {
    let settled = false;
    let received = Buffer.alloc(0);
    const finish = (result: MinecraftStatusProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(result);
    };
    const parse = () => {
      try {
        const frameLength = readVarInt(received, 0);
        if (!frameLength) return;
        if (frameLength.value < 2 || frameLength.value > MAX_STATUS_PACKET_BYTES) return finish("unknown");
        const frameStart = frameLength.bytes;
        if (received.length < frameStart + frameLength.value) return;
        const payload = received.subarray(frameStart, frameStart + frameLength.value);
        const packetId = readVarInt(payload, 0);
        if (!packetId || packetId.value !== 0) return finish("unknown");
        const jsonLength = readVarInt(payload, packetId.bytes);
        if (!jsonLength || jsonLength.value > MAX_STATUS_PACKET_BYTES) return finish("unknown");
        const jsonStart = packetId.bytes + jsonLength.bytes;
        if (jsonStart + jsonLength.value !== payload.length) return finish("unknown");
        const decoded: unknown = JSON.parse(payload.subarray(jsonStart).toString("utf8"));
        finish(isMinecraftStatus(decoded) ? "running" : "unknown");
      } catch {
        finish("unknown");
      }
    };
    const onAbort = () => finish("unknown");
    const timer = setTimeout(() => finish("unknown"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ECONNREFUSED" ? "stopped" : "unknown");
    });
    socket.on("close", () => finish("unknown"));
    socket.on("data", (chunk) => {
      if (received.length + chunk.length > MAX_STATUS_PACKET_BYTES + 16) return finish("unknown");
      received = Buffer.concat([received, chunk]);
      parse();
    });
    socket.connect(endpoint.port, endpoint.host, () => socket.write(request));
  });
}

export const minecraftStatusProtocol = { encodeVarInt, readVarInt, frame, encodeString };
