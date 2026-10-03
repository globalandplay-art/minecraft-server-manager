# Perflib 启动环境修复：待授权

2026-10-02。本文件是可审查的主机修复方案，不表示已执行。P3.2 / P3.3b 的干净启动 Gate 仍 BLOCKED。未修改产品安全合同，也未通过忽略日志 ERROR 放行。

## 最新只读证据

普通用户权限、测试沙箱以外：64-bit registry view 的 Perflib `009`、`0804`、`CurrentLanguage` 的 Counter 查询均返回参数错误（exit 1）；Win32_OperatingSystem 查询正常，系统为 Windows 11 中文家庭版 build 26200。`lodctr /q:PerfOS` 报告 Enabled。以上证明不是单纯 WMI 沙箱访问拒绝，但尚不能证明名称表损坏的唯一原因。

最新隔离 Minecraft 启动实际日志含 Perflib 009 ERROR / Win32Exception；真实创建功能通过不等于无错误启动验收通过。没有重复启动未变化环境中的 Minecraft。

本次保存的私有恢复材料目录：`.manager/perflib-followup-20261002-163441/`。

| 文件 | Bytes | SHA-256 |
| --- | ---: | --- |
| counters.before.ini | 1872416 | 7999A5B3AE18556F9B4603DABEAB6142BEEC65BEE852858928969CC09D8C04CE |
| PerfStringBackup.before.ini | 1849730 | 4D4FA24FF3D0A12F77991ED7FF9AD6D30AFDC6E85E3892635EDD386537F3CD9D |

`lodctr /s` 输出明确报告成功，并检查生成文件存在、大小和摘要。系统备份副本的摘要与前次一致；导出快照摘要变化本身不代表修复成功。备份保存当前已异常状态，只用于撤销本次后续重建引入的变化，不保证恢复到健康状态。

## 第一项待批准操作

在管理员 PowerShell 中，只执行一次 64-bit 计数器重建：

```powershell
& C:\Windows\System32\lodctr.exe /R
$mcsmRebuildExit = $LASTEXITCODE
Write-Output "RebuildExit=$mcsmRebuildExit"
& C:\Windows\System32\reg.exe query 'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' /v Counter /reg:64
$mcsmNameQueryExit = $LASTEXITCODE
Write-Output "NameQueryExit=$mcsmNameQueryExit"
```

影响：重建全机性能计数器名称/帮助注册信息，包含第三方计数器；不是 Minecraft 专属操作。不会主动停止服务器、重启服务或重启电脑。必须保存完整输出；不能仅凭退出码 0 或乱码 Info 判断成功。名称表检查未通过时停止，不自动重复 /R。

此前用户曾手动执行 System32 lodctr /R，截图 Info 无法提供可核验结果。当前仍失败，因此本次管理员权限下的完整输出与后续查询是必要证据，不能把旧截图视为修复完成。即便重建成功也须再次检查真实 Java 日志。

如第一项仍失败，保留结果后单独决策；不得默认继续 SysWOW64 重建、WMI resync、服务重启、注册表删除、仓库 reset 或操作系统修复。微软一般重建流程含 32-bit 和 WMI 步骤，但不意味着已获本项目执行授权或适合不加区分地套用到当前主机。

## 回退材料与后续验收

如需撤销计数器重建，对上述 counters.before.ini 的 `lodctr /r:<file>` 恢复同样是全机写操作，须确认影响后单独批准；不自动覆盖系统 PerfStringBackup.INI。当前备份不包含全量主机或注册表恢复点，不宣称完整系统回滚。

只在名称表检查有实质改善后，用全新隔离目录重新运行真实创建与恢复/显式回滚验收，只复制 JAR 和已接受 EULA，不触碰原世界。检查所有实际 ERROR、pinned guard、事务门控、最终 stopped/none；补齐独立 Gate 才能标为完成。未变化的产品代码不重复全套测试。

参考：[Microsoft lodctr 命令说明（包含 Windows 11）](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/lodctr)、[Microsoft 计数器重建流程（Windows Server 范围）](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/manually-rebuild-performance-counters)。命令文档说明退出码 0 不保证操作成功，并说明 /r:file 覆盖计数器注册设置；适用版本和重建结果应按实际证据确认。
