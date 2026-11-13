# Genesis-aware structural transition projection — 2026-10-29

Status:223 compatibility PASS and focused guard fix PASS; final independent6/6hash readback limited ACCEPT; readiness closed.

## Scope

The fixed schema-6 genesis inspector now exposes scalar original/current world
names and directory identities, still bound to the exact original snapshot hash.
No durable snapshot bytes or schema are rewritten. The deterministic seed digest
changes with these newly explicit metadata fields; no earlier durable seed-digest
format has been published or accepted by a ready/mature catalog.

`projectWorldTransitionsFromGenesis` reuses the existing structural projector,
with exactly two initial worlds and the generated UUID as the initial active
identity. Initial root/catalog/server, UUID, name and directory ownership must
agree. The first actual transition must depart from the generated UUID. Empty
history has zero transaction rows, not a synthesized activation. Same-name
replacement retires the generated UUID without dropping the original world or
its immutable seed. Retired UUIDs cannot be silently reactivated.

`projectGenerationWorldHistory` derives that structural genesis ONLY from the
strict original snapshot and expected revision/server/execution/record binding.
Generation preparation transaction, preparation/execution operation IDs and the original protective guard backup ID
cannot be reused as new transition rows. Original generation origin is retained
in the genesis metadata. Existing unseeded projection behavior is unchanged.

## Explicit limits

These are pure structural inspections, NOT journal/receipt verification, trusted
current filesystem evidence, a mature-catalog writer, startup success, backup
ownership certification, a route or recovery release. Future callers must verify
every original transaction and physical mapping, bind snapshot identity/checksum
and adapt catalog/history together before any ready or ordinary mutation gate.
No production caller currently opts into the new projection.

## Verification

- Focused report worlds-v2-genesis-projection-2026-10-29.json:37 PASS/0 FAIL;
  114 generation-service tests NOT RUN (name filter). Includes36 structural
  cases and one actual generated snapshot fixture; no real Minecraft startup.
- API typecheck and scoped ESLint: exit0.
- Compatibility report worlds-v2-genesis-projection-compatibility-2026-10-29.json:
  223 PASS/0 FAIL/0 pending (activation history25, catalog17, import114, transition history36, transition records31), exit0. The focused37 overlaps36 of these; totals are not added.
- Independent GPT-6.1 Sol High source review: one guard-ownership P2 found and closed; P1/P2/P3=0/0/0, limited source ACCEPT. Final6/6hash readback matched unchanged HEAD; limited ACCEPT,0/0/0.

V2 IN PROGRESS. No mature catalog or normal owned-stop revision protocol exists
yet. All recovery gates remain. P7 STOPPED; no Git upload/system changes/Java.

API build and git diff --check exit0. Candidate freeze: test-results/worlds-v2-genesis-projection-candidate-2026-10-29.json (six SHA-256 entries, unchanged HEAD). No Java or Minecraft files modified.

Guard fix report: worlds-v2-genesis-projection-reserved-guard-2026-10-29.json:1 PASS/0 FAIL,114 NOT RUN. Core unchanged since223 compatibility; no totals summed. Final candidate: worlds-v2-genesis-projection-final-candidate-2026-10-29.json; initial candidate retained. API build and scopedlint/diff exit0 after fix. No timeout/concurrency/assertions weakened.

Final independent GPT-6.1 Sol High:6/6 hashes matched, HEAD unchanged, P1/P2/P3=0/0/0; limited ACCEPT for structural projection and no-genesis compatibility only.
