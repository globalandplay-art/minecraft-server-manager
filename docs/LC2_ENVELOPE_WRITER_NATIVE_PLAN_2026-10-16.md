2026-10-16 superseding execution record: exactly one reviewed native execution completed; limited normal component PASS, external exit0, see LC2_ENVELOPE_WRITER_NATIVE_VALIDATION_2026-10-16.md. The NOT RUN/proposal and two-Node text below is retained design history. No rerun authorized by that historical text.

# LC2 normal owner/envelope/writer native probe — plan

## Superseding current design: one foreground CLI, no controller/child clock handoff

The initial two-Node draft below is not implemented and is superseded. Independent SolHigh accepted the smaller one-foreground-Node direction for SOURCE PREPARATION ONLY; execution still needs source/pre-run review. `tests/acceptance/lc2-envelope-writer-native.mjs` is explicit-only, not in the production path or automatic test suite. Run with tsx and the exact isolated confirmation flag; no root/CLI/script input is accepted.

All component timing uses that Node's performance.now. Its50s work begins at CLI body entry after module/loader bootstrap; external command wall time separately includes startup and is not silently equated with the work clock. No cross-process clock conversion is attempted. All probe-issued work is fenced; already-submitted uninterruptible I/O or old owner-acquire internals are tracked as outstanding, never treated as cancelled. No subsequent probe action is dispatched after its failed fence.

The fresh UUID path is printed before mkdir and confirmed after realpath/identity/empty checks. Real owner acquisition precedes the envelope. Envelope work ends at outer workEnd minus15000ms to reserve the unchanged native owner-release helper budget. Registered writer payload is fixed inert JSON only. Adapter passes the envelope's remaining absolute cleanup deadline into writer.close; run result, actual writer close0/null, envelope release and explicit owner release are separately checked. Both capabilities remain UNWIRED for production.

Normal successful envelope cleanup finishes its own component phase before the later explicit owner-release work. Outer fixture cleanup starts only after all work succeeds and uses one absolute5000ms including identity/containment/layout checks and rm. A failed envelope has already attempted its bounded drain; CLI does NOT start another writer/owner cleanup or reset that budget. Failure preserves the root. Unknown acquisition/close/body or outstanding submitted work makes the CLI enter an inert retained state, with only a fixed-code report and its own known PID; no release/retry/delete/unknown-process kill. A known fully-drained failure may exit1 and let OS close only its own remaining owner handles. Release uncertainty is never claimed to retain global exclusion.

The CLI can prove only component checks. Its terminal JSON and stdout cannot prove its own process exit. External foreground exec completion must be separately recorded with actual exit0 in a new receipt, linked to the unchanged original report; any running session/exit1 leaves final acceptance BLOCKED. Reports and fingerprints are unique/ignored. Evidence metadata writes do not authorize another mutation or cleanup phase; report-save failure fails the Gate.

Source review must verify strict fixed payload, no raw output/proof/errors, actual task-settlement accounting, external exit proof, no speculative cleanup, and source fingerprint comparison. Passing this one normal probe will not close publication/crash/capacity/default Native Gates.

## Superseded two-Node draft — design history, NOT RUN

Design/source review required before ONE execution. Scope is normal transport only, not Create/Move/Node filesystem publication, parent death, store integration, credentials, RCON/world/server/network/system changes. Existing native/default/capacity/publication P2 Gates remain open even after a PASS.

## Controlled paths and deadlines

Controller runs with the explicit isolated-probe confirmation flag. Resolve tmpdir canonically; generate a fresh mcsm-envelope-writer-UUID parent and manager child. Print the planned canonical absolute paths BEFORE mkdir, then revalidate realpath/identity/empty layout. Never accept a user root, runtime/source server or arbitrary fixture path. Child accepts only this exact pattern directly under canonical tmp, real directory identities and an initially empty manager directory.

One50s monotonic controller work deadline includes preparation, Node startup, native owner acquisition, envelope, native writer and explicit native owner release. The envelope gets the remaining absolute work deadline in its own calibrated local clock via a remaining-duration handoff; child must subtract its startup/IPC delay conservatively or use a strict smaller internal ceiling. Original native writer15000ms and output16KiB unchanged, and no ACL5000ms query is lengthened. Shared controller cleanup5000ms begins before any kill/wait/rm. Writer.close(deadline?) must only shorten its original5s cleanup, used by the envelope resource adapter.

If there is insufficient known remaining work budget for a new native owner-release helper, do not dispatch it. Instead report failure with accurate drain/owner-held state and preserve the fixture; no timeout extension. A confirmed fully-drained child may exit and let OS close only its own native owner handles. Unknown owner/native creation/close prohibits a guessed shutdown/cleanup.

## Real component flow

1. Real ManagerLifetimeLock.acquire on the fresh empty manager directory; never initialize admin credentials/audit.
2. Real owner-backed WhitelistActionEnvelope.run with a bounded absolute deadline.
3. Within its bound capability register BEFORE constructing/running one WhitelistNativeWriter. Its mandatory wrapper is owner.nativeAclChildWrapper for the SAME mutation epoch.
4. The only native payload is a fixed JSON success object. It does not create/read/delete/move any file, query a server, sleep, access network or accept input. Owner bootstrap itself validates/duplicates the existing controlled lock handles using the already reviewed proof, with OS-exit-only retention.
5. Native result must be the exact fixed object; transport requires strict output and actual close0/null. Envelope body awaits registered result, then returns only fixed success.
6. Verify envelope phase released, primary null, mutation/activity released, body settled, resources0. Explicit owner.release must complete within work and owner.assertHeld must reject afterward. No implicit retry.
7. Child sends exactly one bounded sanitized terminal receipt and exits naturally; controller requires actual child close0/null, no stdout/stderr, complete valid receipt, source fingerprints unchanged, work deadline met and safe fixture cleanup. Controller child close, writer close, envelope release and owner release are separate proof fields.

## Failure and cleanup

Never print helper output, exception/cause/stack, private proof, lock bytes, SID/ACL snapshot or credential paths. Receipt contains fixed phase/category/booleans/lease-state strings, bounded elapsed time and actual close metadata only. Unknown/extra/trailing/oversized receipt, unexpected stream output or premature exit fails closed. Reports are unique JSON under ignored test-results; historical evidence untouched.

Child records successful owner acquisition and actual writer close separately. It emits drained=true only when acquisition was known successful and all attempted writer work is actually closed/no creation uncertainty and actual body/envelope tasks have settled. Owner-release failure is uncertain and prohibits a successful receipt. A safely-drained failure may exit with nonzero and let OS close its own owner handles; a failed fixture is still preserved. If native acquisition/close/body state is unknown, send drained=false and keep the owned Node process inert/alive for inspection; no retry or further work. Controller records its exact ChildProcess identity, retains root, and does not kill a process that has not produced a trustworthy drained receipt.

At controller deadline, stop scheduling. Only exact owned child with a valid drained receipt may be killed/waited under remaining shared5s if it has not closed. Unknown child/native states => CLEANUP_BLOCKED, preserve path/PID and do not terminate by process name or metadata-only helper PID. No orphan helper termination is inferred from Node exit.

Delete only on full success AFTER actual child close. Revalidate parent/root identities, canonical containment and exact expected contents (only manager/manager.lifetime.lock, ordinary single-link file), then bounded rm under the same cleanup budget. On any failure retain fixture, source fingerprints and fixed-code report. Evidence save or protocol failure cannot turn an unverified state into PASS.

## Gate and limits

Pure protocol/Fake adapter tests → static checks → independent SolHigh design/source review → confirm no other project tests/helpers running → freeze fingerprints → ONE native probe → fingerprint/process/evidence verification and independent evidence review. Failure stops this probe direction for analysis; no repeated run to find a green result.

Even PASS proves only normal native owner/envelope/inert writer transport. It does not prove active-parent death, real data creation/publication, Node write/sync drain, default store/crash recovery or maximum retained histories. No API or LC2 feature PASS follows.
