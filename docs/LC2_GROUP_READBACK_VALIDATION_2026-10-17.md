# LC2 grouped held-descriptor readback

UNWIRED grouped-publication path only. Default single-file `#read`, default/owned GuardStore and CommandStore are unchanged; no member command/API/UI mutation route. No wholeLC2, maximum physical capacity or history scan PASS.

## Collective verification

One immutable shared root/namespace/UUID physical and ACL baseline is captured for the whole publication. Each readback partition has at most six files; two parents plus files fit the original eight-target ACL query limit. Complete per-file metadata is captured BEFORE ACL-before, and canonical sameFile versions rechecked AFTER it before any descriptor opens. Every parent prefix must match the ORIGINAL publication baseline; a locally stable changed ACL cannot become a new baseline.

Files open/read sequentially; every returned descriptor remains held through the whole partition's ACL-after, final descriptor/path/time/link/size/exact-byte checks and physical parent-chain revalidation. Recursive finally attempts every remaining exact close if an inner close rejects. All saved file versions are checked again after6+2 partitions, so changes to an earlier partition during later checks fail. All original created-stage identities must match verified stages before Move; final target identities/stage absence and original parent ACL baseline are required before success. No cached verification, parallel raw I/O, budget reset, cleanup deletion or retry added.

Peak data storage is32768 input +24576 read bytes =57344, plus existing bounded protocol storage; at most six Node read handles, plus current ACL session/retained owner handles. The whole registered Node task owns buffers until raw read/write/close settlement. Outer timeout never wipes a still-pending read destination/input copy, releases ownership or admits later work.

Fake observation records11 logical ACL queries for8 chunks, with held-descriptor cohorts6/2/6/2 and full ACL batches8/8/4/4/8/8/4/4. The previous grouped source used88 repeated queries. This is query arithmetic/observed Fake behavior, not elapsed-time or maximum-capacity proof.

## Issues and evidence

| Issue | Status | Evidence |
| --- | --- | --- |
| LC2-GROUP-READ-VERSION-001 | P2 RESOLVED Attempt1 | Independent review found metadata captured after ACL-before, allowing same-inode version drift to become the baseline. Two new stage/target tests first FAIL/exit1 on old candidate (`lc2-group-readback-baseline-repro-v1.log`, promise resolved instead of expected rejection). Full metadata now precedes ACL-before and is revalidated immediately after it. No timeout/assertion/permission relaxation. |
| Pending raw-read coverage | Added before native | Positions0/5/7 hold sentinel destination buffer and input copy past original deadline/shared5s drain, forbid next open/ACL-after/Move, retain owner; exact raw settlement then closes all handles and wipes buffers without late success or owner readmission. |
| Close/late-open boundary coverage | Added | Late read opens0/3/5 close exact returned handles after revocation. Rejected close0/3/5 attempts remaining closes and retains the one uncertain handle/owner. Pending close0/3/5 retains copy/remaining handles past shared cleanup, then closes without readmission. |
| Cross-partition/parent drift | Added | Stage/target earlier-file identity change during later partition's ACL-after rejects; stable changed parent ACL between partitions rejects against original prefix. |

Focused v1 retained118PASS; added negative cases v2=126PASS, v3=132PASS; preserved2FAIL reproduction; after P2fix v4=134PASS/4.43s; final extra raw-read cases v5=137PASS/4.44s. Independent source identified exactly one P2, delta fixed; final static/affected/frozen/native results recorded on completion. Candidate33-file manifest `test-results/lc2-group-readback-frozen-v1.json`. Previous native8chunk fd0c4479 and direct-retention5e7a7dc5 receipts remain historical for their exact earlier candidate; deliberate source changes require fresh normal native evidence and do not rewrite them.

Remote PAUSED, LC2 IN PROGRESS/member writes UNWIRED. No real server/world/credentials/RCON/network/system or Git publication actions. Active product transport/cancellation, Move/Node-I/O death, maximum64 creation/history and CommandStore/default integration remain pending; earlier full-project1806 remains historical.

## Accepted candidate evidence
Final21files505PASS48.97s;137focused4.44s;lint/typecheck/build/diff0,build5.14s existing543.14KiB warning. Exactlyone newnative run lc2-owned-group-3ee7a650-26da-48f3-ab8d-7bd4eedda2b3:17.986s component/actualexit0 at18.426s; full8x4096hashes, released/null/bodysettled/resources0, actualownerreleased/assertrejected/activeSteps0/rootabsent. Frozen33/33/native14/14 independently verified; final SolHigh P1/P2/P3=0, NORMAL EIGHT-CHUNK COMPONENT accepted for changed readback candidate. Group segment6983ms is a measured phase only, not maximum64/history extrapolation. Preserved old2FAIL P2repro remains; Attempt1fixed. test-results/lc2-group-readback-final-v1.json.
