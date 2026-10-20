# D3 offline compiler observation candidate

Scope: test-only observation, not compiler provenance or build authorization.
One bounded offline signature observation completed; no compiler/artifact/native
worker has been executed by this candidate.
LC2 capacity remains BLOCKED; member writes UNWIRED, remote PAUSED.

## Authority boundary

WinVerifyTrust LONG=0 is an offline platform observation only. The separately
extracted embedded certificate name/EKU is not bound to the verified signer.
Even a fully positive report always has compilerTrust=pending. Publisher policy,
verified-signer binding, immutable native ancestry and complete compiler/runtime/
reference dependency pins remain D3 build prerequisites. No build is authorized
by this report. Windows installation/runtime/local trust store are the bootstrap;
same-user administrator replacement of that platform is outside this observation.
Offline revocation freshness is not claimed.

## Candidate and bounds

- Test fixture constructs a fixed PowerShell/.NET Reflection.Emit WVT call, not
  Add-Type or csc. Only the fixed local C:\Windows installation is supported;
  other installations fail unavailable. Fixed ancestry/target reparse prechecks
  are observations, not atomic directory identity pins or a hostile-admin proof.
- Open compiler FileShare.Read; reject size outside 1..32MiB before hash/WVT.
  Hash before/after, use the held file handle for WVT. Fixed x64 file/data32/88
  layouts, flags0x3010, UI_NONE, exact zero status. Independent embedded cert
  name/code-signing-EKU observations convey no publisher authority.
- Close WVT before freeing native buffers. On uncertain state-close retain all
  buffers and an explicit unreleased GCHandle rooting FileStream to process exit.
- Test-only runner fixes executable/arguments/environment, no shell or compiler.
  Helper timeout15s/output16KiB; independent close-drain ceiling20s. Termination
  request is not exit proof. Missing close means CLEANUP_BLOCKED/exit unknown;
  detach/unref does not certify OS exit. Late results cannot rewrite uncertainty.
- Wrapper needs an explicit confirmation, writes one exclusive ignored report
  below canonical test-results, never overwrites historical evidence. No user
  server, credentials, world, network configuration or trust-store changes.

## Retained findings and validation

Initial tests: 1 PASS/15 FAIL, exit1, TypeError: parseCompilerObservation is not a
function. The parser fragment had been inserted inside the raw PS string. Fix1
moves it outside that string; unchanged assertions then16 PASS/exit0. Logs v1/v2
preserved, not relabeled. Later runner Fake tests produce2files22 PASS/exit0
(lc2-compiler-observation-source-tests-v3.log), including no-close, late-close,
termination request, invalid payload, launch throw and output redaction.

Independent first review P1=0/P2=1/P3=2: local path, pre-hash size, explicit GC
root. Fix1 addresses them. Wrapper follow-up found a P2 unbounded close wait;
independent drain ceiling and Fake tests added. Final delta review pending.
PowerShell parser-only inspection reports zero syntax errors; no script execution
or native behavior is implied. Earlier lint/typecheck v1 passed before runner
extraction; latest v2 lint/typecheck both exit0. No full-project rerun.

## Actual observation and final evidence review

Frozen5/5 source/test/wrapper SHA matched before/after. Independent pre-run and
post-run evidence reviews P1/P2/P3=0 within observation scope. Run:
lc2-compiler-observation-d8abcf38-d7d6-4a18-abac-201f86d9caef.
Actual foreground exit0; WVT LONG0, stateClosed=true, helperClosed=true,
exitCode0/exitSignal=null, terminationRequested=false. Compiler bytes2569832,
SHA25646809206887326d2d24db1eff1f3064de972c3451abe766b49111450a5e08e00.
Embedded name/EKU observations true; compilerTrust remains pending. Report is
test-results/<runId>.json. No compiler invocation, binary artifact or user-world
access. This observation does not prove a stable directory ancestry, actual WVT
signer identity, complete dependency provenance or publisher acceptance policy.

## Next gate

Completed the one reviewed observation; do not rerun unchanged. Next review actual
verified-signer/chain retrieval and publisher policy before implementation.
Compiler build and worker execution remain separate later Gates.
No commit/push/PR.
