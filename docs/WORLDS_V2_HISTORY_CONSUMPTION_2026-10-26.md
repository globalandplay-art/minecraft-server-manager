# Whole-history proof consumption — optional integration checkpoint

The existing importer accepts an optional `WorldActivationLiveHistory` verifier.
For a server with activation history, it verifies the whole history once, checks
the exact server, count, unique operation IDs, transaction IDs and full journal
digests against its initial scan, then synchronously confirms only those owned
import/activation operations. There is no await between final proof comparison
and confirmation. On failure all owned operations remain gated. The legacy
first-only importer path remains unchanged when this option is absent.

The live reader now performs another exact full journal scan after its final
source, world and protection checks, and returns operation ownership/digests.
No filesystem adoption, command replay, automatic rollback or broad recovery
cause deletion occurs. `confirmPhysicalTransaction` only supplies initialization
evidence; unrelated existing recovery causes remain untouched.

## Focused and process evidence

Four targeted whole-history cases passed, exit0 (86 filtered): intact,
unrelated recovery cause, damaged inactive world, forged proof operation ID.
They assert each resulting operation state, unchanged catalog/config and0Java.
Service reconstruction alone is not claimed as a new OS process.

Actual command:
`node tests/acceptance/worlds-v2-import-process-crash.mjs --repeated`

Fresh report:
`test-results/worlds-v2-repeated-crash-a1e07a45-0869-4cf0-8e34-494d87375c16/result.json`.
Four boundaries PASS, exit0, allownedchildren closed,0Java, serverbytes unchanged,
4transactions perfixture after3world transitions. The fresh Node probe performs
history-import reconciliation before operation initialization, without active-slot
initialization that could regenerate evidence.

| Third transition boundary | Physical result | Operation result | Recovery |
| --- | --- | --- | --- |
| head-reserved | rejected | interrupted | gated |
| commit-persisted, head pending | rejected | interrupted | gated |
| head-completed | verified | succeeded, exact worldId | clear for these operations |
| after-commit + subsequent save | verified | succeeded, exact worldId | clear for these operations |

Previous physical-only report590ae162 remains unchanged; its completed outcomes
were deliberately still gated. The new report proves added consumption behavior,
not that the old result was PASS for operation recovery.

Independent GPT-6.1 Sol High source+process evidence delta: P1/P2/P3=0;22/22
report source hashes match. Reviewer checked exact completed/partial states,
process identity/closure, unchanged bytes and0Java. No reviewer tests/edits or
Astra invocation. Final affected test result is recorded below when completed.

Final affected report
`test-results/worlds-v2-history-consumption-2026-10-26.json`:97PASS/0FAIL/0filtered,
2files,exit0,94.38s. Three-hop test4225ms under unchanged5000ms; all four exact
proof-consumption cases passed. API typecheck/build/scoped lint/diff passed.

## Remaining boundary

Production app does not yet pass this option; existing first-only reconciler
ordering must be changed carefully to avoid adding old recovery causes before
new confirmation. Bounded startup/cancellation and real Fastify startup/restart
integration remain pending, as do strict write API/UI and real Minecraft loading.
No full repository, browser, production exposure or V2 FINAL PASS is claimed.
P7 STOPPED; no Git publication or real world changes.
