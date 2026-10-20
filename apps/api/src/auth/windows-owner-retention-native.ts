// Fixed native source shared by the owner-retention wrapper. No execution or bootstrap.
export const WINDOWS_OWNER_RETENTION_NATIVE = `
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
public static class WhitelistOwnerRetention {
  [StructLayout(LayoutKind.Sequential,Pack=4)] struct Info {
    public uint Attributes; public long Creation; public long Access; public long Write;
    public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr h,IntPtr target,out IntPtr duplicate,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(IntPtr h,out Info info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetFileType(IntPtr h);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(IntPtr h,StringBuilder p,uint n,uint flags);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetKernelObjectSecurity(IntPtr h,uint requested,byte[] descriptor,uint size,out uint needed);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  // Raw, rooted, non-inheritable handles are released ONLY by OS process exit.
  // No successful-path Dispose/finally: EOF is not proof of actual child exit.
  static IntPtr retainedDirectory=IntPtr.Zero, retainedFile=IntPtr.Zero;
  static void Check(bool ok) { if(!ok) throw new Exception("OWNER_RETENTION_UNSAFE"); }
  static bool Valid(IntPtr h) { return h!=IntPtr.Zero && h!=new IntPtr(-1); }
  static void CloseLocal(IntPtr h) { if(Valid(h)) CloseHandle(h); }
  static string ProcessIdentity(IntPtr h) {
    long created,exited,kernel,user; Check(GetProcessTimes(h,out created,out exited,out kernel,out user)); return created.ToString("X16");
  }
  static void Validate(IntPtr h,string expected,string identity,bool directory) {
    Info info=new Info(); Check(GetFileType(h)==1 && GetFileInformationByHandle(h,out info));
    Check((info.Attributes&0x400)==0 && ((info.Attributes&0x10)!=0)==directory);
    if(!directory) Check(info.Links==1 && info.SizeHigh==0 && info.SizeLow==0);
    string actual=info.Volume.ToString("X8")+info.IndexHigh.ToString("X8")+info.IndexLow.ToString("X8")+info.Creation.ToString("X16");
    Check(actual==identity);
    var text=new StringBuilder(4096); uint n=GetFinalPathNameByHandle(h,text,4096,0);
    Check(n>0 && n<4096 && String.Equals(text.ToString(),@"\\\\?\\"+expected,StringComparison.OrdinalIgnoreCase));
  }
  static void PrivateAcl(IntPtr h) {
    uint needed; GetKernelObjectSecurity(h,5,null,0,out needed); Check(needed>0 && needed<=16384);
    var bytes=new byte[needed]; Check(GetKernelObjectSecurity(h,5,bytes,needed,out needed));
    var raw=new RawSecurityDescriptor(bytes,0); string sid=WindowsIdentity.GetCurrent().User.Value;
    Check(raw.Owner.Value==sid && (raw.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0 && raw.DiscretionaryAcl!=null && raw.DiscretionaryAcl.Count<=64);
    int allows=0;
    foreach(GenericAce generic in raw.DiscretionaryAcl) {
      var ace=generic as CommonAce; Check(ace!=null && !ace.IsCallback && ace.AceFlags==AceFlags.None);
      string principal=ace.SecurityIdentifier.Value;
      Check(ace.AceQualifier==AceQualifier.AccessAllowed && (principal==sid || principal=="S-1-5-18" || principal=="S-1-5-32-544"));
      if(principal==sid) allows|=ace.AccessMask;
    }
    Check((allows&0x1f01ff)==0x1f01ff);
  }
  public static void Retain(string root,int pid,string processIdentity,long directory,long file,string directoryId,string fileId) {
    Check(retainedDirectory==IntPtr.Zero && retainedFile==IntPtr.Zero);
    IntPtr process=IntPtr.Zero,localDirectory=IntPtr.Zero,localFile=IntPtr.Zero;
    bool retained=false;
    try {
      process=OpenProcess(0x101040,false,pid); Check(Valid(process));
      Check(ProcessIdentity(process)==processIdentity && WaitForSingleObject(process,0)==258);
      Check(DuplicateHandle(process,new IntPtr(directory),GetCurrentProcess(),out localDirectory,0,false,2));
      Check(DuplicateHandle(process,new IntPtr(file),GetCurrentProcess(),out localFile,0,false,2));
      Validate(localDirectory,root,directoryId,true);
      Validate(localFile,System.IO.Path.Combine(root,"manager.lifetime.lock"),fileId,false); PrivateAcl(localFile);
      Check(WaitForSingleObject(process,0)==258);
      retainedDirectory=localDirectory; retainedFile=localFile; retained=true;
    } finally {
      // Only failed bootstrap may close copies. No query has been consumed yet.
      if(!retained) { CloseLocal(localFile); CloseLocal(localDirectory); }
      CloseLocal(process);
    }
  }
}
`;
