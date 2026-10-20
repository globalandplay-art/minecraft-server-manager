import { describe, expect, it } from "vitest";
import { compiledSignerMemoryScript } from "./fixtures/compiled-signer-memory.js";

describe("unexecuted synthetic-memory script assembly", () => {
  it("reuses actual guards and cleanup without OS signature or compiler calls", () => {
    const source = compiledSignerMemoryScript();
    expect(source).toContain("ReadInt32($leaf, 40) -ne 0");
    expect(source).toContain("$certificate = $syntheticCertificate");
    expect(source).toContain("$script:freeCount++; [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)");
    expect(source).toContain("GCHandle]::Alloc($file");
    expect(source).not.toMatch(/DefinePInvokeMethod|DllImport|X509Certificate2\(|FileStream|__ACTUAL_/u);
    expect(source).toContain("SYNTHETIC_MEMORY_ONLY");
    expect(compiledSignerMemoryScript()).toBe(source);
  });
});
