# P7.1a offline credentials — validation checkpoint

Status: P7.1a ENGINEERING PASS. No real account initialized; HTTP/WS authentication remains unimplemented. No Minecraft, Tailscale, system repair or Git publication operation performed. Historical checkpoints below remain unchanged; this final result supersedes their pending engineering gates.

## Final frozen verification

- `p71a-offline-final-tests.log` / `.exit.txt`: exit 0, contracts 7 + API 1147 + Web 140 = **1294 PASS**. API 67/67 test files passed; single-worker execution included all ten Windows native lock/publication cases (three lock, seven writer) and the injected password/session/reader/CLI suites. API duration 1005.46 seconds; Web duration 72.23 seconds. No final failed or skipped case count.
- Final lint/typecheck/build logs and separate exit files: all exit 0. Production build completed on resumption; it was not rerun before a valid final result existed. Existing 519.98kB chunk warning and Web jsdom navigation messages remain recorded.
- Independent GPT-6.1 Sol High final evidence review: PASS, P1=0/P2=0/P3=0. All prior findings closed. Reviewer independently recomputed all nineteen candidate size/SHA256 entries: 19/19 match; parent independently obtained the same result. No source changes after freeze.
- Heaviest native positive case passed at original 180-second bound; all native case limits remain 60/120/180 seconds. All historical failed runs below remain FAIL, not rewritten as PASS.

Final documentation diff check exited 0. Original final-test known owner PIDs 37796/34092/36988/36912 no longer existed; no unknown process was touched. Branch `codex/phase-4-players-properties`, HEAD `eaf9f8520d507a5de8bac1c17ca5cf6f1c478955`; no commit/push/PR. Authentication integration is the next slice, P7.1b.

## Limits and safety state

Windows private files are synced and same-directory publication uses controlled native rename/write-through; this does not prove universal directory-fsync or sudden-power-loss durability on every storage device. Corrupt/ambiguous pending records remain fail-closed for explicit inspection; no automatic destructive repair. Same-user administrator/malware replacement is outside the stated threat model. JavaScript password string reference cleanup is not a guaranteed memory zeroization primitive.

Hidden input behavior was exercised using injected TTY streams (Unicode, spaces, backspace, cancel, EOF and no echo). This is not a claim of interactive human acceptance in every Windows console. Native cross-process exclusion, process termination release, ACL creation/rejection, exact reset backup and interrupted recovery were actually executed in fresh synthetic temporary roots. No real account or original Minecraft world was used.

Known original final-test owner PIDs are checked separately at closure; broader process ownership inventory had previously encountered WMI `0x80041003`, so no unknown process is terminated and no global claim of zero unrelated processes is made. No Manager listener was found on 3000/8080 at the final read-only check.

## Candidate implementation

Shared Windows lifetime exclusion uses exclusive native file handles duplicated into the Node owner process. Manager retains those handles until actual OS process exit, including after HTTP shutdown while admitted work can remain. Unknown handle transfer/release results require owner termination. Offline CLI uses the same exclusion, hidden interactive input, protected credential creation, exact-byte private reset backups and explicit journal-based recovery. Configured/pending credentials block legacy unauthenticated Manager startup with `AUTH_HTTP_INTEGRATION_PENDING` until HTTP authentication integration is complete.

Independent GPT-6.1 Sol High candidate delta review: P1=0/P2=0/P3=0. Closed findings: premature Manager unlock, confirmation cancellation cleanup and missing `prior-preserved` recovery coverage. This is static candidate review, not final engineering PASS.

## Preserved failed native run

`test-results/p71a-native-focused-v1.log`: exit 1, 9 PASS / 4 FAIL across 13 tests; duration 697.09 seconds. Three credential publication/recovery cases failed with the original error:

```text
Error: Test timed out in 180000ms.
```

No explicit product errno/HResult was supplied for those test timeouts. Read-only measurements on a fresh synthetic ACL fixture returned 3043/3044/3022ms for three inspections. Static call-path counts found approximately 76 native helper starts in the heaviest positive case (about 228 seconds), and 83 in interrupted recovery (about 249 seconds), exceeding the original 180-second case bound. Timeout-root Fix Attempt 1 is authorized to batch checks at the same boundary while preserving before/after ACL equality, strict parse, physical identity, revision and exact checksum validation. No test timeout or safety assertion was relaxed; optimization verification is pending.

The original test owner processes exited. Known test Node PIDs no longer existed and no PowerShell helper was observed in the run's creation window. A broader CIM parent/command-line inventory was denied with `HRESULT 0x80041003`; no unknown process was terminated and no WMI repair was attempted.

The fourth failure came from the earlier loaded test expecting `API startup failed`, while actual output correctly used:

```text
API startup blocked: AUTH_HTTP_INTEGRATION_PENDING; credentials or interrupted publication require the later authentication HTTP gate.
```

The current test checks that explicit fail-closed code. Source changed during v1; v1 is not final frozen evidence. Latest candidate lint and API typecheck exited 0. Earlier native lock 3/3 PASS and isolated core 44 PASS remain historical checkpoints; latest candidate still needs native/frozen regression and final signoff.

## Next gates

Timeout Attempt 1 targeted run `test-results/p71a-native-timeout-attempt1.log` ended exit 1: the selected heaviest case failed with `AUTH_PRIVATE_UNSAFE` at `windows-native.ts` helper callback, duration 160.97 seconds. This is not the original 180000ms test timeout. The exact helper step and underlying native error remain under read-only diagnosis; neither equivalence to the previous root cause nor independence is yet established. Do not treat the optimization as verified PASS. Five new cheap batch-interface regression tests were added; the combined injected reader/offline suite passed 25/25, exit 0. Static optimization review P1=0/P2=0; its direct batch-test coverage finding still needs delta signoff.

Subsequent isolated empty-fixture diagnosis located the new failure in the final test-only broad-Allow setup: `phase=set-acl`, `PrivilegeNotHeldException`, HRESULT `-2147024891` (`0x80070005`), `Microsoft.PowerShell.Commands.SetAclCommand`. Production init/reset/backup/reader assertions had reached that negative-fixture preparation. This is independently evidenced fixture privilege behavior, not a permission defect proven in product publication. Fixture-root Attempt 1 is restricted to DACL-only Win32 changes on a fresh test file, preserving owner/group, with no elevation or system ACL repair; the actual broad-permission rejection assertion remains mandatory. Original targeted run remains FAIL.

Fixture-root Attempt 1 empty-file proof passed: owner/group preserved and actual verifier rejected broad Everyone Read. The unchanged 180-second heaviest case then passed in 159.79 seconds, exit 0: `test-results/p71a-native-fixture-attempt1.log` (1 selected PASS / 6 intentionally unselected). Both timeout-root and fixture-root first fixes are verified by this targeted result, but remaining recovery cases still require full regression. Independent optimization, batch-test and DACL-fixture delta reviews closed all findings: P1=0/P2=0/P3=0. Final candidate manifest contains 19 source/test files with size/SHA256 under ignored `test-results/p71a-offline-final-candidate.json`. Frozen final lint/typecheck/full single-worker tests/build are now in progress, not yet PASS.

1. Diagnose native publication timeout without increasing timeouts or dropping checks. At most two distinct substantive fix attempts per root cause.
2. Validate any minimal fix with the original bounded focused test, then independent Sol High delta review.
3. Freeze sources and run the necessary full single-worker regression, lint, typecheck, build and diff check.
4. Record actual final results and remaining Windows durability limitations before marking P7.1a PASS.

No commit, push or PR is authorized in this slice. Existing Phase 6/7 working-tree changes and all historical failure evidence remain preserved.
