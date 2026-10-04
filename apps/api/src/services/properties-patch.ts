import { parseEditableProperties } from "./properties-grammar.js";
import { PROPERTY_KEYS } from "./properties-reader.js";
import { DomainError } from "./domain-errors.js";
const invalid = () => new DomainError(400, "PROPERTIES_PATCH_INVALID", "配置字段或格式无效，未修改配置", "invalid-properties-patch");
function continued(text: string): boolean {
  let count = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === "\\"; i--) count++;
  return count % 2 === 1;
}
function encode(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/^ /u, "\\ ");
}

/** Pure text preparation only. Caller must validate version/type and run the durable write gate. */
export function patchPropertiesExact(original: string, changes: Readonly<Record<string, string>>): string {
  try {
    const entries = Object.entries(changes);
    if (entries.some(([key, value]) => !(PROPERTY_KEYS as readonly string[]).includes(key) ||
      typeof value !== "string" || Buffer.from(value, "utf8").toString("utf8") !== value || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value, "utf8") > 1024)) throw invalid();
    if (original.includes("\0") || original.startsWith("\ufeff")) throw invalid();
    parseEditableProperties(original); // Malformed escapes are not silently normalized.
    const physical: Array<{ start: number; end: number; body: string; terminator: string }> = [];
    const lines = /([^\r\n]*)(\r\n|\r|\n|$)/gu;
    for (const match of original.matchAll(lines)) {
      if (match[0] === "") continue;
      physical.push({ start: match.index, end: match.index + match[0].length, body: match[1]!, terminator: match[2]! });
    }
    const last = new Map<string, { start: number; end: number; terminator: string }>();
    for (let i = 0; i < physical.length; i++) {
      const first = physical[i]!;
      let body = first.body; let end = i;
      while (continued(body) && end + 1 < physical.length) {
        end++; body = body.slice(0, -1) + physical[end]!.body.replace(/^[ \t\f]+/u, "");
      }
      const parsed = parseEditableProperties(body);
      if (parsed.size === 1) {
        const key = [...parsed.keys()][0]!;
        if (Object.hasOwn(changes, key)) last.set(key, { start: first.start, end: physical[end]!.end, terminator: physical[end]!.terminator });
      }
      i = end;
    }
    const patches = entries.filter(([key]) => last.has(key)).map(([key, value]) => ({ ...last.get(key)!, text: `${key}=${encode(value)}` }))
      .sort((a, b) => b.start - a.start);
    let result = original;
    for (const patch of patches) result = result.slice(0, patch.start) + patch.text + patch.terminator + result.slice(patch.end);
    const missing = entries.filter(([key]) => !last.has(key));
    if (missing.length) {
      const newline = physical.find((line) => line.terminator)?.terminator ?? "\n";
      if (result && !/[\r\n]$/u.test(result)) result += newline;
      result += missing.map(([key, value]) => `${key}=${encode(value)}${newline}`).join("");
    }
    const actual = parseEditableProperties(result);
    const before = parseEditableProperties(original);
    for (const [key, value] of entries) if (actual.get(key) !== value) throw invalid();
    for (const [key, value] of before) if (!Object.hasOwn(changes, key) && actual.get(key) !== value) throw invalid();
    return result;
  } catch { throw invalid(); }
}
