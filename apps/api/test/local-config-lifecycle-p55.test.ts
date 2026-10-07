import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ServerInfo } from "@mcsm/contracts";
import { loadLocalRegistrations } from "../src/config/local-config.js";
import { fabricLaunchFixture } from "./helpers/fabric-launch.js";
import { launchZip } from "./helpers/launch-zip.js";
const detect = vi.hoisted(() => vi.fn());
vi.mock("../src/services/detection-service.js", () => ({ detectServer: detect }));
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); detect.mockReset(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(type: "paper" | "fabric") {
  const parent = await mkdtemp(path.join(tmpdir(), "p55-registration-")); roots.push(parent);
  const root = path.join(parent, "server"), manager = path.join(parent, "manager");
  await mkdir(root); await mkdir(manager);
  if (type === "fabric") await fabricLaunchFixture(root);
  else await writeFile(path.join(root, "launcher.jar"), launchZip({ "META-INF/MANIFEST.MF": "Main-Class: io.papermc.paperclip.Main\n", "version.json": '{"id":"26.2","java_version":25}' }));
  const java = path.join(parent, "java.exe"); await writeFile(java, "not executed; detector mocked");
  await writeFile(path.join(root, "eula.txt"), "eula=true\n");
  await writeFile(path.join(root, "server.properties"), "server-ip=127.0.0.1\nserver-port=25055\n");
  await writeFile(path.join(manager, "config.json"), JSON.stringify({ schemaVersion: 1, servers: [{ id: "p55", name: "P55", root, javaExecutable: java, jarFile: "launcher.jar", jvmArgs: ["-Xms512M", "-Xmx1G"], serverArgs: ["nogui"] }] }));
  const info: ServerInfo = { id: "p55", name: "P55", type, minecraftVersion: "26.2", java: { runtimeVersion: "25.0.4", requiredMajor: 25 }, detection: { confidence: "high", evidence: type === "paper" ? ["paperclip-main-class", "jar-version-json"] : ["fabric-launcher-main-class", "fabric-execution-binding"], warnings: [] } };
  detect.mockImplementation(async () => structuredClone(info));
  return { root, manager, info, load: async () => (await loadLocalRegistrations(manager))[0]! };
}
it.each(["paper", "fabric"] as const)("revalidates supported %s with bound roots, Java, launcher and accepted EULA", async (type) => {
  const f = await fixture(type); const registration = await f.load();
  await expect(registration.revalidateBeforeStart()).resolves.toBeUndefined();
  await writeFile(path.join(f.root, "eula.txt"), "eula=false\n");
  await expect(registration.revalidateBeforeStart()).rejects.toMatchObject({ reason: "eula-not-accepted" });
});
it.each(["launcher", "bundle-bytes", "bundle-inode", "library"])("refuses changed %s after Fabric registration", async (change) => {
  const f = await fixture("fabric"); const registration = await f.load();
  const relative = change === "launcher" ? "launcher.jar" : change === "library" ? "libraries/test/loader.jar" : ".fabric/server/26.2-server.jar";
  const file = path.join(f.root, relative), bytes = await readFile(file);
  if (change === "bundle-inode") { await rename(file, file + ".old"); await writeFile(file, bytes); }
  else { bytes.writeUInt16LE(7, bytes.length - 2); await writeFile(file, Buffer.concat([bytes, Buffer.from("changed")])); }
  await expect(registration.revalidateBeforeStart()).rejects.toMatchObject({ reason: "execution-identity-changed" });
});
it.each(["unknown", "medium", "missing-java", "missing-version", "missing-required", "low-java", "missing-evidence"])("refuses %s lifecycle evidence", async (change) => {
  const f = await fixture("paper");
  if (change === "unknown") f.info.type = "unknown";
  if (change === "medium") f.info.detection.confidence = "medium";
  if (change === "missing-java") f.info.java.runtimeVersion = null;
  if (change === "missing-version") f.info.minecraftVersion = null;
  if (change === "missing-required") f.info.java.requiredMajor = null;
  if (change === "low-java") f.info.java.runtimeVersion = "21";
  if (change === "missing-evidence") f.info.detection.evidence = [];
  const registration = await f.load();
  await expect(registration.revalidateBeforeStart()).rejects.toMatchObject({ code: "VERSION_INCOMPATIBLE" });
});
it("refuses Java option overrides before registration probes and before startup probes", async () => {
  const f = await fixture("paper"); const registration = await f.load(); detect.mockClear();
  vi.stubEnv("JAVA_TOOL_OPTIONS", " ");
  await expect(f.load()).rejects.toMatchObject({ reason: "java-environment-override" });
  await expect(registration.revalidateBeforeStart()).rejects.toMatchObject({ reason: "java-environment-override" });
  expect(detect).not.toHaveBeenCalled();
});
