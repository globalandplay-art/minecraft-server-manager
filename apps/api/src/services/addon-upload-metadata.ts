import type { DeclaredModMetadata, ServerType } from '@mcsm/contracts';
import { addonProfile } from './addon-inventory.js';
import { parseFabricAddonMetadata } from './fabric-addon-metadata.js';
import { parsePluginAddonMetadata } from './plugin-addon-metadata.js';
import { parseForgeAddonMetadata } from './forge-addon-metadata.js';

type LegacyMetadata = { name: string; version: string; loader: 'fabric' | 'paper'; minecraftConstraint: string[] | null };
type DeclaredMetadata = { name: string | null; version: string | null; loader: 'forge' | 'neoforge';
  minecraftConstraint: null; compatibility: 'unknown'; declaredMetadata: DeclaredModMetadata };
export type AddonUploadMetadata = LegacyMetadata | DeclaredMetadata;

/** Inert staging permission is separate from permission to alter a server's addons. */
export function addonStagingProfile(type: ServerType) {
  return addonProfile(type) ?? (type === 'forge' || type === 'neoforge' ? { kind: 'mod' as const } : null);
}

/** Project from the matching loader descriptor; never infer compatibility or resolve placeholders. */
export function parseAddonUploadMetadata(members: ReadonlyMap<string, Uint8Array>, type: ServerType): AddonUploadMetadata | null {
  if (type === 'forge' || type === 'neoforge') {
    const raw = members.get(type === 'forge' ? 'META-INF/mods.toml' : 'META-INF/neoforge.mods.toml');
    const declaredMetadata = raw ? parseForgeAddonMetadata(raw, type) : null;
    if (!declaredMetadata) return null;
    const single = declaredMetadata.mods.length === 1 ? declaredMetadata.mods[0] : undefined;
    const projected: DeclaredMetadata = { name: single?.name ?? null,
      version: single?.versionStatus === 'declared' ? single.version : null,
      loader: type, minecraftConstraint: null, compatibility: 'unknown', declaredMetadata };
    // Existing private JSON reads are capped at128KiB; leave room for identity/envelope.
    return Buffer.byteLength(JSON.stringify(projected)) <= 64 * 1024 ? projected : null;
  }
  if (type !== 'paper' && type !== 'fabric') return null;
  const raw = members.get(type === 'paper' ? 'plugin.yml' : 'fabric.mod.json');
  const parsed = raw ? (type === 'paper' ? parsePluginAddonMetadata(raw) : parseFabricAddonMetadata(raw)) : null;
  if (!parsed) return null;
  return { name: parsed.name, version: parsed.version, loader: parsed.loader,
    minecraftConstraint: 'minecraftConstraint' in parsed ? parsed.minecraftConstraint : null };
}
