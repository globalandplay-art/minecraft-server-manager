import { compilerObservationScript } from "./compiled-compiler-observation.js";

/** SOURCE CANDIDATE, NOT RUN. Fixed Windows x64 verified-signer observation.
 * Does not authorize a compiler/build; native ABI/policy behavior is unverified.
 * Existing completed observation source remains byte-identical. */
export function compilerVerifiedSignerScript(): string {
  let source = compilerObservationScript();
  const replace = (from: string, to: string) => {
    if (source.split(from).length !== 2) throw new Error("SIGNER_SOURCE_BINDING_UNSAFE");
    source = source.replace(from, () => to);
  };
  replace("$file = $null", String.raw`$result.scope = 'VERIFIED_SIGNER_OBSERVATION_ONLY'
$result.verifiedSignatureIndex = $null
$result.verifiedSignerObserved = $false
$result.microsoftRootPolicyChecked = $false
$result.microsoftRootPolicyStatus = $null
$result.subjectDer = $null
$result.ekuDer = @()
$signatureSettings = [IntPtr]::Zero
$policyPara = [IntPtr]::Zero
$policyStatus = [IntPtr]::Zero
$file = $null`);
  replace("  $wintrust = [IO.Path]::Combine($windows, 'System32\\wintrust.dll')", String.raw`  $wintrust = [IO.Path]::Combine($windows, 'System32\wintrust.dll')
  $crypt32 = [IO.Path]::Combine($windows, 'System32\crypt32.dll')`);
  replace("@($compiler, $wintrust)", "@($compiler, $wintrust, $crypt32)");
  replace("  $native = $type.CreateType().GetMethod('WinVerifyTrust')", String.raw`  foreach ($definition in @(
    [pscustomobject]@{Name='WTHelperProvDataFromStateData';Dll=$wintrust;Result=[IntPtr];Parameters=[Type[]]@([IntPtr])},
    [pscustomobject]@{Name='WTHelperGetProvSignerFromChain';Dll=$wintrust;Result=[IntPtr];Parameters=[Type[]]@([IntPtr],[uint32],[int],[uint32])},
    [pscustomobject]@{Name='WTHelperGetProvCertFromChain';Dll=$wintrust;Result=[IntPtr];Parameters=[Type[]]@([IntPtr],[uint32])},
    [pscustomobject]@{Name='CertVerifyCertificateChainPolicy';Dll=$crypt32;Result=[int];Parameters=[Type[]]@([IntPtr],[IntPtr],[IntPtr],[IntPtr])}
  )) {
    $entry = $type.DefinePInvokeMethod($definition.Name, $definition.Dll, [Reflection.MethodAttributes]'Public,Static,PinvokeImpl', [Reflection.CallingConventions]::Standard, $definition.Result, $definition.Parameters, [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode)
    $entry.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
  }
  $nativeType = $type.CreateType()
  $native = $nativeType.GetMethod('WinVerifyTrust')`);
  replace("  $stateMayReferenceBuffers = $true", String.raw`  $signatureSettings = [Runtime.InteropServices.Marshal]::AllocHGlobal(32)
  [Runtime.InteropServices.Marshal]::Copy((New-Object byte[] 32), 0, $signatureSettings, 32)
  [Runtime.InteropServices.Marshal]::WriteInt32($signatureSettings, 0, 32)
  [Runtime.InteropServices.Marshal]::WriteInt32($signatureSettings, 4, 0)
  [Runtime.InteropServices.Marshal]::WriteInt32($signatureSettings, 8, 1)
  [Runtime.InteropServices.Marshal]::WriteInt32($signatureSettings, 16, -1)
  [Runtime.InteropServices.Marshal]::WriteIntPtr($data, 80, $signatureSettings)
  $stateMayReferenceBuffers = $true`);
  const start = source.indexOf("    # These are independent embedded-certificate observations");
  const end = source.indexOf("  $file.Position = 0", start);
  if (start < 0 || end <= start) throw new Error("SIGNER_SOURCE_BINDING_UNSAFE");
  source = source.slice(0, start) + String.raw`    $certificate = $null
    try {
      if ([Runtime.InteropServices.Marshal]::ReadInt32($signatureSettings, 16) -ne 0) { throw 'signature-index-unknown' }
      $result.verifiedSignatureIndex = 0
      $state = [Runtime.InteropServices.Marshal]::ReadIntPtr($data, 56)
      if ($state -eq [IntPtr]::Zero) { throw 'provider-unknown' }
      $provider = [IntPtr]$nativeType.GetMethod('WTHelperProvDataFromStateData').Invoke($null, [object[]]@($state))
      if ($provider -eq [IntPtr]::Zero) { throw 'provider-unknown' }
      $signer = [IntPtr]$nativeType.GetMethod('WTHelperGetProvSignerFromChain').Invoke($null, [object[]]@($provider, [uint32]0, [int]0, [uint32]0))
      if ($signer -eq [IntPtr]::Zero -or [Runtime.InteropServices.Marshal]::ReadInt32($signer, 0) -ne 64 -or [Runtime.InteropServices.Marshal]::ReadInt32($signer, 40) -ne 0) { throw 'signer-unknown' }
      $chainCount = [Runtime.InteropServices.Marshal]::ReadInt32($signer, 12)
      if ($chainCount -lt 1 -or $chainCount -gt 16) { throw 'chain-unknown' }
      $chain = [Runtime.InteropServices.Marshal]::ReadIntPtr($signer, 56)
      if ($chain -eq [IntPtr]::Zero) { throw 'chain-unknown' }
      $leaf = [IntPtr]$nativeType.GetMethod('WTHelperGetProvCertFromChain').Invoke($null, [object[]]@($signer, [uint32]0))
      if ($leaf -eq [IntPtr]::Zero -or [Runtime.InteropServices.Marshal]::ReadInt32($leaf, 0) -ne 88 -or [Runtime.InteropServices.Marshal]::ReadInt32($leaf, 40) -ne 0) { throw 'leaf-unknown' }
      $context = [Runtime.InteropServices.Marshal]::ReadIntPtr($leaf, 8)
      if ($context -eq [IntPtr]::Zero) { throw 'leaf-unknown' }
      $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2($context)
      $policyPara = [Runtime.InteropServices.Marshal]::AllocHGlobal(16)
      $policyStatus = [Runtime.InteropServices.Marshal]::AllocHGlobal(24)
      [Runtime.InteropServices.Marshal]::Copy((New-Object byte[] 16), 0, $policyPara, 16)
      [Runtime.InteropServices.Marshal]::Copy((New-Object byte[] 24), 0, $policyStatus, 24)
      [Runtime.InteropServices.Marshal]::WriteInt32($policyPara, 0, 16)
      [Runtime.InteropServices.Marshal]::WriteInt32($policyPara, 4, 0x60000)
      [Runtime.InteropServices.Marshal]::WriteInt32($policyStatus, 0, 24)
      [Runtime.InteropServices.Marshal]::WriteInt32($policyStatus, 4, -1)
      $checked = [int]$nativeType.GetMethod('CertVerifyCertificateChainPolicy').Invoke($null, [object[]]@([IntPtr]7, $chain, $policyPara, $policyStatus))
      $result.microsoftRootPolicyChecked = $checked -ne 0
      $result.microsoftRootPolicyStatus = [Convert]::ToString([Runtime.InteropServices.Marshal]::ReadInt32($policyStatus, 4), 16).PadLeft(8, '0')
      if ($checked -eq 0 -or $result.microsoftRootPolicyStatus -cne '00000000') { throw 'root-policy-rejected' }
      $subject = $certificate.SubjectName.RawData
      if ($subject.Length -lt 2 -or $subject.Length -gt 4096) { throw 'subject-unsupported' }
      $eku = @()
      foreach ($extension in $certificate.Extensions) {
        if ($extension.Oid.Value -ceq '2.5.29.37') {
          if ($extension.RawData.Length -gt 128 -or $eku.Count -ge 4) { throw 'eku-unsupported' }
          $eku += [Convert]::ToBase64String($extension.RawData)
        }
      }
      # Internal bounded transport only. Node must validate and redact these
      # public certificate fields before writing/printing any observation.
      $result.subjectDer = [Convert]::ToBase64String($subject)
      $result.ekuDer = @($eku)
      $result.verifiedSignerObserved = $true
    } catch {
      $result.category = 'verified-signer-unavailable'
      $result.subjectDer = $null
      $result.ekuDer = @()
    } finally { if ($null -ne $certificate) { $certificate.Dispose() } }
  }
` + source.slice(end);
  replace("@($action, $data, $fileInfo, $pathBuffer)", "@($policyPara, $policyStatus, $signatureSettings, $action, $data, $fileInfo, $pathBuffer)");
  return source;
}
