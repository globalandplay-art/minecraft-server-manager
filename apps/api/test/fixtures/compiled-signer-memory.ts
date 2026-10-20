import { readFileSync } from "node:fs";
import { compilerVerifiedSignerScript } from "./compiled-verified-signer.js";

/** Synthetic managed/memory substitutes only; no signature/OS trust proof.
 * Actual generated guard and cleanup fragments are reused, not mirrored. */
export function compiledSignerMemoryScript(): string {
  const source = compilerVerifiedSignerScript();
  const start = source.indexOf("    $certificate = $null");
  const end = source.indexOf("  $file.Position = 0", start);
  const cleanupStart = source.indexOf("finally {\n  if ($stateMayReferenceBuffers)");
  const cleanupEnd = source.indexOf("\n\n$result | ConvertTo-Json", cleanupStart);
  if (start < 0 || end <= start || cleanupStart < 0 || cleanupEnd <= cleanupStart) throw new Error("MEMORY_SOURCE_UNSAFE");
  let guard = source.slice(start, end);
  let cleanup = source.slice(cleanupStart + "finally {\n".length, cleanupEnd);
  if (!guard.endsWith("  }\n") || !cleanup.endsWith("}")) throw new Error("MEMORY_SOURCE_UNSAFE");
  guard = guard.slice(0, -4);
  cleanup = cleanup.slice(0, -1);
  const constructor = "$certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2($context)";
  if (guard.split(constructor).length !== 2) throw new Error("MEMORY_SOURCE_UNSAFE");
  guard = guard.replace(constructor, "$certificate = $syntheticCertificate");
  guard = guard.replace("      $result.category = 'verified-signer-unavailable'", [
    "      $observedError = 'UNEXPECTED'",
    "      foreach ($allowed in @('signature-index-unknown','provider-unknown','signer-unknown','chain-unknown','leaf-unknown','root-policy-rejected','subject-unsupported','eku-unsupported')) {",
    "        if ($_.Exception.Message -ceq $allowed) { $observedError = $allowed }",
    "      }",
    "      $result.category = 'verified-signer-unavailable'",
  ].join("\n"));
  cleanup = cleanup.replace("[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)",
    "$script:freeCount++; [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)");
  const template = readFileSync(new URL("./compiled-signer-memory.ps1.txt", import.meta.url), "utf8");
  for (const marker of ["__ACTUAL_GUARD__", "__ACTUAL_CLEANUP__"]) {
    if (template.split(marker).length !== 2) throw new Error("MEMORY_SOURCE_UNSAFE");
  }
  const result = template.replace("__ACTUAL_GUARD__", () => guard).replace("__ACTUAL_CLEANUP__", () => cleanup);
  if (/DefinePInvokeMethod|DllImport|CreateFromSignedFile|X509Certificate2\(|Get-Acl|FileStream|Win32_Process/u.test(result)) throw new Error("MEMORY_SOURCE_UNSAFE");
  return result;
}
