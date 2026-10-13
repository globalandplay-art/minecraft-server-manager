# P7.2a-2 Shared authorization and durable Access design

Implementation boundary: shared synchronous recent-reauth admission check only. Durable configuration/operations below are a proposed implementation plan, not shipped storage or a remote capability. P7.2a overall remains IN PROGRESS; P7.2b prerequisite Gate remains pending.

## Shared authorization

HttpAuthentication.assertRecentMutation(request) uses the existing local-http SessionCore and audit. It grants no reusable token or cached permission. Existing global Host/Origin/intent/body/CSRF guards remain required. Sensitive handlers must invoke it immediately after awaited preflight and synchronously before service admission; every additional awaited boundary requires another check. Service ownership/revision/recovery checks remain necessary under its resource lock. Session loss after durable admission must not abandon an in-flight transaction.

Missing session401 AUTH_REQUIRED; wrong CSRF403 CSRF_REJECTED; expired recent-reauth403 AUTH_REAUTH_REQUIRED; unavailable audit503 AUTH_AUDIT_UNAVAILABLE; a read request cannot obtain mutation authorization. No transport header assigns identity. Current login/verified reauth semantics and five-minute window are unchanged. Local-http authorization must not be repurposed as a remote-https session bypass.

## Durable resource identity and publication

Remote access is a Manager-wide resource, not a registered Minecraft server. Current OperationService/TransactionJournal contain server-bound invariants. Do not invent a serverId or enqueue remote operations as backup/lifecycle tasks. Extend shared operation contracts with a reviewed resource discriminator and migration/validation before exposing Access operations. Preserve existing server records byte/schema compatibility; unknown Access versions fail closed.

Use one ManagerLifetimeLock owner retained by main for the Manager lifetime, plus serialized in-process Access admission. Scope configuration/journal files to a new fixed private Manager access namespace, independent of auth credentials and Minecraft snapshots. Bind records to lock-proven canonical Manager root and directory/file identities. Paths are server-derived and never public API input.

Reuse private-publication primitives for new protected entries, ACL verification, identity-bound bounded reads, checksum validation, stage sync, same-directory native publication and verified owned cleanup. Do not copy the credential writer as a generic unreviewed journal. Extend/review these primitives only where necessary for Access record format; no recursive ACL repair. Windows directory fsync/power-loss limits and same-user administrative interference remain explicit limitations.

Provider records are separate: schemaVersion, provider, rootIdentity, revision, desiredEnabled=false by default, managementMode=external by default, ownedRoute=null, operationId=null, ownershipRevision=null. Provider-specific Tailscale target is loopback only; assigned targetPort is derived from actual controlled ingress ownership, never client arbitrary input. Never persist sessions, passwords, tokens, cookies or raw CLI output. Public DTO excludes private root/binding identifiers and paths. Unknown/corrupt/missing expected records cannot reset previously owned resources to innocent defaults.

Absent storage means unconfigured defaults in memory only: startup must not create routes, open a listener, run CLI or write intent. Enabling remote capability remains false until persistence, authorization, ownership and recovery Gates pass.

## Operations and restart

Each admitted operation binds UUID id, provider, action, Manager identity, approved configuration revision, hash of canonical validated request, idempotency key and observed resource revision. Same key/same request returns same operation; changed request conflicts. All provider route mutations share a Manager-wide Access lock so an application cannot overlap its own enable/disable commands. Persistence failure prohibits external apply.

Order: validate request/session -> bounded read-only preflight -> acquire admission -> recheck identity/revision/recovery/ownership -> final synchronous recent-reauth -> persist operation and intent -> verify durable publication -> APPLYING -> external adapter -> physical observation -> persist verified terminal result -> release admission. Never infer success from202, CLI exit alone or desiredEnabled. Authorization prior to await is not sufficient.

An intent with uncertain apply outcome is never replayed automatically. Restart inspects private intent/config/operation checksums and identities, then observes real provider state read-only. A proven matching state may reconcile; missing/drifted/ambiguous data enters recovery_required and retains evidence. Local authentication and local entry remain operational; no automatic global network reset or destructive rollback. RemoteVerifiedAt can only be written by a later explicit real-device acceptance record, never local probing.

No CLI CAS proof currently exists. An application lock cannot exclude external Tailscale users. Before offering managed mutation, the adapter design must prove the command cannot overwrite/remove foreign routes across the observation/apply race. Otherwise fail closed with conflict/external management; do not claim that two snapshots solve TOCTOU. Never serve reset or Funnel.

## Required next implementation Gates

1. Independently review resource-discriminator migration and private record publication API; then implement durable storage with injected fake adapter/publication faults and identity fixtures.
2. Test default no-write/no-CLI, schema corruption, root/directory/file replacement, links/hardlinks, ACL denial, publication interruption, duplicate/different idempotency requests, locks and restart ambiguity.
3. Integrate recent-reauth after awaited preflight; test expiry/revocation/audit failure yields zero external writes and no admitted operation. Preserve local entry on failed disable.
4. Only then implement P7.2b-A controlled CLI discovery/status and independent review; B uses fake daemon only; C includes security/browser/new full regression. Real Serve/Funnel/network changes remain unauthorized.

## Current validation and issue history

First new authorization fixture failed: TypeError sessions.reauthenticate is not a function, sensitive-admission.test.ts:30;84PASS/1FAIL,exit1. Fixture-only correction Attempt1 uses existing SessionCore.markReauthenticated; subsequent85PASS/exit0. Final synchronous freshness recheck was added after this checkpoint and requires final candidate focused verification. No test limit/assertion change, no real credentials or system changes. Final current results and independent review will be recorded in PROGRESS.

Final candidate verification:85PASS/native exit0 with final synchronous freshness recheck and explicit awaited-preflight expiry test. Full lint/typecheck/build and final affected-file lint/diff check passed. Independent GPT-6.1 Sol High review P1=0/P2=0/P3=0 for authorization seam and limited design direction. Storage, resource-contract migration and recovery implementation remain unimplemented/unsigned; no full Access or remote Gate PASS is claimed. No current full-suite rerun; historical1429-PASS evidence predates this slice.
