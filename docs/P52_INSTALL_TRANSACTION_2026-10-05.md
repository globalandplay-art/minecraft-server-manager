# P5.2 Backend Install Transaction — 2026-10-05

**Status: P5.2 backend core PASS. Phase 5 remains IN PROGRESS.** This record covers P5.2a–e only. It does not claim UI, Disable/Restore/Trash, real Paper/Fabric Java acceptance, or Phase 5 final approval.

## Implemented

- Paper and Fabric identity is derived from the registered local instance, trusted launcher and metadata evidence, and bound to root/JAR/addon-directory identities. Conflicting or changed evidence fails closed; Vanilla behavior remains separate.
- Paper/Fabric addon protection snapshots are private and pinned. They include every top-level entry under the registered server root, including world data and dimensions, configs, enabled and disabled addons, trash, launcher/dependencies, and other entries. Copying rejects symlinks, junctions, hardlinks, special files, unsafe paths, and bounded-resource overflow. Root and directory identities and membership are checked around the copy. The manifest is bound to server type and Minecraft version; the snapshot is not available through public export.
- Uploads are inert, single-JAR resources stored under the manager-private root. Streaming byte limits, a receive timeout, per-server staging quota, storage reserve, canonical identity, checksum, server binding, loader metadata and durable lifecycle records are checked. No upload is extracted or executed. Failed, uncertain, referenced, or consumed staging is retained; cleanup is not part of this slice.
- Install requires a stopped instance with no recovery gate. It rechecks upload and inventory revisions, identities, target conflict, inventory file/byte/directory-entry limits, and the complete pinned guard. It writes journal intent before publication and uses same-volume hard-link publication as an atomic no-replace primitive, then removes the staging link. It verifies the installed physical file and records `restartRequired`; it never starts or restarts Minecraft.
- Startup reconciliation physically rechecks committed and not-applied transactions, including guard, source/staging, target absence or exact installed identity, and consumed upload evidence. Ambiguity or changed evidence retains a recovery gate. Tests rebuild Journal and OperationService across two manager restarts for the safe not-applied cases.

## Review findings and closure

An independent Sol High review found four P2 issues. All were fixed and re-reviewed:

1. **Incomplete Paper/Fabric guard roots:** snapshots now cover all server-root entries and verify directory identities and names before and after copying; installation verifies manifest roots, server type, version, and pin/checksum.
2. **JAR validation skipped non-metadata members:** all regular ZIP members now receive bounded decoding, complete compressed-input consumption, actual-size and CRC validation. A corrupt non-metadata class regression test was added.
3. **Safe rolled-back install relocked after another restart:** `rolled-back` records are physically revalidated on each startup, and a verified `ADDON_INSTALL_NOT_APPLIED` operation remains established across restarts. Invalid evidence explicitly restores the recovery gate.
4. **Inventory quota bypass:** count, aggregate JAR bytes, and enabled-directory entry count are checked at request preflight, after the guard, and immediately before publication. Tests cover 1000 JARs, byte overflow, and 1000 non-JAR addon-owned data folders.

The independent Sol High delta review returned **PASS**, with no remaining P1/P2/P3 findings in the reviewed scope.

## Validation

- Focused addon install, JAR, and backup suites: **50/50 PASS**.
- Full API suite with controlled concurrency (`--maxWorkers=2`): **926/926 PASS**.
- Contracts: **6/6 PASS**.
- Web: **108/108 PASS**.
- Frozen full regression total: **1040/1040 PASS**.
- Lint, typecheck, production build, and `git diff --check`: **PASS**.

The first unbounded `npm.cmd run check` attempt exited with test timeouts under default parallel load (including existing short-timeout transaction tests and a long archive-amplification test). No timeout or assertion was relaxed. The five affected suites passed at controlled concurrency (225/225); the complete API suite then passed at two workers, with full contracts and web suites passing separately. Lint, typecheck, and build passed again after the final code changes.

## Boundaries

- No real Paper/Fabric server was started in this slice. No user world or supplied test-server directory was accessed or modified.
- No UI, Disable/Restore/Trash, automatic staging cleanup, dynamic JAR loading, or explicit Minecraft restart flow was added.
- Windows directory sync follows the existing platform abstraction; it does not claim power-loss durability beyond that abstraction.
- No commit or push was made. Existing dirty P4/P5 worktree changes are retained.

Next planned work follows `PHASE5_PLAN.md`: P5.3 addon Disable/Restore/Trash transactions, then P5.4 UI and P5.5 isolated real Paper/Fabric acceptance and Phase 5 final review.
