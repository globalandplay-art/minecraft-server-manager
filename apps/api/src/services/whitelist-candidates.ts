import path from "node:path";
import { TextDecoder } from "node:util";
import type { WhitelistCandidatesResponse } from "@mcsm/contracts";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { readStoredWhitelist } from "./whitelist-reader.js";

const namePattern = /^[A-Za-z0-9_]{3,16}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
/** Fixed file only. Cache identities are historical observations, never account verification. */
export async function discoverWhitelistCandidates(root: string, registeredRoot: string, sampledAt: string): Promise<WhitelistCandidatesResponse["data"]> {
  const unavailable = (reason: string): WhitelistCandidatesResponse["data"] => ({ availability: "unavailable", reason, sampledAt, items: [] });
  try {
    if (await backupDirectoryIdentity(root) !== registeredRoot) return unavailable("registration-changed");
    const saved = await readStoredWhitelist(root);
    let file;
    try { file = await readPrivatePropertiesFile(path.join(root, "usercache.json"), 512 * 1024); }
    catch (error) { return unavailable(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT" ? "usercache-missing" : "usercache-unsafe"); }
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.bytes);
      if (text.startsWith("\ufeff") || text.includes("\0")) return unavailable("usercache-unsafe");
      const rows: unknown = JSON.parse(text);
      if (!Array.isArray(rows) || rows.length > 1000) return unavailable("usercache-unsafe");
      const byName = new Map<string, { name: string; uuid: string }>();
      const byUuid = new Map<string, string>();
      for (const row of rows) {
        if (!row || typeof row !== "object" || typeof row.name !== "string" || !namePattern.test(row.name) ||
          typeof row.uuid !== "string" || !uuidPattern.test(row.uuid)) return unavailable("usercache-unsafe");
        const name = row.name.toLowerCase(), uuid = row.uuid.toLowerCase();
        if ((byName.has(name) && byName.get(name)!.uuid !== uuid) || (byUuid.has(uuid) && byUuid.get(uuid) !== name)) return unavailable("usercache-identity-conflict");
        byName.set(name, { name: row.name, uuid }); byUuid.set(uuid, name);
      }
      if (await backupDirectoryIdentity(root) !== registeredRoot || JSON.stringify(await readStoredWhitelist(root)) !== JSON.stringify(saved)) return unavailable("snapshot-changed");
      return { availability: "available", reason: null, sampledAt, items: [...byName.values()]
        .filter(row => !saved.some(member => member.name.toLowerCase() === row.name.toLowerCase() || member.uuid === row.uuid))
        .sort((a, b) => a.name.localeCompare(b.name)).map(row => ({ ...row, source: "usercache", identityVerified: false })) };
    } finally { file.bytes.fill(0); }
  } catch { return unavailable("candidate-read-unsafe"); }
}
