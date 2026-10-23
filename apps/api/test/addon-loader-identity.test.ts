import { link, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ServerInfo } from '@mcsm/contracts';
import type { LocalMinecraftServerAdapter } from '../src/adapters/contract.js';
import type { RegisteredExecutionIdentity } from '../src/infra/runtime-contract.js';
import { captureAddonAdapterIdentity, assertAddonAdapterIdentity, createAddonInstallIdentityScope } from '../src/services/addon-adapter-identity.js';
import * as detection from '../src/services/detection-service.js';
import { backupDirectoryIdentity } from '../src/services/backup-identity.js';
import { readPrivatePropertiesFile } from '../src/services/properties-private-file.js';
import { captureForgeLaunchBinding } from '../src/services/forge-launch-binding.js';
import { captureNeoForgeLaunchBinding } from '../src/services/neoforge-launch-binding.js';
import { forgeLaunchFixture } from './helpers/forge-launch.js';
import { neoForgeLaunchFixture } from './helpers/neoforge-launch.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const loaders = ['forge', 'neoforge'] as const;
async function fixture(type: typeof loaders[number], forgeRelease?: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-addon-loader-')); roots.push(root);
  const javaExecutable = path.join(root, 'java.exe');
  await writeFile(javaExecutable, 'inert test Java identity; never executed');
  let jarPath: string, dependency: string;
  if (type === 'forge') {
    const built = await forgeLaunchFixture(root, { minecraftVersion: '26.3', javaVersion: 25, ...(forgeRelease ? { forgeRelease } : {}) });
    jarPath = built.jarPath; dependency = built.dependency;
  } else {
    const built = await neoForgeLaunchFixture(root);
    jarPath = built.anchor; dependency = built.universal;
  }
  await mkdir(path.join(root, 'mods'));
  const binding = type === 'forge' ? await captureForgeLaunchBinding(root, jarPath) : await captureNeoForgeLaunchBinding(root, jarPath);
  const java = await readPrivatePropertiesFile(javaExecutable), launcher = await readPrivatePropertiesFile(jarPath);
  const registration: RegisteredExecutionIdentity = { rootIdentity: await backupDirectoryIdentity(root),
    javaIdentity: java.identity, javaSha256: java.checksum, launcherIdentity: launcher.identity, launcherSha256: launcher.checksum,
    ...(type === 'forge' ? { forgeExecutionSha256: binding.identitySha256 } : { neoforgeExecutionSha256: binding.identitySha256 }) };
  const info: ServerInfo = { id: 'test', name: 'test', type, minecraftVersion: '26.3', java: { runtimeVersion: '25.0.4', requiredMajor: 25 },
    detection: { confidence: 'high', evidence: type === 'forge' ? ['forge-shim-main-class', 'forge-execution-binding'] :
      ['neoforge-server-descriptor', 'neoforge-execution-binding'], warnings: [] } };
  const adapter = { mode: 'local', serverId: 'test', plan: { rootPath: root, jarPath, javaExecutable, name: 'test', serverInfo: info,
    argv: type === 'forge' ? ['-jar', jarPath, 'nogui'] : 'argv' in binding ? binding.argv : [] },
    getRegisteredExecutionIdentity: () => registration } as unknown as LocalMinecraftServerAdapter;
  return { root, javaExecutable, jarPath, dependency, adapter, registration, info, binding, detect: async () => structuredClone(info) };
}
const rejected = { code: 'ADDON_ADAPTER_UNTRUSTED' };

it.each(loaders)('%s identity binds the complete registered closure without scripts or Minecraft launches', async type => {
  const f = await fixture(type), identity = await captureAddonAdapterIdentity(f.adapter, f.detect);
  expect(identity).toMatchObject({ serverId: 'test', serverType: type, minecraftVersion: '26.3', javaMajor: 25,
    executionBindingSha256: f.binding.identitySha256 });
  expect(JSON.stringify(identity)).not.toContain(f.root);
  expect(JSON.stringify(identity)).not.toContain('argv');
  await expect(assertAddonAdapterIdentity(f.adapter, identity, f.detect)).resolves.toBeUndefined();
});
it.each(loaders)('%s refuses absent/null/wrong/cross-loader registered closure', async type => {
  const f = await fixture(type), field = type === 'forge' ? 'forgeExecutionSha256' : 'neoforgeExecutionSha256';
  for (const value of [undefined, null, '0'.repeat(64)]) {
    const registration = { ...f.registration, [field]: value };
    const adapter = { ...f.adapter, getRegisteredExecutionIdentity: () => registration } as LocalMinecraftServerAdapter;
    await expect(captureAddonAdapterIdentity(adapter, f.detect)).rejects.toMatchObject(rejected);
  }
  const opposite = { ...f.registration, [field]: undefined, [type === 'forge' ? 'neoforgeExecutionSha256' : 'forgeExecutionSha256']: f.binding.identitySha256 };
  await expect(captureAddonAdapterIdentity({ ...f.adapter, getRegisteredExecutionIdentity: () => opposite } as LocalMinecraftServerAdapter, f.detect)).rejects.toMatchObject(rejected);
});
it.each(loaders)('%s rejects a byte-identical dependency replaced after registration', async type => {
  const f = await fixture(type), approved = await captureAddonAdapterIdentity(f.adapter, f.detect);
  const bytes = await readFile(f.dependency); await rename(f.dependency, f.dependency + '.old'); await writeFile(f.dependency, bytes);
  await expect(assertAddonAdapterIdentity(f.adapter, approved, f.detect)).rejects.toMatchObject(rejected);
});
it.each(loaders)('%s rejects a dependency hardlink, then accepts the unchanged restored fixture', async type => {
  const f = await fixture(type); await link(f.dependency, f.dependency + '.alias');
  await expect(captureAddonAdapterIdentity(f.adapter, f.detect)).rejects.toMatchObject(rejected);
  await rm(f.dependency + '.alias');
  await expect(captureAddonAdapterIdentity(f.adapter, f.detect)).resolves.toMatchObject({ serverType: type });
});
it.each(loaders)('%s rejects changed Java bytes and exposes only a fixed error', async type => {
  const f = await fixture(type); await writeFile(f.javaExecutable, 'PRIVATE_MARKER_CHANGED_JAVA');
  try { await captureAddonAdapterIdentity(f.adapter, f.detect); throw new Error('expected identity refusal'); }
  catch (error) {
    expect(error).toMatchObject(rejected);
    expect(String(error)).not.toContain(f.root); expect(String(error)).not.toContain('PRIVATE_MARKER');
  }
});
it.each(loaders)('%s rejects stale detection, unsupported Java and missing trusted lifecycle evidence', async type => {
  const f = await fixture(type);
  const cases: ServerInfo[] = [
    { ...f.info, minecraftVersion: '26.4' },
    { ...f.info, java: { runtimeVersion: '21.0.4', requiredMajor: 25 } },
    { ...f.info, java: { runtimeVersion: '25.0.5', requiredMajor: 25 } },
    { ...f.info, java: { runtimeVersion: '26.0', requiredMajor: 25 } },
    { ...f.info, detection: { ...f.info.detection, evidence: [] } },
    { ...f.info, detection: { ...f.info.detection, confidence: 'medium' } },
    { ...f.info, type: type === 'forge' ? 'neoforge' : 'forge' }
  ];
  for (const detected of cases) await expect(captureAddonAdapterIdentity(f.adapter, async () => detected)).rejects.toMatchObject(rejected);
  const untrustedPlan = { ...f.adapter, plan: { ...f.adapter.plan, serverInfo: { ...f.info,
    detection: { ...f.info.detection, evidence: [] } } } } as LocalMinecraftServerAdapter;
  await expect(captureAddonAdapterIdentity(untrustedPlan, f.detect)).rejects.toMatchObject(rejected);
});
it('rejects an unvalidated Forge release even with a fresh matching complete registration and detected version', async () => {
  const f = await fixture('forge', '66.1.1');
  expect(f.registration.forgeExecutionSha256).toBe((await captureForgeLaunchBinding(f.root, f.jarPath)).identitySha256);
  await expect(captureAddonAdapterIdentity(f.adapter, f.detect)).rejects.toMatchObject(rejected);
});
it('accepts an absent mods directory as an identity observation, never as directory creation', async () => {
  const f = await fixture('neoforge'); await rmdir(path.join(f.root, 'mods'));
  await expect(captureAddonAdapterIdentity(f.adapter, f.detect)).resolves.toMatchObject({ addonRootIdentity: null });
  await expect(readFile(path.join(f.root, 'mods'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('does not execute an altered NeoForge script or accept a non-root descriptor', async () => {
  const f = await fixture('neoforge'); await writeFile(f.jarPath, '@echo off\nexit /b 0\n');
  await expect(captureAddonAdapterIdentity(f.adapter, f.detect)).rejects.toMatchObject(rejected);
  const moved = { ...f.adapter, plan: { ...f.adapter.plan, jarPath: path.join(f.root, 'sub', 'run.bat') } } as LocalMinecraftServerAdapter;
  await expect(captureAddonAdapterIdentity(moved, f.detect)).rejects.toMatchObject(rejected);
});
it.each(loaders)('%s rejects approved identity reuse after launch arguments change', async type => {
  const f = await fixture(type), approved = await captureAddonAdapterIdentity(f.adapter, f.detect);
  const changed = { ...f.adapter, plan: { ...f.adapter.plan, argv: [...f.adapter.plan.argv, '--different-option'] } } as LocalMinecraftServerAdapter;
  await expect(assertAddonAdapterIdentity(changed, approved, f.detect)).rejects.toMatchObject(rejected);
});
it.each(loaders)('%s binds disabled-directory absence and rejects its later creation', async type => {
  const f = await fixture(type), approved = await captureAddonAdapterIdentity(f.adapter, f.detect);
  expect(approved.disabledAddonRootIdentity).toBeNull(); await mkdir(path.join(f.root, 'disabled-mods'));
  await expect(assertAddonAdapterIdentity(f.adapter, approved, f.detect)).rejects.toMatchObject(rejected);
});
it('rejects replacing a previously bound disabled directory with a new empty one', async () => {
  const f = await fixture('forge'), directory = path.join(f.root, 'disabled-mods'); await mkdir(directory);
  const approved = await captureAddonAdapterIdentity(f.adapter, f.detect);
  await rename(directory, directory + '.old'); await mkdir(directory);
  await expect(assertAddonAdapterIdentity(f.adapter, approved, f.detect)).rejects.toMatchObject(rejected);
});
it('operation scope retains cold/warm equality and detects physical replacement after a write boundary', async () => {
  const f = await fixture('neoforge'), approved = await captureAddonAdapterIdentity(f.adapter, f.detect);
  vi.spyOn(detection, 'detectServer').mockImplementation(f.detect);
  const guard = vi.fn(async () => {}), scope = createAddonInstallIdentityScope(f.adapter, approved, guard);
  expect(await scope.capture(f.adapter, captureAddonAdapterIdentity)).toEqual(approved);
  await writeFile(path.join(f.root, 'mods/inert.jar'), 'inert fixture mod');
  expect(await scope.capture(f.adapter, captureAddonAdapterIdentity)).toEqual(approved);
  const bytes = await readFile(f.dependency); await rename(f.dependency, f.dependency + '.old'); await writeFile(f.dependency, bytes);
  await expect(scope.capture(f.adapter, captureAddonAdapterIdentity)).rejects.toMatchObject(rejected);
  await expect(scope.capture(f.adapter, captureAddonAdapterIdentity)).rejects.toMatchObject(rejected);
  expect(guard.mock.calls.length).toBeGreaterThanOrEqual(5);
});
it('scope preserves separate service-injected verifiers and rejects use after explicit disposal', async () => {
  const f = await fixture('neoforge'), approved = await captureAddonAdapterIdentity(f.adapter, f.detect);
  const uploadVerifier = vi.fn(async () => ({ ...approved })), installVerifier = vi.fn(async () => ({ ...approved }));
  const scope = createAddonInstallIdentityScope(f.adapter, approved, async () => {});
  expect(await scope.capture(f.adapter, uploadVerifier)).toEqual(approved);
  expect(await scope.capture(f.adapter, installVerifier)).toEqual(approved);
  expect(uploadVerifier).toHaveBeenCalledTimes(1); expect(installVerifier).toHaveBeenCalledTimes(1);
  scope.dispose(); await expect(scope.capture(f.adapter, installVerifier)).rejects.toMatchObject(rejected);
  expect(installVerifier).toHaveBeenCalledTimes(1);
});
it.each(['adapter', 'root', 'registration'] as const)('scope refuses changed %s before calling its verifier', async mode => {
  const f = await fixture('neoforge'), approved = await captureAddonAdapterIdentity(f.adapter, f.detect);
  const scope = createAddonInstallIdentityScope(f.adapter, approved, async () => {}), delegate = vi.fn(async () => approved);
  const current = mode === 'adapter' ? { ...f.adapter } as LocalMinecraftServerAdapter : f.adapter;
  if (mode === 'root') Object.assign(f.adapter.plan, { rootPath: path.join(f.root, 'other') });
  if (mode === 'registration') Object.assign(f.registration, { neoforgeExecutionSha256: '0'.repeat(64) });
  await expect(scope.capture(current, delegate)).rejects.toMatchObject(rejected);
  expect(delegate).not.toHaveBeenCalled();
});
it('scope rejects owner loss during an awaited verifier and then closes', async () => {
  const f = await fixture('neoforge'), approved = await captureAddonAdapterIdentity(f.adapter, f.detect);
  let denied = false;
  const scope = createAddonInstallIdentityScope(f.adapter, approved, async () => { if (denied) throw new Error('controlled-owner-refusal'); });
  const delegate = vi.fn(async () => { await Promise.resolve(); denied = true; return approved; });
  await expect(scope.capture(f.adapter, delegate)).rejects.toThrow('controlled-owner-refusal');
  denied = false; await expect(scope.capture(f.adapter, delegate)).rejects.toMatchObject(rejected);
  expect(delegate).toHaveBeenCalledTimes(1);
});
