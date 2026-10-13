# P7.2a-1 Read-only Access Inventory

Status: scoped implementation and affected validation PASS. This is not the full durable Access Coordinator or P7.2b Tailscale prerequisite Gate.

`GET /api/v1/access/methods` returns a strict shared response contract. Local authenticationRequired reflects the actual installed HttpAuthentication, not a guessed stored setting. The endpoint shares existing global authentication/session/audit and Host/Origin/forwarded-header boundaries and responds with no-store.

Tailscale and Cloudflare are independent fixed capability entries: implemented=false, desiredEnabled=false, observedState=unknown, managementMode=external, null connectionUrl/remoteVerifiedAt, all write/preflight capabilities false. Desired defaults do not describe real host configuration. Reads have no CLI, network, filesystem, listener, operation or configuration side effects. No write endpoint was added. Returned objects are fresh per read.

## Validation

- Current affected tests: access-methods, HTTP authentication and WS authentication: 84 PASS, native exit0. Earlier 83-PASS checkpoint preceded one additional strict-contract negative case; final84 is the current candidate.
- Lint/typecheck/production build passed; existing Vite chunk warning retained. Diff check passed.
- Independent GPT-6.1 Sol High read-only source review: P1=0/P2=0/P3=0.
- No UI behavior changes or real remote/Minecraft actions. Prior1429-PASS regression is a historical P7.2 baseline, not a new full regression of these added files. Full Access Coordinator/remote engineering Gate remains pending.

## Remaining prerequisites

Before any remote mutation: design and review private durable configuration identity/publication, stable operation/revision/idempotency with mutually exclusive admission and restart reconciliation, and a shared administrator recent-reauth authorization seam. These are not provided by this read-only class. Reuse established operation/private-publication safety patterns; do not create an unreviewed alternative journal. Existing local HTTP profile and strict proxy rejection must not be relaxed to add ingress.

Next: durable Access Coordinator design/implementation under Sol High, single writer, fake/mock resources only. Tailscale A/B/C gates and real Serve authorization remain separate. No commit/push/PR in this slice.
