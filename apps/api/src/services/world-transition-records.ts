import type { TransactionJournalRecord } from "./transaction-journal.js";
import { createHash } from "node:crypto";
import { DomainError } from "./domain-errors.js";
import { orderedActivationHistory } from "./world-activation-history.js";
import { activationTransitionEvents, projectWorldTransitions, projectWorldTransitionsFromGenesis,
  type WorldTransitionEvent, type WorldTransitionGenesis } from "./world-transition-history.js";

/** Exact committed protocol; interruption in a rename/checkpoint gap is not a
 * completed event. A physical verifier must separately inspect retained data. */
export const replacementCheckpoints = ["replacement-head-reserved", "replacement-upload-claimed", "replacement-guard-verified",
  "replacement-guard-manifest-verified", "replacement-workspace-created", "replacement-world-staged", "replacement-displace-intent", "replacement-old-world-preserved", "replacement-install-intent",
  "replacement-world-installed", "replacement-identity-installed"] as const;
/** Schema13 captures original approval files before reserving the catalog head.
 * Schema12 retains its original inspection-only eleven-marker interpretation. */
export const replacementExecutionCheckpoints = ["replacement-intent-persisted", "replacement-workspace-created",
  "replacement-properties-before-verified", "replacement-catalog-before-verified", "replacement-active-before-verified",
  "replacement-head-reserved", "replacement-upload-claimed", "replacement-guard-verified", "replacement-guard-manifest-verified",
  "replacement-world-staged", "replacement-displace-intent", "replacement-old-world-preserved", "replacement-install-intent",
  "replacement-world-installed", "replacement-identity-installed"] as const;
const hash = /^[0-9a-f]{64}$/u;
const invalid = () => new DomainError(409, "RECOVERY_REQUIRED", "Mixed world history requires inspection", "world-transition-record-unverified", true);

/** Checks the first five immutable-approval markers only; caller enforces exact
 * phase length and physically verifies the copies/originals. No authority token. */
export function verifyReplacementAdmissionPrefix(record: TransactionJournalRecord): void {
  const value = record.intent.worldReplacement, approval = value?.approval;
  if (record.schemaVersion !== 13 || record.intent.kind !== "world-replace" || !value || !approval || approval.schemaVersion !== 1 ||
      record.checkpoints.length < 5 || record.checkpoints.slice(0, 5).some((point, index) => point.name !== replacementExecutionCheckpoints[index] ||
        point.sequence !== index + 1 || point.details?.resourceId !== value.worldId) ||
      [approval.propertiesIdentity, approval.activeStateIdentity, approval.activeStateChecksum, approval.catalogFileIdentity]
        .some(value => typeof value !== "string" || !hash.test(value)) ||
      createHash("sha256").update(`${approval.propertiesIdentity}\0${value.propertiesChecksum}`).digest("hex") !== value.propertiesRevision) throw invalid();
  const workspace = record.checkpoints[1]!.details!;
  if (typeof workspace.filesystemIdentity !== "string" || !hash.test(workspace.filesystemIdentity)) throw invalid();
  for (const [index, checksum] of [[2, value.propertiesChecksum], [3, value.libraryRevision], [4, approval.activeStateChecksum]] as const) {
    const point = record.checkpoints[index]!.details!;
    if (point.checksumSha256 !== checksum || typeof point.filesystemIdentity !== "string" || !hash.test(point.filesystemIdentity)) throw invalid();
  }
}

/** Consumes journal-reader output only. Checkpoint equality is structural
 * evidence, NEVER a substitute for guard/source/physical/head verification. */
export function replacementTransitionEvent(record: TransactionJournalRecord): WorldTransitionEvent {
  const value = record.intent.worldReplacement;
  const expected = record.schemaVersion === 13 ? replacementExecutionCheckpoints : replacementCheckpoints;
  if (![12, 13].includes(record.schemaVersion) || record.state !== "committed" || record.intent.kind !== "world-replace" || !value ||
      (record.schemaVersion === 13) !== (value.approval !== undefined) ||
      record.intent.worldActivation || record.checkpoints.length !== expected.length ||
      record.checkpoints.some((point, index) => point.sequence !== index + 1 || point.name !== expected[index] ||
        point.details?.resourceId !== value.worldId)) throw invalid();
  const details = (name: string) => record.checkpoints.find(point => point.name === name)!.details!;
  const claimed = details("replacement-upload-claimed"), guard = details("replacement-guard-verified"), manifest = details("replacement-guard-manifest-verified"),
    workspace = details("replacement-workspace-created"), staged = details("replacement-world-staged"),
    preserved = details("replacement-old-world-preserved"), installed = details("replacement-world-installed"), identity = details("replacement-identity-installed");
  if (record.schemaVersion === 13) {
    verifyReplacementAdmissionPrefix(record);
  }
  // Existing guards hash manifest paths including the world-name prefix. Only
  // the physical guard verifier can compare that digest with the actual manifest
  // and independently check stripped world-relative files against currentContent.
  if (claimed.checksumSha256 !== value.importedChecksum ||
      staged.checksumSha256 !== value.importedChecksum || preserved.checksumSha256 !== value.currentContentChecksum ||
      preserved.filesystemIdentity !== value.currentObjectIdentity || installed.checksumSha256 !== value.importedChecksum ||
      installed.filesystemIdentity !== staged.filesystemIdentity || identity.checksumSha256 !== value.importedChecksum ||
      [guard.checksumSha256, guard.filesystemIdentity, manifest.filesystemIdentity, workspace.filesystemIdentity, manifest.checksumSha256]
        .some(value => typeof value !== "string" || !hash.test(value)) ||
      typeof staged.filesystemIdentity !== "string" || !hash.test(staged.filesystemIdentity) ||
      staged.filesystemIdentity === value.currentObjectIdentity || typeof identity.filesystemIdentity !== "string" ||
      !hash.test(identity.filesystemIdentity) || identity.filesystemIdentity === value.currentDirectoryIdentity ||
      identity.filesystemIdentity === staged.filesystemIdentity) throw invalid();
  return { kind: "replacement", serverId: record.intent.serverId, transactionId: record.transactionId.toLowerCase(),
    operationId: record.intent.operationId.toLowerCase(), guardBackupId: value.guardBackupId.toLowerCase(), rootIdentity: value.rootIdentity,
    catalogId: value.catalogId.toLowerCase(), sequence: value.sequence, predecessorTransactionId: value.predecessorTransactionId?.toLowerCase() ?? null,
    previous: { worldId: value.previousWorldId, levelName: value.levelName, directoryIdentity: value.currentDirectoryIdentity },
    next: { worldId: value.worldId, levelName: value.levelName, directoryIdentity: identity.filesystemIdentity } };
}

export function worldTransitionEvent(record: TransactionJournalRecord): WorldTransitionEvent {
  if (record.intent.worldReplacement) return replacementTransitionEvent(record);
  const value = record.intent.worldActivation;
  if (!value || record.state !== "committed" || record.intent.kind !== "world-activate" ||
      record.schemaVersion !== (value.sourceGuard ? 11 : 10)) throw invalid();
  return { kind: "activation", serverId: record.intent.serverId, transactionId: record.transactionId.toLowerCase(),
    operationId: record.intent.operationId.toLowerCase(), guardBackupId: value.guardBackupId.toLowerCase(), rootIdentity: value.rootIdentity,
    catalogId: value.catalogId.toLowerCase(), sequence: value.sequence, predecessorTransactionId: value.predecessorTransactionId?.toLowerCase() ?? null,
    previous: { worldId: value.previousWorldId, levelName: value.previousName, directoryIdentity: value.currentDirectoryIdentity },
    next: { worldId: value.worldId, levelName: value.nextName, directoryIdentity: value.targetDirectoryIdentity } };
}

/** Returns ORIGINAL record objects so saved heads digest every field/checkpoint.
 * No runtime/active-state acceptance, lock clearing or mutation is performed. */
export function orderedWorldTransitionRecords(serverId: string, records: readonly TransactionJournalRecord[],
  genesis?: WorldTransitionGenesis): readonly TransactionJournalRecord[] {
  if (!Array.isArray(records) || records.length > 10_000) throw invalid();
  const relevant = records.filter(record => record.intent.serverId === serverId &&
    (record.intent.worldActivation || record.intent.worldReplacement || ["world-replace", "world-activate"].includes(record.intent.kind)));
  if (relevant.some(record => (!record.intent.worldActivation && !record.intent.worldReplacement) ||
      (record.intent.worldActivation && record.intent.worldReplacement))) throw invalid();
  // A verified generation caller supplies its immutable seed, never a seed
  // reconstructed from current catalog entries. This remains structural only;
  // the caller must authenticate genesis and forbid generation ID reuse.
  const project = (events: readonly WorldTransitionEvent[]) => genesis
    ? projectWorldTransitionsFromGenesis(serverId, events, genesis) : projectWorldTransitions(serverId, events);
  if (!relevant.some(record => record.intent.worldReplacement || record.intent.kind === "world-replace")) {
    const old = orderedActivationHistory(serverId, records);
    project(activationTransitionEvents(serverId, old));
    return old;
  }
  const paired = relevant.map(record => ({ record, event: worldTransitionEvent(record) })).sort((a, b) => a.event.sequence - b.event.sequence);
  project(paired.map(pair => pair.event));
  for (const [index, pair] of paired.entries()) {
    const value = pair.record.intent.worldActivation;
    if (!value?.sourceGuard) continue;
    const source = paired.slice(0, index).reverse().find(previous => previous.event.previous.worldId === value.worldId);
    const guard = source?.record.intent.worldActivation;
    if (!source || !guard || value.sourceGuard.transactionId.toLowerCase() !== source.record.transactionId.toLowerCase() ||
        value.sourceGuard.guardBackupId.toLowerCase() !== guard.guardBackupId.toLowerCase() ||
        value.sourceGuard.checksum !== guard.currentContentChecksum || value.targetContentChecksum !== guard.currentContentChecksum ||
        guard.previousName !== value.nextName || guard.currentDirectoryIdentity !== value.targetDirectoryIdentity) throw invalid();
  }
  return paired.map(pair => pair.record);
}
