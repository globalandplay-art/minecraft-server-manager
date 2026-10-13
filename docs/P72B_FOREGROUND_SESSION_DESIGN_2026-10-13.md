# P7.2b session-owned remote access

Status: DESIGN INVESTIGATION CHECKPOINT REVIEW PASS. Independent GPT-6.1 Sol High final delta review: remaining actionable document P1/P2/P3=0; two initial P2 corrected and verified at Attempt1. Signoff only permits continued transport/session investigation, not production wiring or a safety-contract substitution. Production implementation and real acceptance remain pending.

## Authorized lifecycle

On 2026-10-13 the user selected: close the Tailscale ingress when Manager exits; after restart require explicit manual enablement. This selects lifecycle behavior, not authorization to change the live Tailnet. No real Serve/Funnel command, daemon mutation, network setting, credentials or Minecraft operation is authorized by this decision. Baseline commit is `d4c0ab3623a64269a224bfe08368d633520d06bd`; prior Mock integration and its validation remain historical valid evidence for unchanged code, not evidence for this new backend.

## Native source evidence, pinned v1.98.8

- [CLI foreground flow](https://github.com/tailscale/tailscale/blob/v1.98.8/cmd/tailscale/cli/serve_v2.go#L414-L525): obtains config/ETag, opens a WatchIPNBus subscription, receives daemon SessionID, adds a nested Foreground entry, conditionally publishes config, then keeps reading the watch. HTTPS CLI also invokes an interactive feature-enablement flow; do not reuse it for unattended mutation.
- [Watch lifecycle](https://github.com/tailscale/tailscale/blob/v1.98.8/ipn/ipnlocal/local.go#L3072-L3172): daemon generates a session identifier, registers the watch, and defers DeleteForegroundSession when the watch ends.
- [Session removal](https://github.com/tailscale/tailscale/blob/v1.98.8/ipn/ipnlocal/serve.go#L390-L402): removes only the matching Foreground key under the daemon mutex. Other foreground/background entries are preserved by this operation. The watch defer does not report a removal failure to Manager; transport close alone is not verified cleanup.
- [Conflict validation](https://github.com/tailscale/tailscale/blob/v1.98.8/ipn/ipnlocal/serve.go#L1543-L1591): new foreground listeners cannot take existing ports; background listeners cannot take foreground ports.
- [Conditional publication](https://github.com/tailscale/tailscale/blob/v1.98.8/client/local/serve.go#L18-L50): content ETag/If-Match, not a monotonic ownership receipt. Preserve the existing analysis of ABA and lost replies.
- [Watch client](https://github.com/tailscale/tailscale/blob/v1.98.8/client/local/local.go#L1221-L1251): an HTTP response stream owns the subscription lifetime. Actual Windows transport/authentication and endpoint identity must still be verified before implementing a native client.
- [Windows named pipe](https://github.com/tailscale/tailscale/blob/v1.98.8/safesocket/pipe_windows.go#L18-L41): upstream uses identification impersonation level for client access checks. A generic Node pipe connection is not yet shown equivalent; the pipe's users/system ACL is not server identity proof. Do not assume ordinary localhost HTTP or macOS token discovery is the Windows transport. Native endpoint identity, Windows client token semantics and Node compatibility remain unverified.

These establish a candidate daemon lifetime mechanism, not native Windows acceptance. Ordinary child-process spawn is insufficient: a CLI process can outlive its parent. Neither graceful signal handlers nor a PID stored in a journal proves crash containment. Prefer a subscription owned directly by Manager; any helper alternative must prove parent-death containment before admission. Do not add an unreviewed privileged helper or depend on global process killing.

## Capability contract boundary

Do not pretend this backend implements `TailscaleAtomicBridge`. Keep the existing Fake tests and bridge unchanged. A separately reviewed session-specific adapter contract must distinguish:

1. Manager lifetime identity and daemon-assigned watch/session identity.
2. Conditional config publication with the exact prior ETag.
3. Manager durable intent and separately observed daemon state, without claiming atomic receipt/config commit.
4. Admission: exact authorized target, live owned watch, current config and no conflicts; uncertain ownership closes admission.
5. Session loss: close admission; no automatic reconnect or Serve recreation.

ETag only protects the write against content changes. It cannot prove an external ABA did not occur or bind Manager authorization inside daemon commit. Final reauthentication occurs immediately before the conditional request after all awaited checks; record the residual request-in-flight window accurately. This is a contract revision proposal, not permission to weaken existing tests or substitute guarantees silently. Session ownership plus fail-closed target admission must be independently reviewed as sufficient for the original requirements before production wiring.

## Enable and disable ordering

Enable candidate sequence: obtain Access lock and Manager owner -> read-only dependency/Tailnet/HTTPS/config/Funnel checks -> reserve exclusive Manager loopback listener with admission CLOSED -> open bounded owned watch and receive session identity -> refresh config/revision -> persist and verify intent -> final synchronous administrator authorization/owner/watch/closing check -> one If-Match publication adding only the owned session -> read current state and verify session/config/target/liveness -> synchronous session/reauth/owner/watch/closing recheck immediately before opening authenticated admission -> persist terminal evidence. Publication conflict fails without retry. Lost publication/verification response stays recovery_required; close admission and owned watch, do not infer success from config equality.

One fail-closed cleanup path covers every failure after acquiring a listener or watch, including admission-open error, cancellation, authorization loss and final terminal-evidence append failure. Close HTTP/WS admission first and preserve durable intent/evidence. Settle in-flight publication within an independent bounded cleanup window where possible, then close only the owned watch and verify exact session absence. If publication or removal cannot be uniquely confirmed, retain recovery_required and block new enablement/target reuse; do not claim success because admission temporarily opened. This teardown never overwrites another client's config. Failure during cleanup remains explicit, never swallowed into a successful operation.

Disable candidate sequence: authenticate/reauthenticate and serialize operation -> persist intent -> close HTTP and WS admission and drain/close owned ingress connections -> close only the owned watch -> bounded read-only verification that its exact session is absent -> persist terminal evidence. No `serve reset`, global `off`, or mutation deleting another session. Existing user config is checked and retained. If session removal cannot be confirmed, report recovery_required; do not claim the route is removed merely because its target rejects traffic.

Shutdown follows the same admission-first order without reopening a route. Manager crash closes its directly owned subscription and target sockets at OS process teardown; daemon removal and its timing still need native proof. No promise of instantaneous removal. Manager restart never resumes a previous watch or applies a network mutation. Previous nonterminal operations remain behind recoveryRequired until explicit evidence-only recovery; a previously succeeded enable is historical, not evidence of current enabled state. Fresh current state remains disabled/unavailable/conflict/recovery_required as observed. A new manual enable needs a new admission check, never replay of an old enable key.

**Publication/watch-close race is a production blocker, not solved by session choice.** In pinned `local.go`, watch registry deletion is deferred at3133-3137 before the foreground-deletion defer at3162; LIFO executes foreground deletion first. A queued config POST can interleave between these two daemon-lock sections: session deletion runs, POST adds its entry while the watcher is still registered, reload retains the entry, then watcher registry removal runs without another deletion pass. This is a source-derived possible interleaving, not an observed host failure. Inactive-session pruning on a later reload is not immediate cleanup proof. Graceful shutdown must close admission and boundedly settle an in-flight publication before closing its watch; canceling a request or killing Manager cannot prove the daemon canceled that POST. Abrupt crash still requires a supported invariant or native evidence closing this race before production enablement. Ambiguous publication/cleanup remains recovery_required; no automatic retry, success claim or target reuse.

Port reuse requires special attention: no new target can be admitted while an old matching session is unconfirmed. Unknown/stale proxy routes must not become a path to a reused local service. The controlled ingress must require a validated provider-specific authority/profile and Manager authentication; a loopback request or untrusted forwarding header alone grants nothing. Unrelated processes accidentally inheriting a stale target port cannot be declared protected by Manager; absence verification/native teardown is a required acceptance boundary.

## Separate authenticated ingress prerequisite

Keep direct local HTTP behavior and its local Session profile unchanged. Add an immutable, internally configured Tailscale HTTPS authority and an exclusively bound `127.0.0.1` target, with admission closed by default. No caller supplies ports, paths, commands or profiles. Remote HTTP and WS share the existing account/session core using remote-https Secure/HttpOnly/SameSite cookies and profile-aware Origin/CSRF checks. Preserve the trusted-local-OS-user assumption; do not invent Tailnet header-based admin authority or require unapproved same-user process attestation. No global trustProxy or public bind. URL and remoteVerifiedAt remain null until their respective verification gates are met; local checks never set remoteVerifiedAt.

## Required verification before implementation PASS

- Static Windows transport/daemon identity and version compatibility investigation; actual installed native compatibility is NOT RUN.
- Deterministic session-specific tests: conflict and conditional-write rejection; duplicate/replayed keys; response loss; external config/foreground drift; watch closure; daemon restart; no implicit reconnect; unknown ownership; forbidden global mutations zero; original configs intact.
- Admission/HTTP/WS tests: exact authority/profile, cookie separation, forged headers, unauthenticated access, revoked/expired sessions, CSRF, invalid origins, existing local interface unchanged.
- Process crash tests with a fresh owner: session/helper cannot survive independently; admission/target closes; no automatic restart; no false terminal success. Fake tests cannot substitute for native daemon cleanup proof.
- Graceful close and interrupted-close: owned connections drained, exact session absence, target port release and stale-port reuse negatives. Cleanup uncertainty retains evidence and blocks new enablement.
- Frozen full regression, three-width browsers, independent Sol High source/evidence review. Real remote/native network mutations remain separately authorized.

## Checkpoint and issue ledger

- Lifecycle selection: CONFIRMED by user. Independent Sol High design/delta review PASS in the document scope; no product behavior changed.
- FG-AUTH-ORDER-001 / P2 / RESOLVED at Attempt1, independently verified: initial design placed final authorization before awaited intent publication. Corrected to synchronous authorization immediately before conditional dispatch and after awaited observation before ingress admission. Static document finding; NO_EXPLICIT_ERROR_CODE, no runtime log.
- FG-FAIL-CLOSE-001 / P2 / RESOLVED at Attempt1, independently verified: initial design omitted final-evidence-write failure cleanup after admission opened. Added one admission-first cleanup path for all failures after listener/watch acquisition, preserving evidence and reporting uncertainty. Static document finding; NO_EXPLICIT_ERROR_CODE, no runtime log.
- TS-PROD-SESSION-001 / HIGH / implementation prerequisite: Windows transport identity and crash-safe session ownership have not been proven. No runtime error or explicit error code; no native test executed. Repair count0/2.
- TS-PROD-SESSION-RACE-001 / HIGH / production blocker: queued publication can interleave with watch teardown before watcher registry removal in the pinned source. Static possible interleaving, not a live failure. NO_EXPLICIT_ERROR_CODE; repair count0/2. Do not wire production enablement until crash/queued-publication safety is independently established; graceful sequencing alone does not close the abrupt-crash case.
- TS-PROD-CONTRACT-001: historical strong Fake contract mismatch retained; this proposal does not resolve or rewrite it. Session-specific semantics require an explicit reviewed boundary.
- TS-PROD-INGRESS-001: authenticated remote ingress remains unimplemented; no current authentication relaxation.
- P7.2b complete ENGINEERING remains BLOCKED/INCOMPLETE. REAL REMOTE ACCEPTANCE NOT RUN/NOT AUTHORIZED. No new regression claimed, commit/push/PR or real network operation in this checkpoint.

Next implementation slice after design signoff: prove the Windows local transport/session boundary, then implement the dedicated ingress profile and isolated HTTP/WS admission tests. Keep production provider unavailable until both admission and owned-session safety gates are satisfied.
