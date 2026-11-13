# Explicit generation and initial catalog display

Status: bounded integration only; Phase 1 and Worlds & Backups V2 IN PROGRESS.

Candidate base: `bd0f9324f2406feb9e1eeebe5303e4445bf4d660`, branch
`codex/phase-4-players-properties`, with retained uncommitted work. This file
records new evidence; it does not overwrite earlier timeout/failure reports.

## Implemented behavior

The local Worlds page uses existing authenticated clients to read a sealed
generation target, explicitly confirm one generation request, observe its bound
operation and explicitly verify the saved result. Existing backend preparation
and execution flags remain opt-in and default off. No new process supervisor.

The browser writes and reads back a per-instance pending record before dispatch.
It retains unknown outcomes and never automatically resends, resets a request,
or unlocks recovery. A server switch remounts the instance view; late callbacks
retain the original instance's request only. Finalization requires matching
server, operation and world IDs and reports inspection-only/recovery-required.
New text is available in Simplified Chinese, English and Japanese.

The initial schema7 catalog now has a bounded read-only list path. Ordinary
schema1–6 readers/writers remain unchanged. The fallback requires actual
registration identity, exact active legacy-slot mapping, strict initial catalog
evidence, directory identities and final metadata/authorization rechecks.
It returns public entries with their persistent UUIDs and existing legacy backup
associations, `inspection-required`, null activeWorldId and no mutation authority.
It does not certify unchanged world contents or grant ordinary lifecycle access.

## Executed validation

* Contracts build: exit0.
* Client6 + generation UI8 + existing create-plan5: 19 PASS / 0 FAIL.
* Existing WorldsBackups and i18n tests: 15 PASS / 0 FAIL (separate run).
* API/Web typecheck and scoped ESLint: exit0 at the recorded candidate.
* Initial7 fresh Manager confirmation/read-only list: 1 PASS / 0 FAIL,
  `test-results/worlds-v2-initial7-visible-list.json`.
* Missing proof, foreign slot, foreign registration and lost authority: 4 PASS /
  0 FAIL, `test-results/worlds-v2-initial7-list-refusals.json`.
* Library store/journal/import compatibility: 150 PASS / 0 FAIL,
  `test-results/worlds-v2-library-list-compatibility.json`.

The earlier positive finalization HTTP diagnostic has independently accepted
bounded evidence: 1 PASS / 0 FAIL / 227 NOT RUN, measured body about4835ms.
This uses real session/CSRF and real finalizer over Fake runtime; it is not full
browser composition or real Minecraft. Earlier default5s failures remain valid
history and no deadline was extended for acceptance.

Independent GPT-6.1 Sol High: client/contracts and generation UI bounded SOURCE
ACCEPT, P1/P2/P3=0/0/0; reviewer did not execute tests. Subsequent initial7 list
source/evidence review also returned bounded ACCEPT0/0/0, independently reading
the 1/4/150 reports above. It does not establish full world-content verification,
publication authority or readiness; its scope is inspection-only visibility.

## Remaining work and boundaries

Required: coherent generated UUID↔active mapping and catalog/history admission,
durable owned open-run and observed launch/stop receipts, post-stop revision
consumption, and safely scoped recovery release. Clearing causes alone would
open ServerService's generic start prematurely and is prohibited.

Responsive browser validation for this new panel and isolated Vanilla26.3
real acceptance remain NOT RUN. No real Java process, world, backup repository,
system/network/ACL or Git publication was changed by this integration.
restic, minute schedules, queue/retention, hot backup and final four-tab UI are
still unfinished. P7 stays STOPPED.
