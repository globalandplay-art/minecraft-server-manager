# One-time generation execution evidence storage

Status: bounded independent Sol High ACCEPT. No execution admission or start.

StoredOperation has optional strict generation execution metadata binding the
new operation/server, parent operation/transaction, world UUID, prepared-record
digest, registered-execution digest, canonical semantic request and key digest.
JsonOperationStore validates inner/outer fields and fingerprints. Startup
independently masks every such receipt, including orphan receipts without any
catalog marker and formerly succeeded/failed outcomes. Replay protection remains
after ordinary TTL expiry. UUID key casing is canonical only for protected
execution replay/collision checking; ordinary legacy behavior is unchanged.

Catalog schema5 stores one execution seal without adding a present world. Fresh
sealing requires one actual queued/running receipt and the exact prepared14.
Related receipts form a closed set by parent operation OR parent transaction OR
world UUID within the instance. Same seal returns alreadySealed=true, which means
consumed, never runnable. Different or inconsistent evidence is rejected.

A bounded permanent sibling anchor uses the existing exclusive anchor pattern:
wx, sync, strict readback, then catalog CAS. Parent canonical directories are
revalidated after receipt IO before creation. A failed publication retains its
anchor; schema4+anchor cannot be prepared/sealed again. Schema5 missing anchor,
receipt loss, catalog reversal or corruption remains inspection. No anchor,
receipt or unknown evidence is automatically deleted or reinitialized.

## Tests and review

Final `worlds-v2-generation-execution-storage-final-2026-10-28.json`:
**332 PASS / 0 FAIL / 0 pending**,13 affected files, including execution24PASS.
Earlier15/expanded/reviewed reports are retained and overlap, not extra totals.
Tests use actual isolated V2 preparation and JsonOperationStore, no Minecraft.
They cover orphan states/expiry, key casing and collisions, duplicate identities,
metadata corruption, receipt/anchor/catalog loss, partial anchor publication and
directory substitution without writes into the substituted target.

Review closed3P2 (canonical keys, receipt closed set, anchor directory check)
and1P3 (anchor-only publication failure evidence). Final GPT-6.1 Sol High
P1/P2/P3=0/0/0, bounded storage/startup ACCEPT. Manifest
`worlds-v2-generation-execution-storage-candidate-2026-10-28.json`:6/6 matched.
Scoped ESLint, API typecheck and diff check exit0. Not a full-repository regression.

No actual launch permission, recovery-owner exception, Java run or birth
publication was added. Generic creation remains blocked by generation recovery.
Dedicated execution admission and owned-child cleanup are still required before
any start; seal publication alone must never be treated as authority. P7 STOPPED,
no real world/server/system/network changes or Git publication.
