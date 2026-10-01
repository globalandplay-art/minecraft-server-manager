# Project instructions

## Operating goal and model routing

Minimize total token/allowance through final PASS while preserving every
existing product, phase, safety, testing and review Gate. Count reasoning,
tests, rework, context and coordination cost.

Default engineering: **GPT-6.1 Sol / Medium**. Small mechanical tasks:
**GPT-6 Luna / Low**; small features with an explicit design: **Luna / Medium**.
Default subagent budget: **0**. The user's instruction to stop using agents
remains in force; budget limits never authorize restarting them.

Escalate to **Sol High** for uncertainty, coupling, concurrency, transaction
invariants, security boundaries or consequential failures, never simply file
count or diff length. Downgrade once the difficult part is resolved.

Ordinary and medium Feature independent Review defaults to **Sol High**.
Astra is a risk-based Gate: **Medium** for milestones such as P3.1 Final,
Import and Addons; **High** for high-consequence Restore/Explicit Rollback,
data loss, durability/crash recovery, Auth/Remote, Adapter final, Phase 3 final
and release final. Existing mandatory checkpoints remain; do not replace
independent signoff with the writer's self-check.

Consult [CODEX_MODEL_ROUTING](docs/CODEX_MODEL_ROUTING.md) when selecting
models, escalating, reviewing or considering agents. It governs future routing;
preserve historical model and review evidence. Read
[PROGRESS](docs/PROGRESS.md) to locate the actual checkpoint when resuming.
Policy migration alone does not authorize feature work or Git uploads.

If 6.1 Sol is unavailable, temporarily use 6 Sol at the same effort and return
to 6.1 once available at the next selection. Never change account settings or
claim a document switched the active main model. Unavailable required Astra
must leave its Gate pending; all engineering and quality constraints in the
routing document and product contracts remain binding.
