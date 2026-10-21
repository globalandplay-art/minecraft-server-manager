# Perflib 009 / 0x80070057 — independent environment investigation

## Conclusion

**Nonfatal Minecraft startup diagnostic; independent Windows/OSHI environment
issue, DEFERRED pending diagnosis/repair. Not an LC1/LC2 business failure and not
an M1 prerequisite.** This classification follows the user's 2026-10-21 direction.
No original report, assertion, classifier or failure evidence has been rewritten.
No new Minecraft launch, registry query/repair, performance-counter rebuild or
old CommandStore native experiment was required for this investigation.

LC1: **REAL BUSINESS PASS** in its tested Vanilla 26.3 scope.
LC2: **REAL BUSINESS PASS** in the current minimal add/remove/list scope.
Repository complete acceptance: **not newly PASS**; historical failed full API
regression and the strict real harness exit1 remain recorded separately. New M1
affected and Web/contracts results are recorded in its validation report.

## Exact evidence and order

Read the complete redacted stdout/stderr and acceptance report of preserved run
`lc12-real-bf9f353d-0c10-40e1-9840-1a0c90420a6c`, and the first blocked report
`lc12-real-447e8e00-b204-471d-b217-6b841a70e3d5`.

```text
11:21:20 ServerMain/ERROR: Unable to locate English counter names in registry Perflib 009. Counters may need to be rebuilt:
com.sun.jna.platform.win32.Win32Exception: 参数错误。
  Advapi32Util.registryGetStringArray:921,898
  HkeyPerformanceDataUtil.mapCounterIndicesFromRegistry:274
  HkeyPerformanceDataUtil.<clinit>:51
  ProcessPerformanceData.buildProcessMapFromRegistry:45
  WindowsOperatingSystem.queryProcessMapFromRegistry:328
  WindowsOperatingSystem.getProcess:292
  OperatingSystem.getCurrentProcess:246
  net.minecraft.SystemReport.lambda$putSoftware$0:116
  net.minecraft.SystemReport.ignoreErrors:121
  net.minecraft.SystemReport.putSoftware:116
  net.minecraft.SystemReport.ignoreErrors:121
  net.minecraft.SystemReport.<init>:68
  net.minecraft.CrashReport.<init>:35
  net.minecraft.CrashReport.preload:252
  net.minecraft.server.Main.main:104
11:21:20 ServerMain/WARN: ... Assuming English counters. Error 0x80070057.
11:21:26 Server thread/INFO: Starting minecraft server version 26.3
11:21:26 Server thread/INFO: Default game type: CREATIVE
11:21:27 Server thread/INFO: Preparing level "world"
11:21:27 Server thread/INFO: Done (0.243s)! For help, type "help"
11:21:27 Server thread/INFO: RCON running on 127.0.0.1:11724
11:21:37 Server thread/INFO: System chat: [Rcon: Added Stay_Forest to the whitelist]
11:21:37 Server thread/INFO: System chat: [Rcon: Removed Stay_Forest from the whitelist]
11:21:38 Server thread/INFO: System chat: [Rcon: Stopping the server]
11:21:38 Server thread/INFO: Stopping server
11:21:38 Server thread/INFO: Saving players / Saving worlds
```

The shortened stack above preserves actual method/line relationships; complete
raw lines remain in the ignored run logs. The diagnostic is also in latest.log
as evidenced by the report's occurrence arrays, not an unrelated manager error.

The error occurs about seven seconds before Done, in OSHI's Windows registry
performance-counter name mapping while Minecraft preloads its system/crash-report
information. A stack mentioning `CrashReport.preload` does **not** establish that
a crash occurred. The subsequent log and captured child show continued service.
The WARN explicitly reports an English-counter assumption/fallback. The mapping
query failed; the exact underlying registry/context condition remains UNKNOWN.
No conclusion that all Windows counters or all performance metrics failed is
supported by these logs alone.

## Minecraft process vs test process

- Minecraft child PID17000: alive through LC1 effect checks and LC2 commands;
  normal explicit stop, `exitCode=0`, `exitSignal=null`, `closed=true`.
- Readiness evidence: fresh Done, managed process, RCON/list, expected world,
  game/RCON ports, no premature shutdown. Existing crash-report names are
  unchanged at startup; an old crash report is retained, not silently deleted.
- Real operations: LC1 protected save/restart replay and actual difficulty,
  game mode and player capacity; LC2 add/remove and explicit duplicate/missing
  outcomes, saved/runtime membership agreement.
- Harness: `ERR_ASSERTION`, foreground exit1, overall report BLOCKED.
  `tests/acceptance/import-diagnostics.mjs` puts any Perflib/Hkey/Win32Exception
  match into a field named `fatalRuntimeDiagnostics`; `diagnosticsAllowed` rejects
  it alongside ERROR/WARN. That field is a **classifier name**, not proof of a
  fatal Java process event. `lc12-registered-real.mjs` finally asserts
  `startupDiagnosticsPassed`, causing the independent harness failure after
  business checks and normal shutdown. The first run asserted earlier and did
  not reach LC2. Both historical outcomes remain intact.

## Performance impact boundary

Confirmed: OSHI's registry name-map query failed during Minecraft SystemReport
initialization. Minecraft continued and business commands worked.

Unknown: which particular OSHI-derived optional process-report fields were
available after its fallback; the exact host cause; current LT metric samples.
LT CPU/RAM collection uses `Get-Process` `TotalProcessorTime`/`WorkingSet64` in
`apps/api/src/infra/runtime/process-resources.ts`, not the failing OSHI name-map
routine. There is no basis to mark LT CPU/RAM PASS or FAIL without actual samples.
Unavailable values must still be N/A. TPS/MSPT are not inferred from this error.

## Disposition

`LC12-REAL-HOST-PERFLIB-001`: **ENVIRONMENT / DEFERRED**, repair attempts0.
Strict clean-diagnostics acceptance remains historically BLOCKED; business
acceptance remains PASS. No generic ERROR/WARN allowlist and no system changes.
Independent GPT-6.1 Sol High evidence/call-chain review agrees with the nonfatal
classification and with proceeding to independent M1 work. Do not reopen old
CommandStore work. A future environment-only investigation may compare normal
host execution and targeted read-only counter observations before any separately
authorized Windows repair.
