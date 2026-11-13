# Initial maturity startup classification (2026-10-30)

Status: bounded metadata-only unit ACCEPTED. Worlds V2 remains IN PROGRESS.
This is not world readiness, whole Phase 1 or Worlds & Backups V2 acceptance.

## Scope

Startup may classify a strictly verified initial schema-7 publication as
metadata-only. It verifies the immutable issuer, original snapshot, journal,
raw receipts, publication intent, target object and directory closure. Its
last asynchronous action rechecks original evidence, followed by the reviewed
synchronous closing fence. The observer does not create files, rename, sync,
repair, settle operations or clear recovery causes. It explicitly reports
`publicationObserved: true`, `durabilityVerified: false`, `inspectionOnly: true`
and `recoveryRequired: true`.

The startup service supplies the registered execution digest only for one
scoped committed schema-14 initial generation preparation without scoped or
global scan issues. Other callers retain the ordinary strict schema 1-6
reader. Missing proof dependencies, malformed or manually installed schema 7,
changed object identity, partial intent and pending stages fail closed. Existing
external recovery causes remain. An explicit backend confirmation after a
fresh Fastify app reconstruction is tested separately; reconstruction in one
OS process is not an independent process-crash test.

## Import-cycle defect and minimal repair

The direct maturity-publication import in the startup integration test exposed
the cycle publication -> genesis-reference -> library-store -> reference-issuer
-> genesis-reference. Eager issuer schema construction could capture reference
schema exports before initialization. The old generic domain failure concealed
a TypeError at the payload validation phase, before startup classification.

Fixed phase-only diagnostics are preserved in separate test reports; all
temporary issuer diagnostics have been removed. Strict v1 reference and six
object schema declarations were moved unchanged into the leaf module
`world-generation-reference-schema.ts`. The issuer imports schemas from that
leaf; historical exports remain compatible through reexports. No field, range,
extra-property restriction, filesystem check or error policy was loosened.
Independent Sol High source review reported P1/P2/P3 = 0/0/0 for this delta.

## Preserved failures and timing boundary

- `worlds-v2-maturity-startup-final-2026-10-30.json`: 2 PASS / 8 FAIL,
  202 NOT RUN; issuer setup rejected before startup.
- Issuer/schema/branch/error-kind diagnostic reports remain unchanged. They
  contain fixed phase/error-kind classifications, not original exceptions or
  file contents.
- `worlds-v2-maturity-startup-schema-fixed-2026-10-30.json`: 9 PASS / 1 FAIL,
  202 NOT RUN. The remaining combined setup/startup case lasted 5050.11ms;
  no product-performance root cause is inferred from this duration alone.
- `worlds-v2-maturity-startup-timing-2026-10-30.json`: 1 PASS, 211 NOT RUN.
  The monotonic test-only sample in `worlds-v2-maturity-startup-phases-2026-10-30.json`
  measured fixture issuance at 2186.00ms, initial publication at 3090.94ms,
  startup at 4330.74ms, confirmation at 4740.52ms and query at 4793.97ms
  from the same start. This single sample is not performance certification or
  an explanation of timing variability in other runs.

Independent review approved separating genuine fixture creation/publication
from the fresh-app startup test. Installed Vitest defaults are 5s per test and
10s per hook. The new fixture hook must explicitly use 5000ms; the test body
keeps its default 5000ms. These are separate phase limits, not an unchanged
combined five-second deadline. Both real issuer/publication execution and all
startup, confirmation, query and closed-gate assertions remain. The original
combined-boundary failure is retained and is not relabeled PASS.

## Final bounded evidence

- `worlds-v2-maturity-startup-integrated-2026-10-30.json`: 51 PASS / 0 FAIL,
  161 NOT RUN, exit 0. Includes issuer, publication, startup and legacy startup
  rejection. This used the initial default setup hook.
- `worlds-v2-maturity-startup-reviewed-hook-2026-10-30.json`: 10 PASS / 0 FAIL,
  202 NOT RUN, exit 0 after explicitly bounding the setup hook at 5000ms.
  Results overlap; they are not added to make 61 tests.
- API build (TypeScript) and scoped ESLint exit 0; diff check exit 0.
- Independent GPT-6.1 Sol High verified 7/7 source/test hashes against
  `worlds-v2-maturity-startup-candidate-2026-10-30.json` and unchanged HEAD
  `bd0f9324f2406feb9e1eeebe5303e4445bf4d660`; P1/P2/P3 = 0/0/0,
  bounded ACCEPT. Build/lint success is writer-reported; test reports and
  hashes were independently read. Review covers this unit, not the whole tree.

## Remaining gates

Metadata classification cannot authorize
ordinary start/write or normal gameplay saves. Owned normal-stop revision
policy, integrated readiness/API/UI and actual Minecraft acceptance remain
unfinished. No real Java, world, backup repository or Windows setting was
changed by this unit. P7 STOPPED; no Git publication.
