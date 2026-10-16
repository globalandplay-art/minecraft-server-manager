/** Inert acceptance payload only. No paths, writes, sleeps, network or external input. */
export const envelopeWriterPayload = "$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n@{version=1;proof='whitelist-owner-envelope-inert'} | ConvertTo-Json -Compress";
export function validEnvelopeWriterPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "proof,version") return false;
  const row = value as Record<string, unknown>;
  return row.version === 1 && row.proof === "whitelist-owner-envelope-inert";
}
