import { parse } from 'smol-toml';
import type { DeclaredModMetadata } from '@mcsm/contracts';

const id = /^[a-z][a-z0-9_]{1,63}$/u;
const text = (value: unknown, allowEmpty = false): value is string => typeof value === 'string' &&
  (allowEmpty || value.length > 0) && value.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype);

/** Inert, bounded declaration projection; never evaluate ranges, placeholders or code. */
export function parseForgeAddonMetadata(raw: Uint8Array, loader: 'forge' | 'neoforge'): DeclaredModMetadata | null {
  if (raw.byteLength > 256 * 1024) return null;
  try {
    const document: unknown = parse(new TextDecoder('utf-8', { fatal: true }).decode(raw), { maxDepth: 32, unsafeKeyBehaviour: 'throw' });
    // Also bound dotted-table depth and total values (parser maxDepth covers inline values).
    const pending: { value: unknown; depth: number }[] = [{ value: document, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
      const { value, depth } = pending.pop()!;
      if (++nodes > 8192 || depth > 32) return null;
      if (value !== null && typeof value === 'object') for (const child of Object.values(value)) {
        if (pending.length >= 8192) return null;
        pending.push({ value: child, depth: depth + 1 });
      }
    }
    if (!record(document) || !text(document.modLoader) ||
      document.loaderVersion !== undefined && !text(document.loaderVersion, true) ||
      !Array.isArray(document.mods) || document.mods.length < 1 || document.mods.length > 32) return null;
    if (document.dependencies !== undefined && !record(document.dependencies)) return null;
    const dependencies = (document.dependencies ?? {}) as Record<string, unknown>;
    const mods: DeclaredModMetadata['mods'] = [];
    const seen = new Set<string>();
    for (const mod of document.mods) {
      if (!record(mod) || typeof mod.modId !== 'string' || !id.test(mod.modId) || seen.has(mod.modId)) return null;
      seen.add(mod.modId);
      const name = mod.displayName ?? mod.modId;
      if (!text(name) || mod.version !== undefined && !text(mod.version)) return null;
      const entries = Object.hasOwn(dependencies, mod.modId) ? dependencies[mod.modId] : [];
      if (!Array.isArray(entries) || entries.length > 64) return null;
      const projected: DeclaredModMetadata['mods'][number]['dependencies'] = [];
      for (const dependency of entries) {
        if (!record(dependency) || typeof dependency.modId !== 'string' || !id.test(dependency.modId) ||
          dependency.versionRange !== undefined && !text(dependency.versionRange, true)) return null;
        let requirement: typeof projected[number]['requirement'] = 'unknown';
        if (loader === 'forge' && dependency.mandatory !== undefined) {
          if (typeof dependency.mandatory !== 'boolean') return null;
          requirement = dependency.mandatory ? 'required' : 'optional';
        }
        if (loader === 'neoforge' && dependency.type !== undefined) {
          if (!['required', 'optional', 'incompatible', 'discouraged'].includes(dependency.type as string)) return null;
          requirement = dependency.type as typeof requirement;
        }
        const side = dependency.side ?? 'unknown';
        if (!['CLIENT', 'SERVER', 'BOTH', 'unknown'].includes(side as string)) return null;
        projected.push({ id: dependency.modId, versionRange: dependency.versionRange as string | undefined ?? null,
          requirement, side: side as typeof projected[number]['side'] });
      }
      mods.push({ id: mod.modId, name, version: mod.version as string | undefined ?? null,
        versionStatus: mod.version === undefined ? 'unspecified' : (mod.version as string).includes('${') ? 'unresolved' : 'declared', dependencies: projected });
    }
    if (Object.keys(dependencies).some(owner => !seen.has(owner))) return null;
    return { loader, source: loader === 'forge' ? 'META-INF/mods.toml' : 'META-INF/neoforge.mods.toml',
      modLoader: document.modLoader, loaderVersion: document.loaderVersion as string | undefined ?? null, mods };
  } catch { return null; }
}
