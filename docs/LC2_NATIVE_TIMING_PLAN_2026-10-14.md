# LC2 Native guard timing investigation design — 2026-10-14

## Objective and gate

Design only. Native Gate BLOCKED. The observed last outer step is guard-create; no proven product performance defect, root fixes0/2. No further native test authorized by this checkpoint alone. Earlier50s failure must not become PASS through observer design or relaxed limits.

## Exact static call inventory

For FIRST guard in an absent namespace, one69-byte chunk and one manifest, with all native calls succeeding:

| Call site | Native compiled publication helpers | ACL inspection helpers |
| --- | ---: | ---: |
| create guard namespace and operation directory | 2 | 0 |
| writePrivateNew for chunk+manifest (private create then post-write ACL verify) | 2 | 2 |
| staged descriptor read for chunk+manifest (before/after verifyMany) | 0 | 4 |
| publishPrivateStageNew for chunk+manifest | 2 | 0 |
| published descriptor read for chunk+manifest (before/after verifyMany) | 0 | 4 |
| final manifest/chunk verification (before/after verifyMany) | 0 | 4 |
| Total successful path | 6 | 14 |

Count is derived from whitelist-guard-store.ts#create/#read/#verify and private-publication.ts#createPrivateEntry/writePrivateNew/publishPrivateStageNew. Creation validates actual native ACL snapshots inline; it is NOT an extra ACL inspection process in this table. Existing prior guards, multichunk bytes, failures and reopen paths change the count. Static20 is not proof20 were executed in either failed run. No original source/ACL checks may be removed on the basis of this inventory.

## Proposed bounded test observation

Use test-only wrappers that forward exact arguments to real createPrivateEntry/writePrivateNew/publishPrivateStageNew and real WindowsPrivateAclVerifier.verify/verifyMany. Never substitute Fake ACL or publication in native cases. Never read/log the argument paths, scripts, snapshots, stdout/stderr or error objects.

Record anonymous call IDs, fixed categories (create-directory, write-new, publish-new, acl-one, acl-many), parent call relation, monotonic start/end, active count and completed count. Distinguish nested write-new -> acl-one so aggregate elapsed is not double-counted. Wrappers must return the ORIGINAL Promise; observer side handlers cannot transform resolution/rejection, swallow the original failure, serialize concurrent calls or introduce awaits before native dispatch. Observer error must be ignored independently.

Use at most16 bounded IPC observation snapshots over the existing independent channel. Prefer fixed-interval aggregate snapshots rather than unbounded events per helper: last active category/call age, completed counts and cumulative category elapsed, with a clear precision/delivery limit. The observer timer must be unref'ed, disabled at final drain, bounded to work deadline, and never keep a child alive or authorize cleanup. Preserve the existing stage terminal semantics; only actual successful drained ACK permits normal cleanup.

Before a native run, deterministic test-double checks must prove argument identity, original Promise identity, same result/error object, rejection preservation, observer failure isolation, nested-accounting bounds and zero stdout/stderr writes. Independent Sol High static review required. Observation may localize native primitive categories, not PowerShell internal startup/ACL/script/close phases without separate trustworthy markers.

## Execution safeguards

First revalidate no prior probe/native helper remains; retained roots are not deleted. New UUID temp fixture only. One targeted diagnostic roundtrip; no blind native suite retry. Same50s work/5s cleanup/60s test and5000ms ACL helper limits; no timeout increases. Keep primary and cleanup errors separately, stop subsequent cases after first failure. No generic process kill or old-root deletion. Preserve all logs and exact candidate fingerprints.

## Decisions after evidence

- A single category/call remains active: inspect its fixed underlying primitive before proposing any product fix.
- Many individually bounded calls accumulate past observation deadline: classify test workload/performance precondition separately from individual helper timeout. Do not infer ACL invalidity or manufacture PASS by extending deadline.
- Cannot measure reliably: UNKNOWN, stop and report.

Any performance repair must preserve all source/file/ACL/owner/pinned guard/publication/readback checks and be reviewed as consequential filesystem work. Original per-root repair budget remains0/2 until a substantive repair is actually tested. No native PASS, production member write, real RCON or Git publication from this design.
