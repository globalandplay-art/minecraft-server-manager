import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Operation } from "@mcsm/contracts";
import type { RuntimeOperationContext } from "../infra/runtime-contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import type { BackupService } from "./backup-service.js";
import { DomainError } from "./domain-errors.js";
import { ADDON_LIMITS, AddonInventory, addonProfile, safeAddonFilename } from "./addon-inventory.js";
import { captureAddonAdapterIdentity, type AddonAdapterIdentity } from "./addon-adapter-identity.js";
import type { OperationService } from "./operation-service.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";

type Action = "disable" | "enable" | "trash" | "restore";
type State = "enabled" | "disabled" | "trashed";
type Receipt = {
  schemaVersion: 1; serverId: string; adapterIdentitySha256: string; rootIdentity: string; addonRootIdentity: string;
  id: string; addonId: string; kind: "mod" | "plugin"; filename: string; originalState: "enabled" | "disabled";
  sizeBytes: number; sha256: string; physicalIdentity: string; createdAt: string;
  name: string | null; version: string | null; loader: "fabric" | "paper" | null;
  compatibility: "unknown"; minecraftConstraint: string[] | null; metadataStatus: "parsed" | "invalid" | "missing";
  sourceDirectoryIdentity: string; entryDirectoryIdentity: string;
};
type Item = Awaited<ReturnType<AddonInventory["read"]>>["items"][number];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hashPattern = /^[a-f0-9]{64}$/u;
const denied = () => new DomainError(409, "ADDON_LIFECYCLE_RECOVERY_REQUIRED", "扩展变更需要人工检查；所有文件和保护证据均已保留", "addon-lifecycle-uncertain", true);
const conflict = () => new DomainError(409, "ADDON_REVISION_CONFLICT", "扩展状态已变化，请刷新后重新确认", "addon-revision-conflict");
const missing = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
function contained(parent: string, child: string) {
  const relative = path.relative(normalized(path.resolve(parent)), normalized(path.resolve(child)));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function physicalIdentity(info: Awaited<ReturnType<typeof lstat>>) {
  return createHash("sha256").update(`${info.dev}\0${info.ino}`).digest("hex");
}
async function syncDirectory(directory: string) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (!(process.platform === "win32" && ["EACCES", "EISDIR", "EPERM"].includes(String(code)))) throw error;
  } finally { await handle.close(); }
}
async function directoryIdentity(directory: string): Promise<string> {
  const info = await lstat(directory), canonical = await realpath(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || normalized(canonical) !== normalized(path.resolve(directory))) throw denied();
  return backupDirectoryIdentity(directory);
}
async function ensureDirectory(root: string, parts: string[]): Promise<{ path: string; identity: string }> {
  let current = root;
  await directoryIdentity(root);
  for (const part of parts) {
    if (!part || part === "." || part === ".." || part.includes(path.sep)) throw denied();
    current = path.join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (!((error as NodeJS.ErrnoException).code === "EEXIST")) throw error; }
    await directoryIdentity(current);
  }
  return { path: current, identity: await backupDirectoryIdentity(current) };
}
async function fileAt(file: string, maxBytes = ADDON_LIMITS.jarBytes, linkCount = 1) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== linkCount || before.size <= 0 || before.size > maxBytes ||
    normalized(await realpath(file)) !== normalized(path.resolve(file))) throw denied();
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw denied();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) throw denied();
      offset += result.bytesRead;
    }
    const after = await handle.stat(), named = await lstat(file);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs || named.dev !== before.dev || named.ino !== before.ino || named.nlink !== linkCount || named.size !== before.size) throw denied();
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), physicalIdentity: physicalIdentity(before), sizeBytes: before.size };
  } finally { await handle.close(); }
}
async function pathExists(file: string) {
  try { await lstat(file); return true; } catch (error) { if (missing(error)) return false; throw error; }
}
async function exclusiveJson(file: string, value: unknown) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
}
function validReceipt(value: unknown, serverId: string, id: string): value is Receipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ["schemaVersion", "serverId", "adapterIdentitySha256", "rootIdentity", "addonRootIdentity", "id", "addonId", "kind", "filename", "originalState", "sizeBytes", "sha256", "physicalIdentity", "createdAt", "name", "version", "loader", "compatibility", "minecraftConstraint", "metadataStatus", "sourceDirectoryIdentity", "entryDirectoryIdentity"];
  return Object.keys(v).length === keys.length && Object.keys(v).every((key) => keys.includes(key)) && v.schemaVersion === 1 && v.serverId === serverId && v.id === id &&
    typeof v.adapterIdentitySha256 === "string" && hashPattern.test(v.adapterIdentitySha256) && typeof v.rootIdentity === "string" && hashPattern.test(v.rootIdentity) &&
    typeof v.addonRootIdentity === "string" && hashPattern.test(v.addonRootIdentity) && typeof v.addonId === "string" && hashPattern.test(v.addonId) &&
    (v.kind === "mod" || v.kind === "plugin") && typeof v.filename === "string" && safeAddonFilename(v.filename) && (v.originalState === "enabled" || v.originalState === "disabled") &&
    Number.isSafeInteger(v.sizeBytes) && Number(v.sizeBytes) > 0 && Number(v.sizeBytes) <= ADDON_LIMITS.jarBytes && typeof v.sha256 === "string" && hashPattern.test(v.sha256) &&
    typeof v.physicalIdentity === "string" && hashPattern.test(v.physicalIdentity) && typeof v.createdAt === "string" && !Number.isNaN(Date.parse(v.createdAt)) &&
    (v.name === null || (typeof v.name === "string" && v.name.length <= 128)) && (v.version === null || (typeof v.version === "string" && v.version.length <= 128)) &&
    (v.loader === null || (v.kind === "mod" ? v.loader === "fabric" : v.loader === "paper")) &&
    v.compatibility === "unknown" && (v.minecraftConstraint === null || (Array.isArray(v.minecraftConstraint) && v.minecraftConstraint.length <= 16 && v.minecraftConstraint.every((x) => typeof x === "string" && x.length <= 128))) &&
    ["parsed", "invalid", "missing"].includes(String(v.metadataStatus)) && typeof v.sourceDirectoryIdentity === "string" && hashPattern.test(v.sourceDirectoryIdentity) &&
    typeof v.entryDirectoryIdentity === "string" && hashPattern.test(v.entryDirectoryIdentity);
}

/** P5.3 lifecycle writes are serialized by OperationService and always retain a complete pinned guard. */
export class AddonLifecycleService {
  private readonly managerRoot: string;
  readonly #revisionKey = randomBytes(32);
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly journal: TransactionJournalStore, private readonly backups: BackupService,
    private readonly inventory: AddonInventory, managerRoot: string, private readonly clock: Clock,
    private readonly inject?: (point: string) => Promise<void>,
    private readonly captureIdentity: typeof captureAddonAdapterIdentity = captureAddonAdapterIdentity) {
    this.managerRoot = path.resolve(managerRoot);
  }

  async listTrash(serverId: string, ownerOperationId?: string, preflight = false) {
    if (!ownerOperationId && !preflight) {
      try { return await this.operations.runReadAdmission(serverId, () => this.#listTrash(serverId)); }
      catch (error) {
        if (error instanceof DomainError && error.code === "OPERATION_CONFLICT") {
          throw new DomainError(409, "ADDON_LIFECYCLE_BUSY", "扩展状态操作正在进行，请稍后重试", "addon-lifecycle-busy");
        }
        throw error;
      }
    }
    if (ownerOperationId && this.operations.getServerState(serverId).activeOperationId !== ownerOperationId) throw denied();
    return this.#listTrash(serverId);
  }

  async #listTrash(serverId: string) {
    const adapter = this.#adapter(serverId), profile = addonProfile(adapter.plan.serverInfo.type);
    if (!profile) throw new DomainError(501, "ADDON_UNSUPPORTED", "回收区仅支持已验证的 Paper/Fabric", "addon-profile-unsupported");
    const identity = await this.captureIdentity(adapter);
    try {
    const base = path.join(adapter.plan.rootPath, "trash", "addons", serverId);
    const journalScan = await this.journal.scan();
    if (journalScan.issues.some((issue) => issue.serverId === serverId)) throw denied();
    for (const record of journalScan.records) {
      const lifecycle = record.intent.addonLifecycle;
      if (record.intent.serverId !== serverId || lifecycle?.action !== "trash" || record.state !== "committed" ||
        lifecycle.rootIdentity !== identity.rootIdentity) continue;
      const entry = path.join(base, lifecycle.trashId ?? "");
      if (!lifecycle.trashId || !await pathExists(entry)) {
        this.operations.requireTransactionRecovery(serverId, record.intent.operationId);
        throw denied();
      }
    }
    const items: { id: string; addonId: string; kind: "mod" | "plugin"; filename: string; originalState: "enabled" | "disabled";
      sizeBytes: number; sha256: string; name: string | null; version: string | null; loader: "fabric" | "paper" | null;
      compatibility: "unknown"; minecraftConstraint: string[] | null; metadataStatus: "parsed" | "invalid" | "missing"; createdAt: string; restoreAllowed: true }[] = [];
    if (await pathExists(base)) {
      await directoryIdentity(path.dirname(path.dirname(base)));
      const baseIdentity = await directoryIdentity(base);
      const names = await readdir(base);
      if (names.length > ADDON_LIMITS.files) throw denied();
      const seen = new Set<string>();
      for (const id of names.sort()) {
        if (!uuid.test(id) || seen.has(id)) throw denied(); seen.add(id);
        const entry = path.join(base, id), entryId = await directoryIdentity(entry);
        const children = (await readdir(entry)).sort();
        if (children.length === 0) {
          const scan = await this.journal.scan(), outcomes = new Map((await this.operations.storedOutcomes()).map((operation) => [operation.id, operation]));
          const unused = scan.records.find((record) => record.intent.serverId === serverId && record.intent.addonLifecycle?.action === "trash" &&
            record.intent.addonLifecycle.trashId === id && record.state === "rolled-back");
          const outcome = unused ? outcomes.get(unused.intent.operationId) : undefined;
          const confirmedNotApplied = outcome?.state === "failed" && outcome.error?.code === "ADDON_LIFECYCLE_NOT_APPLIED" ||
            outcome?.state === "interrupted" && this.operations.isPhysicalTransactionConfirmed(unused?.intent.operationId ?? "");
          if (!unused || scan.issues.some((issue) => issue.serverId === serverId) || !confirmedNotApplied) throw denied();
          if (await directoryIdentity(entry) !== entryId) throw denied();
          continue;
        }
        if (!children.includes("receipt.json") || children.some((x) => !["receipt.json", "payload.jar", "restored.json"].includes(x))) throw denied();
        const receiptBytes = await readPrivatePropertiesFile(path.join(entry, "receipt.json"), 16 * 1024);
        const receiptValue: unknown = JSON.parse(receiptBytes.bytes.toString("utf8"));
        if (!validReceipt(receiptValue, serverId, id)) throw denied();
        const receipt = receiptValue;
        if (receipt.rootIdentity !== identity.rootIdentity || receipt.adapterIdentitySha256 !== identity.identitySha256 ||
          receipt.addonRootIdentity !== identity.addonRootIdentity || receipt.kind !== profile.kind || receipt.entryDirectoryIdentity !== entryId) throw denied();
        await this.#assertTrashJournal(receipt);
        if (children.includes("restored.json")) {
          if (children.includes("payload.jar")) throw denied();
          await this.#assertRestoredJournal(adapter, receipt);
          continue;
        }
        if (!children.includes("payload.jar")) throw denied();
        const payload = await fileAt(path.join(entry, "payload.jar"));
        if (payload.sha256 !== receipt.sha256 || payload.physicalIdentity !== receipt.physicalIdentity || payload.sizeBytes !== receipt.sizeBytes) throw denied();
        items.push({ id, addonId: receipt.addonId, kind: receipt.kind, filename: receipt.filename, originalState: receipt.originalState,
          sizeBytes: receipt.sizeBytes, sha256: receipt.sha256, name: receipt.name, version: receipt.version, loader: receipt.loader,
          compatibility: "unknown", minecraftConstraint: receipt.minecraftConstraint, metadataStatus: receipt.metadataStatus,
          createdAt: receipt.createdAt, restoreAllowed: true });
      }
      if (await directoryIdentity(base) !== baseIdentity) throw denied();
    }
    const revision = createHmac("sha256", this.#revisionKey).update(JSON.stringify({ serverId, root: identity.rootIdentity, items })).digest("hex");
    return { items, revision };
    } catch (error) {
      this.operations.requireRecovery([serverId]);
      throw error;
    }
  }

  async mutate(serverId: string, addonId: string, action: "disable" | "enable" | "trash", revision: string, key: string): Promise<Operation> {
    return this.#mutate(serverId, addonId, action, revision, key);
  }
  async restore(serverId: string, trashId: string, revision: string, key: string): Promise<Operation> {
    if (!uuid.test(trashId)) throw new DomainError(400, "VALIDATION_ERROR", "回收区标识无效", "invalid-addon-trash-id");
    return this.#mutate(serverId, trashId, "restore", revision, key);
  }

  async #mutate(serverId: string, id: string, action: Action, revision: string, key: string) {
    if ((!hashPattern.test(id) && action !== "restore") || (action === "restore" && !uuid.test(id)) || !hashPattern.test(revision) || !uuid.test(key)) {
      throw new DomainError(400, "VALIDATION_ERROR", "扩展状态变更确认无效", "invalid-addon-lifecycle-request");
    }
    let approved: AddonAdapterIdentity | undefined;
    let approvedItem: Item | undefined;
    let approvedReceipt: Receipt | undefined;
    const request = { id, action, revision };
    return this.operations.requestBackup(serverId, key, JSON.stringify(request), async (context) => {
      if (!approved) throw conflict();
      await this.#execute(serverId, id, action, revision, approved, approvedItem, approvedReceipt, context);
    }, async () => {
      const adapter = this.#adapter(serverId), profile = addonProfile(adapter.plan.serverInfo.type);
      if (!profile) throw new DomainError(501, "ADDON_UNSUPPORTED", "仅支持已验证的 Paper/Fabric 扩展", "addon-profile-unsupported");
      await this.#requireStopped(adapter);
      approved = await this.captureIdentity(adapter);
      if (!approved.addonRootIdentity) throw new DomainError(409, "ADDON_ROOT_UNAVAILABLE", "扩展目录身份无法核验", "addon-root-unavailable");
      if (action === "restore") {
        const trash = await this.listTrash(serverId, undefined, true);
        if (trash.revision !== revision) throw conflict();
        if (!trash.items.some((item) => item.id === id && item.restoreAllowed)) {
          if (await pathExists(path.join(this.#trashBase(adapter, serverId), id))) throw new DomainError(409, "ADDON_TRASH_CONSUMED", "此回收记录已恢复或不可用", "addon-trash-consumed");
          throw new DomainError(404, "ADDON_TRASH_NOT_FOUND", "未找到可恢复的扩展", "addon-trash-not-found");
        }
        const receipt = await this.#readReceipt(adapter, id, approved);
        approvedReceipt = receipt;
      } else {
        // Revalidate retained trash evidence before every later addon mutation.
        await this.listTrash(serverId, undefined, true);
        const listing = await this.inventory.read(serverId, adapter.plan.rootPath, adapter.plan.serverInfo.type);
        if (listing.revision !== revision) throw conflict();
        const item = listing.items.find((entry) => entry.id === id);
        if (!item) throw new DomainError(404, "ADDON_NOT_FOUND", "未找到扩展", "addon-not-found");
        if ((action === "disable" && item.state !== "enabled") || (action === "enable" && item.state !== "disabled")) {
          throw new DomainError(409, "ADDON_STATE_CONFLICT", "扩展当前状态不支持此操作", "addon-state-conflict");
        }
        approvedItem = item;
      }
    }, "addon-change");
  }

  #adapter(serverId: string) {
    const adapter = this.registry.getLocal(serverId);
    if (!adapter) throw new DomainError(501, "ADDON_UNSUPPORTED", "此操作仅支持注册的本地 Paper/Fabric 实例", "addon-local-required");
    return adapter;
  }
  async #requireStopped(adapter: NonNullable<ReturnType<AdapterRegistry["getLocal"]>>, operationId?: string) {
    const status = await adapter.getStatus(), operation = this.operations.getServerState(adapter.serverId);
    if (status.state !== "stopped" || status.ownership !== "none" || status.recoveryRequired || operation.recoveryRequired ||
      (status.activeOperationId && status.activeOperationId !== operationId) || (operation.activeOperationId && operation.activeOperationId !== operationId)) {
      throw new DomainError(409, "SERVER_MUST_BE_STOPPED", "扩展变更要求服务器已停止且无其他操作或恢复锁", "addon-lifecycle-not-admitted");
    }
  }
  #trashBase(adapter: NonNullable<ReturnType<AdapterRegistry["getLocal"]>>, serverId: string) { return path.join(adapter.plan.rootPath, "trash", "addons", serverId); }
  async #readReceipt(adapter: NonNullable<ReturnType<AdapterRegistry["getLocal"]>>, trashId: string, identity: AddonAdapterIdentity): Promise<Receipt> {
    const base = this.#trashBase(adapter, adapter.serverId), entry = path.join(base, trashId);
    const entryIdentity = await directoryIdentity(entry), bytes = await readPrivatePropertiesFile(path.join(entry, "receipt.json"), 16 * 1024);
    const value: unknown = JSON.parse(bytes.bytes.toString("utf8"));
    if (!validReceipt(value, adapter.serverId, trashId) || value.entryDirectoryIdentity !== entryIdentity || value.rootIdentity !== identity.rootIdentity ||
      value.adapterIdentitySha256 !== identity.identitySha256 || value.addonRootIdentity !== identity.addonRootIdentity) throw denied();
    const file = await fileAt(path.join(entry, "payload.jar"));
    if (file.physicalIdentity !== value.physicalIdentity || file.sha256 !== value.sha256 || file.sizeBytes !== value.sizeBytes) throw denied();
    await this.#assertTrashJournal(value);
    return value;
  }

  async #assertTrashJournal(receipt: Receipt): Promise<void> {
    const scan = await this.journal.scan();
    const source = scan.records.find((record) => record.intent.addonLifecycle?.action === "trash" &&
      record.intent.addonLifecycle.trashId === receipt.id && record.state === "committed");
    const lifecycle = source?.intent.addonLifecycle;
    if (!source || !lifecycle || scan.issues.some((issue) => issue.serverId === receipt.serverId) ||
      lifecycle.addonId !== receipt.addonId || lifecycle.kind !== receipt.kind || lifecycle.filename !== receipt.filename ||
      lifecycle.sourceState !== receipt.originalState || lifecycle.sourceSha256 !== receipt.sha256 || lifecycle.sourcePhysicalIdentity !== receipt.physicalIdentity ||
      lifecycle.rootIdentity !== receipt.rootIdentity || lifecycle.adapterIdentitySha256 !== receipt.adapterIdentitySha256 ||
      lifecycle.addonRootIdentity !== receipt.addonRootIdentity || lifecycle.sourceDirectoryIdentity !== receipt.sourceDirectoryIdentity ||
      lifecycle.targetDirectoryIdentity !== receipt.entryDirectoryIdentity || lifecycle.metadataName !== receipt.name || lifecycle.metadataVersion !== receipt.version ||
      lifecycle.metadataLoader !== receipt.loader || lifecycle.metadataStatus !== receipt.metadataStatus ||
      JSON.stringify(lifecycle.minecraftConstraint) !== JSON.stringify(receipt.minecraftConstraint)) throw denied();
    const guard = await this.backups.privateSnapshot(receipt.serverId, lifecycle.guardBackupId);
    if (!guard.pinned || guard.checksumSha256 !== lifecycle.guardChecksum || guard.serverType !== (receipt.kind === "plugin" ? "paper" : "fabric")) throw denied();
  }

  async #assertRestoredJournal(adapter: NonNullable<ReturnType<AdapterRegistry["getLocal"]>>, receipt: Receipt): Promise<void> {
    const entry = path.join(this.#trashBase(adapter, receipt.serverId), receipt.id);
    const marker = await readPrivatePropertiesFile(path.join(entry, "restored.json"), 16 * 1024);
    const value: unknown = JSON.parse(marker.bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw denied();
    const v = value as Record<string, unknown>;
    const keys = ["schemaVersion", "serverId", "trashId", "operationId", "addonId", "rootIdentity", "targetState", "filename", "sha256", "physicalIdentity"];
    if (Object.keys(v).length !== keys.length || !Object.keys(v).every((key) => keys.includes(key)) || v.schemaVersion !== 1 ||
      v.serverId !== receipt.serverId || v.trashId !== receipt.id || v.addonId !== receipt.addonId || v.rootIdentity !== receipt.rootIdentity ||
      v.filename !== receipt.filename || v.sha256 !== receipt.sha256 || v.physicalIdentity !== receipt.physicalIdentity ||
      !uuid.test(String(v.operationId)) || (v.targetState !== "enabled" && v.targetState !== "disabled")) throw denied();
    const scan = await this.journal.scan();
    const restore = scan.records.find((record) => record.intent.operationId === v.operationId && record.intent.addonLifecycle?.action === "restore" && record.state === "committed");
    const lifecycle = restore?.intent.addonLifecycle;
    const profile = addonProfile(adapter.plan.serverInfo.type);
    const recordedTarget = restore?.intent.paths.find((entry) => entry.role === "target" && entry.namespace === "server")?.relativePath;
    const expectedRestoreTarget = `${v.targetState === "enabled" ? profile?.enabled : profile?.disabled}/${receipt.filename}`;
    if (!restore || !lifecycle || scan.issues.some((issue) => issue.serverId === receipt.serverId) || lifecycle.trashId !== receipt.id ||
      lifecycle.addonId !== receipt.addonId || lifecycle.filename !== receipt.filename || lifecycle.targetState !== v.targetState ||
      lifecycle.kind !== receipt.kind || lifecycle.sourcePhysicalIdentity !== receipt.physicalIdentity || lifecycle.sourceSha256 !== receipt.sha256 ||
      lifecycle.rootIdentity !== receipt.rootIdentity || lifecycle.adapterIdentitySha256 !== receipt.adapterIdentitySha256 ||
      lifecycle.addonRootIdentity !== receipt.addonRootIdentity || !profile || profile.kind !== receipt.kind ||
      recordedTarget !== expectedRestoreTarget || lifecycle.targetDirectoryIdentity !== await directoryIdentity(path.dirname(path.join(adapter.plan.rootPath, ...recordedTarget.split("/"))))) throw denied();
    const restoreTargetRelative = `${v.targetState === "enabled" ? profile.enabled : profile.disabled}/${receipt.filename}`;
    const restoreTarget = path.join(adapter.plan.rootPath, ...restoreTargetRelative.split("/"));
    if (await pathExists(restoreTarget)) {
      if (await directoryIdentity(path.dirname(restoreTarget)) !== lifecycle.targetDirectoryIdentity) throw denied();
      const restored = await fileAt(restoreTarget);
      if (restored.physicalIdentity === receipt.physicalIdentity && restored.sha256 === receipt.sha256) return;
      // The original filename may now belong to a later, unrelated addon version.
      // Continue proving the original inode's journaled successor before accepting
      // this old tombstone; never treat the replacement as the restored payload.
    }

    // A later, journal-committed operation may have moved this exact inode again.
    // Accept only a verified endpoint and a structurally valid chain edge from a
    // supported namespace; the successor's Trash receipt is checked separately.
    for (const candidate of scan.records) {
      const next = candidate.intent.addonLifecycle;
      if (candidate.state !== "committed" || candidate.intent.serverId !== receipt.serverId || candidate.intent.operationId === v.operationId ||
        !next || next.addonId !== receipt.addonId || next.kind !== receipt.kind || next.filename !== receipt.filename ||
        next.rootIdentity !== receipt.rootIdentity || next.adapterIdentitySha256 !== receipt.adapterIdentitySha256 ||
        next.addonRootIdentity !== receipt.addonRootIdentity || next.sourcePhysicalIdentity !== receipt.physicalIdentity ||
        next.sourceSha256 !== receipt.sha256 || Date.parse(candidate.intent.createdAt) <= Date.parse(restore.intent.createdAt) ||
        next.sourceState === "trashed" && !uuid.test(String(next.trashId))) continue;
      const sourcePath = candidate.intent.paths.find((entry) => entry.role === "source" && entry.namespace === "server")?.relativePath;
      const targetPath = candidate.intent.paths.find((entry) => entry.role === "target" && entry.namespace === "server")?.relativePath;
      const expectedSource = next.sourceState === "trashed"
        ? `trash/addons/${receipt.serverId}/${next.trashId}/payload.jar`
        : `${next.sourceState === "enabled" ? profile.enabled : profile.disabled}/${receipt.filename}`;
      const expectedTarget = next.targetState === "trashed"
        ? `trash/addons/${receipt.serverId}/${next.trashId}/payload.jar`
        : `${next.targetState === "enabled" ? profile.enabled : profile.disabled}/${receipt.filename}`;
      if (sourcePath !== expectedSource || targetPath !== expectedTarget || next.targetState === "trashed" && !uuid.test(String(next.trashId))) continue;
      const target = path.join(adapter.plan.rootPath, ...expectedTarget.split("/"));
      try {
        if (await directoryIdentity(path.dirname(target)) !== next.targetDirectoryIdentity) continue;
        const current = await fileAt(target);
        if (current.physicalIdentity !== receipt.physicalIdentity || current.sha256 !== receipt.sha256) continue;
        if (next.targetState === "trashed") {
          const targetEntry = path.dirname(target), entryId = await directoryIdentity(targetEntry);
          const bytes = await readPrivatePropertiesFile(path.join(targetEntry, "receipt.json"), 16 * 1024);
          const stored: unknown = JSON.parse(bytes.bytes.toString("utf8"));
          if (!validReceipt(stored, receipt.serverId, String(next.trashId)) || stored.entryDirectoryIdentity !== entryId ||
            stored.addonId !== next.addonId || stored.kind !== next.kind || stored.filename !== next.filename || stored.sha256 !== next.sourceSha256 ||
            stored.physicalIdentity !== next.sourcePhysicalIdentity || stored.rootIdentity !== next.rootIdentity) continue;
          await this.#assertTrashJournal(stored);
        }
        return;
      } catch (error) { if (missing(error)) continue; throw error; }
    }
    throw denied();
  }

  async #checkpoint(record: TransactionJournalRecord, name: string, file?: { sha256: string; physicalIdentity: string }, resourceId?: string, inject = true) {
    await this.journal.appendCheckpoint(record.intent.serverId, record.transactionId, { name, recordedAt: this.clock.now().toISOString(),
      ...(file || resourceId ? { details: { ...(file ? { checksumSha256: file.sha256, filesystemIdentity: file.physicalIdentity } : {}), ...(resourceId ? { resourceId } : {}) } } : {}) });
    if (inject) await this.inject?.(name);
  }

  async #execute(serverId: string, id: string, action: Action, revision: string, approved: AddonAdapterIdentity,
    item: Item | undefined, oldReceipt: Receipt | undefined, context: RuntimeOperationContext) {
    let record: TransactionJournalRecord | undefined;
    try {
      const adapter = this.#adapter(serverId), profile = addonProfile(adapter.plan.serverInfo.type);
      if (!profile) throw denied();
      await this.#requireStopped(adapter, context.operationId);
      const identity = await this.captureIdentity(adapter);
      if (JSON.stringify(identity) !== JSON.stringify(approved) || !identity.addonRootIdentity) throw conflict();
      let sourceState: State, targetState: State, filename: string, addonId: string, source: string, sourceDir: { path: string; identity: string };
      let trashId: string | null = null, expectedSha: string, expectedPhysical: string, originalItem: Item | undefined;
      if (action === "restore") {
        if (!oldReceipt) throw conflict();
        const listing = await this.listTrash(serverId, context.operationId);
        if (listing.revision !== revision) throw conflict();
        oldReceipt = await this.#readReceipt(adapter, id, identity);
        sourceState = "trashed"; targetState = oldReceipt.originalState; filename = oldReceipt.filename; addonId = oldReceipt.addonId; trashId = id;
        source = path.join(this.#trashBase(adapter, serverId), id, "payload.jar");
        sourceDir = { path: path.dirname(source), identity: oldReceipt.entryDirectoryIdentity };
        expectedSha = oldReceipt.sha256; expectedPhysical = oldReceipt.physicalIdentity;
      } else {
        const listing = await this.inventory.read(serverId, adapter.plan.rootPath, adapter.plan.serverInfo.type);
        if (listing.revision !== revision || !item) throw conflict();
        const current = listing.items.find((entry) => entry.id === item.id);
        if (!current || current.filename !== item.filename || current.state !== item.state || current.sha256 !== item.sha256) throw conflict();
        sourceState = item.state; targetState = action === "disable" ? "disabled" : action === "enable" ? "enabled" : "trashed";
        filename = item.filename; addonId = item.id; expectedSha = item.sha256;
        const filePath = path.join(adapter.plan.rootPath, sourceState === "enabled" ? profile.enabled : profile.disabled, filename);
        const physical = await fileAt(filePath); expectedPhysical = physical.physicalIdentity; source = filePath;
        sourceDir = { path: path.dirname(source), identity: await directoryIdentity(path.dirname(source)) };
        originalItem = item;
        if (action === "trash") trashId = randomUUID();
      }
      if (!safeAddonFilename(filename)) throw denied();
      const from = await fileAt(source);
      if (from.sha256 !== expectedSha || from.physicalIdentity !== expectedPhysical) throw denied();
      if (await directoryIdentity(sourceDir.path) !== sourceDir.identity) throw denied();

      await context.onStep("creating-protection-backup");
      const guard = await this.backups.createAddonProtectionSnapshot(context, serverId, profile.kind === "plugin" ? "paper" : "fabric");
      const manifest = await this.backups.privateSnapshot(serverId, guard.id);
      const rootEntries = (await readdir(adapter.plan.rootPath)).sort();
      if (!manifest.pinned || manifest.serverId !== serverId || manifest.serverType !== identity.serverType ||
        manifest.minecraftVersion !== identity.minecraftVersion || manifest.checksumSha256 !== guard.checksumSha256 ||
        JSON.stringify([...manifest.includedRoots].sort()) !== JSON.stringify(rootEntries)) throw denied();
      const currentAdapterIdentity = await this.captureIdentity(adapter);
      if (JSON.stringify(currentAdapterIdentity) !== JSON.stringify(approved)) throw conflict();

      const root = path.resolve(adapter.plan.rootPath);
      if (contained(this.managerRoot, root) || contained(root, this.managerRoot)) throw denied();
      let targetDirectory: { path: string; identity: string }, target: string;
      if (targetState === "trashed") {
        if (!trashId) throw denied();
        const trashParent = await ensureDirectory(root, ["trash", "addons", serverId]);
        if ((await readdir(trashParent.path)).length >= ADDON_LIMITS.files) {
          throw new DomainError(413, "ADDON_INVENTORY_LIMIT", "Addon trash is at capacity", "addon-inventory-limit");
        }
        targetDirectory = await ensureDirectory(root, ["trash", "addons", serverId, trashId]);
        target = path.join(targetDirectory.path, "payload.jar");
      } else {
        const folder = targetState === "enabled" ? profile.enabled : profile.disabled;
        targetDirectory = await ensureDirectory(root, [folder]);
        target = path.join(targetDirectory.path, filename);
      }
      if (source === target || await pathExists(target)) throw new DomainError(409, "ADDON_TARGET_CONFLICT", "目标位置已存在；不会覆盖", "addon-target-conflict");
      const sourceAgain = await fileAt(source);
      if (sourceAgain.physicalIdentity !== from.physicalIdentity || sourceAgain.sha256 !== from.sha256 ||
        await directoryIdentity(root) !== approved.rootIdentity || await directoryIdentity(sourceDir.path) !== sourceDir.identity ||
        await directoryIdentity(targetDirectory.path) !== targetDirectory.identity) throw denied();
      if (targetState !== "trashed") {
        const listing = await this.inventory.read(serverId, root, adapter.plan.serverInfo.type);
        if (listing.items.some((candidate) => candidate.filename.normalize("NFC").toLowerCase() === filename.normalize("NFC").toLowerCase() &&
          (action === "restore" || candidate.state !== sourceState))) {
          throw new DomainError(409, "ADDON_TARGET_CONFLICT", "目标命名空间已有同名扩展；不会覆盖", "addon-target-conflict");
        }
      }
      const requireTargetCapacity = async () => {
        if (targetState === "trashed") {
          if ((await readdir(path.dirname(targetDirectory.path))).length > ADDON_LIMITS.files) {
            throw new DomainError(413, "ADDON_INVENTORY_LIMIT", "Addon trash exceeds capacity", "addon-inventory-limit");
          }
          return;
        }
        const listing = await this.inventory.read(serverId, root, adapter.plan.serverInfo.type);
        const added = action === "restore" ? 1 : 0;
        const bytes = listing.items.reduce((total, item) => total + item.sizeBytes, 0) + (added ? from.sizeBytes : 0);
        if (listing.items.length + added > ADDON_LIMITS.files || bytes > ADDON_LIMITS.totalBytes ||
          (await readdir(targetDirectory.path)).length + 1 > ADDON_LIMITS.files) {
          throw new DomainError(413, "ADDON_INVENTORY_LIMIT", "Addon change would exceed inventory limits", "addon-inventory-limit");
        }
      };
      await requireTargetCapacity();
      if (action === "restore" && !oldReceipt) throw denied();
      record = await this.journal.createIntent({ operationId: context.operationId, serverId, kind: "addon-lifecycle", scope: "server-snapshot",
        resourceId: trashId ?? addonId, allowStop: false, originalState: "stopped", createdAt: this.clock.now().toISOString(),
        paths: [{ role: "source", namespace: "server", relativePath: path.relative(root, source).split(path.sep).join("/") },
          { role: "target", namespace: "server", relativePath: path.relative(root, target).split(path.sep).join("/") },
          { role: "rollback", namespace: "manager", relativePath: `backups/${serverId}/${guard.id}` }],
        addonLifecycle: { rootIdentity: approved.rootIdentity, adapterIdentitySha256: approved.identitySha256, addonRootIdentity: approved.addonRootIdentity!,
          kind: profile.kind, action, addonId, filename, sourceState, targetState, sourceDirectoryIdentity: sourceDir.identity,
          targetDirectoryIdentity: targetDirectory.identity, sourcePhysicalIdentity: from.physicalIdentity, sourceSha256: from.sha256,
          metadataName: oldReceipt?.name ?? originalItem?.name ?? null, metadataVersion: oldReceipt?.version ?? originalItem?.version ?? null,
          metadataLoader: oldReceipt?.loader ?? originalItem?.loader ?? null, minecraftConstraint: oldReceipt?.minecraftConstraint ?? originalItem?.minecraftConstraint ?? null,
          metadataStatus: oldReceipt?.metadataStatus ?? originalItem?.metadataStatus ?? "missing",
          trashId, guardBackupId: guard.id, guardChecksum: guard.checksumSha256 } });
      await this.#checkpoint(record, "backup-created", undefined, guard.id);
      await this.#checkpoint(record, "intent-written");
      await this.#checkpoint(record, "source-verified", from);
      await this.#checkpoint(record, "before-move", from);
      await requireTargetCapacity();
      const sourceImmediatelyBeforeMove = await fileAt(source);
      if (sourceImmediatelyBeforeMove.physicalIdentity !== from.physicalIdentity || sourceImmediatelyBeforeMove.sha256 !== from.sha256 ||
        await directoryIdentity(root) !== approved.rootIdentity || await directoryIdentity(sourceDir.path) !== sourceDir.identity ||
        await directoryIdentity(targetDirectory.path) !== targetDirectory.identity || await pathExists(target) ||
        !contained(root, source) || !contained(root, target)) throw denied();
      const [sourceParent, targetParent] = await Promise.all([stat(sourceDir.path), stat(targetDirectory.path)]);
      if (sourceParent.dev !== targetParent.dev) throw denied();
      try { await link(source, target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DomainError(409, "ADDON_TARGET_CONFLICT", "目标位置已存在；不会覆盖", "addon-target-conflict");
        throw error;
      }
      await syncDirectory(targetDirectory.path);
      const [linkedSource, linkedTarget] = await Promise.all([fileAt(source, ADDON_LIMITS.jarBytes, 2), fileAt(target, ADDON_LIMITS.jarBytes, 2)]);
      if (linkedSource.physicalIdentity !== from.physicalIdentity || linkedTarget.physicalIdentity !== from.physicalIdentity ||
        linkedSource.sha256 !== from.sha256 || linkedTarget.sha256 !== from.sha256 ||
        await directoryIdentity(root) !== approved.rootIdentity || await directoryIdentity(sourceDir.path) !== sourceDir.identity ||
        await directoryIdentity(targetDirectory.path) !== targetDirectory.identity) throw denied();
      await this.#checkpoint(record, "destination-installed", linkedTarget);
      const checkBeforeUnlink = await fileAt(source, ADDON_LIMITS.jarBytes, 2);
      if (checkBeforeUnlink.physicalIdentity !== from.physicalIdentity || (await fileAt(target, ADDON_LIMITS.jarBytes, 2)).physicalIdentity !== from.physicalIdentity ||
        await directoryIdentity(root) !== approved.rootIdentity || await directoryIdentity(sourceDir.path) !== sourceDir.identity ||
        await directoryIdentity(targetDirectory.path) !== targetDirectory.identity) throw denied();
      await unlink(source);
      await Promise.all([syncDirectory(sourceDir.path), syncDirectory(targetDirectory.path)]);
      const installed = await fileAt(target);
      if (installed.physicalIdentity !== from.physicalIdentity || installed.sha256 !== from.sha256 ||
        await directoryIdentity(root) !== approved.rootIdentity || await directoryIdentity(sourceDir.path) !== sourceDir.identity ||
        await directoryIdentity(targetDirectory.path) !== targetDirectory.identity) throw denied();
      await this.#checkpoint(record, "source-removed", installed);

      if (action === "trash") {
        if (!trashId || !originalItem) throw denied();
        const receipt: Receipt = { schemaVersion: 1, serverId, adapterIdentitySha256: approved.identitySha256, rootIdentity: approved.rootIdentity,
          addonRootIdentity: approved.addonRootIdentity!, id: trashId, addonId, kind: profile.kind, filename, originalState: sourceState as "enabled" | "disabled",
          sizeBytes: installed.sizeBytes, sha256: installed.sha256, physicalIdentity: installed.physicalIdentity, createdAt: record.intent.createdAt,
          name: originalItem.name, version: originalItem.version, loader: originalItem.loader, compatibility: "unknown", minecraftConstraint: originalItem.minecraftConstraint,
          metadataStatus: originalItem.metadataStatus, sourceDirectoryIdentity: sourceDir.identity, entryDirectoryIdentity: targetDirectory.identity };
        await exclusiveJson(path.join(targetDirectory.path, "receipt.json"), receipt);
        await syncDirectory(targetDirectory.path);
        await this.#checkpoint(record, "receipt-persisted", installed, trashId);
      } else if (action === "restore") {
        if (!oldReceipt) throw denied();
        const marker = { schemaVersion: 1, serverId, trashId: oldReceipt.id, operationId: context.operationId, addonId,
          rootIdentity: approved.rootIdentity, targetState, filename, sha256: installed.sha256, physicalIdentity: installed.physicalIdentity };
        await exclusiveJson(path.join(path.dirname(source), "restored.json"), marker);
        await syncDirectory(path.dirname(source));
        await this.#checkpoint(record, "receipt-consumed", installed, oldReceipt.id);
      }
      await this.#checkpoint(record, "before-commit", installed);
      const finalFile = await fileAt(target);
      const currentIdentity = await this.captureIdentity(adapter);
      if (finalFile.physicalIdentity !== from.physicalIdentity || finalFile.sha256 !== from.sha256 ||
        JSON.stringify(currentIdentity) !== JSON.stringify(approved) || (await this.backups.privateSnapshot(serverId, guard.id)).checksumSha256 !== guard.checksumSha256) throw denied();
      await this.#checkpoint(record, "before-publication", finalFile, undefined, false);
      await this.#checkpoint(record, "committed", finalFile, undefined, false);
      await this.journal.setState(serverId, record.transactionId, "committed", this.clock.now().toISOString());
      await this.inject?.("committed"); await this.inject?.("before-publication");
      const published = await fileAt(target);
      if (published.physicalIdentity !== from.physicalIdentity || published.sha256 !== from.sha256) throw denied();
      await context.onResult?.({ resourceId: action === "trash" ? trashId : addonId, rollbackAvailable: false, restartRequired: true });
    } catch (error) {
      if (record && record.state === "active") {
        try { await this.journal.setState(serverId, record.transactionId, "recovery-required", this.clock.now().toISOString()); } catch { /* keep operation fail-closed */ }
      }
      if (record) throw denied();
      throw error;
    }
  }

  async reconcileStartup() {
    const scan = await this.journal.scan();
    const outcomes = new Map((await this.operations.storedOutcomes()).map((operation) => [operation.id, operation]));
    for (const record of scan.records) {
      const lifecycle = record.intent.addonLifecycle;
      if (!lifecycle || !["active", "recovery-required", "committed", "rolled-back"].includes(record.state) ||
        scan.issues.some((issue) => issue.serverId === record.intent.serverId)) continue;
      const priorOutcome = outcomes.get(record.intent.operationId);
      if ((record.state === "committed" && priorOutcome?.state === "succeeded") ||
        (record.state === "rolled-back" && priorOutcome?.state === "failed" && priorOutcome.error?.code === "ADDON_LIFECYCLE_NOT_APPLIED")) continue;
      try {
        const adapter = this.#adapter(record.intent.serverId), profile = addonProfile(adapter.plan.serverInfo.type);
        if (!profile || profile.kind !== lifecycle.kind) throw denied();
        await this.#requireStopped(adapter);
        const identity = await this.captureIdentity(adapter);
        const root = path.resolve(adapter.plan.rootPath);
        if (identity.rootIdentity !== lifecycle.rootIdentity || identity.identitySha256 !== lifecycle.adapterIdentitySha256 ||
          identity.addonRootIdentity !== lifecycle.addonRootIdentity || await backupDirectoryIdentity(root) !== lifecycle.rootIdentity) throw denied();
        const guard = await this.backups.privateSnapshot(record.intent.serverId, lifecycle.guardBackupId);
        if (!guard.pinned || guard.checksumSha256 !== lifecycle.guardChecksum || guard.serverType !== identity.serverType) throw denied();
        const sourcePath = record.intent.paths.find((p) => p.role === "source" && p.namespace === "server")?.relativePath;
        const targetPath = record.intent.paths.find((p) => p.role === "target" && p.namespace === "server")?.relativePath;
        if (!sourcePath || !targetPath) throw denied();
        const source = path.join(root, ...sourcePath.split("/")), target = path.join(root, ...targetPath.split("/"));
        if (!contained(root, source) || !contained(root, target)) throw denied();
        const sourceParent = path.dirname(source), targetParent = path.dirname(target);
        if (await directoryIdentity(sourceParent) !== lifecycle.sourceDirectoryIdentity || await directoryIdentity(targetParent) !== lifecycle.targetDirectoryIdentity) throw denied();
        const sourceExists = await pathExists(source), targetExists = await pathExists(target);
        if (record.state === "committed" && (sourceExists || !targetExists)) throw denied();
        if (sourceExists && !targetExists) {
          const untouched = await fileAt(source);
          if (untouched.physicalIdentity !== lifecycle.sourcePhysicalIdentity || untouched.sha256 !== lifecycle.sourceSha256 || record.state === "committed") throw denied();
          // Durable intent exists, but the unique physical layout proves the move never began.
          await this.journal.setState(record.intent.serverId, record.transactionId, "rolled-back", this.clock.now().toISOString());
          this.operations.confirmPhysicalTransaction(record.intent.operationId);
          continue;
        }
        if (sourceExists && targetExists) {
          const [a, b] = await Promise.all([fileAt(source, ADDON_LIMITS.jarBytes, 2), fileAt(target, ADDON_LIMITS.jarBytes, 2)]);
          if (a.physicalIdentity !== lifecycle.sourcePhysicalIdentity || b.physicalIdentity !== lifecycle.sourcePhysicalIdentity || a.sha256 !== lifecycle.sourceSha256 || b.sha256 !== lifecycle.sourceSha256) throw denied();
          // Complete the already-published same-inode move. No content is deleted; this only removes the source hardlink.
          await unlink(source); await syncDirectory(sourceParent); await syncDirectory(targetParent);
        }
        const targetFile = targetExists || sourceExists ? await fileAt(target) : null;
        if (!targetFile || targetFile.physicalIdentity !== lifecycle.sourcePhysicalIdentity || targetFile.sha256 !== lifecycle.sourceSha256) throw denied();
        if (lifecycle.targetState === "trashed") {
          const entry = targetParent, receiptPath = path.join(entry, "receipt.json");
          const expectedReceipt: Receipt = { schemaVersion: 1, serverId: record.intent.serverId, adapterIdentitySha256: lifecycle.adapterIdentitySha256,
            rootIdentity: lifecycle.rootIdentity, addonRootIdentity: lifecycle.addonRootIdentity, id: lifecycle.trashId!, addonId: lifecycle.addonId,
            kind: lifecycle.kind, filename: lifecycle.filename, originalState: lifecycle.sourceState as "enabled" | "disabled", sizeBytes: targetFile.sizeBytes,
            sha256: targetFile.sha256, physicalIdentity: targetFile.physicalIdentity, createdAt: record.intent.createdAt,
            name: lifecycle.metadataName, version: lifecycle.metadataVersion, loader: lifecycle.metadataLoader, compatibility: "unknown", minecraftConstraint: lifecycle.minecraftConstraint,
            metadataStatus: lifecycle.metadataStatus, sourceDirectoryIdentity: lifecycle.sourceDirectoryIdentity, entryDirectoryIdentity: lifecycle.targetDirectoryIdentity };
          const hasReceipt = await pathExists(receiptPath), entryNames = (await readdir(entry)).sort();
          if (JSON.stringify(entryNames) !== JSON.stringify(hasReceipt ? ["payload.jar", "receipt.json"] : ["payload.jar"])) throw denied();
          if (!hasReceipt) {
            if (record.state === "committed") throw denied();
            await exclusiveJson(receiptPath, expectedReceipt); await syncDirectory(entry);
          } else {
            const receiptFile = await readPrivatePropertiesFile(receiptPath, 16 * 1024), receiptValue: unknown = JSON.parse(receiptFile.bytes.toString("utf8"));
            if (!validReceipt(receiptValue, record.intent.serverId, lifecycle.trashId!) || JSON.stringify(receiptValue) !== JSON.stringify(expectedReceipt)) throw denied();
          }
        }
        if (lifecycle.action === "restore") {
          const markerPath = path.join(sourceParent, "restored.json");
          const hasMarker = await pathExists(markerPath), trashNames = (await readdir(sourceParent)).sort();
          const marker = { schemaVersion: 1, serverId: record.intent.serverId, trashId: lifecycle.trashId,
            operationId: record.intent.operationId, addonId: lifecycle.addonId, rootIdentity: lifecycle.rootIdentity, targetState: lifecycle.targetState,
            filename: lifecycle.filename, sha256: targetFile.sha256, physicalIdentity: targetFile.physicalIdentity };
          if (JSON.stringify(trashNames) !== JSON.stringify(hasMarker ? ["receipt.json", "restored.json"] : ["receipt.json"])) throw denied();
          if (!hasMarker) {
            if (record.state === "committed") throw denied();
            await exclusiveJson(markerPath, marker);
          } else {
            const markerFile = await readPrivatePropertiesFile(markerPath, 16 * 1024), markerValue: unknown = JSON.parse(markerFile.bytes.toString("utf8"));
            if (JSON.stringify(markerValue) !== JSON.stringify(marker)) throw denied();
          }
          await syncDirectory(sourceParent);
        }
        if (record.state !== "committed") await this.journal.setState(record.intent.serverId, record.transactionId, "committed", this.clock.now().toISOString());
        this.operations.confirmPhysicalTransaction(record.intent.operationId);
      } catch {
        this.operations.requireTransactionRecovery(record.intent.serverId, record.intent.operationId);
      }
    }
    const trashServers = new Set(scan.records.filter((record) => record.intent.addonLifecycle?.action === "trash" && record.state === "committed")
      .map((record) => record.intent.serverId));
    for (const serverId of trashServers) {
      try { await this.listTrash(serverId); }
      catch { this.operations.requireRecovery([serverId]); }
    }
  }
}
