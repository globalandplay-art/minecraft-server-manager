# D2d inherited bootstrap contract — source-only design candidate

No native launch/build or ManagerLifetimeLock change. This is the proposed strict
private bootstrap frame contract for the future fixed worker; numbers/metadata
alone never authenticate a real owner, descriptor, artifact or handle.

1. Exactly one canonical UTF-8 JSON frame with LF, at most262144bytes; no unknown
   fields, duplicate keys or alternative numeric/base64 encodings. Top-level keys:
   version1, action64hex, artifact64hex, generation1..262144, candidate(base64 fixed
   build description), owner and pins. Described candidate is parsed by D2c and its
   semantic digest must equal artifact. It is still an untrusted shape candidate.
2. Owner keys: root(base64 strict UTF-8 canonical local Windows path), nodePid
   (integer1..0x7fffffff),
   processIdentity16hex, directoryHandle/fileHandle(positive canonical signed64
   decimal strings), directoryIdentity/fileIdentity40hex. No raw proof getter is
   added to Node; only the future trusted bootstrap may produce this private pipe
   frame after native owner retention. Parser returns private metadata, never an
   HTTP/log DTO. Actual inherited handles/owner process must be independently
   verified by native code before any query.
3. Executable path is fixed to ownerRoot/whitelist-native/whitelist-acl-worker.exe.
   No arbitrary executable path supplied by input. Pins must describe every exact
   ancestor from drive root through that executable in order: path(base64), handle,
   identity40hex, directory(boolean). At most32 directories plus one file; all
   handles distinct from each other and owner copies, positive signed64, and exact
   planned inventory fits D2a bounds. The manager-root pin's identity must equal
   owner.directoryIdentity. No source-directed extra pins or omitted ancestors.
4. Paths: absolute drive-rooted local canonical form; reject UNC/device paths,
   slash aliases, dot traversal/normalization changes, controls/NUL, ADS, trailing
   non-root separators, trailing dots/spaces, forbidden Win32 component characters
   and DOS reserved names (including extensions). Each decoded path at most4096characters. Case-insensitive
   comparison follows current Windows identity semantics. Native final-path,
   reparse/hardlink checks remain mandatory; string containment is not physical
   proof. No filesystem reads in this pure contract.
5. Private-ACL domain is DERIVED, not caller-selectable: manager root and its
   descendants require current private ACL policy. Ancestors above manager root
   still require stable native pins, no reparse and trusted path/identity policy;
   C:\ is not assumed to have an auth-private DACL. This clarifies D1's private
   artifact root versus platform ancestors; it does not relax credential ACL rules.
6. Returned metadata/candidate/pin list are deeply immutable. Reject malformed
   inputs with one fixed code; no native output, path or supplied exception text
   retained. Exposing a successful parse must not grant launch or ownership.

Before implementation: independent Sol High review of this contract, especially
full-chain derivation, private-ACL boundary and zero authority from parsing.
Native rendering, inherited validation, worker main, ACL snapshot parity and D3
trust/build remain separate unfinished work. LC2 remains BLOCKED.

Independent design review: P1/P2=0; P3 explicit PID bound and DOS/trailing-component
rules resolved above. Implementation must enforce them without filesystem access.
Its summary must omit raw owner paths/handles; the real bootstrap is constructed
inside the trusted native layer, not via a Node ManagerLifetimeLock proof getter.
