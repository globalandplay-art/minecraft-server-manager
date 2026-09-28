import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
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
  readonly #directory: string;

  constructor(managerRoot: string) {
    this.#directory = path.join(managerRoot, "operations");
  }

  async initialize(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
  }

  async list(): Promise<StoredOperation[]> {
    const entries = (await readdir(this.#directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/u.test(entry.name))
    if (entries.length > 10_000) {
      throw new Error("Too many operation records; refusing unsafe startup truncation");
    }
    const records: StoredOperation[] = [];
    for (const entry of entries) {
      const raw = await readFile(path.join(this.#directory, entry.name), "utf8");
      if (Buffer.byteLength(raw, "utf8") > 64 * 1024) {
        throw new Error("Invalid operation record");
      }
      const value: unknown = JSON.parse(raw);
      if (!isStoredOperation(value)) {
        throw new Error("Invalid operation record");
      }
      records.push(value);
    }
    return records;
  }

  async save(record: StoredOperation): Promise<void> {
    const target = path.join(this.#directory, `${record.operation.id}.json`);
    const temporary = path.join(this.#directory, `${record.operation.id}.${randomUUID()}.tmp`);
    const payload = `${JSON.stringify(record)}\n`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
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
