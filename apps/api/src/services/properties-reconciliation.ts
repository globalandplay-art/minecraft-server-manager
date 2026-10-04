import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Operation } from "@mcsm/contracts";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";
import { PropertiesGuardStore } from "./properties-guard.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import type { TransactionJournalRecord, TransactionJournalStore } from "./transaction-journal.js";

const unsafe = () => new DomainError(409, "RECOVERY_REQUIRED", "配置事务磁盘状态无法确认，禁止启动并保留保护副本", "properties-reconciliation-unsafe", true);
export function establishedPropertiesOutcome(record: TransactionJournalRecord, outcomes: readonly Operation[]): boolean {
  const outcome = outcomes.find((item) => item.id === record.intent.operationId);
  return Boolean(outcome?.state === "succeeded" && ["completed", "committed"].includes(outcome.step) && outcome.error === null &&
    outcome.kind === "properties-write" && outcome.serverId === record.intent.serverId &&
    outcome.result?.resourceId === record.intent.propertiesWrite?.guardId);
}
export function propertiesCheckpointIdentity(record: TransactionJournalRecord, name: string): string {
  const items = record.checkpoints.filter((checkpoint) => checkpoint.name === name);
  const value = items[0]?.details?.checksumSha256;
  if (items.length !== 1 || !value || !/^[0-9a-f]{64}$/u.test(value)) throw unsafe();
  return value;
}

/** Established history may have a legitimately edited target, never edited guard/old slots. */
export async function verifyCommittedProperties(
  managerRoot: string, journal: TransactionJournalStore, record: TransactionJournalRecord,
  registeredRoot: string, established: boolean
): Promise<void> {
  try {
    const p = record.intent.propertiesWrite;
    if (!p || record.state !== "committed" || await backupDirectoryIdentity(registeredRoot) !== p.rootIdentity) throw unsafe();
    const guard = new PropertiesGuardStore(managerRoot, journal);
    await guard.verify(record, registeredRoot);
    const workspace = path.join(registeredRoot, p.workspaceName);
    const workspaceIdentity = propertiesCheckpointIdentity(record, "properties-workspace-verified");
    if (await backupDirectoryIdentity(workspace) !== workspaceIdentity) throw unsafe();
    if ((await readdir(workspace)).sort().join("\0") !== "old.properties") throw unsafe();
    const old = await readPrivatePropertiesFile(path.join(workspace, "old.properties"));
    if (old.identity !== p.originalFileIdentity || old.checksum !== p.originalChecksum) throw unsafe();
    propertiesCheckpointIdentity(record, "properties-prepared-verified");
    const installedIdentity = propertiesCheckpointIdentity(record, "properties-installed-file-verified");
    const installedChecksum = propertiesCheckpointIdentity(record, "properties-installed-verified");
    if (installedChecksum !== p.preparedChecksum) throw unsafe();
    const target = await readPrivatePropertiesFile(path.join(registeredRoot, "server.properties"));
    if (!established && (target.identity !== installedIdentity || target.checksum !== p.preparedChecksum)) throw unsafe();
    if (await backupDirectoryIdentity(registeredRoot) !== p.rootIdentity || await backupDirectoryIdentity(workspace) !== workspaceIdentity) throw unsafe();
  } catch { throw unsafe(); }
}
