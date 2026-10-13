# P7.2b production feasibility and ingress design checkpoint

Status: **PRODUCTION FEASIBILITY INVESTIGATION COMPLETE**; independent GPT-6.1 Sol High design/delta review PASS, remaining actionable P1/P2/P3=0 in this design document. This is a design/source investigation, not provider implementation or real acceptance. The preceding C Mock integration remains PASS; complete P7.2b remains BLOCKED. Lifetime semantics question is pending; no alternative selected or implemented automatically.

## Verified repository boundary

Branch `codex/phase-4-players-properties`, HEAD `d8f2a1a5f6f6c72db9ad61f032616baf74c57789`. Existing dirty P7.2a/A/B/C source and evidence are preserved. `main.ts` constructs Access operations without a production provider. `app.ts` creates unavailable Tailscale control. No production target listener or remote authentication profile is wired.

The current `TailscaleAtomicBridge` in `apps/api/src/services/tailscale-control-adapter.ts` requires atomic full config + ownership + immutable Manager checkpoint receipt, a monotonic daemon epoch/revision including every external same-shape write, a consistent observation containing proof/current head, and final Manager authorization inside the commit boundary. This is an internal Fake contract, not a capability demonstrated for stock Tailscale. Do not present these stronger implementation assumptions as exact requirements quoted from the user's original specification.

## Pinned primary-source evidence

Investigated upstream tag **v1.98.8**, matching the current read-only adapter pin. Latest main branch is not used to establish this tag's compatibility. No installed Tailscale daemon/CLI command was executed.

| Source | Exact location / verified behavior |
|---|---|
| [client/local/serve.go](https://github.com/tailscale/tailscale/blob/v1.98.8/client/local/serve.go#L18-L50) | GET receives ETag; POST sends If-Match from the supplied config. Therefore it is incorrect to say Tailscale has no conditional update capability. |
| [ipn/localapi/serve.go](https://github.com/tailscale/tailscale/blob/v1.98.8/ipn/localapi/serve.go#L23-L69) | Read/write permission checks; POST delegates the incoming config and If-Match to backend; mismatch returns HTTP412. The handler accepts ServeConfig, not a Manager operation receipt or Manager Session callback. |
| [ipn/ipnlocal/serve.go](https://github.com/tailscale/tailscale/blob/v1.98.8/ipn/ipnlocal/serve.go#L283-L388) | ETag is SHA256 of JSON config; SetServeConfig takes daemon mutex, optionally checks ETag, validates config and writes ServeConfig to StateStore. Empty ETag skips comparison. This is content-based optimistic concurrency, not a monotonic external-write sequence. |
| [ipn/serve.go](https://github.com/tailscale/tailscale/blob/v1.98.8/ipn/serve.go#L44-L72) | ServeConfig carries TCP/Web/Services/AllowFunnel/Foreground; ETag is not persisted JSON. No Manager operation/root/directory/receipt schema is present here. |
| [ipn/ipnlocal/serve.go](https://github.com/tailscale/tailscale/blob/v1.98.8/ipn/ipnlocal/serve.go#L1543-L1591) | New foreground listener checks and background/foreground conflicts exist. They are relevant to a potential session-owned design; they do not establish full durable background ownership or stop a privileged external reconfiguration. |

Inference supported by the pinned paths: A -> B -> A returns the same content ETag; plain repeated content reads cannot detect this ABA. ManagerLifetimeLock excludes another cooperating Manager, not external Tailscale CLI/daemon clients. A local durable receipt written before or after a daemon update creates a crash window and is not a config+receipt atomic commit. A callback checked in Node before RPC cannot execute inside the daemon's commit mutex. No alternative reviewed native primitive currently closes these gaps.

This does not prove that every Tailscale version or every deployment architecture is impossible. It proves that **a direct stock v1.98.8 CLI/LocalAPI wrapper has not met, and the inspected interface does not supply, the current Fake atomic bridge contract**. HTTP412 is a documented potential response, not an observed error from this host.

## Ingress is a separate unresolved implementation

Current HTTP guards restrict Host/Origin to localhost8080/local Vite3000 and reject forwarding headers. `HttpAuthentication` uses local-http profile/local cookie; WebSocket handshake similarly fixes local origins. SessionCore has a remote-https discriminator, but its existence is not remote ingress integration. B's target is an injected model, not an allocated live listener.

Before opening an ingress, implement and review the following independent slice:

1. Explicit immutable provider-specific ingress profile, fixed authority and HTTPS external origin; default absent. No request selects provider/hostname/port/profile.
2. Dedicated Manager-owned loopback listener allocated with exclusive bind, not a free-port probe followed by later bind. No public bind, auto startup listener or forwarding to game/RCON ports.
3. Same-origin production assets, REST and WS reuse one account/session core; remote cookie profile includes Secure/HttpOnly/SameSite with independent local behavior retained. Login/logout/reauth/audit and every mutation/WS admission use the correct profile.
4. Reviewed provenance and configured-authority boundary for the selected local proxy, explicitly retaining PHASE7_PLAN's trusted-local-OS-user assumption. Loopback source or client-supplied Tailscale/X-Forwarded headers alone cannot select a remote profile or bypass Manager authentication. Direct8080 remains on local guards. Adversarial same-user native process attestation is not added as a mandatory product requirement here; stronger attestation would be a separate proposal.
5. Exact Host/Origin and duplicate/forwarding ambiguity denial; no trustProxy=true. Unknown transport, lost owner or recovery closes admission before provider cleanup. No claimed connected URL until actual verification.
6. Isolated HTTP/WS positive and negative tests, spoofed direct8080 bypass tests, Secure cookie/session separation, safe owned-child teardown, then new frozen regression/browser/review. Real remote phone/device/HTTPS verification remains separately authorized.

No production ingress code is wired in this checkpoint: applying local-origin exceptions before proving provenance would weaken current authentication boundaries.

## Concrete architectural alternatives (proposals, not selected implementations)

| Alternative | What it changes | Gate and limitation |
|---|---|---|
| Keep current strong bridge contract | Obtain a reviewed provider-side primitive that commits ownership/receipt/config with monotonic external-write identity and supported authorization protocol. | Stock inspected endpoint is insufficient. Do not silently install/patch Tailscale, fork daemon or introduce a privileged helper as if authorized. No implementation promise without viable supported primitive. |
| Capability-specific native adapter | Separate provider ETag OCC from Manager durable intent/recovery. Lost/ambiguous response remains recovery_required, never config-equality success or retry. Explicitly document what cannot prove ownership/ABA and reject mutations when evidence is insufficient. | Requires a reviewed contract revision and tests before replacing the current Fake model. Do not relabel content ETag as monotonic identity or remove current safety tests simply to make a wrapper pass. Persistent background route ownership remains unresolved without a sufficient additional mechanism. |
| Session-owned foreground Serve | Investigate native session-scoped resource identity and removal tied to the owned watch/helper lifetime rather than a durable shared background route. | Candidate investigation only. Manager exit semantics differ from persistent background Serve; restart must report actual removal/degraded state and never re-enable automatically. Native Windows identity, conflicts, teardown and external mutation behavior must be proven first. Not an approved substitution for the existing bridge. |
| External management mode | Manager does not mutate Serve, later implements an explicitly configured authenticated ingress and truthful read-only status. | Preserves user config; does not fulfill the requested Settings Enable/Disable feature. Do not mark whole P7.2b complete. Actual external configuration still requires user authorization. |

Recommended sequencing: freeze a reviewed capability/ownership/recovery contract before creating a mutation backend; independently design the authenticated ingress profile. Foreground session ownership is worth investigating as a narrow native alternative, but no claim of safety or automatic selection is made here. The current strong contract must not be replaced behind the user's back by weaker guarantees.

## Issue ledger and execution record

**TS-PROD-CONTRACT-001 — HIGH / HARD BLOCKER for the current native bridge.**

- Problem: current atomic bridge assumes provider-side capabilities not present in the inspected stock endpoint.
- Locations: `tailscale-control-adapter.ts` interface/comment; `main.ts` absent adapter; upstream pinned methods above.
- Actual error code: **NO_EXPLICIT_ERROR_CODE**; this is a static architectural mismatch, not a failed live command. Existing application refusal codes remain ACCESS_UNAVAILABLE / TAILSCALE_ATOMIC_CONTROL_UNAVAILABLE. HTTP412 is reference behavior only.
- Raw runtime error/log: none produced in this investigation; no native mutation/test was run. Source evidence is linked above; preserve previous diagnostic logs unchanged.
- Attempts: underlying implementation repair count0/2. No failed repair or additional full-regression retry.
- Safety state: production writes unavailable, no new listener, remoteVerifiedAt/URL null, no real credentials/Minecraft/provider/system changes. No Git publication.
- Next: architecture decision and sufficient native identity primitive, with independent Sol High signoff before changing the existing bridge/production admission.

**TS-PROD-INGRESS-001 — HIGH / implementation pending.**

- Missing dedicated ingress/provenance/profile integration; current local-only guard intentionally rejects remote authority.
- No observed runtime error; no insecure exceptions implemented. This is not a new failure of the previous local authentication Gate.
- Next: reviewed ingress design then isolated tests, keeping one writer for auth/lifecycle/recovery.

Verification this checkpoint: source inspection, pinned upstream review and documentation diff only. Previous1579 regression and browsers6+3 remain historical current-code evidence, not newly run tests for a backend that does not exist. Main-thread349/349 candidate fingerprints remain unchanged; documentation diff native0. Independent first design review found P2 wording imposing stronger native attestation than the established trusted-local-OS-user threat model; corrected at Attempt1. Independent final design review remaining actionable P1/P2/P3=0; it reviewed sources/design, not test execution or independently recomputed hashes. No commit/push/PR; no real Serve/Funnel, LocalAPI call, Tailscale installation/login, DNS/proxy/firewall/ACL change or server launch.

**TS-PROD-SCOPE-001 — P2 / wording RESOLVED, Attempt1.** Initial ingress design wording could impose adversarial same-user process attestation as a new mandatory gate. Corrected to existing configured proxy/authority boundaries and trusted-local-OS-user assumption. Stronger native attestation is a proposal only. No explicit runtime error code; static scope finding. No product code or tests changed.
