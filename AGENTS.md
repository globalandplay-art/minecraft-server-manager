# Project instructions

## Operating goal and model routing

Minimize total token/allowance through final PASS while preserving every
existing product, phase, safety, testing and review Gate. Count reasoning,
tests, rework, context and coordination cost.

Default engineering: **GPT-6.1 Sol / Medium**. Small mechanical tasks:
**GPT-6 Luna / Low**; small features with an explicit design: **Luna / Medium**.
Default subagent budget: **0**. The user has now explicitly authorized agent
use for the P3.2 work; keep one writer for coupled transaction modules and use
read-only agents for independent reviews. This authorization does not raise
the model-specific concurrency caps below; budget limits are ceilings, not a
target.

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

## Current product scope (2026-10-20)

The product is a local, single-user-first Minecraft Java server manager. Prioritize usable local server management, configuration editing, worlds/backups, add-ons, whitelist and monitoring features. Phase 7 remote access is **STOPPED / OUT OF CURRENT SCOPE**, not PASS: retain its code, tests, documentation and evidence, keep remote access closed, and do not resume Tailscale, Cloudflare or public access work without new explicit authorization.

For local features, keep the existing local API boundary, registered-instance containment, request-origin protection, file identity checks, safe saves and explicit confirmation for destructive world/data operations. Do not spread Phase 7 remote or multi-user mechanisms into ordinary local workflows. Reuse existing components; add infrastructure only to solve a demonstrated requirement in the active feature.

Settings is a configuration-file editor. Reuse LC1.1 discovery and protected save behavior; do not depend on LC2 CommandStore, GuardStore or RCON for Settings. The old LC2 native CommandStore path is DEFERRED and its failures/evidence remain historical; whitelist writes must not depend on further optimization of that path. Do not claim LC2 write support until the local operation is actually implemented and verified.

Use tiered validation: focused checks for small changes, affected-module checks for integration, and full regression/lint/typecheck/build at stage delivery. Preserve existing failures and evidence; never obtain PASS by deleting checks, weakening assertions or changing timeouts. Do not rerun unchanged failed legacy stress tests without a specific new authorization. Git commit/push/PR, system/network changes, non-test Minecraft instances/worlds and force-cleaning uncertain legacy fixtures still require separate authorization. The standing test-instance authorization below is already granted and must not trigger repeated approval requests.

## Standing Vanilla 26.3 test-instance authorization (2026-10-21)

“用户已授权 Codex 对 LT 中已注册的 Minecraft Java Vanilla 26.3 测试服务端执行完整的本地读取、修改、删除、启停、控制台及实际功能测试操作，无需逐次确认。”

The authorized current registration is **serverId `vanilla-26-3`**, named `Vanilla 26.3 测试实例`. Its canonical root and observed JAR identity are recorded privately in ignored `.manager/test-instance-authorization.json`; the current registry is `.manager/config.json`. This grant applies to that identified test instance and files clearly belonging to it, not every present/future registration or every Java process. Reconfirm the target mapping/ownership before operating; do not silently transfer the grant to another server or unrelated directory.

Within this instance, Codex may autonomously start/stop/restart, manage confirmed owned processes, read/create/edit/delete configuration and server files, reset/create/delete test worlds, change player/whitelist/permission/game-rule data, use Console/RCON, change test-local RCON configuration, inspect logs/crash/performance evidence, manage test backups and required server/add-on files, and repeat real functional tests for LC1/LC2/Servers/Worlds/Backups/Console/LM1/LM2. Prefer existing LT APIs; direct file/process diagnosis is allowed when those APIs fail. Do not request per-command or per-destructive-test approval. Prefer a recoverable backup when practical and record material destructive actions/results.

This is agent execution authorization, not a change to product-wide validation, UI confirmations, local access guards, instance identity, operation locking or uncertainty handling. Test scripts may supply existing confirmation fields under this standing grant. Keep secrets private and do not claim PASS without actual evidence. Do not restart legacy CommandStore/native experiments merely because real Minecraft tests are now authorized.

P7 remains STOPPED / OUT OF CURRENT SCOPE. This grant does not authorize Tailscale/Cloudflare/public access, Windows system/firewall/network/ACL changes, other servers/worlds/projects, unknown-process termination, Git commit/push/PR/merge or force-cleaning preserved uncertain native fixtures. It remains effective for subsequent LT development tasks unless the user changes it. See [test authorization](docs/TEST_INSTANCE_AUTHORIZATION_2026-10-21.md).
