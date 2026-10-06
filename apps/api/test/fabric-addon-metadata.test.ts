import { expect, it } from "vitest";
import { parseFabricAddonMetadata } from "../src/services/fabric-addon-metadata.js";

function bytes(value: string): Uint8Array { return new TextEncoder().encode(value); }
function metadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 1, id: "sample_mod", version: "1.2.3", ...overrides });
}

it("parses valid metadata with default environment and id-derived name", () => {
  expect(parseFabricAddonMetadata(bytes(metadata()))).toEqual({
    id: "sample_mod", name: "sample_mod", version: "1.2.3", loader: "fabric",
    environment: "*", minecraftConstraint: null, compatibility: "unknown",
  });
});

it("preserves a supplied name, environment, and Minecraft string constraint", () => {
  expect(parseFabricAddonMetadata(bytes(metadata({ name: "Sample", environment: "server", depends: { minecraft: ">=1.20" } })))).toMatchObject({
    name: "Sample", environment: "server", minecraftConstraint: [">=1.20"], compatibility: "unknown",
  });
});

it("accepts a Minecraft constraint array", () => {
  expect(parseFabricAddonMetadata(bytes(metadata({ depends: { minecraft: ["1.20", "1.21"] } })))?.minecraftConstraint).toEqual(["1.20", "1.21"]);
});

it("rejects invalid UTF-8", () => {
  expect(parseFabricAddonMetadata(new Uint8Array([0x7b, 0xff, 0x7d]))).toBeNull();
});

it("rejects metadata larger than 256 KiB", () => {
  expect(parseFabricAddonMetadata(new Uint8Array(256 * 1024 + 1))).toBeNull();
});

it("rejects top-level arrays and primitives", () => {
  expect(parseFabricAddonMetadata(bytes("[]"))).toBeNull();
  expect(parseFabricAddonMetadata(bytes("\"metadata\""))).toBeNull();
});

it("requires schema version 1", () => {
  expect(parseFabricAddonMetadata(bytes(metadata({ schemaVersion: 2 })))).toBeNull();
  expect(parseFabricAddonMetadata(bytes(metadata({ schemaVersion: "1" })))).toBeNull();
});

it("requires an id matching the bounded lowercase identifier form", () => {
  for (const id of ["A_mod", "a", "1mod", "bad id", "x".repeat(65)]) {
    expect(parseFabricAddonMetadata(bytes(metadata({ id })))).toBeNull();
  }
});

it("rejects missing, oversized, or control-containing name and version fields", () => {
  expect(parseFabricAddonMetadata(bytes(metadata({ version: "" })))).toBeNull();
  expect(parseFabricAddonMetadata(bytes(metadata({ name: "" })))).toBeNull();
  expect(parseFabricAddonMetadata(bytes(metadata({ version: undefined })))).toBeNull();
  expect(parseFabricAddonMetadata(bytes(metadata({ version: "v\n1" })))).toBeNull();
  expect(parseFabricAddonMetadata(bytes(metadata({ version: "v".repeat(129) })))).toBeNull();
  expect(parseFabricAddonMetadata(bytes(metadata({ name: "bad\u0000name" })))).toBeNull();
  expect(parseFabricAddonMetadata(bytes(metadata({ name: "n".repeat(129) })))).toBeNull();
});

it("rejects unsupported environment values", () => {
  expect(parseFabricAddonMetadata(bytes(metadata({ environment: "both" })))).toBeNull();
});

it("sets an unusable Minecraft constraint to unknown", () => {
  for (const minecraft of [42, ["1.20", 42], ["x".repeat(129)], Array(17).fill("1.20")]) {
    expect(parseFabricAddonMetadata(bytes(metadata({ depends: { minecraft } })))?.minecraftConstraint).toBeNull();
  }
});
