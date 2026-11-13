import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { readWorldGenerationReservation, type WorldGenerationReservation } from "./world-generation-reservation.js";

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
  | "world-library-import"
  | "world-activate"
  | "world-replace"
  | "world-archive"
  | "properties-write"
  | "addon-install"
  | "addon-lifecycle";
export type TransactionState = "active" | "recovery-required" | "committed" | "rolled-back";
export type JournalPathRole = "source" | "target" | "staging" | "rollback" | "archive";

export interface TransactionPath {
  readonly role: JournalPathRole;
  readonly relativePath: string;
  readonly namespace?: "manager" | "server";
}

export interface RestoreIntent {
  /** Missing only on legacy records; those cannot authorize automated recovery. */
  readonly rootIdentity?: string;
  readonly backupId: string;
  readonly guardBackupId: string;
  readonly levelName: string;
  readonly worldId: string;
  readonly approvedRevision: string;
  readonly backupChecksum: string;
  readonly parentTransactionId: string | null;
  readonly startAfter: boolean;
  readonly workspaceName: string;
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
  readonly restore?: RestoreIntent;
  /** Same-name V2 replacement. Target object identity is bound by staged/installed
   * checkpoints, never invented before the target directory exists. */
  readonly worldReplacement?: {
    readonly rootIdentity: string; readonly catalogId: string;
    readonly worldId: string; readonly previousWorldId: string; readonly levelName: string; readonly confirmationName: string;
    readonly libraryRevision: string; readonly currentWorldRevision: string; readonly currentContentChecksum: string;
    readonly currentDirectoryIdentity: string; readonly currentObjectIdentity: string;
    readonly propertiesRevision: string; readonly propertiesChecksum: string;
    readonly uploadId: string; readonly uploadRevision: string; readonly importedChecksum: string;
    readonly minecraftVersion: "26.3"; readonly guardBackupId: string;
    readonly sequence: number; readonly predecessorTransactionId: string | null; readonly workspaceName: string;
    /** Explicitly versioned admission snapshots; not execution/recovery authority. */
    readonly approval?: {
      readonly schemaVersion: 1; readonly propertiesIdentity: string;
      readonly activeStateIdentity: string; readonly activeStateChecksum: string; readonly catalogFileIdentity: string;
    };
  };
  readonly worldActivation?: {
    readonly rootIdentity: string;
    readonly catalogId: string;
    readonly worldId: string;
    readonly previousWorldId: string;
    readonly previousName: string;
    readonly nextName: string;
    readonly libraryRevision: string;
    readonly currentWorldRevision: string;
    readonly targetWorldRevision: string;
    readonly currentContentChecksum: string;
    readonly targetContentChecksum: string;
    readonly currentDirectoryIdentity: string;
    readonly targetDirectoryIdentity: string;
    readonly sourceImportTransactionId: string | null;
    readonly sourceImportChecksum: string | null;
    readonly sourceGuard?: { readonly transactionId: string; readonly guardBackupId: string; readonly checksum: string };
    readonly predecessorTransactionId: string | null;
    readonly sequence: number;
    readonly guardBackupId: string;
    readonly propertiesBefore: string;
    readonly propertiesAfter: string;
    readonly workspaceName: string;
  };
  readonly worldChange?: {
    readonly generation?: WorldGenerationReservation;
    readonly rootIdentity: string;
    readonly previousName: string;
    readonly nextName: string;
    readonly approvedRevision: string;
    readonly guardBackupId: string;
    readonly propertiesBefore: string;
    readonly propertiesAfter: string;
    readonly workspaceName: string;
  };
  readonly worldImport?: NonNullable<TransactionIntent["worldChange"]> & {
    readonly uploadId: string;
    readonly uploadRevision: string;
    readonly importedChecksum: string;
    readonly minecraftVersion: string;
  };
  /** V2 inactive import. The chosen lineage is durable before installing data. */
  readonly worldLibraryImport?: {
    readonly rootIdentity: string;
    readonly worldId: string;
    readonly targetName: string;
    readonly currentWorldId: string;
    readonly currentWorldRevision: string;
    readonly libraryRevision: string;
    readonly propertiesChecksum: string;
    readonly uploadId: string;
    readonly uploadRevision: string;
    readonly importedChecksum: string;
    readonly minecraftVersion: string;
    readonly workspaceName: string;
  };
  readonly worldArchive?: {
    readonly rootIdentity: string;
    readonly worldDirectoryIdentity: string;
    readonly levelName: string;
    readonly worldId: string;
    readonly approvedRevision: string;
    readonly guardBackupId: string;
    readonly archiveId: string;
    readonly workspaceName: string;
    readonly propertiesChecksum: string;
  };
  readonly propertiesWrite?: {
    readonly rootIdentity: string;
    readonly worldId: string;
    readonly worldRevision: string;
    readonly originalFileIdentity: string;
    readonly originalChecksum: string;
    readonly preparedChecksum: string;
    readonly guardId: string;
    readonly workspaceName: string;
  };
  readonly addonInstall?: {
    readonly confirmUnknownCompatibility?: true;
    readonly rootIdentity: string;
    readonly adapterIdentitySha256: string;
    readonly addonRootIdentity: string;
    readonly kind: "mod" | "plugin";
    readonly filename: string;
    readonly uploadId: string;
    readonly uploadRevision: string;
    readonly uploadSha256: string;
    readonly guardBackupId: string;
    readonly guardChecksum: string;
    readonly workspaceName: string;
  };
  readonly addonLifecycle?: {
    readonly serverType?: "forge" | "neoforge";
    readonly predecessorTransactionId?: string | null;
    readonly confirmUnknownCompatibility?: true;
    readonly rootIdentity: string;
    readonly adapterIdentitySha256: string;
    readonly addonRootIdentity: string;
    readonly kind: "mod" | "plugin";
    readonly action: "disable" | "enable" | "trash" | "restore";
    readonly addonId: string;
    readonly filename: string;
    readonly sourceState: "enabled" | "disabled" | "trashed";
    readonly targetState: "enabled" | "disabled" | "trashed";
    readonly sourceDirectoryIdentity: string;
    readonly targetDirectoryIdentity: string;
    readonly sourcePhysicalIdentity: string;
    readonly sourceSha256: string;
    readonly metadataName: string | null;
    readonly metadataVersion: string | null;
    readonly metadataLoader: "fabric" | "paper" | null;
    readonly minecraftConstraint: string[] | null;
    readonly metadataStatus: "parsed" | "invalid" | "missing";
    readonly trashId: string | null;
    readonly guardBackupId: string;
    readonly guardChecksum: string;
  };
}

export interface CheckpointDetails {
  readonly relativePath?: string;
  readonly checksumSha256?: string;
  readonly filesystemIdentity?: string;
  readonly resourceId?: string;
}

export interface TransactionCheckpoint {
  readonly sequence: number;
  readonly name: string;
  readonly recordedAt: string;
  readonly details?: CheckpointDetails;
}

export interface TransactionJournalRecord {
  readonly schemaVersion: typeof SCHEMA_VERSION | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
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
  readonly locationIdentity?: string;
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
    "originalState", "paths", "createdAt", "restore", "worldChange", "worldImport", "worldLibraryImport", "worldActivation", "worldReplacement", "worldArchive", "propertiesWrite", "addonInstall", "addonLifecycle"
  ])) return false;
  if (!UUID.test(String(value.operationId)) || !SERVER_ID.test(String(value.serverId))) return false;
  if (!(["backup", "restore", "rollback", "world-create", "world-import", "world-library-import", "world-activate", "world-replace", "world-archive", "properties-write", "addon-install", "addon-lifecycle"] as unknown[])
    .includes(value.kind)) return false;
  if (!["world-set", "server-snapshot", null].includes(value.scope as never)) return false;
  if (value.resourceId !== null && !isOpaqueId(value.resourceId)) return false;
  if (typeof value.allowStop !== "boolean" || !["running", "stopped", "unknown"].includes(String(value.originalState))) return false;
  if (!Array.isArray(value.paths) || value.paths.length > 16 || !isTimestamp(value.createdAt)) return false;
  if (value.restore !== undefined) {
    const r = value.restore;
    if (!isObject(r) || !hasOnlyKeys(r, ["rootIdentity", "backupId", "guardBackupId", "levelName", "worldId", "approvedRevision", "backupChecksum", "parentTransactionId", "startAfter", "workspaceName"]) ||
        !["restore", "rollback"].includes(String(value.kind)) || value.scope !== "world-set" ||
        !UUID.test(String(r.backupId)) || !UUID.test(String(r.guardBackupId)) ||
        typeof r.levelName !== "string" || r.levelName.length > 128 ||
        typeof r.workspaceName !== "string" || !/^\.manager-restore-[0-9a-f-]{36}$/u.test(r.workspaceName) ||
        !/^world-[0-9a-f]{24}$/u.test(String(r.worldId)) || !SHA256.test(String(r.approvedRevision)) ||
        !SHA256.test(String(r.backupChecksum)) || (r.rootIdentity !== undefined && !SHA256.test(String(r.rootIdentity))) || typeof r.startAfter !== "boolean" ||
        (r.parentTransactionId !== null && !UUID.test(String(r.parentTransactionId)))) return false;
    try { if (normalizeRelativePath(r.levelName) !== r.levelName || r.levelName.includes("/")) return false; } catch { return false; }
  }
  if (value.worldChange !== undefined) {
    const w = value.worldChange;
    if (value.restore !== undefined || value.kind !== "world-create" || value.scope !== "world-set" || !isObject(w) ||
      !hasOnlyKeys(w, ["rootIdentity", "previousName", "nextName", "approvedRevision", "guardBackupId", "propertiesBefore", "propertiesAfter", "workspaceName", "generation"]) ||
      ![w.rootIdentity, w.approvedRevision, w.propertiesBefore, w.propertiesAfter].every((v) => typeof v === "string" && SHA256.test(v)) ||
      !UUID.test(String(w.guardBackupId)) || !/^\.manager-world-create-[0-9a-f-]{36}$/u.test(String(w.workspaceName))) return false;
    for (const name of [w.previousName, w.nextName]) {
      if (typeof name !== "string" || name.length > 128 || name.includes("/")) return false;
      try { if (normalizeRelativePath(name) !== name) return false; } catch { return false; }
    }
    if (w.generation !== undefined) {
      try {
        const g = readWorldGenerationReservation(w.generation);
        if (g.serverId !== value.serverId || g.operationId !== value.operationId || g.worldId !== value.resourceId ||
            g.rootIdentity !== w.rootIdentity || g.previousName !== w.previousName || g.nextName !== w.nextName ||
            g.guardBackupId !== w.guardBackupId || g.propertiesBefore !== w.propertiesBefore || g.propertiesAfter !== w.propertiesAfter ||
            w.workspaceName !== `.manager-world-create-${g.operationId}`) return false;
        const expected = [{ role: "source", relativePath: g.previousName },
          { role: "target", relativePath: g.nextName }, { role: "staging", relativePath: w.workspaceName }];
        const paths: unknown[] = value.paths;
        if (paths.length !== expected.length || expected.some(path => paths.filter(item => isObject(item) &&
          item.role === path.role && item.namespace === "server" && item.relativePath === path.relativePath).length !== 1)) return false;
      } catch { return false; }
    }
  }
  if (value.worldImport !== undefined) {
    const w = value.worldImport;
    if (value.restore !== undefined || value.worldChange !== undefined || value.kind !== "world-import" || value.scope !== "world-set" || !isObject(w) ||
      !hasOnlyKeys(w, ["rootIdentity", "previousName", "nextName", "approvedRevision", "guardBackupId", "propertiesBefore", "propertiesAfter", "workspaceName", "uploadId", "uploadRevision", "importedChecksum", "minecraftVersion"]) ||
      ![w.rootIdentity,w.approvedRevision,w.propertiesBefore,w.propertiesAfter,w.uploadRevision,w.importedChecksum].every((v) => typeof v === "string" && SHA256.test(v)) ||
      !UUID.test(String(w.guardBackupId)) || !UUID.test(String(w.uploadId)) || !/^\.manager-world-import-[0-9a-f-]{36}$/u.test(String(w.workspaceName)) ||
      typeof w.minecraftVersion !== "string" || !w.minecraftVersion || w.minecraftVersion.length > 128) return false;
    for (const name of [w.previousName,w.nextName]) {
      if (typeof name !== "string" || name.length > 128 || name.includes("/")) return false;
      try { if (normalizeRelativePath(name) !== name) return false; } catch { return false; }
    }
  }
  if (value.kind === "world-import" && value.worldImport === undefined) return false;
  if (value.worldArchive !== undefined) {
    const w = value.worldArchive;
    if (value.restore !== undefined || value.worldChange !== undefined || value.worldImport !== undefined ||
      value.kind !== "world-archive" || value.scope !== "world-set" || !isObject(w) ||
      !hasOnlyKeys(w, ["rootIdentity", "worldDirectoryIdentity", "levelName", "worldId", "approvedRevision", "guardBackupId", "archiveId", "workspaceName", "propertiesChecksum"]) ||
      ![w.rootIdentity,w.worldDirectoryIdentity,w.approvedRevision,w.propertiesChecksum].every((v) => typeof v === "string" && SHA256.test(v)) ||
      !UUID.test(String(w.guardBackupId)) || !UUID.test(String(w.archiveId)) ||
      !/^world-[0-9a-f]{24}$/u.test(String(w.worldId)) ||
      w.workspaceName !== `.manager-world-archive-${value.operationId}` ||
      typeof w.levelName !== "string" || w.levelName.length > 128 || w.levelName.includes("/")) return false;
    try { if (normalizeRelativePath(w.levelName) !== w.levelName) return false; } catch { return false; }
    if (value.paths.length !== 2 || !value.paths.some((p) => isObject(p) && p.role === "source" && p.namespace === "server" && p.relativePath === w.levelName) ||
      !value.paths.some((p) => isObject(p) && p.role === "archive" && p.namespace === "server" && p.relativePath === `${w.workspaceName}/world`)) return false;
  }
  if (value.kind === "world-archive" && value.worldArchive === undefined) return false;
  if (value.propertiesWrite !== undefined) {
    const p = value.propertiesWrite;
    if (value.kind !== "properties-write" || value.scope !== null || value.allowStop !== false || value.originalState !== "stopped" ||
      value.restore !== undefined || value.worldChange !== undefined || value.worldImport !== undefined || value.worldArchive !== undefined ||
      !isObject(p) || !hasOnlyKeys(p, ["rootIdentity", "worldId", "worldRevision", "originalFileIdentity", "originalChecksum", "preparedChecksum", "guardId", "workspaceName"]) ||
      ![p.rootIdentity, p.worldRevision, p.originalFileIdentity, p.originalChecksum, p.preparedChecksum].every((v) => typeof v === "string" && SHA256.test(v)) ||
      typeof p.worldId !== "string" || !/^world-[0-9a-f]{24}$/u.test(p.worldId) || !UUID.test(String(p.guardId)) || value.resourceId !== p.guardId ||
      p.workspaceName !== `.manager-properties-${value.operationId}`) return false;
    const expected = [
      { role: "target", namespace: "server", relativePath: "server.properties" },
      { role: "staging", namespace: "server", relativePath: p.workspaceName },
      { role: "rollback", namespace: "manager", relativePath: `properties-backups/${value.serverId}/${p.guardId}` }
    ];
    const paths = value.paths;
    if (paths.length !== expected.length || !expected.every((e) => paths.some((item: unknown) => isObject(item) &&
      item.role === e.role && item.namespace === e.namespace && item.relativePath === e.relativePath))) return false;
  }
  if (value.kind === "properties-write" && value.propertiesWrite === undefined) return false;
  if (value.addonInstall !== undefined) {
    const a = value.addonInstall;
    if (value.kind !== "addon-install" || value.scope !== "server-snapshot" || value.allowStop !== false || value.originalState !== "stopped" ||
      value.restore !== undefined || value.worldChange !== undefined || value.worldImport !== undefined || value.worldArchive !== undefined || value.propertiesWrite !== undefined ||
      !isObject(a) || !hasOnlyKeys(a, ["rootIdentity", "adapterIdentitySha256", "addonRootIdentity", "kind", "filename", "uploadId", "uploadRevision", "uploadSha256", "guardBackupId", "guardChecksum", "workspaceName", "confirmUnknownCompatibility"]) ||
      (a.confirmUnknownCompatibility !== undefined && a.confirmUnknownCompatibility !== true) ||
      ![a.rootIdentity, a.adapterIdentitySha256, a.addonRootIdentity, a.uploadRevision, a.uploadSha256, a.guardChecksum].every((item) => typeof item === "string" && SHA256.test(item)) ||
      !["mod", "plugin"].includes(String(a.kind)) || typeof a.filename !== "string" || a.filename.length < 5 || a.filename.length > 200 ||
      /[\\/:<>"|?*\u0000-\u001f\u007f]/u.test(a.filename) || !UUID.test(String(a.uploadId)) || !UUID.test(String(a.guardBackupId)) ||
      a.workspaceName !== `.manager-addon-${value.operationId}` || value.resourceId !== a.uploadId) return false;
    const folder = a.kind === "mod" ? "mods" : "plugins";
    const expected = [
      { role: "source", namespace: "manager", relativePath: `addon-uploads/${a.uploadId}/payload.jar` },
      { role: "target", namespace: "server", relativePath: `${folder}/${a.filename}` },
      { role: "staging", namespace: "server", relativePath: `${a.workspaceName}/prepared.jar` },
      { role: "rollback", namespace: "manager", relativePath: `backups/${value.serverId}/${a.guardBackupId}` }
    ];
    const paths = value.paths as unknown[];
    if (paths.length !== expected.length || !expected.every((e) => paths.some((item: unknown) => isObject(item) &&
      item.role === e.role && item.namespace === e.namespace && item.relativePath === e.relativePath))) return false;
  }
  if (value.kind === "addon-install" && value.addonInstall === undefined) return false;
  if (value.addonLifecycle !== undefined) {
    const a = value.addonLifecycle;
    const states = ["enabled", "disabled", "trashed"];
    const actions = ["disable", "enable", "trash", "restore"];
    if (value.kind !== "addon-lifecycle" || value.scope !== "server-snapshot" || value.allowStop !== false || value.originalState !== "stopped" ||
      value.restore !== undefined || value.worldChange !== undefined || value.worldImport !== undefined || value.worldArchive !== undefined || value.propertiesWrite !== undefined || value.addonInstall !== undefined ||
      !isObject(a) || !hasOnlyKeys(a, ["rootIdentity", "adapterIdentitySha256", "addonRootIdentity", "kind", "action", "addonId", "filename", "sourceState", "targetState", "sourceDirectoryIdentity", "targetDirectoryIdentity", "sourcePhysicalIdentity", "sourceSha256", "metadataName", "metadataVersion", "metadataLoader", "minecraftConstraint", "metadataStatus", "trashId", "guardBackupId", "guardChecksum", "serverType", "predecessorTransactionId", "confirmUnknownCompatibility"]) ||
      (a.serverType !== undefined && a.serverType !== 'forge' && a.serverType !== 'neoforge') ||
      (a.serverType === undefined && (a.predecessorTransactionId !== undefined || a.confirmUnknownCompatibility !== undefined)) ||
      (a.serverType !== undefined && (a.kind !== 'mod' || a.metadataLoader !== null ||
        (a.predecessorTransactionId !== null && !UUID.test(String(a.predecessorTransactionId))) ||
        (a.targetState === 'enabled' && a.confirmUnknownCompatibility !== true))) ||
      (a.confirmUnknownCompatibility !== undefined && a.confirmUnknownCompatibility !== true) ||
      ![a.rootIdentity, a.adapterIdentitySha256, a.addonRootIdentity, a.sourceDirectoryIdentity, a.targetDirectoryIdentity, a.sourcePhysicalIdentity, a.sourceSha256, a.guardChecksum].every((item) => typeof item === "string" && SHA256.test(item)) ||
      !["mod", "plugin"].includes(String(a.kind)) || !actions.includes(String(a.action)) || !states.includes(String(a.sourceState)) || !states.includes(String(a.targetState)) ||
      typeof a.addonId !== "string" || !SHA256.test(a.addonId) || typeof a.filename !== "string" || a.filename.length < 5 || a.filename.length > 200 ||
      !/\.jar$/iu.test(a.filename) || a.filename !== a.filename.normalize("NFC") || /[\\/:<>"|?*]/u.test(a.filename) ||
      (a.metadataName !== null && (typeof a.metadataName !== "string" || a.metadataName.length > 128)) || (a.metadataVersion !== null && (typeof a.metadataVersion !== "string" || a.metadataVersion.length > 128)) ||
      (a.metadataLoader !== null && a.metadataLoader !== (a.kind === "mod" ? "fabric" : "paper")) ||
      (a.minecraftConstraint !== null && (!Array.isArray(a.minecraftConstraint) || a.minecraftConstraint.length > 16 || !a.minecraftConstraint.every((v) => typeof v === "string" && v.length <= 128))) ||
      !["parsed", "invalid", "missing"].includes(String(a.metadataStatus)) ||
      (a.trashId !== null && !UUID.test(String(a.trashId))) || !UUID.test(String(a.guardBackupId)) || value.resourceId !== (a.trashId ?? a.addonId)) return false;
    if ((a.action === "disable" && (a.sourceState !== "enabled" || a.targetState !== "disabled")) ||
      (a.action === "enable" && (a.sourceState !== "disabled" || a.targetState !== "enabled")) ||
      (a.action === "trash" && (!(["enabled", "disabled"] as unknown[]).includes(a.sourceState) || a.targetState !== "trashed")) ||
      (a.action === "restore" && (a.sourceState !== "trashed" || !(["enabled", "disabled"] as unknown[]).includes(a.targetState))) ||
      ((a.sourceState === "trashed" || a.targetState === "trashed") !== (a.trashId !== null))) return false;
    const folder = a.kind === "mod" ? "mods" : "plugins";
    const disabled = a.kind === "mod" ? "disabled-mods" : "disabled-plugins";
    const enabledPath = folder + "/" + a.filename, disabledPath = disabled + "/" + a.filename;
    const trashPath = "trash/addons/" + value.serverId + "/" + a.trashId + "/payload.jar";
    const sourcePath = a.sourceState === "enabled" ? enabledPath : a.sourceState === "disabled" ? disabledPath : trashPath;
    const targetPath = a.targetState === "enabled" ? enabledPath : a.targetState === "disabled" ? disabledPath : trashPath;
    const expected = [
      { role: "source", namespace: "server", relativePath: sourcePath },
      { role: "target", namespace: "server", relativePath: targetPath },
      { role: "rollback", namespace: "manager", relativePath: "backups/" + value.serverId + "/" + a.guardBackupId }
    ];
    const paths = value.paths as unknown[];
    if (paths.length !== expected.length || !expected.every((e) => paths.some((p: unknown) => isObject(p) && p.role === e.role && p.namespace === e.namespace && p.relativePath === e.relativePath))) return false;
  }
  if (value.kind === "addon-lifecycle" && value.addonLifecycle === undefined) return false;
  if (value.worldLibraryImport !== undefined) {
    const w = value.worldLibraryImport;
    const lineage = /^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    if (!isObject(w) || typeof value.operationId !== "string" || typeof value.serverId !== "string" ||
        value.kind !== "world-library-import" || value.scope !== "world-set" || value.allowStop !== false ||
        value.originalState !== "stopped" || !hasOnlyKeys(w, ["rootIdentity", "worldId", "targetName", "currentWorldId",
          "currentWorldRevision", "libraryRevision", "propertiesChecksum", "uploadId", "uploadRevision", "importedChecksum", "minecraftVersion", "workspaceName"]) ||
        typeof w.worldId !== "string" || !lineage.test(w.worldId) || typeof w.currentWorldId !== "string" || !lineage.test(w.currentWorldId) || w.worldId === w.currentWorldId ||
        value.resourceId !== w.worldId || typeof w.uploadId !== "string" || !UUID.test(w.uploadId) ||
        !["rootIdentity", "currentWorldRevision", "libraryRevision", "propertiesChecksum", "uploadRevision", "importedChecksum"].every(key => typeof w[key] === "string" && SHA256.test(w[key] as string)) ||
        typeof w.targetName !== "string" || w.targetName.length > 64 || w.targetName.includes("/") || w.targetName.startsWith(".") ||
        w.minecraftVersion !== "26.3" || w.workspaceName !== `.manager-world-library-${value.operationId}`) return false;
    try { if (normalizeRelativePath(w.targetName) !== w.targetName) return false; } catch { return false; }
    const expected = [
      { role: "source", namespace: "manager", relativePath: `world-imports/${w.uploadId}/world` },
      { role: "target", namespace: "server", relativePath: w.targetName },
      { role: "staging", namespace: "server", relativePath: w.workspaceName }
    ];
    if (value.paths.length !== 3 || !expected.every(e => (value.paths as unknown[]).some(p =>
      isObject(p) && p.role === e.role && p.namespace === e.namespace && p.relativePath === e.relativePath))) return false;
  }
  if (value.kind === "world-library-import" && value.worldLibraryImport === undefined) return false;
  if (value.worldActivation !== undefined) {
    const w = value.worldActivation;
    const lineage = /^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    const hashes = ["rootIdentity", "libraryRevision", "currentWorldRevision", "targetWorldRevision", "currentContentChecksum", "targetContentChecksum",
      "currentDirectoryIdentity", "targetDirectoryIdentity", "propertiesBefore", "propertiesAfter"];
    if (!isObject(w) || !hasOnlyKeys(w, [...hashes, "catalogId", "worldId", "previousWorldId", "previousName", "nextName", "sourceImportTransactionId",
      "sourceImportChecksum", "sourceGuard", "predecessorTransactionId", "sequence", "guardBackupId", "workspaceName"]) ||
      typeof value.operationId !== "string" || typeof value.serverId !== "string" || value.kind !== "world-activate" ||
      value.scope !== "world-set" || value.allowStop !== false || value.originalState !== "stopped" ||
      hashes.some(key => typeof w[key] !== "string" || !SHA256.test(w[key] as string)) ||
      ["catalogId", "guardBackupId"].some(key => typeof w[key] !== "string" || !UUID.test(w[key] as string)) ||
      typeof w.worldId !== "string" || !lineage.test(w.worldId) || typeof w.previousWorldId !== "string" || !lineage.test(w.previousWorldId) ||
      w.worldId === w.previousWorldId || value.resourceId !== w.worldId ||
      typeof w.sequence !== "number" || !Number.isSafeInteger(w.sequence) || w.sequence < 1 ||
      (w.sequence === 1 ? w.predecessorTransactionId !== null : typeof w.predecessorTransactionId !== "string" || !UUID.test(w.predecessorTransactionId)) ||
      typeof w.previousName !== "string" || typeof w.nextName !== "string" || w.previousName.toLowerCase() === w.nextName.toLowerCase() ||
      w.workspaceName !== `.manager-world-activate-${value.operationId}` || w.propertiesBefore === w.propertiesAfter) return false;
    if (w.sourceGuard === undefined) {
      if (typeof w.sourceImportTransactionId !== "string" || !UUID.test(w.sourceImportTransactionId) ||
          typeof w.sourceImportChecksum !== "string" || !SHA256.test(w.sourceImportChecksum)) return false;
    } else {
      const source = w.sourceGuard;
      if (w.sequence === 1 || w.sourceImportTransactionId !== null || w.sourceImportChecksum !== null || !isObject(source) ||
          !hasOnlyKeys(source, ["transactionId", "guardBackupId", "checksum"]) ||
          typeof source.transactionId !== "string" || !UUID.test(source.transactionId) ||
          typeof source.guardBackupId !== "string" || !UUID.test(source.guardBackupId) ||
          typeof source.checksum !== "string" || !SHA256.test(source.checksum) ||
          source.checksum !== w.targetContentChecksum || source.guardBackupId.toLowerCase() === (w.guardBackupId as string).toLowerCase()) return false;
    }
    for (const name of [w.previousName, w.nextName]) {
      if (!name || name.length > 128 || name.includes("/") || name.startsWith(".") || name.normalize("NFC") !== name) return false;
      try { if (normalizeRelativePath(name) !== name) return false; } catch { return false; }
    }
    const expected = [
      { role: "source", namespace: "server", relativePath: w.previousName },
      { role: "target", namespace: "server", relativePath: w.nextName },
      { role: "staging", namespace: "server", relativePath: w.workspaceName },
      { role: "rollback", namespace: "manager", relativePath: `backups/${value.serverId}/${w.guardBackupId}` }
    ];
    if (value.paths.length !== expected.length || !expected.every(e => (value.paths as unknown[]).some(p =>
      isObject(p) && p.role === e.role && p.namespace === e.namespace && p.relativePath === e.relativePath))) return false;
  }
  if (value.kind === "world-activate" && value.worldActivation === undefined) return false;
  if (value.worldReplacement !== undefined) {
    const w = value.worldReplacement;
    const hashes = ["rootIdentity", "libraryRevision", "currentWorldRevision", "currentContentChecksum", "currentDirectoryIdentity",
      "currentObjectIdentity", "propertiesRevision", "propertiesChecksum", "uploadRevision", "importedChecksum"];
    const lineage = /^worldv2-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    if (!isObject(w) || !hasOnlyKeys(w, [...hashes, "catalogId", "worldId", "previousWorldId", "levelName", "confirmationName",
      "uploadId", "minecraftVersion", "guardBackupId", "sequence", "predecessorTransactionId", "workspaceName", "approval"]) ||
      typeof value.operationId !== "string" || typeof value.serverId !== "string" || value.kind !== "world-replace" ||
      value.scope !== "world-set" || value.allowStop !== false || value.originalState !== "stopped" ||
      hashes.some(key => typeof w[key] !== "string" || !SHA256.test(w[key] as string)) ||
      ["catalogId", "guardBackupId", "uploadId"].some(key => typeof w[key] !== "string" || !UUID.test(w[key] as string)) ||
      typeof w.worldId !== "string" || !lineage.test(w.worldId) || typeof w.previousWorldId !== "string" || !lineage.test(w.previousWorldId) ||
      w.worldId === w.previousWorldId || value.resourceId !== w.worldId || w.minecraftVersion !== "26.3" ||
      typeof w.sequence !== "number" || !Number.isSafeInteger(w.sequence) || w.sequence < 1 ||
      (w.sequence === 1 ? w.predecessorTransactionId !== null : typeof w.predecessorTransactionId !== "string" || !UUID.test(w.predecessorTransactionId)) ||
      typeof w.levelName !== "string" || !w.levelName || w.levelName.length > 128 || /[\\/:<>"|?*\u0000-\u001f\u007f]/u.test(w.levelName) ||
      w.levelName.startsWith(".") || w.levelName.normalize("NFC") !== w.levelName || w.confirmationName !== w.levelName ||
      w.workspaceName !== `.manager-world-replace-${value.operationId}`) return false;
    if (w.approval !== undefined) {
      const approval = w.approval;
      if (!isObject(approval) || !hasOnlyKeys(approval, ["schemaVersion", "propertiesIdentity", "activeStateIdentity", "activeStateChecksum", "catalogFileIdentity"]) ||
          approval.schemaVersion !== 1 || ["propertiesIdentity", "activeStateIdentity", "activeStateChecksum", "catalogFileIdentity"]
            .some(key => typeof approval[key] !== "string" || !SHA256.test(approval[key] as string)) ||
          createHash("sha256").update(`${approval.propertiesIdentity}\0${w.propertiesChecksum}`).digest("hex") !== w.propertiesRevision) return false;
    }
    try { if (normalizeRelativePath(w.levelName) !== w.levelName) return false; } catch { return false; }
    const expected = [
      { role: "source", namespace: "server", relativePath: w.levelName },
      { role: "target", namespace: "server", relativePath: w.levelName },
      { role: "staging", namespace: "server", relativePath: w.workspaceName },
      { role: "archive", namespace: "server", relativePath: `${w.workspaceName}/previous-world` },
      { role: "rollback", namespace: "manager", relativePath: `backups/${value.serverId}/${w.guardBackupId}` }
    ];
    if (value.paths.length !== expected.length || !expected.every(e => (value.paths as unknown[]).some(p =>
      isObject(p) && p.role === e.role && p.namespace === e.namespace && p.relativePath === e.relativePath))) return false;
  }
  if (value.kind === "world-replace" && value.worldReplacement === undefined) return false;
  const roles = new Set<string>();
  for (const item of value.paths) {
    if (!isObject(item) || !hasOnlyKeys(item, ["role", "relativePath", "namespace"])) return false;
    if ((value.restore !== undefined || value.worldChange !== undefined || value.worldImport !== undefined || value.worldLibraryImport !== undefined || value.worldActivation !== undefined || value.worldReplacement !== undefined || value.worldArchive !== undefined || value.propertiesWrite !== undefined || value.addonInstall !== undefined || value.addonLifecycle !== undefined) && !["manager", "server"].includes(String(item.namespace))) return false;
    if (value.restore === undefined && value.worldChange === undefined && value.worldImport === undefined && value.worldLibraryImport === undefined && value.worldActivation === undefined && value.worldReplacement === undefined && value.worldArchive === undefined && value.propertiesWrite === undefined && value.addonInstall === undefined && value.addonLifecycle === undefined && item.namespace !== undefined) return false;
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
  if (!isObject(value) || !hasOnlyKeys(value, ["relativePath", "checksumSha256", "filesystemIdentity", "resourceId"])) return false;
  if (value.relativePath !== undefined) {
    if (typeof value.relativePath !== "string") return false;
    try {
      if (normalizeRelativePath(value.relativePath) !== value.relativePath) return false;
    } catch { return false; }
  }
  if (value.checksumSha256 !== undefined &&
      (typeof value.checksumSha256 !== "string" || !SHA256.test(value.checksumSha256))) return false;
  if (value.filesystemIdentity !== undefined &&
      (typeof value.filesystemIdentity !== "string" || !SHA256.test(value.filesystemIdentity))) return false;
  return value.resourceId === undefined || isOpaqueId(value.resourceId);
}

function validateRecord(value: unknown): value is TransactionJournalRecord {
  if (!isObject(value) || !hasOnlyKeys(value, [
    "schemaVersion", "transactionId", "intent", "state", "checkpoints", "updatedAt"
  ])) return false;
  if (![SCHEMA_VERSION, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].includes(value.schemaVersion as never) || !UUID.test(String(value.transactionId)) ||
      !validateIntent(value.intent) ||
      !["active", "recovery-required", "committed", "rolled-back"].includes(String(value.state)) ||
      !Array.isArray(value.checkpoints) || value.checkpoints.length > MAX_CHECKPOINTS ||
      !isTimestamp(value.updatedAt)) return false;
  if ((value.schemaVersion === 2) !== (value.intent.restore !== undefined)) return false;
  if ((value.schemaVersion === 3 || value.schemaVersion === 14) !== (value.intent.worldChange !== undefined) ||
      (value.schemaVersion === 14) !== (value.intent.worldChange?.generation !== undefined)) return false;
  if (value.intent.worldChange?.generation?.transactionId !== undefined &&
      value.intent.worldChange.generation.transactionId !== value.transactionId) return false;
  if ((value.schemaVersion === 4) !== (value.intent.worldImport !== undefined)) return false;
  if ((value.schemaVersion === 5) !== (value.intent.worldArchive !== undefined)) return false;
  if ((value.schemaVersion === 6) !== (value.intent.propertiesWrite !== undefined)) return false;
  if ((value.schemaVersion === 7) !== (value.intent.addonInstall !== undefined)) return false;
  if ((value.schemaVersion === 8) !== (value.intent.addonLifecycle !== undefined)) return false;
  if ((value.schemaVersion === 9) !== (value.intent.worldLibraryImport !== undefined)) return false;
  if ((value.schemaVersion === 10 || value.schemaVersion === 11) !== (value.intent.worldActivation !== undefined)) return false;
  if ((value.schemaVersion === 11) !== (value.intent.worldActivation?.sourceGuard !== undefined)) return false;
  if ((value.schemaVersion === 12 || value.schemaVersion === 13) !== (value.intent.worldReplacement !== undefined) ||
      (value.schemaVersion === 13) !== (value.intent.worldReplacement?.approval !== undefined)) return false;
  if ((value.schemaVersion === 12 || value.schemaVersion === 13) && (typeof value.transactionId !== "string" || typeof value.state !== "string" ||
      value.intent.worldReplacement!.predecessorTransactionId?.toLowerCase() === value.transactionId.toLowerCase())) return false;
  if ((value.schemaVersion === 9 || value.schemaVersion === 10 || value.schemaVersion === 11) && (typeof value.transactionId !== "string" || typeof value.state !== "string")) return false;
  if (value.intent.worldActivation && (value.intent.worldActivation.predecessorTransactionId?.toLowerCase() === (value.transactionId as string).toLowerCase() ||
      value.intent.worldActivation.sourceGuard?.transactionId.toLowerCase() === (value.transactionId as string).toLowerCase())) return false;
  let previousTime = Date.parse(value.intent.createdAt);
  for (let index = 0; index < value.checkpoints.length; index += 1) {
    const checkpoint = value.checkpoints[index];
    if (!isObject(checkpoint) || !hasOnlyKeys(checkpoint, ["sequence", "name", "recordedAt", "details"]) ||
        ((value.schemaVersion === 9 || value.schemaVersion === 10 || value.schemaVersion === 11 || value.schemaVersion === 12 || value.schemaVersion === 13 || value.schemaVersion === 14) && typeof checkpoint.name !== "string") ||
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

  async initialize(bindLocation = false): Promise<JournalScanResult> {
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
    return bindLocation ? this.#scanAtCurrentLocation(readBounded) : this.scan();
  }

  async finalizeRollback(serverId: string, parentId: string, childId: string, updatedAt: string, inject?: (point: string) => Promise<void>): Promise<void> {
    await this.#mutate(async () => {
      const parent = await this.#read(serverId, parentId);
      const child = await this.#read(serverId, childId);
      if (parent.intent.kind !== "restore" || !parent.intent.restore || child.state !== "committed" || child.intent.kind !== "rollback" ||
        child.intent.restore?.parentTransactionId !== parentId || child.intent.restore.guardBackupId !== parent.intent.restore.guardBackupId ||
        !child.checkpoints.some((c) => c.name === "installed-verified")) throw new Error("Invalid rollback finalization");
      const scan = await this.scan();
      for (const sibling of scan.records) if (sibling.intent.restore?.parentTransactionId === parentId &&
        ["active", "recovery-required"].includes(sibling.state)) {
        await this.#write({ ...sibling, state: "rolled-back", updatedAt });
        await inject?.("after:rollback-sibling-finalized");
      }
      // Parent completion is published last; startup also supports recovery of
      // older parent-first records whose sibling writes were interrupted.
      if (parent.state !== "rolled-back") await this.#write({ ...parent, state: "rolled-back", updatedAt });
      await inject?.("after:rollback-parent-finalized");
    });
  }

  async scanExisting(): Promise<JournalScanResult> {
    return this.#scanAtCurrentLocation(async file => {
      const { bytes } = await readPrivatePropertiesFile(file, MAX_RECORD_BYTES);
      try {
        const text = bytes.toString("utf8");
        if (!bytes.equals(Buffer.from(text, "utf8"))) throw new Error("Invalid transaction journal encoding");
        return text;
      } finally { bytes.fill(0); }
    });
  }

  async #scanAtCurrentLocation(readRecord: (file: string) => Promise<string>): Promise<JournalScanResult> {
    const locationIdentity = async () => createHash("sha256").update(JSON.stringify([
      await backupDirectoryIdentity(this.#managerRoot), await backupDirectoryIdentity(this.#directory)
    ])).digest("hex");
    const before = await locationIdentity();
    const result = await this.#scan(readRecord);
    if (await locationIdentity() !== before) throw new Error("Transaction journal location changed");
    return { ...result, locationIdentity: before };
  }

  async scan(): Promise<JournalScanResult> {
    return this.#scan(readBounded);
  }

  async #scan(readRecord: (file: string) => Promise<string>): Promise<JournalScanResult> {
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
        const raw = await readRecord(path.join(this.#directory, entry.name));
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
        createdAt: input.createdAt,
        ...(input.restore === undefined ? {} : { restore: structuredClone(input.restore) }),
        ...(input.worldChange === undefined ? {} : { worldChange: structuredClone(input.worldChange) }),
        ...(input.worldImport === undefined ? {} : { worldImport: structuredClone(input.worldImport) }),
        ...(input.worldLibraryImport === undefined ? {} : { worldLibraryImport: structuredClone(input.worldLibraryImport) }),
        ...(input.worldActivation === undefined ? {} : { worldActivation: structuredClone(input.worldActivation) }),
        ...(input.worldReplacement === undefined ? {} : { worldReplacement: structuredClone(input.worldReplacement) }),
        ...(input.worldArchive === undefined ? {} : { worldArchive: structuredClone(input.worldArchive) }),
        ...(input.propertiesWrite === undefined ? {} : { propertiesWrite: structuredClone(input.propertiesWrite) }),
        ...(input.addonInstall === undefined ? {} : { addonInstall: structuredClone(input.addonInstall) }),
        ...(input.addonLifecycle === undefined ? {} : { addonLifecycle: structuredClone(input.addonLifecycle) })
      };
      const record: TransactionJournalRecord = {
        schemaVersion: input.worldChange?.generation !== undefined ? 14 : input.worldReplacement !== undefined ? input.worldReplacement.approval === undefined ? 12 : 13 : input.worldActivation !== undefined ? input.worldActivation.sourceGuard === undefined ? 10 : 11 : input.worldLibraryImport !== undefined ? 9 : input.addonLifecycle !== undefined ? 8 : input.addonInstall !== undefined ? 7 : input.propertiesWrite !== undefined ? 6 : input.worldArchive !== undefined ? 5 : input.worldImport !== undefined ? 4 : input.worldChange !== undefined ? 3 : input.restore === undefined ? SCHEMA_VERSION : 2,
        transactionId,
        intent,
        state: "active",
        checkpoints: [],
        updatedAt: input.createdAt
      };
      if (!validateRecord(record)) throw new Error("Invalid transaction journal intent");
      if (intent.restore && !intent.restore.rootIdentity) throw new Error("New restore journals require root binding");
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

  async get(serverId: string, transactionId: string): Promise<TransactionJournalRecord> {
    return structuredClone(await this.#read(serverId, transactionId));
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
