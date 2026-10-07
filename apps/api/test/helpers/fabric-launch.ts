import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchZip } from "./launch-zip.js";

export async function fabricLaunchFixture(root: string) {
  const files: Record<string, Buffer> = {
    "launcher.jar": launchZip({ "META-INF/MANIFEST.MF": "Main-Class: net.fabricmc.installer.ServerLauncher\n", "install.properties": "game-version=26.2\nfabric-loader-version=0.19.5\n" }),
    "versions/26.2/server-26.2.jar": launchZip({ "META-INF/MANIFEST.MF": "Main-Class: net.minecraft.server.Main\n", "version.json": '{"id":"26.2","java_version":25}' }),
    ".fabric/server/26.2-server.jar": launchZip({ "META-INF/MANIFEST.MF": "Main-Class: net.minecraft.bundler.Main\n", "version.json": '{"id":"26.2","java_version":25}' }),
    ".fabric/server/fabric-loader-server-0.19.5-minecraft-26.2.jar": launchZip({ "META-INF/MANIFEST.MF": "Main-Class: net.fabricmc.loader.impl.launch.server.FabricServerLauncher\nClass-Path: ../../libraries/test/loader.jar\n", "fabric-server-launch.properties": "launch.mainClass=net.fabricmc.loader.impl.launch.knot.KnotServer\n" }),
    "libraries/test/loader.jar": launchZip({ "marker": "not executed" })
  };
  for (const [relative, bytes] of Object.entries(files)) {
    const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
  }
  return { jarPath: path.join(root, "launcher.jar"), files };
}
