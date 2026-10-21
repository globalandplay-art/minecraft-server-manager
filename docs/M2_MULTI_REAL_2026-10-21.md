# M2 simultaneous real-instance acceptance

Current update: both Paper/Fabric restart directions and three fresh Manager
process reopen/replay checks have now passed their actual business checks.
Strict diagnostics remains BLOCKED. The full bounded delivery decision and all
run IDs are in [M2 delivery](./M2_DELIVERY_2026-10-21.md); the original Vanilla
run and the following artifact/environment failures remain unchanged.

## Scope and authorization

Following the explicit proposal for two new UUID-isolated Vanilla instances,
the user instructed completion of M2. This execution uses that task-specific
scope, not an automatic expansion of the standing registered-instance grant.
Original registration and world/player files were not modified or copied.
Only already-accepted EULA and the verified Vanilla26.3 JAR were copied.

`tests/acceptance/m2-multi-minecraft-real.mjs` uses genuine local-config loading,
Java detection, launch revalidation, LT HTTP/OperationService, shared factory and
Windows game/RCON socket PID verification. It creates fresh UUID roots under
`runtime/` with evidence under `.manager/`, prints canonical test paths before
creating test server files, and preserves all files/evidence after stopping.
No original worlds, player data or source configuration are accessed.

## Dual Vanilla actual run

Run **m2-multi-real-17d2b11e-e9fa-4d96-9887-4b9533882925**.
**Business PASS; strict diagnostics BLOCKED; overall BLOCKED, exit1.**

Private report: `.manager/<runId>/acceptance-report.json`, three redacted
launch stdout/stderr pairs. Runtime roots: `runtime/<runId>/m2-a` and `m2-b`.

- Both start operations succeed concurrently using the same idempotency key
  scoped to separate server IDs; distinct operation IDs are required.
- A1 PID25168, B1 PID23732, A2 PID25860. Each has fresh Done, managed running,
  game/RCON native ownership proof, actual list and world-specific seed query.
- A seed111111 and B seed222222 remain distinct through real RCON responses.
- Explicit restart A changes only A generation, preserves its world seed and
  leaves B's original process alive. Same-key restart replay creates no child.
- Stopping A leaves B responsive to actual list/seed; then B stops explicitly.
- All five operations succeeded. Three children closed with exit0/null and no
  premature exit. finalStopped/helpersClosed/portsReleased/noCrashReport=true,
  cleanupErrors=[], no diagnostic stdin or capture overflow.
- Source JAR/EULA bytes rechecked unchanged; sourceWorldAccessed=false. No
  source server launch, system/network/ACL change or uncertain fixture cleanup.

Independent Sol High fallback source and real-evidence review: **P1/P2/P3=0**
within the reported lifecycle business scope. Review did not run tests or read
private configuration. Sol6.1 capacity failure and fallback were already recorded
in the preceding restart report.

## Retained host failures

Perflib009 ERROR/WARN and `0x80070057` remain blocking in the unmodified strict
classifier. New warnings appeared during B startup and A restart:

```text
Failed to get system info for Process Loads
Failed to get system info for Process Virtual Size (MiB)
Failed to get system info for Process Resident Size (MiB)
```

The corresponding stacks are Minecraft `SystemReport.putProcessDetails` with
an unavailable OSHI OSProcess. This is a real system-information acquisition
failure. Timing and call path correlate with the same startup's Perflib event;
they do not prove Perflib is the sole direct cause of the unavailable OSProcess.
Done, actual list/seed, connection ownership, restart and normal stop all passed.
Do not relabel these diagnostics PASS or infer LT performance sampling is valid.

`M2-HOST-OSHI-PROCESS-001`: ENVIRONMENT/DEFERRED, exact root cause UNKNOWN,
no repair attempt. It does not invalidate separately demonstrated lifecycle
business; it continues to block strict diagnostics. No timeout/classifier/
assertion weakening or Windows repair was attempted.

## Existing-loader follow-up

An opt-in `paper-fabric` mode reuses the existing P5.5 read-only source whitelist,
per-file identity/SHA verification and already-accepted EULA. Only exact launcher
dependencies are copied to fresh roots; source worlds/properties/addons are
excluded. This uses the earlier explicit Paper/Fabric test-source authorization.
It does not rerun or relax the historical P5.5 host gate. Its independent M2
business and unchanged strict diagnostics results must be recorded separately.

This report does not establish Forge/NeoForge support. M2 applies to loaders
whose M1 launch contract is already verified; those unsupported launch contracts
remain M1 work. Whole-repository final PASS is not implied. Old full API failures
and native experiments remain preserved; P7 STOPPED; no commit/push/PR.
