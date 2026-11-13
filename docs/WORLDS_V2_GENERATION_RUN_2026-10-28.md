# Worlds V2 — controlled generation coordinator (2026-10-28)

Status: implementation/focused and affected tests complete; independent review PENDING.
Not mounted in app/main/HTTP. No real Java launch or world publication.
HEAD bd0f9324f2406feb9e1eeebe5303e4445bf4d660, existing dirty work retained.

## Implementation

WorldGenerationService composes the existing dedicated one-attempt receipt
admission, actual preparation/guard proof and catalog execution seal. It requires
trusted synchronous admission, private registered execution identity and the
existing adapter/runtime. First seal must return alreadySealed=false; inspection
of a consumed seal is never a retry/start permit.

WorldLibraryStore.readSealedGenerationPreparation reads only schema5 with the
same execution/anchor/parent and a queued/running receipt. Existing unsealed
preparation remains schema4-only. The physical verifier reuses the same stopped
profile/root/config/pending slot/workspace/source/guard checks for sealed state.
Post-stop verification allows the target to exist; it does not validate or
publish that target, which still requires separate bounded candidate observation.

Before start, the coordinator verifies controls against pre-seal controls,
revalidates registered launch files, rechecks sealed physical proof and current
adapter/runtime/registered identity, then synchronously checks authorization and
closing. A one-time owned start uses the existing runtime, never a second process
supervisor. All startup/cleanup process identities are private and not logged.

On successful readiness, it fixes the exact runtime/launch/PID/operation binding,
uses captured runtime.stopOwnedForRecovery, waits up to a separate5000ms for actual
exit/close, and requires the strict normal exit witness. Stop is sent at most once;
acknowledgment failure cannot cause another send. There is no force kill.

Cleanup is distinct from generation success: an owned child with exit2+close can
release resource ownership but cannot pass generation. Failed readiness may use
exact owned facts without a ready witness for cleanup only. Missing/replaced facts
are not interpreted as absence of a child. Unconfirmed cleanup retains service
owner even when generic OperationService removes its active-operation reference;
the persisted generation gate remains. close aborts start and waits at most5000ms
for owners; unresolved ownership raises CLEANUP_BLOCKED. Stop uses a fresh valid
signal. Progress-receipt failure does not prevent owned stop, but rejects the run.

After a normal exit, old world/guard/config/slot controls, candidate, execution seal
and in-process launch witness are checked again. The result remains candidate-only:
no durable birth binding, catalog entry, active UUID promotion or recovery release.
Raw generic operation completion is masked publicly as interrupted/inspection.
No real generation should use this unmounted runner until mandatory review and
birth/publication/production integration are complete.

## Evidence

- test-results/worlds-v2-generation-run-integration-2026-10-28.json:
  12files300PASS/0FAIL/0pending, including11runner cases and44existing runtime cases.
- test-results/worlds-v2-generation-run-deadline-2026-10-28.json:
  final13runner PASS/0FAIL/0pending, overlapping integration; do not sum.
  Two additional cases cover lost stop acknowledgment without resend and old-source
  mutation after seal. After integration a one-line product fix shares the first close observation deadline across error cleanup instead of renewing it; final13 covers that affected path. Earlier focused/expanded/reviewed reports are retained.
- API typecheck, scoped ESLint and diff check: exit0.
- test-results/worlds-v2-generation-run-candidate-final-2026-10-28.json:6frozen source/test/report hashes.
- Independent required GPT-6.1 Sol High initially returned model-at-capacity.
  Same-model retry also returned model-at-capacity. No substitute reviewer or self-signoff; final decision PENDING. Earlier candidate manifest retained as superseded by final manifest.

New runner tests use isolated real files/JsonOperationStore/catalog/guard and Fake
runtime observations. They are NOT Minecraft or real child-process generation
acceptance. Existing runtime44 uses owned Node children and is reported separately.
Lost-observer CLEANUP_BLOCKED test is Fake-only; no real blocked resource is deleted.
No previous uncertain native fixture is touched.

## Remaining required work

Independent coordinator safety/evidence signoff; actual controlled process
acceptance; durable same-UUID birth binding and publication; specifically scoped
startup gating and UI/API integration. Existing app startup external cause remains
fail-closed. No automatic replay or initialization of consumed attempts.
Worlds & Backups V2 IN PROGRESS; restic/schedules/queue/retention remain later work.
P7 STOPPED. No real world/server/system/network/ACL changes or Git publication.

## Independent follow-up (same day)

On the next user continuation, independent GPT-6.1 Sol High became available.
It verified6/6 candidate hashes,300affected/13final (overlap), and returned
P1/P2/P3=0/0/0, bounded runner-only ACCEPT. Earlier capacity failures remain
historical above; this is not actual Minecraft, birth or production signoff.
Next: one fresh UUID Vanilla baseline+generation candidate real-process check.
