import type { ServerInfo } from "@mcsm/contracts";
import { DomainError } from "./domain-errors.js";

export function assertJavaEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  const overrides = new Set(["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH"]);
  if (Object.entries(environment).some(([key, value]) => overrides.has(key.toUpperCase()) && value !== undefined && value.length > 0)) {
    throw new DomainError(409, "ACTION_UNAVAILABLE", "Java 环境存在未绑定的启动覆盖", "java-environment-override");
  }
}

/** Detection evidence permits lifecycle only; world mutations retain their own gates. */
export function trustedLifecycle(info: ServerInfo): boolean {
  if (info.type === "vanilla") return true;
  if (info.type !== "paper" && info.type !== "fabric") return false;
  const runtime = /^(?:1\.)?(\d+)/u.exec(info.java.runtimeVersion ?? "");
  if (info.detection.confidence !== "high" || !info.minecraftVersion ||
    info.java.requiredMajor === null || runtime === null || Number(runtime[1]) < info.java.requiredMajor) return false;
  return info.type === "paper"
    ? info.detection.evidence.includes("paperclip-main-class") && info.detection.evidence.includes("jar-version-json")
    : info.detection.evidence.includes("fabric-launcher-main-class") && info.detection.evidence.includes("fabric-execution-binding");
}
