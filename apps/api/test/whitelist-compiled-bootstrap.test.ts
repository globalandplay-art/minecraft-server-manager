import { win32 as path } from "node:path";
import { expect, it } from "vitest";
import { parseHelperArtifactCandidate } from "../src/services/whitelist-compiled-artifact.js";
import { inspectCompiledBootstrapCandidate } from "../src/services/whitelist-compiled-bootstrap.js";

const sha = "a".repeat(64), rootIdentity = "A".repeat(40);
const b64 = (text: string) => Buffer.from(text).toString("base64");
const descriptor = { version: 1, program: "whitelist-acl-worker", architecture: "x64", runtime: "netfx4",
  sourceSha256: sha, ownerSourceSha256: sha, recipeSha256: sha, compilerSha256: sha,
  artifactSha256: sha, artifactBytes: 4096,
  references: [{ name: "System.dll", sha256: sha }, { name: "mscorlib.dll", sha256: sha }] };
function fixture(root = "C:\\isolated-bootstrap") {
  const encoded = Buffer.from(JSON.stringify(descriptor));
  const executable = path.join(root, "whitelist-native", "whitelist-acl-worker.exe");
  const chain = [executable];
  for (let parent = path.dirname(executable); ; parent = path.dirname(parent)) {
    chain.unshift(parent); if (parent === path.parse(parent).root) break;
  }
  return { version: 1, action: sha, artifact: parseHelperArtifactCandidate(encoded).digest,
    generation: 1, candidate: encoded.toString("base64"), owner: { root: b64(root), nodePid: 123,
      processIdentity: "A".repeat(16), directoryHandle: "10", fileHandle: "11",
      directoryIdentity: rootIdentity, fileIdentity: "B".repeat(40) },
    pins: chain.map((value, index) => ({ path: b64(value), handle: String(20 + index),
      identity: value === root ? rootIdentity : "C".repeat(40), directory: index !== chain.length - 1 })) };
}
const line = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
const unsafe = (run: () => unknown) => expect(run).toThrowError("ACL_BOOTSTRAP_CANDIDATE_UNSAFE");

it("checks a complete synthetic chain without native trust or exposing paths/handles", () => {
  const value = fixture(); const summary = inspectCompiledBootstrapCandidate(line(value));
  expect(value.pins.map((pin) => Buffer.from(pin.path, "base64").toString())).toEqual([
    "C:\\", "C:\\isolated-bootstrap", "C:\\isolated-bootstrap\\whitelist-native",
    "C:\\isolated-bootstrap\\whitelist-native\\whitelist-acl-worker.exe"
  ]);
  expect(summary.privatePinIndices).toEqual([1, 2, 3]); expect(summary.pinCount).toBe(4);
  expect(Object.keys(summary)).toEqual(["action", "artifact", "generation", "pinCount", "privatePinIndices", "inventory"]);
  expect(JSON.stringify(summary)).not.toContain("isolated-bootstrap");
  expect(JSON.stringify(summary)).not.toContain("directoryHandle");
  expect(Object.isFrozen(summary)).toBe(true); expect(Object.isFrozen(summary.privatePinIndices)).toBe(true);
});

it("uses Windows case-insensitive identity comparison without selecting a caller ACL domain", () => {
  const value = fixture(); value.pins[1]!.path = b64("c:\\ISOLATED-BOOTSTRAP");
  expect(inspectCompiledBootstrapCandidate(line(value)).privatePinIndices).toEqual([1, 2, 3]);
});

it("requires private ACL validation even for drive-root owners rather than assuming it passed", () => {
  const summary = inspectCompiledBootstrapCandidate(line(fixture("C:\\")));
  expect(summary.privatePinIndices).toEqual([0, 1, 2]);
});

it.each([
  "\\\\server\\share", "\\\\?\\C:\\secret", "C:/secret", "C:\\secret\\..\\other", "C:\\secret\\",
  "C:\\secret.", "C:\\secret ", "C:\\secret:stream", "C:\\CON.txt", "C:\\aux",
  "C:\\CON .txt", "C:\\COM1.txt", "C:\\LPT9", "C:\\COM¹", "C:\\CONIN$", "C:\\s\u0000ecret",
  "C:\\bad?name", "C:\\bad|name"
])("rejects unsafe canonical owner path %#", (root) => {
  const value = fixture(); value.owner.root = b64(root);
  unsafe(() => inspectCompiledBootstrapCandidate(line(value)));
});

it.each([0, -1, 1.1, 0x80000000])("rejects invalid owner process id %s", (nodePid) => {
  const value = fixture(); value.owner.nodePid = nodePid; unsafe(() => inspectCompiledBootstrapCandidate(line(value)));
});

it.each(["0", "01", "-1", "0x10", "9223372036854775808", "1\n"])("rejects invalid inherited handle %#", (handle) => {
  const value = fixture(); value.pins[0]!.handle = handle; unsafe(() => inspectCompiledBootstrapCandidate(line(value)));
});

it.each([
  (value: ReturnType<typeof fixture>) => { value.pins.pop(); },
  (value: ReturnType<typeof fixture>) => { value.pins.splice(0, 1); },
  (value: ReturnType<typeof fixture>) => { value.pins.reverse(); },
  (value: ReturnType<typeof fixture>) => { value.pins[0]!.handle = value.owner.fileHandle; },
  (value: ReturnType<typeof fixture>) => { value.pins[1]!.handle = value.pins[0]!.handle; },
  (value: ReturnType<typeof fixture>) => { value.owner.fileHandle = value.owner.directoryHandle; },
  (value: ReturnType<typeof fixture>) => { value.pins[1]!.identity = "D".repeat(40); },
  (value: ReturnType<typeof fixture>) => { value.pins[2]!.directory = false; },
  (value: ReturnType<typeof fixture>) => { value.pins[3]!.directory = true; },
  (value: ReturnType<typeof fixture>) => { value.pins[3]!.path = b64("C:\\isolated-bootstrap\\other.exe"); },
  (value: ReturnType<typeof fixture>) => { value.pins[0]!.path = b64("D:\\"); },
  (value: ReturnType<typeof fixture>) => { value.owner.root += "\n"; },
  (value: ReturnType<typeof fixture>) => { value.artifact = sha; },
  (value: ReturnType<typeof fixture>) => { value.candidate = b64("SECRET"); },
  (value: ReturnType<typeof fixture>) => { value.generation = 0; },
  (value: ReturnType<typeof fixture>) => { value.owner.processIdentity = "0".repeat(16); },
  (value: ReturnType<typeof fixture>) => { value.owner.directoryIdentity += "\n"; }
])("rejects incomplete/mismatched inherited layout %#", (mutate) => {
  const value = fixture(); mutate(value); unsafe(() => inspectCompiledBootstrapCandidate(line(value)));
});

it("rejects caller-supplied ACL flags, command/path options and owner extra fields", () => {
  const value = fixture();
  for (const bad of [{ ...value, command: "SECRET" }, { ...value, executable: "C:\\SECRET" },
    { ...value, owner: { ...value.owner, secret: true } },
    { ...value, pins: [{ ...value.pins[0], privateAcl: false }, ...value.pins.slice(1)] }]) {
    unsafe(() => inspectCompiledBootstrapCandidate(line(bad)));
  }
});

it("enforces the32-directory limit without partial/extra pin acceptance", () => {
  const valid = fixture("C:\\" + Array(30).fill("d").join("\\"));
  expect(inspectCompiledBootstrapCandidate(line(valid)).pinCount).toBe(33);
  const invalid = fixture("C:\\" + Array(31).fill("d").join("\\"));
  unsafe(() => inspectCompiledBootstrapCandidate(line(invalid)));
});

it.each([Buffer.alloc(0), Buffer.alloc(262145), Buffer.from([0xff, 10]),
  Buffer.concat([line(fixture()), line(fixture())]),
  Buffer.from(JSON.stringify(fixture()).replace('"version":1', '"version":9,"version":1') + "\n")
])("rejects bad framing without retaining raw content %#", (value) => unsafe(() => inspectCompiledBootstrapCandidate(value)));
