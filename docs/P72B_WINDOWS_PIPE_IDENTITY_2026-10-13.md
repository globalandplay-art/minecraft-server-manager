# P7.2b isolated Windows pipe identity investigation

## Current result: isolated identity primitive PASS

Probe helper-progress repair Attempt1 added only `$ProgressPreference='SilentlyContinue'` to each fixed PowerShell script, with ErrorActionPreference=Stop retained. Warning/error preferences, stderr rejection, identity assertions, output caps and deadlines are unchanged. [Microsoft PowerShell preference documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables?view=powershell-5.1#progresspreference) specifies that this controls progress display in the current script scope; it is not an error/WARN classifier rule. No production script or system preference changed.

Independent Sol High pre-run review found no new P1/P2/P3 findings. Frozen script SHA-256 `F62F9938C3230CF79A0DD4A09D12C0CC0F9D015BB87799CE6465749BBBF7D96B`. One execution: `test-results/p72b-pipe-identity-6a2de1f8-79bc-47f6-b3ec-e311303a740e.json` (Git ignored), native exit0/result PASS.

Observed Node22.23.1/libuv1.51.0 default client level=Impersonation; explicit .NET client level=Identification. GetNamedPipeServerProcessId matched the owned mock server PID. Both helper stderr counts0, exitCode0/exitSignalnull, helpersClosed=true, remainingOwnedSockets0. Original default-client level was observed, not forced by an assertion. This validates only these primitives against this random mock pipe and owned processes, not a real Tailscale daemon or server executable/signature identity.

Independent Sol High final read-only review confirmed frozen hash, report/source agreement, bounded cleanup and correct mock-only scope; no new P1/P2/P3 findings. Probe progress repair Attempt1 is closed, while production blockers remain open.

PIPE-PROBE-CONNECT-001 remains RESOLVED at its separate Attempt1. PIPE-PROBE-HELPER-DIAGNOSTIC-001 is RESOLVED for the probe at Attempt1: controlling the explicit progress stream removed this observation without relaxing any stderr gate. Historical payload contents remain unrecorded/UNKNOWN and historical BLOCKED results are not rewritten. No extra execution after PASS. Syntax/lint/diff native0; no product source change or new full-regression/typecheck/build claim.

Next: design a supported Windows client explicitly requesting Identification, with retained connection/peer identity and authenticated ingress boundaries. Do not wire generic Node pipe transport on an equivalence assumption. Mock PID agreement does not attest the real daemon image, signature, service ownership, endpoint authorization or foreground-session crash cleanup. TS-PROD-SESSION-RACE-001, native production transport and ingress remain open; complete P7.2b remains BLOCKED, real remote NOT RUN/NOT AUTHORIZED. Production repair count0/2. No Tailscale invocation, system/network changes, credentials, Minecraft or commit/push/PR.

## Latest role-specific bounded diagnostic observation

Candidate SHA-256 `AC92EF47E39F11B4B6914E7C1B1BF7F9C641F6F8D8CAA483F35CD2FE6CAFBE67`. Only the isolated probe gained fixed role labels, stderr byte counts and bounded in-memory format/stream-label observation. All stderr still blocks; original output is never serialized and its retained reference is cleared after classification. Static classification fixtures4 PASS, syntax/lint/diff exit0. Independent Sol High pre-run P1/P2/P3=0. No product source changed.

One execution: `test-results/p72b-pipe-identity-bb9f6e5d-1dff-4be8-9137-63dffe47ec4f.json` (Git ignored), native exit1, BLOCKED/OWNED_HELPER_DIAGNOSTIC. MOCK_SERVER and IDENTIFICATION_CLIENT each emitted393 stderr bytes. Both buffers began with the PowerShell CLIXML marker; detected S labels were exactly [progress]. No error/warning labels were detected by this limited observer. This is NOT a strict XML validity/completeness or harmless-payload proof. Exact progress payload/source component remains UNKNOWN; do not infer Add-Type alone caused it (the server script has no Add-Type).

Both helpers closed with exitCode0/exitSignalnull; sockets0, helpersClosed=true, nodeConnectErrorCode=NOT_OBSERVED. Identity/PID assertions still did not run past the diagnostic gate. Native Tailscale compatibility and endpoint identity remain NOT_VERIFIED, realDaemonCalled=false, productionMutations0. No rerun after the observation. Historical two reports retained unchanged.

PIPE-PROBE-HELPER-DIAGNOSTIC-001 now has CONFIRMED format/role/byte-count evidence, but the complete stderr semantics remain UNKNOWN; substantive fixes0/2. This was diagnostic enrichment, not a repair or bypass. Next reviewed option is to control only the probe's PowerShell progress stream explicitly, preserving warning/error blocking and all identity assertions, or implement a strict bounded CLIXML observer. Neither option has been applied. Do not broaden a Tailscale classifier based on this mock evidence. Complete P7.2b remains BLOCKED; no real provider operation, credentials, Minecraft or commit/push/PR.

Independent Sol High post-run review confirmed hash/report/document consistency and sufficient owned cleanup evidence, with no new P1/P2/P3 findings. The existing diagnostic evidence gap remains open; this review does not convert BLOCKED into PASS.

## Latest checkpoint: address fix verified; independent helper diagnostic BLOCKED

The historical run below is unchanged. A static, no-pipe evaluation of its exact net.connect expression produced a literal `${pipeName}` instead of the supplied sentinel. In the String.raw template, the preceding backslash escaped interpolation. This is a confirmed probe address defect, not a Windows ACL or Tailscale defect.

Attempt1 changed only the probe to concatenate the normal named-pipe prefix with its UUID name and retain Node connection error codes from a fixed whitelist (or UNCLASSIFIED_NODE_ERROR). No message, stack, syscall path or raw output is recorded. Static exact-address assertion and syntax passed. Independent Sol High pre-run delta review P1/P2/P3=0; candidate SHA-256 `383D1A170385988B006E5E959C82116683A8A504A5B343AEC5D6521AB785F85F`.

One new isolated execution produced `test-results/p72b-pipe-identity-27d11fbb-3988-48eb-9f37-19f35317fb08.json`: native exit1, BLOCKED, OWNED_HELPER_DIAGNOSTIC; nodeConnectErrorCode=NOT_OBSERVED. Both owned helpers exited0/signalnull, helpersClosed=true, remainingOwnedSockets=0. The Node handshake completed sufficiently to launch the second client, so the original address/connect issue is resolved at probe Attempt1. This does not imply the entire probe passed.

The new failure means at least one helper emitted stderr. Raw stderr was deliberately not stored; the current report does not identify which helper or diagnostic text. Both process exits0 cannot override this fail-closed gate. Level/PID comparison was not verified or reported because the diagnostic gate precedes those assertions. Do not infer that the stderr is harmless, that Identification succeeded, or that a specific PowerShell/JVM component caused it.

PIPE-PROBE-HELPER-DIAGNOSTIC-001: new independent P2 investigation blocker, root cause UNKNOWN, substantive fix attempts0/2. No additional run or repair after observing it. Next smallest change is role-specific, fixed-format helper diagnostics retaining only reviewed classifications, never raw stderr; review before a newly bounded execution. PIPE-PROBE-CONNECT-001 is resolved by Attempt1. Production transport/session-race/ingress blockers and production repair0/2 remain unchanged. Real Tailscale NOT RUN. No product source, system/network, credentials or Minecraft changes; no commit/push/PR. Lint exited0. Historical evidence remains preserved.

Independent Sol High post-run read-only review confirmed the candidate hash, Node-handshake/address-fix evidence, report/document agreement and owned-helper/socket cleanup. No new review findings; the existing helper-diagnostic P2 remains open. Syntax/lint/diff checks exited0; no new full regression, typecheck or build is claimed for this standalone investigation.

## Scope and frozen candidate

No production source changed. No real Tailscale daemon, Serve/Funnel, network configuration, credentials or Minecraft were accessed. The approved fixed install path did not contain tailscale.exe; that does not prove absence at every possible installation path.

Probe: `tests/acceptance/p72b-windows-pipe-identity.mjs`. SHA-256: `AFC05CA38EE80B060EA807C527E8D610F7C80CE09291A4613D0CB2FB4D355D2A`. Independent Sol High pre-run delta review P1/P2/P3=0 after closing a static socket-cleanup wait issue. The probe uses a fresh random mock pipe, fixed PowerShell executable, owned child handles, bounded output, 30-second work deadline and separate shared 5-second cleanup deadline. No raw stderr, identities, tokens or ACL snapshots are emitted.

Intended measurements: observe Node's default pipe impersonation level; compare an explicit .NET Identification client; match GetNamedPipeServerProcessId against the owned mock server process. These are mock primitive observations, not proof of Tailscale endpoint authentication or daemon compatibility.

## One controlled execution

Evidence: `test-results/p72b-pipe-identity-ba56b178-f5c9-4439-9ba5-f18027715ef9.json` (Git ignored). Node22.23.1/libuv1.51.0. Native exit1; result BLOCKED.

```text
errorCode: MOCK_NODE_CONNECT_FAILED
helpersClosed: true
remainingOwnedSockets: 0
owned server exitCode: null
owned server exitSignal: SIGTERM
realDaemonCalled: false
productionMutations: 0
realEndpointIdentity: NOT_VERIFIED
```

Node could not complete the mock connection. Its original OS error code was not preserved by this candidate's fixed classification; NO_EXPLICIT_OS_ERROR_CODE_RECORDED. No impersonation level, explicit Identification result or peer PID match was measured. Do not infer ACL noncompliance, sandbox denial, SQOS incompatibility or a daemon defect. The second helper was not launched. Cleanup confirmed the owned server's close and no remaining owned sockets; SIGTERM is deliberate probe cleanup, not normal exit0.

## Issue ledger and next action

Post-run independent Sol High read-only review confirmed the frozen script hash, report/source agreement and sufficient owned-resource cleanup evidence; no new review findings. Investigation result remains BLOCKED and the recorded P2 evidence gap remains unresolved. Main-thread syntax, lint and git diff --check exited0. No product source changed; no full regression/typecheck/build rerun or new production PASS is claimed. No commit/push/PR.

- PIPE-PROBE-CONNECT-001: BLOCKED investigation, P2 evidence gap. Trigger is MOCK_NODE_CONNECT_FAILED at the Node socket error handler. Root cause UNKNOWN; actual substantive repair attempts0/2. One probe execution used; no rerun performed. This does not supersede or invalidate the earlier, different successful session-boundary probe.
- PIPE-PROBE-CLEANUP-001: resolved static pre-run P2. Registered socket close promises before destroy and included them alongside owned child close promises in the shared cleanup deadline. Independent delta review confirmed closure before this execution.
- Existing production session race, native transport identity/crash guarantees and authenticated ingress blockers remain open. Complete P7.2b remains BLOCKED; real remote acceptance NOT RUN/NOT AUTHORIZED.

Next smallest step is a reviewed diagnostic change retaining only a bounded whitelist of Node error codes (never message, stack, syscall path or raw output), followed by a separately bounded investigation if appropriate. Do not claim the failed connection demonstrates the anticipated impersonation-level difference. No production workaround, relaxed permission check, real daemon test or broad process cleanup is justified by this result.
