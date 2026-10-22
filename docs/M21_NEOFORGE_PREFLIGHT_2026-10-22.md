# M2.1 NeoForge preparation checkpoint

## Status

**BLOCKED — official dependency cache incomplete.**
No NeoForge production adapter was wired, installer executed or Minecraft
launched. Forge26.3/66.1.0's separate BUSINESS PASS remains valid. M2.1 overall
is IN PROGRESS; P7 remains STOPPED and M3 has not started.

Official Maven metadata identified26.3.0.95 for Minecraft26.3. The official
installer matched its published SHA-256:
`59ed4c58cc5b49e3df876658196d34c23184f5f73986e352508cdbddc88aa7fb`.
Static receipt/profile evidence:
`.manager/m21-neoforge-probe-6ec2ac62-f3b1-4db6-9337-010f67db7385`.

## Actual launch-format findings

- Installer server profile has30 libraries and2 processors.
- Client `version.json` is **not** a server entry: its main is
  `net.neoforged.fml.startup.Client`.
- Embedded server win_args uses fixed opens/exports, IPv6/libraryDirectory
  settings, a full Maven-layout classpath, direct
  `net.neoforged.fml.startup.Server`, and exact NeoForge/Minecraft/NeoForm
  version parameters. It is not the Forge shim `-jar` contract.
- Installed-cache loader12.0.12 bytecode confirms Server starts dedicated
  loading, calls Minecraft Main, joins the server thread and closes its startup
  result. This does not establish the full transitive artifact-loading closure.

Independent Sol High feasibility review permits a narrow direct-main adapter
using a verified installation descriptor and existing registration/runtime.
Do not execute arbitrary batch/@argfiles/user_jvm_args or use an auto-installing
starter as production startup. Before wiring, prove the complete runtime
closure outside the explicit classpath, including patched Minecraft and
NeoForge artifacts selected by library/version metadata. The incomplete cache
currently prevents that evidence. No new supervisor/native framework or full
official-hash catalog is required by the existing selected-local-JAR trust
model; observed identity/SHA must not be called official authenticity proof.

## Preparation failures, preserved separately

Preparation ID `m21-neoforge-install-04159990-16ed-4e7d-a651-05ccb76406b2`.

1. PowerShell5 `Invoke-WebRequest -OutFile` failed on a long Maven artifact
   path with `DirectoryNotFoundException`. This was tooling/path length, not a
   Minecraft failure. Partial files/logs were retained. A fresh short test
   directory under the authorized Codex root avoided this limit without
   changing Windows long-path settings or moving/deleting the original scene.
2. The short-path PowerShell download then failed with
   `基础连接已经关闭: 发送时发生错误。`, category WebException. HResult was not
   captured and remains UNKNOWN.
3. A bounded curl route reused exact-checksum local partial artifacts and
   attempted each missing dependency at most once. It failed with **exit35**:
   `schannel: failed to receive handshake, SSL/TLS connection failed`.
   No `--insecure`, certificate bypass, timeout increase or system/proxy/DNS
   changes were used. No further network retry was scheduled.

Network transport/precondition is the current direct blocker; its underlying
host/network cause is UNKNOWN. Do not attribute it to a specific proxy or
software. This is independent of the resolved long-path tooling limit and
of the old Forge COMMON watcher issue.

## Remaining exact official artifacts

27 unique installer/runtime metadata dependencies already match expected
official SHA-1 values. Three are missing:

| Official Maven-relative artifact | Expected SHA-1 |
| --- | --- |
| `org/jline/jline-terminal/3.20.0/jline-terminal-3.20.0.jar` | `d0ddcc708ddf527a3454c941b7b9225cc83a15ff` |
| `net/neoforged/installertools/installertools/4.0.17/installertools-4.0.17-fatjar.jar` | `d0e22dfef7eb7eeffa20fee4c393b3f7cad0323b` |
| `net/neoforged/neoforge/26.3.0.95/neoforge-26.3.0.95-universal.jar` | `cd04422b412a6a61191f86505503e5abe0ed2abb` |

The corresponding exact HTTPS URLs, current private short target, receipts,
raw errors and static loader bytecode are in the ignored preparation evidence
root. `remaining-official-cache.json` records27 verified/3 missing;
`checkpoint-report.json` records no installer/server execution or adapter.
No Java/curl process remained at the final process observation. All partial
scenes remain; no forced cleanup was used.

## Resume

Complete only these missing official dependencies after network availability
changes or a verified offline supply is available, then run the official
installer in the prepared fresh target. Revalidate the installer identity,
all cache receipts and source bundle first. Do not redownload verified files
or repeat the already passed Forge lifecycle run. Complete the loader closure
review, controlled descriptor implementation/negative tests, registration/API
integration and fresh real NeoForge lifecycle evidence before claiming support.

No commit/push/PR, original-server/world changes or system changes. The latest
allowance observation was49% remaining in the five-hour window and1% in the
weekly window; it was not exhausted and was not the cause of these TLS errors.
