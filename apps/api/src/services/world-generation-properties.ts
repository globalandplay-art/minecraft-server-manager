import { createHash } from "node:crypto";
import { DomainError } from "./domain-errors.js";

type CapturedFile = { bytes: Buffer; checksum: string; identity: string };
export type GenerationPropertiesProof = { checksum: string; identity: string; timestampDigest: string | null };
const timestamp = /^#Minecraft server properties(\r?\n)#(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:0[1-9]|[12]\d|3[01]| [1-9]) (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d [A-Za-z][A-Za-z0-9:+-]{0,31} \d{4}(?=\r?\n)/u;
function timestampDigest(bytes: Buffer): string | null {
  const text = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(text, "utf8")) || !timestamp.test(text)) return null;
  return createHash("sha256").update(text.replace(timestamp, "#Minecraft server properties$1#<java-generated-timestamp>")).digest("hex");
}
export function captureGenerationProperties(file: CapturedFile): GenerationPropertiesProof {
  return { checksum: file.checksum, identity: file.identity, timestampDigest: timestampDigest(file.bytes) };
}

/** Only the post-owned-stop generation path supplies this in-memory baseline.
 * All bytes except the recognized second-line Java timestamp remain exact.
 * This does not authorize startup, publication, file replacement or edits. */
export function assertGenerationProperties(file: CapturedFile, expectedChecksum: string, afterStop?: GenerationPropertiesProof): void {
  if (afterStop && (afterStop.checksum !== expectedChecksum || afterStop.identity !== file.identity)) throw invalid();
  if (file.checksum === expectedChecksum) return;
  if (!afterStop?.timestampDigest || timestampDigest(file.bytes) !== afterStop.timestampDigest) throw invalid();
}
const invalid = () => new DomainError(409, "RECOVERY_REQUIRED", "Generation configuration requires inspection", "generation-properties-unverified", true);
