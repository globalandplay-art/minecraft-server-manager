import { FAILSAFE_SCHEMA, load, type LoadOptions } from "js-yaml";
export function parsePluginAddonMetadata(raw: Uint8Array) {
  if (raw.byteLength > 256 * 1024) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    // Conservatively disallow anchors, aliases, tags and merge syntax before parsing.
    if (/[&*!\[\]{}]|<<\s*:|^\s*\?/mu.test(text)) return null;
    let depth = 0, events = 0;
    const options: LoadOptions & { maxDepth: number; maxTotalMergeKeys: number } = {
      schema: FAILSAFE_SCHEMA, maxDepth: 32, maxTotalMergeKeys: 0,
      onWarning: () => { throw new Error("ambiguous-yaml"); },
      listener: (event) => { events++; depth += event === "open" ? 1 : -1; if (events > 10000 || depth > 32) throw new Error("metadata-limit"); }
    };
    const parsed: unknown = load(text, options);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const valid = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
    if (!valid(record.name) || !/^[A-Za-z0-9_.-]+$/u.test(record.name) || !valid(record.version) ||
      !valid(record.main) || !/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/u.test(record.main)) return null;
    return { name: record.name, version: record.version, loader: "paper" as const,
      apiVersion: valid(record["api-version"]) ? record["api-version"] : null, compatibility: "unknown" as const };
  } catch { return null; }
}
