import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { isLocalAdapter, type LocalMinecraftServerAdapter } from "../adapters/contract.js";
import { DomainError } from "./domain-errors.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { detectServer } from "./detection-service.js";
import { captureFabricLaunchBinding } from "./fabric-launch-binding.js";
import { captureForgeLaunchBinding } from "./forge-launch-binding.js";
import { assertNeoForgeEnvironment, captureNeoForgeLaunchBinding, createScopedNeoForgeBindingReader } from "./neoforge-launch-binding.js";
import { assertJavaEnvironment, trustedLifecycle } from "./trusted-lifecycle.js";

const denied = () => new DomainError(409, "ADDON_ADAPTER_UNTRUSTED", "服务端身份未能安全核验", "addon-adapter-untrusted");
const normal = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
const contained = (parent: string, child: string) => {
  const rel = path.relative(normal(parent), normal(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

export interface AddonAdapterIdentity {
  readonly schemaVersion: 1;
  readonly serverId: string;
  readonly serverType: "paper" | "fabric" | "forge" | "neoforge";
  readonly minecraftVersion: string;
  readonly javaMajor: number;
  readonly requiredJavaMajor: number;
  readonly rootIdentity: string;
  readonly addonRootIdentity: string | null;
  readonly launchJarIdentity: string;
  readonly launchJarSha256: string;
  /** Private dependency-closure evidence for the new loader adapters; not write authorization. */
  readonly executionBindingSha256?: string;
  readonly launchPlanSha256?: string;
  readonly disabledAddonRootIdentity?: string | null;
  readonly identitySha256: string;
}

/** Bind an addon operation to the registered local launcher and its current physical files. */
export async function captureAddonAdapterIdentity(
  adapter: LocalMinecraftServerAdapter,
  detect: typeof detectServer = detectServer
): Promise<AddonAdapterIdentity> {
  const reader = createScopedNeoForgeBindingReader();
  try { return await captureWithReader(adapter, detect, reader); }
  finally { reader.dispose(); }
}

/** Backend-only context, never an identity/authorization cache or an HTTP option. */
export interface AddonIdentityScope {
  capture(adapter: LocalMinecraftServerAdapter, delegate: typeof captureAddonAdapterIdentity): Promise<AddonAdapterIdentity>;
  dispose(): void;
}

export function createAddonInstallIdentityScope(adapter: LocalMinecraftServerAdapter, approved: AddonAdapterIdentity,
  assertOwner: () => Promise<void>): AddonIdentityScope {
  const reader = createScopedNeoForgeBindingReader();
  const root = path.resolve(adapter.plan.rootPath), serverId = adapter.serverId;
  const registration = JSON.stringify(adapter.getRegisteredExecutionIdentity?.());
  const expected = JSON.stringify(approved);
  let disposed = false;
  const dispose = () => { disposed = true; reader.dispose(); };
  const bound = (current: LocalMinecraftServerAdapter) => {
    if (disposed || current !== adapter || current.serverId !== serverId || current.plan.serverInfo.type !== 'neoforge' ||
      approved.serverType !== 'neoforge' || approved.serverId !== serverId || path.resolve(current.plan.rootPath) !== root ||
      !registration || JSON.stringify(current.getRegisteredExecutionIdentity?.()) !== registration) throw denied();
  };
  return {
    async capture(current, delegate) {
      try {
        bound(current); await assertOwner(); bound(current);
        // Each service retains its own injected verifier; only the genuine builtin shares pure facts.
        const identity = delegate === captureAddonAdapterIdentity
          ? await captureWithReader(current, detectServer, reader) : await delegate(current);
        bound(current); await assertOwner(); bound(current);
        if (JSON.stringify(identity) !== expected) throw denied();
        return identity;
      } catch (error) { dispose(); throw error; }
    }, dispose
  };
}

async function captureWithReader(adapter: LocalMinecraftServerAdapter, detect: typeof detectServer,
  readNeoForgeBinding: typeof captureNeoForgeLaunchBinding): Promise<AddonAdapterIdentity> {
  if (!isLocalAdapter(adapter)) throw denied();
  const { plan } = adapter;
  const type = plan.serverInfo.type;
  if (type !== "paper" && type !== "fabric" && type !== "forge" && type !== "neoforge") throw denied();
  if (![plan.jarPath, plan.rootPath, plan.javaExecutable].every(value => typeof value === "string" && value.length > 0)) throw denied();
  const extendedLoader = type === "forge" || type === "neoforge";
  const launcher = path.resolve(plan.jarPath), root = path.resolve(plan.rootPath);
  if (!contained(root, launcher) || launcher === root || (type === "neoforge"
    ? path.basename(launcher) !== "run.bat" || path.dirname(launcher) !== root
    : !path.basename(launcher).toLowerCase().endsWith(".jar"))) throw denied();
  try {
    const rootIdentity = await backupDirectoryIdentity(root);
    const input = { id: adapter.serverId, name: plan.name, jarPath: launcher, javaExecutable: plan.javaExecutable, rootPath: root };
    const detected = await (detect === detectServer ? detectServer(input, readNeoForgeBinding) : detect(input));
    if (detected.type !== type || detected.detection.confidence !== "high" || !detected.minecraftVersion ||
      !detected.java.runtimeVersion || detected.java.requiredMajor === null ||
      detected.detection.warnings.some((warning) => /metadata 未提供可靠/u.test(warning)) ||
      detected.minecraftVersion !== plan.serverInfo.minecraftVersion || detected.java.requiredMajor !== plan.serverInfo.java.requiredMajor) throw denied();
    const registration = adapter.getRegisteredExecutionIdentity?.();
    if (!registration || registration.rootIdentity !== rootIdentity) throw denied();
    let executionBindingSha256: string | undefined;
    let launchPlanSha256 = '';
    let disabledAddonRootIdentity: string | null = null;
    if (extendedLoader) {
      // Reuse lifecycle's verified installed dependency closure; never execute an anchor/script.
      assertJavaEnvironment();
      if (!trustedLifecycle(plan.serverInfo) || !trustedLifecycle(detected) ||
        detected.minecraftVersion !== "26.3" || detected.java.requiredMajor !== 25 ||
        detected.java.runtimeVersion !== plan.serverInfo.java.runtimeVersion) throw denied();
      if (!Array.isArray(plan.argv) || plan.argv.length < 1 || plan.argv.length > 128 ||
        plan.argv.some(value => typeof value !== 'string' || value.length > 128 * 1024 || /[\u0000\r\n]/u.test(value)) ||
        Buffer.byteLength(JSON.stringify(plan.argv)) > 512 * 1024) throw denied();
      launchPlanSha256 = createHash('sha256').update(JSON.stringify(plan.argv)).digest('hex');
      try { disabledAddonRootIdentity = await backupDirectoryIdentity(path.join(root, 'disabled-mods')); }
      catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') disabledAddonRootIdentity = null; else throw error; }
      if (type === "forge") {
        if (!registration.forgeExecutionSha256) throw denied();
        const binding = await captureForgeLaunchBinding(root, launcher);
        if (binding.forgeVersion !== "26.3-66.1.0" || binding.version !== detected.minecraftVersion ||
          binding.requiredMajor !== detected.java.requiredMajor || !registration.forgeExecutionSha256 ||
          binding.identitySha256 !== registration.forgeExecutionSha256) throw denied();
        executionBindingSha256 = binding.identitySha256;
      } else {
        if (!registration.neoforgeExecutionSha256) throw denied();
        assertNeoForgeEnvironment();
        const binding = await readNeoForgeBinding(root, launcher);
        if (binding.version !== detected.minecraftVersion || binding.requiredMajor !== detected.java.requiredMajor ||
          !registration.neoforgeExecutionSha256 || binding.identitySha256 !== registration.neoforgeExecutionSha256) throw denied();
        executionBindingSha256 = binding.identitySha256;
      }
    }
    if (type === "fabric") {
      if (!registration.fabricExecutionSha256 || (await captureFabricLaunchBinding(root, launcher)).identitySha256 !== registration.fabricExecutionSha256) throw denied();
    }
    const match = /^(?:1\.)?(\d+)/u.exec(detected.java.runtimeVersion);
    const javaMajor = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(javaMajor) || javaMajor < detected.java.requiredMajor) throw denied();
    const jar = await readPrivatePropertiesFile(launcher, 64 * 1024 * 1024);
    if (jar.identity !== registration.launcherIdentity || jar.checksum !== registration.launcherSha256) throw denied();
    if (await backupDirectoryIdentity(root) !== rootIdentity) throw denied();
    const addonRoot = path.join(root, type === "paper" ? "plugins" : "mods");
    let addonRootIdentity: string | null;
    try { addonRootIdentity = await backupDirectoryIdentity(addonRoot); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") addonRootIdentity = null;
      else throw error;
    }
    const javaInfo = await lstat(plan.javaExecutable);
    if (!javaInfo.isFile() || javaInfo.isSymbolicLink() || javaInfo.nlink !== 1 ||
      normal(await realpath(plan.javaExecutable)) !== normal(path.resolve(plan.javaExecutable))) throw denied();
    const javaFile = await readPrivatePropertiesFile(plan.javaExecutable, 128 * 1024 * 1024);
    if (javaFile.identity !== registration.javaIdentity || javaFile.checksum !== registration.javaSha256) throw denied();
    if (extendedLoader) {
      const finalBinding = type === "forge" ? await captureForgeLaunchBinding(root, launcher) : await readNeoForgeBinding(root, launcher);
      if (finalBinding.identitySha256 !== executionBindingSha256 || await backupDirectoryIdentity(root) !== rootIdentity) throw denied();
      const finalJava = await readPrivatePropertiesFile(plan.javaExecutable, 128 * 1024 * 1024);
      if (finalJava.identity !== javaFile.identity || finalJava.checksum !== javaFile.checksum) throw denied();
      if (createHash('sha256').update(JSON.stringify(plan.argv)).digest('hex') !== launchPlanSha256) throw denied();
      if (addonRootIdentity === null) {
        try { await lstat(addonRoot); throw denied(); }
        catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error; }
      } else if (await backupDirectoryIdentity(addonRoot) !== addonRootIdentity) throw denied();
      const disabled = path.join(root, 'disabled-mods');
      if (disabledAddonRootIdentity === null) {
        try { await lstat(disabled); throw denied(); }
        catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error; }
      } else if (await backupDirectoryIdentity(disabled) !== disabledAddonRootIdentity) throw denied();
    }
    const tuple = { schemaVersion: 1 as const, serverId: adapter.serverId, serverType: type,
      minecraftVersion: detected.minecraftVersion, javaMajor, requiredJavaMajor: detected.java.requiredMajor,
      rootIdentity, addonRootIdentity, launchJarIdentity: jar.identity, launchJarSha256: jar.checksum,
      ...(executionBindingSha256 ? { executionBindingSha256, launchPlanSha256, disabledAddonRootIdentity } : {}) };
    const identitySha256 = createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
    return { ...tuple, identitySha256 };
  } catch (error) {
    if (error instanceof DomainError && error.code === "ADDON_ADAPTER_UNTRUSTED") throw error;
    throw denied();
  }
}

/** Refuse the operation if any registered evidence or physical root/JAR binding changed. */
export async function assertAddonAdapterIdentity(
  adapter: LocalMinecraftServerAdapter,
  approved: AddonAdapterIdentity,
  detect: typeof detectServer = detectServer
): Promise<void> {
  const current = await captureAddonAdapterIdentity(adapter, detect);
  if (JSON.stringify(current) !== JSON.stringify(approved)) throw denied();
}
