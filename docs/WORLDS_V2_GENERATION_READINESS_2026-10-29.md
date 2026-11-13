# Generation readiness integration boundary (2026-10-29)

Status: bounded architecture checkpoint accepted; NOT IMPLEMENTED.
Do not infer readiness from accepted slot/completion evidence.

## Confirmed coupling from current source

| Component | Current boundary | Consequence |
| --- | --- | --- |
| world-library-store checkRecordStructure/headOf | schemas4/5/6 generation are pending; generation origin only schema6 | Clearing an operation cause does not make the catalog ready |
| library ordinary mutators/history | generation records are rejected | Do not claim normal import/activation/replacement works for this catalog |
| generation-current-state | exact birth level bytes/identity and full first tree | Correct for first completion; fails after legitimate Minecraft saves |
| OperationService | original generation receipts retained, status projected interrupted, all causes held | Immutable CAS/completion evidence is stable; readiness not released |
| ActiveWorldStateStore | slot writer does not publish normal snapshots or clear local recovery | Must compose explicitly with final verified admission |

## Proposed minimal direction, not an approved implementation

Treat independently verified completion as a generation genesis boundary for the
normal world lifecycle, retaining immutable worldId and all birth/receipt/CAS
evidence. First readiness admission must still pass strict first-generation
content, guard, non-slot controls, intent, slot and completion checks. After a
reviewed transition, normal gameplay saves may change level bytes/inode and
world files without creating a different logical world ID; identity remains
bound to the registered root and correct physical world directory/mapping.

Directory replacement, link/escape, registration changes, wrong active mapping,
unsupported version/layout, unknown history and external recovery causes must
continue to block. Birth is historical genesis evidence, not a permanent hash
freeze on a playable world. Do not weaken first readiness proof to implement
the subsequent-save policy.

Directory identity alone does not prove that arbitrary changed files came from
Minecraft. Consider reusing owned-launch/normal-stop witnesses to accept a new
observed revision only after verified managed clean stop, under the same root
and world mapping. This still is not attribution of every byte's writer. Unknown
process/save state or unexplained offline change stays inspection-required;
never simply remove birth hashing and call all later content trusted. Avoid
reintroducing an unbounded synchronous startup scan; reuse existing bounded
startup admission and gates when current-state verification is required.

## Independent design checkpoint

GPT-6.1 Sol High accepted this architecture checkpoint (not an unlock permit).
Required minimal composition:

- A distinct mature catalog version/state with immutable generation-genesis
  reference. Keep generation origin and old evidence. Only historical4/5/6
  remain pending; never fake an ordinary activation sequence to normalize them.
- Preserve a fixed genesis snapshot/necessary original metadata; evolving or
  retired entries cannot reconstruct the original catalog6 for completion proof.
  Later ordinary transition history uses the reviewed genesis seed, with its
  actual generated UUID as the first previous world. Do not invent sequence rows.
- New observed revisions require owned normal-stop evidence. Offline drift or
  a lost open-run witness remains inspection-required; directory ID is insufficient.
- Reuse the runtime's launch UUID/ownership facts for a small normal-lifecycle
  verifier. Do not misuse captureGenerationOwnedLaunch, which intentionally
  binds a generation execution and same-operation stop, for ordinary start(A)
  and stop(B). No new process supervisor or generic transaction framework.

This describes necessary future work; no mature version, normal-stop revision
writer, lifecycle verifier, ready release or HTTP/UI was implemented here.

Keep catalog, history/startup interpretation, successful operation projection
and active-state admission in one integrated candidate. Do not first clear a
cause or publish success, then later adapt the incompatible catalog. Do not
rename generation entries to legacy, delete old evidence or rewrite raw receipts
to force compatibility. Reuse existing library/history machinery where proven;
avoid another generic transaction framework.

The current immutable completion file is not automatically accepted by startup
and is not a ready certificate. Existing running/queued generation receipts
remain consumed and denied; partial completion remains inspection-required.

## Required verification before any unlock

- First strict completion to normal lifecycle, including interrupted admission.
- Normal authorized save then clean stop and a fresh Manager reconstruction.
- Same-name directory replacement and wrong server/root/Java mapping rejection.
- Wrong/missing/corrupt/replaced completion/CAS/birth/receipt evidence.
- Unknown/external causes and authorization loss across every await.
- Subsequent import/activation/backup identity does not bind to another world.
- Existing Paper/Fabric and legacy worlds remain unchanged.
- Explicit HTTP/UI confirmation and isolated actual Minecraft acceptance.

No product/test code was changed by this checkpoint. Independent design review
accepted only as the bounded checkpoint above; future implementation needs
source/evidence signoff. V2 IN PROGRESS,
P7 STOPPED; no Git or system changes.
