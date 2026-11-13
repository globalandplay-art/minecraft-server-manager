# Worlds V2 — real generation and Java timestamp finding (2026-10-28)

## Previous coordinator acceptance

Independent GPT-6.1 Sol High accepted runner-only P1/P2/P3=0/0/0 and6/6
candidate hashes. This did not certify real Minecraft, birth or production use.

## First real attempt: BLOCKED, preserved

Prelaunch manifest UTF8 BOM parse failed before Java; preserved at
`test-results/worlds-v2-generation-real-2ccc2d0d-94ca-43b2-8433-5beb110197ef/prelaunch-error.json`.
Harness strips only the optional evidence BOM; hashes remain original bytes.

Actual run:
`test-results/worlds-v2-generation-real-48288d5f-05a7-4e3a-84a4-8afd8ff5ee3d/result.json`.
Two fresh-copy owned Java processes reached ready and exited code0/null signal,
closed; force0, manager/generation drain confirmed, source JAR/Java/EULA and
original registration/authorization unchanged. The old world's full inventory
checksum equals its pinned guard payload checksum. No original world was read.
Raw generation receipt remained interrupted/RECOVERY_REQUIRED, so result BLOCKED.
No receipt/anchor/scene was cleared or retried.

Read-only postrun-diagnosis.json reconstructs the expected properties bytes and
matches reservation.propertiesAfter. Actual file differs at line index1 only:
Minecraft's generated date comment.69property values unchanged. This is a confirmed
byte-validation incompatibility in post-run proof, not a Perflib/log inference.
Existing WARN/ERROR retained; no new waiver or complete diagnostics certification.

## Minimum fix candidate

Capture the prelaunch properties checksum, same-file identity and a digest that
replaces only a strict Java-generated date on second line after the fixed
Minecraft properties header. Keep all other bytes exact, including comments,
unknown keys, order and line endings. No baseline text/secrets enter DTOs/logs.

Only the runner after exact normal owned exit supplies this baseline. Before
start and ordinary candidate observation remain byte-strict. Post-stop proof
requires baseline checksum equals the reservation and same file identity. The
raw current checksum is still used for within-read and subsequent recheck races.
Candidate first/last raw checksum/identity must agree. Returned proof is cloned,
so caller mutation cannot rewrite its closure baseline.

Review found twoP2 (candidate raw reread stability, private baseline alias);
both fixed with regression tests. Final independent fix decision PENDING.

## Verification

- timestamp-integration-2026-10-28.json:13files316PASS/0FAIL/0pending.
- timestamp-reviewed-2026-10-28.json:115PASS/0FAIL, overlapping subset.
- API typecheck, scoped ESLint, node --check harness, diff:exit0.
- timestamp-candidate-2026-10-28.json:12 frozen source/test/harness/report files.
  All are under test-results/worlds-v2-generation-* naming as applicable.

No second actual run yet. New accepted candidate must use a new fresh UUID root,
never replay the consumed failed attempt. Durable birth/publication/startup/API
integration and complete Worlds & Backups V2 remain OPEN. P7 STOPPED; no Git upload.

## Fix acceptance and new real validation

Independent GPT-6.1 Sol High closed2P2 and returned P1/P2/P3=0/0/0,
bounded fix ACCEPT,12/12 hashes. It approved one new fresh UUID real validation,
not reuse of the prior consumed scene. Prior BLOCKED remains unchanged above.

New run (exit0):
`test-results/worlds-v2-generation-real-56d1b65c-d195-4dd2-bc15-7a3c5e58735e/result.json`
SHA256 cbbd740672c26d9049b0a739144484a5a71a1c05c8a9d3c626610b5b76803609.
Business result PASS: baseline and controlled generation children both closed,
exit0/null signal, no overflow/spawn errors; force0; generation and manager drain
complete. New world reached Done/save and exact runtime witness; old tree inventory
unchanged. Same-key replay adds no launch; public generation remains interrupted
with recoveryRequired and no new catalog entry. Source JAR/Java/EULA/registration/
authorization unchanged.12/12 current candidate hashes still match run evidence.

WARN/ERROR counts10/1 per Java launch are retained; diagnostics NOT_ASSESSED.
No WARN waiver, player authentication, loader compatibility or whole-stage PASS.
Independent final real-evidence readback PENDING; no further Java runs needed for
this candidate business check unless a material defect/source change requires it.

Across the two actual fresh scenes,4 owned Java launches all closed normally;
zero forced child termination. The prelaunch BOM scene launched zero. Only these
isolated copies/configs/worlds/guards were created; original user worlds, historical
backups and blocked native fixtures untouched. No restic repository operation.
Next: durable same-UUID birth binding/publication and startup/API/UI integration;
this real process check does not itself authorize release of recovery gates.

## Final independent real-evidence readback

GPT-6.1 Sol High returned P1/P2/P3=0/0/0, limited real candidate business ACCEPT.
It verified report SHA,12/12 unchanged candidate hashes, both Done/save/exit0/close,
force0,24/24 old files against pinned guard, retained execution seal/UUID and
pending slot/recovery gate, plus source JAR/Java/EULA authorization binding.
Diagnostics remains NOT_ASSESSED;10WARN/1ERROR per launch are not waived.
This closes the bounded candidate-generation unit only, not birth/publication,
production use, the complete phase or Worlds & Backups V2.
