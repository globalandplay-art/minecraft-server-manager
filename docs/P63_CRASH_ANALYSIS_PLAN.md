# P6.3 — bounded local crash evidence

P6.3a is the internal reader/rule foundation (PASS); P6.3b connects the registered
adapter API and responsive page (PASS: independent review, browser and new1234-test regression).
Current evidence is recorded in [P6.3b validation](./P63B_VALIDATION_2026-10-08.md).
P6.3 overall PASS; Phase6 Final Gate remains P6.4. No server launch, automatic repair or
external upload is needed for this read-only functionality.

## Authorized conservative output policy — 2026-10-08

After the two-attempt STOP report, the user authorized continuation following
the proposed policy decision. Truncated sources contribute only coverage
metadata/incomplete status, never findings or raw snippets. This deliberately
excludes latest logs or crash reports larger than64KiB from rule matching even
when a partial excerpt was read. Complete independent sources remain usable.
No findings with partial coverage means insufficient-evidence, not healthy or
no-error. Preserve prior BLOCKED evidence and do not reclassify old reviews.

## P6.3a boundary

The backend caller supplies its registered root and stored root identity.
Clients never choose directories, filenames, PIDs, regexes or byte limits.
Only fixed logs/latest.log and at most three standard server crash-report names
are read. Scan at most64 directory entries; each excerpt at most64KiB, total
at most256KiB. Latest log uses a tail with a partial first line omitted; crash
reports use their beginning. Oversized lines4096bytes are omitted; invalid UTF8,
oversized files and bounded directory/report selection mark incomplete. At most
2048 sanitized lines per source are analyzed. Head truncation also omits the
partial last line. Known secret lists are capped64 values of4096characters.

Require ordinary directories, no symlink/junction, exact canonical identity,
ordinary single-link files, and opened-file/path metadata agreement before and
after reading. Recheck registered root and source directory identities. The
existing bounded PropertiesReader supplies known sensitive properties values;
its snapshot is rechecked after evidence collection. Missing logs are an empty
evidence snapshot, not proof of healthy operation. Unsafe identities reject
with CRASH_EVIDENCE_UNSAFE, without raw filesystem exception paths.

Match only fixed signatures for OutOfMemoryError, port bind, Java class version,
watchdog and loader dependency evidence. Every finding has confidence=possible,
bounded redacted excerpts and guidance; no definite root cause or automatic
fix. Each rule emits at most2 excerpts of1000characters. Source IDs are opaque
latest-log/crash-N labels; excerptLine is relative to the excerpt, never a
claimed absolute line number in the full log. Coordinates refer to sanitized
excerpts; multiline secret redaction can change their line count.

Known property secrets, labelled credentials and bearer tokens are redacted
over the whole bounded text before splitting, then again after ANSI/control
normalization, before matching/cropping. Absolute Windows/UNC/POSIX paths,
file:/ URIs and URLs are suppressed
before output. This is not a guarantee of discovering arbitrary unknown secrets
in unstructured application text. No full raw log or report is returned.
No-rule-match is not a diagnosis. Concurrent writes may be rejected instead of
presented as a stable complete snapshot. Same-user filesystem races remain a
platform limitation; checks are not an OS isolation boundary.

## P6.3b connection

- Registered adapters only, derive root/identity server-side; unsupported Mock
  returns a clearly unavailable state, never fabricated crash findings.
- Read-only GET /api/v1/servers/:serverId/crash-analysis, existing Host/Origin
  checks, strict response schema; no user path/query/rule selection or POST.
- Per-instance scan singleflight/cooldown; failed unsafe scans stay errors,
  response no-store. No unattended polling, background scanning or repair.
- Page explicitly shows sampledAt, source coverage, incomplete evidence,
  possible causes and no-match uncertainty; manual refresh and mobile layouts.
- Preserve all Phase2 lifecycle and Phase3–5 transaction/recovery semantics.

## Gates

P6.3a: isolated temporary filesystem/security tests, typecheck/lint/build,
new frozen complete regression, independent Sol High review. No original world
read, no Minecraft startup. P6.3b: API/UI contracts and tests,360/768/1440 browser
checks, redacted isolated evidence acceptance and independent Sol High review.
P6.4 remains the whole Phase6 Final Gate; no Phase7 or automatic Git upload.
Same root cause: two distinct fixes maximum; safety uncertainty stops immediately.
