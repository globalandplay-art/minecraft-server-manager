import { createHash, createHmac, randomBytes } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { ServerType } from "@mcsm/contracts";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { DomainError } from "./domain-errors.js";
import { readAddonJarMetadata } from "./addon-jar-metadata.js";
import { parseFabricAddonMetadata } from "./fabric-addon-metadata.js";
import { parsePluginAddonMetadata } from "./plugin-addon-metadata.js";

export type AddonKind = "mod" | "plugin";
export type AddonState = "enabled" | "disabled";
export const ADDON_LIMITS = Object.freeze({ files: 1000, jarBytes: 64 * 1024 ** 2, totalBytes: 256 * 1024 ** 2 });
const unsafe = () => new DomainError(409, "ADDON_INVENTORY_UNSAFE", "扩展目录无法安全核验", "addon-inventory-unsafe");
export function addonProfile(type: ServerType): { kind: AddonKind; enabled: string; disabled: string } | null {
  if (type === "paper") return { kind: "plugin", enabled: "plugins", disabled: "disabled-plugins" };
  if (type === "fabric") return { kind: "mod", enabled: "mods", disabled: "disabled-mods" };
  return null;
}
export function safeAddonFilename(name: string): boolean {
  return name.length > 4 && name.length <= 200 && /\.jar$/iu.test(name) &&
    name === name.normalize("NFC") && !/[\\/:<>"|?*\u0000-\u001f\u007f]/u.test(name) &&
    !/^[. ]|[. ]$/u.test(name) && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name);
}
export function addonOpaqueId(serverId: string, kind: AddonKind, filename: string): string {
  return createHash("sha256").update(`${serverId}\0${kind}\0${filename.normalize("NFC").toLowerCase()}`).digest("hex");
}
/** Read-only groundwork. No JAR execution, directory creation or file mutation. */
export class AddonInventory {
  readonly #key = randomBytes(32);
  #busy = false;
  constructor(readonly readFile = readPrivatePropertiesFile) {}
  async read(serverId: string, registeredRoot: string, type: ServerType, lifecycleAvailable = false) {
    const profile = addonProfile(type);
    if (!profile) throw new DomainError(501, "ADDON_UNSUPPORTED", "此类型尚未支持扩展管理", "addon-profile-unsupported");
    if (this.#busy) throw new DomainError(429, "ADDON_SCAN_BUSY", "扩展目录正在扫描，请稍后重试", "addon-scan-busy");
    this.#busy = true;
    try {
      const rootIdentity = await backupDirectoryIdentity(registeredRoot);
      const entries: { id: string; kind: AddonKind; state: AddonState; filename: string; sizeBytes: number; sha256: string;
        name: string | null; version: string | null; loader: "fabric" | "paper" | null; compatibility: "unknown";
        minecraftConstraint: string[] | null; metadataStatus: "parsed" | "invalid" | "missing" }[] = [];
      const identities: { folder: string; identity: string | null; names: string[] }[] = [];
      const files: { file: string; identity: string; checksum: string }[] = [];
      const globalNames = new Set<string>();
      let total = 0;
      for (const [state, folder] of [["enabled", profile.enabled], ["disabled", profile.disabled]] as const) {
        const directory = path.join(registeredRoot, folder);
        let identity: string;
        try { identity = await backupDirectoryIdentity(directory); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          identities.push({ folder, identity: null, names: [] }); continue;
        }
        const names = await readdir(directory);
        if (names.length > ADDON_LIMITS.files) throw unsafe();
        identities.push({ folder, identity, names: names.sort() });
        const seen = new Set<string>();
        for (const name of names) {
          const folded = name.normalize("NFC").toLowerCase();
          if (seen.has(folded)) throw unsafe(); seen.add(folded);
          // Plugin-owned data folders are not parsed or recursively traversed.
          if (!/\.jar$/iu.test(name)) continue;
          if (!safeAddonFilename(name) || entries.length >= ADDON_LIMITS.files) throw unsafe();
          if (globalNames.has(folded)) throw unsafe(); globalNames.add(folded);
          const stat = await lstat(path.join(directory, name));
          if (stat.size === 0 || stat.size > ADDON_LIMITS.jarBytes) throw unsafe();
          if (await backupDirectoryIdentity(registeredRoot) !== rootIdentity || await backupDirectoryIdentity(directory) !== identity) throw unsafe();
          const file = await this.readFile(path.join(directory, name), ADDON_LIMITS.jarBytes);
          total += file.bytes.length;
          if (file.bytes.length === 0 || file.bytes.length > ADDON_LIMITS.jarBytes || total > ADDON_LIMITS.totalBytes) throw unsafe();
          files.push({ file: path.join(directory, name), identity: file.identity, checksum: file.checksum });
          if (await backupDirectoryIdentity(registeredRoot) !== rootIdentity || await backupDirectoryIdentity(directory) !== identity) throw unsafe();
          const id = addonOpaqueId(serverId, profile.kind, name);
          let metadata: { name: string; version: string; loader: "fabric" | "paper"; minecraftConstraint?: string[] | null } | null = null;
          let metadataStatus: "parsed" | "invalid" | "missing" = "missing";
          try {
            const members = readAddonJarMetadata(file.bytes);
            const raw = members.get(profile.kind === "mod" ? "fabric.mod.json" : "plugin.yml");
            if (raw) {
              metadata = profile.kind === "mod" ? parseFabricAddonMetadata(raw) : parsePluginAddonMetadata(raw);
              metadataStatus = metadata ? "parsed" : "invalid";
            }
          } catch { metadataStatus = "invalid"; }
          entries.push({ id, kind: profile.kind, state, filename: name, sizeBytes: file.bytes.length, sha256: file.checksum,
            name: metadata?.name ?? null, version: metadata?.version ?? null, loader: metadata?.loader ?? null,
            minecraftConstraint: metadata?.minecraftConstraint ?? null, compatibility: "unknown", metadataStatus });
        }
      }
      for (const captured of identities) {
        const directory = path.join(registeredRoot, captured.folder);
        if (captured.identity === null) {
          try { await lstat(directory); throw unsafe(); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        } else if (await backupDirectoryIdentity(directory) !== captured.identity ||
          JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(captured.names)) throw unsafe();
      }
      for (const captured of files) {
        const current = await this.readFile(captured.file, ADDON_LIMITS.jarBytes);
        if (current.identity !== captured.identity || current.checksum !== captured.checksum) throw unsafe();
      }
      if (await backupDirectoryIdentity(registeredRoot) !== rootIdentity) throw unsafe();
      entries.sort((a, b) => a.id.localeCompare(b.id));
      const fileIdentities = files.map((captured) => ({ relativePath: path.relative(registeredRoot, captured.file).split(path.sep).join("/"),
        identity: captured.identity, checksum: captured.checksum })).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      return { items: entries, revision: createHmac("sha256", this.#key).update(JSON.stringify({ serverId, rootIdentity, identities, entries, fileIdentities })).digest("hex"),
        writeSupported: lifecycleAvailable };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw unsafe();
    } finally { this.#busy = false; }
  }
}
