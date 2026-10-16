# P7.2b manual Backup / Export final admission

Design checkpoint only; implementation NOT STARTED. Lifecycle validation is separate. No production remote mounting or real network action is authorized by this document.

## Scope

Add an optional trusted `OperationAdmission` callback at the end of `OperationService.requestBackup` arguments. Check it after mutation-queue waiting, before idempotent replay, and after all preflight waits immediately before operation-store save invocation. Preserve the existing save-call authorization boundary: a validly admitted operation may complete after session closure. Never save and then reject authorization, retry an adapter, or change recovery/journal semantics.

Thread this callback only through manual `BackupService.create` and `BackupExportService.request` and their HTTP registrar, using the configured request-bound `HttpAuthentication.assertMutation`. Existing anonymous local mode remains explicitly undefined; no remote anonymous fallback. Callback is never serialized or supplied by DTO/environment.

Do not repurpose BackupService.additionalPreflight. Its asynchronous scheduler checks run before awaited capabilities/status and again during execution. They remain unchanged; a request authorization callback must not cancel an already admitted operation during execution. Nested addon protection backups and automatic schedules remain unchanged and are not claimed covered by this slice.

## Validation

Cover revocation during queue/preflight, valid versus revoked idempotent replay, valid save-call admission followed by session closure, and real HTTP registrar forwarding with synthetic sessions/fake adapters. Recheck CSRF, session, audit and ingress using the same synchronous mutation semantics as lifecycle; do not silently introduce recent reauthentication.

Denied requests create no new operation or backup/export execution. Already-started read-only preflight checks may have occurred. Preserve existing safety-gate side effects where applicable rather than claiming every preflight is pure. Use targeted tests, independent Sol High review, and a fresh frozen full regression after implementation.

## Explicit exclusions

Restore/Rollback, Properties, Create/Archive, Import/recovery, addon operations, upload/discard/cleanup, scheduler/retention policy writes, commands, RCON-backed reads and export download streams need separate final-admission mapping. Shared business ownership, owner drain, native transport/build and real remote acceptance remain blocking gates.

Readonly mapping by the independent Sol High reviewer identified this narrow order and these exclusions; it is not implementation signoff. Historical native timeouts and addon revision failures remain preserved and their original cause remains UNKNOWN.
