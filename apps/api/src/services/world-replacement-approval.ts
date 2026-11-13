import { createHash } from "node:crypto";
import path from "node:path";
import { worldIdentity } from "./active-world-state-store.js";
import { backupDirectoryIdentity, directoryObjectIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import type { TransactionJournalRecord } from "./transaction-journal.js";
import { verifyReplacementCatalogSnapshot } from "./world-library-store.js";

const fail = () => new DomainError(409, "RECOVERY_REQUIRED", "Replacement approval files require inspection", "world-replacement-approval-unverified", true);
const hash = /^[0-9a-f]{64}$/u;

/** Snapshot-file proof ONLY, from an already parsed journal and registered root.
 * Catalog bytes are digest-bound here, not semantically accepted. Does not prove
 * original active/catalog identity, current live state, source, full protocol,
 * physical completion or recovery. Never publishes or returns private bytes.
 */
export async function verifyReplacementApprovalFiles(original: TransactionJournalRecord, root: string, check: () => void = () => {}) {
  try {
    const record = structuredClone(original), value = record.intent.worldReplacement, approval = value?.approval;
    if (record.schemaVersion !== 13 || record.intent.kind !== "world-replace" || !value || !approval || approval.schemaVersion !== 1 ||
        !["active", "committed"].includes(record.state) ||
        [approval.propertiesIdentity, approval.activeStateIdentity, approval.activeStateChecksum, approval.catalogFileIdentity].some(value => !hash.test(value)) ||
        createHash("sha256").update(`${approval.propertiesIdentity}\0${value.propertiesChecksum}`).digest("hex") !== value.propertiesRevision) throw fail();
    const workspace = path.join(root, value.workspaceName);
    const detail = (name: string) => {
      const points = record.checkpoints.filter(point => point.name === name);
      if (points.length !== 1 || points[0]!.details?.resourceId !== value.worldId) throw fail();
      return points[0]!.details!;
    };
    const workspaceId = detail("replacement-workspace-created").filesystemIdentity;
    if (!workspaceId || !hash.test(workspaceId)) throw fail();
    const expected = [
      ["properties.before", "replacement-properties-before-verified", value.propertiesChecksum, 1024 * 1024],
      ["catalog.before", "replacement-catalog-before-verified", value.libraryRevision, 1024 * 1024],
      ["active.before", "replacement-active-before-verified", approval.activeStateChecksum, 16 * 1024]
    ] as const;
    const recheck = async () => {
      try {
        check();
        if (await backupDirectoryIdentity(root) !== value.rootIdentity || await directoryObjectIdentity(workspace) !== workspaceId) throw fail();
        for (const [file, step, checksum, limit] of expected) {
          const proof = detail(step), copy = await readPrivatePropertiesFile(path.join(workspace, file), limit);
          try {
            if (!proof.filesystemIdentity || !hash.test(proof.filesystemIdentity) || proof.filesystemIdentity !== copy.identity ||
                proof.checksumSha256 !== checksum || copy.checksum !== checksum) throw fail();
            if (file !== "catalog.before") {
              const text = copy.bytes.toString("utf8");
              if (!copy.bytes.equals(Buffer.from(text, "utf8")) || text.startsWith("\ufeff") || text.includes("\0")) throw fail();
              if (file === "properties.before") {
                const names = editablePropertyEntries(text).filter(([key]) => key === "level-name");
                if (names.length !== 1 || names[0]![1] !== value.levelName) throw fail();
              } else {
                const state: unknown = JSON.parse(text);
                if (!state || typeof state !== "object" || Array.isArray(state)) throw fail();
                const s = state as Record<string, unknown>;
                // Existing ActiveWorldStateStore writes this canonical form.
                // Refuse duplicate-key/noncanonical originals for this new path.
                if ((text !== JSON.stringify(s) && text !== JSON.stringify(s) + "\n") ||
                    Object.keys(s).some(key => !["schemaVersion", "serverId", "state", "worldId", "levelName"].includes(key)) ||
                    s.schemaVersion !== 1 || s.serverId !== record.intent.serverId || s.state !== "active" || s.levelName !== value.levelName ||
                    s.worldId !== worldIdentity(record.intent.serverId, value.levelName)) throw fail();
              }
            }
          } finally { copy.bytes.fill(0); }
          check();
        }
        if (await backupDirectoryIdentity(root) !== value.rootIdentity || await directoryObjectIdentity(workspace) !== workspaceId) throw fail();
        check();
      } catch { throw fail(); }
    };
    await recheck();
    return { recheck, recordDigest: createHash("sha256").update(JSON.stringify(record)).digest("hex") };
  } catch { throw fail(); }
}

/** Combined immutable snapshot content proof, still not original-file/current
 * anchor identity or live-world/source/physical completion/recovery authority.
 * Uses only filesystem/pure checks; never calls a store lock or mutator.
 */
export async function verifyReplacementApprovalSnapshots(original: TransactionJournalRecord, root: string,
  originalPrefix: readonly TransactionJournalRecord[], check: () => void = () => {}) {
  try {
    const record = structuredClone(original), prefix = structuredClone(originalPrefix);
    const files = await verifyReplacementApprovalFiles(record, root, check);
    const recheck = async () => {
      try {
        await files.recheck(); check();
        const copy = await readPrivatePropertiesFile(path.join(root, record.intent.worldReplacement!.workspaceName, "catalog.before"), 1024 * 1024);
        try { verifyReplacementCatalogSnapshot(copy.bytes, record, prefix); } finally { copy.bytes.fill(0); }
        check(); await files.recheck();
      } catch { throw fail(); }
    };
    await recheck();
    return { recheck, recordDigest: files.recordDigest };
  } catch { throw fail(); }
}

/** Pre-reservation admission ONLY: bind retained copies to all three original
 * files while the old catalog is still present. Cannot be reused after a pending
 * head replaces that catalog. Caller holds the instance lease and must separately
 * verify active runtime, source upload and world contents before any data change.
 */
export async function verifyReplacementAdmissionFiles(original: TransactionJournalRecord, root: string, managerRoot: string,
  originalPrefix: readonly TransactionJournalRecord[], check: () => void = () => {}) {
  try {
    const record = structuredClone(original), prefix = structuredClone(originalPrefix);
    const snapshots = await verifyReplacementApprovalSnapshots(record, root, prefix, check);
    const value = record.intent.worldReplacement!, approval = value.approval!, serverId = record.intent.serverId;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62})$/iu.test(serverId)) throw fail();
    const expected = [
      [path.join(root, "server.properties"), approval.propertiesIdentity, value.propertiesChecksum, 1024 * 1024],
      [path.join(managerRoot, "active-worlds", `${serverId}.json`), approval.activeStateIdentity, approval.activeStateChecksum, 16 * 1024],
      [path.join(managerRoot, "world-library", serverId, "state.json"), approval.catalogFileIdentity, value.libraryRevision, 1024 * 1024]
    ] as const;
    const recheck = async () => {
      try {
        await snapshots.recheck();
        for (const [file, identity, checksum, limit] of expected) {
          check(); const originalFile = await readPrivatePropertiesFile(file, limit);
          try { if (originalFile.identity !== identity || originalFile.checksum !== checksum) throw fail(); }
          finally { originalFile.bytes.fill(0); }
        }
        check(); await snapshots.recheck();
      } catch { throw fail(); }
    };
    await recheck();
    return { recheck, recordDigest: snapshots.recordDigest, phase: "before-reservation" as const };
  } catch { throw fail(); }
}
