import { parseProperties } from "../config/properties.js";

/** Conservative subset for the new editor; never reinterpret ambiguous legacy text. */
export function editablePropertyEntries(text: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const lines = text.split(/\r\n|\r|\n/u);
  const continued = (line: string) => {
    let count = 0;
    for (let i = line.length - 1; i >= 0 && line[i] === "\\"; i--) count++;
    return count % 2 === 1;
  };
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (/^[ \t\f]*[#!]/u.test(line)) {
      // The shared legacy parser extends comments; the editor refuses that layout.
      if (continued(line)) throw new Error("unsupported-properties-comment-layout");
      continue;
    }
    while (continued(line)) {
      if (i + 1 >= lines.length || (i + 1 === lines.length - 1 && lines[i + 1] === "")) {
        throw new Error("unsupported-properties-terminal-continuation");
      }
      line = line.slice(0, -1) + lines[++i]!.replace(/^[ \t\f]+/u, "");
    }
    for (let offset = 0; offset < line.length; offset++) {
      if (line[offset] !== "\\") continue;
      offset++;
      if (line[offset] === "u" && line[offset + 1] === "u") {
        throw new Error("invalid-properties-unicode-escape");
      }
    }
    entries.push(...parseProperties(line));
  }
  return entries;
}

export function parseEditableProperties(text: string): Map<string, string> {
  return new Map(editablePropertyEntries(text));
}
