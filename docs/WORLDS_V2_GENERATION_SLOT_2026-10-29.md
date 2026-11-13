# Dedicated generation slot CAS primitive (2026-10-29)

## Scope and invariant

Unmounted backend filesystem primitive only. No OperationService mutation lease
integration, HTTP endpoint, normal active snapshot, receipt settlement or ready
permission is implemented by this unit. A future caller MUST hold the dedicated
instance mutation lease/lifetime throughout this function. The read-only
inspection lease is not repurposed as a write lease. Tests use isolated fixtures
and synchronous fake authorization; they do not certify that future integration.

commitGenerationSlot changes only the exact legacy five-field slot from pending
to active, retaining a generation-specific immutable intent. It never changes a
world tree/configuration, deletes evidence, clears recovery, updates in-memory
active state or starts Java. Backend-derived server/exec paths are fixed under
active-worlds; no browser pathname is accepted.

## Durable boundaries

1. Independently observe a fresh full physical proof and compare all stable
   fields and exact slot state/hash/identity with the captured input. Returned
   proof data is mutable and is not itself a capability.
2. Create the exact active payload in wx stage, fsync and capture the opened
   handle identity. Private readback must match that identity and payload.
3. Create wx immutable intent, fsync and sync directory. Bind parent/birth,
   catalog, receipts, tree, registered execution and non-slot control identities
   through proofDigest, plus before-slot and after-stage hash/identity, instance,
   execution and directory identity. Readback checks opened intent identity.
4. Fresh old proof, intent and directory checks, exact stage read, final old-slot
   hash/identity comparison, then synchronous authorization directly before
   same-directory rename. Read back the installed stage identity/hash.
5. A NEW full active proof plus recheck must match every invariant. Check final
   intent identity and installed slot again. Return inspectionOnly and
   recoveryRequired, never ready.

The former controlsDigest remains unchanged. A separate nonSlotControlsDigest
binds every stable control except slot, plus workspace identity/guard checksum.
This prevents dropping unrelated control-file identity while allowing slot CAS.

| Retained state | Explicit helper behavior |
| --- | --- |
| stage without valid intent | Reject; preserve stage; never adopt/replay it |
| complete intent, original pending and stage identities | Fresh proof before explicit continuation |
| complete intent, active matching original stage, no stage left | Read-only confirmation; no second rename |
| active without intent | Current state may be inspected separately; CAS ownership not claimed |
| identity/content/binding drift or damaged evidence | Reject and preserve evidence/gates |

## Review and validation checkpoint

Independent Sol High required the durable intent; existing birth/catalog alone
does not identify a CAS attempt. First draft focused report slot-2026-10-29.json
82PASS/0FAIL retained; it predates later hardening and is not final acceptance.
Independent source review identified mutable returned-proof fields as P2; fixed
by new trusted observation before any write, with a no-artifacts mutation test.
Additional self-checks bind opened stage/intent identities and non-slot controls.
Intermediate reviewed report86PASS/0FAIL is also retained. Independent review
then found another P2: fixed stage could reappear during post-rename observation
without being rejected. Final code checks its absence after final proof/intent
and slot reads, then synchronous admission before return. A full-proof callback
recreates that stage after active installation; the new negative test requires
rejection and retention of active/intent/stage. Neither intermediate green report
is substituted for the final corrected candidate.
Reviewed report, final static checks and independent evidence signoff PENDING
until recorded below. Reports are in test-results/worlds-v2-generation-*.

Faults are file-boundary simulations in Fake-runtime fixture roots, not proof
of independent OS-process crash durability or real Minecraft acceptance. No
real world/process/system change or Git publication. P7 STOPPED; V2 IN PROGRESS.

## Final limited acceptance

slot-final report87PASS/0FAIL/0pending. Final API build and scoped lint exit0,
diff0. Independent GPT-6.1 Sol High verified5/5 frozen hashes in slot-candidate,
unchanged HEAD, and the final report; P1/P2/P3=0/0/0, limited ACCEPT. Both P2s
closed with dedicated negatives; original82/86reports retained. No production
mutation lease, HTTP, receipt settlement, real OS crash or ready is signed off.

## Required next composition

Dedicated write lease and shutdown drain; safe typed active+unsettled startup
handling; partial receipt settlement; final readiness/invalidation; policy for
subsequent legitimate Minecraft saves; then actual authorized HTTP/UI recovery
and scoped fresh real acceptance. Unknown/external causes must never be waived.
