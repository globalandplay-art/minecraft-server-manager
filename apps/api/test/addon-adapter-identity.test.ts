import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { LocalMinecraftServerAdapter } from "../src/adapters/contract.js";
import type { ServerInfo } from "@mcsm/contracts";
import { backupDirectoryIdentity } from "../src/services/backup-identity.js";
import { readPrivatePropertiesFile } from "../src/services/properties-private-file.js";
import { assertAddonAdapterIdentity, captureAddonAdapterIdentity } from "../src/services/addon-adapter-identity.js";
import { captureFabricLaunchBinding } from "../src/services/fabric-launch-binding.js";
import { fabricLaunchFixture } from "./helpers/fabric-launch.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const info: ServerInfo = { id: "test", name: "test", type: "fabric", minecraftVersion: "26.2",
  java: { runtimeVersion: "25.0.1", requiredMajor: 25 },
  detection: { confidence: "high", evidence: ["fabric-launcher-main-class", "fabric-version-artifact"], warnings: [] } };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mcsm-addon-identity-")); roots.push(root);
  const javaExecutable = path.join(root, "java.exe"), jarPath = path.join(root, "launcher.jar");
  await writeFile(javaExecutable, "verified java placeholder"); await fabricLaunchFixture(root);
  await mkdir(path.join(root, "mods"));
  const java = await readPrivatePropertiesFile(javaExecutable), jar = await readPrivatePropertiesFile(jarPath);
  const registered = { rootIdentity: await backupDirectoryIdentity(root), javaIdentity: java.identity, javaSha256: java.checksum,
    launcherIdentity: jar.identity, launcherSha256: jar.checksum, fabricExecutionSha256: (await captureFabricLaunchBinding(root, jarPath)).identitySha256 };
  const adapter = { mode: "local", serverId: "test", plan: { rootPath: root, jarPath, javaExecutable, name: "test", serverInfo: info },
    getRegisteredExecutionIdentity: () => registered } as unknown as LocalMinecraftServerAdapter;
  return { root, jarPath, adapter, registered, detect: async () => structuredClone(info) };
}

it("binds Paper/Fabric evidence to registered root, Java and launcher file identities", async () => {
  const f = await fixture(); const identity = await captureAddonAdapterIdentity(f.adapter, f.detect);
  expect(identity).toMatchObject({ serverId: "test", serverType: "fabric", minecraftVersion: "26.2", javaMajor: 25,
    requiredJavaMajor: 25, identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  expect(JSON.stringify(identity)).not.toContain(f.root);
  await expect(assertAddonAdapterIdentity(f.adapter, identity, f.detect)).resolves.toBeUndefined();
});

it("rejects replaced launcher bytes and stale or ambiguous detected identity", async () => {
  const f = await fixture(); const identity = await captureAddonAdapterIdentity(f.adapter, f.detect);
  await writeFile(f.jarPath, "replacement launcher bytes");
  await expect(captureAddonAdapterIdentity(f.adapter, f.detect)).rejects.toMatchObject({ code: "ADDON_ADAPTER_UNTRUSTED" });
  await expect(assertAddonAdapterIdentity(f.adapter, identity, f.detect)).rejects.toMatchObject({ code: "ADDON_ADAPTER_UNTRUSTED" });
  const wrong = async () => ({ ...structuredClone(info), type: "paper" as const });
  await expect(captureAddonAdapterIdentity(f.adapter, wrong)).rejects.toMatchObject({ code: "ADDON_ADAPTER_UNTRUSTED" });
});

it("refuses missing registration identity and unreliable version/runtime evidence", async () => {
  const f = await fixture();
  const unbound = { ...f.adapter, getRegisteredExecutionIdentity: undefined } as LocalMinecraftServerAdapter;
  await expect(captureAddonAdapterIdentity(unbound, f.detect)).rejects.toMatchObject({ code: "ADDON_ADAPTER_UNTRUSTED" });
  const unknown = async () => ({ ...structuredClone(info), minecraftVersion: null, detection: { ...info.detection, confidence: "medium" as const } });
  await expect(captureAddonAdapterIdentity(f.adapter, unknown)).rejects.toMatchObject({ code: "ADDON_ADAPTER_UNTRUSTED" });
});
it("refuses absent or null Fabric execution binding rather than upgrading a historical registration", async () => {
  const f = await fixture();
  const missing = { ...f.registered, fabricExecutionSha256: undefined };
  const adapter = { ...f.adapter, getRegisteredExecutionIdentity: () => missing } as LocalMinecraftServerAdapter;
  await expect(captureAddonAdapterIdentity(adapter, f.detect)).rejects.toMatchObject({ code: "ADDON_ADAPTER_UNTRUSTED" });
  const nulled = { ...f.adapter, getRegisteredExecutionIdentity: () => ({ ...f.registered, fabricExecutionSha256: null }) } as LocalMinecraftServerAdapter;
  await expect(captureAddonAdapterIdentity(nulled, f.detect)).rejects.toMatchObject({ code: "ADDON_ADAPTER_UNTRUSTED" });
});
