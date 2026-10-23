# M3-E completion-path technical review — 2026-10-24

## Decision

**READ-ONLY REVIEW COMPLETE; M3-E HARD BLOCKER remains.**
M3-INSTALL-BROWSER-DEADLINE-001 remains stopped after2 substantive repair
rounds. This review performs no third repair, test run or server launch.
It does not change the30s assertion, prior result, operation/journal or fixture.

Current branch `codex/phase-4-players-properties`, HEAD
`2f084f37e8585a046d15e57896e22f0405a76ad1`. Existing uncommitted work is
retained. Only this document and current progress/debt references were updated.
No commit/push/PR, system/network change, Minecraft startup or P7 work.

## Evidence read

Preserved run `test-results/m12-real-8047946f-a5b2-4a7b-8221-89ee59a7bab6/`:

- `m21-report.json`: original BLOCKED;360 full flow PASS,768 deadline failure,
  1440 NOT RUN;3 normal Manager close receipts, no Minecraft, sources unchanged,
  ports released.
- `post-failure-business-proof.json`: two terminal operations,768 target/stage
  hash match, consumed stage, pinned guard and committed install journal.
- `neoforge-360-trace.zip`: existing successful browser network trace, parsed
  locally and boundedly; no replay/network request/server process was launched.
- `manager/operations/*.json` and `manager/transactions/*.json`: public
  operation fields and checkpoint timestamps only; no credentials were read.

The referenced ChatGPT conversation tool returned assistant placeholder
references rather than usable assistant advice. No unavailable advice is
treated as verified instruction or architecture approval.

## Confirmed observations

1. The768 Manager request receipt contains31 GET responses for operation
   `f62f8d45-ec07-4105-962b-19b9ef31bf55`, all HTTP200, after installation202.
   One is the explicit cleanup observation, leaving30 browser poll responses.
   There is **no evidence that polling simply stopped**.
2. No addons GET response was recorded after768 installation202. This means
   final inventory verification was not observed completing; response-only
   logging cannot prove that no such request was ever initiated.
3. The fixture records only method/path/status at
   `tests/fixtures/m12-manager.mjs:32`; it records neither response operation
   state nor request timestamps. The failing768 context has no saved trace:
   trace saving currently occurs only on the successful loop path, before
   context closure. It is therefore not possible to recover the exact failing
   terminal-response/render timeline from those receipts.
4. `OperationService.#update` creates `updatedAt` **before** awaiting
   `store.save`, and only publishes the new in-memory record afterward
   (`apps/api/src/services/operation-service.ts:501–505`). The reported
   28.150/29.682s are differences between stored record timestamps, not exact
   API-visible completion times. Keep the historical measurements, but do
   not equate them with browser-observable terminal publication.
5. `ModInstallPanel.tsx:16–41` polls for terminal state, then validates
   operation identity, reads current addons/status and verifies the installed
   name/hash before displaying success. A202 or matching member alone does
   not bypass these checks.

## Successful360 trace: measured reference, not a768 substitute

All absolute times below are UTC from the preserved trace. Durations come
from the trace's own network timing; do not mix these with a new process's
monotonic clock.

| Event | UTC request start | Duration |
| --- | --- | ---: |
| Install POST,202 | 15:52:22.791 | 5898.397ms |
| Last observed running operation response | 15:52:56.243 | 38.937ms |
| First observed succeeded operation response | 15:52:57.295 | 6.939ms |
| Final server-state GET | 15:52:57.303 | 11.757ms |
| Final installed-addons GET | 15:52:57.302 | 38.712ms |

The operation JSON in that first succeeded response has
`updatedAt=15:52:56.801Z`. The previous running response has
`updatedAt=15:52:34.710Z`. Response bodies were inspected only for public
state/timestamps; no headers, cookies, raw output or secrets were emitted.
The successful reference shows prompt final reads, not a persistent front-end
hang. It does **not** establish how long768 terminal publication took.

## Existing checkpoint intervals

These are wall-clock checkpoint differences from each preserved operation,
not newly instrumented internal function timings. They include everything
between checkpoints and cannot be attributed to a single helper.

| Interval | 360 | 768 |
| --- | ---: | ---: |
| Operation created → install intent timestamp | 9904ms | 11239ms |
| Staging validated → target installed | 6395ms | 6216ms |
| Target installed → installed verified | 2874ms | 3078ms |
| Before commit → staging consumed | 6023ms | 5982ms |
| Committed checkpoint → recorded terminal timestamp | 2923ms | 3135ms |

Repeated physical validation still occupies several substantial intervals.
This does not justify deleting those checks or attributing all cost to backup.

## Classification and limits

**CONFIRMED:** the unchanged end-to-end completion deadline failed at768;
backend operation/journal/stage/target evidence is consistent; polling
responses continued; stored terminal timestamp precedes in-memory publication
in the code; missing failed-context trace limits further reconstruction.

**PROBABLE, not confirmed:** the total completion budget has insufficient
headroom for remaining validation, terminal persistence/publication, poll
interval, final reads and rendering. A one-second poll interval is not a hard
upper bound under scheduling/network delays.

**UNKNOWN:** exact768202 receipt time, the state carried by each browser poll,
terminal save duration, in-memory publication time, last verification request
start/completion and success-render time. No evidence establishes a distinct
front-end bug, an independent root cause, Minecraft crash or installation
corruption. Do not reset the two-repair counter.

## Next bounded diagnostic design, not executed

Do not choose another identity optimization or change the completion contract
on this evidence. Before a different implementation path is authorized, a
diagnostic-only proposal should capture the missing boundaries:

1. In an inert isolated fixture, correlate only the accepted operation ID and
   instance; record202 receipt, operation-response enum and first terminal
   response, final addons/status request completion, and fixed success-display
   event using a browser-local monotonic timeline.
2. Record terminal-save begin/end and in-memory publication separately in a
   test-only observation layer. Preserve every original await, assertion,
   file/identity check, concurrency setting and timeout. Do not introduce
   another persistence implementation or modify production state semantics.
3. Retain tracing on failure before closing the context. Preserve original
   failure/exit status and existing bounded cleanup. Log only fixed phase,
   anonymous IDs, duration and state enums, never payloads/headers/secrets.
4. Distinguish browser and Manager clock domains. Correlate by IDs/order;
   cross-process exact latency requires explicit calibration, not subtraction
   of unrelated performance clocks.
5. Any proposed run is diagnostic, not a new delivery PASS or an excuse for
   third repair. Do not execute a new run automatically under this review.

This design does not authorize a third root-cause repair or relaxation of30s.
Full regression and advanced final Gate remain pending. Prior123 affected
test/static results are historical evidence, not rerun or upgraded here.

Independent GPT-6.1 Sol High read-only evidence/source review agrees with the
above distinction: no proven polling stop/front-end root cause, insufficient
failing timeline to choose a repair, HARD BLOCKER remains. Reviewer performed
no writes or tests.
