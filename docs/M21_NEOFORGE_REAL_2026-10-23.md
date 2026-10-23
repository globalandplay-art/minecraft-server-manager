# M2.1 NeoForge 26.3 real lifecycle checkpoint

## Result

NeoForge26.3.0.95 / Minecraft26.3 / Java25: **BUSINESS PASS**.
Strict diagnostics and repository-wide Final Gate remain **BLOCKED**.
This is bounded support for this exact installation, not arbitrary NeoForge versions.

Run: `m2-loaders-real-7fbbffa3-e1bf-44e9-866b-d3c342b8bbd4`.
Private evidence remains ignored under `.manager/<run>/`; fresh worlds remain
under `runtime/<run>/`. Neither source installation nor original worlds changed.

## Implementation

Reuse existing registration, detection, Java profiles, runtime supervisor,
operation locks and generation-bound RCON. Exact official run.bat/win_args
bytes describe the supported installation; neither script nor @argfile is
executed. A fixed direct Server main/classpath binds 68 JARs plus two descriptor
files, with file/directory identity and SHA revalidation. Client discovery
markers, hidden classpaths, unsupported descriptors and applicable environment
overrides are rejected. Registration now labels the launch-file input clearly.

## Real evidence

- Five lifecycle operations succeeded: start Vanilla, start NeoForge, restart
  NeoForge, stop NeoForge, stop Vanilla.
- Three owned Java generations: Vanilla PID23112; NeoForge PID32060 then3448.
  All exited normally with exitCode0 / exitSignal null; no premature exit.
- Distinct worlds/seeds, owned game/RCON channels and RCON/list verified.
  NeoForge restart preserved its seed and left the peer's generation alive.
- Same-key replay did not create another process.
- No crash report, cleanup error or diagnostic stdin-stop fallback.
- finalStopped=true; helpersClosed=true; portsReleased=true;
  sourceInputsUnchanged=true; sourceWorldAccessed=false.
- A new Manager process replayed all five original operation keys, with
  launchAttempts=0; `manager-reopen-check.json` and reopen log report PASS.

## Validation

- Affected API integration:138 PASS/7 files before the final six marker
  negative cases; final binding suite24 PASS (formerly18). Unchanged affected
  results remain applicable; no claim of a fresh full API regression.
- Registration Web4 PASS; contracts26 PASS.
- Root lint, typecheck, production build and diff check: exit0.
- Initial missing-import compile failure and one newly added runtime test's
  wrong expected wrapper error were corrected; original logs retained.
- Independent Sol High pre-real source/acceptance review: no open P1/P2/P3
  after completing client discovery marker rejection. Independent final
  code/evidence review also found no open P1/P2/P3: three normal exits, five
  durable successful operations and zero-launch reopen confirmed; 140 source
  and copied-baseline file reads had zero hash mismatches.

## Remaining gates and limits

The real runner exited1: strict diagnostics were not relaxed. Perflib009 /
0x80070057 and OSHI stack traces, terminal capability warnings, and Log4j
DebugFile appender exception diagnostics remain captured unchanged. Business
success does not erase these diagnostics or certify performance collection.
No Windows system repair or classifier change was made.
The appender stack identifies Netty kqueue/epoll unsupported-platform static
initialization during Log4j exception rendering (OSX/BSD or Linux required),
rather than proving a missing NeoForge JAR; it still remains strict BLOCKED.

Later final closure: applicable API2677PASS (six deferred legacy suites excluded),
Web224PASS, contracts26PASS, all static/build checks and three-width real
registration browser checks PASS; mandatory independent Adapter source gate
has no open findings. See [stage report](./M21_FINAL_GATE_2026-10-23.md).
Whole-repository complete regression and strict diagnostic PASS are still
not claimed. Historical full API and native LC2 failures remain retained,
without rerunning deferred CommandStore experiments.
M2.1's supported Forge/NeoForge lifecycle business scope now has real evidence;
unconditional ENGINEERING/FINAL PASS is not claimed.

No commit/push/PR. P7 remains STOPPED; M3 has not started.
