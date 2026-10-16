# LC2 shared publication payload extraction — 2026-10-16

Pure payload/source candidate only. No LC2 retained publication or Node I/O implementation. LC2 member mutations UNWIRED, original store/crash/capacity Gates remain OPEN/BLOCKED; remote PAUSED. No Git publication.

## Exact reuse boundary

The original CREATOR C# constant and fixed Create/PublishNew/Publish script construction moved to internal private-publication-scripts.ts. Builders return only strings; they have no runner, ownership, request/environment switch or I/O. NativePathData remains the same data encoding. Default private-publication.ts keeps its original native runner with original15s/16KiB bounds, dirname checks, success/snapshot checks, file I/O and return semantics. ACL descriptors, inspection script and Move flags8/9 are single-source and unchanged. LC2 has not yet imported these builders into a writer.

Before extraction an ignored capture read the original source templates and evaluated only trusted string expressions with fixed synthetic paths (ASCII, Unicode/spaces, apostrophe/dollar/backtick and punctuation). It did not execute PowerShell or filesystem payloads. The original source and raw hashes are retained in test-results/lc2-publication-payload-original-v1.ts and -legacy-v1.json. After extraction all16 generated raw script byte hashes match exactly (-exact-v1.json). This covers the current checkout's actual bytes. Portable committed test fixture hashes independently normalize CRLF to LF for Git checkout portability; they are explicitly not the raw-byte receipt.

## Validation chronology

- Script baseline17 cases and default-adapter8 cases:25 PASS/exit0 (`lc2-publication-payload-focused-v1.log`). Default runner is mocked only in these adapter cases; no hidden native invocation. Tests preserve existing-target refusal, cross-directory refusal, snapshot gate, no-replace vs replacement selection and success receipt rejection.
- lint/typecheck exit0 (`lc2-publication-payload-lint-v1.log`, `-typecheck-v1.log`). Pure extraction independent source review SolHigh P1/P2/P3=0.
- Frozen12-file manifest `lc2-publication-payload-frozen-v1.json` prepared before the existing isolated native no-replace/store test. No concurrent project tests/probes in readonly process inventory. That test creates only its fresh synthetic tmp manager and disabled configuration files; it does not configure a real provider, credentials, server or network. Native result, affected tests/build and final evidence review are recorded after completion, never assumed from source or Fake checks.
- Existing isolated native test1 PASS/exit0,158.33s suite/157576ms body (`lc2-publication-payload-native-v1.log`). This is the original default disabled-store/ACL/no-replace normal test, not owner-retained LC2 publication or remote acceptance. Its successful fixture finally awaits its own rm; post-run readonly inventory found no matching test/probe. No unknown process was killed or old fixture removed.
- New affected6files109 PASS/exit0,7.16s (`lc2-publication-payload-affected-v1.log`); requested nonexistent properties-private-file.test.ts matched no file and is NOT counted as tested. Actual selected files are the two new publication tests, credential-reader, audit, whitelist-command-store and whitelist-synthetic-coordinator. Lint/typecheck/build/diff exit0, build5.63s with existing543.14KiB warning. Frozen12/12 unchanged; final receipt `lc2-publication-payload-final-v1.json`. Full project regression NOT RUN; LC2 publication not implemented. Final independent evidence review requested separately.

## Issue ledger

Final independent readonly source/evidence/document review SolHigh P1/P2/P3=0; twelve frozen hashes independently matched12/12. Acceptance is limited to this extraction and existing default-path regression. No complete-project or owned-publication PASS is claimed.

| Issue | Status/severity | Evidence and resolution |
| --- | --- | --- |
| LC2-PUBLICATION-OWNER-001 | OPEN / HIGH P2 | Shared script factoring does not retain owners, track Node write/sync/close or solve parent-death/crash/capacity. Default authentication behavior unchanged. |
| LC2-PAYLOAD-CAPTURE-001 | RESOLVED diagnostic / LOW | First Node -e capture failed before evaluation: SyntaxError: Unexpected token ':', exit1, caused by Windows native argument quote loss. No file/native action occurred. Attempt1 uses an ignored script file, preserving quotes and fixed synthetic data;16 raw scripts captured/verified. Not a native publication failure. |
| LC2-SOURCE-LOOKUP-003 | RESOLVED / LOW | Guessed auth/private-publication.test.ts returned PathNotFound/ObjectNotFound; rg literal wildcard path returned os error123. File inventory and -g '*.test.ts' located actual auth tests/access-private-store-native.test.ts. No product/test semantics changed. |

## Next implementation

After this candidate is validated, implement one complete UNWIRED owner-bound publication action: fixed Create, exact descriptor write/sync/finally close, ACL/readback, no-replace Move and physical verification, under the same envelope/resources and owner wrapper. Register before factories, fence every awaited mutation boundary, retain buffers through actual I/O/handle settlement. Avoid another generic helper-only layer. No scoped store migration before this transaction unit and its native evidence; no public alreadyLocked/no-op release/alternate runner switch.
