import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

/** UNWIRED build-description shape only. Neither this parser nor its digest
 * verifies a file, compiler, publisher, package, source or native executable.
 * No descriptor may authorize launch without the separate D3 trust/pinning Gate. */
export type HelperArtifactCandidate = Readonly<{
  version: 1; program: "whitelist-acl-worker"; architecture: "x64"; runtime: "netfx4";
  sourceSha256: string; ownerSourceSha256: string; recipeSha256: string;
  compilerSha256: string; artifactSha256: string; artifactBytes: number;
  references: readonly Readonly<{ name: string; sha256: string }>[];
}>;
const references = Object.freeze(["mscorlib.dll", "System.dll", "System.Core.dll",
  "System.Security.dll", "System.Runtime.Serialization.dll", "System.Xml.dll",
  "System.Web.Extensions.dll", "System.Web.dll"]);
const expected = ["version", "program", "architecture", "runtime", "sourceSha256", "ownerSourceSha256",
  "recipeSha256", "compilerSha256", "artifactSha256", "artifactBytes", "references"];
const hash = (value: unknown): value is string => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/u.test(value);
const exactKeys = (row: Record<string, unknown>, names: readonly string[]) => Object.keys(row).sort().join(",") === [...names].sort().join(",");
const object = (row: unknown): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row);
export class HelperArtifactCandidateError extends Error {
  readonly code = "ACL_ARTIFACT_CANDIDATE_UNSAFE";
  constructor() { super("ACL_ARTIFACT_CANDIDATE_UNSAFE"); }
}
const fail = (): never => { throw new HelperArtifactCandidateError(); };

/** Bounded canonical JSON; no paths, arguments, environment or executable option.
 * Required references and optional known references describe a candidate only;
 * exact source/recipe dependency set must separately be fixed and reviewed. */
export function parseHelperArtifactCandidate(bytes: Buffer): Readonly<{ candidate: HelperArtifactCandidate; digest: string }> {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > 4096) return fail();
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const row: unknown = JSON.parse(text);
    if (!object(row) || JSON.stringify(row) !== text || !exactKeys(row, expected) ||
      row.version !== 1 || row.program !== "whitelist-acl-worker" || row.architecture !== "x64" || row.runtime !== "netfx4" ||
      !hash(row.sourceSha256) || !hash(row.ownerSourceSha256) || !hash(row.recipeSha256) ||
      !hash(row.compilerSha256) || !hash(row.artifactSha256) || !Number.isSafeInteger(row.artifactBytes) ||
      (row.artifactBytes as number) < 1 || (row.artifactBytes as number) > 4 * 1024 * 1024 ||
      !Array.isArray(row.references) || row.references.length < 2 || row.references.length > references.length) return fail();
    const names = new Set<string>();
    let previous = "";
    const parsedReferences: { name: string; sha256: string }[] = [];
    for (const ref of row.references) {
      if (!object(ref) || !exactKeys(ref, ["name", "sha256"]) || typeof ref.name !== "string" ||
        !references.includes(ref.name) || !hash(ref.sha256) || names.has(ref.name) || ref.name <= previous) return fail();
      previous = ref.name; names.add(ref.name);
      parsedReferences.push(Object.freeze({ name: ref.name, sha256: ref.sha256 }));
    }
    if (!names.has("mscorlib.dll") || !names.has("System.dll")) return fail();
    const candidate: HelperArtifactCandidate = Object.freeze({ version: 1, program: "whitelist-acl-worker",
      architecture: "x64", runtime: "netfx4", sourceSha256: row.sourceSha256, ownerSourceSha256: row.ownerSourceSha256,
      recipeSha256: row.recipeSha256, compilerSha256: row.compilerSha256, artifactSha256: row.artifactSha256,
      artifactBytes: row.artifactBytes as number, references: Object.freeze(parsedReferences) });
    // Fixed semantic field order: harmless input key permutations cannot change
    // the binding digest; duplicate keys and alternate scalar encodings reject.
    const digest = createHash("sha256").update(JSON.stringify(candidate)).digest("hex");
    return Object.freeze({ candidate, digest });
  } catch { throw new HelperArtifactCandidateError(); }
}
