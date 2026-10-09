import { lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nativePathData, runWindowsNativeScript } from "../../../src/auth/windows-native.js";

/** Test-only mutation of an already private fresh fixture; owner/group remain untouched. */
export async function addEveryoneReadForTest(file: string): Promise<void> {
  const relative = path.relative(tmpdir(), file).replaceAll("\\", "/");
  if (!/^mcsm-(?:private-writer|acl-negative-diagnostic)-[A-Za-z0-9]+(?:\/manager\/auth)?\/(?:credential|empty)\.json$/u.test(relative)) throw new Error("unsafe-fixture-path");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error("unsafe-fixture-file");
  const script = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
public static class FixtureDaclOnly {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")] static extern IntPtr CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetKernelObjectSecurity(IntPtr file,uint information,byte[] descriptor);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void AddRead(string path) {
    IntPtr file=CreateFile(path,0x60080,3,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
    if(file==new IntPtr(-1)) throw new Exception("FIXTURE_OPEN_FAILED");
    try {
      string sid=WindowsIdentity.GetCurrent().User.Value;
      var raw=new RawSecurityDescriptor("D:P(A;;FA;;;"+sid+")(A;;FA;;;SY)(A;;FA;;;BA)(A;;FR;;;WD)");
      var bytes=new byte[raw.BinaryLength]; raw.GetBinaryForm(bytes,0);
      if(!SetKernelObjectSecurity(file,0x80000004,bytes)) throw new Exception("FIXTURE_DACL_FAILED:"+Marshal.GetLastWin32Error().ToString());
    } finally { CloseHandle(file); }
  }
}
'@
[FixtureDaclOnly]::AddRead(${nativePathData(file)})
@{ok=$true} | ConvertTo-Json -Compress`;
  const output = await runWindowsNativeScript(script);
  if (typeof output !== "object" || output === null || !("ok" in output) || output.ok !== true) throw new Error("fixture-dacl-unverified");
}
