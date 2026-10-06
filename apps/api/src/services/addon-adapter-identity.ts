import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { isLocalAdapter, type LocalMinecraftServerAdapter } from "../adapters/contract.js";
import { DomainError } from "./domain-errors.js";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";
import { detectServer } from "./detection-service.js";

const denied = () => new DomainError(409, "ADDON_ADAPTER_UNTRUSTED", "服务端身份未能安全核验", "addon-adapter-untrusted");
const normal = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
const contained = (parent: string, child: string) => {
  const rel = path.relative(normal(parent), normal(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

export interface AddonAdapterIdentity {
  readonly schemaVersion: 1;
  readonly serverId: string;
  readonly serverType: "paper" | "fabric";
  readonly minecraftVersion: string;
  readonly javaMajor: number;
  readonly requiredJavaMajor: number;
  readonly rootIdentity: string;
  readonly addonRootIdentity: string | null;
  readonly launchJarIdentity: string;
  readonly launchJarSha256: string;
  readonly identitySha256: string;
}

/** Bind an addon operation to the registered local launcher and its current physical files. */
export async function captureAddonAdapterIdentity(
  adapter: LocalMinecraftServerAdapter,
  detect: typeof detectServer = detectServer
): Promise<AddonAdapterIdentity> {
  if (!isLocalAdapter(adapter)) throw denied();
  const { plan } = adapter;
  const type = plan.serverInfo.type;
  if (type !== "paper" && type !== "fabric") throw denied();
  const launcher = path.resolve(plan.jarPath), root = path.resolve(plan.rootPath);
  if (!contained(root, launcher) || launcher === root || !path.basename(launcher).toLowerCase().endsWith(".jar")) throw denied();
  try {
    const rootIdentity = await backupDirectoryIdentity(root);
    const detected = await detect({ id: adapter.serverId, name: plan.name, jarPath: launcher, javaExecutable: plan.javaExecutable, rootPath: root });
    if (detected.type !== type || detected.detection.confidence !== "high" || !detected.minecraftVersion ||
      !detected.java.runtimeVersion || detected.java.requiredMajor === null ||
      detected.detection.warnings.some((warning) => /metadata 未提供可靠/u.test(warning)) ||
      detected.minecraftVersion !== plan.serverInfo.minecraftVersion || detected.java.requiredMajor !== plan.serverInfo.java.requiredMajor) throw denied();
    const registration = adapter.getRegisteredExecutionIdentity?.();
    if (!registration || registration.rootIdentity !== rootIdentity) throw denied();
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
    const tuple = { schemaVersion: 1 as const, serverId: adapter.serverId, serverType: type,
      minecraftVersion: detected.minecraftVersion, javaMajor, requiredJavaMajor: detected.java.requiredMajor,
      rootIdentity, addonRootIdentity, launchJarIdentity: jar.identity, launchJarSha256: jar.checksum };
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
