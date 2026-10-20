import { WINDOWS_OWNER_RETENTION_NATIVE } from "./windows-owner-retention-native.js";
import { AuthCoreError } from "./password.js";
import { nativePathData } from "./windows-native.js";

/** Private constructor capability only. Never a DTO, environment option or log payload. */
export interface NativeOwnerRetentionProof {
  root: string;
  nodePid: number;
  processIdentity: string;
  directoryHandle: string;
  fileHandle: string;
  directoryIdentity: string;
  fileIdentity: string;
}

// Separate read-only duplication/validation primitive: no Acquire/Release changes,
// remote handle close, Job manipulation, ACL mutation or pathname-based lock reopen.


/** Called only by the held-owner capability; returns no parsed/observable native data. */
export function wrapWithNativeOwnerRetention(script: string, proof: NativeOwnerRetentionProof): string {
  const integer = /^[1-9][0-9]{0,18}$/u;
  if (!Number.isSafeInteger(proof.nodePid) || proof.nodePid <= 0 || proof.nodePid > 0x7fffffff ||
    !integer.test(proof.directoryHandle) || !integer.test(proof.fileHandle) ||
    !/^[0-9A-F]{16}$/u.test(proof.processIdentity) || !/^[0-9A-F]{40}$/u.test(proof.directoryIdentity) ||
    !/^[0-9A-F]{40}$/u.test(proof.fileIdentity) || proof.root.length > 4096 || proof.root.includes("\0")) {
    throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
  }
  return `$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\nAdd-Type -TypeDefinition @'\n${WINDOWS_OWNER_RETENTION_NATIVE}\n'@\n` +
    `[WhitelistOwnerRetention]::Retain(${nativePathData(proof.root)},${proof.nodePid},'${proof.processIdentity}',` +
    `${proof.directoryHandle},${proof.fileHandle},'${proof.directoryIdentity}','${proof.fileIdentity}')\n${script}`;
}
