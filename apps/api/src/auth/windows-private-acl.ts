import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { AuthCoreError } from "./password.js";

export type PrivateAclSnapshot = {
  userSid: string; ownerSid: string; protected: boolean;
  aces: { sid: string; kind: "allow" | "deny"; mask: number; flags: number }[];
};
const fail = () => new AuthCoreError("AUTH_PRIVATE_UNSAFE");
const SID = /^S-1-(?:\d+-){1,14}\d+$/u;
const FULL_CONTROL = 0x1f01ff;

/** Conservative effective-rights gate: reject ambiguous ACEs and all non-trusted Allows. */
export function validatePrivateAcl(value: unknown, frozenUserSid?: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw fail();
  const snapshot = value as PrivateAclSnapshot;
  if (!SID.test(snapshot.userSid) || snapshot.ownerSid !== snapshot.userSid ||
    (frozenUserSid !== undefined && frozenUserSid !== snapshot.userSid) || snapshot.protected !== true ||
    !Array.isArray(snapshot.aces) || snapshot.aces.length === 0 || snapshot.aces.length > 64) throw fail();
  const trusted = new Set([snapshot.userSid, "S-1-5-18", "S-1-5-32-544"]);
  let userAllows = 0;
  for (const ace of snapshot.aces) {
    if (typeof ace !== "object" || ace === null || !SID.test(ace.sid) || !["allow", "deny"].includes(ace.kind) ||
      !Number.isSafeInteger(ace.mask) || ace.mask < 0 || ace.mask > 0xffffffff || !Number.isSafeInteger(ace.flags) ||
      // Only ordinary effective ACEs, optionally propagating to child objects/containers.
      ace.flags < 0 || ace.flags > 3 || (ace.flags & ~3) !== 0) throw fail();
    if (ace.kind === "deny" && ace.mask !== 0) throw fail();
    if (ace.kind === "allow") {
      if (!trusted.has(ace.sid) && ace.mask !== 0) throw fail();
      if (ace.sid === snapshot.userSid) userAllows |= ace.mask;
    }
  }
  if ((userAllows & FULL_CONTROL) !== FULL_CONTROL) throw fail();
  return snapshot.userSid;
}

export const PRIVATE_ACL_INSPECT_SCRIPT = `function Read-AuthPrivateAcl([string]$target) {
$acl=Get-Acl -LiteralPath $target
$raw=[Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
$rows=@()
foreach($ace in $raw.DiscretionaryAcl) {
  if($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback) { throw 'ambiguous-acl' }
  $kind=switch($ace.AceQualifier) { 'AccessAllowed' { 'allow' } 'AccessDenied' { 'deny' } default { throw 'ambiguous-acl' } }
  $rows+=@{sid=$ace.SecurityIdentifier.Value;kind=$kind;mask=([long]$ace.AccessMask -band 4294967295);flags=[int]$ace.AceFlags}
}
@{userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;ownerSid=$raw.Owner.Value;protected=$acl.AreAccessRulesProtected;aces=@($rows)}
}`;
async function inspectWindowsAcls(files: readonly string[]): Promise<unknown[]> {
  if (process.platform !== "win32") throw fail();
  if (files.length < 1 || files.length > 8) throw fail();
  // Path is UTF8 base64 data, never executable PowerShell text. No shell, profile or password input.
  const encodedPaths = Buffer.from(JSON.stringify(files), "utf8").toString("base64");
  const script = `$ErrorActionPreference='Stop'
${PRIVATE_ACL_INSPECT_SCRIPT}
$targets=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPaths}')) | ConvertFrom-Json
$snapshots=@(foreach($target in $targets) { Read-AuthPrivateAcl $target })
ConvertTo-Json -InputObject @($snapshots) -Depth 5 -Compress`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const output = await new Promise<string>((resolve, reject) => {
    execFile(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024, encoding: "utf8" },
      (error, stdout) => error ? reject(fail()) : resolve(stdout));
  });
  try {
    const snapshots: unknown = JSON.parse(output.replace(/^\uFEFF/u, ""));
    if (!Array.isArray(snapshots) || snapshots.length !== files.length) throw fail();
    return snapshots;
  } catch { throw fail(); }
}
const inspectWindowsAcl = async (file: string): Promise<unknown> => (await inspectWindowsAcls([file]))[0];

export class WindowsPrivateAclVerifier {
  #userSid: string | undefined;
  constructor(private readonly inspect: (file: string) => Promise<unknown> = inspectWindowsAcl) {}
  async verify(file: string): Promise<string> {
    try {
      const snapshot = await this.inspect(file);
      return this.verifyNativeSnapshot(snapshot);
    } catch { throw fail(); }
  }
  /** Trusted native helper response; creation validates its actual ACL before further writes. */
  verifyNativeSnapshot(snapshot: unknown): string {
    this.#userSid = validatePrivateAcl(snapshot, this.#userSid);
    const value = snapshot as PrivateAclSnapshot;
    const canonical = { userSid: value.userSid, ownerSid: value.ownerSid, protected: value.protected,
      aces: value.aces.map((ace) => ({ sid: ace.sid, kind: ace.kind, mask: ace.mask, flags: ace.flags })) };
    return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  }
  async verifyMany(files: readonly string[]): Promise<string[]> {
    if (files.length < 1 || files.length > 8 || files.some((file) => typeof file !== "string" || file.length > 4096) ||
      new Set(files.map((file) => process.platform === "win32" ? file.toLowerCase() : file)).size !== files.length) throw fail();
    try {
      const snapshots = this.inspect === inspectWindowsAcl ? await inspectWindowsAcls(files) : await Promise.all(files.map((file) => this.inspect(file)));
      if (snapshots.length !== files.length) throw fail();
      return snapshots.map((snapshot) => this.verifyNativeSnapshot(snapshot));
    } catch { throw fail(); }
  }
}
