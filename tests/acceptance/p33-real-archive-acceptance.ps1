# Manually run in a normal 64-bit host PowerShell. No elevation or Windows repair.
# Dot-sourcing defines functions only; synthetic tests can mock the read-only probes.
[CmdletBinding()]
param([switch]$PreflightOnly, [switch]$ConfirmIsolatedArchive, [string]$NodeExecutable)

function Test-AcceptanceAbsolutePath {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  # WinPS 5/.NET Framework: IsPathRooted also accepts C:relative and \relative.
  # Require a drive root or a complete UNC server/share; exclude device namespaces.
  return ($Path -match '^[A-Za-z]:[\\/]' -or $Path -match '^\\\\(?![?.]\\)[^\\/:*?"<>|\x00-\x1f]+\\[^\\/:*?"<>|\x00-\x1f]+(?:\\|$)')
}

function New-AcceptancePlan {
  param([Parameter(Mandatory)][string]$Workspace, [string]$Uuid = ([Guid]::NewGuid().ToString('D')))
  if ($Uuid -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'Invalid acceptance UUID v4' }
  if (-not (Test-AcceptanceAbsolutePath $Workspace)) { throw 'Workspace must be fully absolute' }
  $full = [IO.Path]::GetFullPath($Workspace)
  $root = $(if ($full -eq [IO.Path]::GetPathRoot($full)) { $full } else { $full.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) })
  $runId = 'p33-archive-' + $Uuid
  $managerRoot = [IO.Path]::Combine($root, '.manager', $runId)
  [PSCustomObject]@{
    Workspace = $root; RunId = $runId
    ServerRoot = [IO.Path]::Combine($root, 'runtime', $runId)
    ManagerRoot = $managerRoot
    EvidenceRoot = [IO.Path]::Combine($managerRoot, 'evidence')
    ReportPath = [IO.Path]::Combine($managerRoot, 'acceptance-report.json')
    HostPath = [IO.Path]::Combine($managerRoot, 'host-preflight.json')
  }
}

function Assert-AcceptanceDirectory {
  param([Parameter(Mandatory)][string]$Path)
  $absolute = [IO.Path]::GetFullPath($Path)
  $cursor = $absolute
  while ($cursor) {
    $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe acceptance path: directory/reparse-point check failed' }
    if ($item.FullName.TrimEnd('\') -ine $cursor.TrimEnd('\')) { throw 'Noncanonical acceptance path' }
    $parent = [IO.Directory]::GetParent($cursor)
    if ($null -eq $parent) { break }
    $cursor = $parent.FullName
  }
}

function Get-HostPreconditions {
  # Only read in the user's host session. Failures describe this context, not Windows damage.
  $registry = @{ result = 'unavailable'; count = $null; code = $null; message = $null; diagnostic = $null }
  $counterResult = @{ result = 'unavailable'; sampleCount = $null; code = $null; message = $null; diagnostic = $null }
  try {
    $counter = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' -Name Counter -ErrorAction Stop).Counter
    if ($null -eq $counter -or @($counter).Count -eq 0) { throw 'Perflib Counter returned no entries' }
    $registry.result = 'pass'; $registry.count = @($counter).Count
  } catch {
    $registry.code = 'HOST_PERFLIB_UNAVAILABLE'; $registry.message = 'Read-only Perflib Counter lookup unavailable in this host session; no Windows repair attempted.'
    $registry.diagnostic = Get-AcceptanceDiagnostic $_.Exception
  }
  try {
    $samples = Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1 -ErrorAction Stop
    $valid = @($samples.CounterSamples)
    if ($valid.Count -eq 0 -or @($valid | Where-Object { $_.Status -ne 0 -or [double]::IsNaN($_.CookedValue) -or [double]::IsInfinity($_.CookedValue) }).Count -gt 0) {
      throw 'CPU counter returned no valid samples'
    }
    $counterResult.result = 'pass'; $counterResult.sampleCount = $valid.Count
  } catch {
    $counterResult.code = 'HOST_COUNTER_UNAVAILABLE'; $counterResult.message = 'Read-only CPU sample unavailable in this host session; no Windows repair attempted.'
    $counterResult.diagnostic = Get-AcceptanceDiagnostic $_.Exception
  }
  @{ perflibRegistry = $registry; getCounter = $counterResult }
}

function Get-AcceptanceDiagnostic {
  param([Parameter(Mandatory)]$Exception)
  $sanitize = { param($value) ([string]$value) -replace '(?i)((?:rcon\.password|password|access[_-]?token|authorization|secret)\s*[=:]\s*)[^\s,;]+', '$1[redacted]' }
  @{
    type = $Exception.GetType().FullName; hResult = $Exception.HResult; message = (& $sanitize $Exception.Message)
    innerException = $(if ($null -ne $Exception.InnerException) {
      @{ type = $Exception.InnerException.GetType().FullName; hResult = $Exception.InnerException.HResult; message = (& $sanitize $Exception.InnerException.Message) }
    } else { $null })
  }
}

function New-AcceptanceReport {
  param([Parameter(Mandatory)]$Plan)
  @{
    runId = $Plan.RunId; startedAt = [DateTime]::UtcNow.ToString('o'); finishedAt = $null; result = 'RUNNING'
    classification = 'environment-unavailable/precondition-failure'; phase = 'host-preconditions'
    environment = @{ os = [Environment]::OSVersion.VersionString; powershell = $PSVersionTable.PSVersion.ToString()
      is64BitProcess = [Environment]::Is64BitProcess; java = $null; minecraft = '26.3' }
    hostPreconditions = @{ perflibRegistry = @{ result = 'not-run' }; getCounter = @{ result = 'not-run' } }
    isolation = @{ managerRoot = $Plan.ManagerRoot; serverRoot = $Plan.ServerRoot; originalUserWorldTouched = $false }
    archiveAcceptance = @{ worldCreated = $false; protectionBackupCreated = $false; completeWorldSetArchived = $false; activeNone = $false; restartNone = $false; startRejected = $false; noEmptyWorld = $false }
    finalState = @{ minecraftStopped = $false; javaProcessStopped = $true; portsReleased = $true; managerStopped = $false; noActiveOperation = $true }
    evidence = @{ root = $Plan.EvidenceRoot; hostPreflight = $Plan.HostPath }
    failures = @(); limitations = @('Codex registry probes are environment-unavailable/inconclusive, not evidence of host failure.',
      'Real acceptance requires this manual host invocation; a preflight-only run cannot establish product PASS.')
  }
}

function Write-AcceptanceJson {
  param([Parameter(Mandatory)]$Plan, [Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Value)
  if ($Path -cne $Plan.ReportPath -and $Path -cne $Plan.HostPath) { throw 'Report path outside the owned run' }
  Assert-AcceptanceDirectory $Plan.ManagerRoot
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe report file' }
  }
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 40), [Text.UTF8Encoding]::new($false))
}

function Invoke-AcceptanceRunner {
  param([Parameter(Mandatory)][string]$Node, [Parameter(Mandatory)][string]$Workspace, [Parameter(Mandatory)][string]$EntryPoint)
  $previousErrorAction = $ErrorActionPreference
  $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
  $ErrorActionPreference = 'Continue'
  if ($null -ne $nativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
  Push-Location -LiteralPath $Workspace
  try {
    # Native stderr must not abort the wait or replace the runner's structured report.
    & $Node --import tsx $EntryPoint 2>&1 | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
  } finally {
    Pop-Location
    $ErrorActionPreference = $previousErrorAction
    if ($null -ne $nativePreference) { $PSNativeCommandUseErrorActionPreference = $nativePreference.Value }
  }
}

function Invoke-P33ArchiveAcceptance {
  param([switch]$PreflightOnly, [switch]$ConfirmIsolatedArchive, [string]$NodeExecutable)
  $ErrorActionPreference = 'Stop'
  $workspace = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..'))
  $plan = New-AcceptancePlan -Workspace $workspace
  $report = New-AcceptanceReport $plan
  $created = $false
  $oldOptIn = [Environment]::GetEnvironmentVariable('MCSM_ARCHIVE_REAL', 'Process')
  $oldRunId = [Environment]::GetEnvironmentVariable('MCSM_ARCHIVE_RUN_ID', 'Process')
  $oldConsent = [Environment]::GetEnvironmentVariable('MCSM_ARCHIVE_CONSENT', 'Process')
  try {
    Assert-AcceptanceDirectory $workspace
    Assert-AcceptanceDirectory ([IO.Path]::Combine($workspace, '.manager'))
    Assert-AcceptanceDirectory ([IO.Path]::Combine($workspace, 'runtime'))
    if ((Test-Path -LiteralPath $plan.ManagerRoot) -or (Test-Path -LiteralPath $plan.ServerRoot)) { throw 'Fresh run directories already exist' }
    # All destination paths and their ancestors are checked before the first write.
    Write-Host ('Acceptance run ID: ' + $plan.RunId)
    Write-Host ('Isolation/manager root: ' + $plan.ManagerRoot)
    Write-Host ('Server root: ' + $plan.ServerRoot)
    Write-Host 'Minecraft: Vanilla 26.3; Java: verified Java 25 from the prior isolated acceptance config'
    Write-Host 'Server/RCON ports: allocated as distinct free loopback ports by the runner before Java starts'
    [void][IO.Directory]::CreateDirectory($plan.ManagerRoot); $created = $true
    Assert-AcceptanceDirectory $plan.ManagerRoot
    [void][IO.Directory]::CreateDirectory($plan.EvidenceRoot)
    Write-AcceptanceJson $plan $plan.ReportPath $report
    if (-not $PreflightOnly -and -not $ConfirmIsolatedArchive) {
      $report.classification = 'consent-required'; throw 'CONFIRM_ISOLATED_ARCHIVE_REQUIRED'
    }
    if (-not [Environment]::Is64BitProcess -or [Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'HOST_64BIT_WINDOWS_REQUIRED' }
    $report.hostPreconditions = Get-HostPreconditions
    Write-AcceptanceJson $plan $plan.HostPath $report
    if ($report.hostPreconditions.perflibRegistry.result -ne 'pass' -or $report.hostPreconditions.getCounter.result -ne 'pass') {
      throw 'HOST_PRECONDITION_UNAVAILABLE'
    }
    if ($PreflightOnly) {
      $report.result = 'NOT_RUN'; $report.classification = 'preflight-only'; $report.finishedAt = [DateTime]::UtcNow.ToString('o')
      Write-AcceptanceJson $plan $plan.ReportPath $report
      Write-Host ('Host preflight passed; real acceptance NOT RUN. Report: ' + $plan.ReportPath)
      return 0
    }
    $node = $(if ($NodeExecutable) { $NodeExecutable } else { (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source })
    if (-not (Test-AcceptanceAbsolutePath $node)) { throw 'NODE_EXECUTABLE_MUST_BE_ABSOLUTE' }
    $nodeItem = Get-Item -LiteralPath $node -Force -ErrorAction Stop
    if ($nodeItem.PSIsContainer -or ($nodeItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'NODE_EXECUTABLE_UNSAFE' }
    Assert-AcceptanceDirectory ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($node)))
    $node = (Resolve-Path -LiteralPath $node -ErrorAction Stop).ProviderPath
    $report.environment.node = $node
    if (-not (Test-Path -LiteralPath ([IO.Path]::Combine($workspace, 'node_modules', 'tsx', 'dist', 'loader.mjs')))) { throw 'LOCAL_TS_LOADER_UNAVAILABLE' }
    $report.phase = 'runner'; $report.classification = 'real-acceptance'
    Write-AcceptanceJson $plan $plan.ReportPath $report
    [Environment]::SetEnvironmentVariable('MCSM_ARCHIVE_REAL', '1', 'Process')
    [Environment]::SetEnvironmentVariable('MCSM_ARCHIVE_RUN_ID', $plan.RunId, 'Process')
    [Environment]::SetEnvironmentVariable('MCSM_ARCHIVE_CONSENT', '1', 'Process')
    $runnerExit = Invoke-AcceptanceRunner -Node $node -Workspace $workspace -EntryPoint ([IO.Path]::Combine($workspace, 'tests', 'acceptance', 'phase3-archive-real.mjs'))
    $final = Get-Content -LiteralPath $plan.ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($final.runId -cne $plan.RunId) { throw 'RUNNER_REPORT_IDENTITY_MISMATCH' }
    if ($runnerExit -ne 0 -or $final.result -ne 'PASS') {
      if ($final.result -eq 'RUNNING') { throw 'RUNNER_FAILED_WITHOUT_FINAL_REPORT' }
      if ($final.result -eq 'PASS') {
        $final.result = 'BLOCKED'
        $final.failures = @($final.failures) + @(@{ phase = 'runner-exit'; code = 'RUNNER_NONZERO_EXIT'; operationId = $null
          recoveryState = $null; relevantLogExcerpt = ('Runner exit code: ' + $runnerExit) })
        Write-AcceptanceJson $plan $plan.ReportPath $final
      }
      Write-Host ('BLOCKED: real acceptance did not PASS; preserve all evidence. Report: ' + $plan.ReportPath)
      return 1
    }
    Write-Host ('PASS: isolated real acceptance completed. Report: ' + $plan.ReportPath)
    return 0
  } catch {
    $diagnostic = Get-AcceptanceDiagnostic $_.Exception
    $report.result = 'BLOCKED'; $report.finishedAt = [DateTime]::UtcNow.ToString('o')
    $failureCode = $(if ($_.Exception.Message -cmatch '^[A-Z][A-Z_]+$') { $_.Exception.Message } else { 'ACCEPTANCE_HOST_SETUP_FAILED' })
    $report.failures += @{ phase = $report.phase; code = $failureCode; operationId = $null; recoveryState = $null
      relevantLogExcerpt = 'Host prerequisites or runner launch did not complete. No Windows repair or Archive retry attempted.'
      diagnostic = $diagnostic }
    if ($created) { Write-AcceptanceJson $plan $plan.ReportPath $report }
    Write-Host ('BLOCKED (' + $report.classification + '): ' + $diagnostic.message)
    if ($created) { Write-Host ('Report: ' + $plan.ReportPath) }
    return 1
  } finally {
    [Environment]::SetEnvironmentVariable('MCSM_ARCHIVE_REAL', $oldOptIn, 'Process')
    [Environment]::SetEnvironmentVariable('MCSM_ARCHIVE_RUN_ID', $oldRunId, 'Process')
    [Environment]::SetEnvironmentVariable('MCSM_ARCHIVE_CONSENT', $oldConsent, 'Process')
  }
}

if ($MyInvocation.InvocationName -ne '.') { exit (Invoke-P33ArchiveAcceptance -PreflightOnly:$PreflightOnly -ConfirmIsolatedArchive:$ConfirmIsolatedArchive -NodeExecutable $NodeExecutable) }
