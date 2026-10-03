# Read-only. Run inside the PowerShell session where manual Minecraft startup succeeded.
# No Java launch, world reads, filesystem writes, registry changes or service operations.
$mcsmPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$mcsmJavaCommand = Get-Command java.exe -ErrorAction SilentlyContinue | Select-Object -First 1
$mcsmExpectedJava = 'C:\Program Files\Eclipse Adoptium\jdk-25.0.4.101-hotspot\bin\java.exe'
$mcsmOutput = & C:\Windows\System32\reg.exe query 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' /v Counter /reg:64 2>&1
$mcsmCounterExit = $LASTEXITCODE
$mcsmJavaEnvironment = @{}
foreach ($mcsmVariable in @('JAVA_HOME','JAVA_TOOL_OPTIONS','JDK_JAVA_OPTIONS','_JAVA_OPTIONS','CLASSPATH')) {
  $mcsmValue = [Environment]::GetEnvironmentVariable($mcsmVariable)
  $mcsmHash = $null
  if ($null -ne $mcsmValue) {
    $mcsmHasher = [Security.Cryptography.SHA256]::Create()
    try { $mcsmHash = ([BitConverter]::ToString($mcsmHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($mcsmValue)))).Replace('-','').ToLowerInvariant() }
    finally { $mcsmHasher.Dispose() }
  }
  $mcsmJavaEnvironment[$mcsmVariable] = @{ Present = ($null -ne $mcsmValue); SHA256 = $mcsmHash }
}
[PSCustomObject]@{
  IsAdministrator = $mcsmPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  WorkingDirectory = (Get-Location).Path
  JavaResolvedByPath = $mcsmJavaCommand.Source
  MatchesManagerJava = ($mcsmJavaCommand.Source -eq $mcsmExpectedJava)
  Perflib009QueryExit = $mcsmCounterExit
  Perflib009Failure = $(if ($mcsmCounterExit -eq 0) { $null } else { 'Counter name table query failed' })
  JavaEnvironment = $mcsmJavaEnvironment
} | ConvertTo-Json -Depth 4
