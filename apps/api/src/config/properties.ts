import { open, lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { DomainError } from "../services/domain-errors.js";

export const SERVER_PROPERTIES_LIMIT = 1024 * 1024;
export const EULA_LIMIT = 64 * 1024;

const samePath = (left: string, right: string) =>
  process.platform === "win32"
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);

export async function readBoundedRegularFile(
  filePath: string,
  maximumBytes: number,
  label: string
): Promise<string> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new DomainError(409, "ACTION_UNAVAILABLE", `${label}不是受支持的普通文件`, "unsafe-file");
  }
  if (metadata.size > maximumBytes) {
    throw new DomainError(409, "ACTION_UNAVAILABLE", `${label}超过读取大小限制`, "file-too-large");
  }

  const canonical = await realpath(filePath);
  if (!samePath(canonical, filePath)) {
    throw new DomainError(409, "ACTION_UNAVAILABLE", `${label}不能通过链接访问`, "unsafe-file");
  }

  const handle = await open(filePath, "r");
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size > maximumBytes) {
      throw new DomainError(409, "ACTION_UNAVAILABLE", `${label}在读取前发生变化`, "file-changed");
    }
    const buffer = Buffer.alloc(current.size);
    const { bytesRead } = await handle.read(buffer, 0, current.size, 0);
    if (bytesRead !== current.size) {
      throw new DomainError(409, "ACTION_UNAVAILABLE", `${label}读取不完整`, "file-changed");
    }
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

interface LogicalLine {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function hasContinuation(line: string): boolean {
  let backslashes = 0;
  for (let index = line.length - 1; index >= 0 && line[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function logicalLines(lines: readonly string[]): LogicalLine[] {
  const result: LogicalLine[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    let end = start;
    let text = lines[start] ?? "";
    while (hasContinuation(text) && end + 1 < lines.length) {
      text = text.slice(0, -1) + (lines[end + 1] ?? "").replace(/^[ \t\f]+/u, "");
      end += 1;
    }
    result.push({ start, end, text });
    start = end;
  }
  return result;
}

function decodeProperty(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    index += 1;
    if (index >= value.length) {
      decoded += "\\";
      break;
    }
    const escaped = value[index];
    if (escaped === "t") decoded += "\t";
    else if (escaped === "n") decoded += "\n";
    else if (escaped === "r") decoded += "\r";
    else if (escaped === "f") decoded += "\f";
    else if (escaped === "u") {
      while (value[index + 1] === "u") index += 1;
      const hexadecimal = value.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/iu.test(hexadecimal)) {
        throw new DomainError(409, "ACTION_UNAVAILABLE", "properties包含无效Unicode转义", "invalid-properties");
      }
      decoded += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      index += 4;
    } else {
      decoded += escaped;
    }
  }
  return decoded;
}

function parseLogicalProperty(text: string): { key: string; value: string } | null {
  let cursor = 0;
  while (cursor < text.length && /[ \t\f]/u.test(text[cursor] ?? "")) cursor += 1;
  if (cursor >= text.length || text[cursor] === "#" || text[cursor] === "!") {
    return null;
  }

  const keyStart = cursor;
  let escaped = false;
  while (cursor < text.length) {
    const character = text[cursor] ?? "";
    if (!escaped && (character === "=" || character === ":" || /[ \t\f]/u.test(character))) {
      break;
    }
    if (character === "\\") escaped = !escaped;
    else escaped = false;
    cursor += 1;
  }
  const rawKey = text.slice(keyStart, cursor);
  while (cursor < text.length && /[ \t\f]/u.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] === "=" || text[cursor] === ":") cursor += 1;
  while (cursor < text.length && /[ \t\f]/u.test(text[cursor] ?? "")) cursor += 1;
  return { key: decodeProperty(rawKey), value: decodeProperty(text.slice(cursor)) };
}

export function parseProperties(text: string): Map<string, string> {
  const physicalLines = text.split(/\r\n|\n|\r/u);
  const result = new Map<string, string>();
  for (const logical of logicalLines(physicalLines)) {
    const property = parseLogicalProperty(logical.text);
    if (property !== null) {
      result.set(property.key, property.value);
    }
  }
  return result;
}

function encodePropertyPart(value: string, key: boolean): string {
  let encoded = "";
  for (const [index, character] of [...value].entries()) {
    if (character === "\\") encoded += "\\\\";
    else if (character === "\t") encoded += "\\t";
    else if (character === "\n") encoded += "\\n";
    else if (character === "\r") encoded += "\\r";
    else if (character === "\f") encoded += "\\f";
    else if ((key && /[=:\s#!]/u.test(character)) || (!key && index === 0 && character === " ")) {
      encoded += `\\${character}`;
    } else {
      encoded += character;
    }
  }
  return encoded;
}

export function updatePropertiesText(
  original: string,
  changes: Readonly<Record<string, string>>
): string {
  const lines = original.split(/\r?\n/u);
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const lastEntries = new Map<string, LogicalLine>();

  for (const logical of logicalLines(lines)) {
    const property = parseLogicalProperty(logical.text);
    if (property !== null && Object.hasOwn(changes, property.key)) {
      lastEntries.set(property.key, logical);
    }
  }

  const replacements = Object.entries(changes)
    .filter(([key]) => lastEntries.has(key))
    .map(([key, value]) => ({ key, value, logical: lastEntries.get(key)! }))
    .sort((left, right) => right.logical.start - left.logical.start);
  for (const { key, value, logical } of replacements) {
    lines.splice(
      logical.start,
      logical.end - logical.start + 1,
      `${encodePropertyPart(key, true)}=${encodePropertyPart(value, false)}`
    );
  }

  const missing = Object.entries(changes).filter(([key]) => !lastEntries.has(key));
  const insertionIndex = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  lines.splice(
    insertionIndex,
    0,
    ...missing.map(
      ([key, value]) => `${encodePropertyPart(key, true)}=${encodePropertyPart(value, false)}`
    )
  );

  if (original.length === 0 && lines.length === 1 && lines[0] === "") {
    return "";
  }

  return lines.join(newline);
}
