# Phase 5 测试来源登记

用户2026-10-05提供两个已接受EULA且能开服的目录，允许后续隔离验收。只读核对根目录均为普通Directory，无LinkType，eula.txt明确eula=true。

| 用户声明类型/版本 | 本机来源绝对路径 | 顶层启动JAR |
| --- | --- | --- |
| Fabric 26.2 | C:\Users\29104\Desktop\Game\minecraft服务端\minecraft.fabric26.2 | fabric-server-mc.26.2-loader.0.19.5-launcher.1.1.2.jar |
| Paper 26.2 | C:\Users\29104\Desktop\Game\minecraft服务端\minecraft.peper26.2 | paper-26.2-129.jar |

目录名peper按实际路径保留，不能擅自重命名。版本及类型目前为用户声明/文件名线索，不替代JAR内部与真实启动识别证据；正式验收前验证Java及启动依赖。

没有读取原世界、server.properties/密码或用户插件配置；没有启动、停止、复制或写入来源。验收只能在项目fresh UUID隔离runtime/.manager进行。Fabric launcher与Paper启动可能需要额外library/cache依赖，先只读盘点并建立明确复制白名单/摘要；不能递归复制整个来源目录，不能复制世界、配置或秘密，不能自行接受EULA。未授权的网络依赖或无法证明完整依赖时保持验收BLOCKED。
