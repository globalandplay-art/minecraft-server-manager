import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { AuthCoreError } from "./password.js";
import { nativePathData, runWindowsNativeScript } from "./windows-native.js";

// Windows file sharing is enforced across processes and sessions. Duplicate the
// exclusive handle into Node: helper exit does not release it; Node death does.
const NATIVE = `
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
public static class ManagerLockNative {
  [StructLayout(LayoutKind.Sequential,Pack=4)] struct Info {
    public uint Attributes; public long Creation; public long Access; public long Write;
    public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow;
  }
  [StructLayout(LayoutKind.Sequential)] struct SA { public int Length; public IntPtr Descriptor; public int Inherit; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string p,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")] static extern IntPtr CreateSecureFile(string p,uint access,uint share,ref SA sa,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr h,out Info info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetFileType(IntPtr h);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder p,uint n,uint flags);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetKernelObjectSecurity(IntPtr h,uint requested,byte[] descriptor,uint size,out uint needed);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr h,IntPtr target,out IntPtr duplicate,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  static void Check(bool condition) { if(!condition) throw new Exception("UNSAFE"); }
  static bool Valid(IntPtr h) { return h!=IntPtr.Zero && h!=new IntPtr(-1); }
  static void CloseLocal(IntPtr h) { if(Valid(h)) CloseHandle(h); }
  static string FinalPath(IntPtr h) { var text=new StringBuilder(4096); uint n=GetFinalPathNameByHandle(h,text,4096,0); Check(n>0&&n<4096); return text.ToString(); }
  static string Identity(IntPtr h) { Info info; Check(GetFileInformationByHandle(h,out info)); return info.Volume.ToString("X8")+info.IndexHigh.ToString("X8")+info.IndexLow.ToString("X8")+info.Creation.ToString("X16"); }
  static string ProcessIdentity(IntPtr h) { long created,exited,kernel,user; Check(GetProcessTimes(h,out created,out exited,out kernel,out user)); return created.ToString("X16"); }
  static void Validate(IntPtr h,string expected,bool directory) {
    Info info=new Info(); Check(GetFileType(h)==1); Check(GetFileInformationByHandle(h,out info));
    Check((info.Attributes&0x400)==0&&((info.Attributes&0x10)!=0)==directory);
    if(!directory) Check(info.Links==1&&info.SizeHigh==0&&info.SizeLow==0);
    Check(String.Equals(FinalPath(h),@"\\\\?\\"+expected,StringComparison.OrdinalIgnoreCase));
  }
  static void PrivateAcl(IntPtr h,string sid) {
    uint needed; GetKernelObjectSecurity(h,5,null,0,out needed); Check(needed>0&&needed<=16384);
    var bytes=new byte[needed]; Check(GetKernelObjectSecurity(h,5,bytes,needed,out needed));
    var raw=new RawSecurityDescriptor(bytes,0); Check(raw.Owner.Value==sid&&(raw.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0&&raw.DiscretionaryAcl!=null&&raw.DiscretionaryAcl.Count<=64);
    int allows=0;
    foreach(GenericAce generic in raw.DiscretionaryAcl) {
      var ace=generic as CommonAce; Check(ace!=null&&!ace.IsCallback&&ace.AceFlags==AceFlags.None);
      string principal=ace.SecurityIdentifier.Value;
      Check(ace.AceQualifier==AceQualifier.AccessAllowed&&(principal==sid||principal=="S-1-5-18"||principal=="S-1-5-32-544"));
      if(principal==sid) allows|=ace.AccessMask;
    }
    Check((allows&0x1f01ff)==0x1f01ff);
  }
  static void CloseRemote(IntPtr process,IntPtr h) { IntPtr unused; Check(DuplicateHandle(process,h,IntPtr.Zero,out unused,0,false,1)); }
  public static string Acquire(string root,int pid,string expectedProcess) {
    IntPtr process=IntPtr.Zero,dir=IntPtr.Zero,file=IntPtr.Zero,descriptor=IntPtr.Zero,remoteDir=IntPtr.Zero,remoteFile=IntPtr.Zero;
    bool published=false;
    try {
      process=OpenProcess(0x1040,false,pid); Check(Valid(process));
      Check(ProcessIdentity(process)==expectedProcess);
      dir=CreateFile(root,0x80,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero); Check(Valid(dir)); Validate(dir,root,true);
      string sid=WindowsIdentity.GetCurrent().User.Value;
      var raw=new RawSecurityDescriptor("O:"+sid+"G:"+sid+"D:P(A;;FA;;;"+sid+")(A;;FA;;;SY)(A;;FA;;;BA)");
      var bytes=new byte[raw.BinaryLength]; raw.GetBinaryForm(bytes,0); descriptor=Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes,0,descriptor,bytes.Length);
      var sa=new SA { Length=Marshal.SizeOf(typeof(SA)),Descriptor=descriptor,Inherit=0 };
      string lockFile=System.IO.Path.Combine(root,"manager.lifetime.lock");
      file=CreateSecureFile(lockFile,0x80020000,0,ref sa,4,0x00200000,IntPtr.Zero);
      if(!Valid(file)) { int error=Marshal.GetLastWin32Error(); if(error==32||error==33) throw new Exception("BUSY"); throw new Exception("UNSAFE"); }
      Validate(file,lockFile,false); PrivateAcl(file,sid);
      if(!DuplicateHandle(GetCurrentProcess(),dir,process,out remoteDir,0,false,2)) throw new Exception("UNKNOWN");
      if(!DuplicateHandle(GetCurrentProcess(),file,process,out remoteFile,0,false,2)) throw new Exception("UNKNOWN");
      string binding=remoteDir.ToInt64().ToString()+","+remoteFile.ToInt64().ToString()+","+Identity(dir)+","+Identity(file)+","+ProcessIdentity(process);
      published=true; return binding;
    } finally {
      if(!published&&Valid(process)) {
        try { if(Valid(remoteFile)) CloseRemote(process,remoteFile); if(Valid(remoteDir)) CloseRemote(process,remoteDir); }
        catch { throw new Exception("UNKNOWN"); }
      }
      CloseLocal(file); CloseLocal(dir); CloseLocal(process); if(descriptor!=IntPtr.Zero) Marshal.FreeHGlobal(descriptor);
    }
  }
  public static void Release(string root,int pid,long directory,long file,string directoryId,string fileId,string processId) {
    IntPtr process=OpenProcess(0x1040,false,pid),localDir=IntPtr.Zero,localFile=IntPtr.Zero; Check(Valid(process));
    try {
      Check(ProcessIdentity(process)==processId);
      Check(DuplicateHandle(process,new IntPtr(directory),GetCurrentProcess(),out localDir,0,false,2));
      Check(DuplicateHandle(process,new IntPtr(file),GetCurrentProcess(),out localFile,0,false,2));
      Validate(localDir,root,true); Validate(localFile,System.IO.Path.Combine(root,"manager.lifetime.lock"),false);
      Check(Identity(localDir)==directoryId&&Identity(localFile)==fileId);
      CloseRemote(process,new IntPtr(file)); CloseRemote(process,new IntPtr(directory));
    } finally { CloseLocal(localFile); CloseLocal(localDir); CloseLocal(process); }
  }
}
`;
const script = (action: string) => `$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${NATIVE}\n'@\n${action}`;
export class ManagerLifetimeLock {
  #handles: string[];
  #released = false;
  #mutation = false;
  #root: string;
  private constructor(root: string, handles: string[]) { this.#root = root; this.#handles = handles; }
  static async acquire(managerRoot: string): Promise<ManagerLifetimeLock> {
    if (process.platform !== "win32" || managerRoot.length > 4096 || managerRoot.split(/[\\/]/u).length > 64 || !path.isAbsolute(managerRoot) || managerRoot !== path.resolve(managerRoot) || managerRoot.startsWith("\\\\") || managerRoot.includes("\0") || managerRoot.slice(2).includes(":") ||
      managerRoot.slice(3).split(/[\\/]/u).some((part) => !part || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
    const rootPath = path.parse(managerRoot).root;
    let ancestor = rootPath;
    for (const component of managerRoot.slice(rootPath.length).split(path.sep)) {
      const existing = await lstat(ancestor);
      if (!existing.isDirectory() || existing.isSymbolicLink() || (await realpath(ancestor)).toLowerCase() !== ancestor.toLowerCase()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
      ancestor = path.join(ancestor, component);
      try { await mkdir(ancestor); }
      catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error; }
    }
    const info = await lstat(managerRoot);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(managerRoot)).toLowerCase() !== managerRoot.toLowerCase()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
    let output: unknown;
    const expected = await runWindowsNativeScript(`$ErrorActionPreference='Stop'\n@{identity=([Diagnostics.Process]::GetProcessById(${process.pid}).StartTime.ToUniversalTime().ToFileTimeUtc()).ToString('X16')} | ConvertTo-Json -Compress`);
    if (typeof expected !== "object" || expected === null || !("identity" in expected) || typeof expected.identity !== "string" || !/^[0-9A-F]{16}$/u.test(expected.identity)) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
    try { output = await runWindowsNativeScript(script(`try { @{handles=[ManagerLockNative]::Acquire(${nativePathData(managerRoot)},${process.pid},'${expected.identity}')} | ConvertTo-Json -Compress } catch { @{error=if($_.Exception.ToString().Contains('UNKNOWN')) {'UNKNOWN'} elseif($_.Exception.ToString().Contains('BUSY')) {'BUSY'} else {'UNSAFE'}} | ConvertTo-Json -Compress }`)); }
    catch { throw new LockOwnershipUnknownError(); }
    if (typeof output !== "object" || output === null) throw new LockOwnershipUnknownError();
    if ("error" in output) {
      if (output.error === "BUSY") throw new AuthCoreError("AUTH_BUSY");
      if (output.error === "UNSAFE") throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
      throw new LockOwnershipUnknownError();
    }
    if (!("handles" in output) || typeof output.handles !== "string" || !/^[1-9][0-9]{0,18},[1-9][0-9]{0,18},[0-9A-F]{40},[0-9A-F]{40},[0-9A-F]{16}$/u.test(output.handles)) throw new LockOwnershipUnknownError();
    return new ManagerLifetimeLock(managerRoot, output.handles.split(","));
  }
  assertHeld(root: string): void {
    if (this.#released || root.toLowerCase() !== this.#root.toLowerCase()) throw new AuthCoreError("AUTH_PRIVATE_UNSAFE");
  }
  rootIdentity(): string {
    this.assertHeld(this.#root);
    return createHash("sha256").update(this.#handles[2]!).digest("hex");
  }
  beginOfflineMutation(root: string): () => void {
    this.assertHeld(root);
    if (this.#mutation) throw new AuthCoreError("AUTH_BUSY", 1);
    this.#mutation = true;
    let finished = false;
    return () => { if (!finished) { finished = true; this.#mutation = false; } };
  }
  async release(): Promise<void> {
    if (this.#released) return;
    if (this.#mutation) throw new AuthCoreError("AUTH_BUSY", 1);
    this.#released = true;
    try {
      const output = await runWindowsNativeScript(script(`[ManagerLockNative]::Release(${nativePathData(this.#root)},${process.pid},[long]::Parse('${this.#handles[0]}'),[long]::Parse('${this.#handles[1]}'),'${this.#handles[2]}','${this.#handles[3]}','${this.#handles[4]}')\n@{released=$true} | ConvertTo-Json -Compress`));
      if (typeof output !== "object" || output === null || !("released" in output) || output.released !== true) throw new LockOwnershipUnknownError();
    } catch { throw new LockOwnershipUnknownError(); }
  }
}

/** Entry points must terminate the owner process; do not retry with uncertain native handles. */
export class LockOwnershipUnknownError extends Error {
  constructor() { super("AUTH_LOCK_OWNERSHIP_UNKNOWN"); }
}
