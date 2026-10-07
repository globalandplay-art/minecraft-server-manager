import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";
import { backupDirectoryIdentity } from "./backup-identity.js";
import { readPrivatePropertiesFile } from "./properties-private-file.js";

function mainAttributesEnd(text: string, complete = false): number | null {
  let lineStart = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char !== "\r" && char !== "\n") continue;
    if (char === "\r" && index === text.length - 1 && !complete) return null;
    if (index === lineStart) return index;
    if (char === "\r" && text[index + 1] === "\n") index++;
    lineStart = index + 1;
  }
  return null;
}

/** Read metadata from already descriptor-verified bytes; never load classes. */
export async function launchMetadata(bytes: Buffer, wanted: readonly string[]): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error("invalid-launch-jar")); return; }
      const result = new Map<string, string>(); let count = 0;
      const fail = (reason: unknown) => { zip.close(); reject(reason); };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        if (++count > 100_000) { fail(new Error("launch-jar-entry-limit")); return; }
        if (!wanted.includes(entry.fileName)) { zip.readEntry(); return; }
        const manifest = entry.fileName === "META-INF/MANIFEST.MF";
        if (result.has(entry.fileName) || (!manifest && entry.uncompressedSize > 1024 * 1024)) { fail(new Error("unsafe-launch-metadata")); return; }
        zip.openReadStream(entry, (readError, stream) => {
          if (readError || !stream) { fail(readError); return; }
          const chunks: Buffer[] = []; let length = 0; let finished = false;
          const finish = (text: string) => {
            if (finished) return; finished = true; result.set(entry.fileName, text); stream.destroy(); zip.readEntry();
          };
          stream.on("data", (chunk: Buffer) => {
            if (finished) return;
            if (manifest) {
              const remaining = 64 * 1024 - length;
              chunks.push(chunk.subarray(0, remaining)); length += Math.min(chunk.length, remaining);
              const text = Buffer.concat(chunks).toString("utf8"); const end = mainAttributesEnd(text);
              // Java resolves Main-Class/Class-Path from main attributes only. Signed
              // per-member sections can be megabytes; never inflate them for detection.
              if (end !== null) finish(text.slice(0, end));
              else if (length === 64 * 1024) stream.destroy(new Error("launch-manifest-main-attributes-limit"));
            } else {
              length += chunk.length;
              if (length > 1024 * 1024) stream.destroy(new Error("launch-metadata-limit")); else chunks.push(chunk);
            }
          });
          stream.once("error", (reason) => { if (!finished) fail(reason); });
          stream.once("end", () => finish(Buffer.concat(chunks).toString("utf8")));
        });
      });
      zip.once("end", () => resolve(result)); zip.readEntry();
    });
  });
}
export function manifestField(text: string, field: string): string | undefined {
  const end = mainAttributesEnd(text, true);
  const lines = text.slice(0, end ?? text.length).replace(/\r\n|\r/gu, "\n").replace(/\n /gu, "").split("\n");
  const matches = lines.filter((line) => line.toLowerCase().startsWith(`${field.toLowerCase()}:`));
  if (matches.length > 1) throw new Error("duplicate-launch-manifest-field");
  if (matches.length === 1 && !matches[0]!.startsWith(`${field}: `)) throw new Error("unsupported-launch-manifest-field");
  return matches[0]?.slice(field.length + 2).trim();
}

/** Bind the precise artifacts that the unattended Fabric launcher executes.
 * No directory-wide library scan, no external Class-Path and no dependency download.
 */
export async function captureFabricLaunchBinding(root: string, launcherPath: string) {
  const directories = new Map<string, string>();
  const files: { relative: string; identity: string; sha256: string }[] = [];
  async function directory(relative: string) {
    if (!directories.has(relative)) directories.set(relative, await backupDirectoryIdentity(path.join(root, relative)));
  }
  async function file(relative: string) {
    if (!/^[a-zA-Z0-9_+.\/-]+\.jar$/u.test(relative) || relative.split("/").some((part) => part === ".." || part === "")) throw new Error("unsafe-fabric-dependency");
    const parts = relative.split("/");
    for (let n = 1; n < parts.length; n++) await directory(parts.slice(0, n).join("/"));
    const value = await readPrivatePropertiesFile(path.join(root, relative), 64 * 1024 ** 2);
    files.push({ relative, identity: value.identity, sha256: value.checksum }); return value.bytes;
  }
  await directory("");
  const launcher = await readPrivatePropertiesFile(launcherPath, 64 * 1024 ** 2);
  const metadata = await launchMetadata(launcher.bytes, ["META-INF/MANIFEST.MF", "install.properties", "fabric-server-launch.properties"]);
  if (metadata.has("fabric-server-launch.properties")) throw new Error("fabric-launch-resource-override");
  if (manifestField(metadata.get("META-INF/MANIFEST.MF") ?? "", "Main-Class") !== "net.fabricmc.installer.ServerLauncher") throw new Error("unsupported-fabric-launcher");
  if (manifestField(metadata.get("META-INF/MANIFEST.MF") ?? "", "Class-Path")) throw new Error("external-fabric-classpath");
  const properties = metadata.get("install.properties") ?? "";
  const lines = properties.split(/\r?\n/u).filter((line) => line !== "");
  if (lines.length !== 2 || lines.some((line) => !/^(?:game-version|fabric-loader-version)=[0-9.]+$/u.test(line))) throw new Error("unsupported-fabric-properties");
  const version = /^game-version=([0-9]{1,4}\.[0-9]{1,4}(?:\.[0-9]{1,4})?)$/u.exec(lines.find((line) => line.startsWith("game-version=")) ?? "")?.[1];
  const loader = /^fabric-loader-version=([0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4})$/u.exec(lines.find((line) => line.startsWith("fabric-loader-version=")) ?? "")?.[1];
  if (!version || !loader) throw new Error("unbound-fabric-install");
  await directory("versions");
  if (JSON.stringify((await readdir(path.join(root, "versions"))).sort()) !== JSON.stringify([version])) throw new Error("ambiguous-fabric-versions");
  const server = await launchMetadata(await file(`versions/${version}/server-${version}.jar`), ["META-INF/MANIFEST.MF", "version.json"]);
  const bundle = await launchMetadata(await file(`.fabric/server/${version}-server.jar`), ["META-INF/MANIFEST.MF", "version.json"]);
  const serverVersion = JSON.parse(server.get("version.json") ?? "null") as { id?: unknown; java_version?: unknown } | null;
  const bundleVersion = JSON.parse(bundle.get("version.json") ?? "null") as { id?: unknown; java_version?: unknown } | null;
  if (serverVersion?.id !== version || bundleVersion?.id !== version ||
    !Number.isInteger(serverVersion?.java_version) || Number(serverVersion?.java_version) < 1 || Number(serverVersion?.java_version) > 100 ||
    serverVersion?.java_version !== bundleVersion?.java_version ||
    manifestField(server.get("META-INF/MANIFEST.MF") ?? "", "Main-Class") !== "net.minecraft.server.Main" ||
    manifestField(bundle.get("META-INF/MANIFEST.MF") ?? "", "Main-Class") !== "net.minecraft.bundler.Main") throw new Error("fabric-version-conflict");
  const launch = await launchMetadata(await file(`.fabric/server/fabric-loader-server-${loader}-minecraft-${version}.jar`), ["META-INF/MANIFEST.MF", "fabric-server-launch.properties"]);
  const launchProperties = launch.get("fabric-server-launch.properties");
  if (launchProperties !== undefined && !/^launch\.mainClass=net\.fabricmc\.loader\.impl\.launch\.knot\.KnotServer(?:\r?\n)?$/u.test(launchProperties)) throw new Error("fabric-launch-resource-override");
  const manifest = launch.get("META-INF/MANIFEST.MF") ?? "";
  if (manifestField(manifest, "Main-Class") !== "net.fabricmc.loader.impl.launch.server.FabricServerLauncher") throw new Error("unbound-fabric-loader");
  const dependencies = (manifestField(manifest, "Class-Path") ?? "").split(/\s+/u);
  if (dependencies.length < 1 || dependencies.length > 100 || new Set(dependencies).size !== dependencies.length) throw new Error("unsafe-fabric-classpath");
  for (const dependency of dependencies) {
    if (!dependency.startsWith("../../libraries/")) throw new Error("external-fabric-classpath");
    const depMetadata = await launchMetadata(await file(dependency.slice(6)), ["META-INF/MANIFEST.MF", "fabric-server-launch.properties"]);
    if (depMetadata.has("fabric-server-launch.properties")) throw new Error("fabric-launch-resource-override");
    if (manifestField(depMetadata.get("META-INF/MANIFEST.MF") ?? "", "Class-Path")) throw new Error("external-fabric-classpath");
  }
  for (const [relative, identity] of directories) if (await backupDirectoryIdentity(path.join(root, relative)) !== identity) throw new Error("fabric-directory-changed");
  for (const saved of files) {
    const current = await readPrivatePropertiesFile(path.join(root, saved.relative), 64 * 1024 ** 2);
    if (current.identity !== saved.identity || current.checksum !== saved.sha256) throw new Error("fabric-dependency-changed");
  }
  const currentLauncher = await readPrivatePropertiesFile(launcherPath, 64 * 1024 ** 2);
  if (launcher.identity !== currentLauncher.identity || launcher.checksum !== currentLauncher.checksum) throw new Error("fabric-launcher-changed");
  if (JSON.stringify((await readdir(path.join(root, "versions"))).sort()) !== JSON.stringify([version])) throw new Error("ambiguous-fabric-versions");
  const identitySha256 = createHash("sha256").update(JSON.stringify({ directories: [...directories], files })).digest("hex");
  return { version, requiredMajor: Number(serverVersion.java_version), identitySha256 };
}
