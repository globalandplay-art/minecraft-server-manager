# D3 isolated compiler trust / build plan — candidate

No compiler invocation or artifact execution yet. Only the frozen reviewed source
candidate can enter this slice. Full C#/codec/native parity remains unverified.

## Trust boundary

Windows installation, PowerShell/.NET runtime and local trust store are trusted
platform bootstrap, as in the existing private ACL helpers. Do not verify a
compiler by compiling the verifier with that same unchecked compiler. Do not use
a new helper's own output or sibling manifest to authorize itself.

Use a fixed read-only PowerShell/.NET Reflection.Emit P/Invoke to WinVerifyTrust:
no Add-Type/csc or downloaded verifier. Fixed x64 WVT_FILE_INFO/WINTRUST_DATA,
WINTRUST_ACTION_GENERIC_VERIFY_V2, UI disabled, WTD_CACHE_ONLY_URL_RETRIEVAL and
explicit offline revocation policy. WinVerifyTrust returns LONG; record it as
winVerifyTrustStatus and require exactly zero, never SUCCEEDED/HRESULT semantics. Close
WinTrust state in finally before freeing unmanaged buffers. No online retrieval,
trust-store change, elevation or repair. Offline revocation freshness is NOT proved.
The certificate must be bound to the signer/signature actually verified by WVT,
using its live provider state or an independently reviewed exact signature-index
binding. An independently extracted embedded certificate is not that proof.
Microsoft Corporation simpleName plus code-signing EKU is only an observation,
not a complete publisher acceptance policy. Compiler trust remains pending until
that policy is independently reviewed. Unavailable cached trust/catalog/issuer
evidence is BLOCKED, not permission to ignore signature status.
If WVT state close fails, report cleanup uncertainty and no success; retain buffers
and pins potentially referenced by that state until the probe process exits.

Pin compiler/config/reference files read-only with .NET FileShare.Read (deny write/
delete) and verify their native identities and exact hashes before/after compiler
execution. Directory ancestry must be canonical, stable and non-reparse. System
installation provenance and ancestor policy are distinct from auth-private ACLs;
do not edit Windows ACLs. Explicit .NET process/file streams are an internal test
builder, not Node's permissive normal sharing. Do not release pins while compiler
or output writes remain uncertain.

## Isolation and invocation

Create one fresh UUID test-only build directory, print/validate its canonical path
before writing, reject existing/reparse/alias roots, and use existing
createPrivateEntry for newly created private objects only. Do not invoke
CredentialWriter or create any administrator credential. No user world/server
path is read. Source is fixed compiledAclWorkerSource bytes with frozen hash.

The source, output and evidence paths are derived internally; no request/env
override. Invoke the verified absolute framework csc with an argument array
(no shell), fixed x64/console/entrypoint/optimization switches, /noconfig and
/nostdlib plus exact pinned references. Build output is a private unique path with
no previous file to overwrite. Explicitly bind CLR compiler config/framework
dependencies, source bytes, reference set/hashes and exact argument recipe.
Environment is a fixed platform allowlist, with private temp paths; no profiler,
startup injection, PATH-discovered compiler or arbitrary command. Compiler timeout/
output capture are bounded build-only settings, not changes to any ACL/action timer.

## Output and lifecycle

Compiler actual exit0 + confirmed process close + bounded stdout/stderr capture
are necessary, not sufficient. Validate output ordinary file/no reparse/single
link/size/private ACL, exact content hash and retained identity; flush data.
Record versioned no-replace manifest and independent source/recipe/compiler/
reference trust receipt. The artifact is a build candidate, not production
packaging or execution authority. Do not load its assembly, invoke Main or run it.

Unknown creation, response loss, build timeout or helper/compiler cleanup ambiguity
preserves directory and evidence, blocks further build attempts and reports
CLEANUP_BLOCKED. No kill of unknown PID, recursive deletion or automatic retry.
Only this run's proven process identity can be controlled. Independent review of
the verifier/build harness and its Fake/payload tests precedes any real preflight.

## Unclosed decisions

The exact fixed managed/native verifier implementation, Microsoft certificate
publisher/EKU acceptance set, offline catalog support, compiler/config/dependency
pin inventory and process admission/close proof must be reviewed before execution.
Missing verification must stop, not become a blanket SystemRoot trust exception.
Source candidate review alone does not close these decisions.

Next: review and implement a bounded read-only provenance probe first, not build.
Then separately review the no-replace build harness. Native worker execution is
still D5+, and actual capacity remains BLOCKED.
