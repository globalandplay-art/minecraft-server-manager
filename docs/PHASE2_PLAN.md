# Phase 2 — Vanilla lifecycle and console plan

Phase 2 adds a local Vanilla adapter, durable lifecycle operations, bounded logs, commands, and a WebSocket event stream. Phase 1 Mock mode remains available and read-only. This phase does not add world, backup, property-editing, upload, addon, remote-access, or arbitrary-path HTTP APIs.

## Private local configuration

Local mode is selected with `MCSM_MODE=local`. The manager reads `.manager/config.json`; if the file is absent it exposes an empty server list. The file is backend-only and has this strict shape:

```json
{
  "schemaVersion": 1,
  "servers": [
    {
      "id": "vanilla-local",
      "name": "Vanilla 26.3",
      "root": "C:\\path\\to\\server",
      "javaExecutable": "C:\\path\\to\\java.exe",
      "jarFile": "server.jar",
      "jvmArgs": ["-Xms2G", "-Xmx2G"],
      "serverArgs": ["nogui"]
    }
  ]
}
```

Unknown fields are rejected. `root` and `javaExecutable` must be absolute local paths. `jarFile` is a single filename inside `root`, never an absolute path. Arguments are arrays and are passed to `spawn` with `shell:false`; shell strings are not accepted. HTTP never receives or returns these fields.

The manager reads `eula.txt`, `server.properties`, and bounded JAR metadata. It does not accept the EULA or edit existing server files during normal startup. Java/JAR/root paths are canonicalized and checked for links during registration and immediately before start. Unknown or non-Vanilla detection remains read-only.

Lifecycle operation records live under `.manager/operations/`. Queued or running records found after manager restart become `interrupted` and set `recoveryRequired`; the manager does not replay them or claim an existing PID.

## Delivery order

1. Freeze shared DTOs and the private runtime contract.
2. Implement bounded configuration, properties, EULA, Java, and JAR detection.
3. Implement runtime process ownership, status probing, RCON/stdin, log tailing, and stream replay.
4. Add durable operations, one lock per server, idempotency, readiness, REST routes, and WebSocket routing.
5. Add a dry-run-first test setup CLI. Its apply mode backs up `server.properties` under `.manager/setup-backups`, changes only `server-ip`, `enable-rcon`, `rcon.port`, and `rcon.password`, and never prints the password.
6. Verify Mock regression, local empty config, synthetic lifecycle/security cases, then run the explicitly authorized real Vanilla test.

## Acceptance boundary

- Start resolves only after a new `Done` signal and a reliable Minecraft status probe.
- Stop affects only the child owned by this manager process. External processes are read-only.
- Restart holds one per-server lock across stop, exit, and start.
- Commands reject control characters and more than 1024 UTF-8 bytes. Reserved lifecycle/save commands cannot bypass the operation workflow.
- Writes require an allowlisted Origin, JSON content type, `X-Manager-Intent: local-ui`, and the route-specific preconditions.
- WebSocket upgrades enforce Host and Origin, accept no command messages, bound payload/buffer sizes, and serialize only validated shared DTOs.
