# LC1 / LC2 registered-instance real validation — 2026-10-21

**Subsequent independent attribution and user direction:** LC1/LC2 real business
PASS remain valid. Perflib is a nonfatal Minecraft initialization environment
issue, DEFERRED and no longer a prerequisite for M1. The strict harness BLOCKED
reports below remain unchanged; this does not establish a complete repository
PASS. See [the complete call-chain investigation](./PERFLIB_INVESTIGATION_2026-10-21.md).
The earlier wait-before-M1 sequencing below is historical and superseded.

## Result

**LC1 and LC2 scoped business checks PASS; complete real acceptance BLOCKED.**
The blocker is the host Perflib diagnostic below, not a failed configuration save
or whitelist operation. M1 has not been started under the user's sequence.
No product source was changed in this validation round. No Git publication.
Phase 7 remains STOPPED / OUT OF CURRENT SCOPE.

Target: the standing-authorized registered Vanilla 26.3 test instance
`vanilla-26-3`. Canonical root/JAR binding is checked against the ignored private
authorization record and current registry. Before changing configuration, a
read-only host query required zero existing Java processes and both original
instance ports to have no listener. No other server was selected.

## Real runs and immutable evidence

1. `lc12-real-447e8e00-b204-471d-b217-6b841a70e3d5`: exit 1 / BLOCKED.
   Configuration save/restart replay and initial startup checks ran; the startup
   diagnostics assertion stopped completion before LC2. Its LC1/LC2 `NOT RUN`
   completion markers remain unchanged, alongside the partial checks.
2. `lc12-real-bf9f353d-0c10-40e1-9840-1a0c90420a6c`: exit 1 / BLOCKED.
   Collects independent LC1/LC2 business evidence before the same mandatory final
   diagnostics assertion. `LC1=PASS`, `LC2=PASS`,
   `startupDiagnosticsPassed=false`, overall `result=BLOCKED`.

Each ignored `.manager/<runId>/` contains `acceptance-report.json`, redacted
launch stdout/stderr, committed property journals/guards, and private original
file backups. Do not publish originals or runtime/evidence. Neither report was
rewritten. Existing historical full-regression/native failures remain failures.

## LC1 actual checks

- Actual `server.properties` unknown key appears dynamically, stays read-only,
  and core `motd` appears once.
- LT PATCH changes `motd`, `max-players`, `difficulty`, `gamemode` with revision
  and idempotency headers. Result is a succeeded operation and committed journal.
- Saved bytes equal the existing incremental patcher output exactly; unselected
  configuration/comments and the test discovery field are preserved by LT save.
- Pinned protection original matches pre-save bytes exactly.
- Same-key replay returns the same operation, including after closing/reopening
  the Manager. Save does not launch Java.
- Explicit owned Java launch reaches fresh Done; creative mode, hard difficulty,
  and max 7 players are checked against real startup/RCON output.
- `online-mode` remains true. No UUID is invented. Missing/unverified fields are
  not forced into the file. This run does not validate all versions or settings.

## LC2 actual checks

- Production `direct-rcon` service reports writable only for the correct managed
  Vanilla process and bound RCON channel.
- Test player comes from the actual instance's usercache candidate API. The
  backend uses Minecraft's native identity resolution, never a supplied UUID.
- Real add succeeds; duplicate add reports `ALREADY_WHITELISTED`.
- Real remove succeeds; removing the absent member reports `NOT_WHITELISTED`.
- Saved file and runtime list agree; the service checks the owned process and
  bounded operation log window. Candidate reading reports available.
- This is real RCON/API evidence. Prior UI/browser tests cover manual and
  candidate submissions sharing this endpoint. No browser was connected to the
  real server in these runs. Actual network-loss UNKNOWN remains covered by
  existing Fake tests, not claimed as a new real fault injection.
- Deferred native CommandStore/GuardStore and legacy crash/capacity tests were
  neither used nor rerun. No whitelist on/off, offline editing or other loaders
  are claimed by the current minimal add/remove scope.

## LC12-REAL-HOST-PERFLIB-001 — HIGH / HOST BLOCKED

Direct evidence, both real starts:

```text
[11:19:06] [ServerMain/ERROR]: Unable to locate English counter names in registry Perflib 009. Counters may need to be rebuilt:
com.sun.jna.platform.win32.Win32Exception: 参数错误。
    at oshi.driver.windows.registry.HkeyPerformanceDataUtil.mapCounterIndicesFromRegistry(HkeyPerformanceDataUtil.java:274)
[11:19:06] [ServerMain/WARN]: Unable to locate English counter names in registry Perflib 009. Assuming English counters. Error 0x80070057. See https://support.microsoft.com/en-us/help/300956/how-to-manually-rebuild-performance-counter-library-values
```

The timestamp above is from the preserved first run; the second report retains
its own events. Component: Minecraft's OSHI/JNA Windows performance-counter
initialization. Explicit error code `0x80070057`; harness final assertion code
`ERR_ASSERTION`, foreground exit 1. No evidence that LC1/LC2 caused the registry
condition. Exact host-internal cause is not established by this validation.
No registry/ACL/Perflib repair, counter suppression, JVM workaround or classifier
allowlist change was attempted. Host repair attempts: 0. Functional evidence
does not clear the diagnostics Gate or establish a complete project PASS.

## Safe final state

Both runs stop Java explicitly with exitCode 0 / exitSignal null; owned child
close and application close are confirmed. Second run checks game/RCON ports
11723/11724 released. `finalStopped=true`, `helpersClosed=true`,
`appClosed=true`, `restored=true`.

Original `server.properties`, `whitelist.json`, and `usercache.json` are restored
byte-for-byte after all owned Java handles close; an independent post-run hash
comparison also returned true for all three. Test-local RCON settings and
configuration values are therefore not left active. Worlds were not reset.
Startup crash-report names equal the pre-run list; one existing crash report is
retained, so do not claim the directory was empty. Private guards/journals and
all historical uncertain native fixtures remain preserved.

## Engineering verification and review

- New combined affected API set: **232 PASS / 10 files**, exit 0, 10.09 seconds.
  Log: ignored `test-results/lc12-focused-2026-10-21.log`.
- New harness Node syntax check and ESLint: PASS / exit 0.
- `git diff --check`: PASS; existing LF/CRLF normalization warnings only.
- Unchanged candidate evidence reused: LC2 affected API170, contracts20,
  Web217, three widths360/768/1440, lint/typecheck/build and final source review;
  LC1 scoped property/discovery/browser and source review evidence is linked in
  its report. These are not represented as a newly green full regression.
- Independent GPT-6.1 Sol High harness/source delta and final redacted evidence
  review: **P1=0/P2=0/P3=0**. Pre-run close-failure reporting P2 was fixed before
  execution; close failures cannot yield PASS. Evidence review read no originals,
  ran no tests and did not claim to independently inspect current host state.

## Next checkpoint

Do not reopen old LC2 native optimization. Keep LC1/LC2 implemented and their
scoped real business results recorded. Complete clean-host diagnostics acceptance
before declaring whole real acceptance PASS and advancing to M1 under the user's
current sequence. Windows system changes require separate authorization; a
normal-host comparison can first establish whether this is execution-context
specific. M1 remains registered loader detection/registration/switching, then M2
controlled loader lifecycle. P7 remains stopped.
