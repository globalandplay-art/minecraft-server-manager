import { createHash, createHmac, randomBytes } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { SERVER_PROPERTIES_LIMIT } from "../config/properties.js";
import { editablePropertyEntries } from "./properties-grammar.js";
import { createRedactor, isSensitiveKey } from "../infra/runtime/redactor.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { DomainError } from "./domain-errors.js";

export const PROPERTY_KEYS = ["max-players", "difficulty", "gamemode", "pvp", "online-mode", "view-distance", "simulation-distance", "motd"] as const;
export type PropertyKey = typeof PROPERTY_KEYS[number];
export type SafePropertyFields = Record<PropertyKey, string | number | boolean | null>;
const unsafe = () => new DomainError(409, "PROPERTIES_READ_UNSAFE", "配置无法安全读取，请检查实例文件状态", "properties-identity-or-content-invalid");
const equal = (a: Awaited<ReturnType<typeof lstat>>, b: Awaited<ReturnType<typeof lstat>>) =>
  a.isFile() && b.isFile() && !a.isSymbolicLink() && !b.isSymbolicLink() && a.nlink === 1 && b.nlink === 1 &&
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** A read-only core. No properties writes, backup downloads, revision plain hashes or secrets. */
export class PropertiesReader {
  readonly #revisionKey = randomBytes(32);
  async read(serverId: string, root: string): Promise<{ fields: SafePropertyFields; revision: string }> {
    const snapshot = await this.snapshot(serverId, root);
    return { fields: snapshot.fields, revision: snapshot.revision };
  }
  /** Backend-only validated bytes and identity; never send this snapshot to HTTP or logs. */
  async snapshot(serverId: string, root: string) {
    try {
      const identity = await backupDirectoryIdentity(root);
      const file = path.join(root, "server.properties");
      const before = await lstat(file);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > SERVER_PROPERTIES_LIMIT) throw unsafe();
      const handle = await open(file, "r");
      let bytes: Buffer;
      try {
        const opened = await handle.stat();
        if (!equal(before, opened)) throw unsafe();
        bytes = Buffer.alloc(before.size);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead !== bytes.length || !equal(before, await handle.stat()) || !equal(before, await lstat(file))) throw unsafe();
      } finally { await handle.close(); }
      if (await backupDirectoryIdentity(root) !== identity) throw unsafe();
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.includes("\0") || text.startsWith("\ufeff")) throw unsafe();
      const entries = editablePropertyEntries(text);
      const parsed = new Map(entries);
      const redactor = createRedactor({ secrets: () => entries.filter(([key]) => isSensitiveKey(key)).map(([, value]) => value) });
      const fields = Object.fromEntries(PROPERTY_KEYS.map((key) => {
        const value = parsed.get(key); let safe: string | number | boolean | null = null;
        if (value !== undefined && redactor.redactText(value) === value && !/[\u0000-\u001f\u007f]/u.test(value)) {
          if (key === "motd") safe = Buffer.byteLength(value, "utf8") <= 1024 ? value : null;
          else if (key === "difficulty") safe = ["peaceful", "easy", "normal", "hard"].includes(value) ? value : null;
          else if (key === "gamemode") safe = ["survival", "creative", "adventure", "spectator"].includes(value) ? value : null;
          else if (key === "pvp" || key === "online-mode") safe = value === "true" ? true : value === "false" ? false : null;
          else if (/^(?:0|[1-9]\d{0,8})$/u.test(value)) {
            const number = Number(value);
            safe = key === "max-players" && (number < 1 || number > 10000) ? null : number;
          }
        }
        return [key, safe];
      })) as SafePropertyFields;
      const revision = createHmac("sha256", this.#revisionKey).update(serverId).update("\0").update(identity).update("\0").update(bytes).digest("hex");
      return { fields, revision, bytes, rootIdentity: identity,
        fileIdentity: createHash("sha256").update(`${before.dev}\0${before.ino}\0${before.birthtimeMs}`).digest("hex"),
        checksum: createHash("sha256").update(bytes).digest("hex") };
    } catch { throw unsafe(); }
  }
}
