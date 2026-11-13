# Worlds V2 replacement runtime continuation — IN PROGRESS

Continuation of the accepted UNMOUNTED executor/proof checkpoint, not Phase0.
No real Minecraft/Java or user world operations. Git upload remains unauthorized.

## Application lifetime and startup

WorldReplacementRecovery now owns explicit verification from admission through
the instance lease, upload lease, physical proof and final receipt confirmation.
It registers owners before awaiting and rechecks app readiness, closing and
registry object identity. Closing rejects admission and waits for those owners;
an independent5s cleanup deadline reports CLEANUP_BLOCKED without freeing leases
or deleting uncertain evidence. Startup scans only retain operation-specific
replacement gates; no automatic result confirmation, file replay or repair.

app.ts constructs executor/recovery with the same existing operations, uploads,
backup and library objects. Both preClose and onClose join replacement work
before adapter disposal. Replacement journals select the existing bounded
startup task instead of occupying Fastify's plugin hook deadline. Old activation
and independent-import confirmation paths skip replacement servers and retain
all their operation gates; this does not authorize mixed-history recovery.

Ordinary import recovery causes still block replacement-only outcome settlement.
Do not clear them broadly. Mixed live-history admission/recovery remains open.
No replacement HTTP write endpoint or UI capability is mounted in this unit.

## Evidence

Initial new integration selection:4PASS/1FAIL/76NOTRUN. Startup test omitted the
existing lifecycle request UUID key/body and received400 before reaching recovery
admission; test request corrected to the unchanged API contract. No product guard
or assertion weakened. Original report retained:
`test-results/worlds-v2-replacement-app-attempt1-2026-10-27.json`.

Corrected focused selection7PASS/0FAIL/76NOTRUN:
`test-results/worlds-v2-replacement-app-2026-10-27.json`.
Full affected replacement/import/startup module run is in progress, including an
actual app-owned paused proof during shutdown. Source-only independent Sol High
review0/0/0; bounded evidence acceptance PENDING.

Remaining: shared-runtime HTTP/UI, mixed live history, real isolated Minecraft
replacement acceptance, new-world identity, restic, scheduling/queue/retention,
four-tab UI and final delivery. V2 is not FINAL PASS.

Final bounded runtime readback accepted by independent Sol High0/0/0:
203PASS plus mechanical lint-only test delta1PASS/83NOTRUN. Subsequent HTTP/UI
and real first-replacement evidence is recorded separately in
WORLDS_V2_REPLACEMENT_HTTP_UI_2026-10-27.md; earlier pending text above is historical.
