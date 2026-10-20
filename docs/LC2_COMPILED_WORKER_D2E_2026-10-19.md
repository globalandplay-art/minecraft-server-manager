# D2e fixed worker source — design candidate, no build/run

The next source-only slice ports the approved reference bootstrap and existing
ACL snapshot protocol into one fixed .NET Framework console program. Compiler,
reference provenance, pinned executable publication and execution stay D3+ Gates.
No fallback, default transport or member mutation is introduced.

## Source composition

The original exported owner-retention string remains unchanged for the existing
PowerShell wrapper and its32-script parity baseline. A separate zero-argument
source builder makes that exact fixed class partial (checked unique literal
replacement), appends a fixed inherited-handle entry method and the fixed worker
program. No caller script/input participates in source construction. Record both
original owner source hash and complete composed source hash in D2c description.

RetainInherited validates the inherited directory and lock-file copies using the
existing file type, identity, final path, owner-process creation identity/liveness
and lock-file private ACL rules. It does not duplicate/reopen by pathname or close
inherited copies early on failure; raw copies remain until actual OS process exit.
Clear inheritance flags; no child process, remote CloseHandle, shell or network.
Only failed worker startup exits; no response-loss retry.

## Main and private bootstrap

Main rejects command-line arguments. A fixed bounded strict UTF-8 line reader
consumes one private bootstrap under D2d rules before any ACL query, then validates
all inherited pins against native handle identities/final paths and no-reparse/
single-link rules. The executable pin also binds exact SHA256/size from the
shape-valid description. Description validity is NOT source trust; only the future
trusted bootstrap/descriptor admission supplies this pipe. Node obtains no new
ManagerLifetimeLock proof getter.

Keep inherited pins and owner copies as raw rooted handles until OS exit. Retain
all pins before emitting readiness. Private ACL is required for manager root and
descendants; ancestors above it still require stable identity/path/no-reparse pins.
Drive-root owner is not exempt: if its private ACL fails, no ready/query.

Use the SAME native lock-file private rules as current owner retention. Artifact
directory/file private checks must match `validatePrivateAcl` semantics (protected
owner=current SID, allowed ordinary ACE flags0..3, full current-user rights,
nonzero denies/foreign allows rejected). Do not wrongly apply the lock-file's
stricter flags0 rule to an inheritable directory DACL. No cached ACL answers.

## Query and output

After ready, accept only current query schema version/id/paths (base64 array), at
most8targets, path length4096,64queries and current byte bounds. Keep input byte
allocation bounded before decoding/JSON parsing. JSON duplicate/unknown fields,
wrong scalar types, invalid UTF-8/base64, control/extra frames reject. New dedicated
broker enforces32-query healthy rotation and deadlines separately; worker has64
hard cap. No timer/rotation increases.

Port Read-AuthPrivateAcl to fixed managed File/Directory GetAccessControl and
RawSecurityDescriptor reads: complete userSID/ownerSID/protected/ordered CommonAce
sid/kind/unsigned-mask/flags snapshots, callback or unknown ACE rejected. Never
return a private-ACL boolean instead of the snapshot. Native parity is later D5;
source review alone cannot prove PowerShell provider equivalence.

One strict no-BOM UTF-8/LF ready line, then only bounded JSON query replies. No raw
path/exception/ACL diagnostic printing or stderr. Top-level failures return fixed
nonzero exit. Query snapshots remain private transport data, never public logs.
EOF after validated startup returns0, which is closure not action success.

## Deferred proofs (not hidden by source review)

Exact framework JSON reference set, canonical encoder compatibility, native pin
semantics, owner death/GC/crash/pipe loss, CLR loading, same-host clock proof and
time budget require D3/D5/D6. Existing physical before/after checks and action
resource discipline remain required at D4. Current LC2 capacity remains BLOCKED.

Independent source-design review required before implementation.

Independent design review P1/P2=0, P3 peak handle inventory corrected: allow explicit
owner-process/current-identity-token temporary slots (+2 conservative peak for
bootstrap and worker). Max planned bootstrap88/worker40/inherited38 stay inside
the original128/64 application-handle plan and8 logical resources. No native
limit increased. These remain planned, not observed or enforced native totals.
Ready uses the D2a frame with the worker's own creation identity, not its owner's.
