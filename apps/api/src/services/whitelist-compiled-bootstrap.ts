import { win32 as path } from "node:path";
import { TextDecoder } from "node:util";
import { parseHelperArtifactCandidate } from "./whitelist-compiled-artifact.js";
import { compiledHandleInventory } from "./whitelist-compiled-control.js";

/** UNWIRED reference shape validator for the future native private bootstrap.
 * No FS/native proof or ownership authority. No owner proof extraction or launch.
 * Returns a redacted layout summary, never raw paths/handles or owner records. */
export class CompiledBootstrapCandidateError extends Error {
  readonly code = "ACL_BOOTSTRAP_CANDIDATE_UNSAFE";
  constructor() { super("ACL_BOOTSTRAP_CANDIDATE_UNSAFE"); }
}
const fail = (): never => { throw new CompiledBootstrapCandidateError(); };
const object = (row: unknown): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row);
const keys = (row: Record<string, unknown>, names: readonly string[]) => Object.keys(row).sort().join(",") === [...names].sort().join(",");
const hex = (value: unknown, length: number, upper = false): value is string => typeof value === "string" && value.length === length &&
  (upper ? /^[0-9A-F]+$/u : /^[0-9a-f]+$/u).test(value) && (!upper || !/^0+$/u.test(value));
const handle = (value: unknown): value is string => typeof value === "string" && value.length <= 19 && /^[1-9][0-9]*$/u.test(value) && BigInt(value) <= 0x7fff_ffff_ffff_ffffn;
const decode = (value: unknown, maxBytes: number): Buffer => {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4) return fail();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== value) return fail();
  return bytes;
};
function decodePath(value: unknown): string {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decode(value, 16384));
  if (text.length < 3 || text.length > 4096 || !/^[A-Za-z]:\\/u.test(text) ||
    /[\u0000-\u001f\u007f/<>"|?*]/u.test(text) || text.slice(2).includes(":") ||
    path.normalize(text) !== text || (text.length > 3 && text.endsWith("\\"))) return fail();
  for (const part of text.slice(3).split("\\").filter(Boolean)) {
    const stem = part.split(".")[0]!.replace(/[ .]+$/u, "");
    if (/[ .]$/u.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$|CLOCK\$)$/iu.test(stem)) return fail();
  }
  return text;
}

export function inspectCompiledBootstrapCandidate(bytes: Buffer) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 3 || bytes.length > 262144 || bytes[bytes.length - 1] !== 10 || bytes.subarray(0, -1).includes(10)) return fail();
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, -1));
    const row: unknown = JSON.parse(text);
    if (!object(row) || JSON.stringify(row) !== text || !keys(row, ["version", "action", "artifact", "generation", "candidate", "owner", "pins"]) ||
      row.version !== 1 || !hex(row.action, 64) || !hex(row.artifact, 64) ||
      !Number.isSafeInteger(row.generation) || (row.generation as number) < 1 || (row.generation as number) > 262144) return fail();
    const candidate = parseHelperArtifactCandidate(decode(row.candidate, 4096));
    if (candidate.digest !== row.artifact) return fail();
    const owner = row.owner;
    if (!object(owner) || !keys(owner, ["root", "nodePid", "processIdentity", "directoryHandle", "fileHandle", "directoryIdentity", "fileIdentity"]) ||
      !Number.isSafeInteger(owner.nodePid) || (owner.nodePid as number) < 1 || (owner.nodePid as number) > 0x7fffffff ||
      !hex(owner.processIdentity, 16, true) || !hex(owner.directoryIdentity, 40, true) || !hex(owner.fileIdentity, 40, true) ||
      !handle(owner.directoryHandle) || !handle(owner.fileHandle) || owner.directoryHandle === owner.fileHandle) return fail();
    const root = decodePath(owner.root);
    const executable = path.join(root, "whitelist-native", "whitelist-acl-worker.exe");
    if (executable.length > 4096) return fail();
    const chain = [executable];
    for (let directory = path.dirname(executable); ; directory = path.dirname(directory)) {
      chain.unshift(directory);
      if (chain.length > 33) return fail();
      if (directory === path.parse(directory).root) break;
    }
    const inventory = compiledHandleInventory(chain.length - 1);
    if (!Array.isArray(row.pins) || row.pins.length !== chain.length) return fail();
    const handles = new Set([owner.directoryHandle, owner.fileHandle]);
    const privatePinIndices: number[] = [];
    let rootSeen = false;
    for (let index = 0; index < chain.length; index++) {
      const pin: unknown = row.pins[index];
      if (!object(pin) || !keys(pin, ["path", "handle", "identity", "directory"]) || !handle(pin.handle) || handles.has(pin.handle) ||
        !hex(pin.identity, 40, true) || pin.directory !== (index < chain.length - 1)) return fail();
      handles.add(pin.handle);
      const pinPath = decodePath(pin.path).toLowerCase();
      if (pinPath !== chain[index]!.toLowerCase()) return fail();
      if (pinPath === root.toLowerCase()) {
        if (pin.identity !== owner.directoryIdentity) return fail();
        rootSeen = true;
      }
      if (rootSeen) privatePinIndices.push(index);
    }
    if (!rootSeen) return fail();
    return Object.freeze({ action: row.action, artifact: row.artifact, generation: row.generation as number,
      pinCount: chain.length, privatePinIndices: Object.freeze(privatePinIndices), inventory });
  } catch { throw new CompiledBootstrapCandidateError(); }
}
