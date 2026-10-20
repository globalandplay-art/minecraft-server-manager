import { expect, it } from "vitest";
import { parseHelperArtifactCandidate } from "../src/services/whitelist-compiled-artifact.js";

const sha = "a".repeat(64);
const data = { version: 1, program: "whitelist-acl-worker", architecture: "x64", runtime: "netfx4",
  sourceSha256: sha, ownerSourceSha256: sha, recipeSha256: sha, compilerSha256: sha,
  artifactSha256: sha, artifactBytes: 4096,
  references: [{ name: "System.dll", sha256: sha }, { name: "mscorlib.dll", sha256: sha }] };
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const unsafe = (run: () => unknown) => expect(run).toThrowError("ACL_ARTIFACT_CANDIDATE_UNSAFE");

it("parses a deep-frozen candidate without creating executable trust", () => {
  const parsed = parseHelperArtifactCandidate(bytes(data));
  expect(parsed.candidate).toEqual(data); expect(parsed.digest).toMatch(/^[a-f0-9]{64}$/u);
  expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.candidate)).toBe(true);
  expect(Object.isFrozen(parsed.candidate.references)).toBe(true);
  expect(Object.isFrozen(parsed.candidate.references[0])).toBe(true);
  expect(Object.keys(parsed)).toEqual(["candidate", "digest"]);
});

it("binds every build identity field and every reference hash", () => {
  const original = parseHelperArtifactCandidate(bytes(data)).digest;
  for (const field of ["sourceSha256", "ownerSourceSha256", "recipeSha256", "compilerSha256", "artifactSha256"]) {
    expect(parseHelperArtifactCandidate(bytes({ ...data, [field]: "b".repeat(64) })).digest).not.toBe(original);
  }
  expect(parseHelperArtifactCandidate(bytes({ ...data, artifactBytes: 4097 })).digest).not.toBe(original);
  expect(parseHelperArtifactCandidate(bytes({ ...data, references: [data.references[0], { name: "mscorlib.dll", sha256: "b".repeat(64) }] })).digest).not.toBe(original);
  expect(parseHelperArtifactCandidate(bytes({ ...data, references: [{ name: "System.Core.dll", sha256: sha }, ...data.references] })).digest).not.toBe(original);
});

it("gives the same semantic digest for top-level key permutations", () => {
  const reordered = Object.fromEntries(Object.entries(data).reverse());
  expect(parseHelperArtifactCandidate(bytes(reordered)).digest).toBe(parseHelperArtifactCandidate(bytes(data)).digest);
});

it.each([
  null, [], {}, { ...data, version: 2 }, { ...data, program: "cmd.exe" },
  { ...data, architecture: "arm64" }, { ...data, runtime: "unknown" },
  { ...data, sourceSha256: "a".repeat(64) + "\n" }, { ...data, artifactSha256: "A".repeat(64) },
  { ...data, compilerSha256: "SECRET" }, { ...data, artifactBytes: 0 },
  { ...data, artifactBytes: 4 * 1024 * 1024 + 1 }, { ...data, artifactBytes: 1.5 },
  { ...data, artifactBytes: "4096" }, { ...data, path: "C:\\SECRET" },
  { ...data, args: ["--execute"] }, { ...data, environment: {} },
  { ...data, references: [] }, { ...data, references: [data.references[0]] },
  { ...data, references: [...data.references].reverse() },
  { ...data, references: [data.references[0], data.references[0]] },
  { ...data, references: [{ name: "../System.dll", sha256: sha }, data.references[1]] },
  { ...data, references: [{ name: "Evil.dll", sha256: sha }, ...data.references] },
  { ...data, references: [{ name: "System.dll", sha256: sha, path: "SECRET" }, data.references[1]] },
  { ...data, references: [{ name: "System.dll", sha256: "SECRET" }, data.references[1]] }
])("rejects malformed/unsafe description %#", (value) => unsafe(() => parseHelperArtifactCandidate(bytes(value))));

it.each([
  Buffer.alloc(0), Buffer.alloc(4097), Buffer.from([0xff]),
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes(data)]),
  Buffer.from(JSON.stringify(data, null, 2)),
  Buffer.from(JSON.stringify(data).replace('"version":1', '"version":9,"version":1')),
  Buffer.concat([bytes(data), bytes(data)]), Buffer.concat([bytes(data), Buffer.from("\n")])
])("rejects invalid encoding/duplicate metadata %#", (value) => unsafe(() => parseHelperArtifactCandidate(value)));

it("permits only bounded byte sizes and the explicit reference vocabulary", () => {
  for (const artifactBytes of [1, 4 * 1024 * 1024]) expect(parseHelperArtifactCandidate(bytes({ ...data, artifactBytes })).candidate.artifactBytes).toBe(artifactBytes);
});

it("never retains raw content in an error", () => {
  let error: unknown;
  try { parseHelperArtifactCandidate(Buffer.from('SECRET PATH')); } catch (caught) { error = caught; }
  expect(String(error)).toBe("Error: ACL_ARTIFACT_CANDIDATE_UNSAFE");
  expect(JSON.stringify(error)).not.toContain("SECRET");
});
