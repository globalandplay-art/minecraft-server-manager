import { createRedactor } from "../infra/runtime/redactor.js";

export type CrashEvidence = { id: string; source: "latest-log" | "crash-report"; text: string; truncated: boolean };
export type CrashFinding = { code: (typeof rules)[number]["code"]; confidence: "possible"; title: string; guidance: string;
  evidence: Array<{ sourceId: string; excerptLine: number; snippet: string }> };
const rules = [
  { code: "out-of-memory", pattern: /(?:java\.lang\.)?OutOfMemoryError\b/, title: "可能存在内存分配失败", guidance: "核对完整异常和JVM内存设置；RSS不是JVM堆大小，不自动调整内存。" },
  { code: "port-bind", pattern: /(?:FAILED TO BIND TO PORT|java\.net\.BindException: Address already in use)/, title: "可能存在端口绑定冲突", guidance: "确认配置端口及其占用者身份；不要终止未知进程。" },
  { code: "java-version", pattern: /(?:UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime)/, title: "可能存在Java版本不兼容", guidance: "核对服务端及模组要求与实际Java版本。" },
  { code: "watchdog", pattern: /(?:A single server tick took|Watching Server|Server Watchdog\/ERROR)/, title: "可能存在服务器线程停滞", guidance: "检查线程堆栈和近期负载；此匹配不证明模组或硬件是根因。" },
  { code: "dependency", pattern: /(?:net\.fabricmc\.loader\.impl\.FormattedException:|Missing or unsupported mandatory dependencies|UnknownDependencyException:)/, title: "可能存在扩展依赖不兼容", guidance: "核对报告中的依赖及Loader版本；不自动安装或移除扩展。" }
] as const;

/** Redact before matching/cropping; return only bounded evidence, never a certain diagnosis. */
export function analyzeCrashEvidence(input: readonly CrashEvidence[], secrets: readonly string[]) {
  if (input.length > 4 || input.some((item) => Buffer.byteLength(item.text, "utf8") > 64 * 1024) ||
    secrets.length > 64 || secrets.some((secret) => secret.length > 4096)) throw new Error("crash-analysis-input-limit");
  const normalize = (value: string) => value.replace(/\u001b\[[0-9;]*[A-Za-z]/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
  const redactor = createRedactor({ secrets: () => [...secrets, ...secrets.map(normalize)] });
  let incomplete = input.some((item) => item.truncated);
  const findings = new Map<string, CrashFinding>();
  for (const item of input) {
    // Privacy boundary: partial sources cannot safely match a full known secret.
    // Keep coverage metadata, but derive no finding or raw excerpt from them.
    if (item.truncated) continue;
    if (item.text.split(/\r\n|\n|\r/u).some((line) => Buffer.byteLength(line, "utf8") > 4096)) incomplete = true;
    // Whole-text passes protect multiline secrets and credentials rejoined by normalization.
    const sanitized = redactor.redactText(normalize(redactor.redactText(item.text)));
    const lines = sanitized.split(/\r\n|\n|\r/u);
    if (lines.length > 2048) incomplete = true;
    for (const [index, raw] of lines.entries()) {
      if (index >= 2048) break;
      if (Buffer.byteLength(raw, "utf8") > 4096) { incomplete = true; continue; }
      const text = redactor.redactText(normalize(redactor.redactText(raw)))
        .replace(/\bfile:[\\/][^\r\n]*/giu, "[PATH]")
        .replace(/\b[A-Za-z]:[\\/][^\r\n]*/gu, "[PATH]")
        .replace(/\\\\[^\r\n]*/gu, "[PATH]")
        .replace(/(^|[\s("=])\/[^\s][^\r\n]*/gu, "$1[PATH]")
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, "[URL]");
      for (const rule of rules) {
        if (!rule.pattern.test(text)) continue;
        let finding = findings.get(rule.code);
        if (!finding) { finding = { code: rule.code, confidence: "possible", title: rule.title, guidance: rule.guidance, evidence: [] }; findings.set(rule.code, finding); }
        if (finding.evidence.length < 2) finding.evidence.push({ sourceId: item.id, excerptLine: index + 1, snippet: text.slice(0, 1000) });
      }
    }
  }
  return { findings: [...findings.values()], incomplete,
    conclusion: findings.size ? "possible-causes" as const : incomplete ? "insufficient-evidence" as const : "no-rule-match" as const };
}
