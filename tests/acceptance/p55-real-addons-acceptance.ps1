# Fresh UUID Paper/Fabric only. Reuse the reviewed P4.4 host/path/runner primitives.
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('paper','fabric')][string]$Kind,
  [switch]$PreflightOnly, [switch]$ConfirmIsolatedAddons, [string]$NodeExecutable)
. (Join-Path $PSScriptRoot 'p44-real-properties-acceptance.ps1') -PreflightOnly:$PreflightOnly -NodeExecutable $NodeExecutable

function Invoke-P55AddonAcceptance {
  param([string]$Kind, [switch]$PreflightOnly, [switch]$ConfirmIsolatedAddons, [string]$NodeExecutable)
  $ErrorActionPreference = 'Stop'
  $workspace = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..'))
  $runId = 'p55-' + $Kind + '-' + [Guid]::NewGuid().ToString('D')
  $manager = [IO.Path]::Combine($workspace, '.manager', $runId)
  $plan = [PSCustomObject]@{ Workspace=$workspace; RunId=$runId; ManagerRoot=$manager
    ServerRoot=[IO.Path]::Combine($workspace,'runtime',$runId); EvidenceRoot=[IO.Path]::Combine($manager,'evidence')
    ReportPath=[IO.Path]::Combine($manager,'acceptance-report.json'); HostPath=[IO.Path]::Combine($manager,'host-preflight.json') }
  $report = New-AcceptanceReport $plan
  $report.Remove('properties'); $report.Remove('players'); $report.addons='BLOCKED'; $report.environment.minecraft='26.2'
  $report.limitations=@('Only fresh isolated addon loading and explicit manager lifecycle/recreation are accepted; no power-loss or player-session claim.',
    'Source worlds, source properties and source addons are never read. Exact launcher-derived libraries are the only copied dependencies.')
  $created = $false
  $variables = @('MCSM_P55_REAL','MCSM_P55_RUN_ID','MCSM_P55_CONSENT','MCSM_P55_KIND','MCSM_P55_JAVA')
  $old = @{}; foreach ($name in $variables) { $old[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
  try {
    Assert-AcceptanceDirectory $workspace
    Assert-AcceptanceDirectory ([IO.Path]::Combine($workspace,'.manager'))
    Assert-AcceptanceDirectory ([IO.Path]::Combine($workspace,'runtime'))
    if ((Test-Path -LiteralPath $plan.ManagerRoot) -or (Test-Path -LiteralPath $plan.ServerRoot)) { throw 'FRESH_ISOLATION_ALREADY_EXISTS' }
    if (-not $PreflightOnly -and -not $ConfirmIsolatedAddons) { throw 'CONFIRM_ISOLATED_ADDONS_REQUIRED' }
    if (-not [Environment]::Is64BitProcess -or [Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'HOST_64BIT_WINDOWS_REQUIRED' }
    foreach ($entry in Get-ChildItem Env:) {
      if ($entry.Name.ToUpperInvariant() -in @('JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','JDK_JAVA_OPTIONS','CLASSPATH') -and $entry.Value.Length -gt 0) { throw 'JAVA_ENVIRONMENT_OVERRIDE' }
    }
    $java=(Get-Command java.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $node=$(if ($NodeExecutable) { $NodeExecutable } else { (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source })
    foreach ($executable in @($node,$java)) {
      if (-not (Test-AcceptanceAbsolutePath $executable)) { throw 'EXECUTABLE_MUST_BE_ABSOLUTE' }
      $item=Get-Item -LiteralPath $executable -Force -ErrorAction Stop
      if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'EXECUTABLE_UNSAFE' }
      Assert-AcceptanceDirectory ([IO.Path]::GetDirectoryName($executable))
    }
    if (-not (Test-Path -LiteralPath ([IO.Path]::Combine($workspace,'node_modules','tsx','dist','loader.mjs')))) { throw 'LOCAL_TS_LOADER_UNAVAILABLE' }
    Write-Host ('Fresh UUID manager root: '+$plan.ManagerRoot)
    Write-Host ('Fresh UUID server root: '+$plan.ServerRoot)
    Write-Host ('Java executable: '+$java)
    [void][IO.Directory]::CreateDirectory($plan.ManagerRoot); $created=$true; Assert-AcceptanceDirectory $plan.ManagerRoot
    [void][IO.Directory]::CreateDirectory($plan.EvidenceRoot)
    Write-AcceptanceJson $plan $plan.ReportPath $report
    [Environment]::SetEnvironmentVariable('MCSM_P55_RUN_ID',$runId,'Process')
    [Environment]::SetEnvironmentVariable('MCSM_P55_KIND',$Kind,'Process')
    [Environment]::SetEnvironmentVariable('MCSM_P55_JAVA',$java,'Process')
    $report.phase='source-preflight'
    $sourceExit=Invoke-AcceptanceRunner -Node $node -Workspace $workspace -EntryPoint (Join-Path $PSScriptRoot 'phase55-source-preflight.mjs')
    if ($sourceExit -ne 0) { throw 'SOURCE_DEPENDENCIES_UNPROVEN' }
    $manifest=Get-Content -LiteralPath (Join-Path $manager 'source-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $report.sourceManifestSha256=$manifest.manifestSha256; $report.sourceFiles=@($manifest.files).Count
    $report.environment.java=@{ executable=$java; requiredMajor=25 }; $report.environment.node=$node
    $report.phase='host-preconditions'; $report.hostPreconditions=Get-HostPreconditions
    Write-AcceptanceJson $plan $plan.HostPath $report
    if ($report.hostPreconditions.perflibRegistry.result -ne 'pass' -or $report.hostPreconditions.getCounter.result -ne 'pass') { throw 'HOST_PRECONDITION_UNAVAILABLE' }
    if ($PreflightOnly) {
      $report.result='NOT_RUN'; $report.classification='preflight-only'; $report.finishedAt=[DateTime]::UtcNow.ToString('o')
      Write-AcceptanceJson $plan $plan.ReportPath $report
      Write-Host ('SOURCE/HOST PREFLIGHT PASS; real server NOT RUN: '+$plan.ReportPath); return 0
    }
    [Environment]::SetEnvironmentVariable('MCSM_P55_REAL','1','Process')
    [Environment]::SetEnvironmentVariable('MCSM_P55_CONSENT','1','Process')
    $report.phase='runner'; $report.classification='real-acceptance'; Write-AcceptanceJson $plan $plan.ReportPath $report
    $runnerExit=Invoke-AcceptanceRunner -Node $node -Workspace $workspace -EntryPoint (Join-Path $PSScriptRoot 'phase55-addons-real.mjs')
    $final=Get-Content -LiteralPath $plan.ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($final.runId -cne $runId) { throw 'RUNNER_REPORT_IDENTITY_MISMATCH' }
    $complete=$final.addons -eq 'PASS' -and $final.result -eq 'PASS' -and $final.finalStopped -eq $true -and $final.sourceInputsUnchanged -eq $true -and $final.helpersClosed -eq $true
    foreach ($state in @('minecraftStopped','javaProcessStopped','portsReleased','managerStopped','noActiveOperation','recoveryGateCleared')) { if ($final.finalState.$state -ne $true) { $complete=$false } }
    if ($runnerExit -ne 0 -or -not $complete) { Write-Host ('BLOCKED; preserve complete evidence: '+$plan.ReportPath); return 1 }
    Write-Host ('REAL ISOLATED '+$Kind+' ACCEPTANCE PASS: '+$plan.ReportPath); return 0
  } catch {
    $report.result='BLOCKED'; $report.finishedAt=[DateTime]::UtcNow.ToString('o')
    $diagnostic=Get-AcceptanceDiagnostic $_.Exception
    $report.failures+=@{ phase=$report.phase; code=$_.Exception.Message; operationId=$null; recoveryState=$null; diagnostic=$diagnostic }
    if ($created) { Write-AcceptanceJson $plan $plan.ReportPath $report }
    Write-Host ('BLOCKED: '+$diagnostic.message)
    if ($created) { Write-Host ('Report: '+$plan.ReportPath) }; return 1
  } finally {
    foreach ($name in $variables) { [Environment]::SetEnvironmentVariable($name,$old[$name],'Process') }
  }
}
if ($MyInvocation.InvocationName -ne '.') { exit (Invoke-P55AddonAcceptance -Kind $Kind -PreflightOnly:$PreflightOnly -ConfirmIsolatedAddons:$ConfirmIsolatedAddons -NodeExecutable $NodeExecutable) }
