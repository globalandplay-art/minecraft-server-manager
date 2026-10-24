import type { AddonAdapterIdentity } from './addon-adapter-identity.js';
import { addonOpaqueId, safeAddonFilename } from './addon-inventory.js';
import { DomainError } from './domain-errors.js';
import type { TransactionJournalRecord } from './transaction-journal.js';
import path from 'node:path';
import type { BackupService } from './backup-service.js';
import { backupDirectoryIdentity } from './backup-identity.js';
import { readPrivatePropertiesFile } from './properties-private-file.js';
import { readdir } from 'node:fs/promises';

const denied = () => new DomainError(409, 'ADDON_LIFECYCLE_RECOVERY_REQUIRED',
  '模组移动历史无法唯一核验；已保留文件及恢复证据', 'addon-successor-uncertain', true);
type Position = { path: string; directoryIdentity: string; state: 'enabled' | 'disabled' | 'trashed' };
type Payload = { addonId: string; filename: string; sha256: string; physicalIdentity: string };
export type AddonSuccessorProof = Payload & { records: readonly TransactionJournalRecord[]; terminal: Position };

/** Pure journal relationship proof only. Callers must also verify guards, current
 * identity, actual endpoint bytes/inode/directories and receipts. No I/O or cache. */
export function resolveAddonSuccessors(records: readonly TransactionJournalRecord[], origin: TransactionJournalRecord,
  identity: AddonAdapterIdentity): AddonSuccessorProof {
  if (records.length > 10_000 || !['forge', 'neoforge'].includes(identity.serverType) || !identity.addonRootIdentity) throw denied();
  const validate = (record: TransactionJournalRecord): Payload & { source?: Position; target: Position } => {
    const install = record.intent.addonInstall, life = record.intent.addonLifecycle;
    const evidence = install ?? life;
    if (record.state !== 'committed' || record.intent.serverId !== identity.serverId || !evidence ||
      evidence.rootIdentity !== identity.rootIdentity || evidence.adapterIdentitySha256 !== identity.identitySha256 ||
      evidence.addonRootIdentity !== identity.addonRootIdentity || evidence.kind !== 'mod' || !safeAddonFilename(evidence.filename)) throw denied();
    const published = [...record.checkpoints].reverse().find(point => point.name === 'before-publication')?.details;
    const committed = [...record.checkpoints].reverse().find(point => point.name === 'committed')?.details;
    if (!published?.filesystemIdentity || !published.checksumSha256 || !committed ||
      committed.filesystemIdentity !== published.filesystemIdentity || committed.checksumSha256 !== published.checksumSha256) throw denied();
    const targetPath = record.intent.paths.find(entry => entry.namespace === 'server' && entry.role === 'target')?.relativePath;
    const payload = { filename: evidence.filename, sha256: published.checksumSha256,
      physicalIdentity: published.filesystemIdentity, addonId: addonOpaqueId(identity.serverId, 'mod', evidence.filename) };
    if (install) {
      if (install.confirmUnknownCompatibility !== true || install.uploadSha256 !== payload.sha256 || targetPath !== `mods/${install.filename}`) throw denied();
      return { ...payload, target: { path: targetPath, directoryIdentity: install.addonRootIdentity, state: 'enabled' } };
    }
    if (!life || life.serverType !== identity.serverType || life.predecessorTransactionId === undefined ||
      life.addonId !== payload.addonId || life.sourceSha256 !== payload.sha256 || life.sourcePhysicalIdentity !== payload.physicalIdentity ||
      life.targetState === 'enabled' && life.confirmUnknownCompatibility !== true) throw denied();
    const statePath = (state: 'enabled' | 'disabled' | 'trashed') => state === 'trashed'
      ? `trash/addons/${identity.serverId}/${life.trashId}/payload.jar`
      : `${state === 'enabled' ? 'mods' : 'disabled-mods'}/${life.filename}`;
    const sourcePath = record.intent.paths.find(entry => entry.namespace === 'server' && entry.role === 'source')?.relativePath;
    if (sourcePath !== statePath(life.sourceState) || targetPath !== statePath(life.targetState)) throw denied();
    return { ...payload, source: { path: sourcePath, directoryIdentity: life.sourceDirectoryIdentity, state: life.sourceState },
      target: { path: targetPath, directoryIdentity: life.targetDirectoryIdentity, state: life.targetState } };
  };
  const sameEdge = (parent: ReturnType<typeof validate>, child: ReturnType<typeof validate>) =>
    child.addonId === parent.addonId && child.filename === parent.filename && child.sha256 === parent.sha256 &&
    child.physicalIdentity === parent.physicalIdentity && child.source?.path === parent.target.path &&
    child.source.directoryIdentity === parent.target.directoryIdentity && child.source.state === parent.target.state;
  let root = origin;
  const ancestors = new Set<string>();
  while (root.intent.addonLifecycle?.predecessorTransactionId) {
    if (ancestors.has(root.transactionId)) throw denied(); ancestors.add(root.transactionId);
    const parents = records.filter(record => record.intent.serverId === identity.serverId &&
      record.transactionId === root.intent.addonLifecycle?.predecessorTransactionId);
    if (parents.length !== 1 || !sameEdge(validate(parents[0]!), validate(root))) throw denied();
    root = parents[0]!;
  }
  const first = validate(root), chain = [root], visited = new Set([root.transactionId]);
  let cursor = root, position = first.target;
  for (;;) {
    const children = records.filter(record => record.intent.serverId === identity.serverId &&
      record.intent.addonLifecycle?.predecessorTransactionId === cursor.transactionId && record.state !== 'rolled-back');
    if (children.length === 0) {
      if (records.some(record => record.intent.serverId === identity.serverId && record.state !== 'rolled-back' &&
        record.intent.addonLifecycle?.rootIdentity === identity.rootIdentity &&
        record.intent.addonLifecycle.sourcePhysicalIdentity === first.physicalIdentity &&
        record.intent.addonLifecycle.sourceSha256 === first.sha256 && !visited.has(record.transactionId))) throw denied();
      return { addonId: first.addonId, filename: first.filename, sha256: first.sha256,
        physicalIdentity: first.physicalIdentity, records: chain, terminal: position };
    }
    if (children.length !== 1 || visited.has(children[0]!.transactionId)) throw denied();
    const child = children[0]!, next = validate(child);
    if (!sameEdge(validate(cursor), next)) throw denied();
    visited.add(child.transactionId); chain.push(child); cursor = child; position = next.target;
  }
}

/** A relationship proof never substitutes for the original protection snapshots
 * or the current physical endpoint. This function performs fresh reads. */
export async function verifyAddonSuccessorEndpoint(proof: AddonSuccessorProof, identity: AddonAdapterIdentity,
  root: string, backups: BackupService, check = () => {}) {
  check();
  if (await backupDirectoryIdentity(root) !== identity.rootIdentity) throw denied();
  for (const record of proof.records) {
    check();
    const evidence = record.intent.addonInstall ?? record.intent.addonLifecycle;
    if (!evidence) throw denied();
    const guard = await backups.privateSnapshot(identity.serverId, evidence.guardBackupId);
    check();
    if (!guard.pinned || guard.serverId !== identity.serverId || guard.serverType !== identity.serverType ||
      guard.checksumSha256 !== evidence.guardChecksum) throw denied();
    const life = record.intent.addonLifecycle;
    if (life) for (const role of ['source', 'target'] as const) {
      const relative = record.intent.paths.find(entry => entry.role === role && entry.namespace === 'server')?.relativePath;
      if (!relative || await backupDirectoryIdentity(path.dirname(path.join(root, ...relative.split('/')))) !==
        (role === 'source' ? life.sourceDirectoryIdentity : life.targetDirectoryIdentity)) throw denied();
    }
    if (life?.action === 'trash') {
      const entry = path.join(root, 'trash', 'addons', identity.serverId, life.trashId!);
      const receiptFile = await readPrivatePropertiesFile(path.join(entry, 'receipt.json'), 16 * 1024);
      const receipt: unknown = JSON.parse(receiptFile.bytes.toString('utf8'));
      const expected = { schemaVersion: 1, serverId: identity.serverId, adapterIdentitySha256: life.adapterIdentitySha256,
        rootIdentity: life.rootIdentity, addonRootIdentity: life.addonRootIdentity, id: life.trashId, addonId: life.addonId,
        kind: life.kind, filename: life.filename, originalState: life.sourceState, sizeBytes: undefined as number | undefined,
        sha256: life.sourceSha256, physicalIdentity: life.sourcePhysicalIdentity, createdAt: record.intent.createdAt,
        name: life.metadataName, version: life.metadataVersion, loader: life.metadataLoader, compatibility: 'unknown',
        minecraftConstraint: life.minecraftConstraint, metadataStatus: life.metadataStatus,
        sourceDirectoryIdentity: life.sourceDirectoryIdentity, entryDirectoryIdentity: life.targetDirectoryIdentity };
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw denied();
      const value = receipt as Record<string, unknown>;
      if (!Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) < 1 || Number(value.sizeBytes) > 64 * 1024 ** 2 ||
        Object.keys(value).length !== Object.keys(expected).length || Object.entries(expected).some(([key, wanted]) =>
          key !== 'sizeBytes' && JSON.stringify(value[key]) !== JSON.stringify(wanted))) throw denied();
      const index = proof.records.indexOf(record), successor = proof.records[index + 1];
      const restore = successor?.intent.addonLifecycle;
      const names = (await readdir(entry)).sort();
      if (restore?.action === 'restore') {
        if (restore.trashId !== life.trashId || names.join('\0') !== 'receipt.json\0restored.json') throw denied();
        const markerFile = await readPrivatePropertiesFile(path.join(entry, 'restored.json'), 16 * 1024);
        const marker: unknown = JSON.parse(markerFile.bytes.toString('utf8'));
        const expectedMarker = { schemaVersion: 1, serverId: identity.serverId, trashId: life.trashId,
          operationId: successor!.intent.operationId, addonId: life.addonId, rootIdentity: life.rootIdentity,
          targetState: restore.targetState, filename: life.filename, sha256: life.sourceSha256, physicalIdentity: life.sourcePhysicalIdentity };
        if (JSON.stringify(marker) !== JSON.stringify(expectedMarker)) throw denied();
      } else if (names.join('\0') !== 'payload.jar\0receipt.json') throw denied();
    }
  }
  const target = path.join(root, ...proof.terminal.path.split('/'));
  check();
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
    await backupDirectoryIdentity(path.dirname(target)) !== proof.terminal.directoryIdentity) throw denied();
  const file = await readPrivatePropertiesFile(target, 64 * 1024 * 1024);
  if (file.checksum !== proof.sha256 || file.physicalIdentity !== proof.physicalIdentity ||
    await backupDirectoryIdentity(root) !== identity.rootIdentity) throw denied();
  check();
  return { target, file };
}
