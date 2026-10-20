import { TextDecoder } from "node:util";

/** Test-only, UNWIRED. This observes an offline Windows trust result; it does
 * not establish compiler provenance, publisher identity, ancestry or build
 * authority. No compilation, artifact creation or execution is performed. */
export function compilerObservationScript(): string {
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$result = [ordered]@{ version=1; scope='OFFLINE_SIGNATURE_OBSERVATION_ONLY'; category='unavailable'; winVerifyTrustStatus=$null; compilerSha256=$null; bytes=$null; embeddedMicrosoftName=$null; embeddedCodeSigningEku=$null; stateClosed=$false; compilerTrust='pending' }
$file = $null
$fileInfo = [IntPtr]::Zero
$data = [IntPtr]::Zero
$pathBuffer = [IntPtr]::Zero
$action = [IntPtr]::Zero
$stateMayReferenceBuffers = $false
$native = $null
try {
  if ([IntPtr]::Size -ne 8) { throw 'unsupported' }
  $windows = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
  # Deliberately supports only this fixed local Windows installation. Never
  # follow an environment-provided UNC/device/mapped target for observation.
  if (-not [String]::Equals($windows, 'C:\Windows', [StringComparison]::OrdinalIgnoreCase)) { throw 'unavailable' }
  $compiler = [IO.Path]::Combine($windows, 'Microsoft.NET\Framework64\v4.0.30319\csc.exe')
  $wintrust = [IO.Path]::Combine($windows, 'System32\wintrust.dll')
  foreach ($parent in @('C:\', $windows, ($windows + '\System32'), ($windows + '\Microsoft.NET'), ($windows + '\Microsoft.NET\Framework64'), ($windows + '\Microsoft.NET\Framework64\v4.0.30319'))) {
    $attributes = [IO.File]::GetAttributes($parent)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'unavailable' }
  }
  foreach ($target in @($compiler, $wintrust)) {
    $attributes = [IO.File]::GetAttributes($target)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($attributes -band [IO.FileAttributes]::Directory) -ne 0) { throw 'unavailable' }
  }
  $file = New-Object IO.FileStream($compiler, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  if ($file.Length -lt 1 -or $file.Length -gt 33554432) { throw 'unavailable' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $before = [BitConverter]::ToString($sha.ComputeHash($file)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
  $result.compilerSha256 = $before
  $result.bytes = $file.Length
  $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName('BoundedTrustObservation')), [Reflection.Emit.AssemblyBuilderAccess]::Run)
  $module = $assembly.DefineDynamicModule('Native')
  $type = $module.DefineType('NativeTrustObservation', [Reflection.TypeAttributes]'Public,Sealed,Abstract')
  $method = $type.DefinePInvokeMethod('WinVerifyTrust', $wintrust, [Reflection.MethodAttributes]'Public,Static,PinvokeImpl', [Reflection.CallingConventions]::Standard, [int], [Type[]]@([IntPtr],[IntPtr],[IntPtr]), [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode)
  $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
  $native = $type.CreateType().GetMethod('WinVerifyTrust')
  $fileInfo = [Runtime.InteropServices.Marshal]::AllocHGlobal(32)
  $data = [Runtime.InteropServices.Marshal]::AllocHGlobal(88)
  $action = [Runtime.InteropServices.Marshal]::AllocHGlobal(16)
  $pathBuffer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($compiler)
  [Runtime.InteropServices.Marshal]::Copy((New-Object byte[] 32), 0, $fileInfo, 32)
  [Runtime.InteropServices.Marshal]::Copy((New-Object byte[] 88), 0, $data, 88)
  [Runtime.InteropServices.Marshal]::StructureToPtr([Guid]'00AAC56B-CD44-11D0-8CC2-00C04FC295EE', $action, $false)
  [Runtime.InteropServices.Marshal]::WriteInt32($fileInfo, 0, 32)
  [Runtime.InteropServices.Marshal]::WriteIntPtr($fileInfo, 8, $pathBuffer)
  [Runtime.InteropServices.Marshal]::WriteIntPtr($fileInfo, 16, $file.SafeFileHandle.DangerousGetHandle())
  [Runtime.InteropServices.Marshal]::WriteInt32($data, 0, 88)
  [Runtime.InteropServices.Marshal]::WriteInt32($data, 24, 2)
  [Runtime.InteropServices.Marshal]::WriteInt32($data, 28, 0)
  [Runtime.InteropServices.Marshal]::WriteInt32($data, 32, 1)
  [Runtime.InteropServices.Marshal]::WriteIntPtr($data, 40, $fileInfo)
  [Runtime.InteropServices.Marshal]::WriteInt32($data, 48, 1)
  [Runtime.InteropServices.Marshal]::WriteInt32($data, 72, 0x3010)
  $stateMayReferenceBuffers = $true
  $status = [int]$native.Invoke($null, [object[]]@([IntPtr]::Zero, $action, $data))
  $result.winVerifyTrustStatus = $status
  $result.category = 'signature-rejected'
  if ($status -eq 0) {
    $result.category = 'offline-signature-observed'
    # These are independent embedded-certificate observations, NOT the WVT
    # verified signer. They must never authorize a compiler or publisher.
    $certificate = $null
    try {
      $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2([Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($compiler))
      $result.embeddedMicrosoftName = $certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ceq 'Microsoft Corporation'
      $result.embeddedCodeSigningEku = $false
      foreach ($extension in $certificate.Extensions) {
        if ($extension -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
          foreach ($oid in $extension.EnhancedKeyUsages) {
            if ($oid.Value -ceq '1.3.6.1.5.5.7.3.3') { $result.embeddedCodeSigningEku = $true }
          }
        }
      }
    } catch { $result.category = 'certificate-observation-unavailable' }
    finally { if ($null -ne $certificate) { $certificate.Dispose() } }
  }
  $file.Position = 0
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $after = [BitConverter]::ToString($sha.ComputeHash($file)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
  if ($before -cne $after) { $result.category = 'identity-uncertain' }
} catch { $result.category = 'observation-unavailable' }
finally {
  if ($stateMayReferenceBuffers) {
    try {
      [Runtime.InteropServices.Marshal]::WriteInt32($data, 48, 2)
      $closeStatus = [int]$native.Invoke($null, [object[]]@([IntPtr]::Zero, $action, $data))
      if ($closeStatus -ne 0) { throw 'cleanup-uncertain' }
      $stateMayReferenceBuffers = $false
      $result.stateClosed = $true
    } catch {
      $result.category = 'cleanup-uncertain'
      # Intentionally never freed: preserve the file object until OS process
      # teardown, even after this runspace's local variables become collectible.
      $null = [Runtime.InteropServices.GCHandle]::Alloc($file, [Runtime.InteropServices.GCHandleType]::Normal)
    }
  }
  if (-not $stateMayReferenceBuffers) {
    foreach ($buffer in @($action, $data, $fileInfo, $pathBuffer)) {
      if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
    }
    if ($null -ne $file) { $file.Dispose() }
  }
}

$result | ConvertTo-Json -Compress -Depth 3
`;
}

const categories = ["unavailable", "signature-rejected", "offline-signature-observed",
  "certificate-observation-unavailable", "identity-uncertain", "observation-unavailable", "cleanup-uncertain"] as const;
type ObservationCategory = typeof categories[number];
export type CompilerObservation = Readonly<{
  version: 1; scope: "OFFLINE_SIGNATURE_OBSERVATION_ONLY"; category: ObservationCategory;
  winVerifyTrustStatus: number | null; compilerSha256: string | null; bytes: number | null;
  embeddedMicrosoftName: boolean | null; embeddedCodeSigningEku: boolean | null;
  stateClosed: boolean; compilerTrust: "pending";
}>;

/** Shape validation never grants trust, including for fully successful-looking
 * forged payloads. Fixed error text prevents raw helper output disclosure. */
export function parseCompilerObservation(bytes: Buffer): CompilerObservation {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 16384) throw 0;
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw 0;
    const row = value as Record<string, unknown>;
    const names = ["version", "scope", "category", "winVerifyTrustStatus", "compilerSha256", "bytes",
      "embeddedMicrosoftName", "embeddedCodeSigningEku", "stateClosed", "compilerTrust"];
    if (Object.keys(row).sort().join(",") !== names.sort().join(",") || row.version !== 1 ||
      row.scope !== "OFFLINE_SIGNATURE_OBSERVATION_ONLY" || row.compilerTrust !== "pending" ||
      typeof row.category !== "string" || !categories.includes(row.category as ObservationCategory) ||
      typeof row.stateClosed !== "boolean") throw 0;
    if (row.winVerifyTrustStatus !== null && (!Number.isInteger(row.winVerifyTrustStatus) ||
      (row.winVerifyTrustStatus as number) < -2147483648 || (row.winVerifyTrustStatus as number) > 2147483647)) throw 0;
    if (row.compilerSha256 !== null && (typeof row.compilerSha256 !== "string" ||
      row.compilerSha256.length !== 64 || !/^[0-9a-f]{64}$/u.test(row.compilerSha256))) throw 0;
    if (row.bytes !== null && (!Number.isSafeInteger(row.bytes) || (row.bytes as number) < 1 || (row.bytes as number) > 32 * 1024 * 1024)) throw 0;
    for (const name of ["embeddedMicrosoftName", "embeddedCodeSigningEku"]) {
      if (row[name] !== null && typeof row[name] !== "boolean") throw 0;
    }
    if (row.category === "offline-signature-observed" && (row.winVerifyTrustStatus !== 0 ||
      row.stateClosed !== true || row.compilerSha256 === null || row.bytes === null ||
      row.embeddedMicrosoftName === null || row.embeddedCodeSigningEku === null)) throw 0;
    if (row.category === "signature-rejected" && (row.winVerifyTrustStatus === null || row.winVerifyTrustStatus === 0)) throw 0;
    return Object.freeze({ ...row }) as CompilerObservation;
  } catch { throw new Error("COMPILER_OBSERVATION_UNSAFE"); }
}
