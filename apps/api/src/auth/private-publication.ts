import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { AuthCoreError } from "./password.js";
import { WindowsPrivateAclVerifier, PRIVATE_ACL_INSPECT_SCRIPT } from "./windows-private-acl.js";
import { nativePathData, runWindowsNativeScript } from "./windows-native.js";
import { readPrivatePropertiesFile } from "../services/properties-private-file.js";

const fail = () => new AuthCoreError("AUTH_PRIVATE_UNSAFE");
const CREATOR = `
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
public static class AuthPrivateNative {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int Length; public IntPtr Descriptor; public int Inherit; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateDirectoryW")] static extern bool CreateDirectory(string path,ref SA sa);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")] static extern IntPtr CreateFile(string path,uint access,uint share,ref SA sa,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="MoveFileExW")] static extern bool MoveFile(string source,string target,uint flags);
  public static void Create(string path,bool directory) {
    string sid=WindowsIdentity.GetCurrent().User.Value; string flags=directory?"OICI":"";
    var raw=new RawSecurityDescriptor("O:"+sid+"G:"+sid+"D:P(A;"+flags+";FA;;;"+sid+")(A;"+flags+";FA;;;SY)(A;"+flags+";FA;;;BA)");
    var bytes=new byte[raw.BinaryLength]; raw.GetBinaryForm(bytes,0); IntPtr pointer=Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes,0,pointer,bytes.Length); var sa=new SA{Length=Marshal.SizeOf(typeof(SA)),Descriptor=pointer,Inherit=0};
      if(directory) { if(!CreateDirectory(path,ref sa)) throw new Exception("PRIVATE_CREATE_FAILED"); }
      else { IntPtr handle=CreateFile(path,0xc0000000,0,ref sa,1,0x00200000,IntPtr.Zero); if(handle==new IntPtr(-1)) throw new Exception("PRIVATE_CREATE_FAILED"); CloseHandle(handle); }
    } finally { Marshal.FreeHGlobal(pointer); }
  }
  public static void Publish(string source,string target) { if(!MoveFile(source,target,9)) throw new Exception("PRIVATE_PUBLISH_FAILED"); }
}`;
const script = (action: string) => `$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${CREATOR}\n'@\n${action}\n@{ok=$true} | ConvertTo-Json -Compress`;
async function execute(action: string): Promise<unknown> {
  const output = await runWindowsNativeScript(script(action));
  if (typeof output !== "object" || output === null || !("ok" in output) || output.ok !== true) throw fail();
  return output;
}
export async function privateEntryExists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false; throw fail(); }
}
/** Only creates a new protected object; never repairs or recursively changes existing ACLs. */
export async function createPrivateEntry(file: string, directory: boolean, acl: WindowsPrivateAclVerifier): Promise<void> {
  if (await privateEntryExists(file)) throw fail();
  const output = await runWindowsNativeScript(`$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${CREATOR}\n'@\n${PRIVATE_ACL_INSPECT_SCRIPT}\n$target=${nativePathData(file)}\n[AuthPrivateNative]::Create($target,$${directory})\n@{ok=$true;snapshot=(Read-AuthPrivateAcl $target)} | ConvertTo-Json -Depth 5 -Compress`);
  if (typeof output !== "object" || output === null || !("snapshot" in output) || !("ok" in output) || output.ok !== true) throw fail();
  acl.verifyNativeSnapshot(output.snapshot);
  const info = await lstat(file);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size !== 0)) throw fail();
}
export async function writePrivateNew(file: string, bytes: Buffer, acl: WindowsPrivateAclVerifier): Promise<void> {
  if (bytes.length > 4096) throw fail();
  await createPrivateEntry(file, false, acl);
  const before = await lstat(file);
  const handle = await open(file, "r+");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== 0 || opened.dev !== before.dev || opened.ino !== before.ino) throw fail();
    await handle.writeFile(bytes); await handle.sync();
  } finally { await handle.close(); }
  await acl.verify(file);
  const check = await readPrivatePropertiesFile(file, 4096);
  try { if (!check.bytes.equals(bytes)) throw fail(); } finally { check.bytes.fill(0); }
}
export async function publishPrivateStage(stage: string, target: string): Promise<void> {
  if (path.dirname(stage) !== path.dirname(target)) throw fail();
  await execute(`[AuthPrivateNative]::Publish(${nativePathData(stage)},${nativePathData(target)})`);
}
/** Identity/checksum before deleting only the writer's fixed private journal/stage. */
export async function deleteVerifiedPrivate(file: string, checksum: string, acl: WindowsPrivateAclVerifier): Promise<void> {
  await acl.verify(file); const actual = await readPrivatePropertiesFile(file, 4096);
  try { if (actual.checksum !== checksum) throw fail(); await unlink(file); }
  finally { actual.bytes.fill(0); }
}
