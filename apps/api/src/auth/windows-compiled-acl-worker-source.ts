import { WINDOWS_OWNER_RETENTION_NATIVE } from "./windows-owner-retention-native.js";

/** UNWIRED fixed source candidate. No compiler, file publication or execution.
 * Builder takes no script/proof/path. The existing PowerShell owner literal is
 * untouched; only this separate compiled candidate makes its class partial. */
const INHERITED = String.raw`
public static partial class WhitelistOwnerRetention {
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
  public static string CurrentCreationIdentity() { return ProcessIdentity(GetCurrentProcess()); }
  public static void RetainInherited(string root,int pid,string creation,long directory,long file,string directoryId,string fileId) {
    Check(retainedDirectory==IntPtr.Zero && retainedFile==IntPtr.Zero && directory!=file);
    IntPtr process=IntPtr.Zero,dir=new IntPtr(directory),record=new IntPtr(file);
    try {
      process=OpenProcess(0x101000,false,pid); Check(Valid(process));
      Check(ProcessIdentity(process)==creation && WaitForSingleObject(process,0)==258);
      Validate(dir,root,directoryId,true);
      Validate(record,System.IO.Path.Combine(root,"manager.lifetime.lock"),fileId,false); PrivateAcl(record);
      Check(SetHandleInformation(dir,1,0) && SetHandleInformation(record,1,0));
      Check(WaitForSingleObject(process,0)==258);
      retainedDirectory=dir; retainedFile=record;
    } finally { CloseLocal(process); }
    // Inherited owner/pin handles are NEVER explicitly closed, including failure.
    // They remain kernel-owned until actual OS worker exit.
  }
  static void ArtifactPrivateAcl(IntPtr h) {
    uint needed; GetKernelObjectSecurity(h,5,null,0,out needed); Check(needed>0 && needed<=16384);
    var bytes=new byte[needed]; Check(GetKernelObjectSecurity(h,5,bytes,needed,out needed));
    var raw=new RawSecurityDescriptor(bytes,0); string sid;
    using(var user=WindowsIdentity.GetCurrent()) { sid=user.User.Value; }
    Check(raw.Owner.Value==sid && (raw.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0 && raw.DiscretionaryAcl!=null && raw.DiscretionaryAcl.Count>0 && raw.DiscretionaryAcl.Count<=64);
    uint allows=0;
    foreach(GenericAce generic in raw.DiscretionaryAcl) {
      var ace=generic as CommonAce; Check(ace!=null && !ace.IsCallback && ((int)ace.AceFlags&~3)==0);
      string principal=ace.SecurityIdentifier.Value; uint mask=unchecked((uint)ace.AccessMask);
      if(ace.AceQualifier==AceQualifier.AccessDenied) Check(mask==0);
      else {
        Check(ace.AceQualifier==AceQualifier.AccessAllowed);
        Check(mask==0 || principal==sid || principal=="S-1-5-18" || principal=="S-1-5-32-544");
        if(principal==sid) allows|=mask;
      }
    }
    Check((allows&0x1f01ff)==0x1f01ff);
  }
  public static void ValidateInheritedPin(long raw,string expected,string identity,bool directory,bool requirePrivate,int size,string sha) {
    IntPtr h=new IntPtr(raw); Info info=new Info(); Check(Valid(h) && GetFileType(h)==1 && GetFileInformationByHandle(h,out info));
    Check((info.Attributes&0x400)==0 && ((info.Attributes&0x10)!=0)==directory);
    string actual=info.Volume.ToString("X8")+info.IndexHigh.ToString("X8")+info.IndexLow.ToString("X8")+info.Creation.ToString("X16");
    Check(actual==identity);
    var text=new StringBuilder(4096); uint n=GetFinalPathNameByHandle(h,text,4096,0);
    Check(n>0 && n<4096 && String.Equals(text.ToString(),@"\\?\"+expected,StringComparison.OrdinalIgnoreCase));
    Check(SetHandleInformation(h,1,0));
    if(requirePrivate) ArtifactPrivateAcl(h);
    if(!directory) {
      Check(info.Links==1 && info.SizeHigh==0 && info.SizeLow==size);
      using(var wrapper=new Microsoft.Win32.SafeHandles.SafeFileHandle(h,false))
      using(var stream=new System.IO.FileStream(wrapper,System.IO.FileAccess.Read,4096,false))
      using(var digest=new System.Security.Cryptography.SHA256Managed()) {
        stream.Position=0; string hash=BitConverter.ToString(digest.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
        Check(hash==sha); stream.Position=0;
      }
    }
  }
}
`;

const WORKER = String.raw`
internal static class WhitelistAclWorker {
  static readonly System.Web.Script.Serialization.JavaScriptSerializer Json=new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength=262144, RecursionLimit=16 };
  static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
  static void Check(bool ok) { if(!ok) throw new Exception("ACL_WORKER_UNSAFE"); }
  static System.Collections.Generic.Dictionary<string,object> Map(object value) {
    var map=value as System.Collections.Generic.Dictionary<string,object>; Check(map!=null); return map;
  }
  static void Keys(System.Collections.Generic.Dictionary<string,object> map,string expected) {
    var keys=new string[map.Count]; map.Keys.CopyTo(keys,0); Array.Sort(keys,StringComparer.Ordinal); Check(String.Join(",",keys)==expected);
  }
  static string Text(object value) { Check(value is string); return (string)value; }
  static int Integer(object value,int min,int max) { Check(value is int && (int)value>=min && (int)value<=max); return (int)value; }
  static bool Hex(object value,int length,bool upper) {
    var text=value as string; if(text==null || text.Length!=length) return false;
    bool nonzero=false;
    foreach(char c in text) {
      if(!(c>='0' && c<='9') && !(upper?(c>='A' && c<='F'):(c>='a' && c<='f'))) return false;
      nonzero|=c!='0';
    }
    return !upper || nonzero;
  }
  static long Handle(object value) {
    string text=Text(value); Check(text.Length>0 && text.Length<=19 && text[0]!='0' && System.Text.RegularExpressions.Regex.IsMatch(text,"^[0-9]+$"));
    long number; Check(Int64.TryParse(text,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out number) && number>0); return number;
  }
  static byte[] Data(object value,int max) {
    string text=Text(value); Check(text.Length<=((max+2)/3)*4); byte[] bytes=Convert.FromBase64String(text);
    Check(bytes.Length<=max && Convert.ToBase64String(bytes)==text); return bytes;
  }
  static string LocalPath(object value) {
    string text=Utf8.GetString(Data(value,16384));
    Check(text.Length>=3 && text.Length<=4096 && System.Text.RegularExpressions.Regex.IsMatch(text,@"^[A-Za-z]:\\"));
    Check(!System.Text.RegularExpressions.Regex.IsMatch(text,"[\\x00-\\x1f\\x7f/<>\"|?*]") && text.Substring(2).IndexOf(':')<0);
    Check(System.IO.Path.GetFullPath(text)==text && (text.Length==3 || !text.EndsWith("\\",StringComparison.Ordinal)));
    foreach(string part in text.Substring(3).Split('\\')) {
      Check(part.Length>0 || text.Length==3);
      if(part.Length==0) continue;
      Check(!part.EndsWith(".",StringComparison.Ordinal) && !part.EndsWith(" ",StringComparison.Ordinal));
      string stem=part.Split('.')[0].TrimEnd(' ','.');
      Check(!System.Text.RegularExpressions.Regex.IsMatch(stem,@"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$|CLOCK\$)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase|System.Text.RegularExpressions.RegexOptions.CultureInvariant));
    }
    return text;
  }
  // Deliberately do not use JavaScriptSerializer.Serialize: its HTML escaping
  // differs from Node JSON.stringify for apostrophes and other legal paths.
  static string Quote(string text) {
    var result=new StringBuilder(); result.Append('"');
    for(int i=0;i<text.Length;i++) {
      char c=text[i];
      switch(c) {
        case '"': result.Append("\\\""); break;
        case '\\': result.Append("\\\\"); break;
        case '\b': result.Append("\\b"); break;
        case '\f': result.Append("\\f"); break;
        case '\n': result.Append("\\n"); break;
        case '\r': result.Append("\\r"); break;
        case '\t': result.Append("\\t"); break;
        default:
          if(c<32 || (Char.IsSurrogate(c) && !(Char.IsHighSurrogate(c) && i+1<text.Length && Char.IsLowSurrogate(text[i+1])))) {
            result.Append("\\u").Append(((int)c).ToString("x4",System.Globalization.CultureInfo.InvariantCulture));
          } else {
            result.Append(c);
            if(Char.IsHighSurrogate(c)) result.Append(text[++i]);
          }
          break;
      }
    }
    return result.Append('"').ToString();
  }
  static string Canonical(object value) {
    if(value==null) return "null";
    if(value is string) return Quote((string)value);
    if(value is bool) return (bool)value?"true":"false";
    if(value is int) return ((int)value).ToString(System.Globalization.CultureInfo.InvariantCulture);
    if(value is long) return ((long)value).ToString(System.Globalization.CultureInfo.InvariantCulture);
    var array=value as object[];
    if(array!=null) {
      var rows=new string[array.Length]; for(int i=0;i<array.Length;i++) rows[i]=Canonical(array[i]);
      return "["+String.Join(",",rows)+"]";
    }
    var map=Map(value); var fields=new System.Collections.Generic.List<string>();
    foreach(var pair in map) fields.Add(Quote(pair.Key)+":"+Canonical(pair.Value));
    return "{"+String.Join(",",fields.ToArray())+"}";
  }
  static object Parse(string text) { object value=Json.DeserializeObject(text); Check(Canonical(value)==text); return value; }
  static string ReadLine(System.IO.Stream input,int limit) {
    using(var bytes=new System.IO.MemoryStream()) {
      int value;
      while((value=input.ReadByte())!=-1) {
        if(value==10) return Utf8.GetString(bytes.ToArray());
        Check(bytes.Length<limit-1); bytes.WriteByte((byte)value);
      }
      Check(bytes.Length==0); return null;
    }
  }
  static string Digest(string text) {
    using(var hash=new System.Security.Cryptography.SHA256Managed()) return BitConverter.ToString(hash.ComputeHash(Utf8.GetBytes(text))).Replace("-","").ToLowerInvariant();
  }
  static void Emit(System.IO.Stream output,object value,int max) {
    byte[] bytes=Utf8.GetBytes(Canonical(value)+"\n"); Check(bytes.Length<=max); output.Write(bytes,0,bytes.Length); output.Flush();
  }
  static System.Collections.Generic.Dictionary<string,object> Candidate(object encoded,string binding) {
    var row=Map(Parse(Utf8.GetString(Data(encoded,4096))));
    Keys(row,"architecture,artifactBytes,artifactSha256,compilerSha256,ownerSourceSha256,program,recipeSha256,references,runtime,sourceSha256,version");
    Check(Integer(row["version"],1,1)==1 && Text(row["program"])=="whitelist-acl-worker" && Text(row["architecture"])=="x64" && Text(row["runtime"])=="netfx4");
    foreach(string key in new[]{"sourceSha256","ownerSourceSha256","recipeSha256","compilerSha256","artifactSha256"}) Check(Hex(row[key],64,false));
    Integer(row["artifactBytes"],1,4194304); var refs=row["references"] as object[]; Check(refs!=null && refs.Length>=2 && refs.Length<=8);
    var allowed=new System.Collections.Generic.HashSet<string>(new[]{"mscorlib.dll","System.dll","System.Core.dll","System.Security.dll","System.Runtime.Serialization.dll","System.Xml.dll","System.Web.Extensions.dll","System.Web.dll"},StringComparer.Ordinal);
    var names=new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal); string previous="";
    var references=new System.Collections.Generic.List<object>();
    foreach(object raw in refs) {
      var item=Map(raw); Keys(item,"name,sha256"); string name=Text(item["name"]);
      Check(allowed.Contains(name) && StringComparer.Ordinal.Compare(previous,name)<0 && names.Add(name) && Hex(item["sha256"],64,false)); previous=name;
      references.Add(new System.Collections.Generic.Dictionary<string,object>{{"name",name},{"sha256",item["sha256"]}});
    }
    Check(names.Contains("mscorlib.dll") && names.Contains("System.dll"));
    var canonical=new System.Collections.Generic.Dictionary<string,object>();
    foreach(string key in new[]{"version","program","architecture","runtime","sourceSha256","ownerSourceSha256","recipeSha256","compilerSha256","artifactSha256","artifactBytes"}) canonical.Add(key,row[key]);
    canonical.Add("references",references.ToArray()); Check(Digest(Canonical(canonical))==binding); return canonical;
  }
  static System.Collections.Generic.Dictionary<string,object> Bootstrap(string text) {
    var row=Map(Parse(text)); Keys(row,"action,artifact,candidate,generation,owner,pins,version");
    Integer(row["version"],1,1); Check(Hex(row["action"],64,false) && Hex(row["artifact"],64,false)); Integer(row["generation"],1,262144);
    var candidate=Candidate(row["candidate"],Text(row["artifact"])); var owner=Map(row["owner"]);
    Keys(owner,"directoryHandle,directoryIdentity,fileHandle,fileIdentity,nodePid,processIdentity,root");
    string root=LocalPath(owner["root"]); int pid=Integer(owner["nodePid"],1,Int32.MaxValue);
    Check(Hex(owner["processIdentity"],16,true) && Hex(owner["directoryIdentity"],40,true) && Hex(owner["fileIdentity"],40,true));
    long directory=Handle(owner["directoryHandle"]),file=Handle(owner["fileHandle"]); Check(directory!=file);
    var chain=new System.Collections.Generic.List<string>(); string executable=System.IO.Path.Combine(root,"whitelist-native","whitelist-acl-worker.exe"); Check(executable.Length<=4096);
    chain.Add(executable);
    for(string parent=System.IO.Path.GetDirectoryName(executable);;parent=System.IO.Path.GetDirectoryName(parent)) {
      chain.Insert(0,parent); Check(chain.Count<=33); if(parent==System.IO.Path.GetPathRoot(parent)) break;
    }
    var pins=row["pins"] as object[]; Check(pins!=null && pins.Length==chain.Count);
    var handles=new System.Collections.Generic.HashSet<long>{directory,file}; bool rootSeen=false;
    WhitelistOwnerRetention.RetainInherited(root,pid,Text(owner["processIdentity"]),directory,file,Text(owner["directoryIdentity"]),Text(owner["fileIdentity"]));
    for(int i=0;i<pins.Length;i++) {
      var pin=Map(pins[i]); Keys(pin,"directory,handle,identity,path"); long handle=Handle(pin["handle"]);
      Check(handles.Add(handle) && Hex(pin["identity"],40,true) && pin["directory"] is bool && (bool)pin["directory"]==(i<pins.Length-1));
      string current=LocalPath(pin["path"]); Check(String.Equals(current,chain[i],StringComparison.OrdinalIgnoreCase));
      if(String.Equals(current,root,StringComparison.OrdinalIgnoreCase)) { Check(Text(pin["identity"])==Text(owner["directoryIdentity"])); rootSeen=true; }
      WhitelistOwnerRetention.ValidateInheritedPin(handle,current,Text(pin["identity"]),(bool)pin["directory"],rootSeen,(int)candidate["artifactBytes"],Text(candidate["artifactSha256"]));
    }
    Check(rootSeen); return row;
  }
  static object Snapshot(string target) {
    Check(target.Length<=4096 && target.IndexOf('\0')<0);
    var attributes=System.IO.File.GetAttributes(target); Check((attributes&System.IO.FileAttributes.ReparsePoint)==0);
    System.Security.AccessControl.FileSystemSecurity acl=(attributes&System.IO.FileAttributes.Directory)!=0
      ? (System.Security.AccessControl.FileSystemSecurity)new System.IO.DirectoryInfo(target).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access)
      : new System.IO.FileInfo(target).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access);
    var raw=new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(),0); Check(raw.Owner!=null && raw.DiscretionaryAcl!=null && raw.DiscretionaryAcl.Count<=64);
    string sid; using(var user=WindowsIdentity.GetCurrent()) { sid=user.User.Value; }
    var rows=new System.Collections.Generic.List<object>();
    foreach(GenericAce generic in raw.DiscretionaryAcl) {
      var ace=generic as CommonAce; Check(ace!=null && !ace.IsCallback);
      Check(ace.AceQualifier==AceQualifier.AccessAllowed || ace.AceQualifier==AceQualifier.AccessDenied);
      rows.Add(new System.Collections.Generic.Dictionary<string,object>{{"sid",ace.SecurityIdentifier.Value},{"kind",ace.AceQualifier==AceQualifier.AccessAllowed?"allow":"deny"},{"mask",(long)unchecked((uint)ace.AccessMask)},{"flags",(int)ace.AceFlags}});
    }
    return new System.Collections.Generic.Dictionary<string,object>{{"userSid",sid},{"ownerSid",raw.Owner.Value},{"protected",acl.AreAccessRulesProtected},{"aces",rows.ToArray()}};
  }
  static int Run(string[] args) {
    Check(args.Length==0);
    using(var scope=new System.Threading.Timer(delegate { Environment.Exit(1); },null,40000,System.Threading.Timeout.Infinite))
    using(var input=new System.IO.BufferedStream(Console.OpenStandardInput(),4096))
    using(var output=Console.OpenStandardOutput()) {
      string first=ReadLine(input,262144); Check(first!=null); var bootstrap=Bootstrap(first);
      var ready=new System.Collections.Generic.Dictionary<string,object>{{"version",1},{"type","ready"},{"action",bootstrap["action"]},{"artifact",bootstrap["artifact"]},{"generation",bootstrap["generation"]},{"processIdentity",WhitelistOwnerRetention.CurrentCreationIdentity()},{"ownerRetained",true},{"pinsRetained",true}};
      Emit(output,ready,4096); int sequence=0; string line;
      while((line=ReadLine(input,262144))!=null) {
        Check(sequence<64); var request=Map(Parse(line)); Keys(request,"id,paths,version"); Integer(request["version"],1,1); Integer(request["id"],sequence+1,sequence+1);
        var targets=Parse(Utf8.GetString(Data(request["paths"],196608))) as object[]; Check(targets!=null && targets.Length>=1 && targets.Length<=8);
        var unique=new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase); var snapshots=new System.Collections.Generic.List<object>();
        foreach(object value in targets) { string target=Text(value); Check(unique.Add(target)); snapshots.Add(Snapshot(target)); }
        sequence++; Emit(output,new System.Collections.Generic.Dictionary<string,object>{{"version",1},{"id",sequence},{"snapshots",snapshots.ToArray()}},65536);
      }
    }
    return 0;
  }
  public static int Main(string[] args) { try { return Run(args); } catch(Exception) { return 1; } }
}
`;

export function compiledAclWorkerSource(): string {
  const marker = "public static class WhitelistOwnerRetention {";
  if (WINDOWS_OWNER_RETENTION_NATIVE.indexOf(marker) < 0 ||
    WINDOWS_OWNER_RETENTION_NATIVE.indexOf(marker) !== WINDOWS_OWNER_RETENTION_NATIVE.lastIndexOf(marker)) {
    throw new Error("ACL_WORKER_SOURCE_UNSAFE");
  }
  return WINDOWS_OWNER_RETENTION_NATIVE.replace(marker, "public static partial class WhitelistOwnerRetention {") + INHERITED + WORKER;
}
