// Synthetic wrapper tests: mock the only Node runner; never execute Java or read sources.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
test('dot-source preserves PreflightOnly and custom Node; combined consent never invokes a real runner', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'p55-host-boundary-'));
  try {
    const directory = path.join(root, 'tests', 'acceptance'); await mkdir(directory, { recursive: true });
    for (const name of ['p55-real-addons-acceptance.ps1', 'p44-real-properties-acceptance.ps1']) await copyFile(path.join(workspace, 'tests', 'acceptance', name), path.join(directory, name));
    await mkdir(path.join(root, '.manager')); await mkdir(path.join(root, 'runtime'));
    const loader = path.join(root, 'node_modules', 'tsx', 'dist'); await mkdir(loader, { recursive: true }); await writeFile(path.join(loader, 'loader.mjs'), '// mock runner, never invoked\n');
    const script = `
      . ${quote(path.join(directory, 'p55-real-addons-acceptance.ps1'))} -Kind paper -PreflightOnly -ConfirmIsolatedAddons -NodeExecutable ${quote(process.execPath)}
      $preservedFlag=$PreflightOnly; $preservedNode=$NodeExecutable
      function Get-Command { param($Name,$CommandType,$ErrorAction) @{Source=${quote(process.execPath)}} }
      function Get-HostPreconditions { @{perflibRegistry=@{result='pass'};getCounter=@{result='pass'}} }
      $script:sourceCalls=@(); $script:realCalls=0
      function Invoke-AcceptanceRunner {
        param($Node,$Workspace,$EntryPoint)
        if ([IO.Path]::GetFileName($EntryPoint) -ne 'phase55-source-preflight.mjs') { $script:realCalls++; throw 'Unexpected real runner' }
        $script:sourceCalls+=@{node=$Node;entry=$EntryPoint}
        $manager=[IO.Path]::Combine($Workspace,'.manager',$env:MCSM_P55_RUN_ID)
        [IO.File]::WriteAllText([IO.Path]::Combine($manager,'source-manifest.json'),' {"manifestSha256":"synthetic","files":[]} ',[Text.UTF8Encoding]::new($false))
        return 0
      }
      $exitCode=Invoke-P55AddonAcceptance -Kind $Kind -PreflightOnly:$PreflightOnly -ConfirmIsolatedAddons:$ConfirmIsolatedAddons -NodeExecutable $NodeExecutable 6>$null
      @{flag=[bool]$preservedFlag;node=$preservedNode;exitCode=$exitCode;sourceCalls=$script:sourceCalls;realCalls=$script:realCalls} | ConvertTo-Json -Compress -Depth 8
    `;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(result.stdout.trim());
    assert.equal(evidence.flag, true); assert.equal(evidence.node, process.execPath); assert.equal(evidence.exitCode, 0);
    assert.equal(evidence.realCalls, 0); assert.equal(evidence.sourceCalls.length, 1); assert.equal(evidence.sourceCalls[0].node, process.execPath);
    assert.deepEqual(await readdir(path.join(root, 'runtime')), []);
    const runs = await readdir(path.join(root, '.manager')); assert.equal(runs.length, 1);
    const report = JSON.parse(await readFile(path.join(root, '.manager', runs[0], 'acceptance-report.json'), 'utf8'));
    assert.equal(report.result, 'NOT_RUN'); assert.equal(report.isolation.originalUserWorldTouched, false);
  } finally {
    assert(path.resolve(root).startsWith(path.join(path.resolve(tmpdir()), 'p55-host-boundary-')));
    await rm(root, { recursive: true, force: true });
  }
});
