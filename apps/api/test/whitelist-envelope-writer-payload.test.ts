import { expect, it } from "vitest";
import { envelopeWriterPayload, validEnvelopeWriterPayload } from "./fixtures/whitelist-envelope-writer-payload.js";

it("accepts only the exact inert receipt, independently of JSON property order", () => {
  expect(validEnvelopeWriterPayload(JSON.parse('{"proof":"whitelist-owner-envelope-inert","version":1}'))).toBe(true);
});
it.each([null, [], "ok", { version: "1", proof: "whitelist-owner-envelope-inert" },
  { version: 1, proof: "other" }, { version: 1, proof: "whitelist-owner-envelope-inert", ok: true }, { version: 1 }])("rejects non-exact inert receipt %#", (value) => {
  expect(validEnvelopeWriterPayload(value)).toBe(false);
});
it("has no variable input or mutating command in the fixed native payload", () => {
  expect(envelopeWriterPayload).not.toMatch(/ReadLine|Create|Write-|Set-Acl|Move|Remove|Start-Process|Invoke-|Sleep|https?:/u);
  expect(envelopeWriterPayload).toContain("ConvertTo-Json -Compress");
});
