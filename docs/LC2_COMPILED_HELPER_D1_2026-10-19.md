# LC2 compiled ACL helper D1 — launch and ownership design

Status: D1 SOURCE-DESIGN REVIEW PASS after independent Sol High delta review;
no executable build, native execution, default wiring,
capacity retry or member mutation. LC2 remains BLOCKED. This document does not
replace the historical native reports or the 179 PASS / 1 FAIL extraction result.
First review found 2 P2 and 1 P3; the retained review record describes their
resolution. D2 source work is next. No later Gate is passed by this signoff.

## Scope and evidence

The accepted timing sample establishes repeated first-call bundle cost, not
PowerShell startup or Add-Type cost individually. The proposed optimization
removes repeated interpretation/compilation by keeping one action-scoped trusted
bootstrap and creating bounded, fixed-program ACL workers. Performance is UNKNOWN
until separate native Gates. The existing PowerShell transport remains unchanged.

Source anchors:

- `apps/api/src/auth/manager-lifetime-lock.ts`: exact mutation epoch and private
  owner proof; the current API returns wrapped script, not raw proof.
- `apps/api/src/auth/windows-owner-retention-native.ts`: current retained handles
  survive until OS process exit; failed bootstrap alone closes incomplete copies.
- `apps/api/src/services/whitelist-acl-session.ts`: original lazy-start request
  timer, strict frame parser, actual close proof and 40s lifetime.
- `apps/api/src/services/whitelist-action-resources.ts`: register before dispatch;
  uncertain factory leaves an entry that cannot retire; 8 active / 262144 total.
- `apps/api/src/services/whitelist-action-envelope.ts`: owner activity/mutation
  leases, fixed work deadline and shared 5s drain; no release with unknown work.

## Selected source-only topology

Node action -> existing trusted owner-wrapped bootstrap -> fixed compiled worker.
The bootstrap is one noninteractive PowerShell process with a fixed reviewed C#
launcher, inside the first ACL request's original 5s budget. It may compile only
the fixed launcher once; it must not compile the ACL worker at runtime. Its own
lifetime is at most 40s and within the original action deadline; no refresh or
bootstrap restart. No prewarm, persistent service or cross-action process pool.

The bootstrap retains the current owner's real kernel handles using the existing
private capability. A future internal launcher method may duplicate those handles
for child inheritance; no raw-proof getter, PowerShell-text parsing, environment
proof, request-supplied executable or public constructor is introduced. That method
is a later source change with its own parity and independent review Gate.

Use a dedicated future transport, not a fabricated Node ChildProcess. Its close
proof must explicitly distinguish worker OS exit/pipe EOF from bootstrap OS
exit/pipe EOF. No broker message alone sets the existing session's
`closedConfirmed`, and a lost worker-close receipt does not imply worker exit.
The existing session API is not silently repurposed to represent broker events.

Chosen observation authority: the trusted native bootstrap exclusively owns each
worker's process handle, creation-time identity and redirected pipe endpoints.
It waits that actual process handle signaled, obtains the terminal exit result,
observes both output pipes at EOF, closes generation-local handles, and only then
emits a strict terminal witness on its inherited private control pipe. The witness
binds the action nonce, increasing generation number, creation identity, exit
result and fixed closure flags. It contains no arbitrary message/output/path.
Node accepts it only for its exact outstanding registered generation, after all
previous query frames have been consumed and before its shared drain deadline.
This is explicit trust in the reviewed bootstrap's native observation, not an
independent Node worker `close` event. It must use a distinct typed proof in the
new transport. It does not set `WhitelistAclSession.closedConfirmed`.

A generic ACK, process-list result, terminal witness for a different generation,
duplicate/out-of-order event, truncated pipe or broker exit before a complete
witness never retires a worker resource. On bootstrap failure Node cannot recover
the missing process handle or infer a missing witness from Job termination: the
action is CLEANUP_BLOCKED and owner leases remain retained, even if cleanup is
likely. This deliberately sacrifices availability rather than inventing proof.

## Artifact trust and admission

1. D3 build-only work produces a fixed artifact descriptor bound to reviewed
   source, compiler identity, reference assemblies, recipe, architecture and exact
   output hash/size. A sibling manifest cannot authorize its own arbitrary binary.
   Production packaging/provenance is a separate Gate; no environment/path override.
2. Only local fixed-volume canonical artifact paths are candidates. Reject UNC,
   device paths, alternate streams, reparse components, multi-link executable,
   unexpected sidecars or dependency locations. Bound components and byte sizes.
3. The trusted native launcher opens each relevant directory ancestor with
   `FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT`, and the executable
   with `OPEN_EXISTING | FILE_FLAG_OPEN_REPARSE_POINT`; sharing admits reads but
   denies write/delete. Verify actual handle type, final path, file ID, link count,
   private ACL and exact hash from the pinned file, not a second pathname read.
4. Pins stay held across process creation, loader admission, all queries and actual
   worker closure. Recheck handle identity and descriptor binding before dispatch.
   Sharing violations, unsupported pinning or inconsistent identity reject; no
   copy-and-delete or path-only fallback.
5. The worker receives inherited copies of the pins and owner handles at creation,
   before it can execute code. Parent/broker death cannot create a window in which
   a surviving child loses all owner/artifact protection.
6. Use an explicit absolute `lpApplicationName`, fixed arguments, fixed working
   directory, a narrowly constructed environment and explicit standard handles.
   No shell, PATH search, profiling/startup hooks, optional config loading or local
   plugin assembly resolution. Bind platform CLR/system dependencies to supported
   trusted locations. Directory pinning alone does not prevent adding sidecars or
   changing ACLs; deployment immutability and dependency loading must be proved at
   D3, not inferred from a hash. Same-user administrator tampering remains excluded
   from the local trust guarantee.

## Native process creation and handle table

Use `STARTUPINFOEX`, `EXTENDED_STARTUPINFO_PRESENT`, `CREATE_SUSPENDED` and an
explicit `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`. Only temporary inheritable copies
of the required owner/pin/pipe handles are listed. Never inherit a Node process
handle, bootstrap control pipe, unrelated file handle or Job handle. Serialize
creation and close temporary inheritable duplicates immediately after creation.
The worker validates its inherited handles independently before accepting queries.

Create a private unnamed Job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; only the
bootstrap owns its non-inheritable Job handle. Supply it in
`PROC_THREAD_ATTRIBUTE_JOB_LIST` during CreateProcess, rather than assigning a
created child in a later operation. Unsupported Job nesting/assignment is refusal,
not breakaway. Verify process identity and image path against the already-pinned
artifact while suspended, then resume; worker readiness still requires its own
owner/handle validation. Path equality alone is not proof of image bytes.

On bootstrap death, closing the Job requests child termination. Termination is
not synchronous proof of child exit: inherited owner/pin handles retain exclusion
until the OS actually closes them. On Node death the bootstrap detects its held
parent process object's signaled state/control EOF, stops admission and closes the
Job; if cleanup stalls, retained handles continue to fail closed. No unknown PID
termination or reopening lock-by-name to replace owner evidence.

## Resource admission and deadlines

Reserve resources BEFORE side effects, using the existing action capability:

| Resource | Retirement proof |
| --- | --- |
| Bootstrap process/control transport | Actual OS process exit and all Node-side pipes closed; no uncertain descendants. |
| Artifact/ancestor pin set | Every native pin closed and every inherited copy's worker confirmed exited. Explicit bounded handle inventory; not an unbounded bag. |
| Worker generation | Creation outcome known, worker process handle signaled, exit result observed and all worker pipes drained/closed. |

These are logical resources with bounded internal handles, matching existing
composite child resources. Count each generation separately toward 262144, and
count bootstrap + pin set + worker against the existing 8 active ceiling. No
unregistered processes/pin bundles, hiding worker generations, or increasing the
limit. Exact component/handle bounds remain a required D2 implementation review.
If any existing action composition cannot admit all resources, reject before
launch rather than changing budgets. Bootstrap/pin resources must be explicitly
closed inside the action body before successful `seal`; successful result delivery
while still active cannot make the action pass.

For each of these composite resources, the registered `result` promise represents
terminal closure, not readiness. Readiness/query results use separate internal
promises and cannot retire the entry. The action body explicitly requests close
and then awaits each tracked `capability.start` promise before returning; setting
`closedConfirmed` later without settling its tracked result is insufficient for
the existing registry's `#retire`. Unknown creation leaves the tracked promise
unsettled and the resource non-closed; shared drain still observes started work.

Maintain 32-query healthy worker rotation, 64-query hard cap, 8 targets/frame,
existing frame/output bounds, 5s request including all queue/bootstrap/launch time,
20s healthy rotation, 40s worker/bootstrap lifetime, 50s action and shared 5s drain.
Use original absolute deadlines across broker boundaries; no queueing reset,
retries, precomputed ACLs or timer extensions. Bootstrap reaching its lifetime
poisons the action rather than restarting. Only one pending ACL query per worker.

Epoch admission belongs to Node: immediately before each generation dispatch it
rechecks the exact captured owner mutation epoch and action capability, reserves
the generation resource, then issues one strictly ordered internal launch permit
on the already-bound control pipe. The permit binds action nonce, generation,
artifact descriptor digest and remaining trusted monotonic budget. No request or
environment can issue a permit. Native code cannot inspect a JavaScript Symbol;
it verifies permit order/identity and held kernel owner instead. Cross-process
time uses calibrated same-host monotonic ticks with a conservative uncertainty
bound; UNKNOWN calibration refuses dispatch. Permit expiry is no later than the
original Node request/action/bootstrap deadline, never receive-time plus 5s.
Cancellation revokes further Node permits and tells the bootstrap to stop. A
permit already dispatched may race cancellation; that generation remains tracked
as started/uncertain and is drained, never classified as zero side effects. No
later permit or successful query result is accepted after Node revocation.

## State and interruption table

| Last known boundary | Permitted next step | Failure/response-loss result |
| --- | --- | --- |
| Nothing reserved | Reserve resources | No native action on failed admission. |
| Reserved, bootstrap creation not dispatched | Dispatch fixed owner wrapper once | Proven no dispatch can retire; unknown dispatch retains entry. |
| Bootstrap started, owner/pins not verified | Validate native copies, artifact and Job | No worker/query; stop and require actual bootstrap close. |
| Pins verified, CreateProcess not called | Node exact-epoch permit; native validates permit/kernel owner/deadline, dispatch once | No automatic repeat after uncertain dispatch. |
| Worker created suspended with inherited pins/Job | Validate process/image and resume once | Close Job; retain until actual worker/pipe closure. No resume retry. |
| Resumed, readiness missing | Wait within original request budget | No query; lost readiness poisons generation/action. |
| Ready and identity bound | Forward one strict numbered query | Lost response is failure; never duplicate query or assume ACL pass. |
| Rotation requested | EOF, wait actual exit and drain worker pipes | No next worker before retirement; uncertainty retains owner. |
| All workers retired | Close pin/bootstrap resources, then finish body | No success before all resources retire. |
| Any deadline/fault/cancel | Seal new admission; one shared bounded drain | Unknown resources => CLEANUP_BLOCKED, retain owner leases/evidence. |

`Job handle closed`, `TerminateProcess succeeded`, EOF, PID disappearance from a
list and a broker ACK are not individually closure proof. A bootstrap crash makes
the primary result fail even if OS cleanup later finishes. Recovery may establish
safe teardown; it cannot rewrite the failed action as success.

## D1 decisions versus later evidence

Selected: one owner-wrapped bootstrap per action; no raw TS proof; native pinning;
creation-time Job and handle lists; inherited protection; dedicated transport;
no retry; original bounds. This is an architecture selection, not executable
correctness or performance evidence.

Before D2 may be accepted, its source must give exact bounded handle inventory,
wire parser/framing and two-level close semantics. Before D3 build/run admission,
prove deployment/compiler/dependency identity and pin coverage. D5/D6 must test
inherited pins and owner exclusion across every creation/resume/response-loss/
parent-death boundary. D7 separately measures all promised capacities. D1 review
must report unresolved P1/P2 rather than treating those evidence Gates as done.

## Primary platform references

- [CreateFileW sharing and directory opening](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- [Explicit inherited handle and creation-time Job lists](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
- [Job lifetime and termination](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Kill-on-last-Job-handle-close limit](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)

The documentation supports platform primitives, not this unimplemented composition.
Windows 11 target support is not evidence that the current host's nested Jobs,
sharing modes, CLR loading or package deployment will satisfy the proposed gates.
