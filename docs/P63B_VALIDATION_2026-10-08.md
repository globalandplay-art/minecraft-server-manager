# P6.3b — registered crash analysis API and page

Current status: P6.3b FINAL PASS. Independent Sol High P1=0/P2=0/P3=0.
P6.3a conservative privacy policy remains intact. Phase6 is IN PROGRESS; no Phase7.

## Frozen scope

GET /api/v1/servers/:serverId/crash-analysis derives root and stored identity
from the registered local adapter. Reject all query parameters and unsupported
methods; existing Host/Origin guard applies. Replies use no-store and a bounded
shared schema. Mock returns unavailable, no fabricated evidence. Only fixed
local sources from P6.3a are scanned, no commands or filesystem writes.

Per-instance singleflight and 5-second monotonic cooldown retain original
sampledAt and errors, never substitute earlier success after an unsafe read.
No timers, external services, arbitrary path input or automatic repair.
Manager restart clears snapshots. Returned snapshots are independent clones.

Page scans only on explicit click; no initial scan, focus/reconnect refresh or
polling. It hides cached evidence after refresh failure and separates instances.
It labels possible findings, sanitized excerpt coordinates, missing evidence,
no-rule-match uncertainty and truncated sources. Over64KiB sources have no
findings or snippets. React renders evidence as text, not HTML.

## Validation

- Reader/core foundation:19 focused PASS.
- New service/API:4 focused PASS, including real isolated temporary log/properties
  evidence through composed Fastify API; credential/path redaction, registered
  binding, concurrent read/cooldown/error retention, Mock unavailable and request
  guard/method/query rejection. No Minecraft or original-world read needed.
- Web:6 focused PASS, including manual-only scan, uncertainty/incomplete coverage,
  text rendering, unavailable Mock, failure hiding old evidence and instance switch.
- Contracts:7 PASS including bounded schema, no certainty or extra root field.
- Workspace typecheck/lint PASS before freeze.
- Independent Sol High read-only review initially P1=0/P2=0/P3=1 (coverage gap),
  then delta PASS P1=0/P2=0/P3=0 after two missing UI regressions were added.
- Browser v1:360/768/1440, actual Mock API, affected placeholder route,5/5 PASS,
  exit0 after verified helper cleanup. Preserve teardown incident below.
- Final fixture browser v2: test-results/p63b-browser-v2.log,5/5 PASS, exit0 in12.2seconds;
 360/768/1440, actual Mock unavailable and affected placeholder entry. Native teardown normal.
- New frozen full check: test-results/p63b-check-v1.log exit0;
  contracts7/API1087/Web140, total1234 PASS, lint/typecheck/production build PASS.
  Final git diff --check PASS. Bundle519.98kB warning and jsdom navigation notices remain.
- Ordinary host verified final test-port listeners=0, browser/API/Vite helpers=0.

## Issue ledger

### P63B-FIXTURE-001 — LOW / RESOLVED

First API fixture lacked subscribe needed by composed app.
Raw error: `TypeError: adapter.subscribe is not a function`,
EventStreamService constructor -> buildApp -> crash-analysis-service.test.ts.
No explicit errno/code. One fixture correction added inert subscription and
observer cleanup;4/4 API tests then PASS. Product runtime was unchanged.

### P63B-TYPE-001 — LOW / RESOLVED

Raw error: `TS2322` in crash-analysis-service.ts; internal finding.code string
was wider than formal rule union. Narrowed core code to fixed rule codes,
and reader limitation literals; no runtime semantic change. Typecheck PASS.

### P63B-REVIEW-001 — LOW / RESOLVED

Independent P3: UI test title claimed failed reads but tested only unavailable.
Added failure-after-success and old-instance deferred-completion tests.
Web6/6 PASS and independent delta P1/P2/P3=0. No explicit error code.

### P63B-HOST-001 — MEDIUM / RESOLVED WITH HOST LIMITATION

All browser assertions passed; sandbox automatic teardown hung. Read-only WMI
query returned `HRESULT 0x80041003` / `Get-CimInstance: 拒绝访问`.
Ordinary-host inspection confirmed exact parent chain and command lines of this
run's Mock API/Vite helper PIDs12616/33548. Stop-Process failed with
`NullReferenceException` / `未将对象引用设置到对象的实例。`.
Revalidated identities and closed only those helpers with .NET Process.Kill;
Playwright then ended exit0,5 passed. No arbitrary Java kill or system changes.
Final browser run uses ordinary host permission for native teardown. Raw v1
log remains test-results/p63b-browser-v1.log; no result was hidden or rewritten.

## Remaining limitations

Fixed signatures are possible causes, not diagnosis or health certification.
Missing/truncated/invalid evidence can prevent useful findings. Unknown arbitrary
unstructured secrets cannot be guaranteed detected. P6.3a same-user filesystem
race/Windows constraints remain. Cached snapshot up to5seconds is not real-time;
current file identity is rechecked on a new scan, not while viewing a snapshot.
Existing jsdom navigation/bundle/line-ending warnings are not repaired here.

Branch codex/phase-4-players-properties, unchanged HEAD
eaf9f8520d507a5de8bac1c17ca5cf6f1c478955. Working tree retains existing Phase6
changes and this slice, including new crash service/route/page/tests/validation.
Private test-results remain local/ignored. No commit/push/PR.

No Minecraft launch, original world access, transaction/recovery changes,
commit, push or PR. Phase6 overall Final Gate is separate P6.4.
