# Activation UI preparation — 2026-10-26

IN PROGRESS: read-only preparation, not complete activation or V2 acceptance.

Library responses expose optional activationAvailable separate from import
permission. Missing means false. It is true only for ready Vanilla 26.3 catalogs
after trusted executor composition. Target plans still enforce stopped state,
identity, revisions, recovery and compatibility. Main remains default-off.

Typed frontend plan/mutation transports reuse existing access protection. The
library target selector excludes active/retired worlds and offers read-only
preflight. Responses must match server, target, catalog revision and current
world. Instance changes abort/discard old requests; language changes preserve
selection. Three-language text explicitly says no switch or automatic start
occurred, and actual loading remains unverified. The UI never calls mutation.

Evidence: contracts31PASS; web import+activation12PASS; API shared composition and
default-off2PASS/100filtered, exit0, report
test-results/worlds-v2-capability-2026-10-26.json. Contracts build, API/Web
typecheck, scoped ESLint and diff PASS. Independent Sol High review found a P3
version-capability mismatch, corrected to match the executor's exact 26.3 scope;
final delta2PASS/100filtered exit0 is retained in
test-results/worlds-v2-capability-final-2026-10-26.json (the test explicitly checks
26.3=true, 1.21=false and default-off=false). Independent GPT-6.1 Sol High closed
the P3 and reported P1=0/P2=0/P3=0 for this narrow checkpoint. API typecheck,
affected lint and diff passed again. No full regression, browser or Java acceptance.

Next: exact name confirmation; persist original request/key before sending;
unknown-result handling without automatic replay; operation polling; final
active-world/resource verification; focused tests and independent review; browser
and real loading acceptance before main exposure.

No Java/world/repository changes, Git publication, P7 or old LC2 experiments.
