import { randomUUID } from 'node:crypto';
import { open, rename } from 'node:fs/promises';
import path from 'node:path';
import type { RegistrationDraft, RegistrationCatalogResponse, RegistrationPreviewResponse, RegistrationSaveResponse, RegistrationRemoveResponse } from '@mcsm/contracts';
import type { LocalMinecraftServerAdapter } from '../adapters/contract.js';
import { assertSafeRegistrationRoots, parseLocalConfigDocument, parseRegistrationJavaProfiles, validateRegistration, type RawServerConfig, type ValidatedRegistration, type RegistrationJavaProfile } from '../config/local-config.js';
import { backupDirectoryIdentity } from './backup-identity.js';
import { readPrivatePropertiesFile } from './properties-private-file.js';
import { DomainError } from './domain-errors.js';
import { trustedLifecycle } from './trusted-lifecycle.js';

const fail = (code: string, message: string) => new DomainError(409, code, message);
type Snapshot = Awaited<ReturnType<ServerRegistrationService['snapshot']>>;
type Ticket = { raw: RawServerConfig; profileId: string; revision: string; identity: string; binding: string; expires: number };
export type RegistrationRemoval = (target: RawServerConfig, publish: (check: () => Promise<void>) => Promise<void>, authorize: () => void) => Promise<{ unloaded: boolean; unloadErrorCode: string | null }>;
/** Append registrations to the existing config, never mutate running adapters.
 * The process-wide Manager owner already excludes other LT writers. External
 * manual edits are checked optimistically; hostile same-user races remain outside
 * this local single-user model, as with the existing metadata atomic writers. */
export class ServerRegistrationService {
  private busy = false;
  private uncertain = false;
  private readonly tickets = new Map<string, Ticket>();
  constructor(private readonly root: string, private readonly source: readonly LocalMinecraftServerAdapter[] | (() => readonly LocalMinecraftServerAdapter[]),
    private readonly activate?: (registration: ValidatedRegistration, authorize: () => void) => Promise<void>,
    private readonly removal?: RegistrationRemoval,
    private readonly retired?: (id: string) => boolean) {}
  private get adapters(): readonly LocalMinecraftServerAdapter[] { return typeof this.source === 'function' ? this.source() : this.source; }

  async snapshot() {
    const rootIdentity = await backupDirectoryIdentity(this.root);
    const file = await readPrivatePropertiesFile(path.join(this.root, 'config.json'), 1024 * 1024);
    const rows = parseLocalConfigDocument(file.bytes.toString('utf8'));
    assertSafeRegistrationRoots(this.root, rows.map(row => row.root));
    return { rootIdentity, file, rows, profiles: parseRegistrationJavaProfiles(file.bytes.toString('utf8')) };
  }
  private profiles(snapshot: Snapshot): RegistrationJavaProfile[] {
    const profiles = new Map<string, RegistrationJavaProfile>();
    for (const adapter of this.adapters) {
      const identity = adapter.getRegisteredExecutionIdentity?.();
      if (identity) profiles.set(adapter.serverId, { id: adapter.serverId, name: adapter.plan.name, javaExecutable: adapter.plan.javaExecutable,
        jvmArgs: [...adapter.plan.argv.slice(0, 2)], javaIdentity: identity.javaIdentity, javaSha256: identity.javaSha256 });
    }
    for (const row of snapshot.profiles) if (!profiles.has(row.id)) profiles.set(row.id, row);
    return [...profiles.values()];
  }
  async catalog(): Promise<RegistrationCatalogResponse['data']> {
    const snapshot = await this.snapshot(), { rows } = snapshot;
    return { profiles: this.profiles(snapshot).map(row => ({ id: row.id, name: row.name })),
      pending: rows.filter(row => !this.adapters.some(adapter => adapter.serverId === row.id)).map(({ id, name }) => ({ id, name })) };
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.uncertain) throw fail('REGISTRATION_RESULT_UNKNOWN', '上次登记结果需要检查，请重新读取配置；不会自动重试');
    if (this.busy) throw fail('REGISTRATION_BUSY', '正在检查或保存实例，请稍后重试');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  private async validate(raw: RawServerConfig, snapshot: Snapshot, profileId: string) {
    if (this.retired?.(raw.id)) throw fail('REGISTRATION_ID_RETIRED', '该标识已在当前 Manager 移除，请使用新的实例标识；历史证据不会覆盖');
    if (snapshot.rows.length >= 1000 || snapshot.rows.some(row => row.id === raw.id)) throw fail('REGISTRATION_CONFLICT', '实例标识已存在或登记数量达到上限');
    const roots = [...snapshot.rows.map(row => row.root), raw.root];
    assertSafeRegistrationRoots(this.root, roots);
    // Never register Manager metadata as a server directory (or vice versa).
    const relative = path.relative(path.resolve(this.root), path.resolve(raw.root));
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))
      throw fail('REGISTRATION_CONFLICT', '实例目录不能位于 Manager 数据目录中');
    const expected = this.profiles(snapshot).find(row => row.id === profileId);
    if (!expected || expected.javaExecutable !== raw.javaExecutable) throw fail('JAVA_PROFILE_UNAVAILABLE', '没有可用的已验证 Java 配置');
    const java = await readPrivatePropertiesFile(raw.javaExecutable, 128 * 1024 ** 2);
    if (java.identity !== expected.javaIdentity || java.checksum !== expected.javaSha256)
      throw fail('JAVA_PROFILE_CHANGED', 'Java 文件已变化，请重启 Manager 重新验证');
    const registration = await validateRegistration(raw);
    assertSafeRegistrationRoots(this.root, [...snapshot.rows.map(row => row.root), registration.plan.rootPath]);
    // Bind the actual properties as well as root/Java/launcher across preview/save.
    const properties = await readPrivatePropertiesFile(path.join(registration.plan.rootPath, 'server.properties'));
    const binding = JSON.stringify([registration.identity, properties.identity, properties.checksum, registration.plan.serverInfo]);
    return { registration, binding };
  }
  async preview(draft: RegistrationDraft, authorize: () => void): Promise<RegistrationPreviewResponse['data']> {
    return this.exclusive(async () => {
      authorize();
      for (const [key, row] of this.tickets) if (row.expires <= Date.now()) this.tickets.delete(key);
      if (this.tickets.size >= 16) throw fail('REGISTRATION_BUSY', '预检数量达到上限，请稍后重试');
      const snapshot = await this.snapshot();
      const profile = this.profiles(snapshot).find(row => row.id === draft.javaProfileId);
      if (!profile) throw fail('JAVA_PROFILE_UNAVAILABLE', '请选择当前已加载实例的 Java 配置');
      const raw: RawServerConfig = { id: draft.id, name: draft.name, root: draft.root,
        jarFile: draft.jarFile, javaExecutable: profile.javaExecutable,
        jvmArgs: [...profile.jvmArgs], serverArgs: ['nogui'] };
      let validated;
      try { validated = await this.validate(raw, snapshot, profile.id); }
      catch (error) { if (error instanceof DomainError && error.code.startsWith('REGISTRATION')) throw error;
        throw fail('REGISTRATION_PREFLIGHT_FAILED', '目录、服务端文件或 Java 检查未通过；未修改任何实例'); }
      authorize();
      const token = randomUUID();
      this.tickets.set(token, { raw, profileId: profile.id, revision: snapshot.file.checksum, identity: snapshot.file.identity,
        binding: validated.binding, expires: Date.now() + 5 * 60_000 });
      return { token, server: validated.registration.plan.serverInfo, eulaAccepted: validated.registration.plan.eulaAccepted,
        lifecycleSupported: trustedLifecycle(validated.registration.plan.serverInfo), restartRequired: !this.activate };
    });
  }
  async save(token: string, authorize: () => void): Promise<RegistrationSaveResponse['data']> {
    return this.exclusive(async () => {
      authorize();
      const ticket = this.tickets.get(token);
      if (!ticket || ticket.expires <= Date.now()) throw fail('REGISTRATION_PREVIEW_EXPIRED', '请重新检查实例并确认');
      const before = await this.snapshot();
      if (before.file.identity !== ticket.identity || before.file.checksum !== ticket.revision)
        throw fail('REGISTRATION_REVISION_CONFLICT', '登记配置已被修改，请重新检查');
      const validated = await this.validate(ticket.raw, before, ticket.profileId);
      if (validated.binding !== ticket.binding) throw fail('REGISTRATION_TARGET_CHANGED', '目标目录、JAR、Java 或配置已变化，请重新检查');
      await this.publish(before, [...before.rows, ticket.raw], before.profiles, authorize, async current => {
        if ((await this.validate(ticket.raw, current, ticket.profileId)).binding !== ticket.binding) throw fail('REGISTRATION_TARGET_CHANGED', '保存前目标发生变化，请重新检查');
      });
      this.tickets.delete(token);
      let loaded = false, loadErrorCode: string | null = null;
      if (this.activate) {
        try { await this.activate(validated.registration, authorize); loaded = true; }
        catch (error) { loadErrorCode = error instanceof DomainError ? error.code : 'REGISTRATION_LOAD_UNAVAILABLE'; }
      }
      return { id: ticket.raw.id, name: ticket.raw.name, restartRequired: !loaded, loaded, loadErrorCode };
    });
  }
  async remove(id: string, authorize: () => void): Promise<RegistrationRemoveResponse['data']> {
    return this.exclusive(async () => {
      authorize(); const before = await this.snapshot(), target = before.rows.find(row => row.id === id);
      if (!target) throw new DomainError(404, 'REGISTRATION_NOT_FOUND', '实例未登记或已移除');
      if (!this.removal) throw fail('REGISTRATION_REMOVE_UNAVAILABLE', '当前运行方式暂不支持安全移除，请使用最新本地 Manager');
      const seenJava = new Set<string>();
      const profiles = this.profiles(before).filter(profile => {
        const key = `${profile.javaExecutable.toLowerCase()}\n${profile.javaSha256}`;
        if (seenJava.has(key)) return false; seenJava.add(key); return true;
      });
      const result = await this.removal(target, check => this.publish(before, before.rows.filter(row => row.id !== id), profiles, authorize, async () => check()), authorize);
      this.tickets.clear();
      return { id, removed: true, filesPreserved: true, unloaded: result.unloaded, restartRequired: !result.unloaded, unloadErrorCode: result.unloadErrorCode };
    });
  }
  private async publish(before: Snapshot, rows: RawServerConfig[], profiles: RegistrationJavaProfile[], authorize: () => void, check: (current: Snapshot) => Promise<void>) {
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, servers: rows, ...(profiles.length ? { javaProfiles: profiles } : {}) }, null, 2) + '\n');
      if (bytes.length > 1024 * 1024) throw fail('REGISTRATION_CAPACITY', '登记文件达到大小上限');
      const suffix = randomUUID(), stage = path.join(this.root, `config.${suffix}.tmp`), backup = path.join(this.root, `config.${suffix}.backup`);
      const publish = async (file: string, data: Uint8Array) => {
        const handle = await open(file, 'wx', 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      };
      await publish(stage, bytes); await publish(backup, before.file.bytes);
      const current = await this.snapshot();
      if (current.rootIdentity !== before.rootIdentity || current.file.identity !== before.file.identity || current.file.checksum !== before.file.checksum)
        throw fail('REGISTRATION_REVISION_CONFLICT', '保存前登记文件发生变化，原文件未覆盖');
      await check(current);
      authorize();
      try {
        await rename(stage, path.join(this.root, 'config.json'));
        const after = await this.snapshot();
        if (!after.file.bytes.equals(bytes) || after.rootIdentity !== before.rootIdentity) throw new Error('registration-readback-mismatch');
      } catch { this.uncertain = true; throw fail('REGISTRATION_RESULT_UNKNOWN', '登记结果未知，请检查或重新启动 Manager；不会自动重试，备份已保留'); }
  }
}
