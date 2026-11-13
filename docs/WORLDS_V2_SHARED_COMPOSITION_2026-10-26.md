# Shared activation operation composition — default-off integration

`buildApp` accepts trusted construction-only `worldActivationExecution`. The
default is absent/false; main.ts supplies no value. Neither HTTP inputs nor an
environment variable enable it. It requires the existing local world library,
journal/manager root and active-world install method. No desktop/user setting
or production main enablement is introduced in this checkpoint.

When explicitly constructed for acceptance, plans/executor reuse the exact app
registry, OperationService, journal, catalog, backups and active state. Standard
operation GET and EventStreamService/WebSocket therefore see the same operation.
The source verifier keeps current head, historical guards, imports, version,
archive/unfinished-state and scan checks. Lifecycle exclusion is the same existing
operation lease, not a second scheduler or supervisor.

Plan response now truthfully derives executionAvailable from mounted executor
presence after successful plan validation, with null unavailableReason for an
enabled construction. Preparation-only construction retains false/pending. Both
keep loadVerified=false: engineering acceptance does not certify Minecraft load.

## Evidence and scope

`test-results/worlds-v2-production-composition-2026-10-26.json`:1PASS/99filtered,
exit0,2533ms. Real composed Fastify handles independent import, activation plan,
actual activation, standard operation GET polling, actual WebSocket success event,
same-key replay and catalog active selection. Exactly one activation journal,
same operation ID in POST/GET/WS, zero Java start/stop. This case uses existing
local basic guards with no configured administrator account.

Additional real composed-auth test uses HttpAuthentication/SessionCore, verifies
invalid CSRF403 and session revocation during source validation401, with no new
activation intent, store/catalog/config changes. Focused1PASS/100filtered,exit0.
Another case verifies default construction has no activation route and no writes.

Contracts31PASS. API typecheck passed. Initial scoped lint found eight unused
destructured test variables; explicit DTO selection replaced them without changing
payload fields or safety assertions. No product fix or timeout change involved.
Final affected App/event-stream/WebSocket/world-module report:
`test-results/worlds-v2-shared-composition-final-2026-10-26.json`.
Actual132PASS/0FAIL/0filtered across4files,exit0,123.39s. World module102,
app27,WebSocket1,eventstream2; three-hop4483ms under unchanged5000ms.
The mechanical test DTO cleanup happened after the run loaded its test module;
three affected composition/auth/defaultoff cases were rerun after it:3PASS,
exit0,6.83s, report
`test-results/worlds-v2-shared-composition-delta-2026-10-26.json`.
No product code changed after the132-test candidate; no unchanged full rerun.
API build/typecheck/scoped lint/diff PASS after cleanup. Raw lint failure above
is retained in tool transcript; no assertion/timeout/worker limit was weakened.

Independent GPT-6.1 Sol High source/composition review P1/P2/P3=0; reviewer checked
the initial actual shared GET/WS report. Additional final test results are recorded
as writer evidence unless independently checked. No reviewer tests/edits/Git/Astra.

## Not complete

Final independent Sol High evidence closure: actual132/0/0pending across4files
and postfix3/0/99filtered verified, including4483.112ms roundtrip, authenticated
no-write negatives and default-off404. Mechanical DTO field selection preserves
all prior payload fields/assertions. Scoped shared-composition checkpoint ACCEPTED,
P1/P2/P3=0. Main/UI/real Minecraft and final V2 remain unsigned.

Main remains disabled. User-facing world-selection confirmation UI, realistic
capability presentation, full browser acceptance and real Minecraft world loading
are pending. Existing world/import/restore/recovery protection remains unchanged.
No full repository/V2 final PASS, Git publication, P7 or real world operation.
