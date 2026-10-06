const MAX_METADATA_BYTES = 256 * 1024;
const ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

export type FabricAddonMetadata = {
  id: string;
  name: string;
  version: string;
  loader: "fabric";
  environment: "*" | "server" | "client";
  minecraftConstraint: string[] | null;
  compatibility: "unknown";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !CONTROL_CHARACTERS.test(value);
}

/** Parse bounded Fabric metadata as inert JSON. No code or compatibility rules are evaluated. */
export function parseFabricAddonMetadata(raw: Uint8Array): FabricAddonMetadata | null {
  if (raw.byteLength > MAX_METADATA_BYTES) return null;

  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== 1 ||
    typeof parsed.id !== "string" || !ID_PATTERN.test(parsed.id) ||
    !isBoundedText(parsed.version)) return null;

  const name = parsed.name === undefined ? parsed.id : parsed.name;
  if (!isBoundedText(name)) return null;

  const environment = parsed.environment === undefined ? "*" : parsed.environment;
  if (environment !== "*" && environment !== "server" && environment !== "client") return null;

  let minecraftConstraint: string[] | null = null;
  const depends = parsed.depends;
  if (isRecord(depends)) {
    const constraint = depends.minecraft;
    if (typeof constraint === "string" && isBoundedText(constraint)) {
      minecraftConstraint = [constraint];
    } else if (Array.isArray(constraint) && constraint.length <= 16 && constraint.every(isBoundedText)) {
      minecraftConstraint = constraint;
    }
  }

  return {
    id: parsed.id,
    name,
    version: parsed.version,
    loader: "fabric",
    environment,
    minecraftConstraint,
    compatibility: "unknown",
  };
}
