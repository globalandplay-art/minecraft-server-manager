# M3 NeoForge real isolated acceptance

Current run: `m2-loaders-real-1afb966b-8a8a-4bc3-8343-ff5b12de9f9d`.
Status: businessResult=PASS, modLifecycle=PASS; strictDiagnostics=BLOCKED;
overall result=BLOCKED, exit1. Original report is preserved without relabeling.

The standing2026-10-24 user authorization covers these fresh UUID copies.
Original sources and worlds are read-only. Exact roots:

- Manager: `.manager/m2-loaders-real-1afb966b-8a8a-4bc3-8343-ff5b12de9f9d`.
- NeoForge: `runtime/m2-loaders-real-1afb966b-8a8a-4bc3-8343-ff5b12de9f9d/m2-a`.
- Vanilla peer: same fresh run under `m2-b`.

Before execution the host had zero Java and project-test processes. The
existing source preflight validates the fixed NeoForge26.3.0.95 descriptor,
68 complete runtime JAR identities/hashes and two descriptor/anchor files;
no source worlds or mods are copied. Existing accepted EULA and verified
Vanilla JAR come from the standing test registration; no new EULA acceptance.
Java25, fresh root mapping, exact argv, owned game/RCON ports and source
invariance are enforced by `m2-multi-minecraft-real.mjs`. The local annotation-
only marker is compiled against verified dependencies using `-proc:none`;
no downloader, Gradle, run.bat execution, system or network-setting change.

The driver exercises installed, disabled, enabled, trashed-enabled,
restored-enabled and restored-disabled states, with fresh actual starts,
normal stops, marker load/omission, RCON list/seed and a live Vanilla peer.
Manager replay in THIS driver is same-process app/adapter/JsonStore rebuild;
it must not be described as an OS-process restart. Separate formal browser
runs already cover independent Manager process rebuild.

## Actual result and safety evidence

All six expected marker states passed: true/false/true/false/true/false for
installed/disabled/enabled/trashed-enabled/restored-enabled/restored-disabled.
The marker JAR SHA256 is
`bde3a89855657e7e71c0ca950b57adcf54e4d997c96466b794c8c0ee69e4842f`;
the reviewable Java source SHA256 is
`3637ae6ad87050e10a9e34334055da1bd06c12044030046b849f00fce4d46f0d`.
Nine install/lifecycle records have exact committed predecessor relationships,
consumed staging and pinned protection evidence. Replay is true with its
same-process scope; no implicit Minecraft launch occurred during reconstruction.

Seven tracked Java children (six NeoForge, one Vanilla peer) closed normally:
exitCode0, exitSignalnull, premature=false. No crash report, finalStopped=true,
helpersClosed=true, portsReleased=true, sourceInputsUnchanged=true,
sourceWorldAccessed=false, cleanupErrors empty. These refer to tracked process
identity/exit receipts, not a claim that numeric PIDs can never be reused.

## Strict diagnostic failures remain separate

The report has19 blocking ERROR lines,51 blocking Minecraft WARN lines and6
unclassified terminal warnings; captureOverflow=false and prematureExit=false.
No classifier, timeout, test assertion, JVM flag or Windows setting was changed.

- **Windows counter precondition**: `Unable to locate English counter names in
  registry Perflib 009`, `Error 0x80070057`, OSHI SystemReport failures for
  process load/resident/virtual size. Present in Vanilla and NeoForge. It did
  not stop these functional scenes; affected Minecraft internal system-info
  collection is degraded. LT monitoring itself was not accepted by this run.
- **NeoForge/logging artifact failure**: every NeoForge launch has two
  `An exception occurred processing Appender DebugFile` errors.
  `AppenderLoggingException -> NoClassDefFoundError` references
  `io.netty.channel.kqueue.Native` and `io.netty.channel.epoll.Native`;
  nested initialization errors say `Only supported on OSX/BSD` / `Linux`.
  Example launch2 stderr lines11/56/62/107 precede stdout114 fresh Done.
  Stack rendering passes Log4j ThrowableExtendedStackTraceRenderer/LoaderUtil.
  This proves an actual debug-log appender failure, not a Minecraft crash;
  underlying artifact diagnosis remains separate from Manager functionality.
  A later Done does not justify ignoring the error or claim all logs are healthy.
- **Service discovery/network precondition**: launch1 stdout86–121 shows
  authlib failure reading `https://discovery.minecraftservices.com/minecraft/client`.
  `SocketTimeoutException: Read timed out` includes
  SSLSocketImpl.readHandshakeRecord/startHandshake: that captured attempt timed
  out reading the TLS handshake, not a proved DNS/endpoint-logic defect.
  Subsequent AUTHENTICATION/getPublicKeys endpoint discovery is unavailable.
  Online-player authentication was not verified; RCON success cannot prove it.
- **Controlled marker world mismatch**: launch3/5/7 stdout98–100 reports
  `lt_m3_marker (version 1.0.0 -> MISSING)` while intentionally omitting the
  locally built marker. Its source registers no game content, but this does
  not authorize ignoring arbitrary real-mod removal warnings or world risk.
- **Other unclassified format/environment warnings**: six no-TTY terminal
  warnings and NeoForge-formatted Can't-keep-up warnings remain blocked by
  the unchanged classifier. Do not expand a generic WARN/ERROR exception.

Independent GPT-6.1 Sol High confirmed business/marker/transaction/cleanup
evidence, zero newly found product-source P1/P2/P3, and the strict BLOCKED result.
That source-review count is not a waiver of the diagnostic Gate.

## Final regression checkpoint

`test-results/m3-final-candidate-20261024-v1.json` freezes33 changed/new code,
contracts and test files; docs can record results without changing the candidate.
Final broad API regression completed with2832 PASS /2 FAIL (156 passed files,
1 failed file, exit1). Exactly these previously deferred
legacy experiments excluded, not deleted or called PASS:
`whitelist-native.test.ts`, `whitelist-acl-session-native.test.ts`,
`whitelist-sibling-retention-native.test.ts`.
The two failures were stale Forge/NeoForge capability expectations (`mods=false`)
in `local-adapter-capabilities.test.ts`. A test-only delta changes those two
expectations to the existing M3 contract (`mods=true`); focused6 PASS/exit0.
Original broad failure evidence remains unchanged; this is not a new single-run
2834 PASS claim. No product or acceptance-harness source changed after freezing.
Web243 PASS/exit0, contracts28 PASS/exit0, lint/typecheck PASS/exit0.
Web emits two jsdom navigation-not-implemented messages; all assertions pass.
Independent Sol High delta review P1/P2/P3=0 confirmed the contract correction
and evidence boundaries. Strict diagnostics and M3 Final remain BLOCKED.
Build/diff completion is recorded in PROGRESS. No commit/push/PR or P7 work;
no additional server rerun.
