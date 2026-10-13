# P7.2b Windows client implementation boundary

Status: DESIGN INVESTIGATION BASELINE REVIEW PASS; production unavailable. Independent Sol High delta review: document P1/P2/P3=0. Scope is a private, in-process Windows transport design, not Tailscale enablement or acceptance. User selected close-with-Manager/manual re-enable. No actual daemon, network configuration, credentials or Minecraft operations in this slice.

Task-specific review routing: the user's P7.2b instructions explicitly prohibit Astra and require independent Sol High security/final review. This overrides the older model selection guidance, not the underlying Auth/Remote/Adapter safety gates. Preserve every applicable prerequisite/final gate, using independent Sol High under this task authorization. Current document signoff covers design only; transport, integration and final gates remain pending until their own evidence/reviews are complete.

## Evidence and current integration

The isolated pipe probe observed Node22.23.1/libuv1.51.0 default Impersonation versus explicit .NET Identification; mock server PID matched. See [frozen result](./P72B_WINDOWS_PIPE_IDENTITY_2026-10-13.md). This is not daemon executable, service, signature or endpoint authorization evidence.

Current modules live directly in apps/api/src/services. `tailscale-control-adapter.ts` requires TailscaleAtomicBridge atomic config/receipt publication, final authorization within CAS, and monotonic external-write identity. Stock content ETag cannot supply that contract. Preserve this adapter and its Fake tests unchanged. `access-operation-service.ts` and its private durable checkpoints stay authoritative for operations; no parallel simplified journal. Current `tailscale-cli-read-runner.ts` is bounded read-only discovery, not a mutation or subscription backend.

## Selected transport direction

Prefer a Manager-loaded Windows native module with Node-API bindings, so the Manager directly owns pipe handles. Do not substitute Node net.connect or spawn a persistent CLI/PowerShell child. The native module, build/distribution and ABI support are not implemented or verified yet; missing/untrusted artifact means unavailable, with no download, install or fallback.

Candidate source organization after review: `apps/api/native/windows-tailscale-transport/` and private `apps/api/src/services/tailscale-session-transport.ts`. These are proposed locations, not existing files or public DTO changes. A separate session capability will be reviewed before integration; it must not pretend to implement TailscaleAtomicBridge or reuse its stronger receipts as proof.

Use the pinned upstream Windows endpoint internally, with no request-supplied pipe path, PID, executable, command or flags. Open non-inheritable handles using explicit SECURITY_SQOS_PRESENT plus SECURITY_IDENTIFICATION and overlapped I/O. [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) defines SQOS and handle inheritance separately. Do not duplicate handles to children or use a process-independent helper. Manager process death releases its handles; this alone does not prove daemon route cleanup.

## Peer identity before HTTP bytes

Connect -> GetNamedPipeServerProcessId -> retain a minimally privileged handle to that process -> validate process is still live, creation identity and approved service/process binding -> query its image -> validate approved executable identity and file/ancestor protections -> recheck live pipe-to-process binding -> only then permit protocol bytes. Failed/unsupported/ambiguous evidence closes the handle, with a fixed public error code. Do not trust a PID or filename alone. Hold the process and pipe references together; every new connection repeats validation. A daemon restart invalidates the transport; no automatic reconnect or mutation replay.

[GetNamedPipeServerProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid) supplies a PID, not a signature or service attestation. [QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew) supplies an image path; path equality alone is not immutable loaded-image proof. Exact service executable/publisher, service binding and retained image validation remain implementation prerequisites, not facts inferred from the CLI executable. Reuse reviewed trust policy where applicable; do not equate tailscale.exe CLI identity with daemon identity. Trusted local OS administrators remain in the existing threat boundary; this is not protection from a compromised kernel or an administrator replacing all evidence.

## Protocol and cancellation

Transport owns asynchronous bounded reads/writes and handle closure. A new HTTP framing implementation is not implicitly approved: define strict version/status/header/body limits, reject conflicting framing/unknown schemas, and disable redirect, proxy, arbitrary host/path and endpoint access. Permit only reviewed LocalAPI observation/watch/config operations. Watch response is bounded per event with backpressure; do not cap its entire lifetime as a finite response. Separate watch and finite requests must validate their peers independently and bind the same live daemon identity. A session ID on one connection does not authorize a different peer.

No blocking Win32 call on the Node main thread. Cancellation requests CancelIoEx, observes every pending overlapped completion, and retains buffers until completion before freeing resources. Cancelling a local write/read cannot prove the daemon did not apply a request. Use independent bounded cleanup; unconfirmed cleanup closes ingress and reports recovery_required/CLEANUP_BLOCKED without recycling target identity or claiming success. Exact native bounds and event-loop/backpressure behavior require tests before freezing the implementation contract.

## Access and lifecycle

The transport never accepts HTTP request headers as authority and never grants Manager permissions. Session, CSRF/Origin, recent reauthentication, ManagerLifetimeLock, shared Access exclusion and durable intent remain mandatory at service admission. Final synchronous authorization follows awaited intent persistence and immediately precedes dispatch; current authorization is checked again before ingress opens. Responses and audit expose fixed codes and opaque bindings, never raw LocalAPI output, process/image paths, account identifiers or tokens. remoteVerifiedAt stays null.

Shutdown closes HTTP/WS ingress admission first, settles admitted in-flight requests within bounded limits, closes owned watch and confirms exact session absence by read-only observation when possible. It never uses global Serve reset/off. Manager startup performs evidence-only reconciliation, never replaying route creation. Ambiguous results preserve all evidence and recovery_required. The queued-publication/watch-deletion race documented in [session design](./P72B_FOREGROUND_SESSION_DESIGN_2026-10-13.md) is still a production blocker; in-process handles do not solve it. A successful transport primitive cannot authorize enabling a route while that gate remains open.

## Implementation gates and next slice

1. Native build feasibility: identify existing trusted compiler/runtime support without installing tools; specify reproducible artifact and controlled loader. No production wiring.
2. Isolated native transport: fixed test-construction mock endpoint only, Identification, wrong peer/PID reuse/peer exit, handle inheritance, cancellation/timeout/output limits/backpressure, fresh-process crash and owned cleanup. Test seam is not accessible through requests or production environment flags.
3. Strict LocalAPI framing and session-only contract review, durable operation mapping and ingress admission negative tests. Preserve all existing Fake atomic tests. Contract differences must be explicit, never hidden by changing assertions.
4. Solve the existing publication/crash-cleanup invariant before provider enablement. Real daemon/remote mutation tests require separate authorization; do not label mock evidence native daemon acceptance.
5. Fresh applicable regression, browsers and independent Sol High review after actual product integration. No historical1579 test claim for new native code.

Retain the Phase7 assumption of trusted local OS users as well as administrators; this slice does not silently expand the threat model to malicious same-user administration. Peer/identity validation protects the approved connection boundary, without claiming protection against wholesale evidence replacement by trusted OS users. It does not grant those users a Manager Session or bypass Manager authorization.

Issue ledger: TS-WIN-CLIENT-001 implementation/build/trust prerequisites OPEN; TS-PROD-SESSION-RACE-001 HIGH/BLOCKED; TS-PROD-INGRESS-001 OPEN; historical TS-PROD-CONTRACT-001 retained. No new runtime failure or explicit error code in this document-only slice. Substantive production fixes0/2. Complete P7.2b ENGINEERING remains BLOCKED; real remote NOT RUN/NOT AUTHORIZED. No commit/push/PR or automatic Cloudflare/Phase7 Final Gate.

Read-only build availability observation: cl.exe, cmake.exe and node-gyp.cmd are not discoverable in this session's command search. This does not prove no Visual Studio or local dependency installation exists elsewhere. No compiler, package download or installation was executed. Compiler/artifact feasibility remains UNKNOWN pending narrowly bounded inspection of configured development tools.

Review ledger: initial routing concern requested an older Astra model gate; withdrawn after verifying the user's task-specific prohibition and explicit Sol High final-review authorization. All underlying security gates retained. Trusted local OS users wording clarified; delta review confirms no remaining document findings. This is not a production repair attempt. Document-only diff check exit0; no tests, typecheck, build or new regression evidence claimed.
