# M1 — add existing local instances

## Current update: instant loading

The save/restart-only behavior below is the earlier delivery snapshot and is
retained as historical evidence. The current candidate supports immediate loading
after a verified save, with explicit pending/error fallback and no old-instance
restart. See [instant loading and isolation validation](./M1_INSTANT_LOADING_2026-10-21.md).
Historical test counts below refer to the earlier candidate, not this update.

## Delivered scope

The Servers page now supports adding an existing local server directory through
preflight, detected-type/version preview, explicit confirmation and persisted
registration. It reuses existing detection, launch-plan/path validation and
config.json loading. It does not create a new supervisor or modify server files.

- Enter a unique ASCII instance ID, display name, absolute local server directory
  and JAR basename. Choose Java from an already loaded trusted instance profile;
  executable paths/JVM args/server args are not accepted from the browser.
- Check root/JAR/Java identity, properties, type/version, EULA observation and
  known lifecycle capability. Unknown/Forge launch capability remains read-only;
  never infer a runnable loader from a filename.
- Reject duplicate IDs, same/nested server roots, Manager-directory overlap,
  linked files/roots, invalid JAR paths, changed preview targets and config drift.
- Preview is read-only and bounded (16 tokens, five-minute expiry), with final
  authorization rechecked after waiting and immediately before publication.
- Save preserves all old registrations, writes a synced temporary config and
  exact old-file backup, checks root/file identity+revision again, atomically
  renames and verifies saved bytes. Uncertain publication is explicitly UNKNOWN,
  never success/retry. This reuses the existing local metadata atomic-save model;
  hostile simultaneous edits by the same OS user and Windows power-loss durability
  are not newly solved by this feature.
- Save returns `restartRequired=true`; the new instance is listed as pending,
  not falsely inserted into the live adapter list. After a manual Manager restart,
  the existing loader validates and loads both old and new entries.
- Stop owned Minecraft instances normally before restarting Manager, preserving
  process ownership semantics. Registration never auto-stops/starts Minecraft,
  changes ports/RCON/worlds, downloads files or accepts EULA.
- Existing Dashboard navigation/instance selection remains the switch mechanism.

## API

- `GET /api/v1/server-registrations`: safe Java profile IDs/names and pending
  registration IDs/names; no executable paths or raw config bytes.
- `POST /api/v1/server-registrations/preflight`: strict draft with `id`, `name`,
  `root`, `jarFile`, `javaProfileId`; returns token and detection preview.
- `POST /api/v1/server-registrations`: strict `{token, confirm:true}`; returns201
  only after readback. All local Origin/Host/intent and configured auth/CSRF/
  recent-auth gates remain in place. Request bodies are not logged.

No hot mutation of active-world, journal, scheduler or runtime registries.
No dependency on the deferred LC2 CommandStore/native writers. P7 remains stopped.

## Verification

- API focused:15PASS, including no-write preview, two-record persistence,
  exact backup, fresh loader reopening, no Minecraft launch, conflicting roots/
  IDs, JAR traversal, unknown Java profile, config content/identity drift,
  target file drift, final authorization, linked config, exclusion and consumed
  token behavior; HTTP strict fields/Origin and pending-vs-live distinction.
- New affected API suite: **98PASS / 5 files**, exit0. Includes local lifecycle
  configuration, loader detection, app and full authenticated-route inventory.
  Targeted15 rerun after fixture cleanup: **15PASS**, exit0, 17.20s.
- Contracts: **25PASS / 6 files**, exit0.
- Complete Web: **220PASS / 37 files**, exit0, 17.42s. Final text-only restart
  guidance and fixture close delta: affected Web6PASS / 3 files.
- Chrome360/768/1440: **3PASS**, exit0, 12.4s. Tests user form, strict preview,
  confirmation, single submission, pending display after page reload, no other
  writes and no horizontal overflow. Fake HTTP/browser, not real Minecraft.
- Project lint/typecheck/build: PASS; final affected static/build results are
  recorded in `test-results/m1-*` (ignored). Main frontend422.31kB/gzip127.90kB.
- Independent GPT-6.1 Sol High design/feature/delta review: **P1=0/P2=0/P3=0**.
  Review is source signoff, not a claim it ran the tests.

Historical initial failures are preserved: API14PASS/1FAIL because Fastify/AJV
stripped an extra field instead of rejecting it; explicit preValidation fixed
this (Attempt1). Initial new UI tests leaked prior rendered fixtures; cleanup
fixed their two failures (Attempt1). First full Web219PASS/1FAIL: query-freshness
test froze time before the lazy real route module loaded. Explicit module preload
before fake timers fixed it (Attempt1), retaining1ms/15,999ms and every assertion.
No timeout increase, assertion weakening, test deletion or skipped test was used.

## Gate and limitations

**M1 existing-instance addition slice: engineering verification completed.**
This is not completion of all M1 loader work or M2 lifecycle. Forge/NeoForge
argument-file launch handling, richer loader-specific detection and first-ever
Java-profile setup remain future slices. No arbitrary JVM options or scripts,
directory auto-scan, installer/download, live hot-add, delete/move registration,
automatic port correction or existing-server replacement is implemented here.

The registered real Vanilla server/config were not modified in this M1 round.
Integration uses isolated files and a fresh `loadLocalRegistrations` invocation;
no actual production Manager restart or new Minecraft launch is claimed.

No new all-project API regression was run, because the user forbids rerunning
unchanged deferred native experiments. Prior full API2510PASS/12FAIL and strict
real harness BLOCKED remain preserved, not hidden by affected98PASS or Web220PASS.
Perflib is independently ENVIRONMENT/DEFERRED, not an M1 business dependency.
No commit/push/PR; earlier uncommitted LC1/LC2 work is retained.
