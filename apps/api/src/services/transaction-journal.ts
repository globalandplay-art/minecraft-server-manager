import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename, stat } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1 as const;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS = 10_000;
const MAX_CHECKPOINTS = 256;
const SERVER_ID = /^[a-z0-9](?:[a-z0-9-]{0,62})$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHECKPOINT_NAME = /^[a-z][a-z0-9-]{0,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export type TransactionKind =
  | "backup"
  | "restore"
  | "rollback"
  | "world-create"
  | "world-import"
  | "world-archive";
export type TransactionState = "active" | "recovery-required" | "committed" | "rolled-back";
export type JournalPathRole = "source" | "target" | "staging" | "rollback" | "archive";

export interface TransactionPath {
  readonly role: JournalPathRole;
  readonly relativePath: string;
}

export interface TransactionIntent {
  readonly operationId: string;
  readonly serverId: string;
  readonly kind: TransactionKind;
  readonly scope: "world-set" | "server-snapshot" | null;
  readonly resourceId: string | null;
  readonly allowStop: boolean;
  readonly originalState: "running" | "stopped" | "unknown";
  readonly paths: readonly TransactionPath[];
  readonly createdAt: string;
}

export interface CheckpointDetails {
  readonly relativePath?: string;
  readonly checksumSha256?: string;
  readonly resourceId?: string;
}

export interface TransactionCheckpoint {
  readonly sequence: number;
  readonly name: string;
  readonly recordedAt: string;
  readonly details?: CheckpointDetails;
}

export interface TransactionJournalRecord {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly transactionId: string;
  readonly intent: TransactionIntent;
  readonly state: TransactionState;
  readonly checkpoints: readonly TransactionCheckpoint[];
  readonly updatedAt: string;
}

export interface JournalIssue {
  readonly kind: "corrupt-record" | "orphan-temp" | "duplicate-operation";
  readonly serverId: string | null;
  readonly fileName: string;
}

export interface JournalScanResult {
  readonly records: readonly TransactionJournalRecord[];
  readonly recoveryServerIds: ReadonlySet<string>;
  readonly issues: readonly JournalIssue[];
}

export interface CreateTransactionIntent extends Omit<TransactionIntent, "createdAt"> {
  readonly transactionId?: string;
  readonly createdAt: string;
}

export interface NewCheckpoint {
  readonly name: string;
  readonly recordedAt: string;
  readonly details?: CheckpointDetails;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 &&
    /^[a-zA-Z0-9._-]+$/u.test(value);
}

function normalizeRelativePath(value: string): string {
  if (value.length < 1 || value.length > 240 || /[\u0000-\u001f\u007f:]/u.test(value)) {
    throw new Error("Invalid transaction journal relative path");
  }
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    path.posix.isAbsolute(normalized) || path.win32.isAbsolute(value) ||
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".." || /[. ]$/u.test(segment) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)
    )
  ) {
    throw new Error("Invalid transaction journal relative path");
  }
  return normalized;
}

function validateIntent(value: unknown): value is TransactionIntent {
  if (!isObject(value) || !hasOnlyKeys(value, [
    "operationId", "serverId", "kind", "scope", "resourceId", "allowStop",
    "originalState", "paths", "createdAt"
  ])) return false;
  if (!UUID.test(String(value.operationId)) || !SERVER_ID.test(String(value.serverId))) return false;
  if (!(["backup", "restore", "rollback", "world-create", "world-import", "world-archive"] as unknown[])
    .includes(value.kind)) return false;
  if (!["world-set", "server-snapshot", null].includes(value.scope as never)) return false;
  if (value.resourceId !== null && !isOpaqueId(value.resourceId)) return false;
  if (typeof value.allowStop !== "boolean" || !["running", "stopped", "unknown"].includes(String(value.originalState))) return false;
  if (!Array.isArray(value.paths) || value.paths.length > 16 || !isTimestamp(value.createdAt)) return false;
  const roles = new Set<string>();
  for (const item of value.paths) {
    if (!isObject(item) || !hasOnlyKeys(item, ["role", "relativePath"])) return false;
    if (!["source", "target", "staging", "rollback", "archive"].includes(String(item.role))) return false;
    if (roles.has(String(item.role)) || typeof item.relativePath !== "string") return false;
    roles.add(String(item.role));
    try {
      if (normalizeRelativePath(item.relativePath) !== item.relativePath) return false;
    } catch { return false; }
  }
  return true;
}

function validateDetails(value: unknown): value is CheckpointDetails {
  if (!isObject(value) || !hasOnlyKeys(value, ["relativePath", "checksumSha256", "resourceId"])) return false;
  if (value.relativePath !== undefined) {
    if (typeof value.relativePath !== "string") return false;
    try {
      if (normalizeRelativePath(value.relativePath) !== value.relativePath) return false;
    } catch { return false; }
  }
  if (value.checksumSha256 !== undefined &&
      (typeof value.checksumSha256 !== "string" || !SHA256.test(value.checksumSha256))) return false;
  return value.resourceId === undefined || isOpaqueId(value.resourceId);
}

function validateRecord(value: unknown): value is TransactionJournalRecord {
  if (!isObject(value) || !hasOnlyKeys(value, [
    "schemaVersion", "transactionId", "intent", "state", "checkpoints", "updatedAt"
  ])) return false;
  if (value.schemaVersion !== SCHEMA_VERSION || !UUID.test(String(value.transactionId)) ||
      !validateIntent(value.intent) ||
      !["active", "recovery-required", "committed", "rolled-back"].includes(String(value.state)) ||
      !Array.isArray(value.checkpoints) || value.checkpoints.length > MAX_CHECKPOINTS ||
      !isTimestamp(value.updatedAt)) return false;
  let previousTime = Date.parse(value.intent.createdAt);
  for (let index = 0; index < value.checkpoints.length; index += 1) {
    const checkpoint = value.checkpoints[index];
    if (!isObject(checkpoint) || !hasOnlyKeys(checkpoint, ["sequence", "name", "recordedAt", "details"]) ||
        checkpoint.sequence !== index + 1 || !CHECKPOINT_NAME.test(String(checkpoint.name)) ||
        !isTimestamp(checkpoint.recordedAt) ||
        (checkpoint.details !== undefined && !validateDetails(checkpoint.details))) return false;
    const checkpointTime = Date.parse(checkpoint.recordedAt);
    if (checkpointTime < previousTime) return false;
    previousTime = checkpointTime;
  }
  return Date.parse(value.updatedAt) >= previousTime;
}

function recordFileName(serverId: string, transactionId: string): string {
  return `${serverId}.${transactionId}.json`;
}

function identityFromFileName(fileName: string): { serverId: string; transactionId: string } | null {
  const match = /^([a-z0-9](?:[a-z0-9-]{0,62}))\.([0-9a-f-]{36})\.json$/iu.exec(fileName);
  if (!match?.[1] || !match[2] || !SERVER_ID.test(match[1]) || !UUID.test(match[2])) return null;
  return { serverId: match[1], transactionId: match[2].toLowerCase() };
}

function tempServerId(fileName: string): string | null {
  const match = /^([a-z0-9](?:[a-z0-9-]{0,62}))\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.tmp$/iu.exec(fileName);
  return match?.[1] && SERVER_ID.test(match[1]) ? match[1] : null;
}

async function readBounded(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_RECORD_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_RECORD_BYTES) throw new Error("Transaction journal record too large");
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

export class TransactionJournalStore {
  readonly #managerRoot: string;
  readonly #directory: string;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(managerRoot: string) {
    this.#managerRoot = path.resolve(managerRoot);
    this.#directory = path.join(this.#managerRoot, "transactions");
  }

  async initialize(): Promise<JournalScanResult> {
    await mkdir(this.#managerRoot, { recursive: true, mode: 0o700 });
    const managerInfo = await lstat(this.#managerRoot);
    if (!managerInfo.isDirectory() || managerInfo.isSymbolicLink()) {
      throw new Error("Transaction manager root must be a real directory");
    }
    const managerRealPath = await realpath(this.#managerRoot);
    const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalized(managerRealPath) !== normalized(this.#managerRoot)) {
      throw new Error("Transaction manager root must be canonical");
    }
    await mkdir(this.#directory, { recursive: true });
    const directoryInfo = await lstat(this.#directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("Transaction journal directory must be a real directory");
    }
    const directoryRealPath = await realpath(this.#directory);
    const expectedDirectory = path.join(managerRealPath, "transactions");
    if (normalized(directoryRealPath) !== normalized(expectedDirectory) ||
        !normalized(directoryRealPath).startsWith(`${normalized(managerRealPath)}${path.sep}`)) {
      throw new Error("Transaction journal directory escapes manager root");
    }
    return this.scan();
  }

  async scan(): Promise<JournalScanResult> {
    const entries = await readdir(this.#directory, { withFileTypes: true });
    if (entries.length > MAX_RECORDS) throw new Error("Too many transaction journal files");
    const records: TransactionJournalRecord[] = [];
    const issues: JournalIssue[] = [];
    const recovery = new Set<string>();
    const operationOwners = new Map<string, TransactionJournalRecord>();

    for (const entry of entries) {
      const identity = identityFromFileName(entry.name);
      if (identity === null) {
        const serverId = tempServerId(entry.name);
        if (serverId !== null) {
          recovery.add(serverId);
          issues.push({ kind: "orphan-temp", serverId, fileName: entry.name });
        } else if (entry.name.endsWith(".json") || entry.name.endsWith(".tmp")) {
          throw new Error("Unattributable transaction journal file");
        }
        continue;
      }
      if (!entry.isFile()) {
        recovery.add(identity.serverId);
        issues.push({ kind: "corrupt-record", serverId: identity.serverId, fileName: entry.name });
        continue;
      }
      try {
        const raw = await readBounded(path.join(this.#directory, entry.name));
        const value: unknown = JSON.parse(raw);
        if (!validateRecord(value) || value.transactionId.toLowerCase() !== identity.transactionId ||
            value.intent.serverId !== identity.serverId) throw new Error("invalid");
        records.push(value);
        if (value.state === "active" || value.state === "recovery-required") recovery.add(value.intent.serverId);
        const existing = operationOwners.get(value.intent.operationId);
        if (existing !== undefined) {
          recovery.add(existing.intent.serverId);
          recovery.add(value.intent.serverId);
          issues.push({ kind: "duplicate-operation", serverId: value.intent.serverId, fileName: entry.name });
        } else {
          operationOwners.set(value.intent.operationId, value);
        }
      } catch {
        recovery.add(identity.serverId);
        issues.push({ kind: "corrupt-record", serverId: identity.serverId, fileName: entry.name });
      }
    }
    return { records: structuredClone(records), recoveryServerIds: recovery, issues };
  }

  async createIntent(input: CreateTransactionIntent): Promise<TransactionJournalRecord> {
    return this.#mutate(async () => {
      const transactionId = (input.transactionId ?? randomUUID()).toLowerCase();
      const intent: TransactionIntent = {
        operationId: input.operationId,
        serverId: input.serverId,
        kind: input.kind,
        scope: input.scope,
        resourceId: input.resourceId,
        allowStop: input.allowStop,
        originalState: input.originalState,
        paths: input.paths.map((item) => ({ ...item, relativePath: normalizeRelativePath(item.relativePath) })),
        createdAt: input.createdAt
      };
      const record: TransactionJournalRecord = {
        schemaVersion: SCHEMA_VERSION,
        transactionId,
        intent,
        state: "active",
        checkpoints: [],
        updatedAt: input.createdAt
      };
      if (!validateRecord(record)) throw new Error("Invalid transaction journal intent");
      const target = this.#target(intent.serverId, transactionId);
      try { await stat(target); throw new Error("Transaction journal already exists"); }
      catch (error) {
        if (error instanceof Error && error.message === "Transaction journal already exists") throw error;
        if (!isObject(error) || error.code !== "ENOENT") throw error;
      }
      await this.#write(record);
      return structuredClone(record);
    });
  }

  async appendCheckpoint(
    serverId: string,
    transactionId: string,
    checkpoint: NewCheckpoint
  ): Promise<TransactionJournalRecord> {
    return this.#mutate(async () => {
      const current = await this.#read(serverId, transactionId);
      if (current.state !== "active" && current.state !== "recovery-required") {
        throw new Error("Cannot append to a terminal transaction journal");
      }
      const next: TransactionJournalRecord = {
        ...current,
        checkpoints: [...current.checkpoints, {
          sequence: current.checkpoints.length + 1,
          name: checkpoint.name,
          recordedAt: checkpoint.recordedAt,
          ...(checkpoint.details === undefined ? {} : {
            details: {
              ...checkpoint.details,
              ...(checkpoint.details.relativePath === undefined ? {} : {
                relativePath: normalizeRelativePath(checkpoint.details.relativePath)
              })
            }
          })
        }],
        updatedAt: checkpoint.recordedAt
      };
      if (!validateRecord(next)) throw new Error("Invalid transaction journal checkpoint");
      await this.#write(next);
      return structuredClone(next);
    });
  }

  async setState(
    serverId: string,
    transactionId: string,
    state: Exclude<TransactionState, "active">,
    updatedAt: string
  ): Promise<TransactionJournalRecord> {
    return this.#mutate(async () => {
      const current = await this.#read(serverId, transactionId);
      if (current.state === "committed" || current.state === "rolled-back") {
        if (current.state === state) return structuredClone(current);
        throw new Error("Cannot change a terminal transaction journal");
      }
      const next: TransactionJournalRecord = { ...current, state, updatedAt };
      if (!validateRecord(next)) throw new Error("Invalid transaction journal state");
      await this.#write(next);
      return structuredClone(next);
    });
  }

  async #read(serverId: string, transactionId: string): Promise<TransactionJournalRecord> {
    if (!SERVER_ID.test(serverId) || !UUID.test(transactionId)) throw new Error("Invalid transaction identity");
    const raw = await readBounded(this.#target(serverId, transactionId.toLowerCase()));
    const value: unknown = JSON.parse(raw);
    if (!validateRecord(value) || value.intent.serverId !== serverId ||
        value.transactionId.toLowerCase() !== transactionId.toLowerCase()) {
      throw new Error("Invalid transaction journal record");
    }
    return value;
  }

  #target(serverId: string, transactionId: string): string {
    return path.join(this.#directory, recordFileName(serverId, transactionId));
  }

  async #write(record: TransactionJournalRecord): Promise<void> {
    const target = this.#target(record.intent.serverId, record.transactionId);
    const temporary = path.join(
      this.#directory,
      `${record.intent.serverId}.${record.transactionId}.${randomUUID()}.tmp`
    );
    const payload = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(payload, "utf8") > MAX_RECORD_BYTES) throw new Error("Transaction journal record too large");
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    try {
      const directory = await open(this.#directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      const code = isObject(error) && typeof error.code === "string" ? error.code : null;
      const unsupported = code === "EINVAL" || code === "ENOTSUP" ||
        (process.platform === "win32" && ["EACCES", "EISDIR", "EPERM"].includes(code ?? ""));
      if (!unsupported) throw error;
    }
  }

  async #mutate<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release = () => {};
    this.#mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }
}
