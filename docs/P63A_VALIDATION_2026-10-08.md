# P6.3a — internal crash evidence foundation

## Later explicitly authorized policy change

Following the STOP report and recommendation, user requested continuation.
The new boundary excludes every truncated source from rule matching and raw
snippet output; retains only coverage metadata and incomplete status. Complete
sources remain analyzable. Partial coverage without findings explicitly returns
insufficient-evidence. This is a reduced output policy, not another speculative
partial-secret masking fix. The historical STOP below remains unchanged.

New combined actual head/tail/multiline-boundary and mixed-source regressions:
19 focused PASS. Independent SolHigh review PASS, P1=0/P2=0/P3=0;
P63-SECRET-BOUNDARY-001 CLOSED by the explicitly continued conservative policy.
New frozen test-results/p63a-policy-check-v2.log completed with exit0:
contracts6/API1083/Web134, total1223 PASS; lint/typecheck/production build PASS.
Final diff check PASS. Existing jsdom navigation and 516.08kB bundle warnings remain.
Current P6.3a Final Gate: PASS (internal foundation only). No API/UI/real server or Git actions.
Large files above64KiB now deliberately provide no findings/excerpts; this tradeoff
must be shown on the future page rather than misreported as clean diagnostics.

Historical checkpoint: BLOCKED — STOPPED AFTER TWO REDACTION FIX ATTEMPTS.
P6.3 overall IN PROGRESS; API/UI not connected, health crashAnalysis remains false.
No Phase7, Minecraft launch, original-world access or Git mutation.

## Implemented

New internal CrashEvidenceReader and analyzeCrashEvidence. Fixed registered
paths, identity/link checks, bounded scan/file/line/output limits and known
properties credentials; redacted whole-text evidence, possible-cause rules,
explicit incompleteness and safe DomainError409 CRASH_EVIDENCE_UNSAFE.
No arbitrary path, command, repair, upload or secret return. Full frozen scope
and limitations are in [P63 plan](./P63_CRASH_ANALYSIS_PLAN.md).

Files: two new service files and two corresponding API test files, plus plan
and progress documentation. Shared contracts/runtime/transaction modules unchanged
by this slice. No read of a registered real server/world; tests use owned temporary
fixture directories only. No API/page claims before P6.3b.

## Validation checkpoints

- Initial focused11 PASS and workspace typecheck/lint PASS.
- Initial independent SolHigh review BLOCKED: P1=0/P2=4/P3=0, preserved below.
- Initial ANSI/head-boundary fixes focused13 PASS.
- Final whole-text/path/root fixes and strengthened boundary fixture16 PASS;
  workspace typecheck PASS.
- New frozen full check: test-results/p63a-check-v1.log, session76942;
  not yet completed at this historical documentation checkpoint.
- Final independent delta review pending. Do not mark the foundation PASS until
  both required checks finish. Earlier P6.2 1204 is not the new test baseline.

## Issue ledger (review findings, no runtime error codes)

P63-SECRET-001 — HIGH / FIXED, DELTA REVIEW PENDING. Redaction before ANSI/control
removal could reconstruct a known secret; splitting before whole-value redaction
could leak multiline credentials. Trigger examples:

```text
OutOfMemoryError abc<ESC>[31mdef  (known secret: abcdef)
OutOfMemoryError private<LF>second-secret-part
```

Source: crash-analysis-core.ts / analyzeCrashEvidence.
Attempt1 added a second redaction after normalization and ANSI/NUL regressions.
Attempt2 moved whole-text redaction before split, normalized and redacted again,
and added the multiline-secret regression. Final16 focused PASS. Same root cause
must not receive a third speculative fix. No explicit error code: review finding.

P63-TRUNCATE-001 — HIGH / FIXED, DELTA REVIEW PENDING. Report head LIMIT could split
an unlabelled known secret, returning its unredactable prefix on a matched line.
Source: crash-evidence-reader.ts / bounded read. Attempt1 discards the incomplete
final line at head truncation; strengthened regression positions the matching
line at64KiB after one padding line, so line-count limits cannot falsely mask
the failure. Final16 PASS. No explicit error code: review finding.

P63-PATH-001 — MEDIUM / FIXED, DELTA REVIEW PENDING. file:/private/server.jar
was not covered by URL or POSIX regexes. Source: crash-analysis-core.ts sanitizer.
Attempt1 explicitly suppresses file URIs; file:/, file:///, Windows, UNC and
POSIX regressions PASS. No explicit error code: review finding.

P63-ROOT-001 — HIGH / FIXED, DELTA REVIEW PENDING. Final properties checksum alone
could accept equal bytes from a replaced root. Source: CrashEvidenceReader.read
final snapshot check. Attempt1 verifies final.rootIdentity as well as checksum;
equal-checksum/different-root regression rejects CRASH_EVIDENCE_UNSAFE. No actual
runtime failure; this code is the expected safe rejection in the test.

## Final delta review — mandatory STOP

Independent SolHigh delta: BLOCKED, P1=0/P2=1/P3=0. Normalization, complete
multiline secret, file URI and final root binding fixes are accepted. The remaining
security root cause is boundary truncation of a multiline known secret. No third
fix, new targeted test or API/UI connection is performed. Previously-started
frozen check may complete, but green existing tests cannot override this finding.

Issue: P63-SECRET-BOUNDARY-001. Severity HIGH; HARD BLOCKER for P6.3a signoff and
P6.3b exposure. STOPPED AFTER2 FIX ATTEMPTS for the existing redaction/boundary
root cause. NO_EXPLICIT_ERROR_CODE: static independent review finding, not a
runtime exception. No real-server crash log/error was produced in this slice.

Reviewer evidence (synthetic example, not an actual user's credential/log):

```text
Known secret: known-rcon-part-0123456789<LF>remaining-secret-part
Report excerpt before truncation:
OutOfMemoryError known-rcon-part-0123456789
remaining-secret-part
```

If LIMIT falls midway through the second line, the reader drops that incomplete
line but retains the complete first line. Neither full-text redaction nor the
line pass can match the now-absent complete multiline secret. The resulting
matched evidence can include `known-rcon-part-0123456789`. Existing single-line
boundary and complete-multiline regressions do not cover their combination.

Relevant source (not a fix):

```typescript
// crash-evidence-reader.ts line42
if (!tail && before.size > LIMIT) { const newline = bytes.lastIndexOf(10); bytes = newline < 0 ? Buffer.alloc(0) : bytes.subarray(0, newline + 1); }
// crash-analysis-core.ts lines26,42
const sanitized = redactor.redactText(normalize(redactor.redactText(item.text)));
if (finding.evidence.length < 2) finding.evidence.push({ sourceId: item.id, excerptLine: index + 1, snippet: text.slice(0, 1000) });
```

Attempt1 normalized/redacted again and discarded a partial report line;13 focused
PASS but incomplete scope. Attempt2 applied whole-text redaction before splitting,
added multiline coverage and strengthened boundary tests;16 focused PASS, yet
independent review still finds the combined boundary leak. These PASS records
are test results, not a security signoff. No fourth/third speculative repair.

Safety: core is unconnected, crashAnalysis=false, no API/raw evidence route,
no Minecraft launch/original-world access, no new transaction/guard/journal/
recovery state or staging. Worktree changes retained; no commit/push/PR.

Recommended human/architecture decision: choose a fail-closed policy for
truncated evidence with multiline credentials, or suppress raw excerpts from
truncated sources entirely. Then explicitly authorize the bounded revised design,
add combined head/tail/secret-boundary tests and require independent review.
This recommendation is not implemented and does not authorize automatic resume.

## Next

Finish frozen check and delta review, then document P6.3a accurately. P6.3b connects
registered-only API, singleflight/cooldown, formal contracts and manual-refresh
responsive page; those are not implemented by this foundation. No automatic Git.

## Final saved state

The previously-started frozen `test-results/p63a-check-v1.log` completed exit0:
contracts6/API1080/Web134 =1220 PASS; lint/typecheck/production build PASS.
Final diff check PASS; bundle516.08kB and existing jsdom navigation warning
retained. No source/test changes after this freeze. No new tests/fixes were
started after the final BLOCKED review. The green regression does not establish
redaction safety; P6.3a remains BLOCKED and P6.3b NOT STARTED.

Provisional FIXED / DELTA REVIEW PENDING rows above are historical checkpoints:
final review closes the URI and root identity findings and accepts normalization
and intact multiline redaction. Boundary/partial multiline disclosure remains
OPEN as P63-SECRET-BOUNDARY-001. The full scope cannot be signed off.
