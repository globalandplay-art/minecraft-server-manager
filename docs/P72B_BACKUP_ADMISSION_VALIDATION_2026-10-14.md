# P7.2b manual Backup / Export admission validation

Candidate implemented; final full regression BLOCKED by an independent Fabric launch-binding identity assertion. Whole P7.2b BLOCKED, production UNWIRED.

The trusted synchronous callback is checked after operation queue waiting and immediately before operation-store save dispatch. Manual Backup and Export registrars explicitly receive authentication-or-undefined. Scheduler additionalPreflight, automatic backups, nested addon protection backups, journal and execution/recovery semantics remain unchanged. Other business paths are not covered.

Focused affected suite94 PASS; real configured authentication/buildApp/SessionCore/business-owner HTTP tests plus registrar tests4 PASS. Standalone lint/typecheck exit0. Source review initially P2=2 (optional registrar auth; missing full real authentication test chain); both corrected Attempt1. Delta P1/P2=0, P3=1 explicit test this annotation subsequently corrected, no runtime behavior change.

New frozen prefix `p72b-backup-admission-f18e1b29-6e23-4616-aa53-be643c1688f5`: 357/357 hashes unchanged. Original npm run check concurrency and timeouts unchanged; exit1, Contracts13 PASS/API1498 PASS+1 FAIL/Web163 PASS. Lint/typecheck PASS; production build NOT RUN within this failed check. Do not use earlier1665 PASS as evidence for this modified candidate. git diff --check exit0 after removing two new blank EOF lines from progress documents.

## Stop checkpoint / FABRIC-IDENTITY-001

Status BLOCKED, severity HIGH because physical launcher dependency identity is a safety invariant. Exact failed test `fabric-launch-binding.test.ts:20:84`, "binds actual bundle, server, loader and manifest dependencies, including physical identities".

Raw assertion (preserved full-check log):
```text
AssertionError: expected '39607f7f1d1f75b390927617bcb63c30ae031…' not to be '39607f7f1d1f75b390927617bcb63c30ae031…' // Object.is equality
```
Exit code1; no explicit errno/HResult. Original test renames loader.jar to loader.jar.old then writes identical bytes at loader.jar, requiring the aggregate identitySha256 to change. Source `fabric-launch-binding.ts:85,126,132` reads dependencies with the unchanged shared `readPrivatePropertiesFile` and aggregates directory/file identity and checksums. No failed-run per-file stat snapshots exist, so precision loss or another identity issue is NOT CONFIRMED. Earlier Inventory-only exact bigint hardening deliberately did not alter this shared helper or persisted identities. Do not infer the same root cause from similar assertion text.

New root repair attempts0/2. No Fabric server was started. No rerun or repair performed. Next: readonly inspect this failure and shared identity/persistence consumers; design a compatibility-safe narrow remedy only with direct evidence. Preserve this full failed run and do not lower the identity assertion.

Allowance checkpoint remaining4% of five-hour window (tool confirmed); new work stopped to preserve a usable handoff. Full test child completed exit1, no test session remains active from this run. No real provider/Java/world action. Earlier observer evidence confirms only owned sample helpers closed, not all host processes.

## Preserved issue ledger

- BACKUP-FIXTURE-ARGS-001 / LOW / RESOLVED Attempt1: duplicate positional arguments in new backup-admission.test.ts:32 caused `TypeError: admission is not a function`, assertion expected code AUTH_REQUIRED, test exit1. Corrected argument list; subsequent59 PASS. No explicit errno/HResult.
- BACKUP-FIXTURE-ORIGIN-001 / LOW / RESOLVED Attempt1: new registrar test omitted required Origin/intent headers; `AssertionError: expected 403 to be 401`, exit1. Supplied existing valid fixture headers without modifying guard/assertion. Next run passed guard and exposed independent response fixture error.
- BACKUP-FIXTURE-RESPONSE-001 / LOW / RESOLVED Attempt1: wrong errorResponse signature in new registrar fixture; `AssertionError: expected 500 to be 401`, exit1. Corrected to existing DomainError-to-response signature; subsequent94 and4 tests PASS. Product error handler untouched.
- BACKUP-FIXTURE-LINT-001 / LOW / RESOLVED Attempt1: unused clock variable, `@typescript-eslint/no-unused-vars`, lint exit1. Removed unused fixture declaration; lint/typecheck exit0.
- BACKUP-REVIEW-AUTH-001 / MEDIUM / RESOLVED Attempt1: optional registrar authentication could silently omit final checks. Required explicit auth-or-undefined; buildApp forwarding retained. Source delta accepted.
- BACKUP-REVIEW-CHAIN-001 / MEDIUM / RESOLVED Attempt1: mocked registrar checks did not prove actual auth/business/app chain. Added synthetic owned HTTP integration for both paths;4 tests PASS, delta accepted.
- BACKUP-REVIEW-THIS-001 / LOW / RESOLVED: explicit `this: BackupService` in one-shot prototype spy. API tsconfig does not typecheck test sources; no claim otherwise. Type-only annotation changes no runtime behavior.

Focused94+4 PASS outputs and raw failures above were captured as tool results in the conversation, not separately redirected to raw log files. New full raw evidence is independently archived in ignored test-results. Do not fabricate missing historical raw log paths. Explicit this annotation delta reviewed: current static P1/P2/P3=0; final full evidence acceptance remains pending.

Historical native timeouts and addon revision equality failures remain preserved; original roots UNKNOWN. No real credentials, Minecraft/world or network operations; no commit/push/PR.
