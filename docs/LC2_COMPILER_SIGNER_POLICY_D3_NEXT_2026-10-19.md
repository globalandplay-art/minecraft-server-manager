# D3 next: actual verified signer and publisher policy

SOURCE CANDIDATE ONLY. Preserve the completed d8abcf38 observation and frozen5
files unchanged; that report remains pending, not publisher/build trust.

## Proposed binding

Use the still-live successful WVT state from the same read-pinned compiler. Fix
primary signature index0 with WINTRUST_SIGNATURE_SETTINGS/WSS_VERIFY_SPECIFIC,
initialize returned index UINT_MAX, then require it to become0. Do not choose whichever signature has a
matching publisher after the fact. Fail unknown version/layout/API/signature.

Before WVT CLOSE, obtain provider data, the actual non-countersigner index0 and
its leaf/chain context. Require non-null pointers, exact supported x64 layouts,
bounded chain length and error-free signer evidence. Never merge CreateFromSignedFile
certificate metadata with this chain. Dispose any duplicated managed certificate
before closing WVT; do not release provider-owned pointers directly.

The actual chain must satisfy a reviewed Microsoft-root policy. A candidate is
CertVerifyCertificateChainPolicy(CERT_CHAIN_POLICY_MICROSOFT_ROOT=7), with both
native BOOL success and policy status.dwError=0. No test-root flag. Exact accepted
root variant is proposed as application2011 only with fixed0x60000: application
root0x20000 plus disable-flight0x40000; test-root0x10000 remains absent. Constants
were checked against Microsoft's SDK header (reference below, lines18944-18946).
No fallback to product/test/flight roots on rejection or unknown policy behavior.
Policy7 alone is not Authenticode verification and does not check revocation;
the original successful offline WVT verification remains independently required.
No CertGetCertificateChain/network rebuild or online revocation is added.

Proposed leaf subset is now explicit in test-only compiled-publisher-subject.ts:
exactly CN/O=Microsoft Corporation,L=Redmond,S=Washington,C=US. All five OIDs
required, no additional OID; DER Name definite/minimal lengths, sorted multivalue
SETs, no duplicate OID anywhere. Only UTF8String/PrintableString containing exact
ASCII policy values, no normalization/trim/case folding. Bounds4096 bytes/32
attributes/4 per SET/1024 per value. Malformed/unsupported encodings reject.
Exactly one actual-leaf EKU extension with canonical DER sequence containing only
1.3.6.1.5.5.7.3.3; missing/duplicate/anyPurpose/additional usage rejects. This is a
narrow proposed compatibility subset, not a claim the installed compiler matches.
The pure functions verify neither issuer/signature nor the provenance of inputs.
Source tests do not close live native verified-leaf extraction or build trust.

## Lifecycle and limits

Retain fixed command, local platform bootstrap, source bounds and no user inputs.
New native buffers/duplicated contexts must join the explicit cleanup inventory.
Keep all provider-dependent data alive through WVT CLOSE; unknown close retains
the pinned file and buffers until actual process exit. Original ACL/query/action
deadlines remain unchanged. Dedicated probe close remains bounded and uncertain
exit remains CLEANUP_BLOCKED, never success. Do not execute a compiler/worker.

## Required evidence before a new observation

- Independent design review of signature-index selection and publisher policy.
- Exact x64 field layouts and native ownership table with primary sources.
- Deterministic policy tests: unrelated embedded cert, wrong selected signature,
  custom root named Microsoft, test root, missing EKU, ambiguous subject,
  nonzero WVT, BOOL false, nonzero policy status, unknown pointers/layout and
  close failure. Fake success is not proof of actual Windows policy behavior.
- Source/Fake/static review and new fingerprints; then one separately recorded
  read-only observation, not an unchanged rerun of the first probe.

## Current implementation checkpoint

Pure DER-subject/EKU matcher19 PASS/exit0; independent source review P1/P2/P3=0.
Initial16 PASS preceded the added PrintableString/multivalue-SET/EKU cases; no
failure was hidden. Its lint/typecheck exit0, frozen2-file candidate saved as
test-results/lc2-publisher-subject-frozen-v1.json.

Test-only compilerVerifiedSignerScript now derives a separate fixed source using
exact single anchors from the unchanged earlier observation. It contains proposed
x64 WVT/signature/provider/signer/leaf/root-policy interop and bounded internal
subject/EKU transfer. New2 source invariants +19 subject tests=21 PASS/exit0.
PowerShell parser-only inspection of assembled output:0 syntax errors; NO script
execution. Independent interop source review P1/P2/P3=0, limited to SDK layout
reasoning and source lifetime rules, not native behavior.

The new test-only redacting consumer compares supplied DER with the proposed
strict policy and returns only fixed metadata/booleans, always trust pending.
Independent consumer review found a P3: Unicode trim accepted hidden/trailing BOM.
Fix1 rejects all BOM and only strips one LF/CRLF; source delta review closes P3,
remaining P1/P2/P3=0. No actual native signer/chain data has entered this consumer.

Combined5files64 PASS/exit0 and frozen11 v1 are historical preceding the dedicated
test-only signer runner. New runner3 Fake PASS, final6files67 PASS/exit0, frozen13
candidate test-results/lc2-compiler-d3-frozen-v2.json. Final lint/typecheck exit0
(lc2-compiler-d3-frozen-{lint,typecheck}-v2.log), diff check0. Dedicated source
runner final independent review P1/P2/P3=0, NOT native/pre-run signoff.
No new production source changed after the D2 build0/6.17s; no new whole-project
regression/build is claimed for this test-only candidate.

IMPORTANT: a dedicated test-only runner uses this source only when explicitly
called. A new test-only CLI wrapper now exists with an explicit distinct
--confirm-verified-signer-observation-only flag; it has NOT RUN. Node syntax and
focused ESLint exit0. Final14-file source manifest v3 adds the wrapper to v2
without changing its13 files. No production wiring invokes it. Runner retains fixed
15s/16KiB and separate20s close ceiling, with the redacting consumer. Its independent
source and wrapper reviews passed with P1/P2/P3=0, limited to saving the candidate;
a future explicit independent pre-run Gate is still required. Additional Fake native-
structure tests and actual ABI/owned-close evidence remain required. Raw internal certificate
DER must never reach public report/console/logs. These source tests cannot prove
the offsets, native pointer lifetime, actual selected signer or root-policy result.
No new actual observation, compiler invocation or worker execution is authorized
by this checkpoint.

Resume from the final14-file v3 fingerprint check and independent pre-run review.
Do not rerun the completed original observation. New signer script/native policy
still NOT RUN, compilerTrust pending, no csc/build/worker. Latest observed quota
before this closeout:5% remaining; final actual allowance check99% used/1% remaining.
No new work opened after that final check; no credits used. Preserve the historical source
fixture failures above. No commit/push/PR; working tree intentionally retained.

## Retained issue ledger

- D3-OBS-FIXTURE-001 / LOW / RESOLVED. Initial source tests1PASS15FAIL/exit1:
  TypeError: parseCompilerObservation is not a function. Parser was accidentally
  inside raw script text. Fix1 relocates it;16PASS, later22PASS and final64PASS.
- D3-OBS-REVIEW-001 / P2 / RESOLVED in source scope. IsPathRooted was insufficient
  for offline local-only intent. Fixed exact local Windows installation and
  fixed non-reparse prechecks; no atomic ancestry authority is claimed.
- D3-OBS-REVIEW-002 / P3 / RESOLVED in source scope. Size guard moved before hash;
  GCHandle roots FileStream on uncertain WVT close. No raw exception/error code.
- D3-OBS-REVIEW-003 / P2 / RESOLVED. Original close wait was unbounded; separate
 20s drain ceiling preserves CLEANUP_BLOCKED/unknown, covered by Fake tests.
- D3-SIGNER-FIXTURE-001 / LOW / RESOLVED. Candidate tests33PASS8FAIL/exit1,
  VERIFIED_SIGNER_OBSERVATION_UNSAFE. New fake Name used nonminimal0x81 length.
  Fix1 corrects fixture encoding only;41PASS then42PASS after stricter BOM cases.
- D3-SIGNER-ENCODING-001 / P3 / RESOLVED. Review found BOM removed by Unicode trim;
  fixed strict no-BOM/single optional line terminator, original assertions retained.
- D3-COMPILER-TRUST-001 / P2 / OPEN PREREQUISITE, not a newly observed runtime
  error. Actual verified signer, native ancestry pins, compiler/config/reference
  dependency binding and reviewed no-replace build/close remain unproved.
  NO_EXPLICIT_ERROR_CODE. No compiler/build/worker allowed on candidate metadata.

Even proven signer/policy is only one build prerequisite. Atomic native ancestry
pins, compiler/config/reference/runtime dependency identity and exact no-replace
build/close proof still require separate D3 completion. No implicit compile.

## Primary sources

- https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_signature_settings
- https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-wthelpergetprovsignerfromchain
- https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-crypt_provider_sgnr
- https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-crypt_provider_cert
- https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certverifycertificatechainpolicy
- https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/um/wincrypt.h

LC2 capacity BLOCKED/member writes UNWIRED/remote PAUSED. No commit/push/PR.
