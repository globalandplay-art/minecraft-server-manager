# P7.2a-5 Windows native bootstrap acceptance

One isolated native test executed using the production ManagerLifetimeLock, WindowsPrivateAclVerifier, AccessPrivateStore and private publication primitives. Native filesystem/ACL work is limited to a fresh `mcsm-native-access-*` temporary fixture. No administrator credentials, provider CLI/network or Minecraft data are involved.

Command: `npm.cmd run test --workspace @mcsm/api -- test/access-private-store-native.test.ts`.

Result: 1 PASS, native exit0; total62.77s, test62.13s. Verified absent open/read causes no record creation, explicit private disabled bootstrap, native private ACL, owner release/reacquisition with record/root binding, and real MoveFileEx no-replace rejection on an existing destination. Destination original bytes and stage bytes remained unchanged after rejection. Final owner released and own isolated parent removed only on successful completion.

New test aggregate budget180000ms covers multiple sequential native checks; existing native-helper15000ms, ACL5000ms, test assertions and concurrency parameters are unchanged. No failure/retry or substantive repair occurred. Prior failures/review findings remain in historical documents.

Independent GPT-6.1 Sol High read-only native-test review P1=0/P2=0/P3=0. Reviewer inspected assertions and cleanup only; execution result is from the main thread. Static validation recorded in PROGRESS. No product code changed in this slice; prior successful build remains applicable. No full-suite regression rerun or remote capability Gate PASS is claimed.

This is graceful owner reacquisition within one test process, not proof of process-crash/startup reconciliation. Expected-record ledger across restart, interrupted-operation journal, recovery and service admission remain pending. Windows directory fsync/power-loss and same-user administrative interference limits remain. No network ownership/CAS or actual Tailscale/Funnel operation was tested. No commit/push/PR.

Next: implement and review durable expected-record/operation intent tracking before any enabled-state storage or startup/API integration. P7.2a overall remains IN PROGRESS.
