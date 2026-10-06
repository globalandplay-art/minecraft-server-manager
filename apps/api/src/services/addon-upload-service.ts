import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir, rename, statfs } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { isLocalAdapter } from "../adapters/contract.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Clock } from "../clock.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import type { OperationService } from "./operation-service.js";
import { ServerNotFoundError } from "./server-service.js";
import { captureAddonAdapterIdentity, type AddonAdapterIdentity } from "./addon-adapter-identity.js";
import { ADDON_LIMITS, addonProfile, safeAddonFilename } from "./addon-inventory.js";
import { readAddonJarMetadata } from "./addon-jar-metadata.js";
import { parseFabricAddonMetadata } from "./fabric-addon-metadata.js";
import { parsePluginAddonMetadata } from "./plugin-addon-metadata.js";

export const ADDON_UPLOAD_LIMITS = Object.freeze({ bytes: ADDON_LIMITS.jarBytes, filesPerServer: 3, timeoutMs: 60_000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA = /^[0-9a-f]{64}$/u;
const failure = () => new DomainError(409, "ADDON_STAGING_UNSAFE", "扩展暂存记录无法安全核验", "addon-staging-unsafe");
type AddonMetadata = { name: string; version: string; loader: "fabric" | "paper"; minecraftConstraint: string[] | null };
type Owner = { schemaVersion: 1; id: string; serverId: string; rootIdentity: string; directoryIdentity: string; createdAt: string };
type Lifecycle = { schemaVersion: 1; id: string; serverId: string; directoryIdentity: string; createdAt: string; state: "receiving" | "failed" | "validated" | "requires-inspection" | "consumed" };
type Validated = { schemaVersion: 1; id: string; serverId: string; kind: "mod" | "plugin"; filename: string; sizeBytes: number;
  checksumSha256: string; revision: string; adapterIdentity: AddonAdapterIdentity; metadata: AddonMetadata };

async function plainDirectory(directory: string): Promise<void> {
  const info = await lstat(directory), canonical = await realpath(directory);
  const expected = path.resolve(directory), norm = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (!info.isDirectory() || info.isSymbolicLink() || norm(canonical) !== norm(expected)) throw failure();
}
async function syncDirectory(directory: string): Promise<void> {
  const file = await open(directory, "r");
  try { await file.sync(); } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (!(process.platform === "win32" && ["EACCES", "EISDIR", "EPERM"].includes(String(code)))) throw error;
  } finally { await file.close(); }
}
async function writeJson(filePath: string, value: unknown): Promise<void> {
  const temp = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value) + "\n", "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, filePath); await syncDirectory(path.dirname(filePath));
}
async function readJson<T>(filePath: string): Promise<T> {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 128 * 1024) throw failure();
  const handle = await open(filePath, "r");
  try { return JSON.parse(await handle.readFile("utf8")) as T; } finally { await handle.close(); }
}
function hashFile(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function revisionOf(value: Omit<Validated, "revision">): string { return hashFile(Buffer.from(JSON.stringify(value))); }

/** Private, bounded single-JAR staging. Uploads are inert and never extracted or executed. */
export class AddonUploadService {
  #busy = false;
  constructor(private readonly registry: AdapterRegistry, private readonly operations: OperationService,
    private readonly managerRoot: string, private readonly clock: Clock,
    private readonly captureIdentity: typeof captureAddonAdapterIdentity = captureAddonAdapterIdentity) {}

  async upload(serverId: string, filename: string, stream: Readable) {
    if (!safeAddonFilename(filename)) throw new DomainError(400, "VALIDATION_ERROR", "请使用不含路径的 .jar 文件名", "invalid-addon-filename");
    if (this.#busy) throw new DomainError(429, "ADDON_UPLOAD_BUSY", "另一个扩展上传正在进行", "addon-upload-busy");
    this.#busy = true;
    try {
      return await this.operations.runExclusive(serverId, async () => {
        const adapter = this.registry.get(serverId);
        if (!adapter) throw new ServerNotFoundError();
        if (!isLocalAdapter(adapter)) throw new DomainError(501, "ADDON_UNSUPPORTED", "扩展上传仅支持本地 Paper/Fabric", "addon-local-required");
        const profile = addonProfile(adapter.plan.serverInfo.type);
        if (!profile) throw new DomainError(501, "ADDON_UNSUPPORTED", "扩展上传仅支持本地 Paper/Fabric", "addon-profile-unsupported");
        const kind = profile.kind;
        const status = await adapter.getStatus();
        if (status.recoveryRequired || !((status.state === "stopped" && status.ownership === "none") ||
          (status.state === "running" && status.ownership === "managed"))) throw new DomainError(409, "ACTION_UNAVAILABLE", "实例状态不允许安全上传", "addon-upload-state-unsafe");
        const identity = await this.captureIdentity(adapter);
        const root = path.resolve(this.managerRoot);
        await mkdir(root, { recursive: true, mode: 0o700 }); await plainDirectory(root);
        const canonicalRoot = await realpath(root), norm = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
        if (norm(canonicalRoot) !== norm(root) || norm(root) === norm(path.resolve(adapter.plan.rootPath)) ||
          norm(path.resolve(adapter.plan.rootPath)).startsWith(`${norm(root)}${path.sep}`) || norm(root).startsWith(`${norm(path.resolve(adapter.plan.rootPath))}${path.sep}`)) throw failure();
        const uploadsRoot = path.join(root, "addon-uploads");
        await mkdir(uploadsRoot, { recursive: true, mode: 0o700 }); await plainDirectory(uploadsRoot);
        const existing = await readdir(uploadsRoot);
        let serverCount = 0;
        for (const entry of existing) {
          if (!UUID.test(entry)) throw failure();
          await plainDirectory(path.join(uploadsRoot, entry));
          const owner = await readJson<Partial<Owner>>(path.join(uploadsRoot, entry, "owner.json"));
          if (owner.serverId === serverId) serverCount += 1;
        }
        if (serverCount >= ADDON_UPLOAD_LIMITS.filesPerServer) throw new DomainError(507, "ADDON_STAGING_QUOTA", "扩展暂存配额已满；过期记录不会自动删除", "addon-upload-slot-limit");
        const volume = await statfs(root), available = Number(volume.bavail) * Number(volume.bsize);
        if (!Number.isSafeInteger(available) || available < ADDON_UPLOAD_LIMITS.bytes + 128 * 1024 ** 2) throw new DomainError(507, "ADDON_STAGING_STORAGE_LOW", "扩展暂存空间不足", "addon-upload-storage-low");
        const id = randomUUID(), directory = path.join(uploadsRoot, id);
        await mkdir(directory, { mode: 0o700 }); await plainDirectory(directory);
        const directoryIdentity = await backupDirectoryIdentity(directory);
        const owner: Owner = { schemaVersion: 1, id, serverId, rootIdentity: identity.rootIdentity, directoryIdentity, createdAt: this.clock.now().toISOString() };
        await writeJson(path.join(directory, "owner.json"), owner);
        const lifecycle: Lifecycle = { schemaVersion: 1, id, serverId, directoryIdentity, createdAt: owner.createdAt, state: "receiving" };
        await writeJson(path.join(directory, "lifecycle.json"), lifecycle);
        const target = path.join(directory, "payload.jar"), file = await open(target,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        let bytes = 0;
        const timer = setTimeout(() => stream.destroy(new DomainError(408, "ADDON_UPLOAD_TIMEOUT", "扩展上传超时", "addon-upload-timeout")), ADDON_UPLOAD_LIMITS.timeoutMs);
        timer.unref();
        try {
          for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > ADDON_UPLOAD_LIMITS.bytes) throw new DomainError(413, "UPLOAD_TOO_LARGE", "JAR 文件不能超过 64 MiB", "addon-upload-limit");
            await file.writeFile(buffer);
          }
          if (!bytes) throw new DomainError(400, "VALIDATION_ERROR", "JAR 文件不能为空", "empty-addon-upload");
          await file.sync();
        } catch (error) {
          try { await file.close(); } catch {}
          try { if (await backupDirectoryIdentity(directory) === directoryIdentity) await writeJson(path.join(directory, "lifecycle.json"), { ...lifecycle, state: "failed" }); } catch {}
          throw error;
        } finally { clearTimeout(timer); try { await file.close(); } catch {} }
        await syncDirectory(directory);
        try {
        const physical = await readUploadedJar(target);
        const metadataBytes = readAddonJarMetadata(physical.bytes);
        const raw = metadataBytes.get(kind === "mod" ? "fabric.mod.json" : "plugin.yml");
        const parsed = raw ? (kind === "mod" ? parseFabricAddonMetadata(raw) : parsePluginAddonMetadata(raw)) : null;
        if (!parsed || parsed.loader !== (kind === "mod" ? "fabric" : "paper")) throw new DomainError(422, "ADDON_METADATA_INVALID", "JAR 缺少可验证且与服务端匹配的 Loader metadata", "addon-metadata-invalid");
        const metadata: AddonMetadata = { name: parsed.name, version: parsed.version, loader: parsed.loader,
          minecraftConstraint: "minecraftConstraint" in parsed ? parsed.minecraftConstraint : null };
        if (JSON.stringify(await this.captureIdentity(adapter)) !== JSON.stringify(identity)) throw failure();
        if (await backupDirectoryIdentity(directory) !== directoryIdentity || physical.bytes.length !== bytes) throw failure();
        const partial = { schemaVersion: 1 as const, id, serverId, kind, filename, sizeBytes: bytes,
          checksumSha256: physical.checksumSha256, adapterIdentity: identity, metadata };
        const validated: Validated = { ...partial, revision: revisionOf(partial) };
        await writeJson(path.join(directory, "validated.json"), validated);
        await writeJson(path.join(directory, "lifecycle.json"), { ...lifecycle, state: "validated" });
        await syncDirectory(directory); await syncDirectory(uploadsRoot);
        return { id, kind, filename, sizeBytes: bytes, checksumSha256: validated.checksumSha256, revision: validated.revision,
          name: metadata.name, version: metadata.version, loader: metadata.loader, minecraftConstraint: metadata.minecraftConstraint,
          state: "validated" as const, executionAvailable: false as const };
        } catch (error) {
          try { if (await backupDirectoryIdentity(directory) === directoryIdentity) await writeJson(path.join(directory, "lifecycle.json"), { ...lifecycle, state: "failed" }); } catch {}
          throw error;
        }
      });
    } finally { this.#busy = false; }
  }

  async validatedSource(serverId: string, id: string, revision: string, kind: "mod" | "plugin") {
    if (!UUID.test(id) || !SHA.test(revision)) throw new DomainError(404, "RESOURCE_NOT_FOUND", "扩展暂存记录不存在", "addon-upload-not-found");
    const adapter = this.registry.getLocal(serverId); if (!adapter) throw new ServerNotFoundError();
    const directory = path.join(path.resolve(this.managerRoot), "addon-uploads", id);
    await plainDirectory(path.dirname(directory)); await plainDirectory(directory);
    const owner = await readJson<Owner>(path.join(directory, "owner.json"));
    const lifecycle = await readJson<Lifecycle>(path.join(directory, "lifecycle.json"));
    if (lifecycle.state !== "validated") throw failure();
    const validated = await readJson<Validated>(path.join(directory, "validated.json"));
    const profile = addonProfile(adapter.plan.serverInfo.type);
    const revisionBody = Object.fromEntries(Object.entries(validated).filter(([key]) => key !== "revision")) as Omit<Validated, "revision">;
    if (!profile || owner.schemaVersion !== 1 || owner.id !== id || owner.serverId !== serverId ||
      owner.rootIdentity !== await backupDirectoryIdentity(adapter.plan.rootPath) || owner.directoryIdentity !== await backupDirectoryIdentity(directory) ||
      validated.schemaVersion !== 1 || validated.id !== id || validated.serverId !== serverId || validated.kind !== kind || kind !== profile.kind ||
      lifecycle.schemaVersion !== 1 || lifecycle.id !== id || lifecycle.serverId !== serverId || lifecycle.directoryIdentity !== owner.directoryIdentity ||
      validated.revision !== revision || revisionOf(revisionBody) !== revision || Object.keys(validated).length !== 10 ||
      !safeAddonFilename(validated.filename) || !Number.isSafeInteger(validated.sizeBytes) || validated.sizeBytes < 1 ||
      validated.sizeBytes > ADDON_UPLOAD_LIMITS.bytes || !SHA.test(validated.checksumSha256) ||
      !validated.metadata || ![validated.metadata.name, validated.metadata.version].every((value) => typeof value === "string" && value.length > 0 && value.length <= 128) ||
      validated.metadata.loader !== (kind === "mod" ? "fabric" : "paper")) throw failure();
    const liveIdentity = await this.captureIdentity(adapter);
    if (JSON.stringify(liveIdentity) !== JSON.stringify(validated.adapterIdentity)) throw failure();
    const jar = await readUploadedJar(path.join(directory, "payload.jar"));
    if (jar.bytes.length !== validated.sizeBytes || jar.checksumSha256 !== validated.checksumSha256) throw failure();
    const raw = readAddonJarMetadata(jar.bytes).get(kind === "mod" ? "fabric.mod.json" : "plugin.yml");
    const parsed = raw ? (kind === "mod" ? parseFabricAddonMetadata(raw) : parsePluginAddonMetadata(raw)) : null;
    if (!parsed || parsed.name !== validated.metadata.name || parsed.version !== validated.metadata.version || parsed.loader !== validated.metadata.loader) throw failure();
    return { directory, filePath: path.join(directory, "payload.jar"), owner, validated, adapter };
  }

  async markConsumed(serverId: string, id: string, revision: string, kind: "mod" | "plugin", operationId: string): Promise<void> {
    if (!UUID.test(operationId)) throw failure();
    const source = await this.validatedSource(serverId, id, revision, kind);
    await writeJson(path.join(source.directory, "consumed.json"), { schemaVersion: 1, id, serverId, revision, operationId,
      checksumSha256: source.validated.checksumSha256, directoryIdentity: source.owner.directoryIdentity,
      consumedAt: this.clock.now().toISOString() });
    const lifecycle = await readJson<Lifecycle>(path.join(source.directory, "lifecycle.json"));
    if (lifecycle.state !== "validated" || await backupDirectoryIdentity(source.directory) !== source.owner.directoryIdentity) throw failure();
    await writeJson(path.join(source.directory, "lifecycle.json"), { ...lifecycle, state: "consumed" });
  }

  async verifyConsumed(serverId: string, id: string, revision: string, kind: "mod" | "plugin", operationId: string): Promise<boolean> {
    try {
      if (!UUID.test(id) || !UUID.test(operationId) || !SHA.test(revision)) return false;
      const directory = path.join(path.resolve(this.managerRoot), "addon-uploads", id);
      await plainDirectory(path.dirname(directory)); await plainDirectory(directory);
      const owner = await readJson<Owner>(path.join(directory, "owner.json"));
      const validated = await readJson<Validated>(path.join(directory, "validated.json"));
      const lifecycle = await readJson<Lifecycle>(path.join(directory, "lifecycle.json"));
      const consumed = await readJson<Record<string, unknown>>(path.join(directory, "consumed.json"));
      const adapter = this.registry.getLocal(serverId);
      const { revision: storedRevision, ...revisionBody } = validated;
      if (!adapter || owner.schemaVersion !== 1 || owner.serverId !== serverId || owner.id !== id ||
        owner.directoryIdentity !== await backupDirectoryIdentity(directory) ||
        owner.rootIdentity !== await backupDirectoryIdentity(adapter.plan.rootPath) || validated.schemaVersion !== 1 ||
        validated.serverId !== serverId || validated.id !== id || storedRevision !== revision || revisionOf(revisionBody) !== revision ||
        Object.keys(validated).length !== 10 || !safeAddonFilename(validated.filename) ||
        !Number.isSafeInteger(validated.sizeBytes) || validated.sizeBytes < 1 || validated.sizeBytes > ADDON_UPLOAD_LIMITS.bytes ||
        !SHA.test(validated.checksumSha256) || !validated.metadata ||
        ![validated.metadata.name, validated.metadata.version].every((value) => typeof value === "string" && value.length > 0 && value.length <= 128) ||
        validated.kind !== kind ||
        lifecycle.state !== "consumed" || consumed.operationId !== operationId || consumed.serverId !== serverId || consumed.id !== id ||
        consumed.revision !== revision || consumed.checksumSha256 !== validated.checksumSha256 || consumed.directoryIdentity !== owner.directoryIdentity) return false;
      const live = await this.captureIdentity(adapter);
      if (JSON.stringify(live) !== JSON.stringify(validated.adapterIdentity)) return false;
      const jar = await readUploadedJar(path.join(directory, "payload.jar"));
      const profile = addonProfile(adapter.plan.serverInfo.type);
      if (!profile || profile.kind !== kind || validated.metadata.loader !== (kind === "mod" ? "fabric" : "paper") ||
        jar.checksumSha256 !== validated.checksumSha256 || jar.bytes.length !== validated.sizeBytes) return false;
      const raw = readAddonJarMetadata(jar.bytes).get(kind === "mod" ? "fabric.mod.json" : "plugin.yml");
      const parsed = raw ? (kind === "mod" ? parseFabricAddonMetadata(raw) : parsePluginAddonMetadata(raw)) : null;
      return parsed !== null && parsed.name === validated.metadata.name && parsed.version === validated.metadata.version &&
        parsed.loader === validated.metadata.loader && JSON.stringify("minecraftConstraint" in parsed ? parsed.minecraftConstraint : null) ===
          JSON.stringify(validated.metadata.minecraftConstraint);
    } catch { return false; }
  }
}

async function readUploadedJar(filePath: string): Promise<{ bytes: Buffer; checksumSha256: string }> {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size <= 0 || info.size > ADDON_UPLOAD_LIMITS.bytes) throw failure();
  const handle = await open(filePath, "r");
  try {
    const bytes = await handle.readFile();
    if (bytes.length !== info.size) throw failure();
    return { bytes, checksumSha256: hashFile(bytes) };
  } finally { await handle.close(); }
}
