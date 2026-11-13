# Historical genesis reference inspection — 2026-10-29

Status: historical-links-only bounded ACCEPT; independent8/8hashes and0/0/0. Mature readiness and issuer authentication remain unimplemented.

## Implemented scope

A strict pathless GenerationGenesisReference identifies a snapshot and completion
by checksum AND filesystem identity, plus server/execution/world/record identity.
The backend-only reader derives fixed owned evidence paths and compares them to
trusted registered root and execution metadata. No browser path is accepted.

The reader validates bounded canonical schema-6 snapshot bytes, completion,
original CAS intent, birth, permanent execution anchor and catalog identity
anchor. The snapshot retains generation origin and original directory ownership.
Birth's COMPLETE canonical execution digest must equal the snapshot execution
anchor digest as well as the actual permanent execution file checksum. Original
birth and intent identities/checksums must match the completion/snapshot links.
All retained files are reread for stable checksum/identity; root/evidence/library
directories must remain stable, and the original CAS temporary path must be absent.
Read buffers are wiped, callbacks remain synchronous, input and expected binding
are cloned. The function has no write/open-wx path.

Current mutable catalog and current active slot are deliberately not historical
inputs. A later reviewed transition may change them; an invalid current state
STILL requires independent rejection by readiness/current-state verification.
The explicit result is historical-genesis-links-only, inspectionOnly:true,
recoveryRequired:true. It is NOT a ready certificate or current-world proof.

This does not authenticate an arbitrary caller-supplied reference. A future
mature catalog must first authenticate the reference and separately verify parent
journal/raw receipt provenance, current world content, registration/dependency
closure, observed revisions and all admission gates. No new route, mature schema,
startup bypass, recovery clear or ordinary mutation capability is installed.

## Evidence

- Initial reference targeted12PASS/0FAIL,115NOT RUN.
- Final pre-review targeted14PASS/0FAIL,114NOT RUN (includes original seed1).
- Strict metadata parsers14PASS/0FAIL/0pending: canonical valid inputs detached;
  malformed JSON/UTF8, >4096 bytes, future schema, extra keys, noncanonical reject.
- Initial affected-genesis integration worlds-v2-genesis-reference-integration-2026-10-29.json:23 PASS/1 FAIL,104 NOT RUN;
  this candidate predates the subsequent birth/full-execution cross-binding fix.
- Independent Sol High found one P2 incomplete execution cross-link; fixed with
  full canonical SHA and self-consistent malicious birth/reference fixture.
  Final review and fresh fix evidence PENDING at this checkpoint.
- API typecheck/build/scopedlint/diff passed before that last minimal hash fix;
  final affected checks follow. Historical reports are retained.

No real Java/Minecraft, browser or OS-process crash run. Only isolated fixtures.
No user world, repository, Windows ACL/system/network setting or Git upload.
V2 IN PROGRESS, P7 STOPPED. Next remains integrated mature catalog, trusted
normal owned-stop revision witnesses and final guarded admission/API/UI/real tests.

## Final bounded hardening and evidence

The initial integration negative for readback snapshot replacement unexpectedly
resolved. Exact cause remains UNKNOWN; it did not include enough injection/ID
observations to establish numeric identity collision or mock failure. Later25/0
crosslinked report and observed distinct IDs do NOT explain or erase that failure.
The original report is permanently retained. No assertions or timeouts relaxed.

A new bounded mechanism now independently establishes the in-call boundary:
reference-local bigint dev/ino/birthtimeNs witnesses surround every initial read
and final reread. A deterministic negative forces legacy hash/identity values to
remain equal while the real object is renamed/recreated; it is rejected without
relying on legacy numeric identity precision or timestamp timing. Existing global
identity formats, catalogs, sealer behavior and files are not migrated.

IMPORTANT: this strengthens only stability DURING this invocation. It cannot
retroactively prove pre-entry provenance for older numeric identities. A future
mature catalog/reference issuer must establish collision-safe authenticated
identity provenance; current code has no such issuer and remains unmounted.

Final report worlds-v2-genesis-reference-bigint-2026-10-29.json:15 PASS/0 FAIL,
115 other service tests NOT RUN. Parser14PASS is separate unchanged evidence.
Earlier focused/crosslinked reports overlap and are not summed. Final API build,
scoped lint/diff exit0; explicit API typecheck before bigint addition exit0 and
final build includes TypeScript compilation. No full repository regression run.
Independent Sol High source0/0/0; original cross-link P2 closed; final eight-file
hash/evidence readback8/8 matched unchanged HEAD, bounded ACCEPT,0/0/0. Candidate worlds-v2-genesis-reference-candidate-2026-10-29.json.
Final independent GPT-6.1 Sol High evidence readback:8/8hashes matched, HEAD unchanged, diff0; bounded ACCEPT, P1/P2/P3=0/0/0. Scope historical metadata links only, not authenticated issuer/current state/readiness/startup/API/recovery release. Original23/1 UNKNOWN retained.
