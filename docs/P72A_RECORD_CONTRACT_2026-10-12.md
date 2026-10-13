# P7.2a-3 Access record contract / pure codec

Scope: preparatory record validation, not durable publication or remote access. Existing server operation schema and persisted formats are unchanged. The new resource envelope is opt-in and is not wired into OperationService, stores or routes. No migration of existing records occurred.

The Manager-access operation contract has an explicit resource kind/provider, version, UUID and fixed error-code vocabulary. It has no serverId, paths, secrets or raw output. Shape validity does not prove legal state transitions, authorization, idempotency, ownership or provider health; those remain service-level Gates.

The private bootstrap contract accepts only disabled/external/null-ownership records. The pure codec accepts at most 4096 bytes, checks provider/root binding and requires canonical UTF-8 bytes, rejecting duplicate JSON keys, alternative encoding/whitespace, unknown fields and unknown versions. This is an internal new format, not a permissive legacy JSON import. Enabled records deliberately remain unsupported until reviewed transaction/recovery implementation. Neither the codec nor schema establishes file/ACL identity or durability.

Next: independently review and implement a private publication adapter using the existing protected-entry primitives and retained ManagerLifetimeLock. Verify identity/ACL/checksum and interrupted publication before wiring any configuration or operation storage. Recovery, idempotency and actual observed-state verification remain unimplemented. Startup and Access inventory behavior are unchanged; capabilities remain false. Real Tailscale/Cloudflare changes are unauthorized.

Focused verification: contracts 9 PASS; API codec/inventory/recent-admission 7 PASS; native exit 0. No tests failed and no substantive repair attempt was consumed. Full regression has not been rerun for this slice; prior 1429 PASS is historical. Final checks/review recorded in PROGRESS.

Readonly host test-process inventory was unavailable: Get-CimInstance returned HRESULT 0x80041003 (access denied). This does not prove any process is running or absent; no process was stopped or system permissions changed. All tests started in this turn completed normally.

No Minecraft, real credentials, private runtime evidence, provider CLI or network configuration was accessed. No commit/push/PR.

Final validation: lint/typecheck/production build/diff passed (native exit 0); Vite 531.24kB chunk warning retained. Independent GPT-6.1 Sol High readonly review PASS, P1=0/P2=0/P3=0, limited to record contracts and pure codec. Durable publication/recovery remains unimplemented and unsigned.
