import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { AddonAdapterIdentity } from '../src/services/addon-adapter-identity.js';
import { addonOpaqueId } from '../src/services/addon-inventory.js';
import { resolveAddonSuccessors } from '../src/services/addon-successor-chain.js';
import type { TransactionJournalRecord } from '../src/services/transaction-journal.js';

const h = (n: number) => String(n).repeat(64);
const identity: AddonAdapterIdentity = { schemaVersion: 1, serverId: 'neo', serverType: 'neoforge', minecraftVersion: '26.3',
  javaMajor: 25, requiredJavaMajor: 25, rootIdentity: h(1), addonRootIdentity: h(2), launchJarIdentity: h(3),
  launchJarSha256: h(4), identitySha256: h(5) };
const now = '2026-10-24T00:00:00.000Z', filename = 'sample.jar', inode = h(6), checksum = h(7);
const addonId = addonOpaqueId('neo', 'mod', filename);
const checkpoint = (name: string, sequence: number) => ({ name, sequence, recordedAt: now,
  details: { checksumSha256: checksum, filesystemIdentity: inode } });
function install(): TransactionJournalRecord {
  return { schemaVersion: 7, transactionId: randomUUID(), state: 'committed', updatedAt: now,
    checkpoints: [checkpoint('before-publication', 1), checkpoint('committed', 2)],
    intent: { serverId: 'neo', operationId: randomUUID(), kind: 'addon-install', scope: 'server-snapshot',
      allowStop: false, originalState: 'stopped', createdAt: now, resourceId: null,
      paths: [{ role: 'target', namespace: 'server', relativePath: `mods/${filename}` }],
      addonInstall: { confirmUnknownCompatibility: true, rootIdentity: h(1), adapterIdentitySha256: h(5), addonRootIdentity: h(2),
        kind: 'mod', filename, uploadId: randomUUID(), uploadRevision: h(8), uploadSha256: checksum,
        guardBackupId: randomUUID(), guardChecksum: h(9), workspaceName: 'unused' } } };
}
function move(parent: TransactionJournalRecord, action: 'disable' | 'enable', predecessor = parent.transactionId): TransactionJournalRecord {
  const source = action === 'disable' ? 'mods' : 'disabled-mods', target = action === 'disable' ? 'disabled-mods' : 'mods';
  return { schemaVersion: 8, transactionId: randomUUID(), state: 'committed', updatedAt: now,
    checkpoints: [checkpoint('before-publication', 1), checkpoint('committed', 2)], intent: {
      serverId: 'neo', operationId: randomUUID(), kind: 'addon-lifecycle', scope: 'server-snapshot', allowStop: false,
      originalState: 'stopped', createdAt: now, resourceId: addonId,
      paths: [{ role: 'source', namespace: 'server', relativePath: `${source}/${filename}` },
        { role: 'target', namespace: 'server', relativePath: `${target}/${filename}` }],
      addonLifecycle: { serverType: 'neoforge', predecessorTransactionId: predecessor,
        ...(action === 'enable' ? { confirmUnknownCompatibility: true as const } : {}),
        rootIdentity: h(1), adapterIdentitySha256: h(5), addonRootIdentity: h(2), kind: 'mod', action, addonId, filename,
        sourceState: action === 'disable' ? 'enabled' : 'disabled', targetState: action === 'disable' ? 'disabled' : 'enabled',
        sourceDirectoryIdentity: source === 'mods' ? h(2) : h(3), targetDirectoryIdentity: target === 'mods' ? h(2) : h(3),
        sourcePhysicalIdentity: inode, sourceSha256: checksum, metadataName: null, metadataVersion: null, metadataLoader: null,
        minecraftConstraint: null, metadataStatus: 'parsed', trashId: null, guardBackupId: randomUUID(), guardChecksum: h(9) }
    } };
}
it('follows explicit edges with equal timestamps, repeated paths and shuffled record order', () => {
  const a = install(), b = move(a, 'disable'), c = move(b, 'enable'), d = move(c, 'disable');
  const proof = resolveAddonSuccessors([d, a, c, b], a, identity);
  expect(proof.records.map(row => row.transactionId)).toEqual([a, b, c, d].map(row => row.transactionId));
  expect(proof.terminal).toEqual({ path: `disabled-mods/${filename}`, directoryIdentity: h(3), state: 'disabled' });
});
it('refuses forks and an unfinished referenced child instead of trusting successful operation outcomes', () => {
  const a = install(), b = move(a, 'disable'), c = move(a, 'disable');
  expect(() => resolveAddonSuccessors([a, b, c], a, identity)).toThrow('模组移动历史无法唯一核验');
  expect(() => resolveAddonSuccessors([a, { ...b, state: 'recovery-required' }], a, identity)).toThrow();
});
it.each(['source-path', 'source-directory', 'inode', 'checksum', 'adapter', 'loader', 'activation-consent'] as const)(
  'refuses a successor with mismatched %s', mode => {
    const a = install(), b = move(a, 'disable'), c = move(b, 'enable');
    const life = c.intent.addonLifecycle!;
    const changed = { ...c, intent: { ...c.intent,
      ...(mode === 'source-path' ? { paths: [{ role: 'source' as const, namespace: 'server' as const, relativePath: 'mods/wrong.jar' }, c.intent.paths[1]!] } : {}),
      addonLifecycle: { ...life,
        ...(mode === 'source-directory' ? { sourceDirectoryIdentity: h(4) } : {}),
        ...(mode === 'inode' ? { sourcePhysicalIdentity: h(4) } : {}),
        ...(mode === 'checksum' ? { sourceSha256: h(4) } : {}),
        ...(mode === 'adapter' ? { adapterIdentitySha256: h(4) } : {}),
        ...(mode === 'loader' ? { serverType: 'forge' as const } : {}) } } };
    if (mode === 'activation-consent') {
      const { confirmUnknownCompatibility, ...rest } = changed.intent.addonLifecycle;
      expect(confirmUnknownCompatibility).toBe(true);
      expect(() => resolveAddonSuccessors([a, b, { ...changed, intent: { ...changed.intent, addonLifecycle: rest } }], a, identity)).toThrow();
    } else expect(() => resolveAddonSuccessors([a, b, changed], a, identity)).toThrow();
  });
it('does not treat an unrelated same-inode record as an authorized successor', () => {
  const a = install(), unrelated = move(a, 'disable', randomUUID());
  expect(() => resolveAddonSuccessors([a, unrelated], a, identity)).toThrow();
});
