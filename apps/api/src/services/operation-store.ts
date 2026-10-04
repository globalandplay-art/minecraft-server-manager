import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename } from "node:fs/promises";
import path from "node:path";

import { Value } from "@sinclair/typebox/value";
import { operationSchema, type Operation } from "@mcsm/contracts";

export interface StoredOperation {
  readonly operation: Operation;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly expiresAt: string;
}

export interface OperationStore {
  initialize(): Promise<void>;
  list(): Promise<StoredOperation[]>;
  save(record: StoredOperation): Promise<void>;
}

function isStoredOperation(value: unknown): value is StoredOperation {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Value.Check(operationSchema, record.operation) &&
    typeof record.idempotencyKey === "string" &&
    typeof record.requestFingerprint === "string" &&
    typeof record.expiresAt === "string"
  );
}

export class JsonOperationStore implements OperationStore {
  readonly #managerRoot: string;
  readonly #directory: string;

  constructor(managerRoot: string) {
    this.#managerRoot = path.resolve(managerRoot);
    this.#directory = path.join(this.#managerRoot, "operations");
  }

  async initialize(): Promise<void> {
    await mkdir(this.#managerRoot, { recursive: true, mode: 0o700 });
    await this.#plainDirectory(this.#managerRoot);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await this.#validateDirectories();
  }

  async list(): Promise<StoredOperation[]> {
    await this.#validateDirectories();
    const entries = (await readdir(this.#directory, { withFileTypes: true }))
      .filter((entry) => /^[0-9a-f-]{36}\.json$/u.test(entry.name));
    if (entries.length > 10_000) {
      throw new Error("Too many operation records; refusing unsafe startup truncation");
    }
    const records: StoredOperation[] = [];
    for (const entry of entries) {
      const file = path.join(this.#directory, entry.name);
      const info = await this.#recordInfo(file);
      const handle = await open(file, "r");
      let raw: string;
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino ||
          opened.size !== info.size || opened.mtimeMs !== info.mtimeMs) throw new Error("Invalid operation record");
        const buffer = Buffer.alloc(info.size);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const after = await handle.stat();
        if (bytesRead !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.nlink !== 1) {
          throw new Error("Invalid operation record");
        }
        raw = buffer.toString("utf8");
      } finally { await handle.close(); }
      const value: unknown = JSON.parse(raw);
      if (!isStoredOperation(value) || `${value.operation.id}.json` !== entry.name) {
        throw new Error("Invalid operation record");
      }
      records.push(value);
    }
    return records;
  }

  async save(record: StoredOperation): Promise<void> {
    if (!isStoredOperation(record) || !/^[0-9a-f-]{36}$/u.test(record.operation.id)) throw new Error("Invalid operation record");
    await this.#validateDirectories();
    const target = path.join(this.#directory, `${record.operation.id}.json`);
    const temporary = path.join(this.#directory, `${record.operation.id}.${randomUUID()}.tmp`);
    const payload = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(payload, "utf8") > 64 * 1024) throw new Error("Invalid operation record");
    await this.#validateTarget(target);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.#validateDirectories();
    await this.#validateTarget(target);
    await rename(temporary, target);
  }

  async #plainDirectory(directory: string): Promise<void> {
    const info = await lstat(directory);
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (!info.isDirectory() || info.isSymbolicLink() || normalize(await realpath(directory)) !== normalize(directory)) {
      throw new Error("Unsafe operation store directory");
    }
  }

  async #validateDirectories(): Promise<void> {
    await this.#plainDirectory(this.#managerRoot);
    await this.#plainDirectory(this.#directory);
  }

  async #recordInfo(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 64 * 1024) {
      throw new Error("Invalid operation record");
    }
    return info;
  }

  async #validateTarget(file: string): Promise<void> {
    try { await this.#recordInfo(file); }
    catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}

export class MemoryOperationStore implements OperationStore {
  readonly #records = new Map<string, StoredOperation>();
  failWrites = false;

  async initialize(): Promise<void> {}

  async list(): Promise<StoredOperation[]> {
    return structuredClone([...this.#records.values()]);
  }

  async save(record: StoredOperation): Promise<void> {
    if (this.failWrites) throw new Error("operation-store-write-failed");
    this.#records.set(record.operation.id, structuredClone(record));
  }
}
