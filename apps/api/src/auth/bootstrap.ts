import path from "node:path";
import { CredentialReader } from "./credential-reader.js";
import { PasswordVerifier } from "./password.js";
import { privateEntryExists } from "./private-publication.js";
import { PrivateAuthAudit } from "./audit.js";
import { HttpAuthentication } from "./http-auth.js";

/** Explicit opt-in only; private credentials may never fall back to the legacy surface. */
export async function initializeHttpAuthentication(managerRoot: string, setting: string | undefined): Promise<HttpAuthentication | undefined> {
  if (setting !== undefined && !["off", "required"].includes(setting)) throw new Error("AUTH_PROFILE_INVALID");
  for (const file of ["credential.pending.json", "credential.staged.json"]) {
    if (await privateEntryExists(path.join(managerRoot, "auth", file))) throw new Error("AUTH_HTTP_INTEGRATION_PENDING");
  }
  if (setting !== "required") {
    if (await privateEntryExists(path.join(managerRoot, "auth", "credential.json"))) throw new Error("AUTH_HTTP_INTEGRATION_PENDING");
    return undefined;
  }
  const reader = await CredentialReader.open(managerRoot);
  const verifier = new PasswordVerifier(await reader.read());
  const audit = await PrivateAuthAudit.open(managerRoot);
  return new HttpAuthentication(verifier, audit);
}
