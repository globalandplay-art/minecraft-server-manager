# M2 authorized Vanilla explicit restart acceptance

Run **m2-real-ce266a0a-a487-4033-9008-57955b84c8ee** used only the standing
registered `vanilla-26-3` test instance. Script:
`tests/acceptance/m2-registered-lifecycle-real.mjs`, with
`LT_REGISTERED_REAL=1` and opt-in `LT_M2_RESTART=1`.
The original default single-launch mode and its historical evidence remain.

**REAL BUSINESS PASS. Strict diagnostics BLOCKED. Command exit1.**

- Start `ba55400f-c113-4639-991c-3d421336c794`, restart
  `82fa32d7-583a-4b57-9299-9668b275d4de`, stop
  `c3dffe79-268f-4f9c-ae92-6b446382749f`: all succeeded.
- Exactly two Java generations, PID14648 then PID19568. Each has fresh Done,
  managed running, recoveryRequired=false, real RCON list, game/RCON established
  socket tuple/PID proof. Restart changes child PID.
- Same-key restart replay returns original operation, no extra launch.
- Both close with exitCode0, exitSignal=null, premature=false.
- Explicit normal stop, no diagnostic stdin. finalStopped/restored/helpersClosed/
  portsReleased/noNewCrashReport=true, cleanupErrors=[]. Original properties
  restored with exact byte comparison. No world reset or different registration.
- Separate post-run read-only check (`postcheck.json`): configRestored=true,
  both ports refused connections, extraLaunch=false, result=PASS.
- Private ignored evidence: `.manager/<runId>/acceptance-report.json`, four
  redacted launch logs and private configuration backups. Do not commit secrets.

Both launches retain the existing OSHI/JNA Perflib009 ERROR/WARN and
`0x80070057`, `com.sun.jna.platform.win32.Win32Exception: 参数错误。`.
Two blockingErrors, no unclassifiedWarnings or additional exception blocker.
No classifier/system/network/ACL change. Strict BLOCKED is preserved separately
from proved successful lifecycle business. Existing issue
`LC12-REAL-HOST-PERFLIB-001` remains ENVIRONMENT/DEFERRED.

Harness syntax/lint PASS. Affected API **120PASS/8files**, exit0, unchanged
maxWorkers2 and timeouts (`test-results/m2-final-affected-v1.log`). Final root
lint/typecheck/build PASS (`m2-final-{lint,typecheck,build}.log`). This is affected
regression, not whole-API green. Product TS/UI/contracts were not changed in this
restart slice; prior contracts/Web/browser results remain their original evidence.

Independent source and actual-evidence review: **P1/P2/P3=0**. Sol6.1 selection
failed at capacity; authorized fallback Sol6/High performed this review. It read
the report and redacted streams, not configuration backups, and ran no tests.
The initial sandbox process query failed HRESULT0x80041003 before server action;
authorized host query then returned PROCESS_QUERY_OK/no conflicting processes.
The script independently checked no existing Java before preparation.

See [dual protocol PASS](./M2_MULTI_PROTOCOL_2026-10-21.md) for the separate actual
Node processes/TCP integration. Simultaneous real Minecraft, new Paper/Fabric
evidence, Forge/NeoForge verified launch support and applicable final Gates remain
unproved here. Full M2 **IN PROGRESS**. Prepared next script
`tests/acceptance/m2-multi-minecraft-real.mjs` requires separate authorization for
two fresh isolated instances; standing original-instance grant does not cover it.
The new dual-Minecraft script passed syntax and final root lint checks plus
independent Sol6/High pre-execution review P1/P2/P3=0. It has not run. Its plan
copies only accepted source JAR/EULA to fresh UUID roots, uses two fresh worlds
with distinct seeds and four loopback ports, verifies actual per-instance seed
responses and ownership across A restart/B survival, then normal stops. No
existing world/player data or registration is copied or mutated. Explicit
`LT_FRESH_MULTI_REAL=AUTHORIZED_TWO_ISOLATED_INSTANCES` is required, and must
only be set after human authorization. New review does not establish real PASS.

Final diff check PASS (`test-results/m2-final-diff.log`); Git emits existing
LF/CRLF normalization warnings without whitespace errors. No new whole-project
test PASS is claimed. Separate failed draft documentation patch was rejected
before applying any changes; after reading the actual header it was corrected.

Historical whole API2510PASS/12FAIL retained; old CommandStore experiments not run.
No commit/push/PR. P7 STOPPED. No uncertain fixtures forcibly cleaned.
