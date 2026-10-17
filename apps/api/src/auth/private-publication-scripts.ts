import { PRIVATE_ACL_INSPECT_SCRIPT } from "./windows-private-acl.js";
import { nativePathData } from "./windows-native.js";

// Internal fixed payloads only. No execution, ownership, permission or environment switch.
export const PRIVATE_PUBLICATION_NATIVE = `
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
  public static void PublishNew(string source,string target) { if(!MoveFile(source,target,8)) throw new Exception("PRIVATE_PUBLISH_FAILED"); }
}`;
const CREATOR = PRIVATE_PUBLICATION_NATIVE;
const script = (action: string) => `$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${CREATOR}\n'@\n${action}\n@{ok=$true} | ConvertTo-Json -Compress`;
export const buildPrivateCreateScript = (file: string, directory: boolean): string => `$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${CREATOR}\n'@\n${PRIVATE_ACL_INSPECT_SCRIPT}\n$target=${nativePathData(file)}\n[AuthPrivateNative]::Create($target,$${directory})\n@{ok=$true;snapshot=(Read-AuthPrivateAcl $target)} | ConvertTo-Json -Depth 5 -Compress`;
export const buildPrivatePublishNewScript = (stage: string, target: string): string =>
  script(`[AuthPrivateNative]::PublishNew(${nativePathData(stage)},${nativePathData(target)})`);
export const buildPrivatePublishScript = (stage: string, target: string): string =>
  script(`[AuthPrivateNative]::Publish(${nativePathData(stage)},${nativePathData(target)})`);
