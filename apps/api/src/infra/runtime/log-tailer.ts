import { lstat, open, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { LogEntry } from "@mcsm/contracts";

import { createRedactor, type Redactor } from "./redactor.js";

const DEFAULT_MAX_LINES = 2_000;
const DEFAULT_MAX_LINE_BYTES = 8 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export interface LogTailerOptions {
  readonly filePath: string;
  readonly pollIntervalMs?: number;
  readonly maxLines?: number;
  readonly maxLineBytes?: number;
  readonly initialTailBytes?: number;
  readonly redactor?: Redactor;
  readonly onEntry?: (entry: LogEntry) => void;
  readonly cursorPrefix?: string;
}

class LineAssembler {
  private carry = Buffer.alloc(0);
  private overflowed = false;

  constructor(private readonly maxBytes: number) {}

  consume(chunk: Buffer, emit: (line: Buffer) => void): void {
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      this.append(chunk.subarray(start, index));
      let line = this.carry;
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      emit(line);
      this.carry = Buffer.alloc(0);
      this.overflowed = false;
      start = index + 1;
    }
    this.append(chunk.subarray(start));
  }

  flush(emit: (line: Buffer) => void): void {
    if (this.carry.length > 0 || this.overflowed) emit(this.carry);
    this.reset();
  }

  reset(): void {
    this.carry = Buffer.alloc(0);
    this.overflowed = false;
  }

  private append(segment: Buffer): void {
    if (segment.length === 0 || this.carry.length >= this.maxBytes) {
      if (segment.length > 0) this.overflowed = true;
      return;
    }
    const remaining = this.maxBytes - this.carry.length;
    this.carry = Buffer.concat([this.carry, segment.subarray(0, remaining)]);
    if (segment.length > remaining) this.overflowed = true;
  }
}

function levelFor(text: string): LogEntry["level"] {
  const match = text.match(/\/(DEBUG|INFO|WARN|ERROR)\]/i) ?? text.match(/\b(DEBUG|INFO|WARN|ERROR)\b/i);
  switch (match?.[1]?.toLowerCase()) {
    case "debug": return "debug";
    case "info": return "info";
    case "warn": return "warn";
    case "error": return "error";
    default: return "unknown";
  }
}

function timestampFor(text: string): string | null {
  const match = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\b/);
  return match?.[1] ?? null;
}

export class BoundedLogTailer {
  private readonly pollIntervalMs: number;
  private readonly maxLines: number;
  private readonly maxLineBytes: number;
  private readonly initialTailBytes: number;
  private readonly redactor: Redactor;
  private readonly cursorPrefix: string;
  private readonly fileAssembler: LineAssembler;
  private readonly stderrAssembler: LineAssembler;
  private readonly entries: LogEntry[] = [];
  private fileIdentity: string | null = null;
  private offset = 0;
  private sequence = 0;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;

  constructor(private readonly options: LogTailerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.initialTailBytes = options.initialTailBytes ?? this.maxLines * (this.maxLineBytes + 1);
    this.redactor = options.redactor ?? createRedactor();
    this.cursorPrefix = options.cursorPrefix ?? randomUUID();
    this.fileAssembler = new LineAssembler(this.maxLineBytes);
    this.stderrAssembler = new LineAssembler(this.maxLineBytes);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.pollNow();
    this.timer = setInterval(() => void this.pollNow(), this.pollIntervalMs);
    this.timer.unref();
  }

  async pollNow(): Promise<void> {
    if (this.polling) return this.polling;
    // Log observation must never crash the API. Keep the last safe ring on any
    // permission, rotation, or validation failure and retry on the next poll.
    this.polling = this.pollFile().catch(() => undefined);
    try {
      await this.polling;
    } finally {
      this.polling = null;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  appendStderr(chunk: Buffer | string): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.stderrAssembler.consume(bytes, (line) => this.emitLine(line, "stderr"));
  }

  flushStderr(): void {
    this.stderrAssembler.flush((line) => this.emitLine(line, "stderr"));
  }

  page(after: string | undefined, limit: number): { items: LogEntry[]; nextCursor: string; truncated: boolean } {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    let startIndex = 0;
    let truncated = false;
    if (after) {
      const parsed = this.parseCursor(after);
      if (parsed === null) {
        truncated = true;
      } else {
        const firstSequence = this.entries[0] ? this.parseCursor(this.entries[0].cursor) : null;
        if (firstSequence !== null && parsed < firstSequence - 1) {
          truncated = true;
        } else {
          startIndex = this.entries.findIndex((entry) => {
            const sequence = this.parseCursor(entry.cursor);
            return sequence !== null && sequence > parsed;
          });
          if (startIndex < 0) startIndex = this.entries.length;
        }
      }
    }
    const items = this.entries.slice(startIndex, startIndex + boundedLimit);
    return {
      items,
      nextCursor: items.at(-1)?.cursor ?? after ?? "",
      truncated
    };
  }

  recent(limit = this.maxLines): LogEntry[] {
    return this.entries.slice(-Math.max(0, limit));
  }

  currentOffset(): number {
    return this.offset;
  }

  private async pollFile(): Promise<void> {
    const filePath = resolve(this.options.filePath);
    const logsPath = dirname(filePath);
    const rootPath = dirname(logsPath);
    let rootReal: string;
    let logsReal: string;
    let fileReal: string;
    let fileLinkStat;
    try {
      const logsLinkStat = await lstat(logsPath);
      fileLinkStat = await lstat(filePath, { bigint: true });
      if (
        logsLinkStat.isSymbolicLink() ||
        !logsLinkStat.isDirectory() ||
        fileLinkStat.isSymbolicLink() ||
        !fileLinkStat.isFile()
      ) return;
      [rootReal, logsReal, fileReal] = await Promise.all([
        realpath(rootPath),
        realpath(logsPath),
        realpath(filePath)
      ]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (
      normalize(dirname(logsReal)) !== normalize(rootReal) ||
      normalize(dirname(fileReal)) !== normalize(logsReal) ||
      normalize(fileReal) !== normalize(filePath)
    ) return;

    const handle = await open(filePath, "r");
    try {
      const fileStat = await handle.stat({ bigint: true });
      if (
        !fileStat.isFile() ||
        fileStat.dev !== fileLinkStat.dev ||
        fileStat.ino !== fileLinkStat.ino
      ) return;

      const identity = `${fileStat.dev}:${fileStat.ino}`;
      if (this.fileIdentity === null) {
        this.fileIdentity = identity;
        this.offset = Number(fileStat.size > BigInt(this.initialTailBytes)
          ? fileStat.size - BigInt(this.initialTailBytes)
          : 0n);
        if (this.offset > 0) await this.discardInitialPartialLine(handle);
      } else if (identity !== this.fileIdentity || fileStat.size < BigInt(this.offset)) {
        this.fileIdentity = identity;
        this.offset = 0;
        this.fileAssembler.reset();
      }
      const size = Number(fileStat.size);
      if (size <= this.offset) return;
      while (this.offset < size) {
        const length = Math.min(READ_CHUNK_BYTES, size - this.offset);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        this.fileAssembler.consume(buffer.subarray(0, bytesRead), (line) => {
          this.emitLine(line, "latest.log");
        });
      }
    } finally {
      await handle.close();
    }
  }

  private async discardInitialPartialLine(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, this.initialTailBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    this.offset += newline >= 0 ? newline + 1 : bytesRead;
  }

  private emitLine(line: Buffer, source: LogEntry["source"]): void {
    const text = this.redactor.redactText(line.toString("utf8"));
    this.sequence += 1;
    const cursor = `${this.cursorPrefix}:${this.sequence}`;
    const entry: LogEntry = {
      id: `log-${cursor}`,
      cursor,
      timestamp: timestampFor(text),
      level: levelFor(text),
      text,
      source
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxLines) this.entries.splice(0, this.entries.length - this.maxLines);
    this.options.onEntry?.(entry);
  }

  private parseCursor(cursor: string): number | null {
    const prefix = `${this.cursorPrefix}:`;
    if (!cursor.startsWith(prefix)) return null;
    const sequence = Number(cursor.slice(prefix.length));
    return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
  }
}
