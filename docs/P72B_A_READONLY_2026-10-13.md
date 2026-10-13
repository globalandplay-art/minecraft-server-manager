# P7.2b-A — Tailscale read-only discovery

Scope: read-only dependency/status discovery, authenticated API and Settings presentation. No provider mutation adapter, remote ingress or enable/disable UI is implemented here. P7.2a foundation remains the preceding completed engineering checkpoint. P7.2b-B/C and real remote acceptance are not completed by this report.

## Architecture and security

- Startup and cached GET execute zero CLI commands. Initial desired state is disabled, management is external, observed state is unknown, URL and remoteVerifiedAt are null.
- Explicit preflight reuses configured administrator authentication, Session, CSRF/Origin/Host, audit and recent reauthentication. Authentication is required even in legacy anonymous-local mode. Final admission rechecks authorization after waits. Concurrent preflight is rejected.
- Only fixed read commands exist: version; serve --help; serve status --help; status --json; serve status --json. No shell, user arguments, PATH executable lookup, Serve/Funnel creation/reset, installation or login.
- Fixed Windows executable identity is checked before and after execution. Read-only Authenticode and ACL checks reject untrusted owners, write access, links or replacement. Output and deadlines are bounded; only owned child handles are terminated. Unconfirmed close blocks subsequent calls; no raw CLI output, paths, domains, identities or exceptions are returned publicly.
- Exact supported CLI release is 1.98.8. Unknown versions, duplicate JSON keys, unexpected root schema, malformed status and ambiguous configuration fail closed. Any external Serve resource, including nonempty AllowFunnel with false entries, is a conflict; no ownership is inferred from local metadata.
- Valid null Health and CertDomains are handled according to the pinned source. IP syntax and Self DNS-name membership in CurrentTailnet MagicDNSSuffix are validated; this does not compare top-level and Self IP identities or top-level MagicDNSSuffix. A never authorizes mutations or claims ready/enabled. Health failures remain degraded, absent HTTPS remains needs_setup. This wording was clarified during C review; historical validation results are unchanged.
- Controlled remote loopback ingress is not implemented yet. Target remains unconfigured; even healthy Tailscale prerequisites cannot produce ready/enabled or a connection URL. No existing Minecraft/RCON port is selected or exposed.
- Settings displays truthful status and explicit Preflight only. It preserves local management and separate future Cloudflare configuration. No remote URL is advertised as verified.

Compatibility references: [official Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve), [v1.98.8 Serve structures](https://raw.githubusercontent.com/tailscale/tailscale/v1.98.8/ipn/serve.go), [v1.98.8 status structures](https://raw.githubusercontent.com/tailscale/tailscale/v1.98.8/ipn/ipnstate/ipnstate.go). Compatibility beyond that release is intentionally unavailable.

## API

- GET /api/v1/access/tailscale: cached, authenticated, no-store, no CLI execution.
- POST /api/v1/access/tailscale/preflight: strict empty JSON object; recent administrator authorization; no-store; status response, not a durable enable operation. Busy returns 409. Dependency failures return safe fixed status/error classifications.
- Unified methods now advertises Tailscale preflight availability only. Remote implementation and enable/disable capabilities remain false. Existing durable access mutation endpoints still refuse production operations without an adapter.

## Current validation

All commands retained existing test deadlines and configured concurrency.

| Gate | Current result / evidence |
|---|---|
| Affected API/auth/access | 90 PASS, 7 files, native exit 0; test-results/p72b-a-affected-v1.log |
| All Web | 156 PASS, 28 files, native exit 0; test-results/p72b-a-web-all-v1.log |
| Contracts | 12 PASS, native exit 0; test-results/p72b-a-contracts-v1.log |
| Browser | 360/768/1440, 3 PASS, native exit 0; p72b-a-browser-c494d81f-fbb8-44a3-9d50-aa45e96c2251 |
| Browser teardown | owned child close confirmed and port released |
| Lint | native exit 0; test-results/p72b-a-lint-v2.log |
| Final typecheck | native exit 0 |
| Final production build | native exit 0; Vite 534.20 kB chunk warning retained |
| Diff check | native exit 0 |
| Candidate fingerprint | 18 source/test/runner files; test-results/p72b-a-frozen-v1.json |

This is the A-stage required validation, not a new complete project regression. The preceding P7.2a 1488 full PASS remains historical evidence for that candidate. P7.2b-C requires its own frozen full regression after implementation.

Native host lookup found no fixed-path Tailscale installation. One actual production-runner preflight returned TAILSCALE_UNAVAILABLE before spawning any helper or CLI. Trusted installed Windows executable, actual daemon schemas, real Serve and phone access are NOT RUN. Windows runner signature/ACL/timeout behavior is covered with mocked children/filesystem; it is not native installed-provider acceptance.

## Issue ledger and retained history

| Issue | Severity / outcome | Evidence and resolution |
|---|---|---|
| TS-A-OWNER-001 | P2 / RESOLVED, Attempt 1 | ACL write entries alone did not exclude an unprivileged owner with implicit control. Added trusted-owner and reparse checks; focused/affected validation and independent source review passed. No explicit runtime error code. |
| TS-A-FUNNEL-001 | P2 / RESOLVED, Attempt 1 | Nonempty false-only AllowFunnel configuration was initially treated as empty. Any occupied map now conflicts; exact tests passed. No explicit runtime error code. |
| TS-A-STATUS-001 | P3 / RESOLVED, Attempt 1 | Added IP syntax/DNS suffix membership checks and valid null CertDomains handling; malformed checked fields reject, absent certificates remain needs_setup. Not a cross-field IP identity binding (C review clarification). Targeted regression passed. No explicit runtime error code. |
| TS-A-BROWSER-001 | P3 / RESOLVED, Attempt 1 | Initial mock Session expiry in 2099 violated the existing eight-hour client bound and showed login. Corrected only fixture expiry to 30 minutes. Existing auth bound, assertions and timeouts retained. BROWSER_ACCEPTANCE_FAILED, native exit 1; subsequent three widths passed. |

Original failed browser run p72b-a-browser-1e48a2a5-b8c3-49b6-b0d5-ac64cf532aca is retained unchanged. Its three failures are not rewritten as PASS. Historical P7.2/P7.2a failures and evidence are untouched. Web jsdom navigation and build chunk warnings are retained, not suppressed.

## Review / delivery

Independent GPT-6.1 Sol High source and final evidence review: P1/P2/P3=0 after the listed fixes. Reviewer confirmed 18/18 current fingerprints, API90/Web156/Contracts12, browser3/native0 and owned cleanup, lint evidence and diff0; final typecheck/build native0 confirmed by the main thread. **P7.2b-A ENGINEERING PASS**. Signoff is limited to A and does not substitute for installed native CLI or remote acceptance. Whole P7.2b remains IN PROGRESS; B/C NOT RUN.

No commit, push or PR. Existing uncommitted P7.2a changes are preserved. Runtime and test-results stay ignored. No Minecraft, original world, real credentials, system permission repair or network configuration operation.

Branch: codex/phase-4-players-properties. HEAD: d8f2a1a5f6f6c72db9ad61f032616baf74c57789. Working tree is dirty with preserved P7.2a and new A changes; no remote fetch/push or claim of refreshed remote state.

Primary A files: API tailscale-readonly.ts and tailscale-cli-read-runner.ts; access routes/coordinator and app integration; shared contracts; web api.ts, PhasePage.tsx and TailscaleAccess.tsx; three API suites, contract and web suites; p72b browser spec/config/owned wrapper. The 18-file candidate manifest records the exact source/test selection. This report, PROGRESS, PHASE7_PLAN and API_SPEC synchronize current status without deleting history.

Next stage after A signoff: P7.2b-B controlled enable/disable, ownership, durable operation/recovery and administrator confirmation using Fake CLI/Daemon only. Actual Tailscale mutation remains separately unauthorized.
