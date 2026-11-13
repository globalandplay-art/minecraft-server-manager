# Lifecycle receipt storage (2026-10-30)

Status: bounded storage-only ACCEPT. Worlds V2 remains IN PROGRESS.

## Implemented

Reuse JsonOperationStore with an optional strict private version-1 worldLifecycle
descriptor: immutable world ID, catalog/world revision, root/world directory
identity, registered execution digest, run nonce and start operation. Start
records may have an unsealed null launch ID; stop records require a distinct
operation, observed launch ID and start-receipt digest. These are shape/link
fields, not verified cross-record stop provenance or a launch-sealing protocol.

Start request fingerprints exclude server-created nonce/operation/observed-launch
fields, preventing observations from changing the semantic request. Stop
fingerprints bind the specific start receipt/run/launch. UUID keys normalize
consistently. Generation execution and lifecycle descriptors cannot coexist.
No arbitrary path, command, HTTP capability or provider setting was added.

Startup independently validates descriptors, including custom stores, then
retains tagged raw receipts in every state. A dedicated
world-lifecycle-unverified:<operationId> cause projects inspection-required
without overwriting evidence. Generic transaction confirmation cannot clear
that cause. Expired keys remain protected, uppercase/lowercase aliases do not
dispatch, and tagged/untagged duplicate scopes fail closed. Legacy operation
behavior and world-create key normalization remain unchanged when no tags exist.

## Evidence

- First scoped report worlds-v2-lifecycle-receipt-2026-10-30.json: 29 PASS.
- Final worlds-v2-lifecycle-receipt-final-2026-10-30.json: 30 PASS / 0 FAIL /
  0 NOT RUN, comprising 17 new receipt tests, 4 admission tests and 9 store tests.
  Includes an additional untagged legacy key-case collision. These overlap the
  first report and are not summed.
- Separate worlds-v2-lifecycle-receipt-compatibility-2026-10-30.json:
  52 PASS / 0 FAIL (46 generation execution + 6 lifecycle authentication).
- Standalone API typecheck session81896 exit0, scoped ESLint exit0 and explicit
  DIFF_CHECK_EXIT=0. Earlier aggregate command session77049 returned exit1
  without emitted diagnostics and remains non-PASS; its internal cause is not
  established. Separate checks were used to obtain unambiguous exit statuses.
- Independent GPT-6.1 Sol High: P1/P2/P3=0/0/0, bounded ACCEPT. Independently
  verified 4/4 hashes and unchanged HEAD against
  test-results/worlds-v2-lifecycle-receipt-candidate-2026-10-30.json, both reports
  and diff status. Typecheck/lint completion is writer-reported.

## Not implemented and next checkpoint

There is no production caller creating these descriptors yet. Actual dispatch,
append-only/frozen launch sealing, stop-to-sealed-start provenance verification,
world revision publication/consumption and readiness release are NOT IMPLEMENTED.
Do not enable them based on descriptor validity or this bounded review.

Next integrated candidate must persist open-run intent before Java dispatch,
seal the observed runtime launch before controller success, persist stop intent
before stop dispatch, verify exact frozen terminal receipts and stable stopped
world controls, and keep the open-run marker blocking until both revision
publication and receipt consumption are durably verified. Interrupted gaps need
explicit idempotent inspection/continuation. Catalog/history readers, operation
projection and active-state admission must be compatible before any unlock.
The ephemeral lifecycle witness cannot be reconstructed after Manager restart.

All owned test/typecheck sessions completed. Only isolated Fake/test files were
used; no real Minecraft, world, backup repository, Windows configuration or P7
access changed. No Git publication. Latest quota reading: 5h38% used, weekly99%
used, ordinaryUsageAllowed=true; this is near-limit checkpointing, not a claim
of exhausted quota. No reset credit was redeemed.
