const REDACTED = "[REDACTED]";

const SENSITIVE_KEY = /(?:pass(?:word|phrase)?|passwd|pwd|token|secret|authorization|credential|rcon[._-]?password)/i;
const INLINE_SECRET = /(\b(?:pass(?:word|phrase)?|passwd|pwd|token|secret|authorization|credential|rcon[._-]?password)\b["']?\s*(?::|=)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi;
const BEARER = /(\bBearer\s+)[A-Za-z0-9._~+\/-]+=*/gi;

export interface Redactor {
  redactText(value: string): string;
  redactValue<T>(value: T): T;
  publicError(error: unknown): string;
}

export interface RedactorOptions {
  secrets?: () => readonly (string | null | undefined)[];
}

function replaceAllLiteral(value: string, secret: string): string {
  if (secret.length === 0) return value;
  return value.split(secret).join(REDACTED);
}

export function createRedactor(options: RedactorOptions = {}): Redactor {
  const redactText = (value: string): string => {
    let redacted = value.replace(BEARER, `$1${REDACTED}`);
    redacted = redacted.replace(INLINE_SECRET, `$1${REDACTED}`);
    for (const secret of options.secrets?.() ?? []) {
      if (secret) redacted = replaceAllLiteral(redacted, secret);
    }
    return redacted;
  };

  const visit = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
    if (typeof value === "string") return redactText(value);
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (Buffer.isBuffer(value)) return Buffer.from(redactText(value.toString("utf8")), "utf8");
    const cached = seen.get(value);
    if (cached !== undefined) return cached;

    if (Array.isArray(value)) {
      const result: unknown[] = [];
      seen.set(value, result);
      for (const entry of value) result.push(visit(entry, seen));
      return result;
    }

    const result: Record<string, unknown> = {};
    seen.set(value, result);
    for (const [key, entry] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : visit(entry, seen);
    }
    return result;
  };

  return {
    redactText,
    redactValue<T>(value: T): T {
      return visit(value, new WeakMap()) as T;
    },
    publicError(): string {
      return "运行时操作失败。";
    }
  };
}

export { REDACTED };
