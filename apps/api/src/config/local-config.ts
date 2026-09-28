import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import type { ValidatedLaunchPlan } from "../infra/runtime-contract.js";
import { detectServer } from "../services/detection-service.js";
import { DomainError } from "../services/domain-errors.js";
import {
  EULA_LIMIT,
  SERVER_PROPERTIES_LIMIT,
  parseProperties,
  readBoundedRegularFile
} from "./properties.js";

const CONFIG_LIMIT_BYTES = 1024 * 1024;
const SERVER_KEYS = new Set([
  "id",
  "name",
  "root",
  "javaExecutable",
  "jarFile",
  "jvmArgs",
  "serverArgs"
]);

export interface ValidatedRegistration {
  readonly plan: ValidatedLaunchPlan;
  readonly revalidateBeforeStart: () => Promise<void>;
}

export interface RawServerConfig {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly javaExecutable: string;
  readonly jarFile: string;
  readonly jvmArgs: string[];
  readonly serverArgs: string[];
}

function configError(reason: string): DomainError {
  return new DomainError(500, "INTERNAL_ERROR", "本地配置无效", reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function memoryBytes(argument: string): number | null {
  const match = /^-Xm[sx](\d+)([KMG])$/u.exec(argument);
  if (match === null) return null;
  const amount = Number(match[1]);
  const multiplier = match[2] === "G" ? 1024 ** 3 : match[2] === "M" ? 1024 ** 2 : 1024;
  const bytes = amount * multiplier;
  return Number.isSafeInteger(bytes) ? bytes : null;
}

function parseJvmArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((entry) => typeof entry === "string")) {
    throw configError("jvmArgs-invalid");
  }
  const initial = value.find((entry) => entry.startsWith("-Xms"));
  const maximum = value.find((entry) => entry.startsWith("-Xmx"));
  if (initial === undefined || maximum === undefined || initial === maximum) {
    throw configError("jvmArgs-invalid");
  }
  const initialBytes = memoryBytes(initial);
  const maximumBytes = memoryBytes(maximum);
  const lowerBound = 64 * 1024 * 1024;
  const upperBound = 64 * 1024 * 1024 * 1024;
  if (
    initialBytes === null ||
    maximumBytes === null ||
    initialBytes < lowerBound ||
    maximumBytes > upperBound ||
    initialBytes > maximumBytes
  ) {
    throw configError("jvmArgs-invalid");
  }
  return [initial, maximum];
}

function parseServerArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "nogui") {
    throw configError("serverArgs-invalid");
  }
  return ["nogui"];
}

function parseServer(value: unknown): RawServerConfig {
  if (!isRecord(value) || Object.keys(value).some((key) => !SERVER_KEYS.has(key))) {
    throw configError("server-fields-invalid");
  }
  const { id, name, root, javaExecutable, jarFile } = value;
  if (
    typeof id !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62})$/u.test(id) ||
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 128 ||
    typeof root !== "string" ||
    typeof javaExecutable !== "string" ||
    typeof jarFile !== "string" ||
    path.basename(jarFile) !== jarFile ||
    jarFile.includes(":") ||
    !jarFile.toLowerCase().endsWith(".jar")
  ) {
    throw configError("server-values-invalid");
  }
  return {
    id,
    name,
    root,
    javaExecutable,
    jarFile,
    jvmArgs: parseJvmArguments(value.jvmArgs),
    serverArgs: parseServerArguments(value.serverArgs)
  };
}

async function loadRawConfig(configPath: string): Promise<RawServerConfig[]> {
  let raw: string;
  try {
    raw = await readBoundedRegularFile(configPath, CONFIG_LIMIT_BYTES, "本地配置文件");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  return parseLocalConfigDocument(raw);
}

export function parseLocalConfigDocument(raw: string): RawServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configError("config-json-invalid");
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).some((key) => key !== "schemaVersion" && key !== "servers") ||
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.servers) ||
    parsed.servers.length > 1000
  ) {
    throw configError("config-shape-invalid");
  }
  const servers = parsed.servers.map(parseServer);
  if (new Set(servers.map((server) => server.id)).size !== servers.length) {
    throw configError("duplicate-server-id");
  }
  return servers;
}

function isUnc(input: string): boolean {
  return input.startsWith("\\\\") || input.startsWith("//");
}

const normalized = (input: string) =>
  process.platform === "win32" ? path.resolve(input).toLowerCase() : path.resolve(input);

async function assertCanonicalPath(
  input: string,
  expected: "file" | "directory",
  reason: string
): Promise<string> {
  if (!path.isAbsolute(input) || isUnc(input)) {
    throw configError(`${reason}-not-local-absolute`);
  }
  const metadata = await lstat(input);
  if (
    metadata.isSymbolicLink() ||
    (expected === "file" ? !metadata.isFile() : !metadata.isDirectory())
  ) {
    throw configError(`${reason}-invalid-type`);
  }
  const canonical = await realpath(input);
  if (normalized(canonical) !== normalized(input)) {
    throw configError(`${reason}-linked`);
  }
  return canonical;
}

async function validatePaths(config: RawServerConfig): Promise<{
  rootPath: string;
  javaExecutable: string;
  jarPath: string;
}> {
  if (
    path.basename(config.jarFile) !== config.jarFile ||
    config.jarFile.includes(":") ||
    !config.jarFile.toLowerCase().endsWith(".jar")
  ) {
    throw configError("jar-name-invalid");
  }
  const rootPath = await assertCanonicalPath(config.root, "directory", "root");
  const javaExecutable = await assertCanonicalPath(
    config.javaExecutable,
    "file",
    "java-executable"
  );
  const jarCandidate = path.resolve(rootPath, config.jarFile);
  const relative = path.relative(rootPath, jarCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw configError("jar-outside-root");
  }
  const jarPath = await assertCanonicalPath(jarCandidate, "file", "jar");
  return { rootPath, javaExecutable, jarPath };
}

async function readServerState(rootPath: string): Promise<{
  eulaAccepted: boolean;
  properties: Map<string, string>;
}> {
  const [eulaText, propertiesText] = await Promise.all([
    readBoundedRegularFile(path.join(rootPath, "eula.txt"), EULA_LIMIT, "EULA文件"),
    readBoundedRegularFile(
      path.join(rootPath, "server.properties"),
      SERVER_PROPERTIES_LIMIT,
      "server.properties"
    )
  ]);
  return {
    eulaAccepted: parseProperties(eulaText).get("eula")?.toLowerCase() === "true",
    properties: parseProperties(propertiesText)
  };
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : fallback;
}

async function validateRegistration(config: RawServerConfig): Promise<ValidatedRegistration> {
  const paths = await validatePaths(config);
  const state = await readServerState(paths.rootPath);
  const serverInfo = await detectServer({
    id: config.id,
    name: config.name,
    jarPath: paths.jarPath,
    javaExecutable: paths.javaExecutable
  });
  const configuredHost = state.properties.get("server-ip") ?? "";
  if (!["", "127.0.0.1", "localhost"].includes(configuredHost)) {
    serverInfo.detection.warnings.push("Minecraft 当前可能监听非本地地址");
  } else if (configuredHost === "") {
    serverInfo.detection.warnings.push("Minecraft server-ip 为空，可能监听所有网络接口");
  }
  const statusPort = parsePort(state.properties.get("server-port"), 25_565);

  const runtimeMajor = (version: string | null): number | null => {
    if (version === null) return null;
    const match = /^(?:1\.)?(\d+)/u.exec(version);
    return match === null ? null : Number(match[1]);
  };
  const configuredMajor = runtimeMajor(serverInfo.java.runtimeVersion);
  if (
    serverInfo.java.requiredMajor !== null &&
    configuredMajor !== null &&
    configuredMajor < serverInfo.java.requiredMajor
  ) {
    serverInfo.detection.warnings.push("配置的 Java 版本低于该服务端 metadata 要求");
  }

  const revalidateBeforeStart = async () => {
    const currentPaths = await validatePaths(config);
    if (
      normalized(currentPaths.rootPath) !== normalized(paths.rootPath) ||
      normalized(currentPaths.javaExecutable) !== normalized(paths.javaExecutable) ||
      normalized(currentPaths.jarPath) !== normalized(paths.jarPath)
    ) {
      throw new DomainError(409, "ACTION_UNAVAILABLE", "启动文件在注册后发生变化", "file-changed");
    }
    const currentState = await readServerState(paths.rootPath);
    if (!currentState.eulaAccepted) {
      throw new DomainError(409, "ACTION_UNAVAILABLE", "Minecraft EULA 尚未接受", "eula-not-accepted");
    }
    const currentPort = parsePort(currentState.properties.get("server-port"), 25_565);
    const currentHost = currentState.properties.get("server-ip") ?? "";
    if (currentPort !== statusPort || currentHost !== configuredHost) {
      throw new DomainError(
        409,
        "ACTION_UNAVAILABLE",
        "Minecraft 监听配置在注册后发生变化，请重启管理器重新加载",
        "configuration-changed"
      );
    }
    const currentDetection = await detectServer({
      id: config.id,
      name: config.name,
      jarPath: paths.jarPath,
      javaExecutable: paths.javaExecutable
    });
    if (
      currentDetection.type !== serverInfo.type ||
      currentDetection.minecraftVersion !== serverInfo.minecraftVersion ||
      currentDetection.java.runtimeVersion !== serverInfo.java.runtimeVersion ||
      currentDetection.java.requiredMajor !== serverInfo.java.requiredMajor
    ) {
      throw new DomainError(
        409,
        "ACTION_UNAVAILABLE",
        "Java 或服务端JAR在注册后发生变化，请重启管理器重新检测",
        "launch-target-changed"
      );
    }
    const currentMajor = runtimeMajor(currentDetection.java.runtimeVersion);
    if (
      currentDetection.type !== "vanilla" ||
      currentMajor === null ||
      (currentDetection.java.requiredMajor !== null && currentMajor < currentDetection.java.requiredMajor)
    ) {
      throw new DomainError(
        409,
        "VERSION_INCOMPATIBLE",
        "服务端类型或 Java 版本不满足启动要求",
        "version-incompatible"
      );
    }
  };

  const plan: ValidatedLaunchPlan = {
    id: config.id,
    name: config.name,
    rootPath: paths.rootPath,
    javaExecutable: paths.javaExecutable,
    jarPath: paths.jarPath,
    argv: [...config.jvmArgs, "-jar", paths.jarPath, ...config.serverArgs],
    statusEndpoint: { host: "127.0.0.1", port: statusPort },
    eulaAccepted: state.eulaAccepted,
    serverInfo,
    getRconConnection: async () => {
      const current = await readServerState(paths.rootPath);
      if (current.properties.get("enable-rcon")?.toLowerCase() !== "true") {
        return null;
      }
      const password = current.properties.get("rcon.password") ?? "";
      if (password.length === 0 || Buffer.byteLength(password, "utf8") > 1024) {
        return null;
      }
      return {
        host: "127.0.0.1",
        port: parsePort(current.properties.get("rcon.port"), 25_575),
        password
      };
    }
  };
  return { plan, revalidateBeforeStart };
}

export async function loadLocalRegistrations(managerRoot: string): Promise<ValidatedRegistration[]> {
  const configs = await loadRawConfig(path.join(managerRoot, "config.json"));
  return Promise.all(configs.map(validateRegistration));
}
