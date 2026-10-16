import { createHash } from "node:crypto";
import { DomainError } from "./domain-errors.js";
import { WHITELIST_MEMBERS } from "./whitelist-reader.js";

const NAME = /^[A-Za-z0-9_]{3,16}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
export interface WhitelistMember { readonly name: string; readonly uuid: string }
/** Trusted internal observations, not an HTTP DTO or proof that a live read occurred. */
export interface WhitelistMemberSnapshot {
  readonly serverId: string;
  readonly rootIdentity: string;
  readonly configRevision: string;
  readonly fileIdentity: string;
  readonly fileSha256: string;
  readonly runtimeId: string;
  readonly members: readonly WhitelistMember[];
}
export interface WhitelistMemberIntent {
  readonly action: "add" | "remove";
  readonly name: string;
  readonly revision: string;
  readonly confirm: true;
}
const invalid = () => new DomainError(400, "VALIDATION_ERROR", "白名单成员请求格式无效", "invalid-whitelist-member-request");
const exactKeys = (value: object, keys: string) => Object.keys(value).sort().join(",") === keys;
const conflict = () => new DomainError(409, "WHITELIST_REVISION_CONFLICT", "白名单状态已变化，请重新读取并确认", "whitelist-revision-conflict");

export function parseWhitelistMemberIntent(value: unknown): WhitelistMemberIntent {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, "action,confirm,name,revision")) throw invalid();
  const body = value as Record<string, unknown>;
  if ((body.action !== "add" && body.action !== "remove") || typeof body.name !== "string" || !NAME.test(body.name) ||
    body.confirm !== true || typeof body.revision !== "string" || !HASH.test(body.revision)) throw invalid();
  return { action: body.action, name: body.name, revision: body.revision, confirm: true };
}

function members(value: readonly WhitelistMember[]): WhitelistMember[] {
  if (!Array.isArray(value) || value.length > WHITELIST_MEMBERS) throw invalid();
  const names = new Set<string>(), ids = new Set<string>();
  return Array.from(value, (row) => {
    if (!row || typeof row !== "object" || !exactKeys(row, "name,uuid") || typeof row.name !== "string" || !NAME.test(row.name) ||
      typeof row.uuid !== "string" || !UUID.test(row.uuid)) throw invalid();
    const name = row.name.toLowerCase(), uuid = row.uuid.toLowerCase();
    if (names.has(name) || ids.has(uuid)) throw invalid();
    names.add(name); ids.add(uuid); return { name: row.name, uuid };
  });
}
function snapshot(value: WhitelistMemberSnapshot): void {
  if (!value || typeof value !== "object" || !exactKeys(value, "configRevision,fileIdentity,fileSha256,members,rootIdentity,runtimeId,serverId") ||
    typeof value.serverId !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(value.serverId) ||
    ![value.rootIdentity, value.configRevision, value.fileIdentity, value.fileSha256].every((hash) => typeof hash === "string" && HASH.test(hash)) ||
    typeof value.runtimeId !== "string" || !UUID.test(value.runtimeId)) throw invalid();
  members(value.members);
}
/** Binds exact file bytes/identity and launch generation. Members are included defensively;
 * the observation layer must still prove that they were parsed from the hashed bytes. */
export function whitelistMemberRevision(value: WhitelistMemberSnapshot): string {
  snapshot(value);
  const sorted = members(value.members).sort((a, b) => a.uuid.localeCompare(b.uuid));
  return createHash("sha256").update(JSON.stringify(["whitelist-members-v1", value.serverId, value.rootIdentity, value.configRevision,
    value.fileIdentity, value.fileSha256, value.runtimeId.toLowerCase(), sorted])).digest("hex");
}

/** Pure pre-dispatch policy only: no command construction, publication, authentication or dispatch. */
export function validateWhitelistMemberIntent(intent: WhitelistMemberIntent, before: WhitelistMemberSnapshot): WhitelistMemberIntent {
  const request = parseWhitelistMemberIntent(intent);
  if (request.revision !== whitelistMemberRevision(before)) throw conflict();
  const existing = before.members.find((row) => row.name.toLowerCase() === request.name.toLowerCase());
  if ((request.action === "add" && existing) || (request.action === "remove" && !existing)) {
    throw new DomainError(409, "WHITELIST_MEMBERSHIP_CONFLICT", "成员状态与请求不符，请重新确认", "whitelist-membership-conflict");
  }
  if (request.action === "add" && before.members.length >= WHITELIST_MEMBERS) {
    throw new DomainError(409, "WHITELIST_CAPACITY", "白名单已达到受控成员上限", "whitelist-capacity");
  }
  return { ...request, name: existing?.name ?? request.name };
}

export type WhitelistMemberEvidence = "consistent-change" | "insufficient-evidence";
/** Consistency is NOT operation success. A future service additionally needs a verified,
 * version-specific command receipt, durable journal and actual runtime/file observations.
 * This pure function never resolves recovery or claims that Manager caused a change. */
export function compareWhitelistMemberEvidence(intent: WhitelistMemberIntent, before: WhitelistMemberSnapshot,
  after: WhitelistMemberSnapshot, runtimeNames: readonly string[]): WhitelistMemberEvidence {
  try {
    const request = validateWhitelistMemberIntent(intent, before); snapshot(after);
    if (before.serverId !== after.serverId || before.rootIdentity !== after.rootIdentity || before.configRevision !== after.configRevision ||
      before.runtimeId.toLowerCase() !== after.runtimeId.toLowerCase() || before.fileSha256 === after.fileSha256) return "insufficient-evidence";
    if (!Array.isArray(runtimeNames) || runtimeNames.length > WHITELIST_MEMBERS ||
      Array.from(runtimeNames).some((name) => typeof name !== "string" || !NAME.test(name))) return "insufficient-evidence";
    const live = new Set(runtimeNames.map((name) => name.toLowerCase()));
    if (live.size !== runtimeNames.length || live.size !== after.members.length ||
      after.members.some((row) => !live.has(row.name.toLowerCase()))) return "insufficient-evidence";
    const previous = members(before.members), next = members(after.members);
    const target = request.name.toLowerCase();
    const unchanged = (row: WhitelistMember) => next.some((item) => item.uuid === row.uuid && item.name === row.name);
    if (request.action === "add") {
      const added = next.find((row) => row.name.toLowerCase() === target);
      if (!added || next.length !== previous.length + 1 || previous.some((row) => !unchanged(row))) return "insufficient-evidence";
    } else {
      const removed = previous.find((row) => row.name.toLowerCase() === target)!;
      if (next.length !== previous.length - 1 || next.some((row) => row.uuid === removed.uuid || row.name.toLowerCase() === target) ||
        previous.some((row) => row !== removed && !unchanged(row))) return "insufficient-evidence";
    }
    return "consistent-change";
  } catch { return "insufficient-evidence"; }
}
