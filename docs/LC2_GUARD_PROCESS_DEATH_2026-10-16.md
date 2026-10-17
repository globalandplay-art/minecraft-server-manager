# LC2 committed Guard / fresh-process owner death — 2026-10-16

Candidate scope only: after a complete Guard commit and actual helper/resource closure, terminate that known writer Node without releasing its Manager owner, then acquire the same root from a fresh reader process. This is not interruption during a live helper/Node syscall, partial manifest publication, crash reconciliation of CommandStore, or maximum physical-history capacity. Default Stores and member writes remain unchanged/UNWIRED; remote PAUSED.

## Harness boundary

Explicit standalone confirmation only; never part of production or automatic Vitest collection. A fresh UUID directory is printed and canonical-checked before owned work. Driver uses one50s absolute work deadline across both children, separate shared5s final fixture cleanup and5s evidence save. Child Store50s/ACL5000ms/writer15s budgets are unchanged. Unknown fork, IPC, resource/owner exit or I/O settlement retains the known driver/fixture, without a new kill, reader, retry or deletion.

Writer uses actual ManagerLifetimeLock and default openOwned/create, then reports two actual released/resource0/bodysettled states, fixed nonce/role/PIDs and hashes over bounded IPC. No work follows its committed checkpoint; it waits holding the concrete owner. Parent terminates only that fork ChildProcess handle once and waits for actual close. Reader is a new fork, acquires a new actual owner, fully scans on open, verifies and scans again, checks original bytes/manifest/snapshot, releases owner and emits a fixed DONE. DONE alone is insufficient: parent requires actual reader exit0/null. Child raw stdout/stderr/error objects are never printed or retained; any output/pipe error or unknown IPC schema fails closed. Pipe errors were a pre-run P2, fixed before any native execution and independently reviewed.

Both Guard files and their directories retain complete canonical, nonlink/singlelink, identity/time/hash and strict-layout checks before and after the new reader. Active owner's share0 lock is control state, not readable Guard data. Its name remains required in the root layout; only after actual reader release and exit does cleanup independently require its ordinary/singlelink/canonical/size0 identity and empty read. Root directory mtime and lock ACL protocol fields are not treated as Guard data invariants.

## Historical first run — BLOCKED, retained

`lc2-owned-guard-death-b5fa93ec-9910-40d9-89e8-340edec0e78e` failed at writer observation after23586ms. Writer41388 had emitted a valid committed checkpoint with two released actions/resources0, parent27796 had activeIo0. No kill was requested and no reader was started. The original report remains BLOCKED, childrenClosed=false/fixtureRetained=true; sourceUnchanged=false meant the post-run comparison was never reached, not detected source drift. Frozen v2/internal18 hashes were independently checked against the candidate.

Original fixed failure:

```text
COMMITTED_GUARD_WRITER_FAILED
CLEANUP_BLOCKED_KNOWN_RUNNER_RETAINED
```

The driver had incorrectly tried to canonical-resolve/read `manager.lifetime.lock` while writer intentionally held it with native share0. A separate, exact read-only diagnostic against that synthetic lock recorded:

```text
{"stage":"lstat","result":"READ_ONLY_OK","bytes":null}
{"stage":"realpath","result":"READ_ONLY_DENIED","code":"EPERM","errno":-4048,"syscall":"realpath"}
{"stage":"readFile","result":"READ_ONLY_DENIED","code":"EPERM","errno":-4048,"syscall":"open"}
```

The old tree source ordered realpath before readFile, narrowing its first refusal to lock realpath; its original report was not amended to add that later diagnosis. This is a harness/control-lock protocol mismatch, not evidence of unsafe private ACL or a product defect.

The frozen code/checkpoint and fresh CIM verified exact executable, script/nonce, parent relation and creation identity. Holding the same Process handles, failure cleanup ended only writer then driver, confirmed actual exits(-1/-1) within31ms, and retained the fixture. Separate external foreground exit-1/237403ms includes intentional diagnostic retention, not a23586ms business operation extended to237s. Receipts: `lc2-guard-death-failure-cleanup-v1.json`, `lc2-guard-death-native-exit-v1.json`; original report/log and all freezes remain unchanged. No unknown helper or user process was touched.

## Fix Attempt1 and fresh verification

Only the acceptance script changed. Active snapshots exclude lock content, while both Guard data assertions remain; release-time lock checks were added, and hash lookup uses relative names instead of shifted array indexes. Original50s/5s deadlines and all product ownership/ACL rules are unchanged. Syntax and targeted lint v3 exit0; independent pre-run delta SolHigh P1/P2/P3=0. New26-file frozen v3 precedes a fresh UUID run. Its outcome is recorded separately after completion, never inferred from the old committed checkpoint.

Fresh run `lc2-owned-guard-death-e9d0b2dd-609b-43a4-8053-70daa31e33b1` passed the component checks:33609ms internally, actual foreground exit0/34627ms. Writer36552 intentionally closed with null/SIGTERM only after its valid committed/resource0 checkpoint. New reader11008 acquired a new real owner, completely scanned/verified the original Guard, normally released it and actually exited0/null. Each child emitted exactly one valid message, no stdout/stderr, no protocol failure. Guard directory/file identities and byte/manifest hashes agree before/after; source18/18 and frozen26/26 match, release-time lock inspection passed, successful fixture removed. Original failed fixture remains present. No product change or relaxation was needed. Final independent SolHigh evidence review P1/P2/P3=0; committed fresh-process component Gate accepted; the detailed independent receipt is `test-results/lc2-guard-death-final-v1.json`.

## Issue ledger

| Issue | Status / severity | Evidence |
| --- | --- | --- |
| LC2-GUARD-DEATH-PIPE-001 | RESOLVED pre-run / P2 | Readable pipe error could escape the driver and abandon unknown children. Fixed shared failure handler, no raw error or false close; source delta0. No native run occurred before that fix. |
| LC2-GUARD-DEATH-LOCK-001 | RESOLVED candidate Attempt1 / MEDIUM | Held share0 lock canonical/read EPERM errno-4048. Harness-only correction plus release-time strict lock checks; fresh e9d0b2dd run passes, first BLOCKED and retained fixture preserved. |
| LC2-ACTIVE-PARENT-DEATH-001 | OPEN / P2 | This case intentionally kills only after all action resources/helpers close. No active-helper/Node-I/O/partial/crash PASS follows. |
| LC2-CAPACITY-COMMAND-001 | Historical BLOCKED / MEDIUM | Original physical deadline failure remains; no maximum physical-capacity claim from logical budget tests. |

No commit/push/PR; no Minecraft, real credentials, user worlds, system or network changes. Accept a final result only after current source hashes, native report, actual external exit, child close, owner release, data invariance and cleanup are independently reviewed.
