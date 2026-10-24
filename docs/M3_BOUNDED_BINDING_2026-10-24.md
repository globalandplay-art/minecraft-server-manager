# M3 restore deadline — bounded closure I/O, attempt2

Status: startup reconstruction and restore browser blockers CLOSED in the
tested engineering scope. M3 FINAL remains BLOCKED pending separate gates.
No Git action, Minecraft launch, system change or P7 work is authorized here.
Historical failures and the previous attempt1 candidate are preserved.

## Evidence before this repair

The restore diagnostic previously took31687.30ms from queued-save to success
publication on the same Manager clock, after metadata reuse reduced35713.60ms.
The original30000ms visible-success assertion still failed. Formal360 was also
blocked at installation, before restore. No larger timeout or weaker assertion
is used in this follow-up.

`test-results/m3-binding-readonly-timing-v1.json` records one cold/warm read-only
sample of the exact old source copied to an ignored diagnostic artifact with
only timing wrappers. The production source remained unchanged during that
sample, and its result equaled the production binding on the same physical
fixture. No server was started or fixture modified.

- Cold1330ms: directory identity338ms, file read/hash485ms, ZIP inspection494ms.
- Warm816ms: directory identity309ms, file read/hash497ms, no ZIP cache miss.
- Each complete binding still performs140 safe reads and368 directory checks.
- `m3-guard-readonly-timing-v1.json`: five actual pinned guards took423–470ms
  each to read/verify. No guard optimization was added.

These measurements identify serial fresh-proof I/O as the remaining cost;
they do not prove every browser or OS delay has the same cause.

## Minimal implementation

Only `neoforge-launch-binding.ts` changes its independent reads to fixed batches
of four. Every batch awaits allSettled before ordered merge or rejection; after
failure no next batch starts. Parent identities are collected in original order.
The first complete pass precedes directory revalidation and the complete second
file pass. Anchor, descriptor, INDEX absence and root final checks remain.
File, directory and absent-target ordering in the persisted binding is retained.

No physical facts are cached. The existing pure metadata cache remains scoped,
limited to68 entries/8MiB; single-file limit64MiB and aggregate closure admission
limit512MiB remain. At most four active raw input Buffers can total256MiB,
plus ZIP parsing/cache/other allocations and not-yet-collected memory. This is
not a256MiB RSS guarantee. Paper/Fabric/Forge readers are unchanged.

## Verification

- `m3-bounded-binding-v1.log`:93PASS across binding, loader identity and loader
  install tests. New tests cover max4 with all140 reads, failed-batch drain,
  changed bytes in the second pass, and parent replacement at final proof.
- `m3-bounded-binding-quota-v2.log`:36PASS in the updated binding file, adding
  aggregate-limit rejection and no subsequent batch. The quota case injects
  synthetic reader lengths with warm facts to avoid writing/allocating>512MiB;
  it is not a real large-file stress test.
- `m3-binding-batch-compat-v1.json`: full result deep-equality against the old
  serial source on the SAME physical fixture, without changing registration.
  Serial cold1396ms/warm857ms; candidate cold1003ms/warm603ms. Read-only timing
  is not production throughput or browser acceptance evidence.
- API typecheck, lint and diff check exit0.
- Independent GPT-6.1 Sol High design/source review P1/P2/P3=0; explicitly
  requires formal browser evidence and retains M3 BLOCKED pending it.

Formal360 runs once with timing and restoreSetup disabled, original30000ms
assertions retained. Only if360 passes may768/1440 proceed. If attempt2 still
fails for the same cause, stop that repair chain rather than blind attempt3.
Fresh NeoForge real loading and final stage regression remain separate gates.

## Formal360 result

`m12-real-92214e67-2246-42e4-a476-f5ccd18225e6`: PASS, exit0. Real Chrome,
Vite and production Fastify, no mocked HTTP. Timing and restoreSetup disabled.
Install/disable/enable/trash/restore all pass original30000ms UI assertions,
with file and terminal operation checks. Exactly6 addon POSTs, forbidden0.
Three independent Manager processes closed normally. The same registered
NeoForge fixture was reloaded after the lifecycle chain using production
JsonOperationStore/journal, with stopped/recovery-cleared state and saved
install outcome checked; subsequent removal/rebuild remained consistent.
This advances startup evidence beyond the earlier memory-projection-only proof.
It is still NOT actual Minecraft loading acceptance.

Full360 trace/screenshots are saved in the run. Source inputs unchanged,
no Minecraft launches and ports released. Formal768/1440 started only after
this completed PASS; do not infer their result from360.

## Formal768/1440 result

`m12-real-4f0947b2-7914-4956-ad70-fc2eb3c93736`: PASS, exit0. Both widths
completed installation plus disable/enable/trash/restore, persistent Manager
rebuild, removal/rebuild, immediate list/selection and source-preservation
checks. Both complete traces/screenshots are saved. The original30000ms
assertions remain; no timing or restoreSetup flag. Five owned Manager sessions
closed;12 addon POSTs and forbidden0, source inputs unchanged, zero Minecraft
launches and ports released. Across the two completed formal runs: three
widths,18 addon POSTs,8 Manager sessions, no forbidden mutation.

For each registered fixture, replay verification occurs BEFORE removing its
registration. After removal a later Manager lacks that adapter identity and
projects the old operation receipts as interrupted/physical-recovery-required;
the committed transaction evidence stays intact. This is the retained
fail-closed rule, not proof that all operation files remain succeeded after
unregistration. No historical failed run is relabeled PASS.

These results support the startup/restore browser repair in the tested local
environment. They do not establish actual NeoForge mod loading, or guarantee
the same latency under arbitrary host load. Fresh NeoForge real acceptance
and final frozen stage regression remain separate outstanding M3 gates.

## Final independent review and checks

Independent GPT-6.1 Sol High source and final-evidence review: P1/P2/P3=0.
The reviewer confirms closure of the startup persistent-rebuild Gate and
three-width original-deadline Gate, not whole M3. Trace-measured UI assertions:

| Width | Installation | Restore |
| --- | --- | --- |
|360|22.09s|27.13s|
|768|22.08s|26.12s|
|1440|20.05s|26.11s|

`m3-batch-affected-api-v1.log`:133PASS/8files, exit0, covers registration,
activation, detection, runtime, addon API, staging, successor and startup gates.
The earlier three-file93PASS and updated binding36PASS are separate batches;
do not add the repeated binding tests twice. Web41 and Contracts28 from the
previous follow-up remain unchanged evidence; neither layer changed in this
repair and neither was redundantly rerun. This is NOT a new frozen full suite.
API typecheck, lint, production build and final diff check PASS/exit0.

Current branch `codex/phase-4-players-properties`, HEAD
`d8bb9b4b9dd27d5dd864beae7793c9bc1f4762a7`; all current M3 work remains
uncommitted. No push/PR/merge. Preserve all old failed runs and uncertainty
projections. No old LC2 native experiment, real Minecraft launch or P7 work.
Next: separately execute fresh NeoForge actual marker load/omission acceptance,
then final frozen stage regression and independent M3 final evidence review.
