# LT — Standing local Minecraft test authorization

## Effective user grant

Granted on 2026-10-21 for subsequent LT development:

> 用户已授权 Codex 对 LT 中已注册的 Minecraft Java Vanilla 26.3 测试服务端执行完整的本地读取、修改、删除、启停、控制台及实际功能测试操作，无需逐次确认。

The current target is registry entry **`vanilla-26-3` / `Vanilla 26.3 测试实例`**. The registration was read from ignored `.manager/config.json`. The canonical root was resolved with a check against reparse-point ancestry, and the registered server JAR's `version.json` confirmed `26.3`. The local canonical directory and observed JAR SHA-256 are recorded in ignored `.manager/test-instance-authorization.json`; no password, token or player file is included in that record.

The record identifies the granted target, not a new production security subsystem or immutable JAR rule. Authorized tests may change the test JAR/configuration/files; revalidate actual identity and compatibility after such changes. A changed registry mapping must not silently grant access to an unrelated server directory. Other registered instances are not automatically covered.

## Allowed without repeated confirmation

- Start, stop, restart and manage processes proven to belong to this test instance.
- Read, create, modify and delete its server/configuration files; change test-local RCON configuration as needed.
- Create, modify, reset and delete test worlds, player data, whitelist, permissions and game rules.
- Execute Minecraft Console and RCON commands.
- Inspect logs, crash reports, performance data and other relevant test evidence.
- Create, restore and delete test backups; manage files/add-ons needed for tests.
- Repeated real functional development and debugging of LC1, LC2, Servers, Worlds, Backups, Console, LM1 and LM2.

Use LT management interfaces first. If an interface is broken, direct local file/process diagnosis and repair within this test boundary is authorized. Before a destructive test, prefer a useful backup when practical; inability to make a backup is not automatically a demand for another human approval under this grant. Record relevant changes and evidence, and preserve diagnostic failures.

Do not confuse agent authorization with changes to user-facing product behavior: existing explicit confirmation fields, file/revision checks, local API protections, instance locking and UNKNOWN/no automatic resend remain. The application must not start automatically enabling RCON on arbitrary servers because this one test instance permits test configuration changes.

## Retained boundaries

No authorization is added for other servers/worlds/projects, Windows/system/ACL/firewall/network changes, public access, P7 remote development, broad termination of Java processes, or force-cleaning uncertain historical native fixtures. Confirm process ownership before a direct process action; never terminate every java.exe merely to free a port.

Git commit/push/PR/merge remain subject to the existing separate user authorization. Old CommandStore, GuardStore and native/capacity experiments remain deferred; this grant is not an instruction to resume them.

## Effect on existing documentation and next work

Historical reports saying real Minecraft tests were NOT RUN without authorization remain accurate records of those earlier runs. Their old request-for-authorization language no longer blocks future tests on this identified instance. Unrelated external instances still need their own authorization.

LC2 real add/remove/result checks and LC1 configuration acceptance can now proceed directly on the registered test instance as part of the next development/verification task. There is no requirement to request fresh approval for each launch, configuration change, command or repeat test. This policy update itself does not run a server or establish real acceptance PASS.
