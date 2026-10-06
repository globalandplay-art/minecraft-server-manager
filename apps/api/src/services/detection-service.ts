import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import type { ServerInfo, ServerType } from "@mcsm/contracts";
import yauzl, { type Entry, type ZipFile } from "yauzl";

import { DomainError } from "./domain-errors.js";

const execFileAsync = promisify(execFile);
const MAX_JAR_ENTRIES = 100_000;
const MAX_METADATA_BYTES = 1024 * 1024;
const INTERESTING_ENTRIES = new Set([
  "version.json",
  "META-INF/MANIFEST.MF",
  "META-INF/versions.list",
  "fabric-server-launch.properties"
]);

interface JarMetadata {
  readonly entries: Set<string>;
  readonly content: Map<string, string>;
}

export interface DetectionInput {
  readonly id: string;
  readonly name: string;
  readonly jarPath: string;
  readonly javaExecutable: string;
  /** Canonical registered root; used only to verify a Fabric launcher's bundled server artifact. */
  readonly rootPath?: string;
}

function readEntry(zipFile: ZipFile, entry: Entry, prefixLimit?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const limit = prefixLimit ?? MAX_METADATA_BYTES;
    if (entry.uncompressedSize > MAX_METADATA_BYTES && prefixLimit === undefined) {
      reject(new DomainError(409, "ACTION_UNAVAILABLE", "JAR metadata超过大小限制", "metadata-too-large"));
      return;
    }
    zipFile.openReadStream(entry, (error, stream) => {
      if (error !== null) {
        reject(error);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = () => {
        if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString("utf8")); }
      };
      stream.on("data", (chunk: Buffer) => {
        const remaining = limit - size;
        if (remaining <= 0) {
          finish(); stream.destroy();
          return;
        }
        if (chunk.length > remaining) {
          chunks.push(chunk.subarray(0, remaining)); size += remaining;
          if (prefixLimit !== undefined) { finish(); stream.destroy(); }
          else stream.destroy(new Error("metadata-too-large"));
          return;
        }
        chunks.push(chunk); size += chunk.length;
      });
      stream.once("error", (error) => { if (!settled) { settled = true; reject(error); } });
      stream.once("end", finish);
    });
  });
}

function inspectJar(jarPath: string): Promise<JarMetadata> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      jarPath,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (openError, zipFile) => {
        if (openError !== null || zipFile === undefined) {
          reject(new DomainError(409, "ACTION_UNAVAILABLE", "服务端JAR不是可读取的ZIP", "invalid-jar"));
          return;
        }

        const entries = new Set<string>();
        const content = new Map<string, string>();
        let count = 0;
        let settled = false;
        const fail = (error: unknown) => {
          if (!settled) {
            settled = true;
            zipFile.close();
            reject(error);
          }
        };

        zipFile.once("error", fail);
        zipFile.on("entry", (entry: Entry) => {
          count += 1;
          if (count > MAX_JAR_ENTRIES) {
            fail(new DomainError(409, "ACTION_UNAVAILABLE", "服务端JAR条目过多", "invalid-jar"));
            return;
          }
          entries.add(entry.fileName);
          if (!INTERESTING_ENTRIES.has(entry.fileName)) {
            zipFile.readEntry();
            return;
          }
          void readEntry(zipFile, entry, entry.fileName === "META-INF/MANIFEST.MF" ? 64 * 1024 : undefined)
            .then((value) => {
              content.set(entry.fileName, value);
              zipFile.readEntry();
            })
            .catch(fail);
        });
        zipFile.once("end", () => {
          if (!settled) {
            settled = true;
            resolve({ entries, content });
          }
        });
        zipFile.readEntry();
      }
    );
  });
}

function manifestMainClass(manifest: string | undefined): string | null {
  if (manifest === undefined) {
    return null;
  }
  const unfolded = manifest.replace(/\r?\n /gu, "");
  const match = /^Main-Class:\s*(.+)$/imu.exec(unfolded);
  return match?.[1]?.trim() ?? null;
}

function detectType(metadata: JarMetadata): ServerType {
  const mainClass = manifestMainClass(metadata.content.get("META-INF/MANIFEST.MF"));
  if (
    mainClass === "net.fabricmc.installer.ServerLauncher" ||
    mainClass === "net.fabricmc.loader.impl.launch.knot.KnotServer"
  ) {
    return "fabric";
  }
  if (
    mainClass === "io.papermc.paperclip.Main" ||
    mainClass === "com.destroystokyo.paperclip.Paperclip"
  ) {
    return "paper";
  }
  if (
    metadata.entries.has("version.json") &&
    (mainClass === "net.minecraft.bundler.Main" || mainClass === "net.minecraft.server.Main")
  ) {
    return "vanilla";
  }
  return "unknown";
}

async function fabricBundledVersion(rootPath: string): Promise<{ version: string; requiredMajor: number } | null> {
  const versionsPath = path.join(rootPath, "versions");
  try {
    const root = await lstat(rootPath);
    const versions = await lstat(versionsPath);
    if (!root.isDirectory() || root.isSymbolicLink() || !versions.isDirectory() || versions.isSymbolicLink() ||
      (process.platform === "win32" ? await realpath(versionsPath).then((v) => v.toLowerCase()) : await realpath(versionsPath)) !==
      (process.platform === "win32" ? path.resolve(versionsPath).toLowerCase() : path.resolve(versionsPath))) return null;
    const names = await readdir(versionsPath);
    if (names.length > 100) return null;
    const candidates: { version: string; requiredMajor: number }[] = [];
    for (const name of names) {
      if (!/^[0-9]{1,4}\.[0-9]{1,4}(?:\.[0-9]{1,4})?(?:-[a-zA-Z0-9.-]{1,32})?$/u.test(name)) continue;
      const directory = path.join(versionsPath, name);
      const file = path.join(directory, `server-${name}.jar`);
      let directoryInfo;
      try { directoryInfo = await lstat(directory); } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
        return null;
      }
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() ||
        (process.platform === "win32" ? await realpath(directory).then((v) => v.toLowerCase()) : await realpath(directory)) !==
        (process.platform === "win32" ? path.resolve(directory).toLowerCase() : path.resolve(directory))) return null;
      let fileInfo;
      try { fileInfo = await lstat(file); } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
        return null;
      }
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.nlink !== 1) return null;
      const metadata = await inspectJar(file);
      const main = manifestMainClass(metadata.content.get("META-INF/MANIFEST.MF"));
      const parsed = parseVersionMetadata(metadata.content.get("version.json"));
      if (main !== "net.minecraft.server.Main") return null;
      if (parsed.minecraftVersion === name && parsed.requiredMajor !== null) {
        candidates.push({ version: parsed.minecraftVersion, requiredMajor: parsed.requiredMajor });
      }
    }
    return candidates.length === 1 ? candidates[0]! : null;
  } catch { return null; }
}

export function parseVersionMetadata(raw: string | undefined): {
  minecraftVersion: string | null;
  requiredMajor: number | null;
} {
  if (raw === undefined) {
    return { minecraftVersion: null, requiredMajor: null };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      return { minecraftVersion: null, requiredMajor: null };
    }
    const record = value as Record<string, unknown>;
    const java = record.java_version;
    const major =
      typeof java === "number"
        ? java
        : typeof java === "object" && java !== null
          ? (java as Record<string, unknown>).majorVersion
          : null;
    return {
      minecraftVersion:
        typeof record.id === "string" && record.id.length <= 64 ? record.id : null,
      requiredMajor:
        typeof major === "number" && Number.isInteger(major) && major > 0 && major <= 100
          ? major
          : null
    };
  } catch {
    return { minecraftVersion: null, requiredMajor: null };
  }
}

async function probeJava(javaExecutable: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(javaExecutable, ["-version"], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      encoding: "utf8"
    });
    const match = /version\s+"([^"]{1,63})"/iu.exec(`${stderr}\n${stdout}`);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function detectServer(input: DetectionInput): Promise<ServerInfo> {
  const [metadata, runtimeVersion] = await Promise.all([
    inspectJar(input.jarPath),
    probeJava(input.javaExecutable)
  ]);
  const type = detectType(metadata);
  let version = parseVersionMetadata(metadata.content.get("version.json"));
  const evidence = ["jar-manifest"];
  if (metadata.entries.has("version.json")) {
    evidence.push("jar-version-json");
  }
  if (metadata.entries.has("META-INF/versions.list")) {
    evidence.push("jar-versions-list");
  }
  const mainClass = manifestMainClass(metadata.content.get("META-INF/MANIFEST.MF"));
  if (type === "paper" && (mainClass === "io.papermc.paperclip.Main" || mainClass === "com.destroystokyo.paperclip.Paperclip")) {
    evidence.push("paperclip-main-class");
  }
  if (type === "fabric" && (mainClass === "net.fabricmc.installer.ServerLauncher" || mainClass === "net.fabricmc.loader.impl.launch.knot.KnotServer")) {
    evidence.push("fabric-launcher-main-class");
    if (input.rootPath !== undefined) {
      const bundled = await fabricBundledVersion(input.rootPath);
      if (bundled) {
        version = { minecraftVersion: bundled.version, requiredMajor: bundled.requiredMajor };
        evidence.push("fabric-version-artifact");
      }
    }
  }
  const warnings: string[] = [];
  if (type === "unknown") {
    warnings.push("无法可靠识别服务端类型；仅提供只读信息");
  } else if (type !== "vanilla") {
    warnings.push("Phase 2 仅允许 Vanilla 生命周期操作");
  }
  if (runtimeVersion === null) {
    warnings.push("无法验证配置的 Java 运行时版本");
  }
  if (version.minecraftVersion === null) {
    warnings.push("JAR metadata 未提供可靠的 Minecraft 版本");
  }

  return {
    id: input.id,
    name: input.name,
    type,
    minecraftVersion: version.minecraftVersion,
    java: { runtimeVersion, requiredMajor: version.requiredMajor },
    detection: {
      confidence: type === "unknown" ? "low" : version.minecraftVersion === null ? "medium" : "high",
      evidence,
      warnings
    }
  };
}
