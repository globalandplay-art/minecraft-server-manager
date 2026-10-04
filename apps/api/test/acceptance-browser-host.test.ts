import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const wrapper = path.join(workspace, "tests/acceptance/p35-real-browser-acceptance.ps1");
const helper = path.join(workspace, "tests/acceptance/phase35-browser-real.mjs");
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
const syntheticWorkspace = path.join("C:\\", "synthetic", "mcsm");
function powershell(script: string) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8", timeout: 20_000, windowsHide: true });
  expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}
function assertOwnedFixture(root: string) {
  expect(path.resolve(root).startsWith(path.join(path.resolve(tmpdir()), "mcsm-host-wrapper-test-"))).toBe(true);
}
describe("P3.5 browser host acceptance harness boundaries", () => {
  it("rejects drive-relative, root-relative and device paths before selecting an executable", () => {
    const candidates = ["C:node.exe", path.win32.sep + "node.exe", String.raw`\\?\C:\node.exe`, "node.exe"];
    const output = powershell(`. ${literal(wrapper)}; $values=@(${candidates.map(literal).join(",")}); $invalid=@($values | ForEach-Object { Test-AcceptanceAbsolutePath $_ }); $valid=Test-AcceptanceAbsolutePath ${literal(syntheticWorkspace)}; @{invalid=$invalid;valid=$valid} | ConvertTo-Json -Compress`);
    const result = JSON.parse(output);
    expect(result.invalid).toEqual([false, false, false, false]); expect(result.valid).toBe(true);
  }, 25_000);
  it("creates pure isolated plans and an unclaimed report, rejecting path-like or invalid UUIDs", () => {
    const output = powershell(`. ${literal(wrapper)}; $plan=New-AcceptancePlan -Workspace ${literal(syntheticWorkspace)} -Uuid '123e4567-e89b-42d3-a456-426614174000'; $report=New-AcceptanceReport -Plan $plan; $rejections=0; foreach($id in @('../world','123e4567-e89b-12d3-a456-426614174000')){try{New-AcceptancePlan -Workspace ${literal(syntheticWorkspace)} -Uuid $id | Out-Null}catch{$rejections++}}; @{plan=$plan; report=$report; rejections=$rejections} | ConvertTo-Json -Depth 20 -Compress`);
    const result = JSON.parse(output);
    expect(result.rejections).toBe(2);
    expect(result.plan.ServerRoot).toBe(path.join(syntheticWorkspace, "runtime", "p35-browser-123e4567-e89b-42d3-a456-426614174000"));
    expect(result.plan.ManagerRoot).toBe(path.join(syntheticWorkspace, ".manager", "p35-browser-123e4567-e89b-42d3-a456-426614174000"));
    expect(result.report.result).toBe("RUNNING");
    expect(result.report.isolation.originalUserWorldTouched).toBe(false);
    expect(result.report.browser).toBe("BLOCKED");
    expect(result.report.browserRuns).toEqual([]);
  }, 25_000);
  it("accepts valid synthetic host counter samples without accessing the registry", () => {
    const output = powershell(`. ${literal(wrapper)}; function Get-ItemProperty { [CmdletBinding()]param([string]$LiteralPath,[string]$Name) @{Counter=@('1','Processor')} }; function Get-Counter { [CmdletBinding()]param([string]$Counter,[int]$SampleInterval,[int]$MaxSamples) @{CounterSamples=@(@{Status=0;CookedValue=1.25})} }; Get-HostPreconditions | ConvertTo-Json -Depth 10 -Compress`);
    const result = JSON.parse(output);
    expect(result.perflibRegistry).toMatchObject({ result: "pass", count: 2 });
    expect(result.getCounter).toMatchObject({ result: "pass", sampleCount: 1 });
  }, 25_000);
  it("classifies unavailable host probes and invalid samples without repair or product PASS", () => {
    const output = powershell(`. ${literal(wrapper)}; function Get-ItemProperty { [CmdletBinding()]param([string]$LiteralPath,[string]$Name) throw 'Synthetic registry unavailable' }; function Get-Counter { [CmdletBinding()]param([string]$Counter,[int]$SampleInterval,[int]$MaxSamples) @{CounterSamples=@(@{Status=0;CookedValue=[double]::NaN})} }; Get-HostPreconditions | ConvertTo-Json -Depth 10 -Compress`);
    const result = JSON.parse(output);
    expect(result.perflibRegistry).toMatchObject({ result: "unavailable", code: "HOST_PERFLIB_UNAVAILABLE" });
    expect(result.getCounter).toMatchObject({ result: "unavailable", code: "HOST_COUNTER_UNAVAILABLE" });
  }, 25_000);
  it("parses the PowerShell wrapper without executing it or host probes", () => {
    const output = powershell(`$tokens=$null; $parseErrors=$null; $ast=[System.Management.Automation.Language.Parser]::ParseFile(${literal(wrapper)},[ref]$tokens,[ref]$parseErrors); if ($parseErrors.Count) { throw ($parseErrors | Out-String) }; $forbidden=@('Set-ItemProperty','Remove-ItemProperty','Clear-ItemProperty','Set-Service','Restart-Service'); $commands=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]},$true); foreach($command in $commands){if($forbidden -contains $command.GetCommandName()){throw 'System mutation in acceptance wrapper'}}; 'PARSE_PASS'`);
    expect(output).toBe("PARSE_PASS");
  }, 25_000);
  it("dot-sourcing defines functions without creating directories, launching processes or probing the host", () => {
    const output = powershell(`function New-Item { throw 'Unexpected filesystem write' }; function Start-Process { throw 'Unexpected process launch' }; function Get-ItemProperty { throw 'Unexpected registry read' }; function Get-Counter { throw 'Unexpected counter read' }; . ${literal(wrapper)}; if (-not (Get-Command New-AcceptancePlan -ErrorAction SilentlyContinue)) { throw 'Missing pure plan helper' }; 'LIBRARY_PASS'`);
    expect(output).toBe("LIBRARY_PASS");
  }, 25_000);
  it("never starts the Node acceptance helper without explicit opt-in", () => {
    const env = { ...process.env }; delete env.MCSM_P35_REAL; delete env.MCSM_P35_RUN_ID;
    const result = spawnSync(process.execPath, ["--import", "tsx", helper], { cwd: workspace, env, encoding: "utf8", timeout: 20_000, windowsHide: true });
    expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/opt-in|PowerShell|MCSM_P35_REAL/u);
    expect(result.stdout).not.toContain("CONFIRMED FRESH TEST CANONICAL PATH");
  }, 25_000);
  it("never starts Java when isolated archive consent is missing", () => {
    const env = { ...process.env, MCSM_P35_REAL: "1", MCSM_P35_RUN_ID: "p35-browser-123e4567-e89b-42d3-a456-426614174000" };
    delete (env as NodeJS.ProcessEnv).MCSM_P35_CONSENT;
    const result = spawnSync(process.execPath, ["--import", "tsx", helper], { cwd: workspace, env, encoding: "utf8", timeout: 20_000, windowsHide: true });
    expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ConfirmIsolatedBrowser");
    expect(result.stdout).not.toContain("CONFIRMED FRESH TEST CANONICAL PATH");
  }, 25_000);
  it("writes an environment failure report in a synthetic workspace without Java or a runtime instance", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcsm-host-wrapper-test-"));
    try {
      const copiedWrapper = path.join(root, "tests", "acceptance", "p35-real-browser-acceptance.ps1");
      await mkdir(path.dirname(copiedWrapper), { recursive: true });
      await mkdir(path.join(root, ".manager")); await mkdir(path.join(root, "runtime"));
      await copyFile(wrapper, copiedWrapper);
      const output = powershell(`. ${literal(copiedWrapper)}; function Get-ItemProperty { [CmdletBinding()]param([string]$LiteralPath,[string]$Name) throw 'Synthetic unavailable' }; function Get-Counter { [CmdletBinding()]param([string]$Counter,[int]$SampleInterval,[int]$MaxSamples) throw 'Synthetic unavailable' }; function Start-Process { throw 'Unexpected child launch' }; $exitCode=Invoke-P35BrowserAcceptance -PreflightOnly 6>$null; @{exitCode=$exitCode} | ConvertTo-Json -Compress`);
      expect(JSON.parse(output).exitCode).toBe(1);
      expect(await readdir(path.join(root, "runtime"))).toEqual([]);
      const records = await readdir(path.join(root, ".manager")); expect(records).toHaveLength(1);
      expect(records[0]).toMatch(/^p35-browser-[0-9a-f-]{36}$/u);
      const report = JSON.parse(await readFile(path.join(root, ".manager", records[0]!, "acceptance-report.json"), "utf8"));
      expect(report.result).toBe("BLOCKED");
      expect(report.hostPreconditions.perflibRegistry.result).toBe("unavailable");
      expect(report.failures[0].code).toBe("HOST_PRECONDITION_UNAVAILABLE");
      expect(report.browser === "PASS").toBe(false);
      expect(report.isolation.originalUserWorldTouched).toBe(false);
    } finally {
      // This is the exact mkdtemp-owned synthetic fixture, never a real run root.
      assertOwnedFixture(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 25_000);
  it("preserves a synthetic runner failure report despite native stderr and nonzero exit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mcsm-host-wrapper-test-"));
    try {
      const copiedWrapper = path.join(root, "tests", "acceptance", "p35-real-browser-acceptance.ps1");
      await mkdir(path.dirname(copiedWrapper), { recursive: true });
      await mkdir(path.join(root, ".manager")); await mkdir(path.join(root, "runtime"));
      await copyFile(wrapper, copiedWrapper);
      const loaderDirectory = path.join(root, "node_modules", "tsx", "dist"); await mkdir(loaderDirectory, { recursive: true });
      await writeFile(path.join(loaderDirectory, "loader.mjs"), "// Synthetic no-op loader, no Java.\n");
      await writeFile(path.join(root, "node_modules", "tsx", "package.json"), JSON.stringify({ name: "tsx", type: "module", exports: "./dist/loader.mjs" }));
      await writeFile(path.join(root, "tests", "acceptance", "phase35-browser-real.mjs"), `import fs from 'node:fs'; import path from 'node:path'; const file=path.join(process.cwd(),'.manager',process.env.MCSM_P35_RUN_ID,'acceptance-report.json'); const report=JSON.parse(fs.readFileSync(file,'utf8')); report.result='BLOCKED'; report.failures=[{phase:'synthetic',code:'SYNTHETIC_RUNNER_FAILURE'}]; fs.writeFileSync(file,JSON.stringify(report)); console.error('SYNTHETIC_STDERR'); process.exitCode=1;`);
      const output = powershell(`. ${literal(copiedWrapper)}; function Get-ItemProperty { [CmdletBinding()]param([string]$LiteralPath,[string]$Name) @{Counter=@('1','Processor')} }; function Get-Counter { [CmdletBinding()]param([string]$Counter,[int]$SampleInterval,[int]$MaxSamples) @{CounterSamples=@(@{Status=0;CookedValue=1})} }; $exitCode=Invoke-P35BrowserAcceptance -ConfirmIsolatedBrowser 6>$null; @{exitCode=$exitCode} | ConvertTo-Json -Compress`);
      expect(JSON.parse(output).exitCode).toBe(1);
      const records = await readdir(path.join(root, ".manager")); expect(records).toHaveLength(1);
      const report = JSON.parse(await readFile(path.join(root, ".manager", records[0]!, "acceptance-report.json"), "utf8"));
      expect(report.failures[0].code).toBe("SYNTHETIC_RUNNER_FAILURE");
      expect(await readdir(path.join(root, "runtime"))).toEqual([]);
    } finally {
      assertOwnedFixture(root); await rm(root, { recursive: true, force: true });
    }
  }, 25_000);
  it("has no user original-server path or system repair command in its executable entrypoints", async () => {
    for (const file of [wrapper, helper]) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/Desktop[\\/]+Game|minecraft服务端|minecraft26\.3/u);
      expect(source).not.toMatch(/lodctr(?:\.exe)?\s+\/(?:R|e)|winmgmt(?:\.exe)?\s+\/(?:resetrepository|salvagerepository)|DISM(?:\.exe)?\s+\/|sfc(?:\.exe)?\s+\//iu);
    }
  });
});
